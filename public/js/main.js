import { CONFIG } from './config.js';
import { h, $, $$, clear, debounce, announce } from './dom.js';
import { icon, glyphSvg, logoSvg } from './icons.js';
import {
  TYPES, TYPE_KEYS, FILTERS, filterCounts, displayName, subtitle, haversine, formatDistance, formatDate,
} from './model.js';
import { loadAll } from './data.js';
import { loadMapLibraries, createMap } from './map.js';
import { buildIndex, searchLocal, geocode } from './search.js';
import { favorites, prefs } from './favorites.js';
import { openForm } from './forms.js';
import { renderDetail, placeTags, tagRow, routeLink } from './detail.js';
import { mountNav, popover, swipeToClose } from './nav.js';
import { bewerte } from './ampel-logik.js';
import { aktivLaden, standortLaden, statusZeile, heuteVorOrt, zusammenfassen } from './meldungen.js';
import { openLageForm } from './lage-form.js';
import { loadGauges, loadHistory, renderGaugeDetail } from './pegel.js';
import { weatherSection } from './wetter.js';
import { GROUPS, loadExtras, renderExtraDetail, nearbySection, glyph } from './extras.js';
import { enrichFacts } from './hafeninfo.js';

const state = {
  places: [], byId: new Map(), index: [], meta: null, issues: [], invalid: 0,
  cats: new Set(), subs: new Set(), tab: 'list',   // cats: sichtbare Kategorien (Start: keine – der Nutzer wählt)
  view: 'karte', peekId: null,                     // view: karte | liste | favoriten (steht in der Adresse)
  meld: new Map(), meldOffline: false, meldOnly: false,   // „Heute vor Ort“: Standort-ID → { n, typ }
  selectedId: null, user: null,
  map: null, mapOk: false,
  filtered: [], loadFailed: false,
  gaugesOn: false, gauges: null, gaugeById: new Map(), gaugeId: null, gaugeTimer: null,
  extrasOn: { wasser: false, service: false }, extras: null, extraById: new Map(), extraId: null,
};

const el = {
  sidebar: $('#sidebar'), list: $('#list'), listHead: $('#list-head'), datainfo: $('#datainfo'),
  toolbar: $('#toolbar'), detail: $('#detail'), peek: $('#peek'), mapEl: $('#map'), dlg: $('#dlg'),
  q: $('#q'), suggest: $('#suggest'), tabs: $('#tabs'), banner: $('#banner'), pickbar: $('#pickbar'),
};

const isMobile = () => window.matchMedia('(max-width: 767px)').matches;
const CAT_LABEL = { slip: 'Slipanlagen', marina: 'Häfen', fuel: 'Tanken' };
const CAT_SHORT = { slip: 'Slip', marina: 'Häfen', fuel: 'Tanken' };
const CAT_PLURAL = { slip: 'Slipanlagen', marina: 'Häfen', fuel: 'Tankstellen' };
const fmtN = (n) => n.toLocaleString('de-DE');
let nav, filterPop, reportPop;

// ============================================================ Start
async function init() {
  $('#brand-logo').innerHTML = logoSvg(38);
  $('#btn-search-ico').innerHTML = icon('search', 20);
  $('#btn-report-ico').innerHTML = icon('plus', 20);
  $('#btn-filter-ico').innerHTML = icon('filter', 20);
  $('#btn-locate').innerHTML = icon('locate', 22);
  if (isMobile()) el.q.placeholder = 'Ort, Gewässer oder Standort';
  $('#list-close').innerHTML = icon('close', 20);
  $('#version-list').textContent = `Version ${CONFIG.VERSION} · Kartendaten © OpenStreetMap-Mitwirkende (ODbL)`;
  state.cats = new Set((prefs.get('cats') || '').split(',').filter(t => TYPE_KEYS.includes(t)));
  if (!state.cats.size) state.cats.add('slip');   // mindestens eine Kategorie ist immer aktiv
  nav = mountNav({ top: $('#topnav'), bottom: $('#bottomnav'), active: 'karte', onSelect: onNav });
  filterPop = popover($('#filter-panel'), { isMobile });
  reportPop = popover($('#report-menu'), { isMobile, align: 'right' });
  renderSkeleton();
  wireStatic();

  const [libs, data] = await Promise.all([
    loadMapLibraries().catch(() => ({ leaflet: false })),
    loadAll().then(d => ({ ok: true, d }), err => ({ ok: false, err })),
  ]);

  if (libs.leaflet) {
    state.map = createMap(el.mapEl, {
      useCluster: libs.cluster,
      onMoveEnd: debounce(() => { if (state.tab === 'list') renderList(); updateInview(); }, 180),
      onMapClick: () => { if (state.selectedId || state.gaugeId || state.extraId || state.peekId) closeDetail(); },
      onMarkerClick: (id) => selectPlace(id),
    });
    state.mapOk = true;
  } else {
    showMapFallback();
  }

  if (data.ok) {
    ingest(data.d);
  } else {
    state.issues = data.err.issues || [data.err.message];
    state.meta = data.err.meta || null;
    state.loadFailed = true;
  }

  applyFilters();
  renderDatainfo();
  if (state.mapOk && data.ok) startView();
  if (state.mapOk && prefs.get('gauges') === '1') setGauges(true);
  if (state.mapOk && hasExtras()) for (const g of Object.keys(GROUPS)) if (prefs.get('extras.' + g) === '1') setExtras(g, true);
  handleHash({ initial: true });
  if (state.loadFailed) setView('liste', { push: false });   // Fehlermeldung mit „Erneut laden“ steht in der Liste
  offerLocation();
  registerServiceWorker();
  meldAktualisieren();
  setInterval(() => { if (document.visibilityState === 'visible') meldAktualisieren(); }, 2 * 60e3);
  window.addEventListener('online', () => meldAktualisieren(true));
}

// ============================================================ Heute vor Ort (Lagemeldungen)
async function meldAktualisieren(force = false) {
  const r = await aktivLaden({ force });
  meldSetzen(r.map, r.offline);
}

function meldSetzen(map, offline = state.meldOffline) {
  state.meld = map; state.meldOffline = offline;
  state.map?.setMeldungen(map);
  if (state.meldOnly) applyFilters(); else renderFilterbar();
}

/** Eigene Meldung/Bestätigung: Marker, Vorschau und Filter sofort aktualisieren. */
function meldLokal(id, liste) {
  const next = new Map(state.meld);
  const info = zusammenfassen(liste);
  if (info) next.set(id, info); else next.delete(id);
  meldSetzen(next);
}

/** Frisch geladener Stand eines Standorts gleicht die Übersicht ab (z. B. abgelaufen). */
function meldStandortGeladen(id, d) {
  if (d.offline) return;
  const info = zusammenfassen(d.meldungen), alt = state.meld.get(id);
  if (info?.n === alt?.n && info?.typ === alt?.typ) return;
  meldLokal(id, d.meldungen);
}

/** „Wie ist die Lage?“ für einen Standort öffnen. */
function lageMelden(p, { distance = null, zurueck = false } = {}) {
  if (navigator.onLine === false) { toast('Keine Verbindung, bitte später erneut versuchen.'); return; }
  const d = distance ?? (state.user ? haversine(state.user.lat, state.user.lon, p.lat, p.lon) : null);
  openLageForm({
    dialog: el.dlg, place: p, distance: d, toast,
    onBack: zurueck ? () => { renderReportMenu({ fragen: false }); reportPop.open($(isMobile() ? '#bottomnav [data-nav="melden"]' : '#btn-report')); } : null,
    onSent: (liste) => {
      meldLokal(p.id, liste);
      if (state.peekId === p.id) showPeek(p);
      else if (state.selectedId === p.id && !el.detail.hidden) showDetail(p, { scrollTo: 'vor-ort' });
    },
  });
}

function ingest({ places, meta, issues, invalid }) {
  state.places = places; state.meta = meta; state.issues = issues; state.invalid = invalid;
  state.byId = new Map(places.map(p => [p.id, p]));
  state.index = buildIndex(places);
}

function startView() {
  const m = state.map;
  if (CONFIG.START_MODE === 'germany' || !state.places.length) { m.setView(CONFIG.START_MODE === 'germany' ? CONFIG.GERMANY_VIEW : CONFIG.FALLBACK_VIEW); return; }
  m.fitBounds(state.places.map(p => [p.lat, p.lon]));
}

// ============================================================ Platzhalter, Fehler, Leerzustände
function renderSkeleton() {
  clear(el.list).append(...[0, 1, 2, 3].map(() => h('li', { class: 'skeleton' })));
}

function renderLoadError() {
  clear(el.list).append(h('li', { class: 'empty' },
    h('p', { class: 'empty-title', text: 'Die Standortdaten konnten nicht geladen werden.' }),
    h('p', { class: 'muted', text: navigator.onLine ? 'Die Karte funktioniert weiter. Bitte versuche es gleich noch einmal.' : 'Du bist offline. Sobald die Verbindung zurück ist, kannst du es erneut versuchen.' }),
    h('button', { class: 'btn btn-primary', type: 'button', text: 'Erneut laden', onclick: retryLoad })));
  $('#count').textContent = 'Keine Daten';
}

async function retryLoad() {
  renderSkeleton();
  try {
    ingest(await loadAll());
    state.loadFailed = false;
    applyFilters(); renderDatainfo();
    if (state.mapOk) startView();
    announce('Standorte geladen');
  } catch (e) {
    state.issues = e.issues || [e.message];
    state.loadFailed = true;
    renderLoadError();
  }
}

function showMapFallback() {
  clear(el.mapEl).append(h('div', { class: 'map-fallback', role: 'alert' },
    h('h2', { text: 'Die Karte konnte nicht geladen werden' }),
    h('p', { text: 'Das Kartenmodul ist gerade nicht erreichbar. Die Standortliste, die Suche in der Liste und alle Meldeformulare funktionieren weiter.' }),
    h('button', { class: 'btn btn-primary', type: 'button', text: 'Seite neu laden', onclick: () => location.reload() })));
  el.mapEl.classList.add('is-fallback');
  $('#btn-locate').hidden = true;
}

function renderDatainfo() {
  const m = state.meta, box = clear(el.datainfo);
  const when = m?.generated ? formatDate(m.generated) : null;
  box.append(h('p', {}, h('strong', { text: 'Datenstand: ' }), when ? `OSM-Import vom ${when}` : 'Startdaten aus OpenStreetMap', ` · ${state.places.length} Standorte`));
  if (m?.notice) box.append(h('p', { class: 'datainfo-notice', text: m.notice }));
  if (state.issues.length) box.append(h('p', { class: 'datainfo-notice', text: `Hinweis: ${state.issues.length} Datei(en) konnten nicht geladen werden. Es werden die verfügbaren Daten angezeigt.` }));
  if (state.invalid) box.append(h('p', { class: 'muted', text: `${state.invalid} fehlerhafte Datensätze wurden übersprungen.` }));
}

// ============================================================ Filter
/** Die eine gewählte Kategorie (für Unterfilter und Leerzustände) – oder null bei keiner/mehreren. */
function singleCat() { return state.cats.size === 1 ? [...state.cats][0] : null; }

function toggleCat(type, on = !state.cats.has(type)) {
  if (!on && state.cats.size === 1 && state.cats.has(type)) { toast('Mindestens eine Kategorie bleibt eingeblendet.'); return; }
  if (on) state.cats.add(type); else state.cats.delete(type);
  state.subs.clear();
  prefs.set('cats', [...state.cats].join(','));
  applyFilters();
}

function applyFilters() {
  const one = singleCat();
  const defs = one ? FILTERS[one].filter(d => state.subs.has(d.id)) : [];
  state.filtered = state.places.filter(p => state.cats.has(p.type) && defs.every(d => d.test(p)) && (!state.meldOnly || state.meld.has(p.id)));
  renderFilterbar();
  if (state.map) state.map.setPlaces(withFavorites(state.filtered));
  if (state.map && state.selectedId) state.map.select(state.selectedId);
  renderList();
}

/** Favoriten bleiben auf der Karte sichtbar, auch wenn ihre Kategorie ausgeblendet ist. */
function withFavorites(list) {
  const shown = new Set(list.map(p => p.id));
  const extra = favorites.all().map(id => state.byId.get(id)).filter(p => p && !shown.has(p.id));
  return extra.length ? list.concat(extra) : list;
}

/** Werkzeugleiste (Kategorien, Filter-Knopf, aktive Filter, Anzahl im Ausschnitt); offenes Filter-Fenster mit aktualisieren. */
function renderFilterbar() {
  renderToolbar();
  if (filterPop?.isOpen) renderFilterPanel();
}

function renderToolbar() {
  const counts = Object.fromEntries(TYPE_KEYS.map(t => [t, state.places.filter(p => p.type === t).length]));
  clear($('#cats')).append(...TYPE_KEYS.map(t => {
    const on = state.cats.has(t);
    return h('button', { type: 'button', class: `cat cat-${t}`, 'aria-pressed': String(on), dataset: { cat: t },
      title: on ? `${TYPES[t].plural} ausblenden` : `${TYPES[t].plural} auf der Karte zeigen`, onclick: () => toggleCat(t) },
      h('span', { class: 'cat-check', html: icon('check', 16), 'aria-hidden': 'true' }),
      h('span', { class: 'cat-label cat-label-long', text: CAT_LABEL[t] }), h('span', { class: 'cat-label cat-label-short', text: CAT_SHORT[t] }), state.places.length ? h('span', { class: 'cat-n', text: fmtN(counts[t]) }) : null);
  }));
  const n = state.subs.size + (state.meldOnly ? 1 : 0);
  const badge = $('#filter-n');
  badge.hidden = !n; badge.textContent = n ? String(n) : '';
  $('#btn-filter').setAttribute('aria-label', n ? `Filter, ${n} aktiv` : 'Filter');
  const one = singleCat();
  clear($('#filter-tags')).append(...[...(one ? FILTERS[one].filter(d => state.subs.has(d.id)) : []).map(d =>
    h('button', { type: 'button', class: 'ftag', 'aria-label': `Filter ${d.label} entfernen`, onclick: () => { state.subs.delete(d.id); applyFilters(); $('#btn-filter').focus(); } },
      h('span', { text: d.label }), h('span', { html: icon('close', 16) }))),
    state.meldOnly ? h('button', { type: 'button', class: 'ftag', 'aria-label': 'Filter Aktuelle Meldungen entfernen', onclick: () => { setMeldOnly(false); $('#btn-filter').focus(); } },
      h('span', { text: 'Aktuelle Meldungen' }), h('span', { html: icon('close', 16) })) : null].filter(Boolean));   // replaceChildren/append machen aus null den Text „null“
  $('#cat-hint').hidden = true;
  updateInview();
}

function setMeldOnly(on) { state.meldOnly = on; applyFilters(); }

/** Wie viele der gewählten Standorte (vor dem Meldungs-Filter) gerade Meldungen haben. */
function meldCount() {
  return state.places.filter(p => state.cats.has(p.type) && state.meld.has(p.id)).length;
}

/** „24 Slipanlagen im Kartenausschnitt“ (Desktop, rechts in der Werkzeugleiste). */
function updateInview() {
  const box = $('#inview');
  if (!state.map || !state.places.length) { box.textContent = ''; return; }
  if (!state.cats.size) { box.textContent = 'Keine Kategorie gewählt'; return; }
  const b = state.map.getBounds();
  const n = state.filtered.filter(p => p.lat >= b.south && p.lat <= b.north && p.lon >= b.west && p.lon <= b.east).length;
  const one = singleCat();
  box.replaceChildren(h('strong', { text: fmtN(n) }), ` ${one ? CAT_PLURAL[one] : (n === 1 ? 'Standort' : 'Standorte')} im Kartenausschnitt`);
}

function fswitch(label, on, onToggle, { count = null, disabled = false, title = null, key = null } = {}) {
  return h('button', { type: 'button', role: 'switch', class: 'fswitch', 'aria-checked': String(on), 'aria-disabled': disabled ? 'true' : null, title, onclick: onToggle, dataset: key ? { key } : null },
    h('span', { class: 'fswitch-label', text: label }), count !== null ? h('span', { class: 'fswitch-n', text: fmtN(count) }) : null,
    h('span', { class: 'fswitch-track', 'aria-hidden': 'true' }));
}

/** Filter-Fenster: Unterfilter der gewählten Kategorie und Kartenebenen (Pegel, Schleusen & Brücken …). */
function renderFilterPanel() {
  const body = $('#filter-body');
  const focusedLabel = document.activeElement?.closest?.('#filter-panel .fswitch')?.querySelector('.fswitch-label')?.textContent;
  clear(body);
  const one = singleCat();
  body.append(h('h2', { id: 'filter-title', text: 'Filter' }));
  body.append(h('section', { class: 'fsec' }, h('h3', { text: 'Heute vor Ort' }),
    fswitch('Aktuelle Meldungen', state.meldOnly, () => setMeldOnly(!state.meldOnly), { key: 'meldungen', count: meldCount() }),
    state.meldOffline ? h('p', { class: 'hint', text: 'Offline – Stand der letzten Abfrage.' }) : null));
  const sec1 = h('section', { class: 'fsec' }, h('h3', { text: one ? TYPES[one].plural : 'Eigenschaften' }));
  if (one) {
    sec1.append(...filterCounts(state.places, one).map(d => {
      const on = state.subs.has(d.id), none = d.count === 0;
      return fswitch(d.label, on, () => {
        if (none && !on) { toast('Zu diesem Filter liegen noch keine bestätigten Angaben vor.'); return; }
        if (on) state.subs.delete(d.id); else state.subs.add(d.id);
        applyFilters();
      }, { key: 'sub-' + d.id, count: d.count, disabled: none && !on, title: none ? 'Dazu liegen noch keine bestätigten Angaben vor.' : `${d.count} von ${d.total} Standorten mit bestätigter Angabe` });
    }));
    sec1.append(h('p', { class: 'hint', text: 'Gezeigt werden nur Standorte mit bestätigter Angabe. Unbekanntes gilt nicht als „Nein“.' }));
  } else {
    sec1.append(h('p', { class: 'hint', text: state.cats.size ? 'Weitere Filter gibt es, wenn genau eine Kategorie gewählt ist.' : 'Wähle zuerst Slipanlagen, Häfen oder Tanken.' }));
  }
  body.append(sec1);
  if (state.mapOk) {
    const sec2 = h('section', { class: 'fsec' }, h('h3', { text: 'Auf der Karte zeigen' }),
      fswitch('Pegelstände', state.gaugesOn, () => setGauges(!state.gaugesOn), { key: 'gauges', count: state.gaugesOn && state.gauges ? state.gauges.length : null }));
    if (hasExtras()) {
      for (const [g, def] of Object.entries(GROUPS)) {
        const on = state.extrasOn[g];
        const n = on && state.extras ? state.extras.filter(x => def.kinds.includes(x.kind)).length : null;
        sec2.append(fswitch(def.label, on, () => setExtras(g, !on), { key: 'extra-' + g, count: n }));
      }
    }
    body.append(sec2);
  }
  const shown = state.filtered.length;
  clear($('#filter-foot')).append(
    h('button', { type: 'button', class: 'btn btn-outline', text: 'Zurücksetzen', disabled: !state.subs.size && !state.meldOnly, onclick: () => { state.subs.clear(); state.meldOnly = false; applyFilters(); } }),
    h('button', { type: 'button', class: 'btn btn-primary', 'data-autofocus': '', text: `${fmtN(shown)} Standort${shown === 1 ? '' : 'e'} anzeigen`, onclick: () => filterPop.close() }));
  // Fokus bleibt nach dem Umschalten auf demselben Schalter (die Liste wird neu gezeichnet)
  if (focusedLabel) [...body.querySelectorAll('.fswitch')].find(b => b.querySelector('.fswitch-label').textContent === focusedLabel)?.focus();
}

// ============================================================ Liste
function distanceFrom(p) {
  const ref = state.user || (state.map ? state.map.getCenter() : null);
  return ref ? haversine(ref.lat, ref.lon, p.lat, p.lon) : null;
}

function renderList() {
  clear(el.listHead);
  if (state.loadFailed && state.tab === 'list') { renderLoadError(); return; }
  let items, headText, note = null;

  if (state.tab === 'fav') {
    items = favorites.all().map(id => state.byId.get(id)).filter(Boolean);
    items.sort((a, b) => displayName(a).localeCompare(displayName(b), 'de'));
    headText = `${items.length} Favorit${items.length === 1 ? '' : 'en'}`;
    if (!favorites.persistent) note = 'Dein Browser erlaubt kein Speichern. Favoriten gelten nur bis zum Schließen.';
  } else {
    let pool = state.filtered;
    let inView = false;
    if (state.map && state.map.getZoom() >= 7) {
      const b = state.map.getBounds();
      const visible = pool.filter(p => p.lat >= b.south && p.lat <= b.north && p.lon >= b.west && p.lon <= b.east);
      if (visible.length || !pool.length) { pool = visible; inView = true; }
    }
    items = pool.map(p => ({ p, d: distanceFrom(p) }));
    items.sort((a, b) => (a.d ?? 0) - (b.d ?? 0) || displayName(a.p).localeCompare(displayName(b.p), 'de'));
    items = items.map(x => x.p);
    const total = pool.length;
    headText = inView ? `${total} im Kartenausschnitt` : `${total} Standort${total === 1 ? '' : 'e'}`;
    if (total > CONFIG.LIST_LIMIT) { note = `Die ${CONFIG.LIST_LIMIT} nächsten werden gezeigt. Zoome näher heran oder nutze die Filter.`; items = items.slice(0, CONFIG.LIST_LIMIT); }
    else if (state.subs.size) note = 'Gefiltert werden nur Standorte mit bestätigter Angabe. Unbekanntes gilt nicht als „Nein“.';
  }

  $('#count').textContent = headText;
  el.listHead.append(h('strong', { text: headText }));
  if (note) el.listHead.append(h('span', { class: 'muted', text: note }));

  const ul = clear(el.list);
  if (!items.length) { ul.append(emptyState()); return; }
  for (const p of items) {
    const d = distanceFrom(p);
    const sub = subtitle(p, { short: true });
    ul.append(h('li', {},
      h('button', { type: 'button', class: 'place' + (p.id === state.selectedId ? ' is-selected' : ''), dataset: { id: p.id }, onclick: () => { if (isMobile()) setView('karte'); selectPlace(p.id); } },
        h('span', { class: `place-ico bg-${p.type}`, html: glyphSvg(p.type, 24) }),
        h('span', { class: 'place-text' },
          h('span', { class: 'place-name', text: displayName(p) }),
          h('span', { class: 'place-sub', text: [singleCat() ? null : TYPES[p.type].label, sub].filter(Boolean).join(' · ') || TYPES[p.type].label })),
        favorites.has(p.id) ? h('span', { class: 'place-fav', html: icon('star', 16, true), 'aria-label': 'Favorit' }) : null,
        d !== null && state.tab === 'list' ? h('span', { class: 'place-dist', text: formatDistance(d) }) : null)));
  }
}

function emptyState() {
  if (state.tab === 'fav') return h('li', { class: 'empty' }, h('p', { class: 'empty-title', text: 'Noch keine Favoriten' }), h('p', { class: 'muted', text: 'Tippe in einer Standortansicht auf den Stern, um einen Ort hier zu speichern.' }));
  if (!state.places.length) return h('li', { class: 'empty' }, h('p', { class: 'empty-title', text: 'Noch keine Standorte in der Datenbank' }), h('p', { class: 'muted', text: 'Du kannst trotzdem Slipanlagen melden. Sie erscheinen nach Prüfung.' }));
  if (!state.cats.size) return h('li', { class: 'empty' }, h('p', { class: 'empty-title', text: 'Keine Kategorie gewählt' }), h('p', { class: 'muted', text: 'Wähle oben Slipanlagen, Häfen oder Tanken.' }));
  const one = singleCat();
  if (one && !state.places.some(p => p.type === one)) {
    return h('li', { class: 'empty' }, h('p', { class: 'empty-title', text: `Noch keine ${TYPES[one].plural} in der Datenbank` }),
      h('p', { class: 'muted', text: 'Für diese Kategorie steht der Import aus OpenStreetMap noch aus. Es werden keine Standorte erfunden.' }),
      one === 'slip' ? h('button', { class: 'btn btn-outline', type: 'button', text: 'Slipanlage melden', onclick: () => openReport('slipanlage-melden') }) : null);
  }
  if (state.subs.size) return h('li', { class: 'empty' }, h('p', { class: 'empty-title', text: 'Keine Treffer für diese Filter' }), h('p', { class: 'muted', text: 'Nur Standorte mit bestätigter Angabe werden gezeigt. Nimm einen Filter heraus.' }), h('button', { class: 'btn btn-outline', type: 'button', text: 'Filter zurücksetzen', onclick: () => { state.subs.clear(); applyFilters(); } }));
  return h('li', { class: 'empty' }, h('p', { class: 'empty-title', text: 'Hier ist nichts in der Nähe' }), h('p', { class: 'muted', text: 'Verschiebe oder verkleinere die Karte, um weitere Standorte zu sehen.' }));
}

// ============================================================ Auswahl und Details
function detailInset() {
  if (isMobile()) return state.peekId ? { bottom: el.peek.offsetHeight + 24, top: 16 } : { bottom: Math.round(el.mapEl.offsetHeight * 0.6), top: 16 };
  return { right: el.detail.offsetWidth + 24, top: 16 };
}

function selectPlace(id, { fly = true, updateHash = true, full = false } = {}) {
  const p = state.byId.get(id);
  if (!p) return false;
  const pick = state.placePick;
  if (pick && pick.type && p.type !== pick.type) { toast('Bitte eine Bootstankstelle antippen.'); return false; }
  if (state.gaugeId) { state.gaugeId = null; state.map?.selectGauge(null); }
  if (state.extraId) { state.extraId = null; state.map?.selectExtra(null); }
  if (!state.cats.has(p.type)) toggleCat(p.type, true);   // z. B. Link oder Suche: Kategorie des Standorts einblenden
  state.selectedId = id;
  if (state.map) { state.map.select(id); }
  // Handy: erst die kompakte Vorschau über der Navigation, „Details“ öffnet das Panel
  if (isMobile() && !full && !pick) { closeDetailPanel(); showPeek(p); } else { hidePeek(); showDetail(p); }
  if (state.map && fly) state.map.reveal(p, { zoom: 15, inset: detailInset() });
  if (updateHash) setSelHash('p', id);
  $$('.place', el.list).forEach(b => b.classList.toggle('is-selected', b.dataset.id === id));
  announce(`${displayName(p)} ausgewählt`);
  if (pick) { endPlacePick(); openReport(pick.formName, { ...pick.preset, standort_id: id }); }  // Auswahlmodus aus dem Menü
  return true;
}

function showDetail(p, { scrollTo = null } = {}) {
  const [head, body] = renderDetail(p, {
    user: state.user,
    enrichFacts: enrichFacts(state.meta, p.id),
    weather: weatherSection(p.lat, p.lon),
    nearby: nearbySection(hasExtras() ? extrasList() : Promise.resolve([]), p.lat, p.lon, {
      exclude: p.id,
      onSelect: (id, x) => { if (x && !state.extraById.has(id)) state.extraById.set(id, x); selectExtra(id); },   // Live-Einträge sind nicht im Import
    }),
    actions: {
      close: closeDetail,
      onFavorite: () => { favorites.toggle(p.id); showDetail(p); renderList(); updateTabs(); state.map?.refresh(p.id); },
      share: () => shareLink(p),
      report: () => openReport('fehler-melden', { standort_id: p.id }),
      addPhoto: () => openReport('foto-einreichen', { standort_id: p.id }),
      reportPhoto: (ph) => openReport('fehler-melden', { standort_id: p.id, art: 'foto', details: `Foto unpassend: ${ph.url}\nGrund: ` }),
      reportPrice: () => openReport('tankpreis-melden', { standort_id: p.id }),
    },
    pegel: pegelInfo(p).then(info => info && pegelBox(info)),
    vorOrt: vorOrtTeile(p),
  });
  mountDetail(head, body);
  if (scrollTo === 'vor-ort') setTimeout(() => {
    const sec = el.detail.querySelector('#heute-vor-ort');
    sec?.scrollIntoView({ block: 'start' }); sec?.focus({ preventScroll: true });
  }, 0);
}

/** Statuszeile und Abschnitt „Heute vor Ort“ – frisch geladen beim Öffnen des Standorts. */
function vorOrtTeile(p) {
  const daten = standortLaden(p.id);
  daten.then(d => meldStandortGeladen(p.id, d));
  const slot = h('div', { class: 'meld-slot' });
  const section = heuteVorOrt(daten, {
    onMelden: () => lageMelden(p),
    onGeaendert: (liste) => { meldLokal(p.id, liste); zeileSetzen(liste); },
    toast,
  });
  const zeileSetzen = (liste, d = {}) => slot.replaceChildren(...[statusZeile(liste, { offline: d.offline, zeit: d.zeit,
    onOpen: () => { const sec = el.detail.querySelector('#heute-vor-ort'); sec?.scrollIntoView({ block: 'start', behavior: 'smooth' }); sec?.focus({ preventScroll: true }); } })].filter(Boolean));
  daten.then(d => zeileSetzen(d.meldungen, d));
  return { zeile: slot, section };
}

// ---- Vorschau-Karte (Handy)
function showPeek(p) {
  state.peekId = p.id;
  const isFav = favorites.has(p.id);
  const dist = state.user ? haversine(state.user.lat, state.user.lon, p.lat, p.lon) : null;
  const sub = [p.water?.name || p.locality || TYPES[p.type].label, dist !== null ? `${formatDistance(dist)} entfernt` : null].filter(Boolean).join(' · ');
  const tags = h('div', { class: 'peek-tags' }, tagRow(placeTags(p, 3)));
  const details = h('button', { type: 'button', class: 'dbtn', text: 'Details', onclick: () => { hidePeek(); showDetail(p); el.detail.focus({ preventScroll: true }); } });
  const card = h('div', { class: 'peek-card' },
    h('span', { class: `peek-ico bg-${p.type}`, html: glyphSvg(p.type, 28) }),
    h('div', { class: 'peek-text' }, h('h2', { class: 'peek-name', id: 'peek-name', text: displayName(p) }), h('p', { class: 'peek-sub', text: sub }), tags),
    h('button', { type: 'button', class: 'peek-fav', 'aria-pressed': String(isFav), 'aria-label': isFav ? 'Aus Favoriten entfernen' : 'Als Favorit speichern', html: icon('star', 22, isFav),
      onclick: () => { favorites.toggle(p.id); showPeek(p); renderList(); updateTabs(); state.map?.refresh(p.id); } }),
    h('div', { class: 'peek-meld' }),
    h('div', { class: 'peek-actions' }, routeLink(p), details));
  clear(el.peek).append(card);
  el.peek.setAttribute('aria-labelledby', 'peek-name');
  el.peek.hidden = false;
  document.body.classList.add('has-peek');
  document.body.style.setProperty('--peek-h', `${el.peek.offsetHeight}px`);
  if (state.meld.has(p.id)) {
    standortLaden(p.id).then((d) => {
      if (state.peekId !== p.id) return;
      meldStandortGeladen(p.id, d);
      const z = statusZeile(d.meldungen, { offline: d.offline, zeit: d.zeit, onOpen: () => { hidePeek(); showDetail(p, { scrollTo: 'vor-ort' }); } });
      card.querySelector('.peek-meld').replaceChildren(...[z].filter(Boolean));
      document.body.style.setProperty('--peek-h', `${el.peek.offsetHeight}px`);
    });
  }
  // Pegel-Etikett nur, wenn für diesen Pegel ein Mindestpegel in der Pegel-Ampel gespeichert ist
  pegelInfo(p).then((info) => {
    if (!info?.ampel || state.peekId !== p.id) return;
    const row = tags.querySelector('.dtags') || tags.appendChild(h('div', { class: 'dtags' }));
    row.append(h('span', { class: `dtag ${info.ampel.cls}`, text: info.ampel.tag }));
    document.body.style.setProperty('--peek-h', `${el.peek.offsetHeight}px`);
  });
}

function hidePeek() {
  if (!state.peekId && el.peek.hidden) return;
  state.peekId = null;
  el.peek.hidden = true; clear(el.peek);
  document.body.classList.remove('has-peek');
}

// ---- Pegel am selben Gewässer (nächster PEGELONLINE-Pegel bis 15 km)
const PEGEL_RADIUS_M = 15000;
let gaugesPromise = null, gaugesAt = 0;
const normWater = (s) => String(s || '').toLowerCase().replace(/[^a-zäöüß]/g, '');
function allGauges() {
  if (!gaugesPromise || Date.now() - gaugesAt > CONFIG.PEGEL_REFRESH_MIN * 60e3) {
    gaugesAt = Date.now();
    gaugesPromise = loadGauges().catch((e) => { gaugesPromise = null; throw e; });
  }
  return gaugesPromise;
}
const AMPEL_TAG = {
  gruen: { tag: 'Pegel gut', cls: 'is-good', box: 'is-gruen' },
  gelb: { tag: 'Pegel knapp', cls: 'is-warn', box: '' },
  rot: { tag: 'Pegel zu niedrig', cls: 'is-bad', box: 'is-rot' },
};
const pegelCache = new Map();
function pegelInfo(p) {
  const w = normWater(p.water?.name);
  if (w.length < 3) return Promise.resolve(null);
  if (pegelCache.has(p.id)) return pegelCache.get(p.id);
  const pr = allGauges().then((list) => {
    let best = null;
    for (const g of list) {
      const gw = normWater(g.water);
      if (!gw || !(gw === w || gw.includes(w) || w.includes(gw))) continue;
      const d = haversine(p.lat, p.lon, g.lat, g.lon);
      if (d <= PEGEL_RADIUS_M && (!best || d < best.d)) best = { g, d };
    }
    if (!best) return null;
    let ampel = null;
    try {
      const a = JSON.parse(localStorage.getItem('watermap.ampel') || '{}');
      if (a.pegel === best.g.id && Number.isFinite(a.min)) ampel = AMPEL_TAG[bewerte({ pegel: best.g, mindest: a.min }).status] || null;
    } catch { /* ohne gespeicherte Ampel */ }
    return { ...best, ampel };
  }).catch(() => null);
  pegelCache.set(p.id, pr);
  return pr;
}

function pegelBox({ g, ampel }) {
  const trend = { 1: 'steigend', 0: 'gleichbleibend', '-1': 'fallend' }[g.trend];
  return h('div', { class: 'pegel-box ' + (ampel ? ampel.box : 'is-neutral') },
    h('div', {},
      h('p', {}, h('strong', { text: `Pegel ${g.name}: ${fmtN(Math.round(g.value))} ${g.unit}${trend ? `, ${trend}` : ''}` })),
      h('small', { text: ampel ? `${ampel.tag} für dein Boot (laut Pegel-Ampel)` : 'Passt dein Boot heute?' })),
    h('a', { href: `./pegel-ampel?pegel=${encodeURIComponent(g.id)}`, text: 'Pegel-Ampel ›' }));
}


function mountDetail(head, body) {
  const scroll = el.detail.querySelector('.detail-scroll');
  const prev = scroll ? scroll.scrollTop : 0;
  clear(el.detail).append(h('div', { class: 'detail-scroll' }, head, body));
  el.detail.hidden = false;
  el.detail.setAttribute('aria-labelledby', 'detail-name');
  document.body.classList.add('has-detail');
  if (prev) el.detail.querySelector('.detail-scroll').scrollTop = prev;
  if (!el.detail.dataset.opened) { el.detail.dataset.opened = '1'; el.detail.tabIndex = -1; el.detail.focus({ preventScroll: true }); }
}

function closeDetailPanel() {
  el.detail.hidden = true; clear(el.detail); delete el.detail.dataset.opened;
  document.body.classList.remove('has-detail');
}

function closeDetail() {
  const prev = state.selectedId;
  state.selectedId = null;
  if (state.gaugeId) { state.gaugeId = null; state.map?.selectGauge(null); }
  if (state.extraId) { state.extraId = null; state.map?.selectExtra(null); }
  closeDetailPanel();
  hidePeek();
  if (state.map) state.map.select(null);
  setSelHash(null);
  $$('.place', el.list).forEach(b => b.classList.remove('is-selected'));
  if (prev) $(`.place[data-id="${CSS.escape(prev)}"]`, el.list)?.focus({ preventScroll: true });
}

async function shareLink(p) {
  const url = location.origin + location.pathname + '#p=' + encodeURIComponent(p.id);
  const data = { title: `${displayName(p)} – WaterMap`, text: `${displayName(p)} (${TYPES[p.type].label}) auf WaterMap`, url };
  try {
    if (navigator.share) { await navigator.share(data); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(url); toast('Link kopiert.'); }
  catch { prompt('Link zum Kopieren:', url); }
}

// ============================================================ Pegel
async function setGauges(on) {
  state.gaugesOn = on;
  prefs.set('gauges', on ? '1' : '0');
  clearInterval(state.gaugeTimer);
  if (!on) {
    if (state.gaugeId) closeDetail();
    state.map?.setGauges(null);
    state.gauges = null; state.gaugeById = new Map();   // beim nächsten Einschalten frisch laden
    renderFilterbar();
    return;
  }
  renderFilterbar();
  await refreshGauges();
  state.gaugeTimer = setInterval(refreshGauges, CONFIG.PEGEL_REFRESH_MIN * 60e3);
}

async function refreshGauges() {
  try {
    const list = await loadGauges();
    if (!state.gaugesOn) return;
    state.gauges = list;
    state.gaugeById = new Map(list.map(g => [g.id, g]));
    state.map?.setGauges(list, (id) => selectGauge(id));
    if (state.gaugeId) state.map?.selectGauge(state.gaugeId);
    announce(`${list.length} Pegel eingeblendet`);
  } catch {
    toast(state.gauges ? 'Pegeldaten konnten nicht aktualisiert werden.' : 'Pegeldaten sind gerade nicht erreichbar. Bitte später erneut versuchen.');
    if (!state.gauges) { state.gaugesOn = false; clearInterval(state.gaugeTimer); }
  }
  renderFilterbar();
}

function selectGauge(id, { fly = true } = {}) {
  const g = state.gaugeById.get(id);
  if (!g) return false;
  if (state.selectedId) { state.selectedId = null; state.map?.select(null); $$('.place', el.list).forEach(b => b.classList.remove('is-selected')); }
  if (state.extraId) { state.extraId = null; state.map?.selectExtra(null); }
  state.gaugeId = id;
  state.map?.selectGauge(id);
  const dist = state.user ? formatDistance(haversine(state.user.lat, state.user.lon, g.lat, g.lon)) : null;
  const [head, body] = renderGaugeDetail(g, { history: loadHistory(id), close: closeDetail, user: state.user, distance: dist, weather: weatherSection(g.lat, g.lon) });
  mountDetail(head, body);
  if (state.map && fly) state.map.reveal(g, { zoom: 12, inset: detailInset() });
  hidePeek();
  setSelHash('g', id);
  announce(`Pegel ${g.name} ausgewählt`);
  return true;
}

// ============================================================ Extras (Schleusen, Service …)
const hasExtras = () => !!state.meta?.files?.extras;

function extrasList() {
  return loadExtras(state.meta).then((list) => {
    if (!state.extras) { state.extras = list; state.extraById = new Map(list.map(x => [x.id, x])); }
    return list;
  });
}

const groupOf = (id) => {
  const x = state.extraById.get(id);
  return x ? Object.keys(GROUPS).find(g => GROUPS[g].kinds.includes(x.kind)) : null;
};

async function setExtras(group, on) {
  state.extrasOn[group] = on;
  prefs.set('extras.' + group, on ? '1' : '0');
  if (!on) {
    if (state.extraId && groupOf(state.extraId) === group) closeDetail();
    state.map?.setExtras(group, null);
    renderFilterbar();
    return;
  }
  renderFilterbar();
  try {
    const list = await extrasList();
    if (!state.extrasOn[group]) return;
    const kinds = new Set(GROUPS[group].kinds);
    const mine = list.filter(x => kinds.has(x.kind));
    state.map?.setExtras(group, mine, (id) => selectExtra(id));
    if (state.extraId) state.map?.selectExtra(state.extraId);
    announce(`${mine.length} Einträge „${GROUPS[group].label}“ eingeblendet`);
  } catch {
    state.extrasOn[group] = false;
    toast('Die Zusatzdaten konnten nicht geladen werden.');
  }
  renderFilterbar();
}

function selectExtra(id, { fly = true } = {}) {
  const x = state.extraById.get(id);
  if (!x) return false;
  if (state.selectedId) { state.selectedId = null; state.map?.select(null); $$('.place', el.list).forEach(b => b.classList.remove('is-selected')); }
  if (state.gaugeId) { state.gaugeId = null; state.map?.selectGauge(null); }
  state.extraId = id;
  state.map?.selectExtra(id);
  const [head, body] = renderExtraDetail(x, { close: closeDetail, user: state.user });
  mountDetail(head, body);
  if (state.map && fly) state.map.reveal(x, { zoom: 16, inset: detailInset() });
  hidePeek();
  setSelHash('x', id);
  announce(`${x.name || 'Eintrag'} ausgewählt`);
  return true;
}

// Adresse: Bereich („#liste“, „#favoriten“) und/oder Auswahl („p=…“, „g=…“, „x=…“), verbunden mit „&“.
// Bereichswechsel legen einen Verlaufseintrag an (Zurück-Taste), Auswahl ersetzt nur den aktuellen.
const VIEWS = ['karte', 'liste', 'favoriten'];
let selHash = null, appliedHash = null;

function readHash() {
  const out = { view: null, sel: null, melden: false };
  for (const part of location.hash.replace(/^#/, '').split('&').filter(Boolean)) {
    if (VIEWS.includes(part)) out.view = part;
    else if (part === 'melden') out.melden = true;
    else {
      const m = part.match(/^([pgx])=(.+)$/);
      if (m) { try { out.sel = { k: m[1], id: decodeURIComponent(m[2]) }; } catch { /* ungültig */ } }
    }
  }
  return out;
}

function hashString() {
  const parts = [];
  if (state.view !== 'karte') parts.push(state.view);
  if (selHash) parts.push(`${selHash.k}=${encodeURIComponent(selHash.id)}`);
  return parts.length ? '#' + parts.join('&') : '';
}

function writeHash(push = false) {
  appliedHash = hashString();
  const url = location.pathname + location.search + appliedHash;
  if (push) history.pushState(null, '', url); else history.replaceState(null, '', url);
}

function setSelHash(k, id) { selHash = k ? { k, id } : null; writeHash(false); }

/** Bereich wechseln (Karte, Liste, Favoriten). push: neuer Eintrag für die Zurück-Taste. */
function setView(view, { push = true } = {}) {
  if (!VIEWS.includes(view)) view = 'karte';
  const changed = view !== state.view;
  state.view = view;
  if (view !== 'karte') { state.tab = view === 'favoriten' ? 'fav' : 'list'; renderList(); }
  document.body.classList.toggle('list-open', view !== 'karte');
  $('#list-title').textContent = view === 'favoriten' ? 'Favoriten' : 'Liste';
  if (view !== 'karte' && isMobile()) { hidePeek(); closeDetailPanel(); }
  nav?.setActive(view);
  $('#cat-hint').hidden = !(state.places.length && !state.cats.size) || view !== 'karte';
  if (changed) writeHash(push);
  setTimeout(() => state.map?.invalidate(), 0);
}

/** Navigation: Karte/Liste/Favoriten ohne Neuladen; Melden öffnet die Auswahl; Pegel ist eine eigene Seite. */
function onNav(id, e) {
  if (id === 'melden') { if (!reportPop.isOpen) renderReportMenu({ fragen: true }); reportPop.toggle(e.currentTarget); return true; }
  if (VIEWS.includes(id)) { setView(id); return true; }
  return false;
}

function handleHash({ initial = false } = {}) {
  if (!initial && location.hash === appliedHash) return;
  const { view, sel, melden } = readHash();
  setView(view || 'karte', { push: false });
  if (melden) setTimeout(() => { renderReportMenu({ fragen: true }); reportPop.open($(isMobile() ? '#bottomnav [data-nav="melden"]' : '#btn-report')); }, 0);
  selHash = sel;
  writeHash(false);
  if (!sel) {
    if (!initial && (state.selectedId || state.gaugeId || state.extraId || state.peekId)) closeDetail();
    return;
  }
  const { k, id } = sel;
  if (k === 'x' && hasExtras()) {
    extrasList().then(() => { if (!selectExtra(id)) toast('Dieser Eintrag wurde nicht gefunden.'); }, () => toast('Die Zusatzdaten konnten nicht geladen werden.'));
    return;
  }
  if (k === 'g' && state.mapOk) {
    (state.gaugesOn && state.gauges ? Promise.resolve() : setGauges(true))
      .then(() => { if (state.gauges && !selectGauge(id)) toast('Dieser Pegel wurde nicht gefunden.'); });
    return;
  }
  if (k === 'p' && id !== state.selectedId && !selectPlace(id, { updateHash: false }) && state.places.length) toast('Dieser Standort ist nicht mehr in der Datenbank.');
}
window.addEventListener('popstate', () => handleHash());

window.addEventListener('hashchange', () => handleHash());

// ============================================================ Standort des Nutzers
function requestUserPos() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) { reject(new Error('Dein Gerät unterstützt keine Standortbestimmung.')); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => reject(new Error(err.code === 1 ? 'Standortfreigabe verweigert. Du kannst die Karte trotzdem vollständig nutzen oder die Freigabe in den Browser-Einstellungen ändern.'
        : err.code === 3 ? 'Die Standortbestimmung hat zu lange gedauert. Bitte erneut versuchen.' : 'Standort nicht verfügbar.')),
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 });
  });
}

async function locate({ fly = true } = {}) {
  const btn = $('#btn-locate');
  btn.classList.add('is-busy');
  try {
    const pos = await requestUserPos();
    state.user = pos;
    if (state.map) { state.map.showUser(pos.lat, pos.lon, pos.accuracy); if (fly) state.map.flyTo(pos.lat, pos.lon, 11); }
    renderList();
    if (state.peekId) showPeek(state.byId.get(state.peekId));
    else if (state.selectedId) showDetail(state.byId.get(state.selectedId));
    announce('Karte auf deinen Standort ausgerichtet');
    return pos;
  } catch (e) { toast(e.message); throw e; }
  finally { btn.classList.remove('is-busy'); }
}

function offerLocation() {
  if (!('geolocation' in navigator) || prefs.get('geoAsked') || !state.mapOk) return;
  const card = h('div', { class: 'consent', role: 'region', 'aria-label': 'Standort verwenden' },
    h('p', {}, h('strong', { text: 'Karte auf deinen Standort ausrichten?' }), ' Dein Standort bleibt auf deinem Gerät und wird nicht gespeichert oder gesendet.'),
    h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn btn-primary small', text: 'Standort verwenden', onclick: () => { prefs.set('geoAsked', '1'); card.remove(); locate().catch(() => {}); } }),
      h('button', { type: 'button', class: 'btn btn-outline small', text: 'Nein danke', onclick: () => { prefs.set('geoAsked', '1'); card.remove(); } })));
  el.banner.append(card);
}

// ============================================================ Meldungen (Formulare)
function nearestSlips(lat, lon, radius) {
  let best = null;
  for (const p of state.places) {
    if (p.type !== 'slip') continue;
    const d = haversine(lat, lon, p.lat, p.lon);
    if (d <= radius && (!best || d < best.distance)) best = { place: p, distance: d };
  }
  return best;
}

function pickLocation(initial) {
  if (!state.mapOk) { toast('Die Karte ist nicht verfügbar. Nutze „Meine Position“.'); return Promise.resolve(null); }
  if (state.placePick) endPlacePick();
  const bar = clear(el.pickbar);
  const confirm = h('button', { type: 'button', class: 'btn btn-primary small', text: 'Standort übernehmen', disabled: !initial });
  const cancel = h('button', { type: 'button', class: 'btn btn-outline small', text: 'Abbrechen' });
  bar.append(h('p', { text: 'Tippe auf die Karte, wo die Rampe ins Wasser führt. Zoome vorher nah heran.' }), h('div', { class: 'btn-row' }, cancel, confirm));
  el.pickbar.hidden = false;
  document.body.classList.add('is-picking');
  if (el.detail && !el.detail.hidden) el.detail.hidden = true;
  const promise = state.map.pickLocation(initial);
  const api = state.map.pickApi;
  api.onPick = () => { confirm.disabled = false; };
  confirm.onclick = () => api.confirm();
  cancel.onclick = () => api.cancel();
  return promise.finally(() => {
    el.pickbar.hidden = true; document.body.classList.remove('is-picking');
    if (state.selectedId) el.detail.hidden = false;
  });
}

// Menü → Meldung zu einem Standort: statt einer Auswahlliste den Standort auf der Karte (oder über die Suche) antippen
const PLACE_PICK = {
  'lage-melden': { text: 'Tippe auf der Karte auf den Standort, an dem du gerade bist.' },
  'foto-einreichen': { text: 'Tippe auf der Karte auf die Slipanlage, Marina oder Tankstelle, zu der das Foto gehört.' },
  'fehler-melden': { text: 'Tippe auf der Karte auf den Standort, zu dem du etwas melden möchtest.', general: true },
  'tankpreis-melden': { text: 'Tippe auf der Karte auf die Bootstankstelle.', type: 'fuel' },
};

function choosePlaceFor(formName, preset = {}) {
  const cfg = PLACE_PICK[formName];
  if (el.dlg?.open) el.dlg.close();
  closeMenu();
  if (state.view !== 'karte') setView('karte');
  const bar = clear(el.pickbar);
  const cancel = h('button', { type: 'button', class: 'btn btn-outline small', text: 'Abbrechen', onclick: endPlacePick });
  const general = cfg.general ? h('button', { type: 'button', class: 'btn btn-outline small', text: 'Ohne Standort melden',
    onclick: () => { endPlacePick(); openReport(formName, { ...preset, standort_id: '__other', art: 'sonstiges' }); } }) : null;
  bar.append(h('p', { text: `${cfg.text} Du kannst den Ort auch oben suchen.` }), h('div', { class: 'btn-row' }, cancel, general));
  el.pickbar.hidden = false;
  document.body.classList.add('is-choosing');
  state.placePick = { formName, type: cfg.type || null, preset };
}

function endPlacePick() {
  state.placePick = null;
  el.pickbar.hidden = true;
  document.body.classList.remove('is-choosing');
}

function openReport(formName, preset = {}) {
  const ctx = {
    dialog: el.dlg, places: state.places,
    requestUserPos, pickLocation, nearestSlips,
    showPlace: (id) => selectPlace(id),
    choosePlace: (name, carry = {}) => choosePlaceFor(name, carry),
  };
  const p = preset.standort_id && state.byId.get(preset.standort_id);
  if (p && formName === 'tankpreis-melden') preset.standort_id = p.id;
  if (formName === 'slipanlage-melden' && !preset.lat && state.user) { /* Position wird nur auf Wunsch übernommen */ }
  closeMenu();
  if (formName === 'lage-melden') { const pl = state.byId.get(preset.standort_id); if (pl) lageMelden(pl); return; }
  openForm(formName, ctx, preset);
}

// ============================================================ Suche
let suggestItems = [], suggestIdx = -1, geoCtrl = null;

function renderSuggest(local, extra) {
  const ul = clear(el.suggest);
  suggestItems = [];
  const q = el.q.value.trim();
  if (!q) { el.suggest.hidden = true; return; }
  const add = (node, run) => { suggestItems.push(run); ul.append(h('li', { role: 'option', id: `sg-${suggestItems.length - 1}`, 'aria-selected': 'false' }, node)); };
  for (const p of local) {
    add(h('button', { type: 'button', class: 'sg', tabindex: '-1' },
      h('span', { class: `place-ico small bg-${p.type}`, html: glyphSvg(p.type, 18) }),
      h('span', { class: 'place-text' }, h('span', { class: 'place-name', text: displayName(p) }), h('span', { class: 'place-sub', text: [TYPES[p.type].label, subtitle(p)].filter(Boolean).join(' · ') }))),
      () => { endSearch(); selectPlace(p.id); });
  }
  for (const g of extra.results || []) {
    add(h('button', { type: 'button', class: 'sg', tabindex: '-1' }, h('span', { class: 'sg-ico', html: icon('pin', 18) }), h('span', { class: 'place-text' }, h('span', { class: 'place-name', text: g.name }), h('span', { class: 'place-sub', text: 'Ort' }))), () => { endSearch(); goToGeo(g); });
  }
  if (q.length >= 2 && !extra.results) {
    add(h('button', { type: 'button', class: 'sg', tabindex: '-1' }, h('span', { class: 'sg-ico', html: icon('search', 18) }), h('span', { class: 'place-text' }, h('span', { class: 'place-name', text: `Ort „${q}“ suchen` }), h('span', { class: 'place-sub', text: 'Städte, Orte, Gewässer' }))), () => runGeocode(q));
  }
  if (extra.message) ul.append(h('li', { class: 'sg-msg', text: extra.message }));
  el.suggest.hidden = !ul.children.length;
  el.q.setAttribute('aria-expanded', String(!el.suggest.hidden));
  suggestIdx = -1;
}

function endSearch() { el.suggest.hidden = true; el.q.setAttribute('aria-expanded', 'false'); el.q.blur(); }

function goToGeo(g) {
  if (!state.map) { toast('Die Karte ist nicht verfügbar.'); return; }
  if (g.bbox && g.bbox.length === 4 && g.bbox.every(Number.isFinite)) state.map.fitBounds([[g.bbox[0], g.bbox[2]], [g.bbox[1], g.bbox[3]]], { maxZoom: 13 });
  else state.map.flyTo(g.lat, g.lon, 12);
  closeDetail();
}

async function runGeocode(q, { auto = false } = {}) {
  if (geoCtrl) geoCtrl.abort();
  geoCtrl = new AbortController();
  renderSuggest(searchLocal(state.index, q), { message: 'Suche läuft …' });
  try {
    const results = await geocode(q, { signal: geoCtrl.signal });
    if (!results.length) { renderSuggest(searchLocal(state.index, q), { message: 'Nichts gefunden. Prüfe die Schreibweise oder suche einen größeren Ort.' }); return; }
    if (auto) { endSearch(); goToGeo(results[0]); return; }
    renderSuggest(searchLocal(state.index, q), { results });
  } catch (e) {
    if (e.name === 'AbortError') return;
    renderSuggest(searchLocal(state.index, q), { message: navigator.onLine ? 'Die Ortssuche ist gerade nicht erreichbar. Standorte findest du weiterhin über den Namen.' : 'Du bist offline. Die Ortssuche braucht eine Verbindung.' });
  }
}

function wireSearch() {
  el.q.addEventListener('input', debounce(() => {
    const q = el.q.value.trim();
    if (geoCtrl) geoCtrl.abort();
    renderSuggest(q ? searchLocal(state.index, q) : [], {});
  }, 100));
  el.q.addEventListener('focus', () => { if (el.q.value.trim()) renderSuggest(searchLocal(state.index, el.q.value.trim()), {}); });
  el.q.addEventListener('keydown', (e) => {
    const n = suggestItems.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!n) return; e.preventDefault();
      suggestIdx = (suggestIdx + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
      $$('#suggest [role=option]').forEach((li, i) => { li.setAttribute('aria-selected', String(i === suggestIdx)); li.classList.toggle('is-active', i === suggestIdx); });
      el.q.setAttribute('aria-activedescendant', `sg-${suggestIdx}`);
    } else if (e.key === 'Escape') { el.suggest.hidden = true; }
  });
  $('#search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = el.q.value.trim();
    if (!q) return;
    if (suggestIdx >= 0 && suggestItems[suggestIdx]) { suggestItems[suggestIdx](); return; }
    const local = searchLocal(state.index, q);
    const exact = local.find(p => displayName(p).toLowerCase() === q.toLowerCase());
    if (exact) { endSearch(); selectPlace(exact.id); return; }
    runGeocode(q, { auto: true });
  });
  el.suggest.addEventListener('click', (e) => {
    const li = e.target.closest('[role=option]');
    if (li) suggestItems[Number(li.id.slice(3))]?.();
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.search')) { el.suggest.hidden = true; } });
}

// ============================================================ Melden
function closeMenu() { reportPop?.close(); }

const LAGE_NEU_BIS = Date.parse('2026-11-22T00:00:00Z');   // Etikett „NEU“ 30 Tage nach Einführung
const LAGE_RADIUS_M = 300;

/** Nächster Standort (alle Kategorien) im Umkreis von 300 m. */
function standortInDerNaehe(pos) {
  let best = null;
  for (const p of state.places) {
    const d = haversine(pos.lat, pos.lon, p.lat, p.lon);
    if (d <= LAGE_RADIUS_M && (!best || d < best.d)) best = { p, d };
  }
  return best;
}

/**
 * „Was möchtest du melden?“ – oben „Lage vor Ort melden“ (mit Standortvorschlag), darunter die vier Meldungen und die Links.
 * fragen: Position jetzt abfragen (nur beim Öffnen durch den Nutzer, nie im Hintergrund).
 */
function renderReportMenu({ fragen = false } = {}) {
  const body = clear($('#report-body'));
  const item = (ico, cls, label, run) => h('li', {}, h('button', { type: 'button', class: 'menu-item rm-item', onclick: () => { closeMenu(); run(); } },
    h('span', { class: `menu-ico rm-ico ${cls}`, html: icon(ico, 22) }), h('strong', { text: label }), h('span', { class: 'rm-chev', html: icon('chevron', 18), 'aria-hidden': 'true' })));
  const offline = navigator.onLine === false;
  const frage = h('div', { class: 'lage-frage', hidden: true });
  const lageBtn = h('button', { type: 'button', class: 'lage-main', disabled: offline, onclick: () => { closeMenu(); choosePlaceFor('lage-melden'); } },
    h('span', { class: 'lage-ico', html: icon('pin', 24) }),
    h('span', { class: 'lage-text' }, h('strong', { text: 'Lage vor Ort melden' }), h('small', { text: offline ? 'Offline – gerade nicht möglich' : 'Parkplatz, Wartezeit, Rampe, Sperrung' })),
    Date.now() < LAGE_NEU_BIS ? h('span', { class: 'lage-neu', text: 'NEU' }) : null);
  body.append(
    h('h2', { id: 'report-title', text: 'Was möchtest du melden?' }),
    h('div', { class: 'lage-karte' }, lageBtn, frage),
    h('ul', { class: 'menu-list rmenu' },
      item('plus', 'rm-slip', 'Neue Slipanlage melden', () => openReport('slipanlage-melden')),
      item('pump', 'rm-fuel', 'Kraftstoffpreis melden', () => choosePlaceFor('tankpreis-melden')),
      item('camera', 'rm-foto', 'Foto einreichen', () => choosePlaceFor('foto-einreichen')),
      item('flag', 'rm-fehler', 'Fehler oder Hinweis melden', () => choosePlaceFor('fehler-melden', { art: 'sonstiges' }))),
    h('p', { class: 'rmenu-links' },
      h('a', { href: './ueber.html', text: 'Über WaterMap' }), ' · ', h('a', { href: './datenschutz.html', text: 'Datenschutz' }), ' · ', h('a', { href: './impressum.html', text: 'Impressum' })),
    h('p', { class: 'muted small rm-version', text: `Version ${CONFIG.VERSION}` }));
  if (!fragen || offline || !('geolocation' in navigator)) return;
  // Position nur jetzt (Nutzer hat „Melden“ geöffnet); abgelehnt → still bei der Standortauswahl bleiben
  requestUserPos().then((pos) => {
    state.user = pos;
    const near = standortInDerNaehe(pos);
    if (!near || !reportPop.isOpen) return;
    const { p, d } = near;
    frage.replaceChildren(
      h('p', {}, 'Bist du an der ', h('strong', { text: displayName(p) }), p.water?.name ? `, ${p.water.name}?` : '?', h('span', { class: 'lage-dist', text: ` · ${formatDistance(d)} entfernt` })),
      h('div', { class: 'lage-knoepfe' },
        h('button', { type: 'button', class: 'lage-ja', text: 'Ja, hier bin ich', onclick: () => { closeMenu(); lageMelden(p, { distance: d, zurueck: true }); } }),
        h('button', { type: 'button', class: 'lage-anders', text: 'Anderer Standort', onclick: () => { closeMenu(); choosePlaceFor('lage-melden'); } })));
    frage.hidden = false;
  }).catch(() => { /* ohne Position: Eintrag startet die Standortauswahl */ });
}

// ============================================================ Tabs, Sheet, Hilfen
function updateTabs() { nav?.updateFavs(); }

/** Liste/Favoriten öffnen oder schließen (für ältere Aufrufe und Tests). */
function setListOpen(open, tab) {
  setView(open ? (tab === 'fav' ? 'favoriten' : 'liste') : 'karte');
}

let toastTimer;
function toast(text) {
  const t = $('#toast');
  t.textContent = text; t.hidden = false; announce(text);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 5200);
}

function updateOnline(e) {
  $('#offline').hidden = navigator.onLine;
  if (e && e.type === 'offline') toast('Du bist offline. Standortdaten bleiben verfügbar, Karten nur für bereits angesehene Bereiche.');
}

function wireStatic() {
  wireSearch();
  renderReportMenu();
  $('#btn-report').addEventListener('click', (e) => { if (!reportPop.isOpen) renderReportMenu({ fragen: true }); reportPop.toggle(e.currentTarget); });
  $('#btn-filter').addEventListener('click', (e) => { if (!filterPop.isOpen) renderFilterPanel(); filterPop.toggle(e.currentTarget); });
  $('#dlg-close').addEventListener('click', () => el.dlg.close());
  el.dlg.addEventListener('click', (e) => { if (e.target === el.dlg) el.dlg.close(); });
  $('#btn-locate').addEventListener('click', () => locate().catch(() => {}));
  $('#list-close').addEventListener('click', () => setView('karte'));
  swipeToClose(el.peek, closeDetail, () => !!state.peekId);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || el.dlg.open || filterPop.isOpen || reportPop.isOpen || $('dialog.lightbox[open]') || el.suggest.offsetParent) return;
    if (state.selectedId || state.gaugeId || state.extraId || state.peekId) closeDetail();
  });
  window.addEventListener('resize', debounce(() => state.map?.invalidate(), 150));
  window.addEventListener('online', updateOnline); window.addEventListener('offline', updateOnline);
  updateOnline();
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
  navigator.serviceWorker.register('./sw.js').catch(() => { /* PWA ist optional */ });
}

init().catch((e) => {
  console.error(e);
  clear(el.list).append(h('li', { class: 'empty' }, h('p', { class: 'empty-title', text: 'Beim Start ist ein Fehler aufgetreten.' }), h('button', { class: 'btn btn-primary', type: 'button', text: 'Seite neu laden', onclick: () => location.reload() })));
});

// Für Tests und Fehlersuche in der Browser-Konsole
window.__watermap = { state, selectPlace, applyFilters, toggleCat, setListOpen, setView, setGauges, selectGauge, setExtras, selectExtra };

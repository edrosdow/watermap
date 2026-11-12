import { CONFIG } from './config.js';
import { h, $, $$, clear, debounce, announce } from './dom.js';
import { icon, logoSvg } from './icons.js';
import { TYPES, TYPE_KEYS, FILTERS, filterCounts, displayName, haversine, formatDistance, formatDate } from './model.js';
import { loadAll } from './data.js';
import { loadMapLibraries, createMap } from './map.js';
import { buildIndex } from './search.js';
import { favorites, prefs } from './favorites.js';
import { openForm } from './forms.js';
import { renderDetail } from './detail.js';
import { mountNav, popover } from './nav.js';
import { wischenZuMachen } from './wischen.js';
import { suchfelderMitX } from './suchfeld.js';
import { ampel as bootAmpel, mindestAlle } from './mindestpegel.js';
import { alarmFenster } from './alarm.js';
import { aktivLaden, ausgeblendetAnzahl, ausgeblendetZuruecksetzen, gesehenSetzen, listeLaden, neueAnzahl, standortLaden, statusZeile, vorOrtKarte, zusammenfassen } from './meldungen.js';
import { openLageForm } from './lage-form.js';
import { naehe, geoFreigabe } from './naehe.js';
import { gruppieren, gruppeZu, naechsterPegel } from './pegel-fluss.js';
import { flussSeite } from './pegel-fluss-ansicht.js';
import { istTidepegel } from './gezeiten.js';
import { pegelLaden, pegelStand, verlaufLaden, meinePegel } from './pegel-daten.js';
import { pegelDetail, fmt as pegelFmt, zustand as pegelZustand, ZUSTAND as PEGEL_ZUSTAND } from './pegel-ansicht.js';
import { LEGENDE } from './pegel-marker.js';
import { mehrInhalt } from './mehr.js';
import { gemerkt as gemerktZeichnen, gemerktFrisch } from './gemerkt.js';
import { einstellungenSeite, EINSTELLUNGEN_KOPF, profilZeile, startArt, startArtSetzen, ansichtLesen, ansichtSchreiben, allesLoeschen } from './einstellungen.js';
import { meldungenSeite } from './meldungen-uebersicht.js';
import { unpassendMelden } from './meldung-unpassend.js';
import { slipErgaenzen } from './slip-ergaenzen.js';
import { imGebiet, gebietLaden } from './gebiet.js';
import { sheetOeffnen, offeneSheets, kopf, marke, zeile, gruppe } from './bausteine.js';
import { staffeln, merkFlug, sternPop, markerPlopp, hakenSvg } from './bewegung.js';
import { pegelSheet, slipsAmPegel } from './pegel-sheet.js';
import { weatherSection, wetterZeile } from './wetter.js';
import { GROUPS, loadExtras, renderExtraDetail } from './extras.js';
import { enrichFacts } from './hafeninfo.js';
import { sucheEinrichten } from './suche-ui.js';
import { meldenEinrichten } from './melden-menue.js';

const state = {
  places: [], byId: new Map(), index: [], meta: null, issues: [], invalid: 0,
  cats: new Set(), subs: new Set(), tab: 'list',   // cats: sichtbare Kategorien (Start: keine – der Nutzer wählt)
  view: 'karte',                     // view: karte | naehe | gemerkt | meldungen | mehr (steht in der Adresse; außer Karte je ein Sheet)
  mehrSeite: null,                                                                   // „Mehr“: null | 'einstellungen' (Sheet über „Mehr“)
  meld: new Map(), meldOffline: false, meldOnly: false,   // „Heute vor Ort“: Standort-ID → { n, typ }
  selectedId: null, user: null,
  map: null, mapOk: false,
  filtered: [], loadFailed: false,
  gaugesOn: false, gauges: null, gaugeById: new Map(), gaugeId: null, gaugeTimer: null,
  extrasOn: { wasser: false, service: false }, extras: null, extraById: new Map(), extraId: null,
};

const el = {
  // „In der Nähe“: Kopfbereich, Zählzeile, Liste und Datenstand – werden beim Öffnen in das Sheet gehängt (Designumbau 3a)
  naeheKopf: h('div', { id: 'naehe-steuer', class: 'nh-steuer' }), listHead: h('div', { id: 'list-head', class: 'list-head' }),
  list: h('ul', { id: 'list', class: 'list wm-gruppe', 'aria-live': 'polite' }), datainfo: h('div', { id: 'datainfo', class: 'datainfo' }),
  toolbar: $('#toolbar'), mapEl: $('#map'), dlg: $('#dlg'),
  q: $('#q'), suggest: $('#suggest'), banner: $('#banner'), pickbar: $('#pickbar'),
};

const isMobile = () => window.matchMedia('(max-width: 767px)').matches;
const CAT_LABEL = { slip: 'Slipanlagen', marina: 'Häfen', fuel: 'Tanken' };
const CAT_SHORT = { slip: 'Slip', marina: 'Häfen', fuel: 'Tanken' };
const CAT_PLURAL = { slip: 'Slipanlagen', marina: 'Häfen', fuel: 'Tankstellen' };
const fmtN = (n) => n.toLocaleString('de-DE');
let nav, filterPop, reportPop, nah;

// ============================================================ Start
async function init() {
  $('#brand-logo').innerHTML = logoSvg(38);
  $('#btn-search-ico').innerHTML = `<span class="i-lupe">${icon('search', 20)}</span><span class="i-x">${icon('close', 20)}</span>`;
  $('#btn-report-ico').innerHTML = icon('plus', 20);
  $('#btn-filter-ico').innerHTML = icon('filter', 20);
  $('#btn-locate').innerHTML = icon('locate', 22);
  $('#btn-naehe-d-ico').innerHTML = icon('pin', 18);
  $('#btn-naehe-m-ico').innerHTML = icon('pin', 20);
  if (isMobile()) el.q.placeholder = 'Ort, Gewässer oder Standort';
  state.cats = new Set((prefs.get('cats') || '').split(',').filter(t => TYPE_KEYS.includes(t)));
  if (!state.cats.size) state.cats.add('slip');   // mindestens eine Kategorie ist immer aktiv
  nav = mountNav({ top: $('#topnav'), bottom: $('#bottomnav'), active: 'karte', onSelect: onNav });
  filterPop = popover($('#filter-panel'), { isMobile });
  melden = meldenEinrichten({ state, choosePlaceFor, lageMelden, meldLokal, openReport, requestUserPos, showDetail, toast, standortOffen: () => !!standort });
  reportPop = melden.reportPop;
  renderSkeleton();
  wireStatic();
  nah = naehe(naeheCtx());
  nah.binden({ kopf: el.naeheKopf, head: el.listHead, ul: el.list, aktiv: () => state.view === 'naehe' && !state.loadFailed && state.places.length > 0 });
  gemerktBadge();

  const [libs, , data] = await Promise.all([
    loadMapLibraries().catch(() => ({ leaflet: false })),
    gebietLaden().catch(() => null),   // Kartengebiet (Grenze für Maske, Kacheln, Suche)
    loadAll().then(d => ({ ok: true, d }), err => ({ ok: false, err })),
  ]);

  if (libs.leaflet) {
    state.map = createMap(el.mapEl, {
      useCluster: libs.cluster,
      onMoveEnd: debounce(() => { renderList(); updateInview(); ansichtMerken(); }, 180),
      onMapClick: () => { if (state.view === 'naehe' && isMobile()) { setView('karte'); return; } if (state.selectedId || state.gaugeId || state.extraId) closeDetail(); },
      onMarkerClick: (id) => selectPlace(id),
      onAusserhalb: () => toast(CONFIG.GEBIET.hinweis),
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
  if (state.loadFailed) setView('naehe', { push: false });   // Fehlermeldung mit „Erneut laden“ steht in der Liste
  registerServiceWorker();
  meldAktualisieren();
  vorbereiten();
  setInterval(() => { if (document.visibilityState === 'visible') meldAktualisieren(); }, 2 * 60e3);
  window.addEventListener('online', () => meldAktualisieren(true));
}

// ============================================================ Heute vor Ort (Lagemeldungen)
async function meldAktualisieren(force = false) {
  const r = await aktivLaden({ force });
  meldSetzen(r.map, r.offline);
  meldBadge(force);
}

/** Zahl am Navigationspunkt „Meldungen“: Meldungen, die seit dem letzten Besuch der Übersicht dazugekommen sind (nicht eigene). */
async function meldBadge(force = false) {
  if (!nav) return;
  if (state.view === 'meldungen') { nav.setBadge('meldungen', 0); return; }
  try {
    const d = await listeLaden({ force });
    if (d.offline && d.unbekannt) return;   // nichts bekannt: keine Zahl behaupten
    nav.setBadge('meldungen', state.view === 'meldungen' ? 0 : neueAnzahl(d.meldungen));
  } catch { /* ohne Zahl */ }
}

function meldSetzen(map, offline = state.meldOffline) {
  state.meld = map; state.meldOffline = offline;
  state.map?.setMeldungen(map);
  if (state.meldOnly) applyFilters(); else { renderFilterbar(); if (state.view === 'naehe') renderList(); }   // Etiketten in der Liste
  if (state.view === 'meldungen') meldSeite?.zeigen();
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
  if (info?.n === alt?.n && info?.typ === alt?.typ && info?.at === alt?.at) return;
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
      if (state.selectedId === p.id && standort) showDetail(p, { scrollTo: 'vor-ort' });
    },
  });
}

function ingest({ places, meta, issues, invalid }) {
  state.places = places; state.meta = meta; state.issues = issues; state.invalid = invalid;
  state.byId = new Map(places.map(p => [p.id, p]));
  state.index = buildIndex(places);
  gemerktBadge();   // gemerkte Orte, die es nicht mehr gibt, zählen nicht
}

function startView() {
  const m = state.map;
  // Einstellung „Ausschnitt“: letzte Ansicht oder eigene Position (nur mit bestehender Freigabe, kein Browser-Dialog beim Start)
  const art = startArt(), ansicht = art === 'letzte' ? ansichtLesen() : null;
  if (ansicht && imGebiet(ansicht.lat, ansicht.lon)) { m.setView({ center: [ansicht.lat, ansicht.lon], zoom: ansicht.zoom }); return; }
  if (art === 'position') geoFreigabe.pruefen().then(f => { if (f === 'granted') locate().catch(() => {}); });
  if (CONFIG.START_MODE === 'germany') { m.zeigeGebiet(); return; }
  if (!state.places.length) { m.setView(CONFIG.FALLBACK_VIEW); return; }
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

/** Sichtbare Ebenen auf der Karte: Kategorien und Pegel. Mindestens eine bleibt beim Ausschalten (Designumbau 2a). */
const aktiveEbenen = () => state.cats.size + (state.gaugesOn ? 1 : 0);
const EINE_EBENE = 'Mindestens eine Ebene bleibt sichtbar.';

function toggleCat(type, on = !state.cats.has(type)) {
  if (!on && state.cats.has(type) && aktiveEbenen() === 1) { toast(EINE_EBENE); return; }
  if (on) state.cats.add(type); else state.cats.delete(type);
  state.subs.clear();
  prefs.set('cats', [...state.cats].join(','));
  applyFilters();
  if (on) requestAnimationFrame(() => markerPlopp(el.mapEl, '.wm-pin, .wm-cluster'));   // Designumbau 4: Marker ploppen ein
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
  chipsSetzen([...TYPE_KEYS.map(t => {
    const on = state.cats.has(t);
    return h('button', { type: 'button', class: `cat cat-${t}`, 'aria-pressed': String(on), dataset: { cat: t },
      title: on ? `${TYPES[t].plural} ausblenden` : `${TYPES[t].plural} auf der Karte zeigen`, onclick: () => toggleCat(t) },
      h('span', { class: 'cat-check', html: icon('check', 16), 'aria-hidden': 'true' }), h('span', { class: 'cat-punkt', 'aria-hidden': 'true' }),
      h('span', { class: 'cat-label cat-label-long', text: CAT_LABEL[t] }), h('span', { class: 'cat-label cat-label-short', text: CAT_SHORT[t] }), state.places.length ? h('span', { class: 'cat-n', text: fmtN(counts[t]) }) : null);
  }), state.mapOk ? pegelChip() : null].filter(Boolean));
  pegelLegendeZeigen();
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

/** Chips der Werkzeugleiste setzen: vorhandene Knöpfe werden nur aktualisiert (Zustand, Titel, Zahl), damit Punkt und Häkchen
 *  beim Umschalten gleiten (Designumbau 4); neu aufgebaut wird nur, wenn sich die Reihe ändert. */
function chipsSetzen(neu) {
  const box = $('#cats'), alt = [...box.children];
  if (alt.length !== neu.length || alt.some((a, i) => a.dataset.cat !== neu[i].dataset.cat)) { box.replaceChildren(...neu); return; }
  alt.forEach((a, i) => {
    const n = neu[i];
    a.setAttribute('aria-pressed', n.getAttribute('aria-pressed')); a.title = n.title;
    const zn = n.querySelector('.cat-n'), za = a.querySelector('.cat-n');
    if (zn && za) za.textContent = zn.textContent; else if (zn) a.append(zn); else za?.remove();
  });
}

/** Chip „Pegel“ (Designumbau 2a): schaltet die Pegel-Ebene der Hauptkarte. */
function pegelChip() {
  const on = state.gaugesOn;
  return h('button', { type: 'button', class: 'cat cat-pegel', 'aria-pressed': String(on), dataset: { cat: 'pegel' },
    title: on ? 'Pegel ausblenden' : 'Pegel auf der Karte zeigen',
    onclick: () => { if (state.gaugesOn && aktiveEbenen() === 1) { toast(EINE_EBENE); return; } setGauges(!state.gaugesOn); } },
    h('span', { class: 'cat-check', html: icon('check', 16), 'aria-hidden': 'true' }), h('span', { class: 'cat-punkt', 'aria-hidden': 'true' }),
    h('span', { class: 'cat-label', text: 'Pegel' }), on && state.gauges ? h('span', { class: 'cat-n', text: fmtN(state.gauges.length) }) : null);
}

/** Legende der Pegel-Farben: kleine aufklappbare Pille unten links, nur bei eingeschaltetem Chip „Pegel“. */
function pegelLegendeZeigen() {
  const box = $('#pk-legende');
  if (!box) return;
  if (!box.childElementCount) box.append(h('summary', { text: 'Legende' }),
    h('ul', {}, LEGENDE.map(([t, f]) => h('li', {}, h('i', { style: `background:${f}`, 'aria-hidden': 'true' }), t))));
  box.hidden = !state.gaugesOn;
  if (!state.gaugesOn) box.open = false;
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
  const b = state.map.getBounds();
  if (!state.cats.size) {
    if (!state.gaugesOn || !state.gauges) { box.textContent = state.gaugesOn ? '' : 'Keine Kategorie gewählt'; return; }
    const n = state.gauges.filter(g => g.lat >= b.south && g.lat <= b.north && g.lon >= b.west && g.lon <= b.east).length;
    box.replaceChildren(h('strong', { text: fmtN(n) }), ' Pegel im Kartenausschnitt'); return;
  }
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
  if (state.mapOk && hasExtras()) {   // Pegel schaltet jetzt der Chip „Pegel“ (Designumbau 2a)
    const sec2 = h('section', { class: 'fsec' }, h('h3', { text: 'Auf der Karte zeigen' }));
    {
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

// ============================================================ In der Nähe / Favoriten
function naeheCtx() {
  return {
    places: () => state.filtered,
    allPlaces: () => state.places,
    user: () => state.user,
    setUser: (pos) => { state.user = pos; state.map?.showUser(pos.lat, pos.lon, pos.accuracy); },
    requestUserPos,
    mapCenter: () => (state.map ? state.map.getCenter() : null),
    isMobile,
    liste: () => (bereich?.view === 'naehe' ? bereich.sheet.inhalt : el.list),   // scrollt: das Sheet
    cats: () => state.cats,
    toggleCat: (t) => toggleCat(t),
    meld: () => state.meld,
    filterZahl: () => state.subs.size + (state.meldOnly ? 1 : 0),
    filterOeffnen: (btn) => { if (!filterPop.isOpen) renderFilterPanel(); filterPop.toggle(btn); },
    filterZuruecksetzen: () => { state.subs.clear(); state.meldOnly = false; applyFilters(); },
    // Tipp auf einen Standort: Sheet schließen, Karte mit dem Standort (Zurück führt wieder hierher)
    waehlen: (p) => { setView('karte'); selectPlace(p.id); },
    aufKarte: (liste) => {
      setView('karte');
      if (!state.map || !liste.length) return;
      setTimeout(() => { state.map.invalidate(); state.map.fitBounds(liste.map(p => [p.lat, p.lon]), { maxZoom: 14 }); }, 0);
    },
    leer: leereKategorie,
    dialog: el.dlg,
    toast,
  };
}

// ============================================================ Liste „In der Nähe“
function renderList() {
  if (state.loadFailed) { if (state.view === 'naehe') renderLoadError(); return; }
  if (state.places.length) { nah?.zeichnen(); return; }   // „In der Nähe“ zeichnet Kopf und Liste selbst
  clear(el.listHead);
  clear(el.list).append(h('li', { class: 'empty' }, h('p', { class: 'empty-title', text: 'Noch keine Standorte in der Datenbank' }), h('p', { class: 'muted', text: 'Du kannst trotzdem Slipanlagen melden. Sie erscheinen nach Prüfung.' })));
}

/** „In der Nähe“ leer, weil die eine gewählte Kategorie noch gar keine Daten hat: ehrlich sagen statt „nichts im Umkreis“. */
function leereKategorie() {
  const one = singleCat();
  if (!one || state.places.some(p => p.type === one)) return null;
  return h('li', { class: 'empty' }, h('p', { class: 'empty-title', text: `Noch keine ${TYPES[one].plural} in der Datenbank` }),
    h('p', { class: 'muted', text: 'Für diese Kategorie steht der Import aus OpenStreetMap noch aus. Es werden keine Standorte erfunden.' }),
    one === 'slip' ? h('button', { class: 'btn btn-outline', type: 'button', text: 'Slipanlage melden', onclick: () => openReport('slipanlage-melden') }) : null);
}

// ============================================================ Auswahl und Details
/** Freie Fläche der Karte neben bzw. über dem Standort-Sheet (für das Hinrücken). */
function detailInset() {
  const sh = standort?.sheet;
  if (isMobile()) {
    const klein = parseFloat(sh?.el.style.getPropertyValue('--wm-sheet-klein')) || window.innerHeight * 0.45;
    return sh?.stufe() === 'gross' ? { top: 120, bottom: window.innerHeight - 180 } : { top: 120, bottom: klein + 16 };
  }
  return { right: (sh?.el.offsetWidth || 420) + 24, top: 16 };
}

function selectPlace(id, { fly = true, updateHash = true, full = false } = {}) {
  const p = state.byId.get(id);
  if (!p) return false;
  const pick = state.placePick;
  if (pick && pick.type && p.type !== pick.type) { toast('Bitte eine Slipanlage antippen.'); return false; }
  if (state.view !== 'karte') setView('karte');   // ein offener Bereich (Sheet) würde den Standort verdecken – Zurück holt ihn wieder
  pegelZu();
  if (state.extraId) { state.extraId = null; state.map?.selectExtra(null); }
  if (!state.cats.has(p.type)) toggleCat(p.type, true);   // z. B. Link oder Suche: Kategorie des Standorts einblenden
  state.selectedId = id;
  if (state.map) { state.map.select(id); }
  // Standort-Sheet: Handy erst Stufe „klein“ (Kopf, Aktionen, „Details“), Desktop Panel rechts
  showDetail(p, { stufe: isMobile() && !full && !pick ? 'klein' : 'gross' });
  if (state.map && fly) setTimeout(() => state.map?.reveal(p, { zoom: 15, inset: detailInset() }), 60);   // nach dem Messen der Stufe „klein“
  if (updateHash) setSelHash('p', id);
  $$('.place', el.list).forEach(b => b.classList.toggle('is-selected', b.dataset.id === id));
  announce(`${displayName(p)} ausgewählt`);
  if (pick) { endPlacePick(); openReport(pick.formName, { ...pick.preset, standort_id: id }); }  // Auswahlmodus aus dem Menü
  return true;
}

function showDetail(p, { scrollTo = null, stufe = null } = {}) {
  const [kopf, body] = renderDetail(p, {
    user: state.user,
    enrichFacts: enrichFacts(state.meta, p.id),
    weather: p.type === 'slip' ? wetterZeile(p.lat, p.lon, { name: displayName(p) }) : weatherSection(p.lat, p.lon),   // Slipanlagen: Zeile + Fenster
    actions: {
      close: closeDetail,
      onFavorite: (e) => {
        const von = e?.currentTarget?.getBoundingClientRect(), dazu = !favorites.has(p.id), vorher = favorites.all();
        favorites.toggle(p.id); showDetail(p); renderList(); updateTabs(); state.map?.refresh(p.id);
        const knopf = standort?.sheet.inhalt.querySelector('.fav');
        if (dazu) { sternPop(knopf); merkFlug(von); }   // Designumbau 4
        else toast(`${displayName(p)} entfernt.`, { text: 'Rückgängig', onclick: () => { favorites.setzen(vorher); if (state.selectedId === p.id) showDetail(p); state.map?.refresh(p.id); } });
        knopf?.focus({ preventScroll: true });
      },
      share: () => shareLink(p),
      report: () => openReport('fehler-melden', { standort_id: p.id }),
      addPhoto: () => openReport('foto-einreichen', { standort_id: p.id }),
      reportPhoto: (ph) => openReport('fehler-melden', { standort_id: p.id, art: 'foto', details: `Foto unpassend: ${ph.url}\nGrund: ` }),
      ergaenzen: () => slipErgaenzen({ place: p, toast }),
      details: () => standort?.sheet.stufe('gross'),
    },
    pegel: pegelInfo(p).then(info => info && pegelBox(info)),
    vorOrt: p.type === 'slip' ? vorOrtTeile(p) : null,   // „Heute vor Ort“ nur bei Slipanlagen
  });
  standortZeigen({ kopf, body, key: 'p:' + p.id, stufe: scrollTo ? 'gross' : stufe });
  // Handy, Stufe „klein“: aktuelle Lagemeldung als Zeile über „Details“ (wie früher in der Vorschau-Karte); Tipp → „Heute vor Ort“
  if (p.type === 'slip' && state.meld.has(p.id)) standortLaden(p.id).then((d) => {
    if (state.selectedId !== p.id || !body.isConnected) return;
    const z = statusZeile(d.meldungen, { offline: d.offline, zeit: d.zeit, onOpen: () => showDetail(p, { scrollTo: 'vor-ort' }) });
    if (!z) return;
    z.classList.add('st-lage');
    body.querySelector('.st-details')?.before(z);
    standortKleinMessen();
  });
  if (scrollTo === 'vor-ort') setTimeout(() => {
    const sec = standort?.sheet.inhalt.querySelector('#heute-vor-ort');
    sec?.scrollIntoView({ block: 'start' }); sec?.focus({ preventScroll: true });
  }, 0);
}

/** Ist die (schon bekannte) Position höchstens VOR_ORT_RADIUS_M entfernt? Nie selbst nach der Position fragen. */
function istNah(p) {
  return !!state.user && haversine(state.user.lat, state.user.lon, p.lat, p.lon) <= CONFIG.VOR_ORT_RADIUS_M;
}

/** Karte „Heute vor Ort“ – frisch geladen beim Öffnen des Standorts. */
function vorOrtTeile(p) {
  const daten = standortLaden(p.id);
  daten.then(d => meldStandortGeladen(p.id, d));
  const section = vorOrtKarte({
    standortId: p.id, daten, nah: istNah(p), toast,
    onMehr: () => lageMelden(p),
    onGeaendert: (liste) => meldLokal(p.id, liste),
    onGesendet: (liste) => { meldLokal(p.id, liste); toast('Danke! Deine Meldung ist jetzt sichtbar.'); },
    onUnpassend: (m, fertig) => unpassendMelden({ meldung: m, ortName: displayName(p), toast, onFertig: fertig }),
    onAlle: () => setView('meldungen'),
  });
  return { zeile: null, section };
}

// ---- Pegel am selben Gewässer (nächster PEGELONLINE-Pegel, siehe naechsterPegel)
function allGauges() { return pegelLaden().then(st => st.gauges); }
// „Passt mein Boot?“ (Mindestpegel je Pegel, mindestpegel.js) → Klassen des Pegel-Kastens und des Etiketts in der Vorschau
const AMPEL_KLASSE = { gut: { box: 'is-gruen' }, warn: { box: 'is-warn' }, stop: { box: 'is-rot' } };
const pegelCache = new Map();
function pegelInfo(p) {
  if (!pegelCache.has(p.id)) pegelCache.set(p.id, allGauges().then(list => naechsterPegel(p, list)).catch(() => null));
  return pegelCache.get(p.id).then(best => (best ? { ...best, ampel: bootAmpel(best.g) } : null));   // Ampel immer frisch (Mindestpegel kann sich ändern)
}

function pegelBox({ g, d, ampel }) {
  const trend = { 1: 'steigend', 0: 'gleichbleibend', '-1': 'fallend' }[g.trend];
  const weit = d > 2000 ? `${formatDistance(d)} entfernt` : null;   // weiter weg: ehrlich dazusagen
  // Ortszeile (Bausteine, Designumbau 3b): öffnet die Pegel-Details als Sheet über dem Standort; neuer Tab bleibt möglich
  const a = h('a', { class: 'wm-zeile pegel-box ' + (ampel ? AMPEL_KLASSE[ampel.zustand].box : 'is-neutral'), href: `#karte/pegel/${encodeURIComponent(g.id)}`, 'aria-haspopup': 'dialog',
    onclick: (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return; e.preventDefault(); pegelFenster(g, e.currentTarget); } },
    h('span', { class: 'wm-kachel-ico', html: icon('gauge', 20), 'aria-hidden': 'true' }),
    h('span', { class: 'wm-zeile-text' }, h('strong', { text: `Pegel ${g.name}` }),
      h('small', { text: [ampel ? `Passt mein Boot? ${ampel.satz}` : [PEGEL_ZUSTAND[pegelZustand(g)]?.text, trend].filter(Boolean).join(' · '), weit].filter(Boolean).join(' · ') })),
    ampel ? marke(ampel.zustand, ampel.wort) : h('span', { class: 'wm-zeile-wert', text: `${fmtN(Math.round(g.value))} ${g.unit}` }),
    h('span', { class: 'wm-pfeil', html: icon('chevron', 18), 'aria-hidden': 'true' }));
  return h('div', { class: 'wm-gruppe pegel-gruppe' }, a);
}

/** Pegel-Details im Fenster über der Standortansicht: dieselbe Darstellung wie im Kartenpanel, „×“ führt zurück zum Standort. */
function pegelFenster(g, opener, { karte = false } = {}) {
  const inhalt = h('div', { class: 'pegel-fenster' });
  let sh;
  const weiter = (f) => { sh.schliessen(); if (state.view !== 'karte') setView('karte'); f(); };   // zur Karte: Fenster und Bereich schließen
  const zeichnen = () => inhalt.replaceChildren(pegelDetail(g, {
    imSheet: true, verlauf: verlaufLaden(g.id), eingebettet: true,
    onShare: () => sharePegel(g, true),
    onKarte: karte ? () => weiter(() => pegelAufKarte(g)) : undefined,
    slips: slipsAmPegel(g, state.places), onSlip: (p) => weiter(() => selectPlace(p.id, { full: true })),
    onStern: () => { const top = sh.inhalt.scrollTop; zeichnen(); sh.inhalt.scrollTop = top; inhalt.querySelector('.pm-stern')?.focus({ preventScroll: true }); },
  }));
  zeichnen();
  sh = sheetOeffnen({ inhalt, opener, stufe: 'gross', verlauf: true, klasse: 'wxd wxd-pegel',
    kopf: { titel: g.name, titelId: 'pd-name', unter: [istTidepegel(g) ? 'Tidepegel' : 'Pegel', g.water].filter(Boolean).join(' · ') } });
  return sh;
}

/** Fluss bzw. Küste als Sheet über der Karte (Designumbau 2a; früher Seite #pegel/fluss/<name>): Profil und Pegelliste.
 *  Ein Pegel darin schließt das Fluss-Sheet und öffnet das Pegel-Sheet (Chip „Pegel“ an). */
async function flussFenster(slug) {
  let st;
  try { st = await pegelLaden(); } catch { st = null; }
  const gr = st ? gruppeZu(gruppieren(st.gauges), slug) : null;
  if (!gr) { toast(st ? 'Dieses Gewässer wurde nicht gefunden.' : 'Pegeldaten sind gerade nicht erreichbar.'); return null; }
  const inhalt = h('div', { class: 'pegel-fenster fluss-fenster' });
  let sh = null;
  const kopfInfo = flussSeite(inhalt, gr, {
    imSheet: true, places: () => state.places, isMobile, stand: st, verlauf: verlaufLaden,
    onOpen: (id) => { sh?.schliessen(); pegelAusSuche(id); },
    back: () => sh?.schliessen(),
    slipsAufKarte: (liste) => { sh?.schliessen(); slipsAufKarte(liste); },
  });
  sh = sheetOeffnen({ inhalt, kopf: { titel: kopfInfo.titel, titelId: 'pf-name', unter: kopfInfo.unter, marke: kopfInfo.marke }, stufe: 'gross', klasse: 'pf-sheet', verlauf: true });
  return sh;
}

/** Slipanlagen (z. B. „alle Slipanlagen am Fluss“) auf der Karte zeigen. */
function slipsAufKarte(liste) {
  setView('karte');
  if (!state.cats.has('slip')) toggleCat('slip', true);   // zusätzlich – andere Kategorien bleiben
  setTimeout(() => { state.map?.invalidate(); state.map?.fitBounds(liste.map(p => [p.lat, p.lon]), { maxZoom: 13 }); }, 0);
}

/** Pegel per ID im Fenster öffnen (Merkliste, Dashboard, Flussseite): bleibt auf der aktuellen Seite, Adresse unverändert. */
async function pegelFensterOeffnen(id, opener = document.activeElement) {
  let st;
  try { st = await pegelLaden(); } catch { st = null; }
  const g = st?.byId.get(id);
  if (!g) { toast(st ? 'Dieser Pegel wurde nicht gefunden.' : 'Pegeldaten sind gerade nicht erreichbar.'); return; }
  pegelFenster(g, opener, { karte: true });
}


// ============================================================ Standort-Sheet (Designumbau 3b, 7.72.1)
// Slipanlagen, Häfen, Tankstellen und Zusatzorte im gemeinsamen Rahmen: Handy von unten (Stufe „klein“ = Kopf, Aktionen, „Details“;
// ersetzt die frühere Vorschau-Karte), Desktop Panel rechts. Wetter- und Pegel-Fenster legen sich darüber. Das Sheet trägt die id „detail“.
let standort = null;   // { sheet, key }

/** Inhalt zeigen; ein offenes Sheet tauscht Kopf und Inhalt (gleicher Eintrag: Scroll-Stand bleibt). stufe: 'klein' | 'gross' | null (beibehalten). */
function standortZeigen({ kopf, body, key, stufe = null }) {
  if (standort?.sheet.offen) {
    const sh = standort.sheet, top = standort.key === key ? sh.inhalt.scrollTop : 0;
    sh.setzeKopf(kopf);
    if (standort.key === key) sh.setzeInhalt(body); else sh.wechsleInhalt(body);   // anderer Ort: weich überblenden
    sh.inhalt.scrollTop = top;
    if (stufe && sh.stufe() !== stufe) sh.stufe(stufe);
  } else {
    const sh = sheetOeffnen({ inhalt: body, kopf, stufe: stufe || 'gross', klasse: 'st-sheet', opener: document.activeElement,
      onStufe: (x) => { if (x === 'klein') standortKleinMessen(); },
      onSchliessen: ({ durchNutzer }) => {
        if (standort?.sheet === sh) { standort = null; document.body.classList.remove('has-detail'); }
        if (durchNutzer) closeDetail();   // ×, Wischen, Esc: Auswahl und Adresse zurücksetzen
      } });
    sh.el.id = 'detail';
    standort = { sheet: sh };
    document.body.classList.add('has-detail');
  }
  standort.key = key;
  if (standort.sheet.stufe() === 'klein') standortKleinMessen();
}

/** Handy, Stufe „klein“: Höhe bis unter den Knopf „Details“ (+ Platz der schwebenden Navigation). */
function standortKleinMessen() {
  const sh = standort?.sheet;
  if (!sh || !isMobile()) return;
  requestAnimationFrame(() => {
    const ende = sh.inhalt.querySelector('.st-klein-ende');
    if (!ende) return;
    const nav = document.querySelector('#bottomnav');
    const navPlatz = nav && nav.getClientRects().length ? Math.max(0, window.innerHeight - nav.getBoundingClientRect().top) + 8 : 16;
    sh.el.style.setProperty('--wm-sheet-klein', `${Math.ceil(ende.getBoundingClientRect().bottom - sh.el.getBoundingClientRect().top + 4 + navPlatz)}px`);
  });
}

/** Standort-Sheet schließen (ohne Auswahl und Adresse zu ändern). */
function standortZu() {
  const s = standort; standort = null;
  document.body.classList.remove('has-detail');
  s?.sheet.schliessen();
}

function closeDetail() {
  const prev = state.selectedId;
  state.selectedId = null;
  pegelZu();
  if (state.extraId) { state.extraId = null; state.map?.selectExtra(null); }
  standortZu();
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
  if (state.gaugesOn) requestAnimationFrame(() => markerPlopp(el.mapEl, '.pk-marker, .pk-cluster'));   // Designumbau 4
  state.gaugeTimer = setInterval(refreshGauges, CONFIG.PEGEL_REFRESH_MIN * 60e3);
}

async function refreshGauges() {
  try {
    const st = await pegelLaden(), list = st.gauges;
    if (!state.gaugesOn) return;
    if (st.offline) toast(`Pegeldaten sind gerade nicht erreichbar – angezeigt wird der Stand von ${new Date(st.zeit).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr.`);
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

/** Pegel-Sheet (Designumbau 2a): Handy von unten (klein: Kurzansicht, groß: Details), Desktop Panel rechts. */
const pegelBlatt = pegelSheet({
  places: () => state.places, mobil: isMobile,
  wetter: (g) => wetterZeile(g.lat, g.lon, { name: g.name }).zeile,   // wie im Slip-Sheet: Zeile, öffnet das Wetter-Sheet
  share: (g) => sharePegel(g, true),
  slip: (p) => selectPlace(p.id, { full: !isMobile() }),
  fluss: (slug) => flussFenster(slug),
  karte: (g) => pegelAufKarte(g),
  onZu: () => pegelAbgewaehlt(),
});

/** Sheet wurde geschlossen (×, Esc, Wischen): Auswahl und Adresse zurücksetzen. */
function pegelAbgewaehlt() {
  const id = state.gaugeId;
  if (!id) return;
  state.gaugeId = null; state.map?.selectGauge(null);
  if (selHash?.k === 'g' && selHash.id === id) setSelHash(null);
}

/** Pegel-Sheet schließen, weil etwas anderes gewählt wird (Adresse setzt der Aufrufer). */
function pegelZu() {
  if (!state.gaugeId && !pegelBlatt.offen) return;
  state.gaugeId = null; state.map?.selectGauge(null);
  pegelBlatt.zu();
}

/** Pegel wählen (Marker, Suche, Adresse): Sheet öffnen, Pegel in den freien Teil der Karte rücken. Der Bereich bleibt „Karte“. */
function selectGauge(id, { fly = true, stufe = null } = {}) {
  const g = state.gaugeById.get(id) || pegelStand()?.byId.get(id);
  if (!g) return false;
  if (state.view !== 'karte') setView('karte');
  if (state.selectedId) { state.selectedId = null; state.map?.select(null); $$('.place', el.list).forEach(b => b.classList.remove('is-selected')); }
  if (state.extraId) { state.extraId = null; state.map?.selectExtra(null); }
  standortZu();
  state.gaugeId = id;
  state.map?.selectGauge(id);
  const sh = pegelBlatt.oeffnen(g, { stufe });
  if (state.map && fly) {
    // erst nach dem Messen der Stufe „klein“ hinrücken (Handy: über dem Sheet, Desktop: links vom Panel)
    setTimeout(() => {
      const klein = parseFloat(sh?.el.style.getPropertyValue('--wm-sheet-klein')) || window.innerHeight * 0.45;
      const inset = isMobile() ? { top: 120, bottom: sh?.stufe() === 'gross' ? window.innerHeight - 180 : klein } : { right: sh?.el.offsetWidth || 420 };
      state.map?.reveal(g, { zoom: 12, inset });
    }, 60);
  }
  setSelHash('g', id);
  return true;
}

async function sharePegel(g, aufKarte = false) {
  const url = location.origin + location.pathname + `#karte/pegel/${encodeURIComponent(g.id)}`;
  const data = { title: `Pegel ${g.name} – WaterMap`, text: `Pegel ${g.name} (${g.water}): ${pegelFmt(g.value)} ${g.unit}`, url };
  try { if (navigator.share) { await navigator.share(data); return; } } catch (e) { if (e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(url); toast('Link kopiert.'); } catch { prompt('Link zum Kopieren:', url); }
}

/**
 * Nach dem Start im Leerlauf „In der Nähe“ unsichtbar aufbauen und die Pegelliste einmal laden,
 * damit Chip „Pegel“ und Suche beim ersten Tippen ohne Wartezeit antworten.
 */
function vorbereiten() {
  const leerlauf = (f) => (window.requestIdleCallback ? requestIdleCallback(f, { timeout: 3000 }) : setTimeout(f, 300));
  setTimeout(() => leerlauf(() => {
    if (state.view !== 'naehe' && !state.loadFailed) nah?.vorbereiten();
    leerlauf(() => { if (state.mapOk) pegelLaden().catch(() => null); });
  }), 2500);
}

// ============================================================ Bereiche als Sheet über der Karte (Designumbau 3a)
// Nähe, Gemerkt, Meldungen und Mehr öffnen je ein Sheet (Handy von unten, Desktop Panel rechts); immer nur einer.
// Einstellungen legen sich als zweites Sheet über „Mehr“. × und Wischen führen zur Karte (Einstellungen: zurück zu „Mehr“).
const BEREICHE = {
  naehe: { klasse: 'nh-sheet', kopf: () => ({ titel: 'In der Nähe', titelId: 'nh-titel', aktion: { icon: 'map', label: 'Auf der Karte zeigen', onclick: () => nah?.aufKarte() } }) },
  gemerkt: { klasse: 'gm-sheet', kopf: () => ({ titel: 'Gemerkt', titelId: 'gm-titel' }) },
  meldungen: { klasse: 'mu-sheet', kopf: () => ({ titel: 'Aktuelle Meldungen', titelId: 'mu-titel', unter: 'Das berichten Sportbootfahrer aus deinem Revier.' }) },
  mehr: { klasse: 'mh-sheet', kopf: () => ({ titel: 'Mehr', titelId: 'mh-titel', unter: `Version ${CONFIG.VERSION}` }) },
};
let bereich = null;   // { view, sheet, root }
let einstellungen = null;   // Sheet „Mein WaterMap“ über „Mehr“

/** Auslöser für den Fokus nach dem Schließen: der Navigationspunkt bzw. „In der Nähe“. */
function bereichKnopf(view) {
  if (view === 'naehe') return $(isMobile() ? '#btn-naehe-m' : '#btn-naehe-d');
  return $(`${isMobile() ? '#bottomnav' : '#topnav'} [data-nav="${view}"]`);
}

/** Sheet des Bereichs öffnen (ein anderer offener Bereich schließt). true, wenn neu geöffnet. */
function bereichOeffnen(view) {
  if (bereich?.view === view) return false;
  bereichZu();
  const root = h('div', { class: 'wm-bereich-inhalt' });
  const sheet = sheetOeffnen({ inhalt: root, kopf: BEREICHE[view].kopf(), klasse: `wm-bereich ${BEREICHE[view].klasse}`, stufe: 'gross', opener: bereichKnopf(view),
    onSchliessen: ({ durchNutzer }) => {
      if (bereich?.sheet === sheet) bereich = null;
      if (durchNutzer && state.view === view) setView('karte', { push: false });   // ×, Wischen, Esc: zurück zur Karte
    } });
  bereich = { view, sheet, root };
  return true;
}
function bereichZu() {
  einstellungenZu();
  const b = bereich; bereich = null;
  b?.sheet.schliessen();
}

// ---- Aktuelle Meldungen
let meldSeite = null;
const meldRoot = h('div', { class: 'mu-root' });
function meldungenBereich() {
  if (bereich?.view !== 'meldungen') return;
  if (meldRoot.parentNode !== bereich.root) bereich.root.replaceChildren(meldRoot);
  meldSeite ||= meldungenSeite(meldRoot, {
    ort: (id) => { const p = state.byId.get(id); return p ? { name: displayName(p), sub: p.water?.name || p.locality || TYPES[p.type]?.label, lat: p.lat, lon: p.lon } : null; },
    oeffneOrt: (id) => { setView('karte'); selectPlace(id, { full: true }); },
    bezug: () => (state.user ? { lat: state.user.lat, lon: state.user.lon } : null),   // nur, wenn die Position schon freigegeben und bekannt ist
    grenzen: () => (state.mapOk ? state.map.getBounds() : null),
    freigegeben: () => geoFreigabe.status === 'granted',
    position: async () => {   // „Mein Standort“: Position abfragen (Freigabe erst auf Wunsch)
      const pos = await requestUserPos();
      state.user = pos; state.map?.showUser(pos.lat, pos.lon, pos.accuracy); geoFreigabe.merken(true);
      return { lat: pos.lat, lon: pos.lon };
    },
    entfernung: (a, b) => haversine(a.lat, a.lon, b.lat, b.lon),
    formatDistance,
    melden: () => { renderReportMenu({ fragen: true }); reportPop.open($(isMobile() ? '#bottomnav [data-nav="melden"]' : '#btn-report')); },
    toast,
    unpassend: (m, ortName, fertig) => unpassendMelden({ meldung: m, ortName, toast, onFertig: fertig }),
    setzeKopf: (k) => { if (bereich?.view === 'meldungen') bereich.sheet.setzeKopf(k); },
  });
  meldSeite.zeigen().then(() => staffeln(meldRoot.querySelectorAll('.mu-karte')));   // Designumbau 4: Meldungen erscheinen versetzt
}

// ---- Gemerkt (Pegel und Orte)
function gemerktAnzahl() { return favorites.all().filter(id => !state.places.length || state.byId.has(id)).length + meinePegel.alle().length; }
function gemerktBadge() { nav?.setBadge('gemerkt', gemerktAnzahl()); }
function gemerktBereich() {
  if (bereich?.view !== 'gemerkt') return;
  const ortZeile = (p) => ({ id: p.id, name: displayName(p), typ: p.type,
    sub: [TYPES[p.type]?.label, p.water?.name || p.locality, state.user ? formatDistance(haversine(state.user.lat, state.user.lon, p.lat, p.lon)) : null].filter(Boolean).join(' · ') });
  const orte = state.places.length ? favorites.all().map(id => state.byId.get(id)).filter(Boolean).map(ortZeile) : (state.loadFailed ? [] : null);
  const ids = meinePegel.alle();
  const pegel = ids.length ? pegelLaden().then(st => ({
    offline: !!st.offline, stand: st.zeit,
    eintraege: ids.map(id => st.byId.get(id)).filter(Boolean).map(g => ({ id: g.id, name: g.name, wert: g.value, einheit: g.unit, ampel: bootAmpel(g),
      sub: [g.water, PEGEL_ZUSTAND[pegelZustand(g)]?.text].filter(Boolean).join(' · ') })),
  })) : Promise.resolve({ eintraege: [] });
  gemerktZeichnen(bereich.root, {
    orte, pegelIds: ids, pegel,
    oeffneOrt: (id) => { setView('karte'); selectPlace(id, { full: true }); },
    oeffnePegel: (id, opener) => pegelFensterOeffnen(id, opener),   // stapelt sich über „Gemerkt“, × führt zurück
    entferneOrt: (id) => {
      const vorher = favorites.all(); const p = state.byId.get(id);
      favorites.toggle(id); state.map?.refresh(id);
      toast(`${p ? displayName(p) : 'Ort'} entfernt.`, { text: 'Rückgängig', onclick: () => { favorites.setzen(vorher); state.map?.refresh(id); } });
    },
    entfernePegel: (id) => {
      const vorher = meinePegel.alle(); const name = pegelStand()?.byId?.get(id)?.name;
      meinePegel.entfernen(id);
      toast(`${name || 'Pegel'} entfernt.`, { text: 'Rückgängig', onclick: () => meinePegel.setzen(vorher) });
    },
    zuPegel: () => { setView('karte'); if (!state.gaugesOn) setGauges(true); },
    setzeKopf: (k) => bereich.sheet.setzeKopf(k),
  });
}

// ---- Mehr und Einstellungen
function mehrBereich() {
  if (bereich?.view !== 'mehr') return;
  mehrInhalt(bereich.root, {
    profil: profilZeile(),
    naehe: () => setView('naehe'),
    einstellungen: (opener) => { state.mehrSeite = 'einstellungen'; writeHash(true); einstellungenOeffnen(opener, true); },
  });
  if (!state.mehrSeite) staffeln(bereich.root.querySelectorAll('.wm-zeile'));
  if (state.mehrSeite === 'einstellungen') einstellungenOeffnen(); else einstellungenZu();
}
function einstellungenOeffnen(opener = null, gepusht = false) {
  if (einstellungen) return;
  const root = h('div', { class: 'ei-root' });
  const sh = sheetOeffnen({ inhalt: root, kopf: EINSTELLUNGEN_KOPF, klasse: 'wm-bereich ei-sheet', stufe: 'gross', opener,
    onSchliessen: ({ durchNutzer }) => {
      if (einstellungen === sh) einstellungen = null;
      if (!durchNutzer || state.view !== 'mehr' || state.mehrSeite !== 'einstellungen') return;
      state.mehrSeite = null;
      if (gepusht && location.hash === '#mehr/einstellungen') history.back(); else writeHash(false);   // eine Ebene zurück zu „Mehr“
    } });
  einstellungen = sh;
  einstellungenSeite(root, einstellungenCtx());
}
function einstellungenZu() { const e = einstellungen; einstellungen = null; e?.schliessen(); }

/** Kontext für „Mein WaterMap“ (Einstellungen). */
function einstellungenCtx() {
  const fmtZeit = (ms) => new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  return {
    cats: state.cats,
    katLabels: { slip: { label: 'Slipanlagen', farbe: 'var(--wm-slip)' }, marina: { label: 'Häfen', farbe: 'var(--wm-hafen)' }, fuel: { label: 'Tankstellen', farbe: 'var(--wm-tanke)' } },
    toggleCat: (t) => toggleCat(t),
    setStart: (art) => { startArtSetzen(art); ansichtMerken(); },
    bezug: () => nah?.bezugArt || 'kartenmitte',
    setBezug: (art) => nah?.bezugSetzen(art),
    freigabe: () => geoFreigabe.pruefen(),
    erlauben: () => locate({ fly: false }),
    ausgeblendet: ausgeblendetAnzahl,
    ausgeblendetZeigen: () => { ausgeblendetZuruecksetzen(); meldAktualisieren(true); },
    stand: () => ({ orte: state.meta?.generated ? formatDate(state.meta.generated) : null, pegel: pegelStand()?.zeit ? fmtZeit(pegelStand().zeit) : null }),
    aktualisieren: async () => {
      if (navigator.onLine === false) throw new Error('offline');
      const [daten] = await Promise.all([loadAll(), pegelLaden({ force: true }).catch(() => null)]);
      ingest(daten); state.loadFailed = false;
      applyFilters(); renderDatainfo(); meldAktualisieren();
    },
    zuruecksetzen: () => { allesLoeschen(); location.hash = '#mehr'; location.reload(); },
    mindestpegel: () => Object.entries(mindestAlle()).map(([id, cm]) => ({ id, cm, name: pegelStand()?.byId?.get(id)?.name || null })),
    dialog: el.dlg, toast,
  };
}

/** Kartenansicht für „Letzte Ansicht“ merken (nur wenn gewählt). */
function ansichtMerken() {
  if (!state.map || startArt() !== 'letzte') return;
  const c = state.map.getCenter();
  ansichtSchreiben({ lat: +c.lat.toFixed(5), lon: +c.lon.toFixed(5), zoom: state.map.getZoom() });
}

// „Gemerkt“ und Abzeichen nach Änderungen (Stern an anderer Stelle, anderer Tab) aktuell halten
document.addEventListener('meine-pegel', () => updateTabs());
document.addEventListener('favorites-changed', () => updateTabs());

/** „Auf der Karte“: Karte mit Pegel-Ebene und Slipanlagen, Pegel ausgewählt. */
async function pegelAufKarte(g) {
  setView('karte');
  const kat = istTidepegel(g) ? 'marina' : 'slip';   // Tidepegel: Häfen in der Nähe, sonst Slipanlagen
  if (!state.cats.has(kat)) toggleCat(kat, true);
  if (!state.gaugesOn) await setGauges(true);
  selectGauge(g.id);
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
  if (state.view !== 'karte') setView('karte');
  if (state.selectedId) { state.selectedId = null; state.map?.select(null); $$('.place', el.list).forEach(b => b.classList.remove('is-selected')); }
  pegelZu();
  state.extraId = id;
  state.map?.selectExtra(id);
  const [kopf, body] = renderExtraDetail(x, { close: closeDetail, user: state.user });
  standortZeigen({ kopf, body, key: 'x:' + id, stufe: 'gross' });
  if (state.map && fly) setTimeout(() => state.map?.reveal(x, { zoom: 16, inset: detailInset() }), 60);
  setSelHash('x', id);
  announce(`${x.name || 'Eintrag'} ausgewählt`);
  return true;
}

// Adresse: Bereich („#naehe“, „#favoriten“; alt „#liste“) und/oder Auswahl („p=…“, „g=…“, „x=…“), verbunden mit „&“.
// Bereichswechsel legen einen Verlaufseintrag an (Zurück-Taste), Auswahl ersetzt nur den aktuellen.
const VIEWS = ['karte', 'naehe', 'gemerkt', 'meldungen', 'mehr'];
let selHash = null, appliedHash = null;

function readHash() {
  const out = { view: null, sel: null, melden: false, pegel: null, fluss: null, mehr: null, alarm: false, suche: false };
  for (const part of location.hash.replace(/^#/, '').split('&').filter(Boolean)) {
    const fl = part.match(/^pegel\/fluss\/([a-z0-9-]+)$/), pg = part.match(/^pegel\/(.+)$/), kp = part.match(/^karte\/pegel\/(.+?)(\/alarm)?$/);
    // Pegel-Tab entfallen (Designumbau 2a): alte Adressen (Lesezeichen, Push, geteilte Links) führen auf die Karte mit Chip „Pegel“
    if (part === 'pegel' || part === 'pegel/karte') { out.view = 'karte'; out.pegelAn = true; }
    else if (part === 'pegel/suche') { out.view = 'karte'; out.pegelAn = true; out.suche = true; }   // Einstiegsseite /pegel-ampel: „Pegel suchen“
    else if (part.startsWith('pf=')) { out.view = 'karte'; try { out.sel = { k: 'g', id: decodeURIComponent(part.slice(3)) }; } catch { /* ungültig */ } }   // aus der Push-Nachricht
    else if (fl) { out.view = 'karte'; out.fluss = fl[1]; out.pegelAn = true; }
    else if (pg) { out.view = 'karte'; try { out.sel = { k: 'g', id: decodeURIComponent(pg[1]) }; } catch { /* ungültig */ } }
    else if (kp) { out.view = 'karte'; out.alarm = !!kp[2]; try { out.sel = { k: 'g', id: decodeURIComponent(kp[1]) }; } catch { /* ungültig */ } }
    else if (part === 'mehr/einstellungen') { out.view = 'mehr'; out.mehr = 'einstellungen'; }
    else if (part === 'mehr/merkliste' || part === 'favoriten') out.view = 'gemerkt';   // alte Adressen der Merkliste (bis 7.71)
    else if (VIEWS.includes(part)) out.view = part;
    else if (part === 'liste') out.view = 'naehe';   // alte Links
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
  if (state.view === 'meldungen') return '#meldungen';
  if (state.view === 'gemerkt') return '#gemerkt';
  if (state.view === 'mehr') return state.mehrSeite ? `#mehr/${state.mehrSeite}` : '#mehr';
  if (selHash?.k === 'g' && state.view === 'karte') return `#karte/pegel/${encodeURIComponent(selHash.id)}`;
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

/** Bereich wechseln (Karte, In der Nähe, Gemerkt, Meldungen, Mehr). push: neuer Eintrag für die Zurück-Taste.
 *  Die Karte bleibt immer sichtbar; jeder andere Bereich ist ein Sheet über ihr (Designumbau 3a). */
function setView(view, { push = true, spaeter = false, sofort = false } = {}) {
  if (view === 'favoriten') view = 'gemerkt';
  if (!VIEWS.includes(view)) view = 'karte';
  const changed = view !== state.view;
  const vorher = state.view;
  // ein Bereich legt sich über die Karte: Auswahl (Standort, Pegel) vorher schließen – so bleibt nur ein Panel rechts
  if (view !== 'karte' && (state.selectedId || state.gaugeId || state.extraId)) closeDetail();
  state.view = view;
  if (view !== 'mehr') state.mehrSeite = null;
  const neu = view === 'karte' ? (bereichZu(), false) : bereichOeffnen(view);
  if (view === 'gemerkt' && neu) gemerktFrisch();
  // Inhalt zeichnen. Nach einem Tipp in der Navigation erst nach dem nächsten Bild – so fährt das Sheet sofort ein
  const inhalt = () => {
    if (state.view !== view || bereich?.view !== view) return;
    if (view === 'naehe' && neu) {
      bereich.root.replaceChildren(el.naeheKopf, el.listHead, el.list, el.datainfo);
      if (nah && state.places.length && !state.loadFailed) nah.oeffnen().then(() => staffeln(el.list.children)); else renderList();   // Zeilen erscheinen versetzt
    }
    if (view === 'meldungen' && neu) meldungenBereich();
    if (view === 'gemerkt' && neu) gemerktBereich();
    if (view === 'mehr') mehrBereich();
  };
  if (spaeter) requestAnimationFrame(() => setTimeout(inhalt, 0)); else inhalt();
  nav?.setActive(navZiel(), { sofort });
  if (view === 'meldungen' || vorher === 'meldungen') { gesehenSetzen(); meldBadge(); }   // Übersicht angesehen: nichts mehr „neu“
  $('#cat-hint').hidden = !(state.places.length && !state.cats.size && !state.gaugesOn) || view !== 'karte';
  if (changed) writeHash(push);
  setTimeout(() => state.map?.invalidate(), 0);
}

/** Aktiver Navigationspunkt (In der Nähe → „Mehr“, siehe NAV_ZIEL in nav.js). */
function navZiel() { return state.view; }

/** Navigation: Karte/Meldungen/Gemerkt/Mehr ohne Neuladen; Melden öffnet die Auswahl. */
function onNav(id, e) {
  if (id === 'melden') { if (!reportPop.isOpen) renderReportMenu({ fragen: true }); reportPop.toggle(e.currentTarget); return true; }
  if (id === 'mehr' && state.view === 'mehr' && state.mehrSeite) { einstellungen?.schliessen({ durchNutzer: true }); return true; }   // Einstellungen offen: eine Ebene zurück zu „Mehr“
  if (id !== 'karte' && id === state.view) { bereich?.sheet.el.querySelector('.wm-kopf-titel')?.focus(); return true; }   // schon offen
  if (VIEWS.includes(id)) { setView(id, { spaeter: true }); return true; }
  return false;
}

function handleHash({ initial = false } = {}) {
  if (!initial && location.hash === appliedHash) return;
  const { view, sel, melden, fluss, mehr, pegelAn, alarm, suche } = readHash();
  state.mehrSeite = view === 'mehr' ? mehr : null;
  if (view === 'mehr' && state.view === 'mehr') mehrBereich();
  setView(view || 'karte', { push: false, sofort: initial });
  if (pegelAn && state.mapOk && !state.gaugesOn) setGauges(true);
  if (fluss) setTimeout(() => flussFenster(fluss), 0);
  if (suche) setTimeout(() => el.q.focus(), 0);
  if (melden) setTimeout(() => { renderReportMenu({ fragen: true }); reportPop.open($(isMobile() ? '#bottomnav [data-nav="melden"]' : '#btn-report')); }, 0);
  selHash = sel;
  writeHash(false);
  if (!sel) {
    if (!initial && (state.selectedId || state.gaugeId || state.extraId)) closeDetail();
    return;
  }
  const { k, id } = sel;
  if (k === 'x' && hasExtras()) {
    extrasList().then(() => { if (!selectExtra(id)) toast('Dieser Eintrag wurde nicht gefunden.'); }, () => toast('Die Zusatzdaten konnten nicht geladen werden.'));
    return;
  }
  if (k === 'g' && state.mapOk) {
    if (id === state.gaugeId) return;
    (state.gaugesOn && state.gauges ? Promise.resolve() : setGauges(true))
      .then(() => {
        if (state.gauges && !selectGauge(id)) { toast('Dieser Pegel wurde nicht gefunden.'); return; }
        const g = alarm && state.gaugeById.get(id);   // aus der Einstiegsseite (#am-alarm): gleich das Alarm-Fenster
        if (g) setTimeout(() => alarmFenster(g), 0);
      });
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
    geoFreigabe.merken(true);
    // Außerhalb des Kartengebiets (z. B. im Urlaub): nicht dorthin springen, nur Hinweis
    const drin = imGebiet(pos.lat, pos.lon);
    if (state.map) { state.map.showUser(pos.lat, pos.lon, pos.accuracy); if (fly && drin) state.map.flyTo(pos.lat, pos.lon, 11); }
    if (!drin) toast(`Dein Standort liegt außerhalb des Kartengebiets. ${CONFIG.GEBIET.hinweis}`);
    renderList();
    if (state.selectedId && standort) showDetail(state.byId.get(state.selectedId));   // Entfernung im Kopf
    if (drin) announce('Karte auf deinen Standort ausgerichtet');
    return pos;
  } catch (e) { if (/verweigert/.test(e.message)) geoFreigabe.merken(false); toast(e.message); throw e; }
  finally { btn.classList.remove('is-busy'); }
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
  if (standort) standort.sheet.el.hidden = true;   // Standort-Sheet während der Wahl ausblenden
  const promise = state.map.pickLocation(initial);
  const api = state.map.pickApi;
  api.onPick = () => { confirm.disabled = false; };
  confirm.onclick = () => api.confirm();
  cancel.onclick = () => api.cancel();
  return promise.finally(() => {
    el.pickbar.hidden = true; document.body.classList.remove('is-picking');
    if (standort) standort.sheet.el.hidden = false;
  });
}

// Menü → Meldung zu einem Standort: statt einer Auswahlliste den Standort auf der Karte (oder über die Suche) antippen
const PLACE_PICK = {
  'lage-melden': { text: 'Tippe auf der Karte auf die Slipanlage, an der du gerade bist.', type: 'slip' },
  'foto-einreichen': { text: 'Tippe auf der Karte auf die Slipanlage, Marina oder Tankstelle, zu der das Foto gehört.' },
  'fehler-melden': { text: 'Tippe auf der Karte auf den Standort, zu dem du etwas melden möchtest.', general: true },
  'slip-ergaenzen': { text: 'Tippe auf der Karte auf die Slipanlage, die du ergänzen möchtest.', type: 'slip' },
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
  if (formName === 'slipanlage-melden' && !preset.lat && state.user) { /* Position wird nur auf Wunsch übernommen */ }
  closeMenu();
  if (formName === 'lage-melden') { const pl = state.byId.get(preset.standort_id); if (pl?.type === 'slip') lageMelden(pl); return; }
  if (formName === 'slip-ergaenzen') { const pl = state.byId.get(preset.standort_id); if (pl?.type === 'slip') slipErgaenzen({ place: pl, toast }); return; }
  openForm(formName, ctx, preset);
}

// ============================================================ Suche (suche-ui.js)
let suche = null;
function wireSearch() { suche = sucheEinrichten({ state, el, isMobile, selectGauge, selectPlace, setGauges, setView, toast, toggleCat, closeDetail }); }
function pegelAusSuche(id) { return suche.pegelAusSuche(id); }

// ============================================================ Melden (melden-menue.js)
let melden = null;
function closeMenu() { melden?.closeMenu(); }
function renderReportMenu(o) { melden.renderReportMenu(o); }

// ============================================================ Tabs, Sheet, Hilfen
/** „Gemerkt“ und sein Abzeichen aktuell halten (Stern an anderer Stelle, Rückgängig, anderer Tab). */
function updateTabs() { gemerktBadge(); if (state.view === 'gemerkt') gemerktBereich(); }

/** Liste/Gemerkt öffnen oder schließen (für ältere Aufrufe und Tests). */
function setListOpen(open, tab) {
  setView(open ? (tab === 'fav' ? 'gemerkt' : 'naehe') : 'karte');
}

let toastTimer;
/** Kurze Meldung unten. aktion = { text, onclick } (optional, z. B. „Rückgängig“): Knopf rechts, die Meldung bleibt länger stehen
 *  und verschwindet nicht, solange der Knopf den Fokus hat. */
function toast(text, aktion = null) {
  const t = $('#toast');
  const knopf = aktion ? h('button', { type: 'button', class: 'toast-aktion', text: aktion.text,
    onclick: () => { clearTimeout(toastTimer); t.hidden = true; aktion.onclick(); } }) : null;
  // „Danke! …“ nach erfolgreichem Senden (Lage, Angaben): Haken, der sich zeichnet (Designumbau 4)
  const haken = /^Danke\b/.test(text) ? h('span', { class: 'toast-haken', html: hakenSvg(20) }) : null;
  t.replaceChildren(...[haken, h('span', { class: 'toast-text', text }), knopf].filter(Boolean));
  t.classList.toggle('mit-aktion', !!aktion);
  t.hidden = false; announce(aktion ? `${text} ${aktion.text} ist möglich.` : text);
  const zu = () => { clearTimeout(toastTimer); toastTimer = setTimeout(() => { if (!t.contains(document.activeElement)) t.hidden = true; }, aktion ? 8000 : 5200); };
  t.onfocusout = aktion ? zu : null;
  zu();
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
  suchfelderMitX();
  document.addEventListener('wm-toast', (e) => (typeof e.detail === 'string' ? toast(e.detail) : toast(e.detail.text, e.detail.aktion)));
  wischenZuMachen({ mobil: isMobile });   // Dialoge von unten (Filter, Melden, Formulare); Sheets wischt der Rahmen (bausteine.js)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || el.dlg.open || filterPop.isOpen || reportPop.isOpen || $('#naehe-bezug[open]') || $('#pa-pop[open]') || $('dialog.lightbox[open]') || el.suggest.offsetParent || offeneSheets().length) return;
    if (state.selectedId || state.gaugeId || state.extraId) closeDetail();
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
window.__watermap = { state, pegelLaden, selectPlace, applyFilters, toggleCat, setListOpen, setView, setGauges, selectGauge, setExtras, selectExtra };

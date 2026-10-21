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
import { renderDetail } from './detail.js';
import { loadGauges, loadHistory, renderGaugeDetail } from './pegel.js';
import { weatherSection } from './wetter.js';
import { GROUPS, loadExtras, renderExtraDetail, nearbySection, glyph } from './extras.js';
import { enrichFacts } from './hafeninfo.js';

const state = {
  places: [], byId: new Map(), index: [], meta: null, issues: [], invalid: 0,
  cats: new Set(), subs: new Set(), tab: 'list',   // cats: sichtbare Kategorien (Start: keine – der Nutzer wählt)
  selectedId: null, user: null,
  map: null, mapOk: false,
  filtered: [], loadFailed: false,
  gaugesOn: false, gauges: null, gaugeById: new Map(), gaugeId: null, gaugeTimer: null,
  extrasOn: { wasser: false, service: false }, extras: null, extraById: new Map(), extraId: null,
};

const el = {
  sidebar: $('#sidebar'), list: $('#list'), listHead: $('#list-head'), datainfo: $('#datainfo'),
  filterbar: $('#filterbar'), detail: $('#detail'), mapEl: $('#map'), dlg: $('#dlg'),
  q: $('#q'), suggest: $('#suggest'), tabs: $('#tabs'), banner: $('#banner'), pickbar: $('#pickbar'),
};

const isMobile = () => window.matchMedia('(max-width: 899px)').matches;

// ============================================================ Start
async function init() {
  $('#brand-logo').innerHTML = logoSvg(38);
  $('#btn-search-ico').innerHTML = icon('search', 20);
  $('#btn-menu').innerHTML = icon('menu', 24);
  $('#btn-locate').innerHTML = icon('locate', 22);
  if (window.matchMedia('(max-width: 520px)').matches) el.q.placeholder = 'Suchen …';
  $('#list-close').innerHTML = icon('close', 20);
  state.cats = new Set((prefs.get('cats') || '').split(',').filter(t => TYPE_KEYS.includes(t)));
  if (prefs.get('listOpen') === '1') document.body.classList.add('list-open');
  renderSkeleton();
  wireStatic();

  const [libs, data] = await Promise.all([
    loadMapLibraries().catch(() => ({ leaflet: false })),
    loadAll().then(d => ({ ok: true, d }), err => ({ ok: false, err })),
  ]);

  if (libs.leaflet) {
    state.map = createMap(el.mapEl, {
      useCluster: libs.cluster,
      onMoveEnd: debounce(() => { if (state.tab === 'list') renderList(); }, 180),
      onMapClick: () => { if (state.selectedId || state.gaugeId || state.extraId) closeDetail(); },
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
  handleHash();
  offerLocation();
  registerServiceWorker();
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
  if (on) state.cats.add(type); else state.cats.delete(type);
  state.subs.clear();
  prefs.set('cats', [...state.cats].join(','));
  applyFilters();
}

function applyFilters() {
  const one = singleCat();
  const defs = one ? FILTERS[one].filter(d => state.subs.has(d.id)) : [];
  state.filtered = state.places.filter(p => state.cats.has(p.type) && defs.every(d => d.test(p)));
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

function renderFilterbar() {
  const bar = clear(el.filterbar);
  // Kategorien einzeln ein- und ausschalten (Start: keine, die Auswahl wird gemerkt)
  const cats = TYPE_KEYS.map(t => [t, TYPES[t].plural, state.places.filter(p => p.type === t).length]);
  const row1 = h('div', { class: 'chips', role: 'group', 'aria-label': 'Auf der Karte zeigen' }, cats.map(([key, label, n]) => {
    const on = state.cats.has(key);
    return h('button', { type: 'button', class: `chip chip-${key}` + (on ? ' is-active' : ''), 'aria-pressed': String(on),
      title: on ? `${label} ausblenden` : `${label} auf der Karte zeigen`, onclick: () => toggleCat(key) },
      h('span', { class: 'chip-dot', html: glyphSvg(key, 16) }),
      h('span', { text: label }), h('span', { class: 'chip-n', text: String(n) }));
  }));
  if (state.mapOk) {
    row1.append(h('button', { type: 'button', class: 'chip chip-gauge' + (state.gaugesOn ? ' is-active' : ''), 'aria-pressed': String(state.gaugesOn),
      title: state.gaugesOn ? 'Pegelstände ausblenden' : 'Aktuelle Pegelstände der Bundeswasserstraßen einblenden',
      onclick: () => setGauges(!state.gaugesOn) },
      h('span', { class: 'chip-dot', html: icon('gauge', 16) }), h('span', { text: 'Pegel' }),
      state.gaugesOn && state.gauges ? h('span', { class: 'chip-n', text: String(state.gauges.length) }) : null));
    if (hasExtras()) {
      for (const [g, def] of Object.entries(GROUPS)) {
        const on = state.extrasOn[g];
        const n = on && state.extras ? state.extras.filter(x => def.kinds.includes(x.kind)).length : null;
        row1.append(h('button', { type: 'button', class: `chip chip-extra chip-extra-${g}` + (on ? ' is-active' : ''), 'aria-pressed': String(on),
          style: `--c:${def.color}`, title: on ? `${def.label} ausblenden` : `${def.label} einblenden`, onclick: () => setExtras(g, !on) },
          h('span', { class: 'chip-dot', html: glyph(def.kinds[0], 15) }), h('span', { text: def.label }),
          n !== null ? h('span', { class: 'chip-n', text: String(n) }) : null));
      }
    }
  }
  const nFav = favorites.all().filter(id => state.byId.has(id)).length;
  if (nFav) row1.prepend(h('button', { type: 'button', class: 'chip chip-fav', title: 'Meine Favoriten anzeigen', onclick: () => setListOpen(true, 'fav') },
    h('span', { class: 'chip-dot', html: icon('star', 15, true) }), h('span', { text: 'Favoriten' }), h('span', { class: 'chip-n', text: String(nFav) })));
  bar.append(row1);
  if (!state.cats.size && state.places.length) {
    bar.append(h('p', { class: 'filter-hint', text: 'Tippe oben auf Slipanlagen, Marinas oder Tankstellen, um sie auf der Karte zu zeigen.' }));
  }
  if (singleCat()) {
    const counts = filterCounts(state.places, singleCat());
    bar.append(h('div', { class: 'chips chips-sub', role: 'group', 'aria-label': 'Weitere Filter' }, counts.map(d => {
      const on = state.subs.has(d.id), none = d.count === 0;
      return h('button', { type: 'button', class: 'chip chip-sub' + (on ? ' is-active' : '') + (none && !on ? ' is-empty' : ''), 'aria-pressed': String(on),
        'aria-disabled': none && !on ? 'true' : null,
        title: none ? 'Dazu liegen noch keine bestätigten Angaben vor.' : `${d.count} von ${d.total} Standorten mit bestätigter Angabe`,
        onclick: () => { if (none && !on) { toast('Zu diesem Filter liegen noch keine bestätigten Angaben vor.'); return; } on ? state.subs.delete(d.id) : state.subs.add(d.id); applyFilters(); } },
        h('span', { text: d.label }), h('span', { class: 'chip-n', text: String(d.count) }));
    })));
  }
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
      h('button', { type: 'button', class: 'place' + (p.id === state.selectedId ? ' is-selected' : ''), dataset: { id: p.id }, onclick: () => selectPlace(p.id) },
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
  if (!state.cats.size) return h('li', { class: 'empty' }, h('p', { class: 'empty-title', text: 'Keine Kategorie gewählt' }), h('p', { class: 'muted', text: 'Tippe oben auf der Karte auf Slipanlagen, Marinas oder Tankstellen.' }));
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
  if (isMobile()) return { bottom: Math.round(window.innerHeight * 0.5), top: el.filterbar.offsetHeight + 8 };
  return { right: el.detail.offsetWidth + 24, top: el.filterbar.offsetHeight + 8 };
}

function selectPlace(id, { fly = true, updateHash = true } = {}) {
  const p = state.byId.get(id);
  if (!p) return false;
  const pick = state.placePick;
  if (pick && pick.type && p.type !== pick.type) { toast('Bitte eine Bootstankstelle antippen.'); return false; }
  if (state.gaugeId) { state.gaugeId = null; state.map?.selectGauge(null); }
  if (state.extraId) { state.extraId = null; state.map?.selectExtra(null); }
  if (!state.cats.has(p.type)) toggleCat(p.type, true);   // z. B. Link oder Suche: Kategorie des Standorts einblenden
  state.selectedId = id;
  if (state.map) { state.map.select(id); }
  showDetail(p);
  if (state.map && fly) state.map.reveal(p, { zoom: 15, inset: detailInset() });
  if (updateHash) history.replaceState(null, '', '#p=' + encodeURIComponent(id));
  $$('.place', el.list).forEach(b => b.classList.toggle('is-selected', b.dataset.id === id));
  announce(`${displayName(p)} ausgewählt`);
  if (pick) { endPlacePick(); openReport(pick.formName, { ...pick.preset, standort_id: id }); }  // Auswahlmodus aus dem Menü
  return true;
}

function showDetail(p) {
  const [head, body] = renderDetail(p, {
    user: state.user,
    enrichFacts: enrichFacts(state.meta, p.id),
    weather: weatherSection(p.lat, p.lon),
    nearby: hasExtras() ? nearbySection(extrasList(), p.lat, p.lon, { onSelect: (id) => selectExtra(id) }) : null,
    actions: {
      close: closeDetail,
      onFavorite: () => { favorites.toggle(p.id); showDetail(p); renderList(); updateTabs(); renderFilterbar(); state.map?.refresh(p.id); },
      share: () => shareLink(p),
      report: () => openReport('fehler-melden', { standort_id: p.id }),
      addPhoto: () => openReport('foto-einreichen', { standort_id: p.id }),
      reportPhoto: (ph) => openReport('fehler-melden', { standort_id: p.id, art: 'foto', details: `Foto unpassend: ${ph.url}\nGrund: ` }),
      reportPrice: () => openReport('tankpreis-melden', { standort_id: p.id }),
    },
  });
  mountDetail(head, body);
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

function closeDetail() {
  const prev = state.selectedId;
  state.selectedId = null;
  if (state.gaugeId) { state.gaugeId = null; state.map?.selectGauge(null); }
  if (state.extraId) { state.extraId = null; state.map?.selectExtra(null); }
  el.detail.hidden = true; clear(el.detail); delete el.detail.dataset.opened;
  document.body.classList.remove('has-detail');
  if (state.map) state.map.select(null);
  history.replaceState(null, '', location.pathname + location.search);
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
  history.replaceState(null, '', '#g=' + encodeURIComponent(id));
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
  history.replaceState(null, '', '#x=' + encodeURIComponent(id));
  announce(`${x.name || 'Eintrag'} ausgewählt`);
  return true;
}

function handleHash() {
  const xm = location.hash.match(/^#x=(.+)$/);
  if (xm && hasExtras()) {
    let id; try { id = decodeURIComponent(xm[1]); } catch { return; }
    extrasList().then(() => { if (!selectExtra(id)) toast('Dieser Eintrag wurde nicht gefunden.'); }, () => toast('Die Zusatzdaten konnten nicht geladen werden.'));
    return;
  }
  const g = location.hash.match(/^#g=(.+)$/);
  if (g && state.mapOk) {
    let id; try { id = decodeURIComponent(g[1]); } catch { return; }
    (state.gaugesOn && state.gauges ? Promise.resolve() : setGauges(true))
      .then(() => { if (state.gauges && !selectGauge(id)) toast('Dieser Pegel wurde nicht gefunden.'); });
    return;
  }
  const m = location.hash.match(/^#p=(.+)$/);
  if (!m) return;
  let id; try { id = decodeURIComponent(m[1]); } catch { return; }
  if (!selectPlace(id, { updateHash: false }) && state.places.length) toast('Dieser Standort ist nicht mehr in der Datenbank.');
}
window.addEventListener('hashchange', handleHash);

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
    if (state.selectedId) showDetail(state.byId.get(state.selectedId));
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
  'foto-einreichen': { text: 'Tippe auf der Karte auf die Slipanlage, Marina oder Tankstelle, zu der das Foto gehört.' },
  'fehler-melden': { text: 'Tippe auf der Karte auf den Standort, zu dem du etwas melden möchtest.', general: true },
  'tankpreis-melden': { text: 'Tippe auf der Karte auf die Bootstankstelle.', type: 'fuel' },
};

function choosePlaceFor(formName, preset = {}) {
  const cfg = PLACE_PICK[formName];
  if (el.dlg?.open) el.dlg.close();
  closeMenu();
  const bar = clear(el.pickbar);
  const cancel = h('button', { type: 'button', class: 'btn btn-outline small', text: 'Abbrechen', onclick: endPlacePick });
  const general = cfg.general ? h('button', { type: 'button', class: 'btn btn-outline small', text: 'Ohne Standort melden',
    onclick: () => { endPlacePick(); openReport(formName, { ...preset, standort_id: '__other', art: 'sonstiges' }); } }) : null;
  bar.append(h('p', { text: `${cfg.text} Du kannst den Ort auch oben suchen.` }), h('div', { class: 'btn-row' }, cancel, general));
  el.pickbar.hidden = false;
  document.body.classList.add('is-choosing');
  state.placePick = { formName, type: cfg.type || null, preset };
  if (isMobile()) openSheet(false);
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
    choosePlace: (name) => choosePlaceFor(name),
  };
  const p = preset.standort_id && state.byId.get(preset.standort_id);
  if (p && formName === 'tankpreis-melden') preset.standort_id = p.id;
  if (formName === 'slipanlage-melden' && !preset.lat && state.user) { /* Position wird nur auf Wunsch übernommen */ }
  closeMenu();
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

// ============================================================ Menü
function closeMenu() { const m = $('#menu'); if (m.open) m.close(); }

function buildMenu() {
  const body = clear($('#menu-body'));
  const item = (ico, label, run, sub) => h('li', {}, h('button', { type: 'button', class: 'menu-item', onclick: () => { closeMenu(); run(); } },
    h('span', { class: 'menu-ico', html: icon(ico, 22) }), h('span', {}, h('strong', { text: label }), sub ? h('small', { text: sub }) : null)));
  body.append(
    h('h2', { id: 'menu-title', text: 'WaterMap' }),
    h('p', { class: 'muted', text: 'Dein Revier. Deine Karte.' }),
    h('ul', { class: 'menu-list' },
      item('list', 'Standortliste', () => setListOpen(true, 'list'), 'Standorte im Kartenausschnitt'),
      item('gauge', 'Pegel-Ampel', () => { location.href = './pegel-ampel'; }, 'Passt mein Boot heute aufs Wasser?'),
      item('star', 'Favoriten', () => setListOpen(true, 'fav'), `${favorites.all().length} gespeichert`),
      item('plus', 'Neue Slipanlage melden', () => openReport('slipanlage-melden')),
      item('plus', 'Kraftstoffpreis melden', () => choosePlaceFor('tankpreis-melden')),
      item('camera', 'Foto einreichen', () => choosePlaceFor('foto-einreichen')),
      item('flag', 'Fehler oder Hinweis melden', () => choosePlaceFor('fehler-melden', { art: 'sonstiges' }))),
    h('ul', { class: 'menu-links' },
      h('li', {}, h('a', { href: './ueber.html', text: 'Über WaterMap und Datenquellen' })),
      h('li', {}, h('a', { href: './datenschutz.html', text: 'Datenschutz' })),
      h('li', {}, h('a', { href: './impressum.html', text: 'Impressum' }))),
    h('p', { class: 'muted small', text: `Version ${CONFIG.VERSION} · Kartendaten © OpenStreetMap-Mitwirkende (ODbL)` }));
}

// ============================================================ Tabs, Sheet, Hilfen
function updateTabs() {
  const n = favorites.all().length;
  $$('#tabs button[data-tab]').forEach(b => { const on = b.dataset.tab === state.tab; b.classList.toggle('is-active', on); b.setAttribute('aria-selected', String(on)); });
  $('#tab-fav-n').textContent = n ? String(n) : '';
}

function openSheet(open = true) { el.sidebar.classList.toggle('is-open', open); $('#sheet-handle').setAttribute('aria-expanded', String(open)); }

/** Standortliste nur bei Bedarf (Menü → Standortliste/Favoriten); der Zustand wird gemerkt. */
function setListOpen(open, tab) {
  if (tab) { state.tab = tab; updateTabs(); renderList(); }
  document.body.classList.toggle('list-open', open);
  prefs.set('listOpen', open ? '1' : '0');
  if (isMobile()) openSheet(open);
  setTimeout(() => state.map?.invalidate(), 0);
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
  $('#btn-menu').addEventListener('click', () => { buildMenu(); $('#menu').showModal(); });
  $('#menu-close').addEventListener('click', closeMenu);
  $('#dlg-close').addEventListener('click', () => el.dlg.close());
  for (const d of [$('#menu'), el.dlg]) d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  $('#btn-locate').addEventListener('click', () => locate().catch(() => {}));
  $$('#tabs button[data-tab]').forEach(b => b.addEventListener('click', () => { state.tab = b.dataset.tab; updateTabs(); renderList(); }));
  $('#list-close').addEventListener('click', () => setListOpen(false));
  $('#sheet-handle').addEventListener('click', () => openSheet(!el.sidebar.classList.contains('is-open')));
  document.addEventListener('favorites-changed', updateTabs);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !el.dlg.open && !$('#menu').open && !$('dialog.lightbox[open]') && (state.selectedId || state.gaugeId || state.extraId) && !el.suggest.offsetParent) closeDetail(); });
  window.addEventListener('resize', debounce(() => state.map?.invalidate(), 150));
  window.addEventListener('online', updateOnline); window.addEventListener('offline', updateOnline);
  updateOnline(); updateTabs();
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
window.__watermap = { state, selectPlace, applyFilters, toggleCat, setListOpen, setGauges, selectGauge, setExtras, selectExtra };

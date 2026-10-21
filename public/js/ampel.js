// Pegel-Ampel: Oberfläche (pegel-ampel.html). Die Bewertung steckt in ampel-logik.js,
// Pegeldaten und Diagramm kommen aus pegel.js (PEGELONLINE über /api/pegel/), Slipanlagen aus data.js.
import { h, debounce } from './dom.js';
import { glyphSvg } from './icons.js';
import { loadGauges, loadHistory, historyChart, formatTime } from './pegel.js';
import { loadSlips } from './data.js';
import { haversine, formatDistance, displayName, subtitle } from './model.js';
import { bewerte, trend, STATUS, BOOTSTYPEN, PUFFER_CM } from './ampel-logik.js';

const VERLAUF_TAGE = 14;
const SLIPS_ANZAHL = 3;
const KEY = 'watermap.ampel';
const TREND_PFEIL = { steigend: '↑', gleich: '→', fallend: '↓' };

const $ = (id) => document.getElementById(id);
const el = {
  q: $('am-q'), list: $('am-list'), picked: $('am-picked'), min: $('am-min'), boot: $('am-boot'), msg: $('am-msg'),
  result: $('am-result'), light: $('am-light'), status: $('am-status'), where: $('am-where'),
  now: $('am-now'), time: $('am-time'), res: $('am-res'), trend: $('am-trend'), trendSub: $('am-trend-sub'), hints: $('am-hints'),
  share: $('am-share'), chartCard: $('am-chart-card'), chart: $('am-chart'), slipsCard: $('am-slips-card'), slips: $('am-slips'),
};

const state = { gauges: [], byId: new Map(), gauge: null, mindest: null, boot: 'motor', history: new Map(), slips: null };

// ------------------------------------------------------------------ Einstellungen (localStorage, URL)
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
function savePrefs() {
  try { localStorage.setItem(KEY, JSON.stringify({ pegel: state.gauge?.id || null, min: state.mindest, boot: state.boot })); } catch { /* nur Komfort */ }
}
function shareUrl() {
  const u = new URL(location.href);
  u.search = '';
  if (state.gauge) u.searchParams.set('pegel', state.gauge.id);
  if (state.mindest !== null) u.searchParams.set('min', String(state.mindest));
  if (state.boot !== 'motor') u.searchParams.set('boot', state.boot);
  u.hash = '';
  return u.toString();
}
const syncUrl = () => history.replaceState(null, '', shareUrl());

function parseMin(v) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= -500 && n <= 2000 ? n : null;
}

// ------------------------------------------------------------------ Pegelsuche
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/ß/g, 'ss');
let hits = [], active = -1;

function search(q) {
  const n = norm(q.trim());
  if (!n) return [];
  const words = n.split(/\s+/);
  return state.gauges
    .map(g => ({ g, key: norm(`${g.name} ${g.water}`), name: norm(g.name) }))
    .filter(x => words.every(w => x.key.includes(w)))
    .sort((a, b) => (b.name.startsWith(words[0]) - a.name.startsWith(words[0])) || a.g.name.localeCompare(b.g.name, 'de'))
    .slice(0, 8).map(x => x.g);
}

function showList() {
  el.list.replaceChildren(...(hits.length
    ? hits.map((g, i) => h('li', { role: 'option', id: `am-opt-${i}`, 'aria-selected': String(i === active), onclick: () => pick(g) },
        h('strong', { text: g.name }), h('small', { text: [g.water, `${Math.round(g.value)} cm`].filter(Boolean).join(' · ') })))
    : [h('li', { class: 'am-none', text: 'Kein Pegel gefunden.' })]));
  el.list.hidden = false;
  el.q.setAttribute('aria-expanded', 'true');
  if (active >= 0) el.q.setAttribute('aria-activedescendant', `am-opt-${active}`); else el.q.removeAttribute('aria-activedescendant');
}
function hideList() { el.list.hidden = true; el.q.setAttribute('aria-expanded', 'false'); el.q.removeAttribute('aria-activedescendant'); }

function wireSearch() {
  el.q.addEventListener('input', () => {
    active = -1; hits = search(el.q.value);
    if (el.q.value.trim()) showList(); else hideList();
  });
  el.q.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!hits.length) return;
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length; showList();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const g = hits[active >= 0 ? active : 0];
      if (g) pick(g);
    } else if (e.key === 'Escape') hideList();
  });
  el.q.addEventListener('focus', () => { if (state.gauge && el.q.value === state.gauge.name) el.q.select(); });
  document.addEventListener('click', (e) => { if (!e.target.closest('.am-search')) hideList(); });
}

function pick(g, user = true) {
  state.gauge = g;
  el.q.value = g.name;
  el.picked.textContent = [g.water, g.km !== null ? `km ${g.km.toLocaleString('de-DE')}` : ''].filter(Boolean).join(' · ');
  el.picked.hidden = !el.picked.textContent;
  hideList();
  if (user) savePrefs();          // geteilte Links überschreiben die eigenen Einstellungen erst bei einer Änderung
  syncUrl();
  update();
  if (user && state.mindest === null) el.min.focus();
}

// ------------------------------------------------------------------ Ergebnis
async function update() {
  const g = state.gauge;
  if (!g) { el.result.hidden = true; el.chartCard.hidden = true; el.slipsCard.hidden = true; return; }
  let pts = state.history.get(g.id);
  if (!pts) {
    el.msg.textContent = 'Verlauf wird geladen …';
    try { pts = await loadHistory(g.id, VERLAUF_TAGE); } catch { pts = null; }
    if (state.gauge !== g) return;                 // inzwischen anderer Pegel gewählt
    if (pts) state.history.set(g.id, pts);
    el.msg.textContent = pts ? '' : 'Der Verlauf konnte nicht geladen werden. Die Bewertung nutzt nur den aktuellen Wert, ohne Trend.';
  }
  render(g, pts || []);
  renderSlips(g);
}

function render(g, pts) {
  const tr = trend(pts);
  const r = bewerte({ pegel: g, mindest: state.mindest, trend: tr });
  const keinMin = state.mindest === null;
  const status = keinMin ? 'unbekannt' : r.status;

  el.result.hidden = false;
  el.result.className = `am-card am-result is-${status}`;
  el.light.className = `am-light is-${status}`;
  el.light.setAttribute('aria-label', `Ampel: ${STATUS[status].label}`);
  el.status.textContent = keinMin ? 'Mindestpegel eingeben' : STATUS[status].label;
  el.where.textContent = `${g.name}${g.water ? ' · ' + g.water : ''} · ${BOOTSTYPEN[state.boot]}${keinMin ? '' : ` · Mindestpegel ${state.mindest} cm`}`;

  el.now.textContent = `${Math.round(g.value)} ${g.unit}`;
  el.time.textContent = `Stand ${formatTime(g.time)}`;
  if (r.reserve === null || keinMin) { el.res.textContent = '–'; el.res.className = ''; }
  else {
    el.res.textContent = `${r.reserve >= 0 ? '+' : '−'}${Math.abs(Math.round(r.reserve))} cm`;
    el.res.className = r.reserve >= PUFFER_CM ? 'am-res-plus' : r.reserve < 0 ? 'am-res-minus' : '';
  }
  el.trend.textContent = tr ? `${TREND_PFEIL[tr.richtung]} ${tr.richtung}` : '–';
  el.trendSub.textContent = tr ? `${tr.cmProTag >= 0 ? '+' : '−'}${Math.abs(Math.round(tr.cmProTag))} cm pro Tag` : 'zu wenig Messwerte';

  const hinweise = keinMin ? ['Trage oben ein, ab welchem Pegel du an dieser Stelle durchkommst.'] : r.hinweise;
  el.hints.replaceChildren(...hinweise.map(t => h('li', { text: t })));

  // Diagramm
  el.chartCard.hidden = false;
  if (pts.length > 1) {
    const tage = (pts[pts.length - 1].t - pts[0].t) / 864e5;
    el.chart.replaceChildren(...[...historyChart(pts, g, { threshold: keinMin ? null : { value: state.mindest, label: 'Min' } }),
      tage < VERLAUF_TAGE - 1 ? h('p', { class: 'am-note', text: `Nur ${Math.max(1, Math.round(tage))} Tage Verlauf verfügbar.` }) : null,
      keinMin ? null : h('p', { class: 'am-note', text: 'Gestrichelt: dein Mindestpegel.' })].filter(Boolean));
    el.chartCard.querySelector('h2').textContent = `Pegelverlauf der letzten ${Math.min(VERLAUF_TAGE, Math.max(1, Math.round(tage)))} Tage`;
  } else {
    el.chart.replaceChildren(h('p', { class: 'unknown', text: 'Keine Messreihe verfügbar.' }));
  }
}

async function renderSlips(g) {
  el.slipsCard.hidden = false;
  if (!state.slips) {
    el.slips.replaceChildren(h('li', { class: 'am-note', text: 'Slipanlagen werden geladen …' }));
    try { state.slips = await loadSlips(); } catch { el.slips.replaceChildren(h('li', { class: 'am-note', text: 'Slipanlagen konnten nicht geladen werden.' })); return; }
    if (state.gauge !== g) return;
  }
  const near = state.slips.map(p => ({ p, d: haversine(g.lat, g.lon, p.lat, p.lon) })).sort((a, b) => a.d - b.d).slice(0, SLIPS_ANZAHL);
  el.slips.replaceChildren(...near.map(({ p, d }) => h('li', {},
    h('a', { href: `./#p=${encodeURIComponent(p.id)}` },
      h('span', { class: 's-ico', 'aria-hidden': 'true', html: glyphSvg('slip', 18) }),
      h('span', { class: 's-text' }, h('strong', { text: displayName(p) }), subtitle(p, { short: true }) ? h('small', { text: subtitle(p, { short: true }) }) : null),
      h('span', { class: 's-dist', text: formatDistance(d) })))));
}

// ------------------------------------------------------------------ Teilen
async function share() {
  const url = shareUrl();
  const g = state.gauge;
  const r = g ? bewerte({ pegel: g, mindest: state.mindest, trend: trend(state.history.get(g.id) || []) }) : null;
  const text = g && state.mindest !== null ? `Pegel-Ampel ${g.name}: ${STATUS[r.status].label} (${Math.round(g.value)} cm, Mindestpegel ${state.mindest} cm)` : 'Pegel-Ampel – WaterMap';
  if (navigator.share) {
    try { await navigator.share({ title: 'Pegel-Ampel – WaterMap', text, url }); return; } catch (e) { if (e?.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(url); flash('Link kopiert'); }
  catch { window.prompt('Link zum Kopieren:', url); }
}
function flash(t) { const old = el.share.textContent; el.share.textContent = t; setTimeout(() => { el.share.textContent = old; }, 1800); }

// ------------------------------------------------------------------ Start
async function init() {
  const params = new URLSearchParams(location.search);
  const prefs = loadPrefs();
  const fromUrl = params.has('pegel');
  state.mindest = parseMin(fromUrl ? params.get('min') : prefs.min);
  state.boot = BOOTSTYPEN[fromUrl ? params.get('boot') : prefs.boot] ? (fromUrl ? params.get('boot') : prefs.boot) : 'motor';
  if (state.mindest !== null) el.min.value = String(state.mindest);
  el.boot.querySelector(`input[value="${state.boot}"]`).checked = true;

  wireSearch();
  el.min.addEventListener('input', debounce(() => {
    state.mindest = parseMin(el.min.value);
    savePrefs(); if (state.gauge) { syncUrl(); render(state.gauge, state.history.get(state.gauge.id) || []); }
  }, 250));
  el.boot.addEventListener('change', (e) => {
    state.boot = e.target.value; savePrefs();
    if (state.gauge) { syncUrl(); render(state.gauge, state.history.get(state.gauge.id) || []); }
  });
  el.share.addEventListener('click', share);

  el.msg.textContent = 'Pegel werden geladen …';
  try { state.gauges = await loadGauges(); }
  catch { el.msg.textContent = 'Die Pegeldaten sind gerade nicht erreichbar. Bitte später erneut versuchen.'; return; }
  state.byId = new Map(state.gauges.map(g => [g.id, g]));
  el.msg.textContent = '';
  const id = fromUrl ? params.get('pegel') : prefs.pegel;
  const g = id && state.byId.get(id);
  if (g) pick(g, false);
  else if (fromUrl) el.msg.textContent = 'Der Pegel aus dem Link wurde nicht gefunden. Bitte oben einen Pegel suchen.';
}

init();

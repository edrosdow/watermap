// Pegel-Ampel: Oberfläche (pegel-ampel.html). Die Bewertung steckt in ampel-logik.js, Pegeldaten kommen aus
// pegel.js (PEGELONLINE über /api/pegel/), Slipanlagen aus data.js, der E-Mail-Alarm über netlify/functions/pegel-alarm.mjs.
import { h, debounce } from './dom.js';
import { icon, glyphSvg, logoSvg } from './icons.js';
import { loadGauges, loadHistory, formatTime } from './pegel.js';
import { s as svgEl } from './chart.js';
import { loadSlips } from './data.js';
import { haversine, formatDistance, displayName, subtitle } from './model.js';
import { bewerte, trend, STATUS, BOOTSTYPEN, PUFFER_CM } from './ampel-logik.js';
import { mountNav } from './nav.js';

const VERLAUF_TAGE = 14;
const SLIPS_ANZAHL = 3;
const KEY = 'watermap.ampel';
const ALARM_API = '/.netlify/functions/pegel-alarm';
const CHECK = { ok: '✓', warn: '!', bad: '✕', info: 'i' };

const $ = (id) => document.getElementById(id);
const el = {
  q: $('am-q'), list: $('am-list'), min: $('am-min'), hoehe: $('am-hoehe'), hoeheHelp: $('am-hoehe-help'), boot: $('am-boot'), msg: $('am-msg'),
  result: $('am-result'), light: $('am-light'), status: $('am-status'), title: $('am-title'), where: $('am-where'),
  now: $('am-now'), res: $('am-res'), trend: $('am-trend'), hints: $('am-hints'), share: $('am-share'),
  chartCard: $('am-chart-card'), chartTitle: $('am-chart-title'), chart: $('am-chart'), slipsCard: $('am-slips-card'), slips: $('am-slips'),
  alarm: $('am-alarm'), alarmForm: $('am-alarm-form'), mail: $('am-mail'), website: $('am-website'), alarmBtn: $('am-alarm-btn'), alarmMsg: $('am-alarm-msg'),
};

const state = { gauges: [], byId: new Map(), gauge: null, mindest: null, hoehe: null, boot: 'motor', history: new Map(), slips: null };

// ------------------------------------------------------------------ Einstellungen (localStorage, URL)
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
function savePrefs() {
  try { localStorage.setItem(KEY, JSON.stringify({ pegel: state.gauge?.id || null, min: state.mindest, boot: state.boot, hoehe: state.hoehe })); } catch { /* nur Komfort */ }
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
function parseHoehe(v) {
  const n = Number(String(v ?? '').trim().replace(',', '.'));
  return String(v ?? '').trim() && Number.isFinite(n) && n > 0 && n < 50 ? Math.round(n * 100) / 100 : null;
}
const fmtM = (m) => m.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const gaugeLabel = (g) => (g.water ? `${g.water} · Pegel ${g.name}` : `Pegel ${g.name}`);

// ------------------------------------------------------------------ Pegelsuche
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/ß/g, 'ss');
let hits = [], active = -1;

function search(q) {
  const n = norm(q.trim().replace(/\bpegel\b|·/gi, ' '));
  if (!n.trim()) return [];
  const words = n.split(/\s+/).filter(Boolean);
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
  el.q.addEventListener('focus', () => { if (state.gauge && el.q.value === gaugeLabel(state.gauge)) el.q.select(); });
  document.addEventListener('click', (e) => { if (!e.target.closest('.am-search')) hideList(); });
}

function pick(g, user = true) {
  state.gauge = g;
  el.q.value = gaugeLabel(g);
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
  el.status.textContent = keinMin ? 'Noch keine Bewertung' : STATUS[status].label;
  el.title.textContent = keinMin ? 'Gib deinen Mindestpegel ein' : STATUS[status].titel;

  el.now.textContent = `${Math.round(g.value)} ${g.unit}`;
  if (r.reserve === null || keinMin) { el.res.textContent = '–'; el.res.className = ''; }
  else {
    el.res.textContent = `${r.reserve >= 0 ? '+' : '−'}${Math.abs(Math.round(r.reserve))} cm`;
    el.res.className = r.reserve >= PUFFER_CM ? 't-plus' : r.reserve < 0 ? 't-minus' : 't-warn';
  }
  el.trend.textContent = tr ? tr.richtung : '–';
  el.trend.className = !tr ? '' : tr.richtung === 'fallend' ? 't-warn' : tr.richtung === 'steigend' ? 't-plus' : '';

  const hinweise = keinMin ? [{ typ: 'info', text: 'Trag oben ein, ab welchem Pegel du an dieser Stelle durchkommst.' }] : r.hinweise;
  el.hints.replaceChildren(...hinweise.map(x => h('li', { class: `c-${x.typ}` }, h('i', { 'aria-hidden': 'true', text: CHECK[x.typ] || 'i' }), h('span', { text: x.text }))));
  el.where.textContent = [gaugeLabel(g), `Stand ${formatTime(g.time)}`, tr ? `${tr.cmProTag >= 0 ? '+' : '−'}${Math.abs(Math.round(tr.cmProTag))} cm pro Tag` : null,
    BOOTSTYPEN[state.boot], keinMin ? null : `Mindestpegel ${state.mindest} cm`, state.hoehe ? `Höhe über Wasser ${fmtM(state.hoehe)} m` : null].filter(Boolean).join(' · ');

  renderChart(g, pts);
}

/** Tageswerte (Mittel je Kalendertag, heute = aktueller Wert) als Balken mit gestrichelter Mindestpegel-Linie. */
function tageswerte(pts, g) {
  const tage = new Map();
  for (const p of pts) {
    const d = new Date(p.t); const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const e = tage.get(k) || { t: p.t, sum: 0, n: 0, min: Infinity, max: -Infinity };
    e.sum += p.v; e.n++; e.min = Math.min(e.min, p.v); e.max = Math.max(e.max, p.v); tage.set(k, e);
  }
  const out = [...tage.values()].slice(-VERLAUF_TAGE).map(e => ({ t: e.t, v: e.sum / e.n, min: e.min, max: e.max }));
  if (out.length) out[out.length - 1].v = g.value;
  return out;
}

function renderChart(g, pts) {
  el.chartCard.hidden = false;
  const tage = tageswerte(pts, g);
  if (tage.length < 2) { el.chart.replaceChildren(h('p', { class: 'am-note', text: 'Kein Verlauf verfügbar.' })); return; }
  el.chartTitle.textContent = `Pegel letzte ${tage.length} Tage`;
  const W = 340, H = 150, T = 14, B = 4, gap = 4;
  const min = state.mindest;
  const vals = tage.map(d => d.v);
  let lo = Math.min(...vals, min ?? Infinity), hi = Math.max(...vals, min ?? -Infinity);
  const pad = Math.max((hi - lo) * 0.25, 10);
  lo -= pad; hi += pad * 0.3;
  const y = (v) => T + (hi - v) / (hi - lo) * (H - T - B);
  const bw = (W - gap * (tage.length - 1)) / tage.length;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'am-bars', role: 'img',
    'aria-label': `Pegel der letzten ${tage.length} Tage, von ${Math.round(Math.min(...vals))} bis ${Math.round(Math.max(...vals))} cm${min !== null ? `, Mindestpegel ${min} cm` : ''}` });
  tage.forEach((d, i) => {
    const x = i * (bw + gap), top = y(d.v);
    const cls = 'b' + (i === tage.length - 1 ? ' b-now' : '') + (min !== null && d.v < min ? ' b-low' : '');
    const rect = svgEl('rect', { x: x.toFixed(1), y: top.toFixed(1), width: bw.toFixed(1), height: Math.max(H - B - top, 2).toFixed(1), rx: 3, class: cls });
    const title = svgEl('title'); title.textContent = `${tagLabel(d.t)}: ${Math.round(d.v)} cm`; rect.append(title);
    svg.append(rect);
  });
  if (min !== null) {
    svg.append(svgEl('line', { x1: 0, x2: W, y1: y(min), y2: y(min), class: 'min' }));
    const t = svgEl('text', { x: 4, y: y(min) - 5, class: 'min-l' }); t.textContent = 'Minimum'; svg.append(t);
  }
  const verfuegbar = (pts[pts.length - 1].t - pts[0].t) / 864e5;
  const kopf = h('tr', {}, ['Tag', 'Mittel (cm)', 'Tiefster (cm)', 'Höchster (cm)'].map(t => h('th', { text: t })));
  const zeilen = tage.map(d => h('tr', {}, [tagLabel(d.t), d.v, d.min, d.max].map((v, i) => h('td', { text: i ? String(Math.round(v)) : v }))));
  const tabelle = h('details', { class: 'am-table' }, h('summary', { text: 'Tageswerte als Tabelle' }),
    h('table', {}, h('thead', {}, kopf), h('tbody', {}, zeilen)));
  const achse = h('div', { class: 'am-axis' }, h('span', { text: `vor ${tage.length} Tagen` }), h('span', { text: 'heute' }));
  const kurz = verfuegbar < VERLAUF_TAGE - 1 ? h('p', { class: 'am-chart-note', text: `Nur ${Math.max(1, Math.round(verfuegbar))} Tage Verlauf verfügbar.` }) : null;
  el.chart.replaceChildren(...[svg, achse, kurz, tabelle].filter(Boolean));
}
const tagLabel = (t) => new Date(t).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });

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

// ------------------------------------------------------------------ E-Mail-Alarm
async function alarmApi(body) {
  const res = await fetch(ALARM_API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  let data = {};
  try { data = await res.json(); } catch { /* leer */ }
  if (!res.ok) throw new Error(data.fehler || 'Das hat gerade nicht geklappt. Bitte später erneut versuchen.');
  return data;
}
function alarmMsg(text, err = false) { el.alarmMsg.textContent = text; el.alarmMsg.classList.toggle('is-err', err); }

async function alarmAnmelden(e) {
  e.preventDefault();
  const email = el.mail.value.trim();
  if (!state.gauge || state.mindest === null) { alarmMsg('Bitte oben zuerst einen Pegel wählen und deinen Mindestpegel eingeben.', true); return; }
  if (!el.mail.checkValidity() || !email) { alarmMsg('Bitte eine gültige E-Mail-Adresse eingeben.', true); el.mail.focus(); return; }
  el.alarmBtn.disabled = true; alarmMsg('Wird gesendet …');
  try {
    await alarmApi({ aktion: 'anmelden', email, pegel: state.gauge.id, min: state.mindest, website: el.website.value });
    alarmMsg(`Fast geschafft: Wir haben dir eine Mail an ${email} geschickt. Bitte bestätige den Alarm über den Link darin.`);
    el.mail.value = '';
  } catch (err) { alarmMsg(err.message, true); }
  finally { el.alarmBtn.disabled = false; }
}

/** Links aus den Mails: ?alarm-bestaetigen=… bzw. ?alarm-abmelden=… (erst die Seite bestätigt per POST – Mail-Scanner lösen nichts aus). */
async function alarmLink(params) {
  const ja = params.get('alarm-bestaetigen'), nein = params.get('alarm-abmelden');
  if (!ja && !nein) return;
  const u = new URL(location.href); u.searchParams.delete('alarm-bestaetigen'); u.searchParams.delete('alarm-abmelden');
  history.replaceState(null, '', u);                 // Token nicht im Verlauf oder beim Teilen weitergeben
  el.alarm.scrollIntoView({ block: 'center' });
  alarmMsg(ja ? 'Alarm wird bestätigt …' : 'Alarm wird abbestellt …');
  try {
    const r = await alarmApi(ja ? { aktion: 'bestaetigen', token: ja } : { aktion: 'abmelden', token: nein });
    alarmMsg(ja ? `Dein Pegel-Alarm für ${r.pegelName} ist aktiv. Wir melden uns, wenn sich die Ampel ändert.` : 'Dein Pegel-Alarm ist abbestellt. Wir schicken dir keine Mails mehr dazu.');
  } catch (err) { alarmMsg(err.message, true); }
}

// ------------------------------------------------------------------ Start
async function init() {
  $('am-logo').innerHTML = logoSvg(32);
  mountNav({ top: $('topnav'), bottom: $('bottomnav'), active: 'pegel', reportLink: true });
  $('am-searchico').innerHTML = icon('search', 22);
  $('am-bell').innerHTML = icon('bell', 26);

  const params = new URLSearchParams(location.search);
  const prefs = loadPrefs();
  const fromUrl = params.has('pegel');
  state.mindest = parseMin(fromUrl ? params.get('min') : prefs.min);
  const boot = fromUrl ? params.get('boot') : prefs.boot;
  state.boot = BOOTSTYPEN[boot] ? boot : 'motor';
  state.hoehe = parseHoehe(prefs.hoehe);
  if (state.mindest !== null) el.min.value = String(state.mindest);
  if (state.hoehe) { el.hoehe.value = fmtM(state.hoehe); el.hoeheHelp.hidden = false; }
  el.boot.querySelector(`input[value="${state.boot}"]`).checked = true;

  wireSearch();
  const rerender = () => { if (state.gauge) { syncUrl(); render(state.gauge, state.history.get(state.gauge.id) || []); } };
  el.min.addEventListener('input', debounce(() => { state.mindest = parseMin(el.min.value); savePrefs(); rerender(); }, 250));
  el.hoehe.addEventListener('input', debounce(() => { state.hoehe = parseHoehe(el.hoehe.value); el.hoeheHelp.hidden = !state.hoehe; savePrefs(); rerender(); }, 300));
  el.boot.addEventListener('change', (e) => { state.boot = e.target.value; savePrefs(); rerender(); });
  el.share.addEventListener('click', share);
  el.alarmForm.addEventListener('submit', alarmAnmelden);

  alarmLink(params);
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

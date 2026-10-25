// Pegelstände der Bundeswasserstraßen (PEGELONLINE, WSV). Die App fragt über die eigene Domain an
// (/api/pegel/… → Netlify leitet an PEGELONLINE weiter, siehe public/_redirects): keine CSP-Ausnahme,
// keine IP-Adressen der Besucher bei Dritten. Text aus den Daten wird nur als Text eingefügt.
import { CONFIG } from './config.js';
import { schoenerName } from './pegel-namen.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { s, niceStep, fmtNum, abfahren } from './chart.js';

// Zustände (Status-Farben: nie allein – immer mit Wert, Pfeil bzw. Symbol und Text)
export const GAUGE_STATES = {
  hsw:     { label: 'Über HSW – Schifffahrt eingeschränkt', short: 'über HSW', color: '#D03B3B', ico: 'alert' },
  high:    { label: 'Hochwasser (über MHW)', short: 'hoch', color: '#EC835A', ico: 'alert' },
  normal:  { label: 'Normaler Wasserstand', short: 'normal', color: '#6CBF84', ico: 'check' },
  low:     { label: 'Niedrigwasser (unter MNW)', short: 'niedrig', color: '#FAB219', ico: 'alert' },
  unknown: { label: 'Einordnung nicht möglich', short: 'ohne Einordnung', color: '#8A99A6', ico: 'info' },
  old:     { label: 'Messwert veraltet', short: 'veraltet', color: '#8A99A6', ico: 'clock' },
};

const REFS = {
  MNW: 'Mittleres Niedrigwasser', MW: 'Mittelwasser', MHW: 'Mittleres Hochwasser', HSW: 'Höchster Schifffahrtswasserstand',
};

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const zahl = (v) => (typeof v === 'string' && /^\s*-?\d+([.,]\d+)?\s*$/.test(v) ? Number(v.replace(',', '.')) : num(v));

/** Wandelt einen Eintrag aus stations.json in ein schlankes Objekt um; null, wenn unbrauchbar. */
export function normalizeStation(s, now = Date.now()) {
  if (!s || typeof s.uuid !== 'string') return null;
  const lat = num(s.latitude), lon = num(s.longitude);
  if (lat === null || lon === null) return null;
  const ts = (s.timeseries || []).find(t => t && t.shortname === 'W');
  const cm = ts?.currentMeasurement;
  const value = num(cm?.value);
  if (!ts || value === null) return null;
  const refs = {};
  for (const c of ts.characteristicValues || []) {
    if (c && REFS[c.shortname] && num(c.value) !== null && (!c.unit || c.unit === ts.unit)) refs[c.shortname] = c.value;
  }
  // Tide-Kennwerte (MThw, MTnw, MTmw …) werden nicht als niedrig/hoch bewertet, zeigen aber einen Tidepegel an.
  // Werte auch als Text („651“, „651,0“), Einheit nur verwerfen, wenn sie eindeutig nicht cm ist.
  const tideRefs = {}, tideRoh = [];
  for (const c of ts.characteristicValues || []) {
    const name = String(c?.shortname || '').trim();
    if (!/^[MHN]{0,2}T[HNM][WB]?$/i.test(name.replace(/\s+/g, ''))) continue;
    tideRoh.push(`${name}=${c.value ?? '–'}${c.unit ? ' ' + c.unit : ''}`);
    const k = { MTHW: 'MThw', MTNW: 'MTnw', MTMW: 'MTmw' }[name.replace(/\s+/g, '').toUpperCase()];
    const v = zahl(c.value);
    if (k && v !== null && (!c.unit || /^cm/i.test(c.unit))) tideRefs[k] = v;
  }
  const tide = tideRoh.length > 0;
  const time = cm.timestamp ? Date.parse(cm.timestamp) : NaN;
  const old = !Number.isFinite(time) || now - time > CONFIG.PEGEL_STALE_HOURS * 3600e3;
  let state = 'unknown';
  if (old) state = 'old';
  else if (cm.stateNswHsw === 'high' || (refs.HSW !== undefined && value > refs.HSW)) state = 'hsw';
  else if (['low', 'normal', 'high'].includes(cm.stateMnwMhw)) state = cm.stateMnwMhw;
  // Ohne Einordnung von PEGELONLINE selbst einordnen, wenn MNW und MHW bekannt sind
  else if (refs.MNW !== undefined && refs.MHW !== undefined) state = value < refs.MNW ? 'low' : value > refs.MHW ? 'high' : 'normal';
  return {
    id: s.uuid, number: s.number ? String(s.number) : null,
    name: schoenerName(s.longname || s.shortname || 'Pegel'), nameRoh: s.longname || s.shortname || '',
    water: schoenerName(s.water?.longname || s.water?.shortname || ''),
    km: num(s.km), agency: s.agency || '',
    lat, lon, value, unit: ts.unit || 'cm',
    time: Number.isFinite(time) ? time : null,
    // PEGELONLINE liefert den Trend nicht immer (auch als Text); fehlt er, kommt er später aus dem Verlauf
    trend: cm.trend !== null && cm.trend !== undefined && cm.trend !== '' && [-1, 0, 1].includes(Number(cm.trend)) ? Number(cm.trend) : null,
    state, refs, tide, tideRefs,
    // Roh-Kennwerte nur, wenn keine Tide-Kennwerte erkannt wurden (für die Prüfliste)
    ...(tide && !Object.keys(tideRefs).length ? { tideRoh } : {}),
  };
}

async function getJson(path) {
  const res = await fetch(CONFIG.PEGEL_BASE + path, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function loadGauges() {
  const raw = await getJson('stations.json?timeseries=W&includeTimeseries=true&includeCurrentMeasurement=true&includeCharacteristicValues=true');
  if (!Array.isArray(raw)) throw new Error('Unerwartete Antwort');
  const now = Date.now();
  return raw.map(s => normalizeStation(s, now)).filter(Boolean);
}

export async function loadHistory(id, days = CONFIG.PEGEL_HISTORY_DAYS) {
  const raw = await getJson(`stations/${encodeURIComponent(id)}/W/measurements.json?start=P${days}D`);
  if (!Array.isArray(raw)) throw new Error('Unerwartete Antwort');
  return raw.map(m => ({ t: Date.parse(m.timestamp), v: num(m.value) }))
    .filter(m => Number.isFinite(m.t) && m.v !== null).sort((a, b) => a.t - b.t);
}

// ------------------------------------------------------------------ Darstellung
const TREND = { 1: '↑', 0: '→', '-1': '↓' };
const TREND_TEXT = { 1: 'steigend', 0: 'gleichbleibend', '-1': 'fallend' };

export function formatTime(t, withDay = true) {
  if (!t) return 'unbekannt';
  const d = new Date(t);
  const today = new Date();
  const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  if (!withDay || d.toDateString() === today.toDateString()) return `${time} Uhr`;
  return `${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}, ${time} Uhr`;
}

/** Marker-HTML (nur feste Strings und Zahlen). Bei kleinem Zoom blendet CSS den Wert aus. */
export function gaugeMarkerHtml(g, selected = false) {
  const st = GAUGE_STATES[g.state];
  const arrow = g.trend === null ? '' : `<i>${TREND[g.trend]}</i>`;
  return `<span class="wm-gauge-pill${selected ? ' is-selected' : ''}"><b style="background:${st.color}"></b><span>${fmtNum(g.value)}&nbsp;${g.unit === 'cm' ? 'cm' : ''}</span>${arrow}</span>`;
}

/** Detailansicht eines Pegels. history = Promise mit Messreihe. */
export function renderGaugeDetail(g, { history, close, user, distance, weather }) {
  const st = GAUGE_STATES[g.state];
  const head = h('header', { class: 'detail-head' },
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Schließen', title: 'Schließen', html: icon('close', 22), onclick: close }),
    h('div', { class: 'detail-title' },
      h('span', { class: 'badge badge-gauge', html: icon('gauge', 16) }, h('span', { text: 'Pegel' })),
      h('h2', { id: 'detail-name', text: g.name }),
      h('p', { class: 'detail-sub', text: [g.water, g.km !== null ? `km ${g.km.toLocaleString('de-DE')}` : ''].filter(Boolean).join(' · ') }),
      user && distance !== null ? h('p', { class: 'detail-sub', text: `${distance} Luftlinie von deinem Standort` }) : null),
    h('span', { class: 'detail-spacer' }));   // Platz der Favoriten-Schaltfläche bei Standorten

  const body = h('div', { class: 'detail-body' });

  // Kopfzahl: aktueller Wasserstand
  body.append(h('section', { class: 'gauge-now' },
    h('p', { class: 'gauge-label', text: 'Wasserstand' }),
    h('p', { class: 'gauge-value' }, h('strong', { text: fmtNum(g.value) }), h('span', { text: ` ${g.unit}` }),
      g.trend !== null ? h('span', { class: 'gauge-trend', title: TREND_TEXT[g.trend], 'aria-label': TREND_TEXT[g.trend], text: ` ${TREND[g.trend]}` }) : null),
    h('p', { class: 'gauge-time', text: `Stand: ${formatTime(g.time)}${g.trend !== null ? ' · ' + TREND_TEXT[g.trend] : ''}` }),
    h('p', { class: `gauge-state gauge-state-${g.state}` },
      h('span', { class: 'gauge-dot', style: `background:${st.color}` }), h('span', { html: icon(st.ico, 16) }), h('span', { text: st.label }))));

  // Einordnung zwischen Kennwerten
  const meter = gaugeMeter(g);
  if (meter) body.append(h('section', { class: 'block' }, h('h3', { text: 'Einordnung' }), meter));

  // Verlauf
  const chartBox = h('div', { class: 'gauge-chart', 'aria-busy': 'true' }, h('p', { class: 'muted small', text: 'Verlauf wird geladen …' }));
  body.append(h('section', { class: 'block' }, h('h3', { text: `Verlauf der letzten ${CONFIG.PEGEL_HISTORY_DAYS} Tage` }), chartBox));
  history.then(pts => {
    chartBox.removeAttribute('aria-busy');
    chartBox.replaceChildren(...(pts.length > 1 ? historyChart(pts, g) : [h('p', { class: 'unknown', text: 'Keine Messreihe verfügbar.' })]));
  }, () => {
    chartBox.removeAttribute('aria-busy');
    chartBox.replaceChildren(h('p', { class: 'unknown', text: 'Verlauf konnte nicht geladen werden.' }));
  });

  if (weather) body.append(weather);

  body.append(h('a', { class: 'btn btn-outline ampel-link', href: `./pegel-ampel?pegel=${encodeURIComponent(g.id)}`, html: icon('gauge', 18) + '<span>In der Pegel-Ampel prüfen</span>' }));

  body.append(h('p', { class: 'hint', text: 'Pegelwerte beziehen sich auf den Pegelnullpunkt, nicht auf die Wassertiefe. Für Fahrrinnentiefen gelten die amtlichen Bekanntmachungen.' }));

  body.append(h('footer', { class: 'source' },
    h('p', {}, 'Quelle: ', g.number ? h('a', { href: `https://www.pegelonline.wsv.de/gast/stammdaten?pegelnr=${encodeURIComponent(g.number)}`, target: '_blank', rel: 'noopener noreferrer', text: 'PEGELONLINE' }) : 'PEGELONLINE',
      ', Wasserstraßen- und Schifffahrtsverwaltung des Bundes (WSV) · Datenlizenz Deutschland – Zero – 2.0'),
    g.agency ? h('p', { text: `Zuständig: ${schoenerName(g.agency)}` }) : null));

  return [head, body];
}

/** Horizontale Skala MNW – MW – MHW (– HSW) mit Markierung des aktuellen Werts. */
function gaugeMeter(g) {
  const keys = ['MNW', 'MW', 'MHW', 'HSW'].filter(k => g.refs[k] !== undefined);
  if (keys.length < 2) return null;
  const vals = keys.map(k => g.refs[k]);
  const lo = Math.min(...vals, g.value), hi = Math.max(...vals, g.value);
  const pad = (hi - lo) * 0.08 || 10;
  const pos = (v) => `${((v - (lo - pad)) / ((hi + pad) - (lo - pad)) * 100).toFixed(2)}%`;
  const st = GAUGE_STATES[g.state];
  return h('div', { class: 'gauge-meter', role: 'img',
    'aria-label': `Aktuell ${fmtNum(g.value)} ${g.unit}. ` + keys.map(k => `${k} ${fmtNum(g.refs[k])} ${g.unit}`).join(', ') },
    h('div', { class: 'gm-track' },
      g.refs.MNW !== undefined && g.refs.MHW !== undefined
        ? h('div', { class: 'gm-normal', style: `left:${pos(g.refs.MNW)};right:calc(100% - ${pos(g.refs.MHW)})` }) : null,
      keys.map(k => h('div', { class: 'gm-tick' + (k === 'HSW' ? ' is-hsw' : ''), style: `left:${pos(g.refs[k])}` })),
      h('div', { class: 'gm-now', style: `left:${pos(g.value)};background:${st.color}` })),
    h('div', { class: 'gm-labels' }, keys.map(k => h('span', { style: `left:${pos(g.refs[k])}`, title: REFS[k] },
      h('b', { text: k }), h('span', { text: fmtNum(g.refs[k]) })))));
}

// ------------------------------------------------------------------ Verlaufsdiagramm (eigenes SVG, keine Bibliothek)

/** opts.threshold = { value, label } zeichnet eine gestrichelte Linie (z. B. Mindestpegel der Pegel-Ampel). */
export function historyChart(pts, g, { threshold = null } = {}) {
  const W = 360, H = 176, L = 40, R = 46, T = 10, B = 24;
  const vs = pts.map(p => p.v);
  let lo = Math.min(...vs), hi = Math.max(...vs);
  const span = Math.max(hi - lo, 20);
  // Kennwerte nur zeigen, wenn sie das Diagramm nicht platt drücken
  const refs = Object.entries(g.refs).filter(([, v]) => v >= lo - span && v <= hi + span);
  for (const [, v] of refs) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  if (threshold) { lo = Math.min(lo, threshold.value); hi = Math.max(hi, threshold.value); }
  const step = niceStep(Math.max(hi - lo, 10));
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  if (hi === lo) hi = lo + step;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const x = (t) => L + (t - t0) / Math.max(t1 - t0, 1) * (W - L - R);
  const y = (v) => T + (hi - v) / (hi - lo) * (H - T - B);

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'gc-svg', role: 'img',
    'aria-label': `Wasserstand ${pts.length} Messwerte, von ${fmtNum(Math.min(...vs))} bis ${fmtNum(Math.max(...vs))} ${g.unit}` });

  // Raster und y-Achse
  for (let v = lo; v <= hi + 1e-9; v += step) {
    svg.append(s('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'gc-grid' }));
    const t = s('text', { x: L - 6, y: y(v) + 4, class: 'gc-axis', 'text-anchor': 'end' }); t.textContent = fmtNum(v); svg.append(t);
  }
  // x-Achse: Mitternacht jedes Tages
  const day = new Date(t0); day.setHours(24, 0, 0, 0);
  for (let d = day.getTime(); d < t1; d += 864e5) {
    svg.append(s('line', { x1: x(d), x2: x(d), y1: T, y2: H - B, class: 'gc-grid' }));
    const t = s('text', { x: x(d) + 3, y: H - 8, class: 'gc-axis' });
    t.textContent = new Date(d).toLocaleDateString('de-DE', { weekday: 'short' }).replace('.', ''); svg.append(t);
  }
  // Kennwerte als Haarlinien mit Beschriftung rechts
  for (const [k, v] of refs) {
    svg.append(s('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'gc-ref' + (k === 'HSW' ? ' is-hsw' : '') }));
    const t = s('text', { x: W - R + 4, y: y(v) + 4, class: 'gc-reflabel' }); t.textContent = k; svg.append(t);
  }
  if (threshold) {
    svg.append(s('line', { x1: L, x2: W - R, y1: y(threshold.value), y2: y(threshold.value), class: 'gc-threshold' }));
    const t = s('text', { x: W - R + 4, y: y(threshold.value) + 4, class: 'gc-reflabel gc-threshold-label' }); t.textContent = threshold.label; svg.append(t);
  }
  // Linie (Lücken > 1 h werden nicht überbrückt) und Fläche
  let d = '', prev = null;
  for (const p of pts) { d += (prev && p.t - prev.t <= 3600e3 ? 'L' : 'M') + x(p.t).toFixed(1) + ' ' + y(p.v).toFixed(1); prev = p; }
  const area = `M${x(t0).toFixed(1)} ${y(lo)}` + pts.map(p => `L${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join('') + `L${x(t1).toFixed(1)} ${y(lo)}Z`;
  svg.append(s('path', { d: area, class: 'gc-area' }), s('path', { d, class: 'gc-line' }));
  const last = pts[pts.length - 1];
  svg.append(s('circle', { cx: x(last.t), cy: y(last.v), r: 4, class: 'gc-dot' }));

  // Fadenkreuz + Tooltip
  const cross = s('line', { y1: T, y2: H - B, class: 'gc-cross', visibility: 'hidden' });
  const hdot = s('circle', { r: 4, class: 'gc-dot', visibility: 'hidden' });
  const hit = s('rect', { x: L, y: 0, width: W - L - R, height: H, fill: 'transparent' });
  svg.append(cross, hdot, hit);
  const tip = h('div', { class: 'gc-tip', hidden: true });
  const wrap = h('div', { class: 'gc-wrap' }, svg, tip);
  const move = (clientX) => {
    const r = svg.getBoundingClientRect();
    const px = Math.min(Math.max((clientX - r.left) / r.width * W, L), W - R);
    const t = t0 + (px - L) / (W - L - R) * (t1 - t0);
    let i = 0, best = Infinity;
    for (let j = 0; j < pts.length; j++) { const dd = Math.abs(pts[j].t - t); if (dd < best) { best = dd; i = j; } }
    const p = pts[i], cx = x(p.t), cy = y(p.v);
    cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
    hdot.setAttribute('cx', cx); hdot.setAttribute('cy', cy); hdot.setAttribute('visibility', 'visible');
    tip.hidden = false;
    tip.textContent = `${new Date(p.t).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })} ${new Date(p.t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} · ${fmtNum(p.v)} ${g.unit}`;
    const left = cx / W * r.width;
    const half = tip.offsetWidth / 2;   // nie über den Rand hinaus
    tip.style.left = `${Math.min(Math.max(left, half), r.width - half)}px`;
  };
  const leave = () => { cross.setAttribute('visibility', 'hidden'); hdot.setAttribute('visibility', 'hidden'); tip.hidden = true; };
  abfahren(wrap, { zeigen: move, verstecken: leave });

  // Tabellenansicht (Tageswerte) für Screenreader und zum Nachlesen
  const days = new Map();
  for (const p of pts) {
    const k = new Date(p.t).toDateString();
    const e = days.get(k) || { t: p.t, min: Infinity, max: -Infinity };
    e.min = Math.min(e.min, p.v); e.max = Math.max(e.max, p.v); days.set(k, e);
  }
  const table = h('details', { class: 'gc-table' }, h('summary', { text: 'Tageswerte als Tabelle' }),
    h('table', {}, h('thead', {}, h('tr', {}, h('th', { text: 'Tag' }), h('th', { text: `Tiefster (${g.unit})` }), h('th', { text: `Höchster (${g.unit})` }))),
      h('tbody', {}, [...days.values()].map(e => h('tr', {},
        h('td', { text: new Date(e.t).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }) }),
        h('td', { text: fmtNum(e.min) }), h('td', { text: fmtNum(e.max) }))))));
  return [wrap, table];
}

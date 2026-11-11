// Pegelstände der Bundeswasserstraßen (PEGELONLINE, WSV). Die App fragt über die eigene Domain an
// (/api/pegel/… → Netlify leitet an PEGELONLINE weiter, siehe public/_redirects): keine CSP-Ausnahme,
// keine IP-Adressen der Besucher bei Dritten. Text aus den Daten wird nur als Text eingefügt.
import { CONFIG } from './config.js';
import { schoenerName } from './pegel-namen.js';
import { h } from './dom.js';
import { s, niceStep, fmtNum, abfahren } from './chart.js';

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

/** Zusatzwerte (Wassertemperatur, Abfluss) gelten nur, wenn die Messung höchstens so alt ist – sonst werden sie nicht gezeigt. */
export const ZUSATZ_MAX_ALTER_H = 24;
const ERSTE_GROSS = (t) => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * Aus der Stationsantwort (stations/<id>.json mit Zeitreihen, aktuellen Messwerten, Vorhersagen und Kennwerten):
 *  wt, q: { v, t, unit } nur mit gültigem Zahlenwert UND Zeitstempel, höchstens ZUSATZ_MAX_ALTER_H alt (0 °C bleibt 0 °C;
 *         fehlende, ungültige oder veraltete Werte → null, nie ein Ersatzwert)
 *  wv: gibt es eine Wasserstandsvorhersage?
 *  kennwerte: alle Kennwerte des Wasserstands mit amtlichem Namen, nach Wert sortiert
 *             [{ k, name, v, zeitraum: '1996–2006' | null, datum: '1953' | null }]
 */
export function zusatzAusStation(raw, now = Date.now()) {
  const ts = (k) => (raw?.timeseries || []).find(t => t && t.shortname === k);
  const wert = (t) => {
    const v = num(t?.currentMeasurement?.value), z = Date.parse(t?.currentMeasurement?.timestamp || '');
    if (v === null || !Number.isFinite(z) || now - z > ZUSATZ_MAX_ALTER_H * 3600e3 || z - now > 3600e3) return null;
    return { v, t: z, unit: t.unit || '' };
  };
  const w = ts('W');
  const jahr = (d) => (typeof d === 'string' && /^\d{4}/.test(d) ? d.slice(0, 4) : null);
  const kennwerte = (w?.characteristicValues || [])
    .filter(c => c && typeof c.shortname === 'string' && num(c.value) !== null && (!c.unit || c.unit === (w.unit || 'cm')))
    .map(c => ({
      k: c.shortname.replace(/_/g, ' '),
      name: ERSTE_GROSS(String(c.longname || c.shortname).replace(/_/g, ' ').trim()),
      v: c.value,
      zeitraum: jahr(c.timespanStart) && jahr(c.timespanEnd) ? `${jahr(c.timespanStart)}–${jahr(c.timespanEnd)}` : null,
      datum: Array.isArray(c.occurrences) && jahr(c.occurrences[0]) ? jahr(c.occurrences[0]) : null,
    }))
    .sort((a, b) => a.v - b.v);
  return { wt: wert(ts('WT')), q: wert(ts('Q')), wv: !!ts('WV'), kennwerte };
}

/** Zusatzwerte eines Pegels (nur bei Bedarf, nicht in der Stationsliste), siehe zusatzAusStation(). */
export async function loadZusatz(id) {
  const raw = await getJson(`stations/${encodeURIComponent(id)}.json?includeTimeseries=true&includeCurrentMeasurement=true&includeForecastTimeseries=true&includeCharacteristicValues=true`);
  return zusatzAusStation(raw);
}

/** Messreihe einer anderen Größe (z. B. WT) über `tage`. */
export async function loadReihe(id, kurz, tage = 1) {
  const raw = await getJson(`stations/${encodeURIComponent(id)}/${kurz}/measurements.json?start=P${tage}D`);
  if (!Array.isArray(raw)) throw new Error('Unerwartete Antwort');
  return raw.map(m => ({ t: Date.parse(m.timestamp), v: num(m.value) })).filter(m => Number.isFinite(m.t) && m.v !== null).sort((a, b) => a.t - b.t);
}

/** Wasserstandsvorhersage (WV): [{ t, v, art: 'forecast' | 'estimate' }], nur Zeitpunkte ab jetzt minus 1 h. */
export async function loadVorhersage(id, now = Date.now()) {
  const raw = await getJson(`stations/${encodeURIComponent(id)}/WV/measurements.json`);
  if (!Array.isArray(raw)) throw new Error('Unerwartete Antwort');
  return raw.map(m => ({ t: Date.parse(m.timestamp), v: num(m.value), art: m.type === 'estimate' ? 'estimate' : 'forecast' }))
    .filter(m => Number.isFinite(m.t) && m.v !== null && m.t >= now - 3600e3).sort((a, b) => a.t - b.t);
}

// ------------------------------------------------------------------ Darstellung

export function formatTime(t, withDay = true) {
  if (!t) return 'unbekannt';
  const d = new Date(t);
  const today = new Date();
  const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  if (!withDay || d.toDateString() === today.toDateString()) return `${time} Uhr`;
  return `${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}, ${time} Uhr`;
}

// ------------------------------------------------------------------ Verlaufsdiagramm (eigenes SVG, keine Bibliothek)

let schraffurNr = 0;
/** opts.threshold = { value, label } zeichnet eine gestrichelte Linie (z. B. Mindestpegel der Pegel-Ampel). */
export function historyChart(pts, g, { threshold = null, vorhersage = null } = {}) {
  const W = 360, H = 176, L = 40, R = 46, T = 10, B = 24;
  // Vorhersage (PEGELONLINE „WV“): gestrichelt rechts von „jetzt“, nur Zeitpunkte nach der letzten Messung
  const tJetzt = pts[pts.length - 1].t;
  const wv = (vorhersage || []).filter(p => p.t > tJetzt);
  const alle = wv.length ? [...pts, ...wv] : pts;
  const vs = alle.map(p => p.v);
  let lo = Math.min(...vs), hi = Math.max(...vs);
  const span = Math.max(hi - lo, 20);
  // Kennwerte nur zeigen, wenn sie das Diagramm nicht platt drücken
  const refs = Object.entries(g.refs).filter(([, v]) => v >= lo - span && v <= hi + span);
  for (const [, v] of refs) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  if (threshold) { lo = Math.min(lo, threshold.value); hi = Math.max(hi, threshold.value); }
  const step = niceStep(Math.max(hi - lo, 10));
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  if (hi === lo) hi = lo + step;
  const t0 = pts[0].t, t1 = alle[alle.length - 1].t;
  const x = (t) => L + (t - t0) / Math.max(t1 - t0, 1) * (W - L - R);
  const y = (v) => T + (hi - v) / (hi - lo) * (H - T - B);

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'gc-svg', role: 'img',
    'aria-label': `Wasserstand ${pts.length} Messwerte, von ${fmtNum(Math.min(...pts.map(p => p.v)))} bis ${fmtNum(Math.max(...pts.map(p => p.v)))} ${g.unit}`
      + (wv.length ? `; Vorhersage bis ${new Date(t1).toLocaleDateString('de-DE', { weekday: 'long' })}: ${fmtNum(Math.min(...wv.map(p => p.v)))} bis ${fmtNum(Math.max(...wv.map(p => p.v)))} ${g.unit}` : '') });
  // Vorhersage-Bereich leicht grau, Fläche unter MNW leicht gelb (wie im Flussprofil)
  if (wv.length) svg.append(s('rect', { x: x(tJetzt), y: T, width: W - R - x(tJetzt), height: H - T - B, class: 'gc-vorh-bg' }));
  if (wv.length && g.refs.MNW !== undefined && g.refs.MNW > lo) svg.append(s('rect', { x: L, y: y(Math.min(g.refs.MNW, hi)), width: W - L - R, height: y(lo) - y(Math.min(g.refs.MNW, hi)), class: 'gc-tief' }));

  // Raster und y-Achse
  for (let v = lo; v <= hi + 1e-9; v += step) {
    svg.append(s('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'gc-grid' }));
    const t = s('text', { x: L - 6, y: y(v) + 4, class: 'gc-axis', 'text-anchor': 'end' }); t.textContent = fmtNum(v); svg.append(t);
  }
  // x-Achse je nach Zeitraum: bis 2 Tage alle 6 h (Uhrzeit), bis 10 Tage jede Mitternacht (Wochentag), länger jede Woche (Datum)
  const spanne = t1 - t0;
  const schritt = spanne <= 2 * 864e5 ? 6 * 3600e3 : spanne <= 10 * 864e5 ? 864e5 : 7 * 864e5;
  const start = new Date(t0); start.setMinutes(0, 0, 0);
  if (schritt === 6 * 3600e3) { do start.setHours(start.getHours() + 1); while (start.getHours() % 6); }
  else { start.setHours(24, 0, 0, 0); if (schritt > 864e5) while (start.getDay() !== 1) start.setDate(start.getDate() + 1); }   // Wochen ab Montag
  for (let d = new Date(start); d.getTime() < t1; schritt === 6 * 3600e3 ? d.setHours(d.getHours() + 6) : d.setDate(d.getDate() + schritt / 864e5)) {
    const tx = d.getTime();
    svg.append(s('line', { x1: x(tx), x2: x(tx), y1: T, y2: H - B, class: 'gc-grid' }));
    const t = s('text', { x: x(tx) + 3, y: H - 8, class: 'gc-axis' });
    t.textContent = schritt === 6 * 3600e3 ? (d.getHours() === 0 ? d.toLocaleDateString('de-DE', { weekday: 'short' }).replace('.', '') : `${String(d.getHours()).padStart(2, '0')}:00`)
      : schritt === 864e5 ? d.toLocaleDateString('de-DE', { weekday: 'short' }).replace('.', '') : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
    svg.append(t);
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
  // Linie und Fläche; Lücken (deutlich länger als der übliche Messabstand) werden nicht überbrückt, sondern schraffiert
  const luecken = messluecken(pts);
  if (luecken.length) {
    const id = `gc-schraffur-${++schraffurNr}`;
    const muster = s('pattern', { id, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
    muster.append(s('line', { x1: 0, y1: 0, x2: 0, y2: 6, class: 'gc-schraffur' }));
    const defs = s('defs', {}); defs.append(muster); svg.append(defs);
    for (const [a, b] of luecken) svg.append(s('rect', { x: x(a), y: T, width: Math.max(x(b) - x(a), 2), height: H - T - B, class: 'gc-luecke', fill: `url(#${id})` }));
  }
  const istLuecke = (p0, p1) => luecken.some(([a, b]) => a === p0.t && b === p1.t);
  let d = '', prev = null;
  for (const p of pts) { d += (prev && !istLuecke(prev, p) ? 'L' : 'M') + x(p.t).toFixed(1) + ' ' + y(p.v).toFixed(1); prev = p; }
  const area = `M${x(t0).toFixed(1)} ${y(lo)}` + pts.map(p => `L${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join('') + `L${x(pts[pts.length - 1].t).toFixed(1)} ${y(lo)}Z`;
  svg.append(s('path', { d: area, class: 'gc-area' }), s('path', { d, class: 'gc-line' }));
  const last = pts[pts.length - 1];
  if (wv.length) {
    const dv = `M${x(last.t).toFixed(1)} ${y(last.v).toFixed(1)}` + wv.map(p => `L${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join('');
    svg.append(s('path', { d: dv, class: 'gc-vorh' }));
    svg.append(s('line', { x1: x(tJetzt), x2: x(tJetzt), y1: T, y2: H - B, class: 'gc-jetzt' }));
    const jt = s('text', { x: x(tJetzt), y: T + 10, class: 'gc-jetzt-text', 'text-anchor': 'middle' }); jt.textContent = 'jetzt'; svg.append(jt);
  }
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
    for (let j = 0; j < alle.length; j++) { const dd = Math.abs(alle[j].t - t); if (dd < best) { best = dd; i = j; } }
    const p = alle[i], cx = x(p.t), cy = y(p.v);
    cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
    hdot.setAttribute('cx', cx); hdot.setAttribute('cy', cy); hdot.setAttribute('visibility', 'visible');
    tip.hidden = false;
    tip.textContent = `${new Date(p.t).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })} ${new Date(p.t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} · ${fmtNum(p.v)} ${g.unit}${p.art ? (p.art === 'estimate' ? ' (Abschätzung)' : ' (Vorhersage)') : ''}`;
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
  const lueckenHinweis = luecken.length ? h('p', { class: 'gc-luecken-text', text: `Schraffiert: ${luecken.length === 1 ? 'eine Lücke' : `${luecken.length} Lücken`} in den Messwerten (keine Daten von PEGELONLINE).` }) : null;
  return lueckenHinweis ? [wrap, lueckenHinweis, table] : [wrap, table];
}

/**
 * Lücken in einer Messreihe: Abstände, die deutlich länger sind als der übliche Messabstand des Pegels
 * (mehr als das 2,5-Fache des Medians, mindestens 90 Minuten, da manche Pegel nur stündlich melden). Rückgabe: [[t_vor, t_nach], …].
 */
export function messluecken(pts) {
  if (!pts || pts.length < 3) return [];
  const abst = [];
  for (let i = 1; i < pts.length; i++) abst.push(pts[i].t - pts[i - 1].t);
  const median = [...abst].sort((a, b) => a - b)[Math.floor(abst.length / 2)];
  const grenze = Math.max(2.5 * median, 90 * 60e3);
  const out = [];
  for (let i = 1; i < pts.length; i++) if (abst[i - 1] > grenze) out.push([pts[i - 1].t, pts[i].t]);
  return out;
}

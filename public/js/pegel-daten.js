// Pegeldaten für Karte, Dashboard und Detailseite: EINE Stationsliste (mit Werten und Kennwerten) für alle,
// Verläufe nur bei Bedarf (zwischengespeichert), „Meine Pegel“ als eigene Liste im Browser.
import { CONFIG } from './config.js';
import { loadGauges, loadHistory } from './pegel.js';

const LS_SNAP = 'watermap.pegel.stand';
const LS_MEINE = 'watermap.meinePegel';
const LS_MEINE_MIGRIERT = 'watermap.meinePegel.ampel';
const REFRESH_MS = CONFIG.PEGEL_REFRESH_MIN * 60e3;

// ------------------------------------------------------------------ Stationsliste
let cache = null;          // { zeit, gauges, byId, offline }
let laufend = null;

// Offline-Stand nur aus derselben Version (Namen und Kennwerte werden beim Normalisieren berechnet)
function snapshotLesen() {
  try { const j = JSON.parse(localStorage.getItem(LS_SNAP) || 'null'); return j && Array.isArray(j.gauges) && j.version === CONFIG.VERSION ? j : null; } catch { return null; }
}
function snapshotSchreiben(zeit, gauges) {
  try { localStorage.setItem(LS_SNAP, JSON.stringify({ version: CONFIG.VERSION, zeit, gauges })); } catch { /* zu groß oder gesperrt: ohne Offline-Stand */ }
}

/** Alle Pegel (normalisiert). force: neu laden. Offline: letzter Stand mit offline: true. */
export function pegelLaden({ force = false } = {}) {
  if (!force && cache && !cache.offline && Date.now() - cache.zeit < REFRESH_MS) return Promise.resolve(cache);
  if (laufend) return laufend;
  laufend = loadGauges().then((gauges) => {
    cache = { zeit: Date.now(), gauges, byId: new Map(gauges.map(g => [g.id, g])), offline: false };
    snapshotSchreiben(cache.zeit, gauges);
    return cache;
  }).catch((e) => {
    if (cache) return { ...cache, offline: true };
    const s = snapshotLesen();
    if (!s) throw e;
    cache = { zeit: s.zeit, gauges: s.gauges, byId: new Map(s.gauges.map(g => [g.id, g])), offline: true };
    return cache;
  }).finally(() => { laufend = null; });
  return laufend;
}

export const pegelStand = () => cache;

// ------------------------------------------------------------------ Verläufe (nur bei Bedarf)
const verlauf = new Map();   // id → { at, promise }
export function verlaufLaden(id) {
  const e = verlauf.get(id);
  if (e && Date.now() - e.at < REFRESH_MS) return e.promise;
  const promise = loadHistory(id, CONFIG.PEGEL_HISTORY_DAYS).catch((err) => { verlauf.delete(id); throw err; });
  verlauf.set(id, { at: Date.now(), promise });
  return promise;
}

/** Trend (-1/0/1) aus den letzten 2 Stunden der Messreihe (ab 2 cm Änderung); null, wenn sie nicht reicht. */
export function trendAusVerlauf(pts) {
  if (!pts || pts.length < 2) return null;
  const last = pts[pts.length - 1];
  const vorher = [...pts].reverse().find(p => p.t <= last.t - 2 * 3600e3);
  if (!vorher || last.t - vorher.t > 4 * 3600e3) return null;
  const d = last.v - vorher.v;
  return d >= 2 ? 1 : d <= -2 ? -1 : 0;
}

/** Änderung in 24 h (cm) aus einer Messreihe; null, wenn sie nicht reicht. */
export function aenderung24h(pts) {
  if (!pts || pts.length < 2) return null;
  const last = pts[pts.length - 1];
  const ziel = last.t - 24 * 3600e3;
  if (pts[0].t > ziel + 3 * 3600e3) return null;
  let best = pts[0];
  for (const p of pts) { if (Math.abs(p.t - ziel) < Math.abs(best.t - ziel)) best = p; if (p.t > ziel) break; }
  return Math.round(last.v - best.v);
}

// ------------------------------------------------------------------ Meine Pegel (getrennt von den Standort-Favoriten)
let memory = null;
function lesen() {
  try { const a = JSON.parse(localStorage.getItem(LS_MEINE) || '[]'); return Array.isArray(a) ? a.filter(x => typeof x === 'string') : []; }
  catch { return memory || []; }
}
function schreiben(a) {
  memory = a;
  try { localStorage.setItem(LS_MEINE, JSON.stringify(a)); } catch { /* nur für diese Sitzung */ }
  document.dispatchEvent(new CustomEvent('meine-pegel'));
}

export const meinePegel = {
  alle: () => lesen(),
  hat: (id) => lesen().includes(id),
  umschalten(id) { const a = lesen(); schreiben(a.includes(id) ? a.filter(x => x !== id) : [...a, id]); return lesen().includes(id); },
  entfernen(id) { schreiben(lesen().filter(x => x !== id)); },
  verschieben(id, um) {
    const a = lesen(); const i = a.indexOf(id); const j = i + um;
    if (i < 0 || j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]]; schreiben(a);
  },
  /** Einmalig: den Pegel aus der Pegel-Ampel als ersten Eintrag übernehmen. */
  ampelUebernehmen() {
    try {
      if (localStorage.getItem(LS_MEINE_MIGRIERT)) return;
      localStorage.setItem(LS_MEINE_MIGRIERT, '1');
      const amp = JSON.parse(localStorage.getItem('watermap.ampel') || '{}');
      if (typeof amp.pegel === 'string' && amp.pegel && !lesen().includes(amp.pegel)) schreiben([amp.pegel, ...lesen()]);
    } catch { /* ohne Speicher keine Übernahme */ }
  },
};

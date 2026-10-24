// Gezeitenvorhersage des BSH für Tidepegel – über die eigene Funktion /api/gezeiten (nie direkt beim BSH).
// Je Pegel einmal pro Stunde; die letzte Vorhersage bleibt offline bis zu CONFIG.GEZEITEN_OFFLINE_STUNDEN sichtbar („Stand von …“).
import { CONFIG } from './config.js';

const STD = 3600e3;
const LS = 'watermap.gezeiten.';
const MAX_GESPEICHERT = 12;
const cache = new Map();      // id → { zeit, wert: Promise }
let orteP = null;

const lesen = (id) => { try { return JSON.parse(localStorage.getItem(LS + id) || 'null'); } catch { return null; } };
function schreiben(id, d) {
  try {
    localStorage.setItem(LS + id, JSON.stringify({ zeit: Date.now(), d }));
    // nur die zuletzt genutzten behalten
    const alle = Object.keys(localStorage).filter(k => k.startsWith(LS)).map(k => [k, lesen(k.slice(LS.length))?.zeit || 0]).sort((a, b) => b[1] - a[1]);
    for (const [k] of alle.slice(MAX_GESPEICHERT)) localStorage.removeItem(k);
  } catch { /* ohne Offline-Stand */ }
}

/** Offline-Stand, wenn nicht älter als erlaubt. */
function offlineStand(id) {
  const s = lesen(id);
  return s?.d && Date.now() - s.zeit <= CONFIG.GEZEITEN_OFFLINE_STUNDEN * STD ? { d: s.d, offline: true, abgerufen: s.zeit } : null;
}

/**
 * Vorhersage für einen Pegel. → Promise<{ d, offline, abgerufen } | null>
 * null: abgeschaltet, kein BSH-Ort für diesen Pegel oder nicht erreichbar (ohne Offline-Stand).
 */
export function vorhersageLaden(g) {
  if (!CONFIG.GEZEITEN_BSH_AKTIV || !g?.id) return Promise.resolve(null);
  const c = cache.get(g.id);
  if (c && Date.now() - c.zeit < STD) return c.wert;
  const url = `${CONFIG.GEZEITEN_BASE}?pegel=${encodeURIComponent(g.id)}${g.number ? `&nr=${encodeURIComponent(g.number)}` : ''}`;
  const wert = fetch(url, { headers: { Accept: 'application/json' } }).then(async (r) => {
    if (r.status === 404) return null;                    // kein BSH-Ort
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    if (!Array.isArray(d?.ereignisse)) throw new Error('unerwartete Antwort');
    schreiben(g.id, d);
    return { d, offline: false, abgerufen: Date.now() };
  }).catch(() => { cache.delete(g.id); return offlineStand(g.id); });
  cache.set(g.id, { zeit: Date.now(), wert });
  return wert;
}

/** Pegel mit BSH-Vorhersage (UUIDs und Pegelnummern) – damit Listen nur diese abfragen. → Promise<{ uuids:Set, nrs:Set }|null> */
export function bshOrte() {
  if (!CONFIG.GEZEITEN_BSH_AKTIV) return Promise.resolve(null);
  orteP ||= fetch(`${CONFIG.GEZEITEN_BASE}?orte=1`).then(r => (r.ok ? r.json() : null)).then((j) => j?.orte ? {
    liste: j.orte, uuids: new Set(j.orte.map(o => o.uuid).filter(Boolean)), nrs: new Set(j.orte.map(o => o.nr).filter(Boolean)),
  } : null).catch(() => { orteP = null; return null; });
  return orteP;
}
export const hatBsh = (o, g) => !!o && (o.uuids.has(g.id) || (!!g.number && o.nrs.has(String(g.number))));

/** Kommende Hoch-/Niedrigwasser (ab jetzt). */
export const kommende = (d, jetzt = Date.now()) => (d?.ereignisse || []).filter(e => e.t >= jetzt);
/** Wert eines Ereignisses: Vorhersage (mit Wind), sonst Gezeitenrechnung. */
export const hoehe = (e) => e.vh ?? e.astro;

/** „in 2 Std. 10 Min.“ / „in 25 Min.“ / „jetzt“ */
export function inText(t, jetzt = Date.now()) {
  const min = Math.round((t - jetzt) / 60e3);
  if (min <= 0) return 'jetzt';
  const s = Math.floor(min / 60), m = min % 60;
  return `in ${s ? `${s} Std.` : ''}${s && m ? ' ' : ''}${m || !s ? `${m} Min.` : ''}`;
}
/** „14:32“ (heute), „morgen 03:13“, sonst „Mo 03:13“ */
export function tagUhr(t, jetzt = Date.now()) {
  const d = new Date(t), h = new Date(jetzt);
  const uhr = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === h.toDateString()) return uhr;
  const morgen = new Date(h); morgen.setDate(h.getDate() + 1);
  if (d.toDateString() === morgen.toDateString()) return `morgen ${uhr}`;
  return `${d.toLocaleDateString('de-DE', { weekday: 'short' }).replace('.', '')} ${uhr}`;
}
/** „Stand 07:32“ bzw. offline „Stand von Fr 07:32 (offline)“ */
export function standText(v, jetzt = Date.now()) {
  const t = v.d.stand || v.abgerufen;
  return v.offline ? `Stand von ${tagUhr(t, jetzt).replace('morgen ', '')} (offline)` : `Stand ${tagUhr(t, jetzt)}`;
}
export const ART = { HW: 'Hochwasser', NW: 'Niedrigwasser' };

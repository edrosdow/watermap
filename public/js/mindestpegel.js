// „Passt mein Boot?“ (Designumbau Phase 2b, 7.71.0): Mindestpegel je Pegel und Bootstyp – nur auf diesem Gerät.
// Die Bewertung selbst steckt unverändert in ampel-logik.js (grün/gelb/rot); hier nur Speicher und Texte für die Oberfläche.
//   watermap.mindestpegel = { <pegelId>: cm }   (neu)
//   watermap.boot         = { typ, laenge, tiefgang }   (typ neu hier; früher in watermap.ampel.boot)
//   watermap.ampel        = { pegel, min, boot, hoehe }  (alt, nur noch gelesen: einmalige Übernahme von Pegel und min)
import { bewerte, trend, BOOTSTYPEN, PUFFER_CM } from './ampel-logik.js';

const LS = 'watermap.mindestpegel', LS_ALT = 'watermap.ampel', LS_BOOT = 'watermap.boot';
export const SCHRITT = 5;   // −/+ in 5-cm-Schritten wie im Alarm-Fenster

const lesen = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const schreiben = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ohne Speicher nur für diese Sitzung */ } };
const gueltig = (v) => Number.isFinite(v) && v >= -500 && v <= 2000;

/** Alle Mindestpegel { id: cm }. Beim ersten Lesen einmalig aus der alten Pegel-Ampel übernommen (Pegel und min). */
export function mindestAlle() {
  let m = lesen(LS);
  if (!m || typeof m !== 'object' || Array.isArray(m)) {
    m = {};
    const a = lesen(LS_ALT);
    if (a && typeof a.pegel === 'string' && a.pegel && gueltig(a.min)) m[a.pegel] = Math.round(a.min);
    schreiben(LS, m);   // ab jetzt gibt es den Schlüssel – die Übernahme läuft nicht noch einmal
  }
  return Object.fromEntries(Object.entries(m).filter(([id, v]) => id && gueltig(v)));
}
export const mindestFuer = (id) => (id ? mindestAlle()[id] ?? null : null);

/** Mindestpegel setzen (cm) oder entfernen (null); meldet die Änderung als Ereignis „mindestpegel“. */
export function mindestSetzen(id, cm) {
  const m = mindestAlle();
  if (cm === null || cm === undefined) delete m[id]; else if (gueltig(cm)) m[id] = Math.round(cm); else return;
  schreiben(LS, m);
  document.dispatchEvent(new CustomEvent('mindestpegel', { detail: { id } }));
}

/** Bootstyp (motor | segel | kanu): watermap.boot.typ, sonst der alte Wert aus watermap.ampel.boot, sonst Motorboot. */
export function bootTyp() {
  const b = lesen(LS_BOOT) || {};
  if (BOOTSTYPEN[b.typ]) return b.typ;
  const a = lesen(LS_ALT) || {};
  return BOOTSTYPEN[a.boot] ? a.boot : 'motor';
}
export function bootTypSetzen(typ) {
  if (BOOTSTYPEN[typ]) schreiben(LS_BOOT, { ...(lesen(LS_BOOT) || {}), typ });
}

/** Ampel-Status → Zustand (Tokens gut/warn/stop) und Wort; immer mit Wort, nie nur Farbe. */
export const AMPEL = {
  gruen: { zustand: 'gut', wort: 'Passt', klein: 'passend' },
  gelb: { zustand: 'warn', wort: 'Knapp', klein: 'knapp' },
  rot: { zustand: 'stop', wort: 'Zu niedrig', klein: 'zu niedrig' },
};
const cm = (v) => Math.round(Math.abs(v)).toLocaleString('de-DE');

/**
 * Ampel für einen Pegel mit Mindestpegel; ohne Mindestpegel null.
 * pts: Messreihe (für den Trend, optional). Rückgabe: { status, reserve, hinweise, zustand, wort, mindest, satz }
 * satz z. B. „Passt – 42 cm über deinem Mindestpegel“.
 */
export function ampel(g, { mindest = mindestFuer(g?.id), pts = null } = {}) {
  if (!g || mindest === null || typeof g.value !== 'number') return null;
  const r = bewerte({ pegel: g, mindest, trend: pts ? trend(pts) : null });
  const a = AMPEL[r.status];
  if (!a || r.reserve === null) return null;
  return { ...r, ...a, mindest, satz: `${a.wort} – ${cm(r.reserve)} cm ${r.reserve < 0 ? 'unter' : 'über'} deinem Mindestpegel` };
}

const stufe = (v, mindest) => (v < mindest ? 'rot' : v - mindest < PUFFER_CM ? 'gelb' : 'gruen');
const wann = (t) => {
  const d = new Date(t);
  return `${d.toLocaleDateString('de-DE', { weekday: 'short' })} ${d.getHours()} Uhr`;
};

/**
 * Kurze Zeile für die nächsten Tage. Mit Vorhersage der WSV (wv = [{t, v}]): wann sich die Ampel ändert oder dass sie bleibt.
 * Ohne Vorhersage: der Trend-Hinweis der Ampel-Logik („Pegel sinkt – in ca. 2 Tagen unter deinem Minimum“). Sonst null.
 */
export function ampelVorschau(g, a, { wv = null } = {}) {
  if (!a) return null;
  const jetzt = stufe(g.value, a.mindest);
  const zukunft = (wv || []).filter(p => Number.isFinite(p.v) && p.t > Date.now());
  if (zukunft.length) {
    const wechsel = zukunft.find(p => stufe(p.v, a.mindest) !== jetzt);
    if (wechsel) return `Vorhersage: ab ${wann(wechsel.t)} ${AMPEL[stufe(wechsel.v, a.mindest)].klein}`;
    return `Vorhersage bis ${wann(zukunft[zukunft.length - 1].t)}: bleibt ${AMPEL[jetzt].klein}`;
  }
  const h = a.hinweise.find(x => /^Pegel (sinkt|steigt)/.test(x.text));
  return h ? h.text : null;
}

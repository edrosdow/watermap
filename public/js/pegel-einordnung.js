// Reine Logik (ohne DOM) für die Pegel-Einordnung: Satz aus den Kennwerten, Lage der Skala, kurzfristige Tendenz.
// Nur Aussagen, die aus den gelieferten Kennwerten folgen; statistische Kennwerte sind keine Warnstufen.
// Tests: tests/pegel_einordnung_test.mjs

const fmt = (v) => Math.round(v).toLocaleString('de-DE');
const STAT = ['MNW', 'MW', 'MHW'];   // statistische Kennwerte (Mittelwerte über eine Zeitspanne)
/** Nächster statistischer Kennwert darunter (≤ Wert) und darüber (> Wert); fehlende Kennwerte bleiben null. */
function nachbarn(refs, v) {
  const da = STAT.filter(k => typeof refs?.[k] === 'number').map(k => ({ k, v: refs[k] })).sort((a, b) => a.v - b.v);
  let unten = null, oben = null;
  for (const r of da) { if (r.v <= v) unten = r; else if (!oben) oben = r; }
  return { unten, oben };
}

/**
 * Kurzfristige Tendenz: Änderung in den letzten `stunden` Stunden (Standard 2 h) aus der Messreihe.
 * Rückgabe { d (cm), richtung: 1 | 0 | -1, stunden } oder null, wenn kein Messwert nahe genug am Anfang des Zeitraums liegt.
 * Ab 2 cm gilt sie als steigend bzw. fallend.
 */
export function tendenz(pts, stunden = 2) {
  if (!pts || pts.length < 2) return null;
  const last = pts[pts.length - 1], ziel = last.t - stunden * 3600e3;
  let best = null;
  for (const p of pts) { if (p.t >= last.t) break; if (!best || Math.abs(p.t - ziel) < Math.abs(best.t - ziel)) best = p; }
  if (!best || Math.abs(best.t - ziel) > 40 * 60e3) return null;
  const d = Math.round(last.v - best.v);
  return { d, richtung: d >= 2 ? 1 : d <= -2 ? -1 : 0, stunden };
}

const PFEIL = { 1: '↗', 0: '→', '-1': '↘' }, WORT = { 1: 'steigend', 0: 'gleichbleibend', '-1': 'fallend' };
const cm = (d) => `${d > 0 ? '+' : d < 0 ? '−' : '±'}${fmt(Math.abs(d))} cm`;
/** „↘ fallend, −3 cm“ bzw. null */
export const tendenzText = (t) => (t ? `${PFEIL[t.richtung]} ${WORT[t.richtung]}, ${cm(t.d)}` : null);
/** „+1 cm“ bzw. null */
export const aenderungKurz = (d) => (d === null || d === undefined ? null : cm(d));

/**
 * Lage auf dem Balken „Niedrig · Normal · Hoch“ (feste Breiten 22 % · 56 % · 22 %; innerhalb eines Bereichs maßstäblich).
 * Bereich „Niedrig“ reicht von MNW − 40 % der Spanne MNW–MHW bis MNW, „Hoch“ von MHW bis MHW + 40 %; außerhalb am Rand.
 * Rückgabe { pos: 0–100, zone: 'low' | 'normal' | 'high' } oder null ohne MNW und MHW.
 */
export const ZONEN = [22, 56, 22];
export function zonenLage(refs, wert) {
  const mnw = refs?.MNW, mhw = refs?.MHW;
  if (typeof mnw !== 'number' || typeof mhw !== 'number' || !(mhw > mnw) || !Number.isFinite(wert)) return null;
  const d = (mhw - mnw) * 0.4, [a, b] = ZONEN, k = (x) => Math.min(1, Math.max(0, x));
  if (wert < mnw) return { pos: a * k((wert - (mnw - d)) / d), zone: 'low' };
  if (wert > mhw) return { pos: a + b + ZONEN[2] * k((wert - mhw) / d), zone: 'high' };
  return { pos: a + b * (wert - mnw) / (mhw - mnw), zone: 'normal' };
}

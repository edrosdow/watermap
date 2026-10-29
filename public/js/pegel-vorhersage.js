// Satz zur Wasserstandsvorhersage (PEGELONLINE „WV“) – ohne weitere Abhängigkeiten, damit ihn auch die Netlify-Funktion
// für die Push-Nachricht nutzen kann (netlify/lib/pegel-push-kern.mjs).
const TAG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const cm = (v) => Math.round(v).toLocaleString('de-DE');
const spanne = (a, b) => (Math.round(a) === Math.round(b) ? `${cm(a)} cm` : `${cm(a)}–${cm(b)} cm`);

/**
 * Ein Satz zur Vorhersage, z. B. „Vorhersage: bleibt bis Sonntag knapp unter MNW (91–93 cm).“
 * Nur aus den gelieferten Werten und den amtlichen Kennwerten des Pegels; ohne Vorhersage null.
 */
export function vorhersageSatz(g, wv, jetzt = Date.now()) {
  const pts = (wv || []).filter(p => p.t > jetzt);
  if (pts.length < 2) return null;
  const vs = pts.map(p => p.v), lo = Math.min(...vs), hi = Math.max(...vs), ende = pts[pts.length - 1];
  const tage = Math.round((new Date(ende.t).setHours(0, 0, 0, 0) - new Date(jetzt).setHours(0, 0, 0, 0)) / 864e5);
  const bis = tage <= 0 ? 'heute' : tage === 1 ? 'morgen' : tage < 7 ? TAG[new Date(ende.t).getDay()] : new Date(ende.t).toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric' });
  const r = g.refs || {}, v = g.value;
  let satz;
  if (r.MHW !== undefined && hi > r.MHW) satz = v > r.MHW ? `bleibt bis ${bis} über MHW (${spanne(lo, hi)})` : `steigt bis ${bis} über MHW (bis ${cm(hi)} cm)`;
  else if (r.MNW !== undefined && hi < r.MNW) satz = `bleibt bis ${bis} ${r.MNW - hi <= 10 ? 'knapp ' : ''}unter MNW (${spanne(lo, hi)})`;
  else if (r.MNW !== undefined && lo < r.MNW) satz = v >= r.MNW ? `fällt bis ${bis} unter MNW (bis ${cm(lo)} cm)` : `steigt bis ${bis} wieder über MNW (bis ${cm(hi)} cm)`;
  else if (r.MNW !== undefined && r.MHW !== undefined) satz = `bleibt bis ${bis} im normalen Bereich (${spanne(lo, hi)})`;
  else satz = `bis ${bis} zwischen ${spanne(lo, hi)}`;
  return `Vorhersage: ${satz}.`;
}


// Reine Funktionen für den Pegel-Tab (ohne DOM): Lage-Satz zu „Meine Pegel“ und Wochenend-Ausblick.
// Nichts wird erfunden: was fehlt (Trend, Vorhersage), wird weggelassen bzw. kenntlich gemacht.
import { CONFIG } from './config.js';
import { zustand } from './pegel-ansicht.js';
import { beaufort } from './wetter.js';

const ZUSTAND_WORT = { hsw: 'über HSW', high: 'hoch', low: 'niedrig', old: 'veraltet' };
const TREND_WORT = { 1: 'steigend', '-1': 'fallend' };   // „gleichbleibend“ wird nicht genannt (kein Hinweis)
const TON = { hsw: 'rot', high: 'orange', low: 'gelb', old: 'grau' };

/**
 * Lage-Satz aus den gemerkten Pegeln, als Teile { text, ton? } (ton: für die Farbe, nie allein – der Text sagt dasselbe).
 * eintraege: [{ g, tide }] – g: Pegel, tide: 'auflaufend' | 'ablaufend' | 'kentert' | null (nur Tidepegel).
 * „Deine 3 Pegel: 2 normal, Minden niedrig und fallend, Trier über HSW.“
 */
export function lageSatz(eintraege) {
  const liste = (eintraege || []).filter(e => e?.g);
  if (!liste.length) return null;
  const normal = [], auffaellig = [];
  for (const { g, tide } of liste) {
    const z = zustand(g);
    if (g.tide && z !== 'old') {
      // Tidepegel: keine Bewertung nach niedrig/hoch, sondern die Tendenz
      auffaellig.push({ text: `${g.name} ${tide === 'auflaufend' || tide === 'ablaufend' ? tide : 'Tide'}`, ton: null });
    } else if (ZUSTAND_WORT[z]) {
      const trend = z === 'old' ? null : TREND_WORT[g.trend];
      auffaellig.push({ text: `${g.name} ${ZUSTAND_WORT[z]}${trend ? ` und ${trend}` : ''}`, ton: TON[z] });
    } else normal.push(g);   // normal, ohne Kennwerte, ohne Einordnung: zählt nur
  }
  const n = liste.length;
  if (n === 1) {
    const e = auffaellig[0];
    return [{ text: `Dein Pegel ${liste[0].g.name}: ` }, { text: e ? e.text.slice(liste[0].g.name.length + 1) : 'normal', ton: e?.ton }, { text: '.' }];
  }
  const teile = [];
  if (normal.length) teile.push([{ text: `${normal.length} normal` }]);
  for (const e of auffaellig) teile.push([e]);
  const out = [{ text: `Deine ${n} Pegel: ` }];
  teile.forEach((t, i) => { if (i) out.push({ text: ', ' }); out.push(...t); });
  out.push({ text: '.' });
  return out;
}
export const lageText = (eintraege) => (lageSatz(eintraege) || []).map(t => t.text).join('');

// ------------------------------------------------------------------ Wochenende
const WOCHENTAG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const ymd = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

/**
 * Die zwei Tage des Ausblicks: Samstag und Sonntag; ist heute schon Samstag oder Sonntag, heute und morgen.
 * Rückgabe: { titel, tage: [Date, Date] } (Datum um 0 Uhr, Ortszeit).
 */
export function wochenendTage(jetzt = new Date()) {
  const tag0 = new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate());
  const w = tag0.getDay();   // 0 = Sonntag
  const plus = (n) => new Date(tag0.getFullYear(), tag0.getMonth(), tag0.getDate() + n);
  if (w === 6) return { titel: 'Am Wochenende an deinen Pegeln', tage: [tag0, plus(1)] };
  if (w === 0) return { titel: 'Heute und morgen an deinen Pegeln', tage: [tag0, plus(1)] };
  return { titel: 'Am Wochenende an deinen Pegeln', tage: [plus(6 - w), plus(7 - w)] };
}

/**
 * Stundenwerte → Tageswerte für die gewünschten Tage (nur Stunden 6–21 Uhr zählen, dort ist man auf dem Wasser).
 * stunden: [{ t, temp, icon, wind, gust }] (km/h, °C); Rückgabe je Tag: null, wenn keine Daten, sonst
 * { name, temp (Höchstwert), icon (Symbol um 12–15 Uhr), windKmh (Höchstwert Wind), gustKmh (Höchstwert Böen) }.
 */
export function tageAusStunden(stunden, tage) {
  return tage.map((tag) => {
    const key = ymd(tag);
    const std = (stunden || []).filter(s => ymd(new Date(s.t)) === key && new Date(s.t).getHours() >= 6 && new Date(s.t).getHours() <= 21);
    if (!std.length) return null;
    const max = (f) => { const v = std.map(f).filter(x => typeof x === 'number'); return v.length ? Math.max(...v) : null; };
    const mittag = std.find(s => new Date(s.t).getHours() >= 12 && s.icon) || std.find(s => s.icon);
    return { name: WOCHENTAG[tag.getDay()], datum: tag, temp: max(s => s.temp), icon: mittag?.icon || null, windKmh: max(s => s.wind), gustKmh: max(s => s.gust) };
  });
}

/**
 * Etiketten für einen Tag (Liste, wichtigstes zuerst): { text, ton: 'rot' | 'gelb' | 'gruen' }.
 * pegel: gemerkte Pegel; vorhersageNiedrig: Set/Array der Pegel-IDs, die laut Vorhersage (Stufe 2) bis dahin unter MNW sind.
 */
export function wochenendEtiketten({ pegel, boeKmh, vorhersageNiedrig = [] }) {
  const out = [];
  const zs = (pegel || []).map(g => ({ g, z: zustand(g) }));
  const hoch = zs.filter(x => x.z === 'hsw' || x.z === 'high');
  if (hoch.length) out.push({ text: 'Hochwasser', ton: 'rot' });
  const windig = typeof boeKmh === 'number' && boeKmh >= CONFIG.WETTER_GUST_HINT_KMH;
  if (windig) out.push({ text: 'windig', ton: 'gelb' });
  const knapp = zs.filter(x => x.z === 'low' || (vorhersageNiedrig instanceof Set ? vorhersageNiedrig.has(x.g.id) : vorhersageNiedrig.includes(x.g.id)));
  if (knapp.length) out.push({ text: `${knapp[0].g.name}${knapp.length > 1 ? ` +${knapp.length - 1}` : ''} knapp`, ton: 'gelb' });
  const alleNormal = zs.length && zs.every(x => x.z === 'normal');
  if (!out.length && alleNormal && typeof boeKmh === 'number') out.push({ text: 'gute Bedingungen', ton: 'gruen' });
  return out;
}

/**
 * Eine Zelle der Wochenend-Tabelle (ein Pegel, ein Tag): Ampel und kurzer Text, nie nur Farbe.
 * Hochwasser (hoch/über HSW) → rot; niedrig → gelb „Pegel knapp“; Böen ab WETTER_GUST_HINT_KMH → gelb „Böen n Bft“;
 * sonst grün „Wind n Bft“. Pegel ohne Einordnung (Tide, ohne Kennwerte, veraltet): grau, nur das Wetter.
 * tag: { windKmh, gustKmh } aus tageAusStunden() oder null (kein Wetter) → null.
 * prognose: Zustand laut Wasserstandsvorhersage für diesen Tag ('low' | 'high' | 'normal') oder null.
 */
export function zelle(g, tag, prognose = null) {
  if (!tag) return null;
  // mit Vorhersage für diesen Tag zählt die Vorhersage (Hochwasser/knapp), sonst der Stand heute
  const z = prognose && g.state !== 'old' ? (prognose === 'high' && zustand(g) === 'hsw' ? 'hsw' : prognose) : zustand(g);
  const boe = typeof tag.gustKmh === 'number' ? tag.gustKmh : null, wind = typeof tag.windKmh === 'number' ? tag.windKmh : null;
  const windText = boe !== null && boe >= CONFIG.WETTER_GUST_HINT_KMH ? `Böen ${beaufort(boe)} Bft` : wind !== null ? `Wind ${beaufort(wind)} Bft` : '';
  if (z === 'hsw' || z === 'high') return { ton: 'rot', text: 'Hochwasser' };
  if (z === 'low') return { ton: 'gelb', text: 'Pegel knapp' };
  if (boe !== null && boe >= CONFIG.WETTER_GUST_HINT_KMH) return { ton: 'gelb', text: windText };
  if (z === 'normal') return { ton: 'gruen', text: windText || 'ruhig' };
  return { ton: 'grau', text: windText };
}

// ------------------------------------------------------------------ Wasserstandsvorhersage (PEGELONLINE „WV“)
const TAG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const cm = (v) => Math.round(v).toLocaleString('de-DE');
const spanne = (a, b) => (Math.round(a) === Math.round(b) ? `${cm(a)} cm` : `${cm(a)}–${cm(b)} cm`);

/** Tiefster und höchster vorhergesagter Wert eines Tages (Ortszeit) oder null. */
export function vorhersageTag(wv, tag) {
  const key = ymd(tag);
  const vs = (wv || []).filter(p => ymd(new Date(p.t)) === key).map(p => p.v);
  return vs.length ? { min: Math.min(...vs), max: Math.max(...vs) } : null;
}

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

/** Zustand eines Tages laut Vorhersage: 'low' | 'high' | 'normal' | null (ohne Kennwerte/Vorhersage). */
export function vorhersageZustand(g, tagWerte) {
  if (!tagWerte) return null;
  const r = g.refs || {};
  if (r.MHW !== undefined && tagWerte.max > r.MHW) return 'high';
  if (r.MNW !== undefined && tagWerte.min < r.MNW) return 'low';
  return r.MNW !== undefined || r.MHW !== undefined ? 'normal' : null;
}

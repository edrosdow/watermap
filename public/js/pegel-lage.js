// Reine Funktionen für den Pegel-Tab (ohne DOM): Lage-Satz zu „Meine Pegel“ und Wochenend-Ausblick.
// Nichts wird erfunden: was fehlt (Trend, Vorhersage), wird weggelassen bzw. kenntlich gemacht.
import { CONFIG } from './config.js';
import { zustand } from './pegel-ansicht.js';

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

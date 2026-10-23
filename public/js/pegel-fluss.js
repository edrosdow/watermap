// Flüsse im Bereich „Pegel“: Gruppierung nach Gewässer, Zustand eines Flusses, Profil-Daten – ohne Oberfläche (in Node testbar).
// Alles kommt aus der einmal geladenen Stationsliste (aktueller Wert, Kennwerte, km); keine Abfragen pro Pegel.
import { CONFIG } from './config.js';

export const normW = (s) => String(s || '').toLowerCase().replace(/[^a-zäöüß]/g, '');
/** „Außenjade“ → „aussenjade“ (für Adressen #pegel/fluss/<slug>). */
export const slug = (name) => String(name || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const KUESTE_SLUG = 'kueste';

// „AUSSENJADE“ (PEGELONLINE) = „Außenjade“ (Liste)
const kuestenName = (s) => normW(s).replace(/ß/g, 'ss');
const KUESTE = new Set((CONFIG.PEGEL_KUESTE || []).map(kuestenName));
export const istKueste = (water) => KUESTE.has(kuestenName(water));

const BEWERTET = ['hsw', 'high', 'low', 'normal'];
/** Aktueller Wert mit Einordnung (veraltete zählen nicht). */
export const bewertet = (g) => BEWERTET.includes(g.state);
/** Pegel hat Kennwerte (auch wenn der Wert gerade veraltet ist). */
export const hatKennwerte = (g) => g.refs?.MNW !== undefined || g.refs?.MHW !== undefined || bewertet(g);

/**
 * Reihenfolge von der Quelle zur Mündung. Die Weser hat zwei Kilometrierungen: Ober-/Mittelweser ab Hann. Münden
 * (bis Bremen, km 366,7), die Unterweser beginnt in Bremen (Große Weserbrücke) wieder bei km 0 – sie kommt ans Ende.
 */
export function flussKm(g) {
  if (g.km === null || g.km === undefined) return null;
  if (normW(g.water) === 'weser' && g.lat > 52.9 && g.km < 130) return g.km + 366.7;
  return g.km;
}
const nachKm = (a, b) => (flussKm(a) ?? 1e9) - (flussKm(b) ?? 1e9) || a.name.localeCompare(b.name, 'de');

/** Relativer Wasserstand: MNW = 0, MHW = 1; begrenzt auf −0,5 … 1,6. null ohne beide Kennwerte. */
export function rel(g) {
  const { MNW, MHW } = g.refs || {};
  if (MNW === undefined || MHW === undefined || !(MHW > MNW)) return null;
  const r = (g.value - MNW) / (MHW - MNW);
  return Math.max(-0.5, Math.min(1.6, r));
}

/**
 * Pegel nach Gewässer gruppieren.
 * → { fluesse: [Gruppe], kueste: Gruppe|null, ohne: [Gruppe] }   Gruppe = { name, slug, art, pegel (nach km) }
 *   art: 'fluss' (mind. ein Pegel mit Kennwerten) · 'kueste' · 'ohne' (Kanäle und Gewässer ohne Bewertung)
 */
export function gruppieren(gauges) {
  const map = new Map(), kueste = [];
  for (const g of gauges) {
    if (!g.water) continue;
    if (istKueste(g.water)) { kueste.push(g); continue; }
    (map.get(g.water) || map.set(g.water, []).get(g.water)).push(g);
  }
  const fluesse = [], ohne = [];
  for (const [name, pegel] of map) {
    const gr = { name, slug: slug(name), pegel: [...pegel].sort(nachKm) };
    if (pegel.some(hatKennwerte)) fluesse.push({ ...gr, art: 'fluss' }); else ohne.push({ ...gr, art: 'ohne' });
  }
  ohne.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return {
    fluesse,
    kueste: kueste.length ? { name: 'Küste', slug: KUESTE_SLUG, art: 'kueste', pegel: [...kueste].sort((a, b) => a.water.localeCompare(b.water, 'de') || nachKm(a, b)) } : null,
    ohne,
  };
}

/** Gruppe zu einer Adresse finden. */
export function gruppeZu(gr, s) {
  if (s === KUESTE_SLUG) return gr.kueste;
  return gr.fluesse.find(f => f.slug === s) || gr.ohne.find(f => f.slug === s) || null;
}

// Zustand eines Flusses ------------------------------------------------------------------------------
export const FLUSS_ZUSTAND = {
  hsw:            { text: 'über HSW',      farbe: '#D03B3B', cls: 'pz-hsw',    rang: 0 },
  hoch:           { text: 'hoch',          farbe: '#EC835A', cls: 'pz-high',   rang: 1 },
  niedrig:        { text: 'niedrig',       farbe: '#FAB219', cls: 'pz-low',    rang: 2 },
  'teils-hoch':   { text: 'teils hoch',    farbe: '#EC835A', cls: 'pz-high',   rang: 3 },
  'teils-niedrig': { text: 'teils niedrig', farbe: '#FAB219', cls: 'pz-low',   rang: 4 },
  normal:         { text: 'normal',        farbe: '#6CBF84', cls: 'pz-normal', rang: 5 },
  keine:          { text: 'keine Daten',   farbe: '#9AAAB5', cls: 'pz-none',   rang: 6 },
  kueste:         { text: 'Tide',          farbe: '#9AAAB5', cls: 'pz-none',   rang: 7 },
  ohne:           { text: 'ohne Kennwerte', farbe: '#9AAAB5', cls: 'pz-none',  rang: 8 },
};

/**
 * Zustand nur aus Pegeln mit aktuellem, eingeordnetem Wert.
 * → { key, n, hoch, niedrig, hsw, hervor: Pegel|null, hervorArt: 'höchster'|'tiefster'|null, kachel, kopf }
 */
export function flussZustand(gr) {
  if (gr.art === 'kueste') return { key: 'kueste', n: gr.pegel.length, hervor: null, hervorArt: null, kachel: 'ohne Niedrig/Hoch-Bewertung', kopf: `${gr.pegel.length} Pegel an Nord- und Ostsee · ohne Niedrig/Hoch-Bewertung` };
  if (gr.art === 'ohne') return { key: 'ohne', n: gr.pegel.length, hervor: null, hervorArt: null, kachel: 'ohne Niedrig/Hoch-Bewertung', kopf: `${gr.pegel.length} Pegel · ohne Niedrig/Hoch-Bewertung` };
  const b = gr.pegel.filter(bewertet);
  const n = b.length;
  if (!n) return { key: 'keine', n: 0, hervor: null, hervorArt: null, kachel: 'keine aktuellen Daten', kopf: 'Keine aktuellen Messwerte' };
  const hsw = b.filter(g => g.state === 'hsw').length;
  const hoch = b.filter(g => g.state === 'high' || g.state === 'hsw').length;
  const niedrig = b.filter(g => g.state === 'low').length;
  const wert = (g) => rel(g) ?? (g.refs?.HSW ? g.value / g.refs.HSW : 0);
  const hoechster = () => b.reduce((m, g) => (wert(g) > wert(m) ? g : m));
  const tiefster = () => b.reduce((m, g) => (wert(g) < wert(m) ? g : m));
  const pegelN = (k) => `${k} von ${n} Pegel${n === 1 ? '' : 'n'}`;
  if (hsw) return { key: 'hsw', n, hoch, niedrig, hsw, hervor: hoechster(), hervorArt: 'höchster', kachel: 'Schifffahrt eingeschränkt', kopf: `${pegelN(hsw)} über HSW – Schifffahrt eingeschränkt` };
  if (hoch) return { key: hoch * 2 >= n ? 'hoch' : 'teils-hoch', n, hoch, niedrig, hsw, hervor: hoechster(), hervorArt: 'höchster', kachel: `${hoch} von ${n} hoch`, kopf: `${pegelN(hoch)} über MHW` };
  if (niedrig) return { key: niedrig * 2 >= n ? 'niedrig' : 'teils-niedrig', n, hoch, niedrig, hsw, hervor: tiefster(), hervorArt: 'tiefster', kachel: `${niedrig} von ${n} niedrig`, kopf: `${pegelN(niedrig)} unter MNW` };
  return { key: 'normal', n, hoch, niedrig, hsw, hervor: null, hervorArt: null, kachel: 'keine Auffälligkeiten', kopf: `Alle ${n} Pegel im Normalbereich` };
}

/** Kacheln: zuerst Flüsse mit „Meine Pegel“, dann nach Schwere, dann nach Anzahl Pegel. Küste kommt separat ans Ende. */
export function kachelnSortieren(fluesse, meineIds = []) {
  const meine = new Set(meineIds);
  return fluesse.map(f => ({ ...f, zustand: flussZustand(f), meine: f.pegel.some(g => meine.has(g.id)) }))
    .sort((a, b) => (b.meine - a.meine) || FLUSS_ZUSTAND[a.zustand.key].rang - FLUSS_ZUSTAND[b.zustand.key].rang
      || b.pegel.length - a.pegel.length || a.name.localeCompare(b.name, 'de'));
}

/** Punktreihe der Kachel: bewertete Pegel nach km, höchstens max (gleichmäßig ausgewählt). */
export function punkte(gr, max = 12) {
  const b = gr.pegel.filter(bewertet);
  if (b.length <= max) return b;
  return Array.from({ length: max }, (_, i) => b[Math.round(i * (b.length - 1) / (max - 1))]);
}

/**
 * Profil entlang des Flusses (nur Pegel mit km).
 * → { punkte: [{ g, x, y, pos }], von, bis (Pegel), xMin, xMax, yBereich: [min, max], tide: { x, pos, label, ids: Set } | null }
 * pos (0 … 1): halb nach Flusskilometer, halb nach Reihenfolge – Lage bleibt erkennbar, Häufungen ziehen sich auseinander.
 * yBereich: so weit, wie die Werte es brauchen (MNW und MHW immer sichtbar), höchstens −0,5 … 1,6.
 * Tidebereich: nach dem letzten Pegel mit Kennwerten, wenn alle Pegel flussabwärts keine haben; Linie mittig dazwischen.
 * Beschriftung „Tidebereich“ nur, wenn diese Pegel Tide-Kennwerte haben, sonst „ohne Kennwerte“.
 */
export function profil(gr) {
  const mitKm = gr.pegel.filter(g => flussKm(g) !== null);
  if (!mitKm.length) return null;
  const xMin = flussKm(mitKm[0]), xMax = flussKm(mitKm[mitKm.length - 1]), n = mitKm.length;
  const pos = mitKm.map((g, i) => (n < 2 ? 0.5 : 0.5 * (xMax > xMin ? (flussKm(g) - xMin) / (xMax - xMin) : i / (n - 1)) + 0.5 * i / (n - 1)));
  let letzter = -1;
  mitKm.forEach((g, i) => { if (hatKennwerte(g)) letzter = i; });
  let tide = null;
  if (letzter >= 0 && letzter < n - 1) {
    const danach = mitKm.slice(letzter + 1);
    tide = { x: (flussKm(mitKm[letzter]) + flussKm(danach[0])) / 2, pos: (pos[letzter] + pos[letzter + 1]) / 2,
      label: danach.some(g => g.tide) ? 'Tidebereich' : 'ohne Kennwerte', ids: new Set(danach.map(g => g.id)) };
  }
  const pts = mitKm.map((g, i) => ({ g, x: flussKm(g), y: rel(g), pos: pos[i] })).filter(p => bewertet(p.g) && p.y !== null);
  const ys = pts.map(p => p.y);
  const yBereich = [Math.max(-0.5, Math.min(-0.1, Math.min(...ys, 0) - 0.12)), Math.min(1.6, Math.max(1.1, Math.max(...ys, 1) + 0.12))];
  return { punkte: pts, von: mitKm[0], bis: mitKm[n - 1], xMin, xMax, yBereich, tide };
}

/** Slipanlagen an diesem Gewässer (Gewässername aus OSM, gleiche Namensprüfung wie auf der Pegel-Detailseite). */
export function slipsAmFluss(name, places) {
  const w = normW(name);
  if (!w) return [];
  return places.filter(p => p.type === 'slip' && p.water?.name && (normW(p.water.name) === w || normW(p.water.name).includes(w) || w.includes(normW(p.water.name))));
}

/** „entlang der Elbe“ / „entlang des Rheins“, „an der Elbe“ / „am Rhein“. */
const MAENNLICH = new Set(['rhein', 'main', 'neckar', 'inn', 'lech', 'regen', 'kocher', 'rhin', 'peenestrom', 'strelasund']);
export function artikel(name) {
  const w = normW(name), m = MAENNLICH.has(w) || /kanal$|see$|strom$|sund$/.test(w);
  const gen = m ? (/[sßxz]$/.test(name) ? name : `${name}s`) : name;
  return { entlang: m ? `entlang des ${gen}` : `entlang der ${name}`, an: m ? `am ${name}` : `an der ${name}` };
}

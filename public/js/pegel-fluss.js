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
 * Ebenso die Ems: oberhalb km bis Versen (~235), die Unterems ab Papenburg wieder ab km 0 bis Emshörn.
 */
export function flussKm(g) {
  if (g.km === null || g.km === undefined) return null;
  if (normW(g.water) === 'weser' && g.lat > 52.9 && g.km < 130) return g.km + 366.7;
  if (normW(g.water) === 'ems' && g.lat > 53.0 && g.km < 90) return g.km + 240;
  return g.km;
}
const nachKm = (a, b) => (flussKm(a) ?? 1e9) - (flussKm(b) ?? 1e9) || a.name.localeCompare(b.name, 'de');

// Flüsse, deren Kilometrierung an der Mündung beginnt (km steigen flussaufwärts)
const KM_AB_MUENDUNG = new Set(['Mosel', 'Saar', 'Main', 'Neckar', 'Lahn', 'Saale'].map(normW));
const hatOrt = (g) => Number.isFinite(g.lat) && Number.isFinite(g.lon);
function entfernungKm(a, b) {
  const r = Math.PI / 180, x = (b.lon - a.lon) * r * Math.cos((a.lat + b.lat) / 2 * r), y = (b.lat - a.lat) * r;
  return Math.hypot(x, y) * 6371;
}

/**
 * Pegel eines Flusses in Fließrichtung. Steigen die km flussabwärts durchgehend, nach km; springt die Kilometrierung
 * (z. B. Weser: Ober-/Mittelweser ab Hann. Münden, Unterweser neu ab Bremen), als Kette über die Lage: jeweils der
 * nächstgelegene noch nicht verwendete Pegel, von dem Ende aus, das die kürzeste Kette ergibt. Ohne km bzw. Lage ans Ende.
 */
export function flussReihenfolge(pegel) {
  if (pegel.length < 2) return [...pegel];
  const abMuendung = KM_AB_MUENDUNG.has(normW(pegel[0].water));
  const name = (a, b) => a.name.localeCompare(b.name, 'de');
  const mitKm = pegel.filter(g => g.km !== null && g.km !== undefined).sort((a, b) => (abMuendung ? flussKm(b) - flussKm(a) : flussKm(a) - flussKm(b)) || name(a, b));
  const ohneKm = pegel.filter(g => g.km === null || g.km === undefined).sort(name);
  const sprung = mitKm.some((g, i) => i && hatOrt(g) && hatOrt(mitKm[i - 1]) && entfernungKm(mitKm[i - 1], g) > Math.abs(flussKm(g) - flussKm(mitKm[i - 1])) + 15);
  if (!sprung) return [...mitKm, ...ohneKm];
  const orte = pegel.filter(hatOrt), n = orte.length;
  // Entfernungen einmal berechnen (sonst n³ Winkelrechnungen bei großen Flüssen)
  const D = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) D[i * n + j] = D[j * n + i] = entfernungKm(orte[i], orte[j]);
  const kette = (start) => {
    const frei = new Uint8Array(n).fill(1); frei[start] = 0;
    const k = [start]; let laenge = 0;
    for (let schritt = 1; schritt < n; schritt++) {
      const a = k[k.length - 1] * n;
      let best = -1, d = Infinity;
      for (let j = 0; j < n; j++) if (frei[j] && D[a + j] < d) { d = D[a + j]; best = j; }
      k.push(best); frei[best] = 0; laenge += d;
    }
    return { k, laenge };
  };
  let bestK = null;
  for (let i = 0; i < n; i++) { const c = kette(i); if (!bestK || c.laenge < bestK.laenge - 1e-9) bestK = c; }
  let k = bestK.k.map(i => orte[i]);
  // Richtung: Anfang ist das Ende mit dem kleineren km (bei Kilometrierung ab Mündung: dem größeren)
  const kmA = flussKm(k[0]), kmB = flussKm(k[k.length - 1]);
  if (kmA !== null && kmB !== null && (abMuendung ? kmA < kmB : kmA > kmB)) k = [...k].reverse();
  return [...k, ...pegel.filter(g => !hatOrt(g)).sort(name)];
}

/** Abschnitt eines Pegels für die Liste („Oberweser km 0,7“) – nur, wo sicher ableitbar (Weser). */
export function abschnitt(g) {
  if (normW(g.water) !== 'weser' || g.km === null || g.km === undefined) return null;
  if (g.lat > 52.9 && g.km < 130) return g.km <= 65 ? 'Unterweser' : 'Außenweser';
  return g.km <= 204.5 ? 'Oberweser' : 'Mittelweser';
}

/** Relativer Wasserstand: MNW = 0, MHW = 1; begrenzt auf −0,5 … 1,6. null ohne beide Kennwerte. */
export function rel(g) {
  const { MNW, MHW } = g.refs || {};
  if (MNW === undefined || MHW === undefined || !(MHW > MNW)) return null;
  const r = (g.value - MNW) / (MHW - MNW);
  return Math.max(-0.5, Math.min(1.6, r));
}

/**
 * Pegel nach Gewässer gruppieren.
 * → { fluesse: [Gruppe], kueste: Gruppe|null, ohne: [Gruppe] }   Gruppe = { name, slug, art, pegel (in Fließrichtung) }
 *   art: 'fluss' (mind. ein Pegel mit Kennwerten) · 'kueste' · 'ohne' (Kanäle und Gewässer ohne Bewertung)
 */
const gruppenCache = new WeakMap();   // je geladener Stationsliste nur einmal gruppieren (Reihenfolge ist aufwendig)
export function gruppieren(gauges) {
  if (gruppenCache.has(gauges)) return gruppenCache.get(gauges);
  const gr = gruppierenNeu(gauges);
  gruppenCache.set(gauges, gr);
  return gr;
}
function gruppierenNeu(gauges) {
  const map = new Map(), kueste = [];
  for (const g of gauges) {
    if (!g.water) continue;
    if (istKueste(g.water)) { kueste.push(g); continue; }
    (map.get(g.water) || map.set(g.water, []).get(g.water)).push(g);
  }
  const fluesse = [], ohne = [];
  for (const [name, pegel] of map) {
    const gr = { name, slug: slug(name), pegel: flussReihenfolge(pegel) };
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
  const pegelN = (k) => `${k} von ${n} bewerteten Pegel${n === 1 ? '' : 'n'}`;
  if (hsw) return { key: 'hsw', n, hoch, niedrig, hsw, hervor: hoechster(), hervorArt: 'höchster', kachel: 'Schifffahrt eingeschränkt', kopf: `${pegelN(hsw)} über HSW – Schifffahrt eingeschränkt` };
  if (hoch) return { key: hoch * 2 >= n ? 'hoch' : 'teils-hoch', n, hoch, niedrig, hsw, hervor: hoechster(), hervorArt: 'höchster', kachel: `${hoch} von ${n} hoch`, kopf: `${pegelN(hoch)} über MHW` };
  if (niedrig) return { key: niedrig * 2 >= n ? 'niedrig' : 'teils-niedrig', n, hoch, niedrig, hsw, hervor: tiefster(), hervorArt: 'tiefster', kachel: `${niedrig} von ${n} niedrig`, kopf: `${pegelN(niedrig)} unter MNW` };
  return { key: 'normal', n, hoch, niedrig, hsw, hervor: null, hervorArt: null, kachel: 'keine Auffälligkeiten', kopf: `Alle ${n} bewerteten Pegel im Normalbereich` };
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
 * Profil entlang des Flusses: bewertete Pegel (mit km) in Fließrichtung mit gleichen Abständen (pos 0 … 1) – die Kilometrierung
 * springt bei manchen Flüssen. Tidepegel (alles nach dem letzten Pegel mit Kennwerten) kommen nicht ins Diagramm.
 * yBereich: nur so groß wie die Werte plus Rand; MNW (rel 0) immer im Bild – außer wenn alles über MHW liegt, dann MHW.
 * → { punkte: [{ g, y, pos }], von, bis, yBereich: [min, max], mnw, mhw (sichtbar?), tide: { ab, pegel, ids, mitTide } | null }
 */
export function profil(gr) {
  const reihe = gr.pegel.filter(g => g.km !== null && g.km !== undefined);   // ohne km: nur in der Liste (am Ende)
  let letzter = -1;
  reihe.forEach((g, i) => { if (hatKennwerte(g)) letzter = i; });
  const pts = reihe.slice(0, letzter + 1).filter(g => bewertet(g) && rel(g) !== null);
  if (!pts.length) return null;
  const n = pts.length;
  const punkte = pts.map((g, i) => ({ g, y: rel(g), pos: n < 2 ? 0.5 : i / (n - 1) }));
  const ys = punkte.map(p => p.y), lo = Math.min(...ys), hi = Math.max(...ys);
  const rand = Math.max(0.06, (hi - lo) * 0.12);
  let ymin = lo - rand, ymax = hi + rand;
  if (lo > 1) ymin = Math.min(ymin, 1 - rand);                     // alles über MHW: MHW im Bild, MNW weiter unten
  else { ymin = Math.min(ymin, -rand); ymax = Math.max(ymax, rand); }
  ymin = Math.max(-0.55, ymin); ymax = Math.min(1.65, ymax);
  const tidepegel = letzter >= 0 ? reihe.slice(letzter + 1) : [];
  return {
    punkte, von: pts[0], bis: pts[n - 1], yBereich: [ymin, ymax], mnw: ymin <= 0 && ymax >= 0, mhw: ymin <= 1 && ymax >= 1,
    tide: tidepegel.length ? { ab: reihe[letzter], pegel: tidepegel, ids: new Set(tidepegel.map(g => g.id)), mitTide: tidepegel.some(g => g.tide) } : null,
  };
}

/** Slipanlagen an diesem Gewässer (Gewässername aus OSM, gleiche Namensprüfung wie auf der Pegel-Detailseite). */
export function slipsAmFluss(name, places) {
  if (!normW(name)) return [];
  return places.filter(p => p.type === 'slip' && p.water?.name && gleichesGewaesser(p.water.name, name));
}

/** Gewässername zum Vergleichen: klein, Umlaute/ß ausgeschrieben („Elbe-Lübeck-Kanal“ = „ELBE-LUEBECK-KANAL“), nur Buchstaben. */
export const gewaesserSchluessel = (s) => String(s || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z]/g, '');
const woerter = (s) => String(s || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').split(/[^a-z]+/).filter(w => w.length >= 3);
/**
 * Gleiches Gewässer: gleicher Name (ohne Satzzeichen) oder alle Wörter des kürzeren im längeren („Weser“ ~ „Weser (Mittelweser)“).
 * Fluss und Kanal werden nie verwechselt („Rhein“ ≠ „Rhein-Herne-Kanal“, „Elbe“ ≠ „Elbeseitenkanal“).
 */
export function gleichesGewaesser(a, b) {
  if (gewaesserSchluessel(a).length < 3 || gewaesserSchluessel(b).length < 3) return false;
  if (gewaesserSchluessel(a) === gewaesserSchluessel(b)) return true;
  const kanal = (s) => /kanal/.test(gewaesserSchluessel(s));
  if (kanal(a) !== kanal(b)) return false;
  const [k, l] = [woerter(a), woerter(b)].sort((x, y) => x.length - y.length);
  return k.length > 0 && k.every(w => l.includes(w));
}
export const PEGEL_MAX_M = 80000;     // nächster Pegel am selben Gewässer – auch, wenn er weiter weg liegt
export const PEGEL_OHNE_NAME_M = 1500; // ohne Gewässernamen nur ein Pegel direkt nebenan
function entfernungM(a, b) {
  const r = Math.PI / 180, x = (b.lon - a.lon) * r * Math.cos((a.lat + b.lat) / 2 * r), y = (b.lat - a.lat) * r;
  return Math.hypot(x, y) * 6371000;
}

/**
 * Nächster Pegel zu einem Standort am selben Gewässer (Name aus OSM ↔ PEGELONLINE), bis PEGEL_MAX_M.
 * Ohne Gewässernamen: nur ein Pegel bis PEGEL_OHNE_NAME_M. → { g, d (m) } | null
 */
export function naechsterPegel(p, gauges) {
  const name = p.water?.name, w = gewaesserSchluessel(name).length >= 3;
  let best = null;
  for (const g of gauges) {
    if (!Number.isFinite(g.lat) || !Number.isFinite(g.lon)) continue;
    const passt = w ? gleichesGewaesser(name, g.water) : true;
    if (!passt) continue;
    const d = entfernungM(p, g);
    if (d <= (w ? PEGEL_MAX_M : PEGEL_OHNE_NAME_M) && (!best || d < best.d)) best = { g, d };
  }
  return best;
}

/** „entlang der Elbe“ / „entlang des Rheins“, „an der Elbe“ / „am Rhein“. */
const MAENNLICH = new Set(['rhein', 'main', 'neckar', 'inn', 'lech', 'regen', 'kocher', 'rhin', 'peenestrom', 'strelasund']);
export function artikel(name) {
  const w = normW(name), m = MAENNLICH.has(w) || /kanal$|see$|strom$|sund$/.test(w);
  const gen = m ? (/[sßxz]$/.test(name) ? name : `${name}s`) : name;
  return { entlang: m ? `entlang des ${gen}` : `entlang der ${name}`, an: m ? `am ${name}` : `an der ${name}` };
}

// Gezeiten aus den gemessenen Wasserständen eines Tidepegels (PEGELONLINE) – reine Funktionen, in Node testbar.
// Tendenz (auf-/ablaufend), letztes Hoch- und Niedrigwasser über geglättete lokale Extreme, Tidehub, Einordnung zu MThw/MTnw.
// pts: [{ t (ms), v (cm) }] aufsteigend nach Zeit.

const MIN = 60e3, STD = 3600e3;

/** Tidepegel: hat Tide-Kennwerte (MThw/MTnw/MTmw) statt MNW/MHW. */
export const istTidepegel = (g) => !!g?.tide && g.refs?.MNW === undefined && g.refs?.MHW === undefined;

/** Gleitender Mittelwert über ±halb Minuten (zeitbasiert, für ungleichmäßige Abstände). */
export function glaetten(pts, halb = 20) {
  const out = new Array(pts.length);
  let a = 0, b = 0, summe = 0;
  for (let i = 0; i < pts.length; i++) {
    const t = pts[i].t;
    while (b < pts.length && pts[b].t <= t + halb * MIN) summe += pts[b++].v;
    while (pts[a].t < t - halb * MIN) summe -= pts[a++].v;
    out[i] = { t, v: summe / (b - a) };
  }
  return out;
}

/**
 * Hoch- und Niedrigwasser als lokale Extreme der geglätteten Kurve (Fenster ±3 h, mindestens 4 h Abstand, abwechselnd).
 * Nur Extreme, die auf beiden Seiten genug Messwerte haben (am Rand nicht bestätigt). Wert und Zeit: gemessenes
 * Extrem im Umkreis von ±30 min. → [{ t, v, typ: 'HW' | 'NW' }]
 */
export function extreme(pts, { fenster = 3 * STD, rand = 1.5 * STD } = {}) {
  if (!pts || pts.length < 10) return [];
  const s = glaetten(pts);
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const kandidaten = [];
  let a = 0, b = 0;
  for (let i = 0; i < s.length; i++) {
    const t = s[i].t;
    if (t - t0 < rand || t1 - t < rand) continue;
    while (s[a].t < t - fenster) a++;
    while (b < s.length - 1 && s[b + 1].t <= t + fenster) b++;
    let max = true, min = true;
    for (let j = a; j <= b && (max || min); j++) {
      if (j === i) continue;
      if (s[j].v > s[i].v || (s[j].v === s[i].v && j < i)) max = false;
      if (s[j].v < s[i].v || (s[j].v === s[i].v && j < i)) min = false;
    }
    if (max) kandidaten.push({ i, typ: 'HW' });
    else if (min) kandidaten.push({ i, typ: 'NW' });
  }
  // gemessenes Extrem nahe dem geglätteten
  const roh = ({ i, typ }) => {
    let best = null;
    for (let j = i; j >= 0 && pts[j].t >= s[i].t - 30 * MIN; j--) if (!best || (typ === 'HW' ? pts[j].v > best.v : pts[j].v < best.v)) best = pts[j];
    for (let j = i + 1; j < pts.length && pts[j].t <= s[i].t + 30 * MIN; j++) if (typ === 'HW' ? pts[j].v > best.v : pts[j].v < best.v) best = pts[j];
    return { t: best.t, v: best.v, typ };
  };
  const out = [];
  for (const k of kandidaten.map(roh)) {
    const letzt = out[out.length - 1];
    if (letzt && (letzt.typ === k.typ || k.t - letzt.t < 4 * STD)) {
      // gleiche Art kurz hintereinander bzw. zu dicht: das stärkere Extrem behalten
      if (letzt.typ === k.typ && (k.typ === 'HW' ? k.v > letzt.v : k.v < letzt.v)) out[out.length - 1] = k;
      continue;
    }
    out.push(k);
  }
  return out;
}

/** Tendenz aus den letzten ~30 Minuten: 'auflaufend' | 'ablaufend' | 'kentert' (um Hoch-/Niedrigwasser) | null. */
export function tendenz(pts, { minuten = 30, schwelle = 3 } = {}) {
  if (!pts || pts.length < 3) return null;
  const s = glaetten(pts, 10), letzt = s[s.length - 1];
  const vorher = [...s].reverse().find(p => p.t <= letzt.t - minuten * MIN);
  if (!vorher || letzt.t - vorher.t > 3 * minuten * MIN) return null;
  const d = letzt.v - vorher.v;
  return d >= schwelle ? 'auflaufend' : d <= -schwelle ? 'ablaufend' : 'kentert';
}

/** „23 cm über dem mittleren Tidehochwasser“ / „wie mittleres Tidehochwasser“ (±10 cm). */
export function einordnung(v, mittel, art) {
  if (mittel === undefined || mittel === null || !Number.isFinite(v)) return null;
  const name = art === 'HW' ? 'Tidehochwasser' : 'Tideniedrigwasser';
  const d = Math.round(v - mittel);
  if (Math.abs(d) <= 10) return `wie mittleres ${name}`;
  return `${Math.abs(d)} cm ${d > 0 ? 'über' : 'unter'} dem mittleren ${name}`;
}

/**
 * Auswertung eines Tidepegels aus dem Verlauf (die letzten 48 h werden genutzt).
 * → { tendenz, hw, nw (letzte), tidehub, hwText, nwText, extreme (letzte 24 h) }
 */
export function auswerten(g, pts) {
  if (!pts?.length) return null;
  const ende = pts[pts.length - 1].t;
  const teil = pts.filter(p => p.t >= ende - 48 * STD);
  const ex = extreme(teil);
  const hw = [...ex].reverse().find(e => e.typ === 'HW') || null;
  const nw = [...ex].reverse().find(e => e.typ === 'NW') || null;
  const r = g?.tideRefs || {};
  return {
    tendenz: tendenz(teil), hw, nw,
    tidehub: hw && nw ? Math.round(hw.v - nw.v) : null,
    hwText: hw ? einordnung(hw.v, r.MThw, 'HW') : null,
    nwText: nw ? einordnung(nw.v, r.MTnw, 'NW') : null,
    extreme: ex.filter(e => e.t >= ende - 24 * STD),
  };
}

export const TENDENZ = {
  auflaufend: { pfeil: '↗', text: 'auflaufend' },
  ablaufend: { pfeil: '↘', text: 'ablaufend' },
  kentert: { pfeil: '→', text: 'kentert' },
};

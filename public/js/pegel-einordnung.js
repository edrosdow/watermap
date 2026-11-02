// Reine Logik (ohne DOM) für die Pegel-Einordnung: Satz aus den Kennwerten, Lage der Skala, kurzfristige Tendenz.
// Nur Aussagen, die aus den gelieferten Kennwerten folgen; statistische Kennwerte sind keine Warnstufen.
// Tests: tests/pegel_einordnung_test.mjs

const fmt = (v) => Math.round(v).toLocaleString('de-DE');
const STAT = ['MNW', 'MW', 'MHW'];   // statistische Kennwerte (Mittelwerte über eine Zeitspanne)
const DATIV = { MNW: 'dem mittleren Niedrigwasser (MNW)', MW: 'dem Mittelwasser (MW)', MHW: 'dem mittleren Hochwasser (MHW)' };

/** Nächster statistischer Kennwert darunter (≤ Wert) und darüber (> Wert); fehlende Kennwerte bleiben null. */
function nachbarn(refs, v) {
  const da = STAT.filter(k => typeof refs?.[k] === 'number').map(k => ({ k, v: refs[k] })).sort((a, b) => a.v - b.v);
  let unten = null, oben = null;
  for (const r of da) { if (r.v <= v) unten = r; else if (!oben) oben = r; }
  return { unten, oben };
}

/** Kurzform für die kompakte Ansicht: „6 cm über MNW · 69 cm unter MW“; null ohne Kennwerte. */
export function einordnungKurz(g) {
  if (!g || g.state === 'old') return null;
  const { unten, oben } = nachbarn(g.refs, g.value);
  const teile = [];
  if (unten) teile.push(g.value === unten.v ? `auf ${unten.k}` : `${fmt(g.value - unten.v)} cm über ${unten.k}`);
  if (oben) teile.push(`${fmt(oben.v - g.value)} cm unter ${oben.k}`);
  return teile.length ? teile.join(' · ') : null;
}

/**
 * Erklärsatz: „Der Wasserstand liegt 6 cm über dem mittleren Niedrigwasser (MNW) und 69 cm unter dem Mittelwasser (MW).“
 * Dazu, wenn vorhanden, der Abstand zum höchsten Schifffahrtswasserstand (HSW). Ohne Kennwerte: null.
 */
export function einordnungSatz(g) {
  if (!g) return null;
  if (g.state === 'old') return 'Der letzte Messwert ist veraltet – eine Einordnung ist nicht möglich.';
  const v = g.value, r = g.refs || {};
  const { unten, oben } = nachbarn(r, v);
  const saetze = [];
  if (unten || oben) {
    const a = unten ? (v === unten.v ? `auf ${DATIV[unten.k]}` : `${fmt(v - unten.v)} cm über ${DATIV[unten.k]}`) : null;
    const b = oben ? `${fmt(oben.v - v)} cm unter ${DATIV[oben.k]}` : null;
    saetze.push(`Der Wasserstand liegt ${[a, b].filter(Boolean).join(' und ')}.`);
  }
  if (typeof r.HSW === 'number') {
    if (v > r.HSW) saetze.push(`Er liegt ${fmt(v - r.HSW)} cm über dem höchsten Schifffahrtswasserstand (HSW) – darüber ist die Schifffahrt eingeschränkt.`);
    else saetze.push(`Bis zum höchsten Schifffahrtswasserstand (HSW) fehlen ${fmt(r.HSW - v)} cm.`);
  }
  return saetze.length ? saetze.join(' ') : null;
}

/**
 * Lage der Skala: Kennwerte (MNW, MW, MHW, HSW – nur vorhandene) maßstabsgetreu nach ihrem ZAHLENWERT, nicht nach Namen.
 * Rückgabe: { wert: Prozent des aktuellen Werts, punkte: [{ k, v, pos, label, oben }] } nach Wert sortiert, oder null (weniger als 2 Kennwerte).
 * HSW (Schifffahrt) wird oben beschriftet, die statistischen Werte unten; nahe Beschriftungen werden auseinandergeschoben (abstand in %).
 */
export function skalaLage(refs, wert, { abstand = 15, rand = 5 } = {}) {
  const keys = ['MNW', 'MW', 'MHW', 'HSW'].filter(k => typeof refs?.[k] === 'number' && Number.isFinite(refs[k]));
  if (keys.length < 2 || !Number.isFinite(wert)) return null;
  const vals = keys.map(k => refs[k]);
  const lo0 = Math.min(...vals, wert), hi0 = Math.max(...vals, wert), span = hi0 - lo0 || 1;
  const lo = lo0 - span * 0.06, hi = hi0 + span * 0.06;
  const pos = (v) => (v - lo) / (hi - lo) * 100;
  const punkte = keys.map(k => ({ k, v: refs[k], pos: pos(refs[k]), oben: k === 'HSW' })).sort((a, b) => a.v - b.v);
  // Beschriftungen je Reihe (oben/unten) ohne Überlappung, Reihenfolge bleibt die der Zahlenwerte
  for (const reihe of [punkte.filter(p => !p.oben), punkte.filter(p => p.oben)]) {
    reihe.forEach((p) => { p.label = Math.min(100 - rand, Math.max(rand, p.pos)); });
    for (let i = 1; i < reihe.length; i++) reihe[i].label = Math.max(reihe[i].label, reihe[i - 1].label + abstand);
    const ueber = reihe.length ? reihe[reihe.length - 1].label - (100 - rand) : 0;
    if (ueber > 0) for (const p of reihe) p.label -= ueber;
    for (let i = reihe.length - 2; i >= 0; i--) reihe[i].label = Math.min(reihe[i].label, reihe[i + 1].label - abstand);
  }
  return { wert: pos(wert), punkte };
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

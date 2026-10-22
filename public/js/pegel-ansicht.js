// Bausteine für Pegel: Zustands-Etikett, Skala, Klartext, Mini-Verlauf, Pegel-Karte und Detailseite.
// Zustand nach den amtlichen Kennwerten des jeweiligen Pegels (PEGELONLINE) – nicht nach dem eigenen Boot.
import { CONFIG } from './config.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { s } from './chart.js';
import { historyChart, formatTime } from './pegel.js';
import { aenderung24h, meinePegel } from './pegel-daten.js';

export const fmt = (v) => Math.round(v).toLocaleString('de-DE');
export const kmText = (g) => (g.km !== null && g.km !== undefined ? `km ${g.km.toLocaleString('de-DE', { maximumFractionDigits: 1 })}` : '');
const ohneKennwerte = (g) => g.refs.MNW === undefined && g.refs.MHW === undefined;

/** Zustand für Etiketten und Farben (veraltet und ohne Kennwerte eigens). */
export function zustand(g) {
  if (g.state === 'old') return 'old';
  if (g.state === 'unknown') return ohneKennwerte(g) ? 'none' : 'unknown';
  return g.state;
}
export const ZUSTAND = {
  hsw:     { text: 'über HSW',       farbe: '#D03B3B', cls: 'pz-hsw' },
  high:    { text: 'Hoch',           farbe: '#EC835A', cls: 'pz-high' },
  normal:  { text: 'Normal',         farbe: '#6CBF84', cls: 'pz-normal' },
  low:     { text: 'Niedrig',        farbe: '#FAB219', cls: 'pz-low' },
  none:    { text: 'ohne Kennwerte', farbe: '#DCE5EA', cls: 'pz-none' },
  unknown: { text: 'ohne Einordnung', farbe: '#DCE5EA', cls: 'pz-none' },
  old:     { text: 'veraltet',       farbe: '#DCE5EA', cls: 'pz-old' },
};
export const etikett = (g) => { const z = ZUSTAND[zustand(g)]; return h('span', { class: `pz-tag ${z.cls}`, text: z.text }); };

const TREND_TEXT = { 1: 'steigend', 0: 'gleichbleibend', '-1': 'fallend' };
const TREND_PFEIL = { 1: '↗', 0: '→', '-1': '↘' };
export const trendText = (g, { kurz = false } = {}) => (g.trend === null ? '' : `${TREND_PFEIL[g.trend]} ${kurz && g.trend === 0 ? 'gleich' : TREND_TEXT[g.trend]}`);
export const trendKlasse = (g) => (g.trend === 1 ? 'pt-up' : g.trend === -1 ? 'pt-down' : 'pt-flat');

/** „Etwas unter Mittelwasser, im normalen Bereich. 84 cm über dem mittleren Niedrigwasser.“ */
export function klartext(g) {
  const r = g.refs, v = g.value, u = g.unit;
  if (g.state === 'old') return 'Der letzte Messwert ist älter als ' + CONFIG.PEGEL_STALE_HOURS + ' Stunden – die Einordnung kann überholt sein.';
  if (r.HSW !== undefined && v > r.HSW) return `Über dem höchsten Schifffahrtswasserstand – die Schifffahrt ist eingeschränkt. ${fmt(v - r.HSW)} ${u} über HSW.`;
  if (r.MHW !== undefined && v > r.MHW) return `Hochwasser: über dem mittleren Hochwasser. ${fmt(v - r.MHW)} ${u} über MHW${r.HSW !== undefined ? `, ${fmt(r.HSW - v)} ${u} unter HSW` : ''}.`;
  if (r.MNW !== undefined && v < r.MNW) return `Niedrigwasser: unter dem mittleren Niedrigwasser. ${fmt(r.MNW - v)} ${u} unter MNW.`;
  if (r.MW !== undefined && r.MNW !== undefined && v <= r.MW) {
    const naeher = (r.MW - v) < (r.MW - r.MNW) / 3;
    return `${naeher ? 'Etwas' : 'Deutlich'} unter Mittelwasser, im normalen Bereich. ${fmt(v - r.MNW)} ${u} über dem mittleren Niedrigwasser.`;
  }
  if (r.MW !== undefined && r.MHW !== undefined && v > r.MW) {
    const naeher = (v - r.MW) < (r.MHW - r.MW) / 3;
    return `${naeher ? 'Etwas' : 'Deutlich'} über Mittelwasser, im normalen Bereich. ${fmt(r.MHW - v)} ${u} unter dem mittleren Hochwasser.`;
  }
  if (r.MNW !== undefined && r.MHW !== undefined) return 'Im normalen Bereich zwischen mittlerem Niedrig- und Hochwasser.';
  return 'Für diesen Pegel gibt es keine amtlichen Kennwerte – eine Einordnung ist nicht möglich.';
}

const KW = ['MNW', 'MW', 'MHW', 'HSW'];
const KW_NAME = { MNW: 'Mittleres Niedrigwasser', MW: 'Mittelwasser', MHW: 'Mittleres Hochwasser', HSW: 'Höchster Schifffahrtswasserstand' };

/**
 * Skala MNW – MW – MHW – HSW (nur vorhandene Kennwerte) mit Markierung des aktuellen Werts.
 * gross: Wert über der Markierung, Kennwerte mit Zahlen darunter.
 */
export function skala(g, { gross = false } = {}) {
  const keys = KW.filter(k => g.refs[k] !== undefined);
  if (keys.length < 2) return null;
  const vals = keys.map(k => g.refs[k]);
  const lo0 = Math.min(...vals, g.value), hi0 = Math.max(...vals, g.value);
  const span = hi0 - lo0 || 1;
  const lo = lo0 - span * 0.12, hi = hi0 + span * 0.08;
  const pos = (v) => Math.max(0, Math.min(100, (v - lo) / (hi - lo) * 100));
  const seg = (a, b, cls) => h('span', { class: `ps-seg ${cls}`, style: `left:${pos(a).toFixed(2)}%;width:${(pos(b) - pos(a)).toFixed(2)}%` });
  const r = g.refs;
  const segs = [];
  const unten = r.MNW ?? lo, mitte = r.MHW ?? (r.HSW ?? hi);
  if (r.MNW !== undefined) segs.push(seg(lo, r.MNW, 'is-low'));
  segs.push(seg(unten, mitte, 'is-normal'));
  if (r.MHW !== undefined) segs.push(seg(r.MHW, r.HSW ?? hi, 'is-high'));
  if (r.HSW !== undefined) segs.push(seg(r.HSW, hi, 'is-hsw'));
  const label = `Aktuell ${fmt(g.value)} ${g.unit}. ` + keys.map(k => `${k} ${fmt(r[k])} ${g.unit}`).join(', ') + '.';
  // Beschriftungen mit Mindestabstand, damit nahe Kennwerte nicht übereinander stehen
  const abstand = gross ? 17 : 15;
  const lp = keys.map(k => Math.min(94, Math.max(6, pos(r[k]))));
  for (let i = 1; i < lp.length; i++) lp[i] = Math.max(lp[i], lp[i - 1] + abstand);
  const ueber = lp[lp.length - 1] - 94;
  if (ueber > 0) for (let i = 0; i < lp.length; i++) lp[i] -= ueber;
  for (let i = lp.length - 2; i >= 0; i--) lp[i] = Math.min(lp[i], lp[i + 1] - abstand);
  return h('div', { class: 'ps' + (gross ? ' is-gross' : ''), role: 'img', 'aria-label': label },
    gross ? h('div', { class: 'ps-wert', style: `left:${pos(g.value).toFixed(2)}%`, text: fmt(g.value) }) : null,
    h('div', { class: 'ps-track' }, segs, h('span', { class: 'ps-mark', style: `left:${pos(g.value).toFixed(2)}%` })),
    h('div', { class: 'ps-labels' }, keys.map((k, i) => h('span', { style: `left:${lp[i].toFixed(2)}%`, title: KW_NAME[k] },
      gross ? h('b', { text: fmt(r[k]) }) : null, h('span', { text: k })))));
}

/** Mini-Verlauf (7 Tage) als SVG-Linie. */
export function miniVerlauf(pts, g) {
  if (!pts || pts.length < 2) return null;
  const W = 140, H = 44;
  const vs = pts.map(p => p.v);
  const lo = Math.min(...vs), hi = Math.max(...vs), sp = Math.max(hi - lo, 4);
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const x = (t) => 2 + (t - t0) / Math.max(t1 - t0, 1) * (W - 6);
  const y = (v) => 4 + (hi - v) / sp * (H - 8);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join('');
  const last = pts[pts.length - 1];
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: `pm-spark ${ZUSTAND[zustand(g)].cls}`, role: 'img',
    'aria-label': `Verlauf 7 Tage: von ${fmt(pts[0].v)} auf ${fmt(last.v)} ${g.unit}, tiefster ${fmt(lo)}, höchster ${fmt(hi)}` });
  svg.append(s('path', { d, class: 'pm-spark-line' }), s('circle', { cx: x(last.t), cy: y(last.v), r: 2.6, class: 'pm-spark-dot' }));
  return svg;
}

export function sternKnopf(g, { klein = false, onChange } = {}) {
  const an = meinePegel.hat(g.id);
  const b = h('button', { type: 'button', class: 'pm-stern' + (klein ? ' is-klein' : '') + (an ? ' is-on' : ''), 'aria-pressed': String(an),
    'aria-label': an ? `${g.name} aus „Meine Pegel“ entfernen` : `${g.name} zu „Meine Pegel“ hinzufügen`, html: icon('star', klein ? 20 : 24, an) });
  b.onclick = (e) => { e.stopPropagation(); meinePegel.umschalten(g.id); onChange?.(); };
  return b;
}

const aenderungText = (d) => (d === null ? null : `${d > 0 ? '+' : d < 0 ? '−' : '±'}${fmt(Math.abs(d))} cm in 24 h`);

/** Karte für „Meine Pegel“ (Dashboard). verlauf: Promise<pts>. */
export function pegelKarte(g, { verlauf, onOpen, bearbeiten = null }) {
  const z = zustand(g);
  const trend = h('p', { class: `pm-trend ${trendKlasse(g)}`, text: trendText(g) });
  const spark = h('div', { class: 'pm-spark-box', 'aria-hidden': 'false' });
  const karte = h('article', { class: `pm-karte ${ZUSTAND[z].cls}` + (z === 'hsw' ? ' is-hsw' : ''), dataset: { id: g.id } },
    h('button', { type: 'button', class: 'pm-flaeche', onclick: onOpen, 'aria-label': `${g.name}, ${g.water}: ${fmt(g.value)} ${g.unit}, ${ZUSTAND[z].text}. Details öffnen` }),
    h('div', { class: 'pm-kopf' },
      h('div', {}, h('h3', { class: 'pm-name', text: g.name }), h('p', { class: 'pm-wasser', text: [g.water, kmText(g)].filter(Boolean).join(' · ') })),
      etikett(g)),
    h('div', { class: 'pm-mitte' },
      h('p', { class: 'pm-wert' }, h('strong', { text: fmt(g.value) }), h('span', { text: ` ${g.unit}` })),
      spark),
    trend,
    skala(g),
    bearbeiten);
  verlauf?.then((pts) => {
    const d = aenderung24h(pts);
    if (d !== null) trend.textContent = [trendText(g), aenderungText(d)].filter(Boolean).join(' · ');
    const sv = miniVerlauf(pts.filter(p => p.t >= pts[pts.length - 1].t - 7 * 864e5), g);
    if (sv) spark.replaceChildren(sv);
  }, () => {});
  return karte;
}

/**
 * Pegel-Detailseite (Dashboard, Sheet auf dem Handy, rechtes Panel am Desktop).
 * opts = { verlauf: Promise<pts>, onBack, backLabel, onShare, onAmpel, onKarte, slips: [{p, d}], onSlip(p), onStern, eingebettet, wetter }
 */
export function pegelDetail(g, opts) {
  const z = zustand(g);
  const titel = h('h1', { class: 'pd-name', id: 'pd-name', tabindex: '-1', text: g.name });
  const aend = h('span', { class: `pd-aend ${trendKlasse(g)}`, text: trendText(g) });
  const kopf = h('header', { class: 'pd-kopf' },
    h('div', { class: 'pd-leiste' },
      h('button', { type: 'button', class: 'pd-icon', 'aria-label': opts.backLabel || 'Zurück', html: icon(opts.eingebettet ? 'close' : 'back', 24), onclick: opts.onBack }),
      h('span', { class: 'pd-luecke' }),
      h('button', { type: 'button', class: 'pd-icon', 'aria-label': 'Pegel teilen', html: icon('share', 22), onclick: opts.onShare }),
      sternKnopf(g, { onChange: opts.onStern })),
    h('p', { class: 'pd-kicker', text: ['Pegel', g.water, kmText(g).replace('km', 'KM')].filter(Boolean).join(' · ') }),
    titel,
    h('div', { class: 'pd-wertzeile' },
      h('p', { class: 'pd-wert' }, h('strong', { text: fmt(g.value) }), h('span', { text: g.unit })),
      h('div', { class: 'pd-wertinfo' }, etikett(g), aend)),
    h('p', { class: 'pd-zeit' + (g.state === 'old' ? ' is-alt' : '') },
      g.state === 'old' ? h('span', { html: icon('clock', 15) }) : null,
      g.state === 'old' ? `Veraltet – gemessen ${formatTime(g.time)}` : `Gemessen ${formatTime(g.time)}`));

  const body = h('div', { class: 'pd-body' });
  // Wo steht der Pegel?
  const sk = skala(g, { gross: true });
  body.append(h('section', { class: 'pd-karte' }, h('h2', { text: 'Wo steht der Pegel?' }), sk, h('p', { class: 'pd-klartext', text: klartext(g) })));

  // Verlauf 24 h / 7 Tage
  const chart = h('div', { class: 'gauge-chart', 'aria-busy': 'true' }, h('p', { class: 'muted small', text: 'Verlauf wird geladen …' }));
  const stats = h('div', { class: 'pd-stats' });
  let bereich = '7d', alle = null;
  const zeichnen = () => {
    if (!alle) return;
    const cut = bereich === '24h' ? alle[alle.length - 1].t - 24 * 3600e3 : -Infinity;
    const pts = alle.filter(p => p.t >= cut);
    chart.removeAttribute('aria-busy');
    if (pts.length < 2) { chart.replaceChildren(h('p', { class: 'unknown', text: 'Keine Messreihe verfügbar.' })); stats.replaceChildren(); return; }
    chart.replaceChildren(...historyChart(pts, g));
    const vs = pts.map(p => p.v); const d = pts[pts.length - 1].v - pts[0].v;
    const kachel = (l, v, cls = '') => h('div', { class: 'pd-stat' }, h('span', { text: l }), h('strong', { class: cls, text: v }));
    stats.replaceChildren(kachel('Höchster', `${fmt(Math.max(...vs))} ${g.unit}`), kachel('Tiefster', `${fmt(Math.min(...vs))} ${g.unit}`),
      kachel('Änderung', `${d > 0 ? '+' : d < 0 ? '−' : '±'}${fmt(Math.abs(d))} ${g.unit}`, d < 0 ? 'is-minus' : d > 0 ? 'is-plus' : ''));
  };
  const umschalter = h('div', { class: 'pd-umschalter', role: 'group', 'aria-label': 'Zeitraum' },
    ['24h', '7d'].map(k => h('button', { type: 'button', 'aria-pressed': String(k === bereich), dataset: { bereich: k }, text: k === '24h' ? '24 h' : '7 Tage',
      onclick: (e) => { bereich = k; for (const b of umschalter.children) b.setAttribute('aria-pressed', String(b.dataset.bereich === k)); zeichnen(); } })));
  body.append(h('section', { class: 'pd-karte' }, h('div', { class: 'pd-karte-kopf' }, h('h2', { text: 'Verlauf' }), umschalter), chart, stats));
  opts.verlauf.then((pts) => {
    alle = pts; zeichnen();
    const d = aenderung24h(pts);
    if (d !== null) aend.textContent = [trendText(g), aenderungText(d)].filter(Boolean).join(' · ');
  }, () => { chart.removeAttribute('aria-busy'); chart.replaceChildren(h('p', { class: 'unknown', text: 'Verlauf konnte nicht geladen werden.' })); });

  // Kacheln
  body.append(h('div', { class: 'pd-kacheln' },
    h('a', { class: 'pd-kachel is-dunkel', href: `./pegel-ampel?pegel=${encodeURIComponent(g.id)}`, onclick: opts.onAmpel },
      h('strong', { text: 'Passt mein Boot?' }), h('span', { text: 'In Pegel-Ampel prüfen ›' })),
    opts.onKarte ? h('button', { type: 'button', class: 'pd-kachel', onclick: opts.onKarte },
      h('strong', { text: 'Auf der Karte' }), h('span', { text: 'mit Slipanlagen in der Nähe ›' })) : null));

  // Wetter am Pegel (nur im Kartenpanel)
  if (opts.wetter) { opts.wetter.classList.add('pd-karte', 'pd-wetter'); body.append(opts.wetter); }

  // Slipanlagen an diesem Pegel
  if (opts.slips) {
    body.append(h('section', { class: 'pd-karte' }, h('h2', { text: 'Slipanlagen an diesem Pegel' }),
      opts.slips.length
        ? h('ul', { class: 'pd-slips' }, opts.slips.map(({ p, d, name }) => h('li', {}, h('button', { type: 'button', onclick: () => opts.onSlip?.(p) },
          h('span', { class: 'pd-slip-name', text: name }), h('span', { class: 'pd-slip-km', text: d < 1000 ? `${Math.round(d / 10) * 10} m` : `${(d / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} km` })))))
        : h('p', { class: 'muted', text: 'Keine Slipanlage am selben Gewässer in der Nähe bekannt.' })));
  }
  body.append(h('p', { class: 'pd-hinweis', text: 'Kennwerte und Messungen: WSV/PEGELONLINE. Normal/Niedrig/Hoch beziehen sich auf die amtlichen Kennwerte dieses Pegels, nicht auf dein Boot. Der Pegel ist nicht die Wassertiefe.' }));
  return h('article', { class: `pd ${ZUSTAND[z].cls}` + (opts.eingebettet ? ' is-eingebettet' : ''), 'aria-labelledby': 'pd-name' }, kopf, body);
}

// Bereich „Pegel“: Fluss-Kacheln im Dashboard und Flussseite (#pegel/fluss/<name>) mit Profil und Pegelliste.
import { h } from './dom.js';
import { icon, glyphSvg } from './icons.js';
import { fmt } from './pegel-ansicht.js';
import { FLUSS_ZUSTAND, flussZustand, punkte, profil, slipsAmFluss, artikel } from './pegel-fluss.js';

const PFEIL = { 1: '↗', 0: '→', '-1': '↘' };
const TREND = { 1: 'steigend', 0: 'gleichbleibend', '-1': 'fallend' };
const PUNKT_FARBE = { hsw: '#D03B3B', high: '#EC835A', low: '#FAB219', normal: '#6CBF84' };
const SVG_NS = 'http://www.w3.org/2000/svg';
const kmZahl = (km) => km.toLocaleString('de-DE', { maximumFractionDigits: 1 });
const zeitText = (t) => new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

function trendPfeil(g) {
  if (g.trend === null || g.trend === undefined) return null;
  return h('span', { class: `pf-trend t${g.trend}`, title: TREND[g.trend], 'aria-label': TREND[g.trend], text: PFEIL[g.trend] });
}
function fzEtikett(key) {
  const z = FLUSS_ZUSTAND[key];
  return h('span', { class: `pz-tag ${z.cls} pf-etikett`, text: z.text });
}
/** Etikett eines Pegels in der Liste (Text, nie nur Farbe). */
function pegelEtikett(g) {
  const t = { hsw: ['über HSW', 'pz-hsw'], high: ['hoch', 'pz-high'], low: ['niedrig', 'pz-low'], normal: ['normal', 'pz-normal'] }[g.state]
    || (g.state === 'old' ? ['veraltet', 'pz-old'] : [g.tide ? 'Tide' : 'ohne Kennw.', 'pz-none']);
  return h('span', { class: `pz-tag ${t[1]} pf-etikett`, text: t[0] });
}

// ------------------------------------------------------------------ Kacheln im Dashboard
/** Eine Kachel (Link zur Flussseite). */
export function flussKachel(f, onOpen) {
  const z = f.zustand || flussZustand(f);
  const fz = FLUSS_ZUSTAND[z.key];
  let klein, gross, reihe = null;
  if (f.art === 'kueste') { klein = 'Nord- und Ostsee'; gross = h('span', { text: `${f.pegel.length} Pegel` }); }
  else if (z.key === 'keine') { klein = `${f.pegel.length} Pegel`; gross = h('span', { text: 'keine aktuellen Daten' }); }
  else if (z.hervor) {
    klein = `${z.hervorArt} Pegel`;
    gross = h('span', {}, `${z.hervor.name} ${fmt(z.hervor.value)} ${z.hervor.unit}`, trendPfeil(z.hervor) ? ' ' : null, trendPfeil(z.hervor));
  } else { klein = `alle ${z.n} Pegel`; gross = h('span', { text: 'im Normalbereich' }); }
  if (f.art === 'fluss' && z.key !== 'keine') {
    reihe = h('span', { class: 'fk-punkte', 'aria-hidden': 'true' }, punkte(f).map(g => h('i', { style: `background:${PUNKT_FARBE[g.state]}` })));
  }
  const label = `${f.name}: ${fz.text}. ${z.hervor ? `${z.hervorArt} Pegel ${z.hervor.name} ${fmt(z.hervor.value)} ${z.hervor.unit}. ` : ''}${z.kachel}. Alle Pegel zeigen`;
  return h('a', { class: `fk fk-${z.key}`, href: `#pegel/fluss/${f.slug}`, style: `--fk:${fz.farbe}`, 'aria-label': label,
    onclick: (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return; e.preventDefault(); onOpen(f.slug); } },
    h('span', { class: 'fk-kopf' }, h('strong', { class: 'fk-name', text: f.name }), fzEtikett(z.key)),
    h('span', { class: 'fk-klein', text: klein }),
    h('span', { class: 'fk-gross' }, gross),
    reihe,
    h('span', { class: 'fk-zus', text: z.kachel }));
}

/** Abschnitt „Kanäle und Gewässer ohne Bewertung“ (nur unter „Alle Gewässer“). */
export function ohneBewertung(ohne, onOpen) {
  if (!ohne.length) return null;
  return h('section', { class: 'fk-ohne', 'aria-labelledby': 'fk-ohne-t' },
    h('h3', { id: 'fk-ohne-t', text: 'Kanäle und Gewässer ohne Bewertung' }),
    h('ul', {}, ohne.map(f => h('li', {}, h('a', { href: `#pegel/fluss/${f.slug}`, class: 'fk-ohne-zeile',
      onclick: (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return; e.preventDefault(); onOpen(f.slug); } },
      h('span', { class: 'fk-ohne-name', text: f.name }), h('span', { class: 'fk-ohne-n', text: `${f.pegel.length} Pegel` }),
      h('span', { html: icon('chevron', 18), 'aria-hidden': 'true' }))))));
}

// ------------------------------------------------------------------ Profil (SVG)
function svg(tag, attrs = {}, ...kinder) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, v);
  for (const k of kinder.flat()) if (k) el.append(k.nodeType ? k : document.createTextNode(String(k)));
  return el;
}

/** Profil in box zeichnen (Breite = Breite der Karte). opts = { onOpen(id), isMobile(), hervorId } */
function profilZeichnen(box, pr, gr, opts) {
  const handy = opts.isMobile();
  const W = Math.max(280, Math.round(box.clientWidth || 600)), H = handy ? 220 : 190;
  const L = 8, R = 8, T = 30, B = 26, [ymin, ymax] = pr.yBereich;
  const xs = (pos) => L + pos * (W - L - R);   // pos: halb km, halb Reihenfolge (pegel-fluss.js)
  const ys = (y) => T + (ymax - y) / (ymax - ymin) * (H - T - B);
  const rechts = pr.tide ? xs(pr.tide.pos) : W - R;
  const s = svg('svg', { class: 'pf-svg', viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'group', 'aria-label': box.dataset.label });
  s.append(
    svg('rect', { x: L, y: ys(1), width: W - L - R, height: ys(0) - ys(1), fill: '#E4F4E8' }),
    svg('line', { x1: L, x2: W - R, y1: ys(1), y2: ys(1), stroke: '#EC835A', 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }),
    svg('line', { x1: L, x2: W - R, y1: ys(0), y2: ys(0), stroke: '#E0A100', 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }),
    svg('text', { x: L + 2, y: ys(1) - 5, class: 'pf-ax is-mhw' }, 'MHW'),
    svg('text', { x: L + 2, y: ys(0) - 5, class: 'pf-ax is-mnw' }, 'MNW'),
    svg('text', { x: rechts - 6, y: ys(1) + 15, 'text-anchor': 'end', class: 'pf-ax is-normal' }, 'normaler Bereich'));
  if (pr.tide) {
    s.append(svg('line', { x1: rechts, x2: rechts, y1: 4, y2: H - B + 4, stroke: '#9AAAB5', 'stroke-width': 1.5 }),
      svg('text', { x: Math.min(W - 6, rechts + 6), y: 14, 'text-anchor': rechts > W - 110 ? 'end' : 'start', class: 'pf-ax is-tide' }, pr.tide.label));
  }
  const pts = pr.punkte;
  if (pts.length > 1) s.append(svg('polyline', { points: pts.map(p => `${xs(p.pos).toFixed(1)},${ys(p.y).toFixed(1)}`).join(' '), fill: 'none', stroke: '#0B3045', 'stroke-width': 2, 'stroke-linejoin': 'round' }));
  const blase = h('div', { class: 'pf-blase', hidden: true, role: 'status' });
  const zeigeBlase = (p, mitKnopf) => {
    const g = p.g;
    blase.replaceChildren(h('strong', { text: g.name }), h('span', { text: `${fmt(g.value)} ${g.unit} · ${pegelEtikett(g).textContent}` }),
      mitKnopf ? h('button', { type: 'button', class: 'pf-blase-btn', text: 'Details ›', onclick: () => opts.onOpen(g.id) }) : null);
    blase.hidden = false;
    blase.classList.toggle('mit-knopf', mitKnopf);   // nur Hover: Blase fängt keine Klicks ab
    const bx = xs(p.pos) / W * box.clientWidth, py = ys(p.y);
    blase.style.left = `${Math.max(4, Math.min(box.clientWidth - 170, bx - 80))}px`;
    const oben = py - blase.offsetHeight - 16;
    blase.style.top = `${oben >= -20 ? oben : py + 18}px`;
  };
  let hervor = null;
  for (const p of pts) {
    const ist = p.g.id === opts.hervorId;
    const kreis = svg('circle', { cx: xs(p.pos), cy: ys(p.y), r: ist ? 8 : handy ? 4 : 5, fill: PUNKT_FARBE[p.g.state], stroke: ist ? '#0B3045' : '#fff', 'stroke-width': ist ? 3 : 1.5, class: 'pf-punkt' });
    const ziel = svg('circle', { cx: xs(p.pos), cy: ys(p.y), r: 16, fill: 'transparent', class: 'pf-ziel', tabindex: 0, role: 'button',
      'aria-label': `${p.g.name}: ${fmt(p.g.value)} ${p.g.unit}, ${pegelEtikett(p.g).textContent}. Details öffnen` });
    ziel.addEventListener('mouseenter', () => { if (!opts.isMobile()) zeigeBlase(p, false); });
    ziel.addEventListener('mouseleave', () => { if (!opts.isMobile()) blase.hidden = true; });
    ziel.addEventListener('focus', () => zeigeBlase(p, false));
    ziel.addEventListener('blur', () => { if (!opts.isMobile()) blase.hidden = true; });
    ziel.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); opts.onOpen(p.g.id); } });
    ziel.addEventListener('click', () => { if (!opts.isMobile()) opts.onOpen(p.g.id); });
    s.append(kreis, ziel);
    if (ist) hervor = p;
  }
  // Handy: Tipp zeigt die Blase des nächstgelegenen Punkts (Tippflächen dicht liegender Pegel überlappen), „Details ›“ öffnet
  s.addEventListener('click', (e) => {
    if (!opts.isMobile() || !pts.length) return;
    const r = s.getBoundingClientRect(), x = (e.clientX - r.left) * W / r.width, y = (e.clientY - r.top) * H / r.height;
    const p = pts.reduce((m, q) => (Math.hypot(xs(q.pos) - x, ys(q.y) - y) < Math.hypot(xs(m.pos) - x, ys(m.y) - y) ? q : m));
    if (Math.hypot(xs(p.pos) - x, ys(p.y) - y) > 40) { blase.hidden = true; return; }
    e.stopPropagation();
    zeigeBlase(p, true);
  });
  if (hervor) {
    const text = `${hervor.g.name} ${fmt(hervor.g.value)} ${hervor.g.unit}`, bw = Math.min(W - 8, text.length * 7.6 + 20);
    // bevorzugt unter dem Punkt (über der Fläche stehen MHW/MNW-Beschriftungen), sonst darüber
    const x = Math.max(4, Math.min(W - bw - 4, xs(hervor.pos) - bw / 2)), unten = ys(hervor.y) + 14 + 24 <= H - 2;
    const y = unten ? ys(hervor.y) + 14 : ys(hervor.y) - 14 - 24;
    s.append(svg('rect', { x, y, width: bw, height: 24, rx: 12, fill: '#0B3045' }), svg('text', { x: x + bw / 2, y: y + 16, 'text-anchor': 'middle', class: 'pf-hervor-text' }, text));
  }
  box.replaceChildren(s, blase);
}

/** Karte „Wasserstand entlang der <Fluss>“. */
function profilKarte(gr, z, opts) {
  const pr = profil(gr);
  if (!pr || !pr.punkte.length) return null;
  const n = (k) => pr.punkte.filter(p => p.g.state === k).length;
  const kmT = (g) => `${g.name} (km ${kmZahl(g.km)})`;
  const label = `Wasserstand ${artikel(gr.name).entlang}: ${pr.punkte.length} Pegel mit Kennwerten von ${kmT(pr.von)} bis ${kmT(pr.bis)}. `
    + [n('low') && `${n('low')} unter MNW`, n('normal') && `${n('normal')} normal`, n('high') && `${n('high')} über MHW`, n('hsw') && `${n('hsw')} über HSW`].filter(Boolean).join(', ') + '.'
    + (z.hervor ? ` ${z.hervorArt === 'tiefster' ? 'Tiefster' : 'Höchster'} Pegel: ${z.hervor.name} ${fmt(z.hervor.value)} ${z.hervor.unit}.` : '')
    + (pr.tide ? ` Danach ${pr.tide.label === 'Tidebereich' ? 'Tidebereich' : 'Pegel'} ohne Kennwerte.` : '');
  const box = h('div', { class: 'pf-profil', dataset: { label } });
  const karte = h('section', { class: 'pf-karte pf-profilkarte', 'aria-labelledby': 'pf-profil-t' },
    h('h2', { id: 'pf-profil-t', class: 'pf-h2', text: `Wasserstand ${artikel(gr.name).entlang}` }),
    box,
    h('p', { class: 'pf-enden' }, h('span', { text: `← ${kmT(pr.von)}` }), h('span', { text: `${kmT(pr.bis)} →` })),
    h('p', { class: 'pf-legende' }, [['#FAB219', 'unter MNW'], ['#6CBF84', 'normal'], ['#EC835A', 'über MHW'], ['#D03B3B', 'über HSW']]
      .map(([f, t]) => h('span', {}, h('i', { style: `background:${f}` }), t))));
  const zeichnen = () => { if (box.isConnected) profilZeichnen(box, pr, gr, { ...opts, hervorId: z.hervor?.id }); };
  requestAnimationFrame(zeichnen);
  let w = 0;
  const ro = new ResizeObserver(() => {
    if (!box.isConnected) { ro.disconnect(); return; }
    if (box.clientWidth && Math.abs(box.clientWidth - w) > 4) { w = box.clientWidth; zeichnen(); }
  });
  ro.observe(box);
  blaseSchliessenBinden();
  return karte;
}

// Tipp daneben schließt die Blase (einmal für alle Profile)
let blaseGebunden = false;
function blaseSchliessenBinden() {
  if (blaseGebunden) return;
  blaseGebunden = true;
  document.addEventListener('click', (e) => {
    for (const b of document.querySelectorAll('.pf-blase:not([hidden])')) if (!e.target.closest('.pf-ziel, .pf-blase')) b.hidden = true;
  });
}

// ------------------------------------------------------------------ Flussseite
/**
 * Flussseite in root zeichnen. ctx = { onOpen(id), back(), isMobile(), places(), slipsAufKarte(liste), stand }
 */
export function flussSeite(root, gr, ctx) {
  const z = flussZustand(gr);
  const pr = gr.art === 'fluss' ? profil(gr) : null;
  const st = ctx.stand;
  const stand = st.offline ? `Offline · Stand von ${new Date(st.zeit).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}, ${zeitText(st.zeit)} Uhr` : `Stand ${zeitText(st.zeit)}`;
  const kopf = h('header', { class: 'pf-kopf' },
    h('button', { type: 'button', class: 'pf-zurueck', 'aria-label': 'Zurück zur Übersicht', html: icon('back', 24), onclick: ctx.back }),
    h('p', { class: 'pf-kicker', text: gr.art === 'kueste' ? 'Küste' : 'Gewässer' }),
    h('div', { class: 'pf-titel-zeile' }, h('h1', { id: 'pf-name', class: 'pf-titel', tabindex: '-1', text: gr.name }), fzEtikett(z.key)),
    h('p', { class: 'pf-zus', text: z.kopf }),
    h('p', { class: 'pf-stand', text: stand }));

  // Pegelliste (nach km; Küste nach Gewässer)
  let offen = false;
  const liste = h('ul', { class: 'pf-liste' });
  const mehr = h('button', { type: 'button', class: 'pg-link pf-mehr', onclick: () => { offen = !offen; listeZeichnen(); } });
  function zeile(g) {
    const ist = z.hervor?.id === g.id;
    const zusatz = ist ? (z.hervorArt === 'tiefster' ? 'tiefster' : 'höchster') : (pr?.tide?.ids.has(g.id) && g.tide ? 'Tide' : null);
    const ort = [gr.art === 'kueste' ? g.water : null, g.km !== null && g.km !== undefined ? `km ${kmZahl(g.km)}` : null, zusatz].filter(Boolean).join(' · ');
    return h('li', {}, h('button', { type: 'button', class: 'pf-zeile' + (ist ? ` is-hervor is-${z.key}` : ''), onclick: () => ctx.onOpen(g.id),
      'aria-label': `${g.name}${ort ? `, ${ort}` : ''}: ${fmt(g.value)} ${g.unit}${g.trend !== null && g.trend !== undefined ? `, ${TREND[g.trend]}` : ''}, ${pegelEtikett(g).textContent}. Details öffnen` },
      h('span', { class: 'pf-z-text' }, h('strong', { text: g.name }), ort ? h('small', { text: ort }) : null),
      h('span', { class: 'pf-z-wert', text: `${fmt(g.value)} ${g.unit}` }),
      h('span', { class: 'pf-z-trend', 'aria-hidden': 'true' }, trendPfeil(g)),
      pegelEtikett(g)));
  }
  function listeZeichnen() {
    const alle = gr.pegel, zeigen = offen ? alle : alle.slice(0, 6);
    liste.replaceChildren(...zeigen.map(zeile));
    mehr.hidden = alle.length <= 6;
    mehr.textContent = offen ? 'Weniger anzeigen' : `Alle ${alle.length} Pegel anzeigen ›`;
    mehr.setAttribute('aria-expanded', String(offen));
  }
  listeZeichnen();
  const listenKarte = h('section', { class: 'pf-karte pf-listenkarte', 'aria-labelledby': 'pf-liste-t' },
    h('div', { class: 'pf-h2-zeile' }, h('h2', { id: 'pf-liste-t', class: 'pf-h2', text: `Alle ${gr.pegel.length} Pegel` }),
      h('span', { class: 'pf-klein', text: gr.art === 'kueste' ? 'nach Gewässer' : 'nach Flusskilometer' })),
    liste, mehr);

  // Slipanlagen an diesem Gewässer
  const slips = gr.art === 'kueste' ? [] : slipsAmFluss(gr.name, ctx.places());
  const slipKarte = slips.length ? h('button', { type: 'button', class: 'pf-karte pf-slips', onclick: () => ctx.slipsAufKarte(slips) },
    h('span', { class: 'pf-slips-ico bg-slip', html: glyphSvg('slip', 26), 'aria-hidden': 'true' }),
    h('span', { class: 'pf-slips-text' }, h('strong', { text: `${slips.length} Slipanlage${slips.length === 1 ? '' : 'n'} ${artikel(gr.name).an}` }), h('small', { text: 'Auf der Karte zeigen' })),
    h('span', { class: 'pf-slips-pfeil', html: icon('chevron', 20), 'aria-hidden': 'true' })) : null;

  const hinweis = h('p', { class: 'pf-hinweis', text: 'Normal/Niedrig/Hoch nach den amtlichen Kennwerten der einzelnen Pegel (WSV/PEGELONLINE). Tidepegel ohne Bewertung.' });
  const profilK = pr ? profilKarte(gr, z, { onOpen: ctx.onOpen, isMobile: ctx.isMobile }) : null;
  // Raster: Handy Profil · Liste · Slipanlagen · Hinweis; Desktop links Profil (+ Slipanlagen, Hinweis), rechts die Liste
  root.replaceChildren(h('div', { class: 'pg-seite pf-seite' }, kopf,
    h('div', { class: 'pf-raster' + (profilK ? '' : ' ohne-profil') }, profilK, listenKarte, slipKarte, hinweis)));
}

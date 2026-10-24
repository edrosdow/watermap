// Tidepegel: Detailseite (Kopf, Tidekurve, Einordnung) und kleine Bausteine für „Meine Pegel“ und die Flussseite.
// Grundlage sind die gemessenen Werte (WSV/PEGELONLINE); dazu, wo vorhanden, die Gezeitenvorhersage des BSH.
import { h } from './dom.js';
import { icon } from './icons.js';
import { formatTime } from './pegel.js';
import { auswerten, TENDENZ } from './gezeiten.js';
import { vorhersageLaden, kommende, hoehe, inText, tagUhr, standText, ART } from './gezeiten-bsh.js';
import { fmt, kmText, sternKnopf, etikett } from './pegel-ansicht.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const uhr = (t) => new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
function svg(tag, attrs = {}, ...kinder) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, v);
  for (const k of kinder.flat()) if (k) el.append(k.nodeType ? k : document.createTextNode(String(k)));
  return el;
}

/** „↗ auflaufend“ als Text (null, wenn unbekannt). */
export const tendenzText = (a) => (a?.tendenz ? `${TENDENZ[a.tendenz].pfeil} ${TENDENZ[a.tendenz].text}` : null);

/** Kurzinfo für Karten: „HW 02:07 · NW 08:20“ (die letzten gemessenen). */
export function letzteText(a) {
  if (!a) return null;
  const teile = [a.hw && { t: a.hw.t, s: `HW ${uhr(a.hw.t)}` }, a.nw && { t: a.nw.t, s: `NW ${uhr(a.nw.t)}` }].filter(Boolean).sort((x, y) => x.t - y.t);
  return teile.length ? `zuletzt ${teile.map(x => x.s).join(' · ')}` : null;
}

/** Kurzinfo „nächstes HW 14:32 · NW 20:41“ aus der BSH-Vorhersage (null ohne). */
export function naechsteText(v) {
  const k = kommende(v?.d).slice(0, 2);
  return k.length ? `nächstes ${k.map(e => `${e.typ} ${tagUhr(e.t)}`).join(' · ')}` : null;
}

const LIZENZ_URL = 'https://creativecommons.org/licenses/by/4.0/deed.de';

/** „gestern 12 Uhr“ / „heute 9 Uhr“ für den Anfang der Kurve. */
function tagStunde(t) {
  const d = new Date(t), heute = new Date();
  const tag = d.toDateString() === heute.toDateString() ? 'heute' : 'gestern';
  return `${tag} ${d.getHours()} Uhr`;
}

/** Tidekurve: 24 h gemessen, mit BSH-Vorhersage zusätzlich 12 h voraus (gestrichelt, grau hinterlegt). */
function kurveZeichnen(box, g, pts, a, v) {
  const W = Math.max(280, Math.round(box.clientWidth || 600)), H = 190, L = 6, R = 10, T = 26, B = 22;
  const jetzt = pts[pts.length - 1].t, start = jetzt - 24 * 3600e3;
  const vk = (v?.d.kurve || []).filter(k => k.t > jetzt && k.t <= jetzt + 12 * 3600e3).map(k => ({ t: k.t, v: k.vh ?? k.astro })).filter(k => Number.isFinite(k.v));
  const ve = v ? kommende(v.d, jetzt).filter(e => e.t <= jetzt + 12 * 3600e3) : [];
  const ende = vk.length ? jetzt + 12 * 3600e3 : jetzt;
  let teil = pts.filter(p => p.t >= start);
  if (teil.length > 400) { const k = Math.ceil(teil.length / 400); teil = teil.filter((p, i) => i % k === 0 || i === teil.length - 1); }
  const r = g.tideRefs || {};
  const werte = [...teil.map(p => p.v), ...vk.map(p => p.v), ...ve.map(hoehe), r.MThw, r.MTnw].filter(Number.isFinite);
  const lo = Math.min(...werte), hi = Math.max(...werte), rand = Math.max(10, (hi - lo) * 0.08);
  const y0 = lo - rand, y1 = hi + rand;
  const xs = (t) => L + (t - start) / (ende - start) * (W - L - R);
  const ys = (v2) => T + (y1 - v2) / (y1 - y0) * (H - T - B);
  const linie = (reihe) => reihe.map((p, i) => `${i ? 'L' : 'M'}${xs(p.t).toFixed(1)},${ys(p.v).toFixed(1)}`).join('');
  const pfad = linie(teil);
  const vorher = ve.length ? `, Vorhersage: ${ve.map(e => `${ART[e.typ]} ${uhr(e.t)} Uhr ${fmt(hoehe(e))} cm`).join(', ')}` : '';
  const s = svg('svg', { class: 'pt-svg', viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img',
    'aria-label': `Tidekurve der letzten 24 Stunden: ${a?.extreme.map(e => `${ART[e.typ]} ${uhr(e.t)} Uhr ${fmt(e.v)} cm`).join(', ') || 'keine Hoch- und Niedrigwasser erkannt'}. Jetzt ${fmt(g.value)} cm${a?.tendenz ? `, ${TENDENZ[a.tendenz].text}` : ''}${vorher}.` });
  if (vk.length) s.append(svg('rect', { class: 'pt-zukunft', x: xs(jetzt), y: T - 6, width: W - R - xs(jetzt), height: H - B - T + 6, fill: '#EEF1F3' }));
  s.append(svg('path', { d: `${pfad}L${xs(teil[teil.length - 1].t).toFixed(1)},${H - B}L${xs(teil[0].t).toFixed(1)},${H - B}Z`, fill: '#E3F1F5' }));
  for (const k of ['MThw', 'MTnw']) {
    if (!Number.isFinite(r[k])) continue;
    s.append(svg('line', { x1: L, x2: W - R, y1: ys(r[k]), y2: ys(r[k]), stroke: '#8A9BA6', 'stroke-width': 1.2, 'stroke-dasharray': '5 4' }),
      svg('text', { x: L + 2, y: ys(r[k]) + (k === 'MThw' ? -5 : 14), class: 'pt-ax' }, k));
  }
  s.append(svg('path', { d: pfad, fill: 'none', stroke: '#087F9C', 'stroke-width': 2.5, 'stroke-linejoin': 'round' }));
  if (vk.length) s.append(svg('path', { class: 'pt-vorhersage', d: linie([{ t: jetzt, v: g.value }, ...vk]), fill: 'none', stroke: '#087F9C', 'stroke-width': 2, 'stroke-dasharray': '6 5', 'stroke-linejoin': 'round' }));
  const zeit = (x, y, typ, t) => svg('text', { x: Math.max(18, Math.min(W - 18, x)), y: typ === 'HW' ? y - 9 : y + 18, 'text-anchor': 'middle', class: 'pt-zeit' }, uhr(t));
  for (const e of a?.extreme || []) {
    const x = xs(e.t), y = ys(e.v);
    s.append(svg('circle', { cx: x, cy: y, r: 4.5, fill: '#0B3045' }), zeit(x, y, e.typ, e.t));
  }
  for (const e of vk.length ? ve : []) {
    const x = xs(e.t), y = ys(hoehe(e));
    s.append(svg('circle', { class: 'pt-vh-punkt', cx: x, cy: y, r: 4.5, fill: '#fff', stroke: '#0B3045', 'stroke-width': 2 }), zeit(x, y, e.typ, e.t));
  }
  const xj = xs(jetzt), yj = ys(g.value);
  s.append(svg('line', { x1: xj, x2: xj, y1: T - 6, y2: H - B, stroke: '#0B3045', 'stroke-width': 1.5 }),
    svg('rect', { x: Math.min(xj - 18, W - R - 36), y: 2, width: 36, height: 18, rx: 9, fill: '#0B3045' }),
    svg('text', { x: Math.min(xj, W - R - 18), y: 15, 'text-anchor': 'middle', class: 'pt-jetzt' }, 'jetzt'),
    svg('circle', { cx: xj, cy: yj, r: 5.5, fill: '#087F9C', stroke: '#fff', 'stroke-width': 2 }));
  box.replaceChildren(s);
  return vk.length > 0;
}

/** Karte „Gezeiten“: nächstes Hoch- und Niedrigwasser (BSH), danach drei weitere als Pillen. */
function gezeitenKarte(v) {
  const k = kommende(v.d);
  if (!k.length) return null;
  const kachel = (e) => h('div', { class: `pt-gz-kachel is-${e.typ.toLowerCase()}` },
    h('span', { class: 'pt-klein', text: `Nächstes ${ART[e.typ]}` }),
    h('strong', { class: 'pt-gz-zeit', text: tagUhr(e.t) }),
    h('span', { class: 'pt-gz-in', text: inText(e.t) }),
    h('small', { text: e.vh !== undefined ? [`${fmt(e.vh)} cm`, e.abw ? `${e.abw} zum Mittel` : null].filter(Boolean).join(' · ') : `${fmt(e.astro)} cm (Gezeitenrechnung)` }));
  const erste = k.slice(0, 2), weitere = k.slice(2, 5);
  return h('section', { class: 'pd-karte pt-gezeiten', 'aria-labelledby': 'pt-gz-t' },
    h('div', { class: 'pd-karte-kopf' }, h('h2', { id: 'pt-gz-t', text: 'Gezeiten' }), h('span', { class: 'pt-klein' + (v.offline ? ' is-alt' : ''), text: `Vorhersage BSH · ${standText(v)}` })),
    h('div', { class: 'pt-gz-reihe' }, erste.map(kachel)),
    weitere.length ? h('ul', { class: 'pt-gz-pillen', 'aria-label': 'Danach' }, weitere.map(e => h('li', { text: `${e.typ} ${tagUhr(e.t)}` }))) : null,
    v.d.zusatz || v.d.text ? h('p', { class: 'pt-gz-text', text: [v.d.text, v.d.zusatz].filter(Boolean).join(' ') }) : null,
    h('p', { class: 'pt-gz-quelle' }, 'Gezeitenvorhersage: ', h('a', { href: v.d.link || 'https://wasserstand.bsh.de/', target: '_blank', rel: 'noopener noreferrer', text: 'BSH' }),
      ' (', h('a', { href: LIZENZ_URL, target: '_blank', rel: 'noopener noreferrer', text: 'CC BY 4.0' }), '). Angaben ohne Gewähr, nicht für die Navigation.'));
}

/**
 * Detailseite eines Tidepegels. opts wie pegelDetail: { verlauf, onBack, backLabel, onShare, onKarte, onFluss, onStern, eingebettet, wetter }
 */
const HINWEIS = 'Messwerte: WSV/PEGELONLINE. Angaben ohne Gewähr, nicht für die Navigation. Wind kann Hoch- und Niedrigwasser deutlich verschieben.';
const HINWEIS_BSH = 'Messwerte: WSV/PEGELONLINE. Gezeitenvorhersage: BSH (CC BY 4.0). Angaben ohne Gewähr, nicht für die Navigation. Wind kann Hoch- und Niedrigwasser deutlich verschieben.';

export function tideDetail(g, opts) {
  const quelle = h('p', { class: 'pd-hinweis', text: HINWEIS });
  const tend = h('span', { class: 'pd-aend pt-tendenz' });
  const kopf = h('header', { class: 'pd-kopf is-tide' },
    h('div', { class: 'pd-leiste' },
      h('button', { type: 'button', class: 'pd-icon', 'aria-label': opts.backLabel || 'Zurück', html: icon(opts.eingebettet ? 'close' : 'back', 24), onclick: opts.onBack }),
      h('span', { class: 'pd-luecke' }),
      h('button', { type: 'button', class: 'pd-icon', 'aria-label': 'Pegel teilen', html: icon('share', 22), onclick: opts.onShare }),
      sternKnopf(g, { onChange: opts.onStern })),
    h('p', { class: 'pd-kicker', text: ['Tidepegel', g.water, kmText(g).replace('km', 'KM')].filter(Boolean).join(' · ') }),
    h('h1', { class: 'pd-name', id: 'pd-name', tabindex: '-1', text: g.name }),
    h('div', { class: 'pd-wertzeile' },
      h('p', { class: 'pd-wert' }, h('strong', { text: fmt(g.value) }), h('span', { text: g.unit })),
      h('div', { class: 'pd-wertinfo' }, etikett(g), tend)),
    h('p', { class: 'pd-zeit' + (g.state === 'old' ? ' is-alt' : '') }, g.state === 'old' ? `Veraltet – gemessen ${formatTime(g.time)}` : `Gemessen ${formatTime(g.time)}`));

  const box = h('div', { class: 'pt-kurve', 'aria-busy': 'true' }, h('p', { class: 'muted small', text: 'Tidekurve wird geladen …' }));
  const achse = h('p', { class: 'pt-achse' });
  const zeitraum = h('span', { class: 'pt-klein', text: '24 h gemessen' });
  const vhLegende = h('span', { hidden: true }, h('i', { class: 'is-vorhersage' }), 'Vorhersage (BSH)');
  const gzPlatz = h('div', { class: 'pt-gz-platz' });
  const kurvenKarte = h('section', { class: 'pd-karte' },
    h('div', { class: 'pd-karte-kopf' }, h('h2', { text: 'Tidekurve' }), zeitraum),
    box, achse,
    h('p', { class: 'pt-legende' }, h('span', {}, h('i', { class: 'is-linie' }), 'gemessen (WSV)'), vhLegende,
      Number.isFinite(g.tideRefs?.MThw) || Number.isFinite(g.tideRefs?.MTnw) ? h('span', {}, h('i', { class: 'is-mittel' }), 'mittleres Hoch-/Niedrigwasser') : null));
  const einordnung = h('section', { class: 'pd-karte pt-einordnung', hidden: true });

  let a = null, pts = null, v = null;
  const zeichnen = () => {
    if (!pts || !box.isConnected) return;
    const mitVh = kurveZeichnen(box, g, pts, a, v);
    zeitraum.textContent = mitVh ? '24 h gemessen · 12 h Vorhersage' : '24 h gemessen';
    vhLegende.hidden = !mitVh;
    achse.lastChild && (achse.lastChild.textContent = mitVh ? 'in 12 h' : 'jetzt');
  };
  // Gezeitenvorhersage (BSH): Karte „Gezeiten“ und gestrichelte Kurve; ohne BSH-Ort bleibt alles wie gemessen
  vorhersageLaden(g).then((x) => {
    v = x;
    const karte = x ? gezeitenKarte(x) : null;
    if (karte) { gzPlatz.replaceChildren(karte); quelle.textContent = HINWEIS_BSH; }
    zeichnen();
  }, () => {});
  opts.verlauf.then((p) => {
    pts = p; a = auswerten(g, p);
    box.removeAttribute('aria-busy');
    if (!p || p.length < 10) { box.replaceChildren(h('p', { class: 'unknown', text: 'Keine Messreihe verfügbar.' })); return; }
    tend.textContent = tendenzText(a) || '';
    achse.replaceChildren(h('span', { text: tagStunde(p[p.length - 1].t - 24 * 3600e3) }), h('span', { text: 'jetzt' }));
    requestAnimationFrame(zeichnen);
    const spalte = (titel, e, text) => h('div', {}, h('span', { class: 'pt-klein', text: titel }),
      h('strong', { text: e ? `${uhr(e.t)} · ${fmt(e.v)} cm` : '–' }), text ? h('small', { text }) : null);
    if (a?.hw || a?.nw) {
      einordnung.hidden = false;
      einordnung.replaceChildren(spalte('letztes Hochwasser', a.hw, a.hwText),
        spalte('letztes Niedrigwasser', a.nw, [a.nwText, a.tidehub !== null ? `Tidehub ${fmt(a.tidehub)} cm` : null].filter(Boolean).join(' · ')));
    }
  }, () => { box.removeAttribute('aria-busy'); box.replaceChildren(h('p', { class: 'unknown', text: 'Tidekurve konnte nicht geladen werden.' })); });
  let w = 0;
  const ro = new ResizeObserver(() => {
    if (!box.isConnected) { ro.disconnect(); return; }
    if (box.clientWidth && Math.abs(box.clientWidth - w) > 4) { w = box.clientWidth; zeichnen(); }
  });
  ro.observe(box);

  const body = h('div', { class: 'pd-body' }, gzPlatz, kurvenKarte, einordnung,
    h('div', { class: 'pd-kacheln' },
      opts.onKarte ? h('button', { type: 'button', class: 'pd-kachel', onclick: opts.onKarte }, h('strong', { text: 'Auf der Karte' }), h('span', { text: 'Häfen in der Nähe ›' })) : null,
      opts.onFluss ? h('button', { type: 'button', class: 'pd-kachel', onclick: opts.onFluss }, h('strong', { text: g.water || 'Gewässer' }), h('span', { text: 'alle Pegel ›' })) : null));
  if (opts.wetter) { opts.wetter.classList.add('pd-karte', 'pd-wetter'); body.append(opts.wetter); }
  body.append(quelle);
  return h('article', { class: 'pd pz-tide' + (opts.eingebettet ? ' is-eingebettet' : ''), 'aria-labelledby': 'pd-name' }, kopf, body);
}

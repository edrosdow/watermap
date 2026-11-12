// Tidepegel: Detailseite (Kopf, Tidekurve, Einordnung) und kleine Bausteine für „Meine Pegel“ und die Flussseite.
// Grundlage sind die gemessenen Werte (WSV/PEGELONLINE); dazu, wo vorhanden, die Gezeitenvorhersage des BSH.
import { h } from './dom.js';
import { icon } from './icons.js';
import { formatTime } from './pegel.js';
import { auswerten, TENDENZ } from './gezeiten.js';
import { vorhersageLaden, kommende, hoehe, inText, tagUhr, standText, ART } from './gezeiten-bsh.js';
import { fmt, kmText, zusatzKacheln, glasKnopf, alarmKnopf, merkKnopf, grosserWert, quelleZeile } from './pegel-ansicht.js';
import { svgFarbe } from './farben.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const uhr = (t) => new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
function svg(tag, attrs = {}, ...kinder) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && !svgFarbe(el, k, v)) el.setAttribute(k, v);
  for (const k of kinder.flat()) if (k) el.append(k.nodeType ? k : document.createTextNode(String(k)));
  return el;
}

/** „↗ auflaufend“ als Text (null, wenn unbekannt). */
export const tendenzText = (a) => (a?.tendenz ? `${TENDENZ[a.tendenz].pfeil} ${TENDENZ[a.tendenz].text}` : null);

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
  if (vk.length) s.append(svg('rect', { class: 'pt-zukunft', x: xs(jetzt), y: T - 6, width: W - R - xs(jetzt), height: H - B - T + 6, fill: 'var(--wm-flaeche-2)' }));
  s.append(svg('path', { d: `${pfad}L${xs(teil[teil.length - 1].t).toFixed(1)},${H - B}L${xs(teil[0].t).toFixed(1)},${H - B}Z`, fill: 'var(--wm-petrol-hell)' }));
  for (const k of ['MThw', 'MTnw']) {
    if (!Number.isFinite(r[k])) continue;
    s.append(svg('line', { x1: L, x2: W - R, y1: ys(r[k]), y2: ys(r[k]), stroke: 'var(--wm-leise)', 'stroke-width': 1.2, 'stroke-dasharray': '5 4' }),
      svg('text', { x: W - R - 2, y: ys(r[k]) + (k === 'MThw' ? -5 : 14), 'text-anchor': 'end', class: 'pt-ax' }, k));
  }
  s.append(svg('path', { d: pfad, fill: 'none', stroke: 'var(--wm-petrol)', 'stroke-width': 2.5, 'stroke-linejoin': 'round' }));
  if (vk.length) s.append(svg('path', { class: 'pt-vorhersage', d: linie([{ t: jetzt, v: g.value }, ...vk]), fill: 'none', stroke: 'var(--wm-petrol)', 'stroke-width': 2, 'stroke-dasharray': '6 5', 'stroke-linejoin': 'round' }));
  const xjetzt = xs(jetzt);
  const zeit = (x, y, typ, t) => {   // über HW, unter NW – außer die Beschriftung läge auf der Plakette „jetzt“ (oben, ±40 px): dann unter den Punkt
    if (typ === 'HW' && y < 64 && Math.abs(x - xjetzt) < 44)   // neben den Punkt, weg von Linie und Plakette „jetzt“
      return svg('text', { x: x > xjetzt ? x + 9 : x - 9, y: y + 4, 'text-anchor': x > xjetzt ? 'start' : 'end', class: 'pt-zeit' }, uhr(t));
    return svg('text', { x: Math.max(18, Math.min(W - 18, x)), y: typ === 'HW' ? y - 9 : y + 18, 'text-anchor': 'middle', class: 'pt-zeit' }, uhr(t));
  };
  for (const e of a?.extreme || []) {
    const x = xs(e.t), y = ys(e.v);
    s.append(svg('circle', { cx: x, cy: y, r: 4.5, fill: 'var(--wm-tinte)' }), zeit(x, y, e.typ, e.t));
  }
  for (const e of vk.length ? ve : []) {
    const x = xs(e.t), y = ys(hoehe(e));
    s.append(svg('circle', { class: 'pt-vh-punkt', cx: x, cy: y, r: 4.5, fill: 'var(--wm-flaeche)', stroke: 'var(--wm-tinte)', 'stroke-width': 2 }), zeit(x, y, e.typ, e.t));
  }
  const xj = xs(jetzt), yj = ys(g.value);
  s.append(svg('line', { x1: xj, x2: xj, y1: T - 6, y2: H - B, stroke: 'var(--wm-tinte)', 'stroke-width': 1.5 }),
    svg('rect', { x: Math.min(xj - 18, W - R - 36), y: 2, width: 36, height: 18, rx: 9, fill: 'var(--wm-tinte)' }),
    svg('text', { x: Math.min(xj, W - R - 18), y: 15, 'text-anchor': 'middle', class: 'pt-jetzt' }, 'jetzt'),
    svg('circle', { cx: xj, cy: yj, r: 5.5, fill: 'var(--wm-petrol)', stroke: 'var(--wm-flaeche)', 'stroke-width': 2 }));
  box.replaceChildren(s);
  return vk.length > 0;
}

/** Karte „Gezeiten“: nächstes Hoch- und Niedrigwasser (BSH), danach drei weitere als Pillen. */
function gezeitenKarte(v) {
  const k = kommende(v.d);
  if (!k.length) return null;
  // 8.0.3 (Nutzer: weniger Text): Art und Tag, Uhrzeit groß, „in …“, nur der Wert
  const kachel = (e) => {
    const tu = tagUhr(e.t), m = tu.match(/^(.*?)\s*(\d\d:\d\d)$/);
    return h('div', { class: `pt-gz-kachel is-${e.typ.toLowerCase()}` },
      h('span', { class: 'pt-klein', text: ART[e.typ] }),
      h('strong', { class: 'pt-gz-zeit' }, m ? m[2] : tu, m?.[1] ? h('span', { class: 'pt-gz-tag', text: ` ${m[1]}` }) : null),
      h('span', { class: 'pt-gz-in', text: inText(e.t) }),
      h('small', { text: `${fmt(e.vh ?? e.astro)} cm` }));
  };
  const erste = k.slice(0, 2), weitere = k.slice(2, 5);
  return h('section', { class: 'pd-karte pt-gezeiten', 'aria-labelledby': 'pt-gz-t' },
    h('div', { class: 'pd-karte-kopf' }, h('h2', { id: 'pt-gz-t', class: 'pd-ct', text: 'Gezeiten' }), h('span', { class: 'pt-klein' + (v.offline ? ' is-alt' : ''), text: `Vorhersage BSH · ${standText(v)}` })),
    h('div', { class: 'pt-gz-reihe' }, erste.map(kachel)),
    weitere.length ? h('ul', { class: 'pt-gz-pillen', 'aria-label': 'Danach' }, weitere.map(e => h('li', { text: `${e.typ} ${tagUhr(e.t)}` }))) : null);
}

/**
 * Detailseite eines Tidepegels. opts wie pegelDetail: { verlauf, onBack, backLabel, onShare, onKarte, onFluss, onStern, eingebettet, wetter }
 */
const HINWEIS = 'Messwerte: WSV/PEGELONLINE. Ohne Gewähr, nicht für die Navigation.';

export function tideDetail(g, opts) {
  const quelle = quelleZeile(g, HINWEIS);   // 8.0.3: keine Liste mehr, Quelle als kleine Zeile mit Link
  const tend = h('span', { class: 'pd-tz pt-tendenz' });
  const alt = g.state === 'old';
  // Kopf wie bei allen Pegeln: Name, Ort und Zeit, große Zahl, Zustandszeile, drei Knöpfe
  const kopf = h('div', { class: 'pd-oben is-tide' },   // Name, Gewässer und × im Kopf des Sheet-Rahmens
    h('p', { class: 'pd-ort' + (alt ? ' is-alt' : '') }, [kmText(g), alt ? `veraltet – ${formatTime(g.time)}` : formatTime(g.time)].filter(Boolean).join(' · ')),
    h('p', { class: 'pd-wert' }, grosserWert(g, alt), h('span', { text: g.unit })),
    h('p', { class: 'pd-zeile-kopf' }, h('span', { class: 'pd-zdot pz-tide', 'aria-hidden': 'true' }), h('b', { class: 'pz-tag-text', text: alt ? 'veraltet' : 'Tide' }), alt ? null : tend),
    h('div', { class: 'pd-knoepfe' }, alarmKnopf(g), merkKnopf(g, opts.onStern),
      glasKnopf('pd-teilen', icon('share', 20), 'Teilen', { onclick: opts.onShare, 'aria-label': 'Pegel teilen' })));

  const box = h('div', { class: 'pt-kurve', 'aria-busy': 'true' }, h('p', { class: 'muted small', text: 'Tidekurve wird geladen …' }));
  const achse = h('p', { class: 'pt-achse' });
  const zeitraum = h('span', { class: 'pt-klein', text: '24 h gemessen' });
  const vhLegende = h('span', { hidden: true }, h('i', { class: 'is-vorhersage' }), 'Vorhersage (BSH)');
  const gzPlatz = h('div', { class: 'pt-gz-platz' });
  const kurvenKarte = h('section', { class: 'pd-karte' },
    h('div', { class: 'pd-karte-kopf' }, h('h2', { class: 'pd-ct', text: 'Tidekurve' }), zeitraum),
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
    if (karte) {   // Quelle BSH mit Lizenz-Link in der Quellenzeile (8.0.3, statt eigener Zeilen in der Karte)
      gzPlatz.replaceChildren(karte);
      const link = (href, text) => h('a', { href, target: '_blank', rel: 'noopener noreferrer', text });
      quelle.firstChild.replaceWith('Messwerte: WSV/PEGELONLINE · Gezeiten: ', link(x.d.link || 'https://wasserstand.bsh.de/', 'BSH'), ' (', link(LIZENZ_URL, 'CC BY 4.0'), '). Ohne Gewähr, nicht für die Navigation.');
    }
    zeichnen();
  }, () => {});
  opts.verlauf.then((p) => {
    pts = p; a = auswerten(g, p);
    box.removeAttribute('aria-busy');
    if (!p || p.length < 10) { box.replaceChildren(h('p', { class: 'unknown', text: 'Keine Messreihe verfügbar.' })); return; }
    tend.textContent = tendenzText(a) ? ` · ${tendenzText(a)}` : '';
    achse.replaceChildren(h('span', { text: tagStunde(p[p.length - 1].t - 24 * 3600e3) }), h('span', { text: 'jetzt' }));
    requestAnimationFrame(zeichnen);
    const spalte = (titel, e) => h('div', {}, h('span', { class: 'pt-klein', text: titel }),   // 8.0.3: ohne erklärenden Satz
      h('strong', { text: e ? `${uhr(e.t)} Uhr` : '–' }), e ? h('span', { class: 'pt-lt-wert', text: `${fmt(e.v)} cm` }) : null);
    if (a?.hw || a?.nw) {
      einordnung.hidden = false;
      einordnung.replaceChildren(h('h2', { class: 'pd-ct', text: 'Letzte Tide' }), h('div', { class: 'pt-lt-reihe' }, spalte('Hochwasser', a.hw), spalte('Niedrigwasser', a.nw)), a.tidehub !== null ? h('p', { class: 'pt-lt-hub' }, 'Tidehub ', h('b', { text: `${fmt(a.tidehub)} cm` })) : null);
    }
  }, () => { box.removeAttribute('aria-busy'); box.replaceChildren(h('p', { class: 'unknown', text: 'Tidekurve konnte nicht geladen werden.' })); });
  let w = 0;
  const ro = new ResizeObserver(() => {
    if (!box.isConnected) { ro.disconnect(); return; }
    if (box.clientWidth && Math.abs(box.clientWidth - w) > 4) { w = box.clientWidth; zeichnen(); }
  });
  ro.observe(box);

  const body = h('div', { class: 'pd-body' }, gzPlatz, kurvenKarte, einordnung, zusatzKacheln(g), opts.wetter || null);   // Wetter-Zeile unten (8.0.3, Nutzer)
  body.append(quelle);
  return h('article', { class: 'pd pz-tide' + (opts.eingebettet ? ' is-eingebettet' : ''), 'aria-labelledby': 'pd-name' }, kopf, body);
}

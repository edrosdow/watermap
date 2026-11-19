// Pegel-Sheet auf der Hauptkarte (Designumbau Phase 2a, 7.70.0): ein Tipp auf einen Pegel öffnet ihn im gemeinsamen Sheet-Rahmen.
//  Handy: Stufe „klein“ = Kurzansicht (Wert, 24-h-Kurve, Zustand und Tendenz, „Details“); Hochwischen → „groß“ = alle Details (pegelDetail).
//  Desktop ≥ 768: Panel rechts mit allen Details.
// Hilfen aus dem früheren Pegel-Tab (pegel-dashboard.js): slipsAmPegel, kurve24.
import { h, announce } from './dom.js';
import { haversine, displayName } from './model.js';
import { s as svgEl } from './chart.js';
import { verlaufLaden } from './pegel-daten.js';
import { tendenz, tendenzSatz, aenderungKurz } from './pegel-einordnung.js';
import { fmt, zustand, ZUSTAND, pegelDetail } from './pegel-ansicht.js';
import { formatTime, messluecken } from './pegel.js';
import { istTidepegel, auswerten } from './gezeiten.js';
import { vorhersageLaden, kommende, inText, tagUhr, ART } from './gezeiten-bsh.js';
import { normW, gleichesGewaesser, istKueste, slug, KUESTE_SLUG, flussKm } from './pegel-fluss.js';
import { sheetOeffnen } from './bausteine.js';
import { hochzaehlen } from './bewegung.js';

/** Nächste Slipanlagen am selben Gewässer (für die Details). */
export function slipsAmPegel(g, places, max = 5, radius = 30000) {
  if (!normW(g.water)) return [];
  return places.filter(p => p.type === 'slip' && p.water?.name && gleichesGewaesser(p.water.name, g.water))
    .map(p => ({ p, d: haversine(g.lat, g.lon, p.lat, p.lon), name: displayName(p) }))
    .filter(e => e.d <= radius).sort((a, b) => a.d - b.d).slice(0, max);
}

/** Kurzansicht Tidepegel, Kachel „Gezeit“ (8.0.18): Wort groß, Fachwort klein darunter. */
const GEZEIT = {
  auflaufend: { pfeil: '↗', wort: 'Flut', klein: 'auflaufend' },
  ablaufend: { pfeil: '↘', wort: 'Ebbe', klein: 'ablaufend' },
  kentert: { pfeil: '→', wort: 'Stillwasser', klein: 'kentert' },
};

/** Kurve der letzten 24 Stunden (Linie und Fläche, Lücken nicht überbrückt). */
export function kurve24(pts, g, { breite = 300, hoehe = 60, klein = false } = {}) {
  if (!pts?.length) return null;
  const ende = pts[pts.length - 1].t;
  const p24 = pts.filter(p => p.t >= ende - 24 * 3600e3);
  if (p24.length < 2) return null;
  const vs = p24.map(p => p.v), lo = Math.min(...vs), hi = Math.max(...vs), sp = Math.max(hi - lo, 4);
  const t0 = p24[0].t, W = breite, H = hoehe, pad = klein ? 3 : 6;
  const x = (t) => pad + (t - t0) / Math.max(ende - t0, 1) * (W - 2 * pad);
  const y = (v) => pad + (hi - v) / sp * (H - 2 * pad);
  const luecken = messluecken(p24);
  let d = '', prev = null;
  for (const p of p24) { d += (prev && !luecken.some(([a, b]) => a === prev.t && b === p.t) ? 'L' : 'M') + x(p.t).toFixed(1) + ' ' + y(p.v).toFixed(1); prev = p; }
  const last = p24[p24.length - 1];
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', class: 'pks-kurve-svg' + (klein ? ' is-klein' : ''), role: 'img',
    'aria-label': `Verlauf der letzten 24 Stunden: von ${fmt(p24[0].v)} auf ${fmt(last.v)} ${g.unit}, tiefster ${fmt(lo)}, höchster ${fmt(hi)} ${g.unit}` });
  if (!klein) svg.append(svgEl('path', { d: `M${x(t0).toFixed(1)} ${H}` + p24.map(p => `L${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join('') + `L${x(last.t).toFixed(1)} ${H}Z`, class: 'pks-kurve-flaeche wm-nachblenden' }));
  svg.append(svgEl('path', { d, class: 'pks-kurve-linie wm-zeichnen', pathLength: 1 }));
  svg.append(svgEl('circle', { cx: x(last.t), cy: y(last.v), r: klein ? 2.5 : 4, class: 'pks-kurve-punkt' }));
  return svg;
}

/** Zustand des Pegels → Zustandsmarke (gut | warn | hoch | stop | leise). */
const MARKE = { normal: 'gut', low: 'warn', high: 'hoch', hsw: 'stop' };
const grossSchreiben = (t) => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * Pegel-Sheet. ctx = { places(), wetter(g), share(g), slip(p), fluss(slug), karte(g)?, mobil(), onZu(), inset() }
 * Rückgabe: { oeffnen(g, { stufe }), zu(), get id, get offen, get sheet }
 */
export function pegelSheet(ctx) {
  let s = null, g = null;

  const kopfAngaben = () => ({ titel: g.name, titelId: 'pd-name', unter: [istTidepegel(g) ? 'Tidepegel' : 'Pegel', g.water].filter(Boolean).join(' · ') });

  /**
   * Kurzansicht (Stufe „klein“): Wert mit 24-h-Kurve, darunter zwei Kacheln, „Details“.
   * Binnenpegel: „Wasserstand“ und „Tendenz“ (8.0.16). Tidepegel (8.0.18, Variante B): „Gezeit“ (↗ Flut, klein „auflaufend“)
   * und das nächste Hoch-/Niedrigwasser aus der BSH-Vorhersage (Uhrzeit, klein „in …“); ohne Vorhersage nur „Gezeit“ über die ganze Breite.
   * Veraltet: nur „Wasserstand“.
   */
  function kurz() {
    const z = zustand(g), alt = g.state === 'old', tide = istTidepegel(g) && !alt;
    const fuer = g;
    const kurveBox = h('div', { class: 'pks-kurve' });
    let kacheln, trend, fehlt = () => {};
    if (tide) {
      // 8.0.19: Solange geladen wird, Schimmer-Balken statt Platzhalterwörter (kein Umspringen „Gezeiten …“ → „Hochwasser“)
      const gzWert = h('b', { class: 'pks-laden' }), gzKlein = h('span', { class: 'pks-klein pks-laden' });
      const ereignisArt = h('small', { class: 'pks-laden' }), ereignisWert = h('b', { class: 'pks-laden' }), ereignisKlein = h('span', { class: 'pks-klein pks-laden' });
      const gezeit = h('div', { class: 'pks-kachel pks-zahlen pks-gezeit', 'aria-busy': 'true' }, h('small', { text: 'Gezeit' }), gzWert, gzKlein);
      const ereignis = h('div', { class: 'pks-kachel pks-ereignis', 'aria-busy': 'true', 'aria-label': 'Nächstes Hoch- oder Niedrigwasser wird geladen' }, ereignisArt, ereignisWert, ereignisKlein);
      kacheln = [gezeit, ereignis];
      const fertig = (kachel) => { kachel.removeAttribute('aria-busy'); kachel.querySelectorAll('.pks-laden').forEach((el) => el.classList.remove('pks-laden')); };
      const nurGezeit = () => { ereignis.remove(); trend?.classList.add('is-einzeln'); };
      fehlt = () => { gzWert.textContent = '–'; gzKlein.textContent = ''; fertig(gezeit); };
      verlaufLaden(g.id).then((pts) => {
        if (!kurveBox.isConnected || fuer !== g) return;
        const gz = GEZEIT[auswerten(g, pts || [])?.tendenz];
        gzWert.textContent = gz ? `${gz.pfeil} ${gz.wort}` : '–';
        gzKlein.textContent = gz?.klein || '';
        fertig(gezeit);
      }, () => { gzWert.textContent = '–'; fertig(gezeit); });
      vorhersageLaden(g).then((v) => {
        if (fuer !== g) return;
        const e = v && kommende(v.d)[0];
        if (!e) { nurGezeit(); return; }
        ereignisArt.textContent = ART[e.typ];
        ereignisWert.textContent = `${tagUhr(e.t)} Uhr`;
        ereignisKlein.textContent = inText(e.t);
        ereignis.removeAttribute('aria-label');
        fertig(ereignis);
      }, nurGezeit);
    } else {
      const tend = h('b', { text: '…' });
      // Zweite Kachel „Tendenz“: was der Pegel gerade tut (letzte 2 Stunden, als Satz); veraltet: keine
      const zahlen = alt ? null : h('div', { class: 'pks-kachel pks-zahlen', title: 'Was der Pegel gerade tut (letzte 2 Stunden)' }, h('small', { text: 'Tendenz' }), tend);
      kacheln = [h('div', { class: 'pks-kachel' }, h('small', { text: 'Wasserstand' }),
        h('b', null, h('i', { class: `pks-kpunkt is-${alt ? 'leise' : (MARKE[z] || 'leise')}`, 'aria-hidden': 'true' }),
          alt ? `Veraltet – ${formatTime(g.time)}` : grossSchreiben(ZUSTAND[z].text))), zahlen];
      fehlt = () => { tend.textContent = '–'; };
      if (!alt) verlaufLaden(g.id).then((pts) => {
        if (!kurveBox.isConnected || fuer !== g) return;
        const t = tendenz(pts);
        tend.textContent = tendenzSatz(t) || '–'; tend.title = t ? `In den letzten 2 Stunden ${aenderungKurz(t.d)}` : 'Keine Tendenz verfügbar';
      }, () => {});
    }
    verlaufLaden(g.id).then((pts) => {
      if (!kurveBox.isConnected || fuer !== g) return;
      const k = kurve24(pts, g, { breite: 220, hoehe: 64 });
      if (k) kurveBox.replaceChildren(k);
    }, () => fehlt());
    const kurzWert = h('strong', { text: fmt(g.value) });
    if (!alt) setTimeout(() => hochzaehlen(kurzWert, Math.round(g.value), { format: fmt }), 0);
    trend = h('div', { class: 'pks-trend' + (kacheln.filter(Boolean).length > 1 ? '' : ' is-einzeln') }, kacheln);
    return h('div', { class: 'pks-kurz' },
      h('div', { class: 'pks-mitte' },
        h('p', { class: 'pks-wert' }, kurzWert, h('small', { text: ` ${g.unit}` })),
        kurveBox),
      trend,
      h('button', { type: 'button', class: 'wm-btn is-primaer pks-details', 'aria-expanded': 'false', onclick: () => s?.stufe('gross') }, 'Details'));
  }

  /** Alle Details (Stufe „groß“, Desktop immer). */
  function gross() {
    return pegelDetail(g, {
      imSheet: true, eingebettet: true,
      verlauf: verlaufLaden(g.id), wetter: ctx.wetter?.(g),
      onShare: () => ctx.share?.(g),
      slips: slipsAmPegel(g, ctx.places?.() || []), onSlip: ctx.slip,
      onKarte: ctx.karte ? () => ctx.karte(g) : undefined,   // Hauptkarte mit Slipanlagen bzw. Häfen in der Nähe
      onFluss: g.water && ctx.fluss ? () => ctx.fluss(istKueste(g.water) ? KUESTE_SLUG : slug(g.water)) : null,
      onStern: () => {   // Stern: neu zeichnen, Scrollstand und Fokus behalten
        const top = s.inhalt.scrollTop;
        s.zeigeInhalt('gross', true);
        s.inhalt.scrollTop = top;
        s.inhalt.querySelector('.pm-stern')?.focus({ preventScroll: true });
      },
    });
  }

  /** Handy: Höhe der Stufe „klein“ = Kopf + Kurzansicht + Platz der schwebenden Navigation. */
  function kleinMessen() {
    if (!s || !ctx.mobil()) return;
    requestAnimationFrame(() => {
      const kurzEl = s?.inhalt.querySelector('.pks-kurz');
      if (!kurzEl) return;
      const nav = document.querySelector('#bottomnav');
      const navPlatz = nav && nav.getClientRects().length ? Math.max(0, window.innerHeight - nav.getBoundingClientRect().top) + 8 : 16;
      const h0 = Math.ceil(kurzEl.getBoundingClientRect().bottom - s.el.getBoundingClientRect().top + 12 + navPlatz);
      s.el.style.setProperty('--wm-sheet-klein', `${h0}px`);
    });
  }

  return {
    oeffnen(neu, { stufe = null } = {}) {
      g = neu;
      const st = stufe || (ctx.mobil() ? 'klein' : 'gross');
      if (s?.offen) {   // anderer Pegel im offenen Sheet: Kopf und Inhalt tauschen
        s.setzeKopf(kopfAngaben());
        if (s.stufe() !== st) s.stufe(st);
        s.zeigeInhalt(s.stufe(), true);
      } else {
        s = sheetOeffnen({ kopf: kopfAngaben(), stufe: st, klasse: 'pks-sheet',
          inhaltFuer: (x) => (x === 'gross' || !ctx.mobil() ? gross() : kurz()),
          onStufe: (x) => { if (x === 'klein') kleinMessen(); },
          onZu: () => { s = null; g = null; ctx.onZu?.(); } });
      }
      kleinMessen();
      announce(`Pegel ${g.name}: ${fmt(g.value)} ${g.unit}`);
      return s;
    },
    zu() { s?.schliessen(); },
    get id() { return g?.id || null; },
    get offen() { return !!s?.offen; },
    get sheet() { return s; },
  };
}

/**
 * Pegel in der Hauptsuche (Designumbau 2a): zuerst passende Gewässer (meiste Pegel zuerst), dann Pegel nach Name
 * (Anfang vor Mitte, dann Entfernung, dann Name). Passt kein Pegelname, aber ein Gewässer, folgen dessen Pegel in Flussrichtung (flussKm).
 * Rückgabe: { gewaesser: [{ name, liste }], pegel: [g] }
 */
export function pegelSuche(gauges, q, user = null, { maxGewaesser = 2, maxPegel = 5 } = {}) {
  const n = normW(q);
  if (!gauges?.length || n.length < 2) return { gewaesser: [], pegel: [] };
  const anfang = (t) => (normW(t).startsWith(n) ? 0 : 1);
  const gew = new Map();
  for (const g of gauges) {
    if (!g.water || !normW(g.water).includes(n)) continue;
    const k = normW(g.water); const e = gew.get(k) || { name: g.water, liste: [] }; e.liste.push(g); gew.set(k, e);
  }
  const gewaesser = [...gew.values()].sort((a, b) => anfang(a.name) - anfang(b.name) || b.liste.length - a.liste.length).slice(0, maxGewaesser);
  const ent = (g) => (user ? haversine(user.lat, user.lon, g.lat, g.lon) : 0);
  let pegel = gauges.filter(g => normW(g.name).includes(n))
    .sort((a, b) => anfang(a.name) - anfang(b.name) || ent(a) - ent(b) || a.name.localeCompare(b.name, 'de'));
  if (!pegel.length && gewaesser.length) pegel = [...gewaesser[0].liste].sort((a, b) => (flussKm(a) ?? 0) - (flussKm(b) ?? 0));
  return { gewaesser, pegel: pegel.slice(0, maxPegel) };
}

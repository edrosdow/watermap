// Bereich „Pegel“ (#pegel, #pegel/<id>): Kartenanwendung für Bootsfahrer.
//  Kopf: „Pegelstände“, Suche (Pegel, Gewässer, Ort), Filter Alle Pegel | In Kartennähe | Favoriten.
//  Karte (pegel-karte.js) mit allen Pegeln; daneben (Desktop) bzw. darüber als Bottom Sheet (Handy) das Panel:
//  gewählter Pegel kurz (Wert, Trend 24 h, Kurve 24 h) → „Verlauf anzeigen“ öffnet das Cockpit (pegelDetail).
//  Ohne Auswahl: „Meine Pegel“ bzw. die Pegel im Kartenausschnitt.
// Daten: eine Stationsliste (pegel-daten.js); Verläufe nur für den gewählten Pegel und die Favoriten (zwischengespeichert).
import { h, announce } from './dom.js';
import { icon } from './icons.js';
import { haversine, displayName } from './model.js';
import { s } from './chart.js';
import { pegelLaden, verlaufLaden, meinePegel, aenderung24h } from './pegel-daten.js';
import { tendenz, tendenzText as tendenzTextKurz, aenderungKurz } from './pegel-einordnung.js';
import { pegelKarteAnsicht, ZOOM_AUSWAHL } from './pegel-karte.js';
import { fmt, kmText, zustand, ZUSTAND, etikett, pegelDetail, sternKnopf } from './pegel-ansicht.js';
import { formatTime, messluecken } from './pegel.js';
import { alarmFenster } from './alarm.js';
import { istTidepegel, auswerten } from './gezeiten.js';
import { tendenzText } from './pegel-tide-ansicht.js';
import { normW, gleichesGewaesser, istKueste, slug, KUESTE_SLUG } from './pegel-fluss.js';

const zeitText = (t) => new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const standText = (st) => (st.offline ? `Offline · Stand von ${new Date(st.zeit).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}, ${zeitText(st.zeit)} Uhr`
  : `Stand ${zeitText(st.zeit)} · Daten WSV/PEGELONLINE`);
const EINORDNUNG = { low: 'Unter MNW', normal: 'Zwischen MNW und MHW', high: 'Über MHW', hsw: 'Über HSW' };
const FILTER = [['alle', 'Alle Pegel'], ['naehe', 'In Kartennähe'], ['fav', 'Favoriten']];
const MAX_NAEHE = 30;

/** Nächste Slipanlagen am selben Gewässer (für das Cockpit). */
export function slipsAmPegel(g, places, max = 5, radius = 30000) {
  if (!normW(g.water)) return [];
  return places.filter(p => p.type === 'slip' && p.water?.name && gleichesGewaesser(p.water.name, g.water))
    .map(p => ({ p, d: haversine(g.lat, g.lon, p.lat, p.lon), name: displayName(p) }))
    .filter(e => e.d <= radius).sort((a, b) => a.d - b.d).slice(0, max);
}

/**
 * Werte für die Kurzansicht, getrennt nach Zeitraum: { aend: „+1 cm“ (24 h) | null, tend: „↘ fallend, −3 cm“ (2 h) | null, richtung, d }.
 * Tidepegel: statt beider Werte die Tide-Tendenz („↗ auflaufend“).
 */
export function kurzWerte(g, pts) {
  if (istTidepegel(g)) return { tide: tendenzText(auswerten(g, pts || [])) };
  const d = aenderung24h(pts), t = tendenz(pts);
  return { aend: aenderungKurz(d), d, tend: tendenzTextKurz(t), richtung: t?.richtung ?? null };
}
const richtungKlasse = (r) => (r === 1 ? 'pt-up' : r === -1 ? 'pt-down' : 'pt-flat');

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
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', class: 'pa-kurve' + (klein ? ' is-klein' : ''), role: 'img',
    'aria-label': `Verlauf der letzten 24 Stunden: von ${fmt(p24[0].v)} auf ${fmt(last.v)} ${g.unit}, tiefster ${fmt(lo)}, höchster ${fmt(hi)} ${g.unit}` });
  if (!klein) svg.append(s('path', { d: `M${x(t0).toFixed(1)} ${H}` + p24.map(p => `L${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join('') + `L${x(last.t).toFixed(1)} ${H}Z`, class: 'pa-kurve-flaeche' }));
  svg.append(s('path', { d, class: 'pa-kurve-linie' }));
  svg.append(s('circle', { cx: x(last.t), cy: y(last.v), r: klein ? 2.5 : 4, class: 'pa-kurve-punkt' }));
  return svg;
}

/**
 * ctx = { user(): {lat,lon}|null, places(): Place[], isMobile(), toast(text), share(g), slip(p), auswahl(id|null) }
 * Rückgabe: { zeigen(force), waehlen(id, opts), abwaehlen(opts), vorbereiten(), stand, auswahl }
 */
export function pegelDashboard(root, ctx) {
  const ui = { filter: 'alle', auswahl: null, gross: false, voll: false, wechsel: 0, aktiv: -1, treffer: [] };   // Handy: klein → gross (ca. 80 %) → voll
  let stand = null, ladeFehler = false, app = null, karte = null, panel = null, inhalt = null, griff = null, standZeile = null, feld = null, trefferBox = null, filterBox = null;
  let karteFertig = false;

  const isMobile = () => ctx.isMobile?.() ?? window.matchMedia('(max-width: 767px)').matches;
  const gewaehlt = () => (ui.auswahl && stand ? stand.byId.get(ui.auswahl) : null);

  // ---------------------------------------------------------------- Aufbau (einmal)
  function aufbauen() {
    karte = pegelKarteAnsicht({
      stand: () => stand, user: () => ctx.user(),
      waehlen: (id) => waehlen(id, { quelle: 'karte' }),
      abwaehlen: () => abwaehlen(),
      bewegt: () => { if (ui.filter === 'naehe' && !ui.gross) listeNeu(); },
      unten: () => (isMobile() && panel ? panel.offsetHeight : 0),
    });
    standZeile = h('p', { class: 'pa-stand', 'aria-live': 'polite', text: 'Pegel werden geladen …' });
    feld = h('input', { type: 'search', id: 'pa-suche', class: 'pa-suche', placeholder: 'Pegel, Gewässer oder Ort suchen', autocomplete: 'off', enterkeyhint: 'search',
      role: 'combobox', 'aria-label': 'Pegel, Gewässer oder Ort suchen', 'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': 'pa-treffer',
      oninput: () => sucheZeichnen(), onkeydown: sucheTaste, onfocus: () => { if (feld.value.trim()) sucheZeichnen(); } });
    trefferBox = h('ul', { class: 'pa-treffer', id: 'pa-treffer', role: 'listbox', 'aria-label': 'Suchtreffer', hidden: true });
    filterBox = h('div', { class: 'pa-filter', role: 'group', 'aria-label': 'Pegel zeigen' },
      FILTER.map(([k, t]) => h('button', { type: 'button', class: 'pa-chip', dataset: { filter: k }, 'aria-pressed': String(ui.filter === k), onclick: () => filterSetzen(k) },
        k === 'fav' ? h('span', { html: icon('star', 15, true), 'aria-hidden': 'true' }) : null, h('span', { text: t }), k === 'fav' ? h('span', { class: 'pa-chip-zahl' }) : null)));
    const kopf = h('header', { class: 'pa-kopf' },
      h('div', { class: 'pa-titelblock' },
        h('div', { class: 'pa-titelzeile' }, h('h1', { class: 'pa-h1', text: 'Pegelstände' }),
          h('button', { type: 'button', class: 'pa-neu', 'aria-label': 'Pegel aktualisieren', title: 'Aktualisieren', html: icon('refresh', 18), onclick: async (e) => {
            const b = e.currentTarget; b.classList.add('is-busy'); await laden(true); b.classList.remove('is-busy');
            ctx.toast?.(stand?.offline ? 'Keine Verbindung – letzter Stand wird angezeigt.' : stand ? 'Pegel aktualisiert.' : 'Pegeldaten sind gerade nicht erreichbar.'); } })),
        standZeile),
      h('div', { class: 'pa-suchbox' }, h('span', { class: 'pa-suche-ico', html: icon('search', 19), 'aria-hidden': 'true' }), feld, trefferBox),
      filterBox);
    inhalt = h('div', { class: 'pa-inhalt' });
    griff = h('button', { type: 'button', class: 'pa-griff', 'aria-controls': 'pa-panel', onclick: () => (!ui.gross ? grossSetzen(true) : !ui.voll ? vollSetzen(true) : grossSetzen(false)) }, h('span', { 'aria-hidden': 'true' }));
    panel = h('aside', { class: 'pa-panel', id: 'pa-panel', 'aria-label': 'Pegel-Details' }, griff, inhalt);
    // Handy, Stufe „gross“: wer im Sheet nach unten scrollt, bekommt es ganz (Stufe „voll“) – Ziehen und Scrollen stören sich nicht
    inhalt.addEventListener('scroll', () => { if (isMobile() && ui.gross && !ui.voll && inhalt.scrollTop > 8 && Date.now() - ui.wechsel > 500) vollSetzen(true); }, { passive: true });   // nicht das Nachlaufen der Wischgeste
    wischen(panel);
    app = h('div', { class: 'pa' }, kopf, h('div', { class: 'pa-haupt' }, karte.el, panel));
    app.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.target === feld) return;
      if (ui.gross) { e.preventDefault(); grossSetzen(false); } else if (ui.auswahl) { e.preventDefault(); abwaehlen(); }   // Esc: zurück auf kompakt bzw. schließen
    });
    document.addEventListener('click', (e) => { if (!trefferBox.hidden && !e.target.closest?.('.pa-suchbox')) sucheZu(); });
    root.replaceChildren(app);
    root.classList.add('pa-modus');
    new ResizeObserver(() => app.style.setProperty('--pa-unten', `${isMobile() ? panel.offsetHeight : 0}px`)).observe(panel);
  }

  /** Bottom Sheet (Handy): nach oben wischen vergrößert, nach unten verkleinert bzw. schließt die Auswahl. */
  function wischen(el) {
    let y0 = null;
    el.addEventListener('touchstart', (e) => {
      y0 = null;
      if (!isMobile() || e.touches.length !== 1 || e.target.closest('.gc-wrap, .pd-umschalter, input, select')) return;
      if (inhalt.scrollTop > 0 && !e.target.closest('.pa-griff')) return;
      y0 = e.touches[0].clientY;
    }, { passive: true });
    el.addEventListener('touchend', (e) => {
      if (y0 === null) return;
      const dy = e.changedTouches[0].clientY - y0; y0 = null;
      if (dy < -45) { if (!ui.gross) grossSetzen(true); else if (!ui.voll) vollSetzen(true); }
      else if (dy > 60) { if (ui.voll) vollSetzen(false); else if (ui.gross) grossSetzen(false); else if (ui.auswahl) abwaehlen(); }
    }, { passive: true });
  }

  // ---------------------------------------------------------------- Laden
  async function laden(force = false) {
    let neu = null;
    try { neu = await pegelLaden({ force }); ladeFehler = false; } catch { ladeFehler = true; }
    const anders = neu !== stand;
    if (neu) stand = neu;
    standZeile.textContent = stand ? standText(stand) : 'Pegeldaten sind gerade nicht erreichbar.';
    standZeile.classList.toggle('is-offline', !!stand?.offline || !stand);
    if (ui.auswahl && stand && !stand.byId.has(ui.auswahl)) { ui.auswahl = null; ui.gross = false; }
    if (anders && karteFertig) karte.aktualisieren();
    if (anders || !inhalt.childElementCount || ladeFehler) zeichnen({ cockpitBehalten: true });
  }

  async function karteZeigen() {
    if (!stand) return;
    const ok = await karte.zeigen();
    if (!ok) return;
    if (!karteFertig) {
      karteFertig = true;
      if (ui.filter === 'fav') karte.filtern(g => meinePegel.hat(g.id));
      const g = gewaehlt();
      if (g) { karte.markieren(g.id); karte.hinzeigen(g, { zoom: ZOOM_AUSWAHL, immer: true }); }
      if (ui.filter === 'naehe') listeNeu();
    }
  }

  // ---------------------------------------------------------------- Panel
  function zeichnen({ cockpitBehalten = false, fokus = null } = {}) {
    const g = gewaehlt();
    panel.classList.toggle('hat-auswahl', !!g);
    panel.classList.toggle('is-gross', ui.gross);
    panel.classList.toggle('is-voll', ui.gross && ui.voll);
    app.classList.toggle('pa-gross', ui.gross);
    griffStellen();
    const zahl = filterBox.querySelector('.pa-chip-zahl'); const n = meinePegel.alle().length; zahl.textContent = n ? String(n) : '';
    if (cockpitBehalten && ui.gross && g && inhalt.querySelector('.pd')) return;
    if (!stand) {
      inhalt.replaceChildren(h('div', { class: 'pa-leer pa-fehler', role: 'alert' },
        h('strong', { text: ladeFehler ? 'Pegeldaten sind gerade nicht erreichbar.' : 'Pegel werden geladen …' }),
        ladeFehler ? h('p', { text: 'PEGELONLINE antwortet nicht. Bitte gleich noch einmal versuchen.' }) : null,
        ladeFehler ? h('button', { type: 'button', class: 'btn btn-outline pa-nochmal', text: 'Erneut versuchen', onclick: () => laden(true).then(karteZeigen) }) : null));
      return;
    }
    const teile = [];
    if (g) teile.push(ui.gross ? cockpit(g) : kurz(g));
    else teile.push(h('p', { class: 'pa-tipp', text: 'Wähle einen Pegel auf der Karte oder suche ihn oben – Wasserstand und Trend erscheinen hier.' }));
    if (!ui.gross || !g) teile.push(liste());
    teile.push(h('p', { class: 'pa-fuss', text: `${standText(stand)}. Wasserstände beziehen sich auf den Pegelnullpunkt des jeweiligen Pegels und sind untereinander nicht vergleichbar.` }));
    inhalt.replaceChildren(...teile);
    inhalt.scrollTop = 0;
    if (fokus) inhalt.querySelector(fokus)?.focus({ preventScroll: true });
  }

  function listeNeu() {
    const alt = inhalt.querySelector('.pa-liste');
    if (alt) alt.replaceWith(liste());
  }

  /**
   * Stufe 1 (kompakt): Name, Gewässer · km · Messzeit, Wert mit 24-h-Kurve daneben, Änderung 24 h und Tendenz (2 h) getrennt,
   * Einordnung, „Verlauf und Details anzeigen“ und Alarm. Kurve und Werte aus derselben (zwischengespeicherten) Messreihe wie das Diagramm.
   */
  function kurz(g) {
    const z = zustand(g), alt = g.state === 'old';
    const werte = h('p', { class: 'pa-trend', 'aria-live': 'polite' }, alt ? null : h('span', { class: 'pa-tr-laden', text: 'Verlauf wird geladen …' }));
    const kurveBox = h('div', { class: 'pa-kurve-box' });
    verlaufLaden(g.id).then((pts) => {
      if (!werte.isConnected) return;
      const k = kurve24(pts, g, { breite: 220, hoehe: 64 });
      if (k) kurveBox.replaceChildren(k);
      if (alt) return;
      const w = kurzWerte(g, pts);
      if ('tide' in w) { werte.replaceChildren(h('span', { class: 'pa-tr-tend pt-flat', text: w.tide ? `Tide: ${w.tide}` : 'Keine Tendenz verfügbar' })); return; }
      werte.replaceChildren(
        h('span', { class: 'pa-tr-24' }, '24 h: ', h('b', { class: richtungKlasse(Math.sign(w.d || 0)), text: w.aend || 'nicht verfügbar' })),
        h('span', { class: 'pa-tr-sep', 'aria-hidden': 'true', text: ' · ' }),
        h('span', { class: 'pa-tr-tend' }, 'Tendenz (2 h): ', h('b', { class: richtungKlasse(w.richtung), text: w.tend || 'keine verfügbar' })));
    }, () => { if (werte.isConnected && !alt) werte.replaceChildren(h('span', { text: 'Verlauf gerade nicht abrufbar' })); });
    return h('article', { class: `pa-kurz ${ZUSTAND[z].cls}` + (alt ? ' is-alt' : ''), 'aria-labelledby': 'pa-name' },
      h('div', { class: 'pa-k-kopf' },
        h('div', { class: 'pa-k-titel' },
          h('h2', { class: 'pa-name', id: 'pa-name', tabindex: '-1', text: g.name }),
          h('p', { class: 'pa-sub', text: [g.water, kmText(g).replace(' ', '\u00a0'), alt ? null : `Messung ${formatTime(g.time)}`.replace(/ /g, '\u00a0')].filter(Boolean).join(' · ') })),
        sternKnopf(g, { klein: true, onChange: () => {} }),   // neu gezeichnet wird über das Ereignis „meine-pegel“
        h('button', { type: 'button', class: 'pa-schliessen', 'aria-label': 'Auswahl schließen', html: icon('close', 20), onclick: () => abwaehlen() })),
      alt ? h('p', { class: 'pa-zeit is-alt' }, h('span', { html: icon('clock', 15), 'aria-hidden': 'true' }), `Messwert veraltet – letzte Messung ${formatTime(g.time)}`) : null,
      h('div', { class: 'pa-k-mitte' },
        h('p', { class: 'pa-wert' }, h('strong', { text: fmt(g.value) }), h('span', { text: ` ${g.unit}` })),
        kurveBox),
      werte,
      EINORDNUNG[z] && !alt ? h('p', { class: `pa-einordnung ${ZUSTAND[z].cls}`, title: 'Einordnung nach den statistischen Kennwerten dieses Pegels' }, h('i', { 'aria-hidden': 'true' }), EINORDNUNG[z]) : null,
      h('div', { class: 'pa-k-knoepfe' },
        h('button', { type: 'button', class: 'btn btn-primary pa-verlauf', 'aria-expanded': 'false', 'aria-controls': 'pa-panel', onclick: () => grossSetzen(true) }, 'Verlauf und Details anzeigen'),
        h('button', { type: 'button', class: 'btn btn-outline pa-alarm', 'aria-haspopup': 'dialog', 'aria-label': `Pegel-Alarm für ${g.name}`, onclick: (e) => alarmFenster(g, { opener: e.currentTarget, toast: ctx.toast }) },
          h('span', { html: icon('bell', 18), 'aria-hidden': 'true' }), 'Alarm')));
  }

  /** Cockpit: ausführliche Ansicht (Diagramm 24 h / 7 Tage / 30 Tage, Kennwerte, Vorhersage, Zusatzwerte). */
  function cockpit(g) {
    return pegelDetail(g, {
      verlauf: verlaufLaden(g.id), eingebettet: true,
      onBack: () => grossSetzen(false), backLabel: 'Details schließen',
      onShare: () => ctx.share?.(g),
      slips: slipsAmPegel(g, ctx.places?.() || []), onSlip: ctx.slip,
      onKarte: ctx.karte ? () => ctx.karte(g) : undefined,   // Hauptkarte mit Slipanlagen bzw. Häfen in der Nähe
      onFluss: g.water && ctx.fluss ? () => ctx.fluss(istKueste(g.water) ? KUESTE_SLUG : slug(g.water)) : null,
      onStern: () => { zeichnen(); inhalt.querySelector('.pd .pm-stern')?.focus(); },
    });
  }

  /** Liste unter dem Pegel: Favoriten bzw. Pegel im Kartenausschnitt. */
  function liste() {
    if (ui.filter === 'naehe') {
      const pegel = karteFertig ? karte.imAusschnitt().slice(0, MAX_NAEHE) : [];
      return h('section', { class: 'pa-liste', 'aria-labelledby': 'pa-liste-t' },
        h('div', { class: 'pa-liste-kopf' }, h('h2', { class: 'pa-h2', id: 'pa-liste-t', text: 'Im Kartenausschnitt' }),
          pegel.length ? h('span', { class: 'pa-anzahl', text: pegel.length >= MAX_NAEHE ? `die ${MAX_NAEHE} nächsten` : `${pegel.length} Pegel` }) : null),
        pegel.length ? h('ul', { class: 'pa-zeilen' }, pegel.map(g => zeile(g, { verlauf: false })))
          : h('p', { class: 'pa-leer-text', text: karteFertig ? 'Im Kartenausschnitt ist kein Pegel. Karte verschieben oder herauszoomen.' : 'Die Karte wird geladen …' }));
    }
    meinePegel.ampelUebernehmen();
    const ids = meinePegel.alle().filter(id => stand.byId.has(id));
    return h('section', { class: 'pa-liste', 'aria-labelledby': 'pa-liste-t' },
      h('div', { class: 'pa-liste-kopf' }, h('h2', { class: 'pa-h2', id: 'pa-liste-t', text: 'Meine Pegel' }),
        ids.length ? h('span', { class: 'pa-anzahl', text: `${ids.length} gespeichert` }) : null),
      ids.length ? h('ul', { class: 'pa-zeilen' }, ids.map(id => zeile(stand.byId.get(id), { verlauf: true })))
        : h('div', { class: 'pa-leer' },
          h('span', { class: 'pa-leer-ico', html: icon('star', 22), 'aria-hidden': 'true' }),
          h('div', {}, h('strong', { text: 'Noch keine Favoriten' }),
            h('p', { text: 'Tippe auf einen Pegel in der Karte oder suche ihn oben und dann auf ☆. So findest du ihn beim nächsten Besuch hier wieder – gespeichert nur in diesem Browser.' }))));
  }

  /** Zeile: Name, Gewässer, Wert, Änderung 24 h, Mini-Verlauf (nur Favoriten), Stern. */
  function zeile(g, { verlauf }) {
    const z = zustand(g);
    const aend = h('small', { class: 'pa-z-aend pt-flat' });
    const spark = h('span', { class: 'pa-z-spark', 'aria-hidden': verlauf ? 'false' : 'true' });
    if (verlauf) {
      verlaufLaden(g.id).then((pts) => {
        if (!aend.isConnected) return;
        if (g.state !== 'old') {
          const w = kurzWerte(g, pts);
          if ('tide' in w) { if (w.tide) aend.textContent = w.tide; }
          else if (w.aend) { aend.textContent = `${w.aend} in 24 h`; aend.className = `pa-z-aend ${richtungKlasse(Math.sign(w.d))}`; }
        }
        const k = kurve24(pts, g, { breite: 72, hoehe: 26, klein: true });
        if (k) spark.replaceChildren(k);
      }, () => {});
    }
    if (g.state === 'old') { aend.textContent = 'veraltet'; aend.className = 'pa-z-aend is-alt'; }
    return h('li', { class: 'pa-z' + (g.id === ui.auswahl ? ' is-gewaehlt' : '') },
      h('button', { type: 'button', class: 'pa-z-knopf', dataset: { id: g.id }, 'aria-current': g.id === ui.auswahl ? 'true' : null,
        'aria-label': `${g.name}, ${g.water}: ${fmt(g.value)} ${g.unit}${EINORDNUNG[z] ? `, ${EINORDNUNG[z]}` : ''}`, onclick: () => waehlen(g.id, { fly: true }) },
        h('span', { class: `pa-z-punkt ${ZUSTAND[z].cls}`, 'aria-hidden': 'true' }),
        h('span', { class: 'pa-z-text' }, h('b', { text: g.name }), h('small', { text: [g.water, kmText(g)].filter(Boolean).join(' · ') })),
        spark,
        h('span', { class: 'pa-z-wert' }, h('b', { text: `${fmt(g.value)} ${g.unit}` }), aend)),
      sternKnopf(g, { klein: true, onChange: () => {} }));
  }

  // ---------------------------------------------------------------- Auswahl, Größe, Filter
  function waehlen(id, { fly = false, gross = false, quelle = null, still = false } = {}) {
    if (!stand) { ui.auswahl = id; return false; }
    const g = stand.byId.get(id);
    if (!g) { ctx.toast?.('Dieser Pegel wurde nicht gefunden.'); return false; }
    ui.auswahl = id; ui.gross = gross; ui.voll = false;
    if (karteFertig) { karte.markieren(id); karte.hinzeigen(g, fly ? { zoom: ZOOM_AUSWAHL, immer: true } : {}); }
    zeichnen({ fokus: quelle === 'karte' && isMobile() ? null : gross ? '#pd-name' : '#pa-name' });
    if (!still) ctx.auswahl?.(id);
    announce(`Pegel ${g.name}: ${fmt(g.value)} ${g.unit}`);
    return true;
  }
  function abwaehlen({ still = false } = {}) {
    if (!ui.auswahl && !ui.gross) return;
    const war = ui.auswahl;
    ui.auswahl = null; ui.gross = false; ui.voll = false;
    if (karteFertig) karte.markieren(null);
    zeichnen();
    if (!still) ctx.auswahl?.(null);
    if (war) inhalt.querySelector(`.pa-z-knopf[data-id="${CSS.escape(war)}"]`)?.focus({ preventScroll: true });
  }
  function griffStellen() {
    griff.setAttribute('aria-expanded', String(ui.gross));
    griff.setAttribute('aria-label', !ui.gross ? 'Fenster vergrößern' : !ui.voll ? 'Fenster ganz öffnen' : 'Fenster verkleinern');
  }
  /** Stufe 2 ↔ 3: nur die Höhe ändert sich – nichts wird neu gezeichnet oder geladen. */
  function vollSetzen(voll) {
    if (!ui.gross || voll === ui.voll) return;
    ui.voll = voll;
    panel.classList.toggle('is-voll', voll);
    griffStellen();
    if (!voll) inhalt.scrollTop = 0;
  }
  function grossSetzen(gross) {
    if (gross === ui.gross) return;
    ui.gross = gross; ui.voll = false; ui.wechsel = Date.now();
    zeichnen({ fokus: gross ? (ui.auswahl ? '#pd-name' : null) : (ui.auswahl ? '.pa-verlauf' : null) });
    if (!gross && ui.auswahl && karteFertig) karte.hinzeigen(gewaehlt());
  }
  function filterSetzen(f) {
    ui.filter = f;
    for (const b of filterBox.children) b.setAttribute('aria-pressed', String(b.dataset.filter === f));
    if (karteFertig) {
      karte.filtern(f === 'fav' ? (g) => meinePegel.hat(g.id) || g.id === ui.auswahl : null);
      if (f === 'fav') { const favs = meinePegel.alle().map(id => stand?.byId.get(id)).filter(Boolean); if (favs.length) karte.passend(favs); }
    }
    ui.gross = false; ui.voll = false;
    zeichnen();
  }

  // ---------------------------------------------------------------- Suche: Pegel, Gewässer, Orte
  function treffer(q) {
    const n = normW(q);
    if (!n || !stand) return [];
    const u = ctx.user();
    const ent = (g) => (u ? haversine(u.lat, u.lon, g.lat, g.lon) : 0);
    const pegel = stand.gauges.filter(g => normW(g.name).includes(n))
      .sort((a, b) => (normW(a.name).startsWith(n) ? 0 : 1) - (normW(b.name).startsWith(n) ? 0 : 1) || ent(a) - ent(b) || a.name.localeCompare(b.name, 'de')).slice(0, 8)
      .map(g => ({ art: 'pegel', g, titel: g.name, sub: [g.water, kmText(g)].filter(Boolean).join(' · '), wert: `${fmt(g.value)} ${g.unit}` }));
    const gew = new Map();
    for (const g of stand.gauges) if (g.water && normW(g.water).includes(n)) { const k = normW(g.water); const e = gew.get(k) || { name: g.water, liste: [] }; e.liste.push(g); gew.set(k, e); }
    const gewaesser = [...gew.values()].sort((a, b) => (normW(a.name).startsWith(n) ? 0 : 1) - (normW(b.name).startsWith(n) ? 0 : 1) || b.liste.length - a.liste.length).slice(0, 4)
      .map(e => ({ art: 'gewaesser', liste: e.liste, titel: e.name, sub: `Gewässer · ${e.liste.length} ${e.liste.length === 1 ? 'Pegel' : 'Pegel'}` }));
    const orte = new Map();
    for (const p of ctx.places?.() || []) {
      if (!p.locality || p.locality_kind === 'nearest' || !normW(p.locality).includes(n)) continue;
      const k = normW(p.locality);
      if (!orte.has(k)) orte.set(k, { art: 'ort', titel: p.locality, sub: 'Ort · Pegel in der Nähe zeigen', lat: p.lat, lon: p.lon });
    }
    const ortListe = [...orte.values()].filter(o => !pegel.some(t => normW(t.titel) === normW(o.titel))).slice(0, 4);
    return [...pegel, ...gewaesser, ...ortListe];
  }
  function sucheZeichnen() {
    const q = feld.value.trim();
    ui.treffer = treffer(q); ui.aktiv = -1;
    if (!q) { sucheZu(); return; }
    const ico = { pegel: 'gauge', gewaesser: 'welle', ort: 'pin' };
    trefferBox.replaceChildren(...(ui.treffer.length ? ui.treffer.map((t, i) => h('li', { role: 'option', id: `pa-t-${i}`, class: `pa-t pa-t-${t.art}`, 'aria-selected': 'false',
      onmousedown: (e) => e.preventDefault(), onclick: () => trefferWaehlen(i) },
      h('span', { class: 'pa-t-ico', html: icon(ico[t.art], 18), 'aria-hidden': 'true' }),
      h('span', { class: 'pa-t-text' }, h('b', { text: t.titel }), h('small', { text: t.sub })),
      t.wert ? h('span', { class: 'pa-t-wert', text: t.wert }) : null))
      : [h('li', { class: 'pa-t-leer', role: 'option', 'aria-disabled': 'true', text: `Nichts gefunden zu „${q}“.` })]));
    trefferBox.hidden = false; feld.setAttribute('aria-expanded', 'true'); feld.removeAttribute('aria-activedescendant');
  }
  function sucheZu() { trefferBox.hidden = true; feld.setAttribute('aria-expanded', 'false'); feld.removeAttribute('aria-activedescendant'); ui.aktiv = -1; }
  function sucheTaste(e) {
    if (e.key === 'Escape') { if (!trefferBox.hidden) { e.preventDefault(); sucheZu(); } return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (trefferBox.hidden) sucheZeichnen();
      if (!ui.treffer.length) return;
      e.preventDefault();
      ui.aktiv = (ui.aktiv + (e.key === 'ArrowDown' ? 1 : -1) + ui.treffer.length) % ui.treffer.length;
      trefferBox.querySelectorAll('[role=option]').forEach((o, i) => o.setAttribute('aria-selected', String(i === ui.aktiv)));
      feld.setAttribute('aria-activedescendant', `pa-t-${ui.aktiv}`);
      trefferBox.querySelector(`#pa-t-${ui.aktiv}`)?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (ui.treffer.length) trefferWaehlen(ui.aktiv >= 0 ? ui.aktiv : 0);
    }
  }
  function trefferWaehlen(i) {
    const t = ui.treffer[i];
    if (!t) return;
    sucheZu(); feld.value = ''; feld.blur();
    if (t.art === 'pegel') waehlen(t.g.id, { fly: true });
    else if (t.art === 'gewaesser') { if (ui.filter === 'fav') filterSetzen('alle'); karte.passend(t.liste); announce(`${t.titel}: ${t.liste.length} Pegel auf der Karte`); }
    else { if (ui.auswahl) abwaehlen(); karte.flyTo(t.lat, t.lon, ZOOM_AUSWAHL); filterSetzen('naehe'); announce(`Pegel in der Nähe von ${t.titel}`); }
  }

  document.addEventListener('meine-pegel', () => {
    if (!app?.isConnected || !stand) return;
    if (karteFertig) { if (ui.filter === 'fav') karte.filtern(g => meinePegel.hat(g.id) || g.id === ui.auswahl); else karte.aktualisieren(); if (ui.auswahl) karte.markieren(ui.auswahl); }
    const fokusStern = document.activeElement?.closest?.('.pa-kurz') ? '.pa-kurz .pm-stern' : null;
    if (!(ui.gross && ui.auswahl)) zeichnen({ fokus: fokusStern });
    else { const zahl = filterBox.querySelector('.pa-chip-zahl'); const n = meinePegel.alle().length; zahl.textContent = n ? String(n) : ''; }
  });

  return {
    async zeigen(force = false) {
      if (!app) aufbauen();
      else if (!app.isConnected) { root.replaceChildren(app); root.classList.add('pa-modus'); }   // zurück von der Flussseite
      await laden(force);
      await karteZeigen();
    },
    waehlen: (id, opts = {}) => waehlen(id, { ...opts, still: true }),
    abwaehlen: () => abwaehlen({ still: true }),
    /** Im Hintergrund laden, damit das erste Öffnen schnell geht (die Karte entsteht erst beim Anzeigen). */
    vorbereiten: () => pegelLaden().catch(() => null),
    get stand() { return stand; },
    get auswahl() { return ui.auswahl; },
  };
}

export { formatTime, etikett, ZUSTAND, zustand };

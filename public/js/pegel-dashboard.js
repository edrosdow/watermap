// Bereich „Pegel“ (#pegel, #pegel/<id>): Kartenanwendung für Bootsfahrer.
//  Kopf: „Pegelstände“, Suche (Pegel, Gewässer, Ort), Chips „Favoriten“ und „In der Nähe“ (öffnen eine Liste nur auf Wunsch).
//  Karte (pegel-karte.js) mit allen Pegeln. Ohne Auswahl KEIN Panel/Sheet – die Karte ist der Normalzustand.
//  Pegel gewählt: Panel rechts (Desktop) bzw. Bottom Sheet (Handy) kompakt → „Details“ öffnet das Cockpit (pegelDetail).
// Daten: eine Stationsliste (pegel-daten.js); Verläufe nur für den gewählten Pegel und die Favoriten (zwischengespeichert).
import { h, announce } from './dom.js';
import { icon, logoSvg } from './icons.js';
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
const PFEIL = { 1: '↗', 0: '→', '-1': '↘' };
const LISTEN = [['fav', 'Favoriten'], ['naehe', 'In der Nähe']];   // Listen auf Wunsch (Chip antippen)
const MAX_NAEHE = 30;
const STREIFEN = 60;   // Handy, groß: so viel Karte bleibt unter Suche und Chips sichtbar (wie auf der Hauptkarte)

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
  let kleinH = 0;   // zuletzt gemessene Höhe des kleinen Sheets (Handy)
  const ui = { liste: null, auswahl: null, gross: false, aktiv: -1, treffer: [] };   // Handy: klein ↔ gross (bis unter die Suche)
  let stand = null, ladeFehler = false, app = null, karte = null, panel = null, inhalt = null, griff = null, standZeile = null, feld = null, trefferBox = null, filterBox = null;
  let karteFertig = false;

  const isMobile = () => ctx.isMobile?.() ?? window.matchMedia('(max-width: 767px)').matches;
  const gewaehlt = () => (ui.auswahl && stand ? stand.byId.get(ui.auswahl) : null);

  // ---------------------------------------------------------------- Aufbau (einmal)
  function aufbauen() {
    meinePegel.ampelUebernehmen();   // einmalig: Pegel aus der Pegel-Ampel als Favorit (vor Karte und Zähler)
    karte = pegelKarteAnsicht({
      stand: () => stand, user: () => ctx.user(),
      waehlen: (id) => waehlen(id, { quelle: 'karte' }),
      abwaehlen: () => abwaehlen(),
      bewegt: () => { if (ui.liste === 'naehe' && !ui.auswahl) listeNeu(); },
      unten: () => (isMobile() && panel ? panel.offsetHeight : 0),
      oben: () => (isMobile() ? kopfUnten() : 0),
    });
    standZeile = h('p', { class: 'pa-stand', 'aria-live': 'polite', text: 'Pegel werden geladen …' });
    feld = h('input', { type: 'search', id: 'pa-suche', class: 'pa-suche', placeholder: 'Pegel, Gewässer oder Ort', autocomplete: 'off', enterkeyhint: 'search',
      role: 'combobox', 'aria-label': 'Pegel, Gewässer oder Ort suchen', 'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': 'pa-treffer',
      oninput: () => sucheZeichnen(), onkeydown: sucheTaste, onfocus: () => { if (feld.value.trim()) sucheZeichnen(); } });
    trefferBox = h('ul', { class: 'pa-treffer', id: 'pa-treffer', role: 'listbox', 'aria-label': 'Suchtreffer', hidden: true });
    filterBox = h('div', { class: 'pa-filter', role: 'group', 'aria-label': 'Listen' },
      LISTEN.map(([k, t]) => h('button', { type: 'button', class: 'pa-chip', dataset: { liste: k }, 'aria-pressed': 'false', 'aria-controls': 'pa-panel', onclick: () => listeSetzen(ui.liste === k ? null : k) },
        h('span', { html: k === 'fav' ? icon('star', 15, true) : icon('locate', 15), 'aria-hidden': 'true' }), h('span', { text: t }), k === 'fav' ? h('span', { class: 'pa-chip-zahl' }) : null)));
    const kopf = h('header', { class: 'pa-kopf' },
      h('div', { class: 'pa-titelblock' },
        h('div', { class: 'pa-titelzeile' }, h('h1', { class: 'pa-h1', text: 'Pegelstände' }),
          h('button', { type: 'button', class: 'pa-neu', 'aria-label': 'Pegel aktualisieren', title: 'Aktualisieren', html: icon('refresh', 18), onclick: async (e) => {
            const b = e.currentTarget; b.classList.add('is-busy'); await laden(true); b.classList.remove('is-busy');
            ctx.toast?.(stand?.offline ? 'Keine Verbindung – letzter Stand wird angezeigt.' : stand ? 'Pegel aktualisiert.' : 'Pegeldaten sind gerade nicht erreichbar.'); } })),
        standZeile),
      h('div', { class: 'pa-suchzeile' },   // Handy: wie auf der Hauptkarte – Logo links, Suche als Pille, Lupe rechts
        h('a', { class: 'pa-logo', href: './', 'aria-label': 'WaterMap – Startseite', html: logoSvg(38) }),
        h('div', { class: 'pa-suchbox' }, h('span', { class: 'pa-suche-ico', html: icon('search', 20), 'aria-hidden': 'true' }), feld, trefferBox)),
      filterBox);
    inhalt = h('div', { class: 'pa-inhalt' });
    griff = h('button', { type: 'button', class: 'pa-griff', 'aria-controls': 'pa-panel', onclick: () => grossSetzen(!ui.gross) }, h('span', { 'aria-hidden': 'true' }));
    panel = h('aside', { class: 'pa-panel', id: 'pa-panel', 'aria-label': 'Pegel-Details', hidden: true }, griff, inhalt);
    wischen(panel);
    app = h('div', { class: 'pa' }, kopf, h('div', { class: 'pa-haupt' }, karte.el, panel));
    app.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.target === feld) return;
      if (sheet.laeuft) sheet.abschliessen();
      if (ui.gross) { e.preventDefault(); grossSetzen(false, { sofort: true }); } else if (ui.auswahl) { e.preventDefault(); abwaehlen(); } else if (ui.liste) { e.preventDefault(); listeSetzen(null); }   // Esc: kompakt, dann schließen
    });
    document.addEventListener('click', (e) => { if (!trefferBox.hidden && !e.target.closest?.('.pa-suchbox')) sucheZu(); });
    root.replaceChildren(app);
    root.classList.add('pa-modus');
    new ResizeObserver(() => app.style.setProperty('--pa-unten', `${isMobile() ? panel.offsetHeight : 0}px`)).observe(panel);
    new ResizeObserver(() => app.style.setProperty('--pa-gross-top', `${kopfUnten() + STREIFEN}px`)).observe(kopf);   // Sheet „groß“ endet genau unter Suche und Chips
  }

  /**
   * Bottom Sheet (Handy): folgt beim Ziehen dem Finger und rastet weich ein – klein, groß (bis unter Suche und Chips) oder zu.
   * Gezogen wird am Griff oder überall, solange der Inhalt ganz oben steht (sonst gehört die Bewegung dem Scrollen).
   */
  function wischen(el) {
    // Wie auf der Hauptkarte: beim Ziehen nur verschieben (transform, flüssig).
    // Das Sheet steht beim Ziehen in seiner großen Form (oben = Stufe „groß“, volle Höhe) und wird um y nach unten verschoben:
    //   y = 0 → groß · y = H − Höhe(klein) → klein · y = H → zu.  So rastet es genau dort ein, wo es danach steht – ohne Sprung.
    // Beim Hochziehen aus „klein“ wird der Inhalt gleich zu Beginn gegen die Details getauscht (kein leeres weißes Blatt).
    let z = null;   // { y0, x0, top0, h0, basis, dy, t, v, aktiv, warGross }
    // Bewegung und Ende hängen am berührten Element: es kann beim Tausch des Inhalts aus dem Sheet verschwinden,
    // seine Touch-Ereignisse kommen dann nicht mehr beim Sheet an (auch nicht auf dem iPhone).
    let beruehrt = null;
    const loesen = () => { if (!beruehrt) return; beruehrt.removeEventListener('touchmove', bewegen); beruehrt.removeEventListener('touchend', beenden); beruehrt.removeEventListener('touchcancel', abbrechen); beruehrt = null; };
    el.addEventListener('touchstart', (e) => {
      z = null; loesen();
      if (!isMobile() || e.touches.length !== 1 || e.target.closest('.gc-wrap, .pd-umschalter, input, select, .pt-kurve')) return;
      const lage = sheet.laeuft ? el.getBoundingClientRect().top : null;   // mitten in einer Bewegung gegriffen: von dort weiter
      if (sheet.laeuft) sheet.abschliessen();
      if (inhalt.scrollTop > 0 && !e.target.closest('.pa-griff')) return;
      const r = el.getBoundingClientRect();
      z = { y0: e.touches[0].clientY, x0: e.touches[0].clientX, top0: lage ?? r.top, h0: r.height, dy: 0, t: e.timeStamp, v: 0, aktiv: false, warGross: ui.gross };
      beruehrt = e.target;
      beruehrt.addEventListener('touchmove', bewegen, { passive: false });
      beruehrt.addEventListener('touchend', beenden, { passive: true });
      beruehrt.addEventListener('touchcancel', abbrechen, { passive: true });
    }, { passive: true });
    function bewegen(e) {
      if (!z) return;
      const dy = e.touches[0].clientY - z.y0, dx = e.touches[0].clientX - z.x0;
      if (!z.aktiv) {
        if (Math.abs(dy) < 8 || Math.abs(dx) > Math.abs(dy)) return;
        if (dy < 0 && ui.gross) { z = null; return; }                      // groß: nach oben gehört dem Scrollen
        if (dy > 0 && inhalt.scrollTop > 0 && !e.target.closest('.pa-griff')) { z = null; return; }
        z.aktiv = true;
        if (!ui.gross) kleinH = z.h0;
        if (dy < 0 && ui.auswahl && !ui.gross) { ui.gross = true; zeichnen(); sheet.einblenden(); }   // Details schon beim Hochziehen zeigen
        z.basis = sheet.grossForm() + (z.top0 - sheet.grossTopBild());
        sheet.setze(z.basis);
      }
      if (e.cancelable) e.preventDefault();
      z.v = (dy - z.dy) / Math.max(1, e.timeStamp - z.t); z.dy = dy; z.t = e.timeStamp;
      sheet.setze(Math.max(0, z.basis + dy));
    }
    function beenden() { ende(false); }
    function abbrechen() { ende(true); }
    const ende = (abbruch) => {
      const a = z; z = null; loesen();
      if (!a || !a.aktiv) return;
      const H = el.offsetHeight, y = Math.max(0, a.basis + a.dy), schnell = Math.abs(a.v) > 0.5;
      const stufen = { gross: 0, klein: Math.max(0, H - kleinHoehe(H)), zu: H };
      if (!ui.auswahl) stufen.klein = Math.max(0, H - Math.min(a.h0, H));   // Liste: „klein“ ist ihre Höhe beim Start
      let ziel;
      if (abbruch) ziel = a.warGross ? 'gross' : 'klein';
      else if (schnell) ziel = a.v < 0 ? 'gross' : (a.warGross ? 'klein' : 'zu');
      else ziel = Object.entries(stufen).reduce((b, k) => (Math.abs(k[1] - y) < Math.abs(b[1] - y) ? k : b))[0];
      if (ziel === 'klein' && ui.gross && ui.auswahl) sheet.ausblenden();   // Details beim Runtergleiten weich ausblenden
      sheet.fahre(stufen[ziel], () => {
        if (ziel === 'zu') { if (ui.auswahl) abwaehlen(); else if (ui.liste) listeSetzen(null); return; }
        const gross = ziel === 'gross';
        if (ui.gross !== gross) { ui.gross = gross; zeichnen({ fokus: gross ? null : (ui.auswahl ? '.pa-verlauf' : null) }); if (!gross) sheet.einblenden(); }
        else sheet.einblenden(true);
        if (ui.auswahl && karteFertig) karte.hinzeigen(gewaehlt());
      });
    };
  }

  /** Höhe des kleinen Sheets (zuletzt gemessen; vorher eine Schätzung). */
  function kleinHoehe(H) { return Math.min(kleinH || 300, H); }

  /**
   * Bewegungen des Sheets (Handy). Während einer Bewegung steht das Sheet in der großen Form (top = Stufe „groß“, volle Höhe)
   * und wird nur per transform verschoben; erst am Ziel wird der echte Zustand gesetzt – an genau derselben Stelle.
   */
  const sheet = {
    laeuft: false,
    ruhig: () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    grossTop: () => kopfUnten() + STREIFEN,                         // bezogen auf die Pegel-Ansicht (für style.top)
    grossTopBild: () => (root.querySelector('.pa-haupt')?.getBoundingClientRect().top || 0) + kopfUnten() + STREIFEN,   // im Fenster
    /** in die große Form stellen, ohne dass es sich sichtbar bewegt; Rückgabe: y für die bisherige Lage (0 = groß) */
    grossForm() {
      panel.style.willChange = 'transform'; panel.style.maxHeight = 'none'; panel.style.top = `${this.grossTop()}px`;
      return 0;
    },
    setze(y, ms = 0) {
      panel.style.transition = ms ? `transform ${ms}ms cubic-bezier(.2, .8, .2, 1)` : 'none';
      panel.style.transform = `translate3d(0, ${y}px, 0)`;
    },
    /** Inhalt beim Verkleinern ausblenden (erst ab gut einem Drittel des Wegs) */
    ausblenden() {
      if (this.ruhig() || !inhalt.animate) return;
      this.blende?.cancel();
      this.blende = inhalt.animate([{ opacity: 1 }, { opacity: 1, offset: 0.3 }, { opacity: 0 }], { duration: 260, easing: 'ease-in', fill: 'forwards' });
    },
    /** neuen Inhalt weich einblenden (leicht von unten); nur=true: nur eine laufende Ausblendung zurücknehmen */
    einblenden(nur = false) {
      const alt = this.blende; this.blende = null;
      if (nur) { if (alt) inhalt.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' }); alt?.cancel(); return; }
      alt?.cancel();
      if (this.ruhig() || !inhalt.animate) return;
      inhalt.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.2, .8, .2, 1)' });
    },
    aufraeumen() { for (const k of ['transition', 'transform', 'top', 'maxHeight', 'willChange']) panel.style[k] = ''; },
    /** von der aktuellen Lage nach y fahren, dann fertig() (Zustand setzen) und Inline-Stile entfernen */
    fahre(y, fertig) {
      const ms = this.ruhig() ? 0 : 280;
      this.laeuft = true; this.offen = fertig;
      this.setze(y, ms);
      this.uhr = setTimeout(() => this.abschliessen(), ms ? ms + 20 : 0);
    },
    /** laufende Bewegung sofort beenden (Zustand setzen) */
    abschliessen() {
      clearTimeout(this.uhr);
      const f = this.offen; this.offen = null;
      this.aufraeumen(); this.laeuft = false;
      f?.();
    },
    /** Zustand per Knopf wechseln: weich von der jetzigen Lage in die neue (Handy), sonst sofort */
    wechsel(gross, fertig, sofort = false) {
      if (this.laeuft) this.abschliessen();
      if (sofort || !isMobile() || panel.hidden || this.ruhig()) { fertig(); return; }
      const r = panel.getBoundingClientRect();
      if (!ui.gross) kleinH = r.height;
      const H0 = (() => { this.grossForm(); return panel.offsetHeight; })();
      const von = r.top - this.grossTopBild();
      if (gross) {
        // klein → groß: Details sofort zeigen, von unten hochfahren
        this.setze(von); fertig(); this.einblenden(); this.grossForm(); this.setze(von);
        void panel.offsetHeight;
        this.fahre(0, () => {});
      } else {
        // groß → klein: in der großen Form bis zur Höhe des kleinen Sheets fahren, dann tauschen
        this.setze(von);
        void panel.offsetHeight;
        this.ausblenden();
        this.fahre(Math.max(0, H0 - kleinHoehe(H0)), () => { fertig(); this.einblenden(); });
      }
    },
    /** schließen: nach unten hinausfahren */
    weg(fertig) {
      if (this.laeuft) this.abschliessen();
      if (!isMobile() || panel.hidden || this.ruhig()) { fertig(); return; }
      const r = panel.getBoundingClientRect();
      this.grossForm(); const H = panel.offsetHeight; const von = r.top - this.grossTopBild();
      this.setze(von); void panel.offsetHeight;
      this.fahre(H, fertig);
    },
  };

  /** Unterkante von Suche und Chips (Handy), Bezug: Oberkante der Pegel-Ansicht. */
  function kopfUnten() {
    const k = root.querySelector('.pa-kopf'), o = root.querySelector('.pa-haupt');
    if (!k) return 0;
    return Math.round(k.getBoundingClientRect().bottom - (o ? o.getBoundingClientRect().top : 0));
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
      const g = gewaehlt();
      if (g) { karte.markieren(g.id); karte.hinzeigen(g, { zoom: ZOOM_AUSWAHL, immer: true }); }
      if (ui.liste === 'naehe') listeNeu();
    }
  }

  // ---------------------------------------------------------------- Panel
  function zeichnen({ cockpitBehalten = false, fokus = null } = {}) {
    const g = gewaehlt();
    const offen = !!(g || ui.liste || !stand);
    if (panel.hidden === offen) { panel.hidden = !offen; app.classList.toggle('hat-panel', offen); if (karteFertig) requestAnimationFrame(() => karte.groesse()); }
    for (const b of filterBox.children) b.setAttribute('aria-pressed', String(b.dataset.liste === ui.liste && !g));
    panel.classList.toggle('hat-auswahl', !!g);
    panel.classList.toggle('is-gross', ui.gross);
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
    inhalt.replaceChildren(g ? (ui.gross ? cockpit(g) : kurz(g)) : ui.liste ? liste() : '');
    inhalt.scrollTop = 0;
    if (g && !ui.gross && isMobile() && !panel.style.top) kleinH = panel.offsetHeight;
    if (fokus) inhalt.querySelector(fokus)?.focus({ preventScroll: true });
  }

  function listeNeu() {
    const alt = inhalt.querySelector('.pa-liste');
    if (alt) alt.replaceWith(liste());
  }

  /**
   * Stufe 1 (kompakt), bewusst knapp: Name · Gewässer, Glocke/Stern/✕, Wert mit 24-h-Kurve, eine Zeile „● Niedrig · 2 h → ±0 · 24 h −6 cm“, „Details“.
   * Kurve und Zahlen aus derselben (zwischengespeicherten) Messreihe wie das Diagramm.
   */
  function kurz(g) {
    const z = zustand(g), alt = g.state === 'old';
    const tend = h('b', { class: 'pt-flat' }), aend = h('b', { class: 'pt-flat' });
    const zahlen = alt ? null : h('span', { class: 'pa-zahlen' }, h('span', { title: 'Tendenz der letzten 2 Stunden' }, ' · 2 Std. ', tend), h('span', { title: 'Änderung in 24 Stunden' }, ' · 24 Std. ', aend));
    const kurveBox = h('div', { class: 'pa-kurve-box' });
    verlaufLaden(g.id).then((pts) => {
      if (!kurveBox.isConnected) return;
      const k = kurve24(pts, g, { breite: 220, hoehe: 64 });
      if (k) kurveBox.replaceChildren(k);
      if (alt) return;
      const w = kurzWerte(g, pts);
      if ('tide' in w) { zahlen.replaceChildren(h('span', {}, ' · ', h('b', { text: w.tide || '–' }))); return; }
      const t = tendenz(pts);
      tend.textContent = t ? aenderungKurz(t.d) : '–'; tend.title = t ? `${PFEIL[t.richtung]} ${tendenzTextKurz(t)}` : 'Keine Tendenz verfügbar';
      aend.textContent = w.aend || '–';
    }, () => { if (zahlen) { tend.textContent = '–'; aend.textContent = '–'; } });
    return h('article', { class: `pa-kurz pa-blau ${ZUSTAND[z].cls}` + (alt ? ' is-alt' : ''), 'aria-labelledby': 'pa-name' },
      h('div', { class: 'pa-k-kopf' },
        h('h2', { class: 'pa-name', id: 'pa-name', tabindex: '-1' }, g.name, g.water ? h('small', { text: ` · ${g.water}` }) : null),
        h('button', { type: 'button', class: 'pa-ico pa-alarm', 'aria-haspopup': 'dialog', 'aria-label': `Pegel-Alarm für ${g.name}`, html: icon('bell', 19), onclick: (e) => alarmFenster(g, { opener: e.currentTarget, toast: ctx.toast }) }),
        sternKnopf(g, { klein: true, onChange: () => {} }),   // neu gezeichnet wird über das Ereignis „meine-pegel“
        h('button', { type: 'button', class: 'pa-ico pa-schliessen', 'aria-label': 'Auswahl schließen', html: icon('close', 19), onclick: () => sheet.weg(() => abwaehlen()) })),
      alt ? h('p', { class: 'pa-zeit is-alt' }, h('span', { html: icon('clock', 15), 'aria-hidden': 'true' }), `Veraltet – ${formatTime(g.time)}`) : null,
      h('div', { class: 'pa-k-mitte' },
        h('p', { class: 'pa-wert' }, h('strong', { text: fmt(g.value) }), h('span', { text: ` ${g.unit}` })),
        kurveBox),
      h('p', { class: 'pa-trend' },
        !alt ? h('span', { class: `pa-zustand ${ZUSTAND[z].cls}`, title: EINORDNUNG[z] || '' }, h('i', { 'aria-hidden': 'true' }), ZUSTAND[z].text.replace(/^ü/, 'Ü')) : null,
        zahlen),
      h('button', { type: 'button', class: 'pa-verlauf', 'aria-expanded': 'false', 'aria-controls': 'pa-panel', onclick: () => grossSetzen(true) }, 'Details'));
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

  /** Liste auf Wunsch: Favoriten bzw. Pegel im Kartenausschnitt – Name, Wert, Pfeil. */
  function liste() {
    const naehe = ui.liste === 'naehe';
    const pegel = naehe ? (karteFertig ? karte.imAusschnitt().slice(0, MAX_NAEHE) : [])
      : meinePegel.alle().map(id => stand.byId.get(id)).filter(Boolean);
    const leer = naehe ? (karteFertig ? 'Kein Pegel im Kartenausschnitt.' : 'Karte wird geladen …') : 'Noch keine Favoriten – tippe bei einem Pegel auf ☆.';
    return h('section', { class: 'pa-liste', 'aria-labelledby': 'pa-liste-t' },
      h('div', { class: 'pa-liste-kopf' }, h('h2', { class: 'pa-h2', id: 'pa-liste-t', tabindex: '-1', text: naehe ? 'In der Nähe' : 'Favoriten' }),
        h('button', { type: 'button', class: 'pa-ico pa-liste-zu', 'aria-label': 'Liste schließen', html: icon('close', 19), onclick: () => listeSetzen(null) })),
      pegel.length ? h('ul', { class: 'pa-zeilen' }, pegel.map(zeile)) : h('p', { class: 'pa-leer-text', text: leer }));
  }

  /** Zeile: Zustandspunkt, Name (Gewässer klein), Wert mit Pfeil (Tendenz laut PEGELONLINE). */
  function zeile(g) {
    const z = zustand(g), alt = g.state === 'old';
    return h('li', { class: 'pa-z' },
      h('button', { type: 'button', class: 'pa-z-knopf', dataset: { id: g.id },
        'aria-label': `${g.name}, ${g.water}: ${fmt(g.value)} ${g.unit}${EINORDNUNG[z] ? `, ${EINORDNUNG[z]}` : ''}${alt ? ', veraltet' : ''}`, onclick: () => waehlen(g.id, { fly: true }) },
        h('span', { class: `pa-z-punkt ${ZUSTAND[z].cls}`, 'aria-hidden': 'true' }),
        h('span', { class: 'pa-z-text' }, h('b', { text: g.name }), h('small', { text: g.water || '' })),
        h('span', { class: 'pa-z-wert' + (alt ? ' is-alt' : '') }, `${fmt(g.value)} ${g.unit}`, !alt && PFEIL[g.trend] ? h('em', { text: ` ${PFEIL[g.trend]}` }) : null)));
  }

  // ---------------------------------------------------------------- Auswahl, Größe, Filter
  function waehlen(id, { fly = false, gross = false, quelle = null, still = false } = {}) {
    if (sheet.laeuft) sheet.abschliessen();
    if (!stand) { ui.auswahl = id; return false; }
    const g = stand.byId.get(id);
    if (!g) { ctx.toast?.('Dieser Pegel wurde nicht gefunden.'); return false; }
    ui.auswahl = id; ui.gross = gross; ui.liste = null;
    zeichnen({ fokus: quelle === 'karte' && isMobile() ? null : gross ? '#pd-name' : '#pa-name' });   // erst das Sheet, damit seine Höhe beim Hinrücken zählt
    if (karteFertig) { karte.markieren(id); karte.hinzeigen(g, fly ? { zoom: ZOOM_AUSWAHL, immer: true } : {}); }
    if (!still) ctx.auswahl?.(id);
    announce(`Pegel ${g.name}: ${fmt(g.value)} ${g.unit}`);
    return true;
  }
  function abwaehlen({ still = false } = {}) {
    if (sheet.laeuft) sheet.abschliessen();
    if (!ui.auswahl && !ui.gross) return;
    const war = ui.auswahl;
    ui.auswahl = null; ui.gross = false;
    if (karteFertig) karte.markieren(null);
    zeichnen();
    if (!still) ctx.auswahl?.(null);
    if (war && !isMobile()) karte.el.querySelector('.pk-pille.is-gewaehlt')?.closest('[tabindex]')?.focus({ preventScroll: true });
  }
  function griffStellen() {
    griff.setAttribute('aria-expanded', String(ui.gross));
    griff.setAttribute('aria-label', ui.gross ? 'Fenster verkleinern' : 'Fenster ganz öffnen');
  }
  function grossSetzen(gross, { sofort = false } = {}) {
    if (sheet.laeuft) sheet.abschliessen();
    if (gross === ui.gross) return;
    sheet.wechsel(gross, () => {
      ui.gross = gross;
      zeichnen({ fokus: gross ? (ui.auswahl ? '#pd-name' : null) : (ui.auswahl ? '.pa-verlauf' : null) });
      if (ui.auswahl && karteFertig) karte.hinzeigen(gewaehlt());   // groß: Pegel in den Kartenstreifen oben
    }, sofort);
  }
  /** Liste „Favoriten“ bzw. „In der Nähe“ öffnen (null: schließen). Eine gewählte Auswahl wird dabei geschlossen. */
  function listeSetzen(l) {
    if (sheet.laeuft) sheet.abschliessen();
    ui.liste = l; ui.gross = false;
    if (l && ui.auswahl) { ui.auswahl = null; if (karteFertig) karte.markieren(null); ctx.auswahl?.(null); }
    if (l === 'fav' && karteFertig) { const favs = meinePegel.alle().map(id => stand?.byId.get(id)).filter(Boolean); if (favs.length) karte.passend(favs); }
    zeichnen({ fokus: l ? '#pa-liste-t' : null });
    if (!l) filterBox.querySelector('[aria-pressed]')?.blur();
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
    else if (t.art === 'gewaesser') { karte.passend(t.liste); announce(`${t.titel}: ${t.liste.length} Pegel auf der Karte`); }
    else { karte.flyTo(t.lat, t.lon, ZOOM_AUSWAHL); listeSetzen('naehe'); announce(`Pegel in der Nähe von ${t.titel}`); }
  }

  document.addEventListener('meine-pegel', () => {
    if (!app?.isConnected || !stand) return;
    if (karteFertig) { karte.aktualisieren(); if (ui.auswahl) karte.markieren(ui.auswahl); }
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

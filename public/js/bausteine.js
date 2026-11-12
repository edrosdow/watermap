// Gemeinsame Bausteine (Designsystem „Wasser“, DESIGN_SYSTEM.md Abschnitt 5) und EIN Sheet-Rahmen für alle Inhalte.
// Designumbau Phase 1 (7.69.0). Aussehen: css/bausteine.css. Text wird immer als Text eingefügt (h() aus dom.js).
import { h } from './dom.js';
import { icon } from './icons.js';

const ruhig = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const mobil = () => !window.matchMedia?.('(min-width: 768px)').matches;
let laufendeId = 0;
const neueId = (p) => `${p}-${++laufendeId}`;

/** Kopf: Titel links (h2, per Skript fokussierbar), Unterzeile, rechts runder ×-Knopf; optional eine Zusatzaktion links neben ×.
 *  aktion = { icon, label, onclick } · marke = { zustand, text }: Zustandsmarke neben dem Titel (z. B. Fluss „niedrig“) */
export function kopf({ titel, unter = null, onZu = null, aktion = null, titelId = neueId('wm-titel'), klebend = false, marke: mk = null }) {
  const t = h('h2', { class: 'wm-kopf-titel', id: titelId, tabindex: '-1', text: titel });
  return h('header', { class: 'wm-kopf' + (klebend ? ' is-klebend' : '') },
    h('div', { class: 'wm-kopf-block' },
      mk ? h('div', { class: 'wm-kopf-zeile' }, t, marke(mk.zustand, mk.text)) : t,
      unter ? h('p', { class: 'wm-kopf-unter', text: unter }) : null),
    aktion ? h('button', { type: 'button', class: 'wm-rund', 'aria-label': aktion.label, html: icon(aktion.icon, 20), onclick: aktion.onclick }) : null,
    onZu ? h('button', { type: 'button', class: 'wm-rund wm-zu', 'aria-label': 'Schließen', html: icon('close', 20), onclick: onZu }) : null);
}

/** Rechter Teil einer Ortszeile: genau eines – Wert, Zustandsmarke, Pfeil oder ein eigenes Element. */
function rechterTeil(rechts, klickbar) {
  if (rechts === undefined) rechts = klickbar ? 'pfeil' : null;
  if (rechts === null || rechts === false) return null;
  if (rechts === 'pfeil') return h('span', { class: 'wm-pfeil', html: icon('chevron', 18) });
  if (rechts.nodeType) return rechts;
  if (rechts.marke) return marke(rechts.marke.zustand, rechts.marke.text);
  if (rechts.wert !== undefined) return h('span', { class: 'wm-zeile-wert', text: rechts.wert });
  return null;
}

/** Ortszeile: Icon-Kachel, Titel, Unterzeile, rechts ein Teil. href → Link, onClick → Knopf, sonst reine Anzeige.
 *  ico: Name aus icons.js · icoHtml: eigenes SVG (z. B. glyphSvg) · icoKlasse: zusätzliche Klasse der Kachel. */
export function zeile({ ico = null, icoHtml = null, icoKlasse = '', titel, unter = null, rechts, onClick = null, href = null, label = null }) {
  const tag = href ? 'a' : onClick ? 'button' : 'div';
  const attrs = { class: 'wm-zeile' };
  if (href) attrs.href = href;
  if (tag === 'button') attrs.type = 'button';
  if (onClick) attrs.onclick = onClick;
  if (label) attrs['aria-label'] = label;
  return h(tag, attrs,
    ico || icoHtml ? h('span', { class: `wm-kachel-ico ${icoKlasse}`.trim(), 'aria-hidden': 'true', html: icoHtml || icon(ico, 20) }) : null,
    h('span', { class: 'wm-zeile-text' }, h('strong', { text: titel }), unter ? h('small', { text: unter }) : null),
    rechterTeil(rechts, !!(href || onClick)));
}

/** Weiße Gruppe aus Ortszeilen (getrennt durch 1 px Linie). */
export function gruppe(zeilen, { label = null } = {}) {
  return h('div', { class: 'wm-gruppe', role: label ? 'group' : null, 'aria-label': label }, zeilen);
}

/** Aktionsleiste mit drei gleichen Knöpfen. Knopf: { icon, text, onclick, primaer, gemerkt (boolean → aria-pressed), href } */
export function aktionen(knoepfe) {
  return h('div', { class: 'wm-aktionen' }, knoepfe.map((k) => {
    const gedrueckt = typeof k.gemerkt === 'boolean';
    const kl = 'wm-aktion' + (k.primaer ? ' is-primaer' : '') + (k.gemerkt ? ' is-gemerkt' : '');
    const inhalt = [h('span', { html: icon(k.icon, 22), 'aria-hidden': 'true' }), h('span', { text: k.text })];
    return k.href ? h('a', { class: kl, href: k.href, onclick: k.onclick }, inhalt)
      : h('button', { type: 'button', class: kl, 'aria-pressed': gedrueckt ? String(k.gemerkt) : null, onclick: k.onclick }, inhalt);
  }));
}

/** Zustandsmarke: gut | warn | hoch | stop | leise – immer mit Wort. */
export function marke(zustand, text) {
  return h('span', { class: `wm-marke is-${zustand || 'leise'}` }, h('i', { 'aria-hidden': 'true' }), text);
}

/** Hinweiszeile im Zustand (gut | warn | hoch | stop | leise), optional ein Textknopf rechts: aktion = { text, onclick }. */
export function hinweis({ zustand = 'leise', text, ico = null, aktion = null }) {
  return h('div', { class: `wm-hinweis is-${zustand}` },
    ico ? h('span', { html: icon(ico, 20), 'aria-hidden': 'true' }) : null,
    h('span', { class: 'wm-hinweis-text', text }),
    aktion ? h('button', { type: 'button', class: 'wm-hinweis-aktion', text: aktion.text, onclick: aktion.onclick }) : null);
}

/** Chip mit Farbpunkt (farbe: CSS-Wert, z. B. 'var(--wm-slip)'); aktiv: Häkchen statt Punkt.
 *  onWahl(an) wird nach dem Umschalten gerufen; gibt sie false zurück, bleibt der Chip, wie er war. */
export function chip({ text, farbe = null, an = false, onWahl = null }) {
  const el = h('button', { type: 'button', class: 'wm-chip', 'aria-pressed': String(!!an), style: farbe ? `--punkt: ${farbe}` : null },
    h('span', { class: 'wm-chip-haken', html: icon('check', 16), 'aria-hidden': 'true' }),
    farbe ? h('span', { class: 'wm-chip-punkt', 'aria-hidden': 'true' }) : null,
    text);
  el.addEventListener('click', () => {
    const neu = el.getAttribute('aria-pressed') !== 'true';
    if (onWahl && onWahl(neu) === false) return;
    el.setAttribute('aria-pressed', String(neu));
  });
  return el;
}

/** Umschalter mit gleitender Markierung. optionen: [{ wert, text }]; onWahl(wert). */
export function seg({ optionen, wert, onWahl = null, label }) {
  const n = optionen.length;
  const el = h('div', { class: 'wm-seg', role: 'group', 'aria-label': label, style: `--n: ${n}; --i: ${Math.max(0, optionen.findIndex(o => o.wert === wert))}` },
    h('span', { class: 'wm-seg-ind', 'aria-hidden': 'true' }));
  const knoepfe = optionen.map((o, i) => h('button', { type: 'button', 'aria-pressed': String(o.wert === wert), 'data-wert': o.wert, text: o.text,
    onclick: () => {
      if (knoepfe[i].getAttribute('aria-pressed') === 'true') return;
      knoepfe.forEach((k, j) => k.setAttribute('aria-pressed', String(j === i)));
      el.style.setProperty('--i', i);
      onWahl?.(o.wert);
    } }));
  el.append(...knoepfe);
  return el;
}

// ------------------------------------------------------------------ Sheet-Rahmen

const stapel = [];            // offene Sheets, das letzte liegt oben

/** Desktop: Oberkante der Karte als --wm-sheet-oben-auto am Dokument, laufend nachgeführt (Kopfleiste, Chip-Zeile, Fenstergröße). */
let obenBeobachtet = false;
function obenMessen() {
  const karte = document.querySelector('.map-wrap'), leiste = document.querySelector('.app-header');
  const y = karte?.offsetParent ? karte.getBoundingClientRect().top : leiste ? leiste.getBoundingClientRect().bottom : 0;
  document.documentElement.style.setProperty('--wm-sheet-oben-auto', `${Math.max(0, Math.round(y))}px`);
}
function obenBeobachten() {
  obenMessen();
  if (obenBeobachtet) return;
  obenBeobachtet = true;
  if ('ResizeObserver' in window) { const ro = new ResizeObserver(obenMessen); for (const e of document.querySelectorAll('.app-header, .toolbar')) ro.observe(e); }
  window.addEventListener('resize', obenMessen);
}
const Z_BASIS = 1200;         // unter der Navigation (1500) und dem Toast (1550)
let escVerdrahtet = false;

// Zurück-Taste (Designumbau 3a): Sheets mit verlauf legen einen Verlaufseintrag { wmSheet: tiefe } an (gleiche Adresse).
// Zurück → popstate → alle Sheets mit größerer Tiefe schließen. ×/Wischen/Esc → history.back(), wenn der Eintrag noch oben liegt.
// Programmatisch geschlossene Sheets lassen ihren Eintrag liegen; das nächste Sheet derselben Tiefe übernimmt ihn (replaceState).
const tiefeImVerlauf = () => (Number.isFinite(history.state?.wmSheet) ? history.state.wmSheet : 0);
let popVerdrahtet = false;
function popVerdrahten() {
  if (popVerdrahtet) return;
  popVerdrahtet = true;
  window.addEventListener('popstate', () => {
    const t = tiefeImVerlauf();
    for (const s of [...stapel].reverse()) if (s.tiefe && s.tiefe > t) s.schliessen({ ausVerlauf: true });
  });
}
function escVerdrahten() {
  if (escVerdrahtet) return;
  escVerdrahtet = true;
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !stapel.length || document.querySelector('dialog[open]')) return;
    e.preventDefault();
    stapel[stapel.length - 1].schliessen({ durchNutzer: true });
  });
}

/**
 * Öffnet ein Sheet über der Karte. Handy: von unten mit Griff (Stufen groß/klein, Wischen, Einrasten); Desktop ≥ 768: Panel rechts.
 * Sheets stapeln sich; Esc, × und Wischen schließen das oberste, der Fokus geht an den Auslöser zurück.
 *
 * inhalt: Element(e) für den Inhalt · kopf: Element (z. B. kopf({...})) oder { titel, unter, aktion } · label: Name für Screenreader
 * stufe: 'gross' | 'klein' · klein: Höhe der Stufe „klein“ (CSS-Wert, Standard 45 %) · oben: Oberkante der Stufe „groß“ (CSS-Wert)
 * opener: Element, das danach den Fokus bekommt (Standard: das aktive Element beim Öffnen) · onZu: nach dem Schließen · klasse: Zusatzklasse
 * inhaltFuer(stufe): optional – eigener Inhalt je Stufe (z. B. Pegel: klein = Kurzansicht, groß = Details). Beim Hochziehen aus „klein“
 *   wird schon zu Beginn der Bewegung der große Inhalt gezeigt (kein leeres Blatt), federt es zurück, wieder der kleine.
 * onStufe(stufe): nach jedem Stufenwechsel.
 * verlauf: true → eigener Eintrag im Browserverlauf, die Zurück-Taste schließt das Sheet (für Sheets ohne eigene Adresse;
 *   Bereiche mit Adresse wie #meldungen regelt main.js über den Hash).
 * onZu(info): nach dem Ausfahren; info.durchNutzer = ×, Wischen, Esc oder Zurück-Taste (nicht programmatisch).
 * onSchliessen(info): sofort beim Schließen (z. B. Navigation und Adresse umstellen, ohne das Ausfahren abzuwarten).
 * Rückgabe: { el, inhalt, schliessen(), stufe(neu?), setzeInhalt(…), setzeKopf(angaben|Element) }
 */
export function sheetOeffnen({ inhalt = [], kopf: k = null, label = null, stufe = 'gross', klein = null, oben = null, opener = null, onZu = null, klasse = '', inhaltFuer = null, onStufe = null, verlauf = false, onSchliessen = null }) {
  escVerdrahten();
  const ausloeser = opener || document.activeElement;
  const s = { offen: true, aktuell: stufe, gezeigt: null, inhaltFuer, tiefe: 0 };
  if (verlauf) {
    popVerdrahten();
    s.tiefe = stapel.filter(x => x.tiefe).length + 1;
    const zustand = { ...(history.state || {}), wmSheet: s.tiefe };
    if (tiefeImVerlauf() >= s.tiefe) history.replaceState(zustand, ''); else history.pushState(zustand, '');
  }
  const body = h('div', { class: 'wm-sheet-inhalt' }, inhalt);
  // Kopf als Angaben → hier gebaut, × schließt; als fertiges Element ohne × → × wird angehängt (mit × → bleibt beim Aufrufer)
  const kopfEl = k && !k.nodeType ? kopf({ ...k, onZu: () => s.schliessen({ durchNutzer: true }) }) : k;
  if (k?.nodeType && !k.querySelector('.wm-zu')) k.append(h('button', { type: 'button', class: 'wm-rund wm-zu', 'aria-label': 'Schließen', html: icon('close', 20), onclick: () => s.schliessen({ durchNutzer: true }) }));
  const titel = kopfEl?.querySelector('.wm-kopf-titel');
  const griff = h('button', { type: 'button', class: 'wm-griff', 'aria-label': 'Größe ändern', 'aria-expanded': String(stufe === 'gross'),
    onclick: () => s.stufe(s.aktuell === 'gross' ? 'klein' : 'gross') }, h('span', {}));
  const el = h('section', { class: `wm-sheet ${klasse}`.trim(), role: 'dialog', 'aria-modal': 'false', tabindex: '-1',
    'aria-labelledby': !label && titel ? titel.id : null, 'aria-label': label }, griff, kopfEl, body);
  if (klein) el.style.setProperty('--wm-sheet-klein', klein);
  // Desktop: Panel beginnt an der Oberkante der Karte (unter Kopfleiste und Chip-Zeile) – folgt ihr, wenn die Chip-Zeile umbricht
  if (!oben) obenBeobachten();
  if (oben) el.style.setProperty('--wm-sheet-oben', oben);
  el.style.zIndex = String(Z_BASIS + stapel.length * 2);
  el.classList.toggle('is-klein', stufe === 'klein');
  document.body.append(el);
  stapel.push(s);
  stapelMelden();

  // einfahren: erst im nächsten Bild die Klasse setzen, damit der Übergang läuft
  void el.offsetHeight;
  el.classList.add('is-offen');
  (titel || el).focus({ preventScroll: true });

  const inhaltEin = () => { body.classList.remove('is-neu'); void body.offsetWidth; body.classList.add('is-neu'); };   // Designumbau 4: 14 px von unten
  inhaltEin();
  Object.assign(s, {
    el, inhalt: body,
    setzeInhalt(...knoten) { body.replaceChildren(...knoten); body.scrollTop = 0; },
    /** wie setzeInhalt, aber mit Überblenden (anderer Ort im offenen Sheet). */
    wechsleInhalt(...knoten) { s.setzeInhalt(...knoten); inhaltEin(); },
    /** Inhalt der Stufe zeigen (nur mit inhaltFuer); erneut: neu aufbauen (z. B. anderer Pegel). */
    zeigeInhalt(stufe, neu = false) {
      if (!s.inhaltFuer || (!neu && s.gezeigt === stufe)) return;
      s.gezeigt = stufe;
      const n = s.inhaltFuer(stufe);
      s.wechsleInhalt(...(Array.isArray(n) ? n : [n]));
    },
    /** Kopf ersetzen (Angaben → kopf() mit ×, oder fertiges Element). */
    setzeKopf(neu) {
      const alt = el.querySelector(':scope > .wm-kopf');
      const n = neu && !neu.nodeType ? kopf({ ...neu, onZu: () => s.schliessen({ durchNutzer: true }) }) : neu;
      if (alt && n) alt.replaceWith(n); else if (n) griff.after(n);
      const t = n?.querySelector('.wm-kopf-titel');
      if (t && !label) el.setAttribute('aria-labelledby', t.id);
    },
    stufe(neu) {
      if (neu === undefined) return s.aktuell;
      const anders = neu !== s.aktuell;
      s.aktuell = neu;
      el.classList.toggle('is-klein', neu === 'klein');
      griff.setAttribute('aria-expanded', String(neu === 'gross'));
      s.zeigeInhalt(neu);
      if (anders) onStufe?.(neu);
      return neu;
    },
    schliessen({ durchNutzer = false, ausVerlauf = false } = {}) {
      if (!s.offen) return;
      s.offen = false;
      const i = stapel.indexOf(s); if (i >= 0) stapel.splice(i, 1);
      stapelMelden();
      // vom Nutzer geschlossen: den eigenen Verlaufseintrag zurücknehmen (die Zurück-Taste hat das schon getan)
      if (s.tiefe && durchNutzer && !ausVerlauf && tiefeImVerlauf() === s.tiefe) history.back();
      onSchliessen?.({ durchNutzer: durchNutzer || ausVerlauf });
      el.style.transform = ''; el.style.transition = '';
      el.classList.remove('is-offen');
      const weg = () => {
        el.remove();
        if (ausloeser && document.contains(ausloeser)) ausloeser.focus({ preventScroll: true });
        onZu?.({ durchNutzer: durchNutzer || ausVerlauf });
      };
      nachUebergang(el, weg);
    },
  });
  // Stufe einmal über die Funktion setzen (aria-expanded des Griffs, Inhalt der Stufe)
  s.stufe(stufe);
  wischen(el, body, s);
  return s;
}

/** fn nach dem Ende des transform-Übergangs von el (nur el selbst, nicht Kinder); spätestens nach 480 ms; bei „Bewegung reduzieren“ sofort. */
function nachUebergang(el, fn) {
  if (ruhig()) { fn(); return; }
  let fertig = false;
  const f = (e) => { if (e && e.target !== el) return; if (fertig) return; fertig = true; el.removeEventListener('transitionend', f); fn(); };
  el.addEventListener('transitionend', f);
  setTimeout(() => f(), 480);
}

/** body.has-sheet, solange ein Sheet offen ist (Desktop: Standort-Knopf und Kartenknöpfe rücken links neben das Panel). */
function stapelMelden() { document.body.classList.toggle('has-sheet', stapel.length > 0); }

/** Offene Sheets (oberstes zuletzt) – für Tests und für das Routing in Phase 3. */
export const offeneSheets = () => stapel.map(s => s.el);

/**
 * Wischen am Sheet (Handy): folgt dem Finger (nur transform) und rastet ein – groß, klein oder zu.
 * Gezogen wird am Griff oder überall, solange der Inhalt ganz oben steht (sonst gehört die Bewegung dem Scrollen).
 * Wie im Pegel-Sheet (7.54–7.57): Bewegung und Ende hängen am berührten Element.
 */
function wischen(el, body, s) {
  let z = null, beruehrt = null;
  const NICHT = 'input, textarea, select, .wm-seg, .gc, .gc-wrap, [data-no-swipe]';
  const loesen = () => { if (!beruehrt) return; beruehrt.removeEventListener('touchmove', bewegen); beruehrt.removeEventListener('touchend', beenden); beruehrt.removeEventListener('touchcancel', abbrechen); beruehrt = null; };
  /** y-Lage einer Stufe (0 = groß) */
  const lage = (stufe) => {
    const H = el.offsetHeight;
    if (stufe === 'zu') return H;
    if (stufe === 'klein') { const k = getComputedStyle(el).getPropertyValue('--wm-sheet-klein').trim() || '45%'; return Math.max(0, H - (k.endsWith('%') ? H * parseFloat(k) / 100 : parseFloat(k))); }
    return 0;
  };
  el.addEventListener('touchstart', (e) => {
    z = null; loesen();
    if (!mobil() || !s.offen || e.touches.length !== 1 || e.target.closest(NICHT)) return;
    if (body.scrollTop > 0 && !e.target.closest('.wm-griff')) return;
    z = { y0: e.touches[0].clientY, x0: e.touches[0].clientX, basis: lage(s.aktuell), dy: 0, t: e.timeStamp, v: 0, aktiv: false };
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
      if (dy < 0 && s.aktuell === 'gross') { z = null; loesen(); return; }          // groß: nach oben gehört dem Scrollen
      if (dy > 0 && body.scrollTop > 0 && !e.target.closest('.wm-griff')) { z = null; loesen(); return; }
      z.aktiv = true;
      el.style.transition = 'none';
      if (dy < 0 && s.aktuell === 'klein') s.zeigeInhalt('gross');   // Details schon beim Hochziehen zeigen
    }
    if (e.cancelable) e.preventDefault();
    z.v = (dy - z.dy) / Math.max(1, e.timeStamp - z.t); z.dy = dy; z.t = e.timeStamp;
    el.style.transform = `translate3d(0, ${Math.max(0, z.basis + dy)}px, 0)`;
  }
  function beenden() { ende(false); }
  function abbrechen() { ende(true); }
  function ende(abbruch) {
    const a = z; z = null; loesen();
    if (!a || !a.aktiv) return;
    const y = Math.max(0, a.basis + a.dy), schnell = Math.abs(a.v) > 0.5;
    const stufen = { gross: lage('gross'), klein: lage('klein'), zu: lage('zu') };
    let ziel;
    if (abbruch) ziel = s.aktuell;
    else if (schnell) ziel = a.v < 0 ? 'gross' : (s.aktuell === 'gross' && y < stufen.klein ? 'klein' : 'zu');
    else ziel = Object.entries(stufen).reduce((b, k) => (Math.abs(k[1] - y) < Math.abs(b[1] - y) ? k : b))[0];
    // von der Fingerlage weich in die Zielstufe: Übergang aus der Klasse, Inline-Lage danach entfernen (kein Sprung)
    el.style.transition = '';
    if (ziel === 'zu') { s.schliessen({ durchNutzer: true }); return; }
    el.style.transform = `translate3d(0, ${stufen[ziel]}px, 0)`;
    s.stufe(ziel);
    s.zeigeInhalt(ziel);   // zurückgefedert: wieder der passende Inhalt
    const aufraeumen = () => { el.style.transition = 'none'; el.style.transform = ''; void el.offsetHeight; el.style.transition = ''; };
    nachUebergang(el, aufraeumen);
  }
}

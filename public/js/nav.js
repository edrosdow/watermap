// Hauptnavigation (Karte · Pegel · Melden · Meldungen · Mehr) – oben auf dem Desktop, unten auf dem Handy.
// „In der Nähe“ und die Favoriten (Merkliste) liegen unter „Mehr“; ihre Adressen (#naehe, #favoriten) gelten weiter.
// Wird von der Karte (main.js) und der Pegel-Ampel (ampel.js) genutzt.
import { h } from './dom.js';
import { icon } from './icons.js';
import { CONFIG } from './config.js';

/** Ziele; `href` gilt von jeder Seite aus (die Karte fängt die Klicks ab und schaltet ohne Neuladen um). */
export const NAV = [
  { id: 'karte', label: 'Karte', top: 'Karte', ico: 'map', href: './#karte' },
  { id: 'pegel', label: 'Pegel', top: 'Pegel', ico: 'gauge', href: './#pegel' },
  { id: 'melden', label: 'Melden', ico: 'plus', href: './#melden', center: true },
  { id: 'meldungen', label: 'Meldungen', top: 'Meldungen', ico: 'chat', href: './#meldungen' },
  { id: 'mehr', label: 'Mehr', top: 'Mehr', ico: 'menu', href: './#mehr' },
];
/** Bereiche ohne eigenen Navigationspunkt: welcher Punkt dabei hervorgehoben wird. */
export const NAV_ZIEL = { naehe: 'mehr', favoriten: 'mehr' };

const LS_LABELS = 'wm-nav-labels-gesehen';   // die Beschriftungen wurden beim ersten Start schon gezeigt
const LANGDRUCK_MS = 400;
const reduziert = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Text der Zahl am Abzeichen („99+“ statt riesiger Zahlen). */
export const badgeText = (n) => (n > 99 ? '99+' : String(n));
/** Beschriftung eines Navigationspunkts für Screenreader, z. B. „Meldungen, 3 neu“. */
export const navLabel = (item, badge = 0) => (badge > 0 ? `${item.label}, ${badge > 99 ? 'über 99' : badge} neu` : item.label);

/**
 * Navigation in die Seite einhängen. active: 'karte' | 'pegel' | 'meldungen' | 'mehr' (oder ein Bereich aus NAV_ZIEL)
 * onSelect(id, event) – optional; gibt true zurück, wenn der Klick ohne Seitenwechsel erledigt wurde.
 * Unten (Handy): schwebende Glas-Leiste nur mit Symbolen; eine gemeinsame Markierung wandert zum aktiven Punkt.
 */
export function mountNav({ top, bottom, active, onSelect, reportLink = false }) {
  let langDruck = false;   // der Klick nach einem langen Drücken soll nichts auslösen
  const click = (item) => (e) => {
    if (langDruck) { langDruck = false; e.preventDefault(); return; }
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;   // neuer Tab bleibt möglich
    if (item.center) plop(item.id);
    if (onSelect && onSelect(item.id, e)) e.preventDefault();
  };
  if (top) {
    top.replaceChildren(...NAV.filter(n => !n.center).map(n => h('a', { class: 'tn-item', href: n.href, dataset: { nav: n.id }, onclick: click(n) },
      h('span', { class: 'tn-ico', html: icon(n.ico, 20) }), h('span', { text: n.top }))));
    // Auf Unterseiten (Pegel-Ampel) führt „+ Melden“ zur Karte und öffnet dort die Auswahl
    if (reportLink) top.append(h('a', { class: 'report-btn', href: './#melden' }, h('span', { html: icon('plus', 20) }), h('span', { text: 'Melden' })));
  }

  const ind = h('span', { class: 'bn-ind', 'aria-hidden': 'true' });
  const platz = (id) => bottom?.querySelector(`.bn-item[data-nav="${id}"]`);
  if (bottom) {
    bottom.replaceChildren(ind, ...NAV.map(n => h('a', { class: 'bn-item' + (n.center ? ' bn-center' : ''), href: n.href, dataset: { nav: n.id }, 'aria-label': n.label,
      'aria-haspopup': n.center ? 'dialog' : null, onclick: click(n) },
      n.center ? h('span', { class: 'bn-plus', html: icon('plus', 28) }) : h('span', { class: 'bn-ico', html: icon(n.ico, 26) }),
      n.id === 'meldungen' ? h('span', { class: 'nav-badge', hidden: true, 'aria-hidden': 'true' }) : null)));
  }

  // ---- Markierung: Maße aus den echten Plätzen (relativ zur Leiste)
  const maße = (id) => {
    const a = id && platz(id);
    if (!a || !a.offsetWidth) return null;
    const nr = bottom.getBoundingClientRect(), r = a.getBoundingClientRect();
    const w = Math.round((r.width - 6) * 10) / 10;   // 3 px Luft je Seite, wie im Entwurf
    return { left: Math.round((r.left - nr.left - bottom.clientLeft + (r.width - w) / 2) * 10) / 10, width: w };
  };
  let aktuell = null, ziel = null, timer = 0;
  const setzen = (m, { dauer = 0, easing = 'ease', sy = 1 } = {}) => {
    ind.style.transition = dauer ? `left ${dauer}ms ${easing}, width ${dauer}ms ${easing}, transform ${dauer}ms ease, opacity 120ms linear` : 'none';
    ind.style.left = `${m.left}px`; ind.style.width = `${m.width}px`; ind.style.transform = sy === 1 ? '' : `scaleY(${sy})`; ind.style.opacity = '1';
  };
  function marke(id, animiert) {
    if (!bottom) return;
    clearTimeout(timer);
    const m = id === 'melden' ? null : maße(id);
    if (!m) { ind.style.opacity = '0'; ziel = null; return; }
    const von = ziel; ziel = m;
    if (!animiert || !von) { setzen(m); void ind.offsetWidth; return; }   // erster Aufruf / Seitenaufbau: sofort
    if (reduziert()) { setzen(m, { dauer: 120, easing: 'linear' }); return; }
    const ms = CONFIG.NAV_ANIM_MS, feder = 'cubic-bezier(.34, 1.45, .64, 1)';
    if (!CONFIG.NAV_DEHNEN) { setzen(m, { dauer: ms, easing: feder }); return; }
    // Phase 1 (erste ~45 %): vom alten bis zum neuen Platz dehnen und etwas flacher werden; Phase 2: auf den neuen Platz zusammenziehen
    const l = Math.min(von.left, m.left), r = Math.max(von.left + von.width, m.left + m.width);
    setzen({ left: l, width: r - l }, { dauer: ms, easing: feder, sy: 0.88 });
    timer = setTimeout(() => setzen(m, { dauer: ms, easing: feder }), Math.round(ms * 0.45));
  }
  function plop(id) {   // das Symbol ploppt kurz
    const a = platz(id);
    if (!a || reduziert()) return;
    a.classList.add('is-plop');
    setTimeout(() => a.classList.remove('is-plop'), 220);
  }
  if (bottom) {
    const neu = () => marke(aktuell, false);
    if ('ResizeObserver' in window) new ResizeObserver(neu).observe(bottom); else window.addEventListener('resize', neu);
    window.addEventListener('orientationchange', () => setTimeout(neu, 200));
  }

  // ---- Beschriftung als Blase: langes Drücken, beim ersten Start einmalig alle
  const blase = (a) => {
    const t = h('span', { class: 'bn-tip', 'aria-hidden': 'true', text: NAV.find(n => n.id === a.dataset.nav).label });
    a.append(t);
    return t;
  };
  if (bottom) {
    let lp = 0, tip = null, x0 = 0, y0 = 0;
    const ende = () => { clearTimeout(lp); if (tip) { const t = tip; tip = null; setTimeout(() => t.remove(), 900); } };
    bottom.addEventListener('pointerdown', (e) => {
      const a = e.target.closest('.bn-item');
      if (!a) return;
      x0 = e.clientX; y0 = e.clientY; langDruck = false; clearTimeout(lp);
      lp = setTimeout(() => { langDruck = true; tip = blase(a); }, LANGDRUCK_MS);
    });
    bottom.addEventListener('pointermove', (e) => { if (!tip && Math.hypot(e.clientX - x0, e.clientY - y0) > 10) clearTimeout(lp); });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) bottom.addEventListener(ev, ende);
    bottom.addEventListener('contextmenu', (e) => e.preventDefault());   // kein Link-Menü beim langen Drücken
    // Erster Start: alle fünf Beschriftungen ca. 3 Sekunden zeigen, danach gemerkt
    let gesehen = false;
    try { gesehen = localStorage.getItem(LS_LABELS) === '1'; } catch { /* ohne Speicher: jedes Mal */ }
    if (!gesehen) setTimeout(() => {
      if (!bottom.offsetWidth || document.hidden) return;
      const tips = [...bottom.querySelectorAll('.bn-item')].map(blase);
      try { localStorage.setItem(LS_LABELS, '1'); } catch { /* egal */ }
      setTimeout(() => tips.forEach(t => t.remove()), 3000);
    }, 900);
  }

  // ---- Tastatur offen (Eingabefeld hat Fokus oder die sichtbare Höhe schrumpft stark): Leiste ausblenden
  if (bottom) {
    let maxH = window.innerHeight, breite = window.innerWidth;
    const tastatur = () => {
      if (window.innerWidth !== breite) { breite = window.innerWidth; maxH = window.innerHeight; }   // Drehen: neu messen
      maxH = Math.max(maxH, window.innerHeight);
      const f = document.activeElement;
      const feld = !!f && (f.tagName === 'TEXTAREA' || f.isContentEditable
        || (f.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|reset|file|range|color|image)$/.test(f.type)));
      const vv = window.visualViewport;
      return feld || (!!vv && vv.height < maxH * 0.75);
    };
    const pruefen = () => bottom.classList.toggle('is-weg', tastatur());
    document.addEventListener('focusin', pruefen);
    document.addEventListener('focusout', () => setTimeout(pruefen, 60));
    window.visualViewport?.addEventListener('resize', pruefen);
  }

  const api = {
    /** sofort: ohne Animation (Seitenaufbau, Adresse beim Start). */
    setActive(bereich, { sofort = false } = {}) {
      const id = NAV_ZIEL[bereich] || bereich;
      for (const root of [top, bottom]) {
        if (!root) continue;
        for (const a of root.querySelectorAll('[data-nav]')) {
          const on = a.dataset.nav === id;
          a.classList.toggle('is-active', on);
          if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
        }
      }
      if (bottom) {
        const erster = aktuell === null, gewechselt = id !== aktuell;
        aktuell = id;
        if (gewechselt) { const anim = !erster && !sofort; marke(id, anim); if (anim) plop(id); }
      }
    },
    /** Zahl am Punkt (z. B. neue Meldungen); 0 blendet das Abzeichen aus. */
    setBadge(id, n) {
      const a = platz(id), b = a?.querySelector('.nav-badge');
      if (!b) return;
      const zahl = Math.max(0, Math.floor(Number(n) || 0));
      b.hidden = !zahl; b.textContent = zahl ? badgeText(zahl) : '';
      a.setAttribute('aria-label', navLabel(NAV.find(x => x.id === id), zahl));
    },
  };
  api.setActive(active);
  return api;
}

/**
 * Kleines Fenster: auf dem Handy Bottom-Sheet (modal, Wischen nach unten schließt),
 * auf dem Desktop Dropdown unter dem Auslöser (Klick außerhalb / Escape schließt).
 * Fokus geht beim Öffnen hinein und beim Schließen zurück zum Auslöser.
 */
export function popover(dialog, { isMobile, align = 'left' }) {
  let trigger = null;
  const onDoc = (e) => {
    // composedPath: gilt auch, wenn ein Klick-Handler das angeklickte Element schon ersetzt hat
    const pfad = e.composedPath();
    if (!dialog.open || pfad.includes(dialog) || (trigger && pfad.includes(trigger))) return;
    close();
  };
  const onKey = (e) => { if (e.key === 'Escape' && dialog.open) { e.preventDefault(); close(); } };
  function place() {
    if (isMobile() || !trigger) { dialog.style.top = dialog.style.left = dialog.style.right = ''; return; }
    const r = trigger.getBoundingClientRect();
    const w = dialog.offsetWidth || 380;
    const want = align === 'right' ? r.right - w : r.left;
    dialog.style.top = `${Math.round(r.bottom + 8)}px`;
    dialog.style.left = `${Math.round(Math.max(12, Math.min(want, window.innerWidth - w - 12)))}px`;
    dialog.style.right = 'auto';
  }
  function open(from) {
    trigger = from || document.activeElement;
    const mobile = isMobile();
    dialog.classList.toggle('is-sheet', mobile);
    dialog.classList.toggle('is-drop', !mobile);
    if (dialog.open) dialog.close();
    if (mobile) dialog.showModal(); else { dialog.show(); place(); }
    trigger?.setAttribute('aria-expanded', 'true');
    (dialog.querySelector('[data-autofocus]') || dialog.querySelector('button, a, input'))?.focus({ preventScroll: true });
    setTimeout(() => document.addEventListener('click', onDoc), 0);
    document.addEventListener('keydown', onKey);
  }
  function close() {
    if (!dialog.open) return;
    dialog.close();
  }
  dialog.addEventListener('close', () => {
    document.removeEventListener('click', onDoc);
    document.removeEventListener('keydown', onKey);
    trigger?.setAttribute('aria-expanded', 'false');
    if (trigger && document.contains(trigger)) trigger.focus({ preventScroll: true });
  });
  // Modal: Klick auf den abgedunkelten Rand schließt
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
  swipeToClose(dialog, close, () => dialog.classList.contains('is-sheet'));
  window.addEventListener('resize', () => { if (dialog.open && !isMobile()) place(); });
  return { open, close, toggle: (from) => (dialog.open ? close() : open(from)), get isOpen() { return dialog.open; } };
}

/** Wischen nach unten schließt ein Sheet (nur, wenn sein Inhalt ganz oben steht). */
export function swipeToClose(el, close, enabled = () => true) {
  let y0 = null, dy = 0;
  el.addEventListener('touchstart', (e) => {
    const scroller = e.target.closest('.sheet-scroll');
    y0 = enabled() && (!scroller || scroller.scrollTop <= 0) ? e.touches[0].clientY : null; dy = 0;
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (y0 === null) return;
    dy = e.touches[0].clientY - y0;
    if (dy > 0) el.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  el.addEventListener('touchend', () => {
    if (y0 === null) return;
    el.style.transform = '';
    if (dy > 70) close();
    y0 = null;
  });
}

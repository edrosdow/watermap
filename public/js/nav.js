// Hauptnavigation (Karte · Pegel · Melden · Meldungen · Mehr) – oben auf dem Desktop, unten auf dem Handy.
// „In der Nähe“ und die Favoriten (Merkliste) liegen unter „Mehr“; ihre Adressen (#naehe, #favoriten) gelten weiter.
// Wird von der Karte (main.js) und der Pegel-Ampel (ampel.js) genutzt.
import { h } from './dom.js';
import { icon } from './icons.js';

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

/**
 * Navigation in die Seite einhängen. active: 'karte' | 'pegel' | 'meldungen' | 'mehr' (oder ein Bereich aus NAV_ZIEL)
 * onSelect(id, event) – optional; gibt true zurück, wenn der Klick ohne Seitenwechsel erledigt wurde.
 */
export function mountNav({ top, bottom, active, onSelect, reportLink = false }) {
  const click = (item) => (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;   // neuer Tab bleibt möglich
    if (onSelect && onSelect(item.id, e)) e.preventDefault();
  };
  if (top) {
    top.replaceChildren(...NAV.filter(n => !n.center).map(n => h('a', { class: 'tn-item', href: n.href, dataset: { nav: n.id }, onclick: click(n) },
      h('span', { class: 'tn-ico', html: icon(n.ico, 20) }), h('span', { text: n.top }))));
    // Auf Unterseiten (Pegel-Ampel) führt „+ Melden“ zur Karte und öffnet dort die Auswahl
    if (reportLink) top.append(h('a', { class: 'report-btn', href: './#melden' }, h('span', { html: icon('plus', 20) }), h('span', { text: 'Melden' })));
  }
  if (bottom) {
    bottom.replaceChildren(...NAV.map(n => n.center
      ? h('a', { class: 'bn-item bn-center', href: n.href, dataset: { nav: n.id }, onclick: click(n), 'aria-haspopup': 'dialog' },
        h('span', { class: 'bn-plus', html: icon('plus', 28) }), h('span', { class: 'bn-label', text: n.label }))
      : h('a', { class: 'bn-item', href: n.href, dataset: { nav: n.id }, onclick: click(n) },
        h('span', { class: 'bn-ico', html: icon(n.ico, 24) }), h('span', { class: 'bn-label', text: n.label }))));
  }
  const api = {
    setActive(bereich) {
      const id = NAV_ZIEL[bereich] || bereich;
      for (const root of [top, bottom]) {
        if (!root) continue;
        for (const a of root.querySelectorAll('[data-nav]')) {
          const on = a.dataset.nav === id;
          a.classList.toggle('is-active', on);
          if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
        }
      }
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

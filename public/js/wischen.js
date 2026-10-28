// Wischen nach unten schließt jedes Fenster, das auf dem Handy von unten aufgeht (Dialoge, Standort-Blatt und -Vorschau).
// Ein gemeinsamer Handler am Dokument: kein Verdrahten pro Fenster, neue Fenster funktionieren automatisch.
const SCHWELLE = 10;       // px, ab hier gilt die Bewegung als Wischen
const WEIT = 110;          // px Weg, ab dem losgelassen wird → schließen
const SCHNELL = 0.6;       // px/ms Schwung, ab dem schon ein kurzer Weg (> 40 px) schließt
const NICHT = 'input, textarea, select, .gc, .leaflet-container, [data-no-swipe]';

/**
 * schliessen: Funktionen für Fenster, die keine <dialog> sind: { '#detail': fn, '#peek': fn }.
 * mobil: () => boolean (Handy-Breite).
 */
export function wischenZuMachen({ schliessen = {}, mobil = () => window.innerWidth < 768 } = {}) {
  let s = null;   // { el, y0, x0, dy, t, v, aktiv, zu }

  const ziel = (t) => {
    const dlg = t.closest('dialog[open]');
    if (dlg) {
      if (dlg.classList.contains('lightbox')) return null;
      const r = dlg.getBoundingClientRect(), vh = window.visualViewport?.height || window.innerHeight;
      // nur Blätter, die unten am Rand sitzen und nicht den ganzen Bildschirm füllen
      if (r.bottom < vh - 2 || r.top < 24 || r.width < window.innerWidth - 2) return null;
      return { el: dlg, zu: () => {
        const ev = new Event('cancel', { cancelable: true });
        dlg.dispatchEvent(ev);
        if (ev.defaultPrevented) return false;
        dlg.close(); return true;
      } };
    }
    for (const [sel, fn] of Object.entries(schliessen)) {
      const el = t.closest(sel);
      if (el && !el.hidden) return { el, zu: () => { fn(); return true; } };
    }
    return null;
  };

  /** Scrollt innerhalb des Fensters etwas, das nicht ganz oben steht, gehört die Bewegung dem Scrollen. */
  const obenAngekommen = (t, wurzel) => {
    for (let e = t; e && e !== wurzel.parentElement; e = e.parentElement) {
      const o = getComputedStyle(e).overflowY;
      if ((o === 'auto' || o === 'scroll') && e.scrollHeight > e.clientHeight && e.scrollTop > 0) return false;
    }
    return true;
  };

  document.addEventListener('touchstart', (e) => {
    s = null;
    if (!mobil() || e.touches.length !== 1 || e.target.closest(NICHT)) return;
    const z = ziel(e.target);
    if (!z || !obenAngekommen(e.target, z.el)) return;
    const t = e.touches[0];
    s = { ...z, x0: t.clientX, y0: t.clientY, dy: 0, t: e.timeStamp, v: 0, aktiv: false };
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!s) return;
    const t = e.touches[0], dx = t.clientX - s.x0, dy = t.clientY - s.y0;
    if (!s.aktiv) {
      if (dy < -SCHWELLE || Math.abs(dx) > SCHWELLE && Math.abs(dx) > Math.abs(dy)) { s = null; return; }   // hoch/seitwärts: nicht unser Wischen
      if (dy < SCHWELLE) return;
      if (!obenAngekommen(e.target, s.el)) { s = null; return; }
      s.aktiv = true; s.el.style.transition = 'none';
    }
    if (e.cancelable) e.preventDefault();
    const d = Math.max(0, dy - SCHWELLE);
    s.v = (d - s.dy) / Math.max(1, e.timeStamp - s.t); s.dy = d; s.t = e.timeStamp;
    s.el.style.transform = `translateY(${d}px)`;
  }, { passive: false });

  const ende = (abbruch) => {
    const a = s; s = null;
    if (!a || !a.aktiv) return;
    const { el } = a, reset = () => { el.style.transition = ''; el.style.transform = ''; };
    if (abbruch || !(a.dy > WEIT || a.v > SCHNELL && a.dy > 40)) {   // zurückfedern
      el.style.transition = 'transform .2s ease'; el.style.transform = 'translateY(0)';
      setTimeout(reset, 220); return;
    }
    el.style.transition = 'transform .18s ease-in';
    el.style.transform = `translateY(${el.getBoundingClientRect().height + 40}px)`;
    setTimeout(() => {
      if (!a.zu()) { el.style.transition = 'transform .2s ease'; el.style.transform = 'translateY(0)'; setTimeout(reset, 220); return; }
      reset();
    }, 180);
  };
  document.addEventListener('touchend', () => ende(false));
  document.addEventListener('touchcancel', () => ende(true));
}

// Wischen nach unten schließt jedes Fenster, das auf dem Handy von unten aufgeht (Dialoge, Standort-Blatt und -Vorschau).
// Ein gemeinsamer Handler am Dokument: kein Verdrahten pro Fenster, neue Fenster funktionieren automatisch.
const SCHWELLE = 10;       // px, ab hier gilt die Bewegung als Wischen
const WEIT = 110;          // px Weg, ab dem losgelassen wird → schließen
const SCHNELL = 0.6;       // px/ms Schwung, ab dem schon ein kurzer Weg (> 40 px) schließt
const NICHT = 'input, textarea, select, .gc, .leaflet-container, [data-no-swipe]';

/**
 * schliessen: Fenster, die keine <dialog> sind: { selektor: fn | { zu: fn, wenn: () => boolean, mit: () => [Element] } } (wenn: nur dann ist das Fenster eines; mit: weitere Teile, die mitwandern).
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
      return { el: dlg, mit: [], zu: () => {
        const ev = new Event('cancel', { cancelable: true });
        dlg.dispatchEvent(ev);
        if (ev.defaultPrevented) return false;
        dlg.close(); return true;
      } };
    }
    for (const [sel, v] of Object.entries(schliessen)) {
      const el = t.closest(sel), fn = v.zu || v;
      if (el && !el.hidden && (!v.wenn || v.wenn())) return { el, mit: v.mit ? v.mit() : [], zu: () => { fn(); return true; } };
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
      s.aktiv = true; alle().forEach(e => { e.style.transition = 'none'; });
    }
    if (e.cancelable) e.preventDefault();
    const d = Math.max(0, dy - SCHWELLE);
    s.v = (d - s.dy) / Math.max(1, e.timeStamp - s.t); s.dy = d; s.t = e.timeStamp;
    alle().forEach(e => { e.style.transform = `translateY(${d}px)`; });
  }, { passive: false });

  const alle = () => [s.el, ...s.mit];
  const ende = (abbruch) => {
    const a = s; s = null;
    if (!a || !a.aktiv) return;
    const teile = [a.el, ...a.mit];
    const setze = (transition, transform) => teile.forEach((e) => { e.style.transition = transition; e.style.transform = transform; });
    const reset = () => setze('', '');
    const zurueck = () => { setze('transform .2s ease', 'translateY(0)'); setTimeout(reset, 220); };
    if (abbruch || !(a.dy > WEIT || a.v > SCHNELL && a.dy > 40)) { zurueck(); return; }
    setze('transform .18s ease-in', `translateY(${window.innerHeight}px)`);
    setTimeout(() => { if (!a.zu()) { zurueck(); return; } reset(); }, 180);
  };
  document.addEventListener('touchend', () => ende(false));
  document.addEventListener('touchcancel', () => ende(true));
}

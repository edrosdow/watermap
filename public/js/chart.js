// Kleine Helfer für die eigenen SVG-Diagramme (Pegel, Wetter). Keine Bibliothek.
export const SVGNS = 'http://www.w3.org/2000/svg';

/** SVG-Element mit Attributen. */
export const s = (tag, attrs = {}) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };

/** SVG-Text. */
export const sText = (text, attrs) => { const e = s('text', attrs); e.textContent = text; return e; };

/** „Runde“ Schrittweite für Achsenbeschriftungen (1, 2, 5 × 10^n). */
export function niceStep(range, target = 4) {
  const raw = range / target, mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag;
}

export const fmtNum = (v) => Math.round(v).toLocaleString('de-DE');

/**
 * Fadenkreuz per Maus und Finger. Maus: folgt dem Zeiger. Finger: Antippen zeigt den Wert (bleibt stehen),
 * kurz gedrückt halten oder seitlich ziehen fährt die Kurve ab – die Seite scrollt dabei nicht; senkrechtes Wischen
 * scrollt wie gewohnt. zeigen(clientX), verstecken().
 */
export function abfahren(el, { zeigen, verstecken }) {
  el.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') zeigen(e.clientX); });
  el.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') zeigen(e.clientX); });
  el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') verstecken(); });
  let x0 = 0, y0 = 0, aktiv = false, bewegt = false, timer = null;
  el.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; aktiv = false; bewegt = false;
    clearTimeout(timer);
    timer = setTimeout(() => { aktiv = true; zeigen(x0); }, 180);   // gedrückt halten
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    const t = e.touches[0], dx = Math.abs(t.clientX - x0), dy = Math.abs(t.clientY - y0);
    if (!aktiv) {
      if (dx < 6 && dy < 6) return;
      bewegt = true; clearTimeout(timer);
      if (dy >= dx) return;   // senkrecht: Seite scrollt
      aktiv = true;           // seitlich: abfahren
    }
    e.preventDefault();
    zeigen(t.clientX);
  }, { passive: false });
  el.addEventListener('touchend', () => {
    clearTimeout(timer);
    if (!aktiv && !bewegt) zeigen(x0);   // Antippen
    aktiv = false;
  });
  el.addEventListener('touchcancel', () => { clearTimeout(timer); aktiv = false; });
}

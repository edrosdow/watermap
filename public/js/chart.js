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

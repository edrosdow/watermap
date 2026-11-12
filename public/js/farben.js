// Farben aus tokens.css für Stellen, die keinen CSS-Wert verstehen (Canvas, Leaflet-Pfade): zur Laufzeit gelesen,
// damit es nur eine Quelle gibt. Im DOM (SVG, Stile) direkt var(--wm-…) verwenden. Geprüft von tests/design_tokens_test.mjs.
export const tok = (name) => (typeof document !== 'undefined' && getComputedStyle(document.documentElement).getPropertyValue(name).trim()) || 'currentColor';

/** SVG-Attribute fill/stroke mit var(--…) als style setzen (Präsentationsattribute verstehen var() nicht in jedem Browser). */
export function svgFarbe(el, k, v) {
  if ((k === 'fill' || k === 'stroke') && typeof v === 'string' && v.startsWith('var(')) { el.style.setProperty(k, v); return true; }
  return false;
}

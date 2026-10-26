// Alle Symbole als SVG-Text. Es werden nur eigene, feste Strings eingefügt – nie Daten aus Nutzereingaben.
export const COLORS = { slip: '#087F9C', marina: '#16619B', fuel: '#D78B23' };

// Zeichen innerhalb des Kartenmarkers (Koordinatensystem 44 × 54, Pin-Kreis Mitte 22/21).
const GLYPH = {
  // Kleines Boot mit Segel, das auf einer schrägen Rampe ins Wasser fährt.
  slip: `
    <path d="M9.5 15.5 12.5 15.5 33 29.5v2.6H9.5z" fill="#fff" opacity=".95"/>
    <g transform="translate(23.6 22.2) rotate(35)">
      <path d="M-6.5-4.2h13l-2.6 4.2h-7.8z" fill="#fff" stroke="#087F9C" stroke-width="1" stroke-linejoin="round"/>
      <path d="M0-4.8V-13" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/>
      <path d="M1-12.4 6-5.4H1z" fill="#fff" stroke="#087F9C" stroke-width=".8" stroke-linejoin="round"/>
    </g>
    <path d="M12.5 35.2q2.5-2.5 5 0t5 0 5 0 5 0" stroke="#fff" stroke-width="2" stroke-linecap="round" fill="none"/>`,
  marina: `
    <circle cx="22" cy="12.2" r="2.7" stroke="#fff" stroke-width="2.2" fill="none"/>
    <path d="M22 15v18M16 19.5h12" stroke="#fff" stroke-width="2.3" stroke-linecap="round" fill="none"/>
    <path d="M10.5 24.5c0 7 5 9.5 11.5 9.5s11.5-2.5 11.5-9.5M10.5 24.5l-2.7 3.4M33.5 24.5l2.7 3.4" stroke="#fff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  fuel: `
    <rect x="12" y="11" width="14" height="22" rx="2" stroke="#fff" stroke-width="2.3" fill="none"/>
    <path d="M15 15h8v6h-8z" fill="#fff"/>
    <path d="M26 17.5c5 0 7 2.2 7 6.5v4.5a2.4 2.4 0 0 1-4.8 0V25" stroke="#fff" stroke-width="2.2" stroke-linecap="round" fill="none"/>
    <path d="M10 34.5h18" stroke="#fff" stroke-width="2.3" stroke-linecap="round"/>`,
};

/** Kartenmarker (Pin) für eine Kategorie. */
export function pinSvg(type, { size = 1, selected = false } = {}) {
  const w = Math.round(44 * size), h = Math.round(54 * size);
  const color = COLORS[type] || '#0B3045';
  return `<svg class="pin${selected ? ' is-selected' : ''}" width="${w}" height="${h}" viewBox="0 0 44 54" aria-hidden="true" focusable="false">
    <path d="M22 51.5C18.5 45 3.2 31.5 3.2 21.2a18.8 18.8 0 1 1 37.6 0C40.8 31.5 25.5 45 22 51.5Z" fill="${color}" stroke="#fff" stroke-width="2.8"/>
    ${GLYPH[type] || ''}</svg>`;
}

/** Kleines Kategorie-Symbol ohne Pin (für Listen und Kopfzeilen), weiß auf Farbfläche zu verwenden. */
export function glyphSvg(type, px = 22) {
  return `<svg width="${px}" height="${px}" viewBox="4 6 36 32" aria-hidden="true" focusable="false">${GLYPH[type] || ''}</svg>`;
}

const P = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
  map: '<path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z"/><path d="M9 4v13.5M15 6.5V20"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  locate: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  star: '<path d="m12 3 2.8 5.8 6.2.8-4.5 4.4 1.1 6.2L12 17.2 6.4 20.2l1.1-6.2L3 9.6l6.2-.8z"/>',
  share: '<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13"/>',
  navigate: '<path d="m3 11 18-8-8 18-2-8z"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  back: '<path d="m15 6-6 6 6 6"/>',
  next: '<path d="m9 6 6 6-6 6"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>',
  alert: '<path d="M12 3 22 21H2zM12 10v5M12 18h.01"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0"/>',
  shield: '<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6z"/>',
  pump: '<path d="M5 20V5.5A1.5 1.5 0 0 1 6.5 4h6A1.5 1.5 0 0 1 14 5.5V20M3.5 20h12M7 8h5"/><path d="M14 10h1.5a1.5 1.5 0 0 1 1.5 1.5V16a1.5 1.5 0 0 0 3 0V8.5L17.5 6"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  car: '<path d="M5 15V10.5L7 6h10l2 4.5V15z"/><path d="M5 15v2.5M19 15v2.5M4 11h16"/><circle cx="8" cy="15.5" r="1.4"/><circle cx="16" cy="15.5" r="1.4"/>',
  slippery: '<path d="m4 17 5-5 3.5 3L20 7"/><path d="M15 7h5v5"/>',
  blocked: '<circle cx="12" cy="12" r="9"/><path d="M7.5 12h9"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  chat: '<path d="M4 5h16v11H9l-4 4v-4H4z"/><path d="M8 9.5h8M8 12.5h5"/>',
  doc: '<path d="M6 3h9l3 3v15H6z"/><path d="M9 9h6M9 13h6M9 17h4"/>',
  mail: '<path d="M4 6h16v12H4z"/><path d="m4 7 8 6 8-6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  pin: '<path d="M12 21s7-6.2 7-11.5a7 7 0 1 0-14 0C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  // Pegellatte mit Wellen
  gauge: '<path d="M9 3v13M9 5h3M9 8.5h2M9 12h3"/><path d="M3 17.5q2-2 4 0t4 0 4 0 4 0 2 0M3 21q2-2 4 0t4 0 4 0 4 0 2 0"/>',
};

/** UI-Symbol (Linien-Stil, nimmt currentColor). */
export function icon(name, px = 20, fill = false) {
  return `<svg class="ico" width="${px}" height="${px}" viewBox="0 0 24 24" fill="${fill ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${P[name] || ''}</svg>`;
}

/** Logo: Wellenmotiv im Kreis. */
export function logoSvg(px = 36) {
  return `<svg width="${px}" height="${px}" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
    <circle cx="20" cy="20" r="19" fill="#0B3045" stroke="#9CCEE3" stroke-width="1.5"/>
    <path d="M7 16q3.25-3.5 6.5 0t6.5 0 6.5 0 6.5 0" stroke="#9CCEE3" stroke-width="2.4" stroke-linecap="round" fill="none"/>
    <path d="M7 22.5q3.25-3.5 6.5 0t6.5 0 6.5 0 6.5 0" stroke="#fff" stroke-width="2.4" stroke-linecap="round" fill="none"/>
    <path d="M7 29q3.25-3.5 6.5 0t6.5 0 6.5 0 6.5 0" stroke="#087F9C" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg>`;
}

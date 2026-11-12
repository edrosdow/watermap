// Foto-Kategorien (eine Pflichtangabe beim Einreichen). Rein, ohne DOM – auch von netlify/functions/fotos.mjs genutzt.
export const FOTO_KATEGORIEN = {
  rampe: { text: 'Rampe', ico: 'slippery' },
  steg: { text: 'Steg', ico: 'boat' },
  zufahrt: { text: 'Zufahrt', ico: 'navigate' },
  parkplatz: { text: 'Parkplatz', ico: 'car' },
  umgebung: { text: 'Umgebung', ico: 'map' },
  sonstiges: { text: 'Sonstiges', ico: 'camera' },
};

/** Schlüssel aus Schlüssel oder Anzeigetext („Rampe“, „rampe“); sonst null (z. B. alte Mehrfachauswahl „Rampe, Steg“). */
export function kategorieAus(wert) {
  const t = String(wert ?? '').trim().toLowerCase();
  if (FOTO_KATEGORIEN[t]) return t;
  return Object.keys(FOTO_KATEGORIEN).find(k => FOTO_KATEGORIEN[k].text.toLowerCase() === t) || null;
}

/** Filter für eine Fotoliste: [{ key: null (Alle) | Kategorie, text, n }] – nur wenn es mindestens zwei Kategorien gibt. */
export function fotoFilter(photos) {
  const n = new Map();
  for (const ph of photos || []) if (FOTO_KATEGORIEN[ph.kategorie]) n.set(ph.kategorie, (n.get(ph.kategorie) || 0) + 1);
  if (n.size < 2) return [];
  return [{ key: null, text: 'Alle', n: photos.length },
    ...Object.keys(FOTO_KATEGORIEN).filter(k => n.has(k)).map(k => ({ key: k, text: FOTO_KATEGORIEN[k].text, n: n.get(k) }))];
}

// Suche: erst lokale Standorte (sofort, offline-fähig), dann Orte über den Geocoder (nur auf Nutzeraktion).
import { CONFIG } from './config.js';
import { displayName, TYPES } from './model.js';

const fold = (s) => (s || '').toLowerCase()
  .replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss')
  .normalize('NFD').replace(/[̀-ͯ]/g, '');

export function buildIndex(places) {
  return places.map(p => ({
    p,
    hay: fold([displayName(p), p.locality, p.water?.name, TYPES[p.type].label, p.operator].filter(Boolean).join(' ')),
    nameFold: fold(p.name),
  }));
}

export function searchLocal(index, query, limit = 6) {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const hits = [];
  for (const e of index) {
    if (!terms.every(t => e.hay.includes(t))) continue;
    const starts = e.nameFold.startsWith(terms[0]) ? 0 : 1;
    hits.push({ e, starts });
  }
  hits.sort((a, b) => a.starts - b.starts || displayName(a.e.p).localeCompare(displayName(b.e.p), 'de'));
  return hits.slice(0, limit).map(h => h.e.p);
}

/** Ortssuche über den konfigurierten Geocoder. Wirft bei Netzwerkfehlern. */
export async function geocode(query, { signal } = {}) {
  const url = `${CONFIG.GEOCODER_URL}?format=jsonv2&limit=5&countrycodes=de&accept-language=de&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('Unerwartete Antwort');
  return data.map(d => ({
    name: String(d.display_name || '').split(',').slice(0, 3).join(',').trim(),
    lat: Number(d.lat), lon: Number(d.lon),
    bbox: Array.isArray(d.boundingbox) ? d.boundingbox.map(Number) : null,
  })).filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lon));
}

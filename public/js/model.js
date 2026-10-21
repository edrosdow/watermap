// Datenmodell: Bezeichnungen, Filterdefinitionen, Beschreibung von Standorten.
// Grundregel: Unbekannt (null/undefined) ist NIE „Nein“.
import { CONFIG } from './config.js';

export const TYPES = {
  slip:   { label: 'Slipanlage',     plural: 'Slipanlagen',     unnamed: 'Slipanlage (ohne Namen)' },
  marina: { label: 'Marina / Hafen', plural: 'Marinas & Häfen', unnamed: 'Marina (ohne Namen)' },
  fuel:   { label: 'Bootstankstelle', plural: 'Bootstankstellen', unnamed: 'Bootstankstelle (ohne Namen)' },
};
export const TYPE_KEYS = Object.keys(TYPES);

export const ACCESS_LABEL = {
  public: 'Öffentlich',
  permissive: 'Duldung (öffentlich nutzbar, kein Rechtsanspruch)',
  customers: 'Nur Kunden / Gäste',
  members: 'Nur Mitglieder',
  permit: 'Nur mit Erlaubnis',
  private: 'Privat / gesperrt',
};

export const FUEL_LABEL = { diesel: 'Diesel', petrol: 'Benzin' };

export const UNKNOWN = 'Nicht bekannt';

// ---------------------------------------------------------------- Hilfsfunktionen
export function displayName(p) {
  return (p.name && p.name.trim()) || TYPES[p.type]?.unnamed || 'Standort';
}

export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371008.8, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function formatDistance(m) {
  if (!Number.isFinite(m)) return '';
  if (m < 950) return `${Math.round(m / 10) * 10} m`;
  if (m < 10000) return `${(m / 1000).toFixed(1).replace('.', ',')} km`;
  return `${Math.round(m / 1000)} km`;
}

export function parseISODate(s) {
  if (!s || typeof s !== 'string') return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + 'T12:00:00Z' : s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(s) {
  const d = parseISODate(s);
  return d ? d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : null;
}

export function ageInDays(s, now = new Date()) {
  const d = parseISODate(s);
  return d ? Math.floor((now - d) / 86400000) : null;
}

export function formatPrice(n) {
  return Number.isFinite(n) ? n.toFixed(2).replace('.', ',') + ' €/l' : null;
}

/** Nur http(s)-Adressen werden verlinkt. */
export function safeHttpUrl(u) {
  if (typeof u !== 'string') return null;
  try {
    const url = new URL(u.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch { return null; }
}

export function safeTel(s) {
  if (typeof s !== 'string') return null;
  const t = s.replace(/[^\d+]/g, '');
  return t.length >= 5 ? t : null;
}

export function osmUrl(p) {
  return p.osm ? `https://www.openstreetmap.org/${p.osm.type}/${p.osm.id}` : null;
}

export function navUrl(p) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(p.lat + ',' + p.lon)}`;
}

// ---------------------------------------------------------------- Filter
// Ein Filter lässt nur Standorte durch, bei denen die Eigenschaft BESTÄTIGT zutrifft.
export const FILTERS = {
  slip: [
    { id: 'free',     label: 'Kostenlos',            test: p => p.fee === false },
    { id: 'public',   label: 'Öffentlich',           test: p => p.access === 'public' },
    { id: 'trailerp', label: 'Trailerparkplatz',     test: p => p.attrs.trailer_parking === true },
    { id: 'motor',    label: 'Für Motorboote',       test: p => p.attrs.motorboat === true },
  ],
  marina: [
    { id: 'guest',    label: 'Gastliegeplätze',      test: p => p.attrs.visitor_berths === true },
    { id: 'power',    label: 'Stromanschluss',       test: p => p.attrs.electricity === true },
    { id: 'sanitary', label: 'Sanitäranlagen',       test: p => p.attrs.toilets === true || p.attrs.showers === true },
  ],
  fuel: [
    { id: 'diesel',   label: 'Diesel',               test: p => p.attrs.diesel === true || !!p.prices?.diesel },
    { id: 'petrol',   label: 'Benzin',               test: p => p.attrs.petrol === true || !!p.prices?.petrol },
    { id: 'priced',   label: 'Preise vorhanden',     test: p => !!(p.prices?.diesel || p.prices?.petrol) },
  ],
};

export function filterCounts(places, type) {
  const defs = FILTERS[type] || [];
  const of = places.filter(p => p.type === type);
  return defs.map(d => ({ ...d, count: of.filter(d.test).length, total: of.length }));
}

// ---------------------------------------------------------------- Beschreibung für die Detailansicht
const triText = (v, yes = 'Ja', no = 'Nein') => (v === true ? yes : v === false ? no : null);

/** Liefert [{label, value|null, note?}] – null = „Nicht bekannt“. */
export function describeFacts(p) {
  const a = p.attrs || {};
  const rows = [];
  const add = (label, value, note) => rows.push({ label, value: value ?? null, note: note || null });

  if (p.type === 'slip') {
    add('Zugang', p.access ? ACCESS_LABEL[p.access] : null);
    add('Gebühr', p.fee === false ? 'Kostenlos' : p.fee === true ? (p.fee_note ? `Kostenpflichtig – ${p.fee_note}` : 'Kostenpflichtig') : (p.fee_note || null));
    add('Rampenmaterial', a.surface);
    add('Neigung', a.incline);
    add('Für Motorboote', triText(a.motorboat));
    add('Parkplatz', triText(a.parking));
    add('Trailerparkplatz', triText(a.trailer_parking));
    add('Geeignete Bootsgrößen', a.suitable_boats);
    add('Geeignete Trailer', a.suitable_trailers);
  } else if (p.type === 'marina') {
    add('Zugang', p.access ? ACCESS_LABEL[p.access] : null);
    add('Liegeplätze', Number.isFinite(a.berths) ? String(a.berths) : null);
    add('Gastliegeplätze', triText(a.visitor_berths));
    add('Liegeplatzgebühr', a.berth_fee);
    add('Stromanschluss', triText(a.electricity));
    add('Frischwasser', triText(a.water_tap));
    add('Toiletten', triText(a.toilets));
    add('Duschen', triText(a.showers));
    add('Restaurant', triText(a.restaurant));
    add('Hafenmeister', triText(a.harbour_master));
  } else if (p.type === 'fuel') {
    add('Kraftstoffarten', [a.diesel ? 'Diesel' : null, a.petrol ? 'Benzin' : null].filter(Boolean).join(', ') || null);
    add('Vom Wasser erreichbar', triText(a.reach_water));
    add('Vom Land erreichbar', triText(a.reach_land));
    add('Zahlung', Array.isArray(a.payment) && a.payment.length ? a.payment.join(', ') : null);
  }
  add('Öffnungszeiten', p.opening_hours);
  if (p.operator) add('Betreiber', p.operator);
  return rows;
}

/** Preis-Anzeige je Kraftstoff mit Aktualitätshinweis. */
export function describePrices(p, now = new Date()) {
  const out = [];
  for (const kind of ['diesel', 'petrol']) {
    const pr = p.prices?.[kind];
    if (!pr) { out.push({ kind, label: FUEL_LABEL[kind], price: null }); continue; }
    const age = ageInDays(pr.observed, now);
    out.push({
      kind, label: FUEL_LABEL[kind], price: formatPrice(pr.price),
      observed: formatDate(pr.observed), age,
      stale: age === null || age > CONFIG.PRICE_STALE_DAYS,
    });
  }
  return out;
}

/** Zeile unter dem Namen: Ort und Gewässer, ehrlich benannt. */
export function subtitle(p, { short = false } = {}) {
  const parts = [];
  if (p.locality) parts.push(p.locality_kind === 'nearest' ? `bei ${p.locality}` : p.locality);
  if (p.water?.name) parts.push(p.water.approx && !short ? `Gewässer in der Nähe: ${p.water.name}` : p.water.name);
  return parts.join(' · ');
}

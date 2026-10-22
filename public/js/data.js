// Lädt Standortdaten (OSM-Schicht + Community-Schicht getrennt) und führt sie zusammen.
import { CONFIG } from './config.js';
import { TYPE_KEYS } from './model.js';

async function fetchJson(url, { retries = 2 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);
      const res = await fetch(url, { cache: 'no-cache', signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (i < retries) await new Promise(r => setTimeout(r, 600 * (i + 1)));
    }
  }
  throw lastErr;
}

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = v => (typeof v === 'string' && v.trim() ? v.trim() : null);
const tri = v => (v === true ? true : v === false ? false : null);

/** Prüft und normalisiert einen Datensatz; ungültige Datensätze → null (werden gezählt, nicht angezeigt). */
export function normalizePlace(raw, source) {
  if (!raw || typeof raw !== 'object') return null;
  const type = raw.type;
  if (!TYPE_KEYS.includes(type)) return null;
  const lat = num(raw.lat), lon = num(raw.lon);
  if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  const id = str(raw.id);
  if (!id) return null;
  const a = raw.attrs && typeof raw.attrs === 'object' ? raw.attrs : {};
  return {
    id, type, lat, lon, source,
    name: str(raw.name),
    locality: str(raw.locality),
    locality_kind: str(raw.locality_kind),
    water: raw.water && str(raw.water.name) ? { name: str(raw.water.name), approx: raw.water.approx !== false } : null,
    access: str(raw.access),
    fee: tri(raw.fee),
    fee_note: str(raw.fee_note),
    opening_hours: str(raw.opening_hours),
    operator: str(raw.operator),
    website: str(raw.website),
    phone: str(raw.phone),
    email: str(raw.email),
    description: str(raw.description),
    attrs: {
      surface: str(a.surface), incline: str(a.incline),
      motorboat: tri(a.motorboat), parking: tri(a.parking), trailer_parking: tri(a.trailer_parking),
      suitable_boats: str(a.suitable_boats), suitable_trailers: str(a.suitable_trailers),
      berths: num(a.berths), visitor_berths: tri(a.visitor_berths), berth_fee: str(a.berth_fee),
      electricity: tri(a.electricity), water_tap: tri(a.water_tap), toilets: tri(a.toilets),
      showers: tri(a.showers), restaurant: tri(a.restaurant), harbour_master: tri(a.harbour_master),
      diesel: tri(a.diesel), petrol: tri(a.petrol),
      reach_water: tri(a.reach_water), reach_land: tri(a.reach_land),
      payment: Array.isArray(a.payment) ? a.payment.filter(x => typeof x === 'string').slice(0, 8) : null,
    },
    photos: [],
    prices: {},
    osm: raw.osm && raw.osm.type && raw.osm.id ? { type: String(raw.osm.type), id: Number(raw.osm.id), timestamp: str(raw.osm.timestamp) } : null,
    updated: str(raw.updated) || str(raw.imported) || null,
    community_fields: [],
  };
}

function fromFeature(f) {
  if (!f || f.type !== 'Feature' || f.geometry?.type !== 'Point' || !Array.isArray(f.geometry.coordinates)) return null;
  const [lon, lat] = f.geometry.coordinates;
  return { ...(f.properties || {}), id: f.id ?? f.properties?.id, lat, lon };
}

function asRecords(json) {
  if (Array.isArray(json)) return json;
  if (json && json.type === 'FeatureCollection' && Array.isArray(json.features)) return json.features.map(fromFeature);
  return [];
}

const PATCHABLE = ['name', 'locality', 'access', 'fee', 'fee_note', 'opening_hours', 'operator', 'website', 'phone', 'email', 'description'];

function applyOverride(place, ov) {
  const f = ov.fields || {};
  for (const k of PATCHABLE) {
    if (k in f) { place[k] = f[k]; place.community_fields.push(k); }
  }
  if (f.lat !== undefined && f.lon !== undefined && Number.isFinite(f.lat) && Number.isFinite(f.lon)) {
    place.lat = f.lat; place.lon = f.lon; place.community_fields.push('lat');
  }
  for (const [k, v] of Object.entries(ov.attrs || {})) {
    if (k in place.attrs) { place.attrs[k] = Array.isArray(v) ? v : (typeof v === 'boolean' || v === null || typeof v === 'number' || typeof v === 'string' ? v : place.attrs[k]); place.community_fields.push(k); }
  }
  for (const ph of ov.photos || []) {
    if (ph && typeof ph.url === 'string' && /^(\.\/|\/)?photos\//.test(ph.url)) place.photos.push({ url: ph.url, credit: str(ph.credit), alt: str(ph.alt) });
  }
  if (ov.updated) place.updated = ov.updated;
}

/** Aktuellster freigegebener Preis je Tankstelle und Kraftstoff. Ältere bleiben in der Datei erhalten. */
function applyPrices(byId, reports) {
  const latest = new Map();
  for (const r of reports) {
    if (!r || r.status !== 'approved') continue;
    if (!['diesel', 'petrol'].includes(r.fuel)) continue;
    const price = num(r.price);
    if (price === null || price < CONFIG.PRICE_MIN || price > CONFIG.PRICE_MAX) continue;
    if (!byId.has(r.station_id)) continue;
    const key = r.station_id + '|' + r.fuel;
    const cur = latest.get(key);
    if (!cur || String(r.observed) > String(cur.observed)) latest.set(key, r);
  }
  for (const [key, r] of latest) {
    const p = byId.get(r.station_id);
    p.prices[r.fuel] = { price: r.price, observed: r.observed };
    p.community_fields.push('price');
  }
}

/**
 * Lädt alles. Wirft nur, wenn GAR keine Standortdatei lesbar war.
 * Einzelne fehlende Dateien werden in `issues` gemeldet, die App bleibt nutzbar.
 */
export async function loadAll() {
  const base = CONFIG.DATA_BASE;
  const issues = [];
  let meta = null;
  try { meta = await fetchJson(base + 'meta.json'); }
  catch (e) { issues.push(`meta.json: ${e.message}`); }

  const osmFiles = meta?.files?.osm || ['osm/slip.geojson', 'osm/marina.geojson', 'osm/fuel.geojson'];
  const comFiles = meta?.files?.community || { places: 'community/places.json', overrides: 'community/overrides.json', prices: 'community/prices.json' };

  const settle = async (path) => {
    try { return { path, json: await fetchJson(base + path) }; }
    catch (e) { issues.push(`${path}: ${e.message}`); return { path, json: null }; }
  };

  const [osm, places, overrides, prices] = await Promise.all([
    Promise.all(osmFiles.map(settle)),
    settle(comFiles.places), settle(comFiles.overrides), settle(comFiles.prices),
  ]);

  if (osm.every(r => r.json === null)) {
    const err = new Error('Keine Standortdatei konnte geladen werden.');
    err.issues = issues; err.meta = meta;
    throw err;
  }

  const byId = new Map();
  let invalid = 0;
  const take = (rec, source) => {
    const p = normalizePlace(rec, source);
    if (!p) { invalid++; return; }
    if (byId.has(p.id)) { invalid++; return; }
    byId.set(p.id, p);
  };
  for (const r of osm) for (const rec of asRecords(r.json)) take(rec, 'osm');
  for (const rec of asRecords(places.json)) if (rec?.status === 'approved') take(rec, 'community');

  for (const ov of asRecords(overrides.json)) {
    const p = ov && byId.get(ov.id);
    if (p && ov.status === 'approved') applyOverride(p, ov);
  }
  applyPrices(byId, asRecords(prices.json));

  return { places: [...byId.values()], meta, issues, invalid };
}

/** Nur Slipanlagen (OSM + freigegebene Community-Meldungen), z. B. für die Pegel-Ampel. */
export async function loadSlips() {
  const base = CONFIG.DATA_BASE;
  let meta = null;
  try { meta = await fetchJson(base + 'meta.json'); } catch { /* Standardpfade */ }
  const osmFile = (meta?.files?.osm || []).find(f => /slip/.test(f)) || 'osm/slip.geojson';
  const comFile = meta?.files?.community?.places || 'community/places.json';
  const [osm, com] = await Promise.all([fetchJson(base + osmFile), fetchJson(base + comFile).catch(() => null)]);
  const out = [];
  for (const rec of asRecords(osm)) { const p = normalizePlace(rec, 'osm'); if (p?.type === 'slip') out.push(p); }
  for (const rec of asRecords(com)) if (rec?.status === 'approved') { const p = normalizePlace(rec, 'community'); if (p?.type === 'slip') out.push(p); }
  return out;
}

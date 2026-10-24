// Gezeitenvorhersage des BSH (Wasserstandsvorhersage, Lizenz CC BY 4.0) – reine Funktionen, in Node testbar.
// Quelle: https://gdi.bsh.de/ldproxy/rest/services/WaterLevelForecast (Aufbau: docs/BSH-Klaerung.md).
import { AUSNAHMEN } from './gezeiten-orte.mjs';

export const API = 'https://gdi.bsh.de/ldproxy/rest/services/WaterLevelForecast/collections/waterlevelforecastdata/items';
const STD = 3600e3;

/** „2026-10-24 12:31:00+02:00“ → ms (NaN, wenn unlesbar). */
export const zeit = (s) => Date.parse(String(s || '').trim().replace(' ', 'T'));
/** Zahl aus Zahl oder Text („679“), sonst null. */
export const zahl = (v) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*-?\d+([.,]\d+)?\s*$/.test(v) ? Number(v.replace(',', '.')) : NaN;
  return Number.isFinite(n) ? n : null;
};
const UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

/** Ortsliste (GeoJSON-Features) → [{ id, name, nr, uuid, region }] */
export function orte(features) {
  return (features || []).filter(f => f && f.id).map(f => {
    const p = f.properties || {};
    const nr = String(p.operator_gauge_id ?? '').trim();
    return { id: String(f.id), name: String(p.gauge_label || f.id), nr: /^\d+$/.test(nr) ? nr : null,
      uuid: (String(p.measurement_url || '').match(UUID) || [])[1]?.toLowerCase() || null, region: p.region || null };
  });
}

/** BSH-Ort zu einem PEGELONLINE-Pegel: Ausnahmeliste, dann UUID, dann Pegelnummer. → Kennung oder null */
export function ortFinden(liste, { pegel, nr } = {}, ausnahmen = AUSNAHMEN) {
  const u = String(pegel || '').toLowerCase(), n = String(nr || '');
  const a = ausnahmen[u] || ausnahmen[n];
  if (a) return liste.some(o => o.id === a) ? a : null;
  return (u && liste.find(o => o.uuid === u)?.id) || (n && liste.find(o => o.nr === n)?.id) || null;
}

/** HTML-Text des BSH („<b>2 bis 4 dm</b> …“) als schlichter Text. */
export const text = (s) => String(s || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim() || null;

/**
 * Antwort für die App aus den properties eines Orts: Ereignisse (HW/NW) ab 12 h vor jetzt, Kurve von 26 h vor bis
 * 30 h nach jetzt (Gezeitenrechnung und – wo vorhanden – automatische Vorhersage), Texte, Stand.
 * Höhen in cm am Pegel (wie PEGELONLINE).
 */
export function aufbereiten(id, p, jetzt = Date.now()) {
  const ereignisse = (p.high_water_low_water || []).map(e => {
    const t = zeit(e.event_timestamp), astro = zahl(e.tidal_prediction_value), vh = zahl(e.forecast_value);
    if (!Number.isFinite(t) || !['HW', 'NW'].includes(e.event)) return null;
    return { t, typ: e.event, astro, ...(vh !== null ? { vh, abw: e.forecast_deviation || null, unsicher: zahl(e.forecast_uncertainty) } : {}) };
  }).filter(e => e && e.t >= jetzt - 12 * STD).sort((a, b) => a.t - b.t);
  const kurve = (p.curve || []).map(k => {
    const t = zeit(k.timestamp);
    if (!Number.isFinite(t) || t < jetzt - 26 * STD || t > jetzt + 30 * STD) return null;
    const astro = zahl(k.tidal_prediction), vh = zahl(k.automated_curve_forecast);
    return astro === null && vh === null ? null : { t, astro, ...(vh !== null ? { vh } : {}) };
  }).filter(Boolean);
  return {
    ort: id, name: p.gauge_label || id,
    stand: zeit(p.forecast_timestamp) || null, kurveStand: zeit(p.automated_curveforecast_timestamp) || null,
    mthw: zahl(p.mean_high_water), mtnw: zahl(p.mean_low_water),
    ereignisse, kurve,
    text: text(p.forecast_text?.de), zusatz: text(p.forecast_text_additional?.de),
    link: /^https:\/\/[a-z.]*bsh\.de\//.test(p.bsh_url_waterlevel || '') ? p.bsh_url_waterlevel : 'https://wasserstand.bsh.de/',
    lizenz: 'CC BY 4.0', quelle: 'BSH',
  };
}

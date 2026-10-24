// Tests: BSH-Gezeitenvorhersage (Zuordnung, Aufbereitung, Fehler, Abschalter). Start: node tests/gezeiten_bsh_test.mjs
import assert from 'node:assert/strict';
import { orte, ortFinden, aufbereiten, zeit, text } from '../netlify/lib/gezeiten-kern.mjs';
import { handle, _zuruecksetzen } from '../netlify/functions/gezeiten.mjs';

const CUX = 'aad49293-242a-43ad-a8b1-e91d7792c4b2';
const feature = (id, nr, uuid) => ({ id, properties: { gauge_label: id, operator_gauge_id: nr, region: 'north_sea',
  measurement_url: uuid ? `https://www.pegelonline.wsv.de/gast/stammdaten?pegelnr=${nr}#detail?id=${uuid}` : '' } });
const liste = orte([feature('cuxhaven_steubenhoeft', '5990020', CUX), feature('bremen_vegesack', '4950010', null), feature('fino2', 'nan', null)]);

// Zuordnung: UUID, sonst Pegelnummer, Ausnahmen zuerst
assert.deepEqual(liste[0], { id: 'cuxhaven_steubenhoeft', name: 'cuxhaven_steubenhoeft', nr: '5990020', uuid: CUX, region: 'north_sea' });
assert.equal(liste[2].nr, null, '„nan“ ist keine Pegelnummer');
assert.equal(ortFinden(liste, { pegel: CUX.toUpperCase() }), 'cuxhaven_steubenhoeft', 'über UUID');
assert.equal(ortFinden(liste, { pegel: '00000000-0000-0000-0000-000000000000', nr: '4950010' }), 'bremen_vegesack', 'über Pegelnummer');
assert.equal(ortFinden(liste, { nr: '123' }), null);
assert.equal(ortFinden(liste, { nr: '777' }, { 777: 'bremen_vegesack' }), 'bremen_vegesack', 'Ausnahmeliste');
assert.equal(ortFinden(liste, { nr: '777' }, { 777: 'gibt_es_nicht' }), null);

// Aufbereitung
const jetzt = zeit('2026-10-24 12:05:00+02:00');
assert.equal(jetzt, Date.parse('2026-10-24T10:05:00Z'));
const props = {
  gauge_label: 'Cuxhaven, Steubenhöft, Elbe', forecast_timestamp: '2026-10-24 07:32:15+02:00', mean_high_water: 656, mean_low_water: '366',
  forecast_text: { de: 'Hochwasser <b>1/2 bis 3/4 m </b><b>niedriger</b>.' },
  high_water_low_water: [
    { event_timestamp: '2026-10-23 12:00:00+02:00', event: 'HW', tidal_prediction_value: '670' },
    { event_timestamp: '2026-10-24 12:31:00+02:00', event: 'HW', tidal_prediction_value: '679', forecast_value: 718, forecast_uncertainty: 12.5, forecast_deviation: '+0,5 bis +0,75 m' },
    { event_timestamp: '2026-10-24 19:25:00+02:00', event: 'NW', tidal_prediction_value: '368' },
  ],
  curve: [
    { timestamp: '2026-10-24 12:00:00+02:00', tidal_prediction: '675', measurement: '713' },
    { timestamp: '2026-10-24 12:20:00+02:00', tidal_prediction: '678', automated_curve_forecast: '720' },
    { timestamp: '2026-10-29 12:20:00+02:00', tidal_prediction: '600' },
  ],
};
const d = aufbereiten('cuxhaven_steubenhoeft', props, jetzt);
assert.deepEqual(d.ereignisse.map(e => [e.typ, e.astro, e.vh ?? null]), [['HW', 679, 718], ['NW', 368, null]], 'alte Ereignisse weg, Vorhersage nur wo vorhanden');
assert.equal(d.ereignisse[0].abw, '+0,5 bis +0,75 m');
assert.deepEqual(d.kurve.map(k => [k.astro, k.vh ?? null]), [[675, null], [678, 720]], 'Kurve bis 30 h, Messwerte nicht übernommen');
assert.equal(d.text, 'Hochwasser 1/2 bis 3/4 m niedriger.');
assert.equal(d.mtnw, 366);
assert.equal(text('<b></b>'), null);

// Funktion
const ok = (j) => new Response(JSON.stringify(j), { headers: { 'content-type': 'application/json' } });
let aufrufe = [];
const fetchFn = async (url, o) => {
  aufrufe.push({ url, ua: o.headers['User-Agent'] });
  if (url.includes('/items?')) return url.includes('properties=') ? new Response('bad', { status: 400 }) : ok({ features: [feature('cuxhaven_steubenhoeft', '5990020', CUX)], links: [] });
  if (url.endsWith('/cuxhaven_steubenhoeft?f=json')) return ok({ properties: props });
  return new Response('x', { status: 500 });
};
const req = (q) => new Request(`https://x.test/api/gezeiten?${q}`);
const env = { WATERMAP_KONTAKT: 'kontakt@example.org' };
_zuruecksetzen();
let r = await handle(req(`pegel=${CUX}`), { fetchFn, env, jetzt });
assert.equal(r.status, 200);
assert.match(r.headers.get('netlify-cdn-cache-control'), /s-maxage=3600/, 'Vorhersage 1 h im CDN');
assert.equal((await r.json()).ereignisse[0].vh, 718);
assert.ok(aufrufe.every(a => a.ua.startsWith('WaterMap/1.0') && a.ua.includes('kontakt@example.org')), 'User-Agent mit Kontakt');
assert.ok(aufrufe.some(a => a.url.includes('properties=')) && aufrufe.some(a => a.url.includes('/items?') && !a.url.includes('properties=')), '400 mit Feldauswahl → vollständige Liste');
aufrufe = [];
r = await handle(req('nr=5990020'), { fetchFn, env, jetzt });
assert.equal(r.status, 200);
assert.ok(!aufrufe.some(a => a.url.includes('/items?')), 'Ortsliste aus dem Speicher');
r = await handle(req('nr=1234567'), { fetchFn, env, jetzt });
assert.equal(r.status, 404);
assert.equal((await r.json()).keinOrt, true);
r = await handle(req('orte=1'), { fetchFn, env, jetzt });
assert.deepEqual((await r.json()).orte.map(o => o.uuid), [CUX]);
assert.equal((await handle(req('pegel=abc'), { fetchFn, env, jetzt })).status, 400);
// BSH-Fehler → 502, nicht zwischengespeichert
r = await handle(req(`pegel=${CUX}`), { fetchFn: async (u) => (u.includes('/items?') ? fetchFn(u, { headers: {} }) : new Response('x', { status: 503 })), env, jetzt });
assert.equal(r.status, 502);
assert.equal(r.headers.get('cache-control'), 'no-store');
_zuruecksetzen();
r = await handle(req(`pegel=${CUX}`), { fetchFn: async () => { throw new Error('offline'); }, env, jetzt });
assert.equal(r.status, 502);
// Abschalter
r = await handle(req(`pegel=${CUX}`), { fetchFn: () => { throw new Error('darf nicht abfragen'); }, env: { GEZEITEN_BSH_AUS: '1' }, jetzt });
assert.equal(r.status, 503);
assert.equal((await r.json()).aus, true);
// Blobs: Ortsliste wird gespeichert und wiederverwendet
_zuruecksetzen();
const blobs = new Map();
const store = { get: async (k) => blobs.get(k) ?? null, setJSON: async (k, v) => { blobs.set(k, v); } };
await handle(req(`pegel=${CUX}`), { fetchFn, env, store, jetzt });
assert.ok(blobs.get('orte')?.liste.length === 1);
_zuruecksetzen(); aufrufe = [];
await handle(req(`pegel=${CUX}`), { fetchFn, env, store, jetzt: jetzt + 3600e3 });
assert.ok(!aufrufe.some(a => a.url.includes('/items?')), 'Ortsliste aus Blobs');
console.log('gezeiten_bsh_test: ok');

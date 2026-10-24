// Test der BSH-Prüf-Funktion (netlify/functions/gezeiten-probe.mjs) mit nachgebildetem fetch. Start: node tests/gezeiten_probe_test.mjs
import assert from 'node:assert/strict';
import { handle, verweise } from '../netlify/functions/gezeiten-probe.mjs';

const req = new Request('https://x.test/api/gezeiten/probe');
const live = await handle(req, { env: { CONTEXT: 'production' }, fetchFn: () => { throw new Error('darf nicht abfragen'); } });
assert.equal(live.status, 404, 'auf der Live-Seite abgeschaltet');

const aufrufe = [];
const fetchFn = async (url, opt) => {
  aufrufe.push({ url, ua: opt.headers['User-Agent'] });
  if (url.endsWith('/collections?f=json')) return new Response(JSON.stringify({ collections: [{ id: 'stationen' }, { id: 'vorhersage' }] }), { headers: { 'content-type': 'application/json' } });
  if (url.includes('/items/cuxhaven')) return new Response(JSON.stringify({ type: 'Feature', id: 'cuxhaven_steubenhoeft', properties: { gauge_label: 'Cuxhaven', high_water_low_water: [{ event: 'HW' }, { event: 'NW' }] } }));
  if (url.includes('/items')) return new Response(JSON.stringify({ features: [{ id: 'cuxhaven_steubenhoeft', properties: { gauge_label: 'Cuxhaven', operator_gauge_id: '5990020', measurement_url: 'https://x/?pegelnr=5990020#detail?id=aad49293-242a-43ad-a8b1-e91d7792c4b2', region: 'north_sea' } }] }), { headers: { 'content-type': 'application/geo+json' } });
  if (url.endsWith('.js')) return new Response('fetch("https://gdi.bsh.de/ldproxy/rest/services/WaterLevelForecast/collections/x/items")');
  if (url.startsWith('https://wasserstand')) return new Response('<script src="/app.js"></script>', { headers: { 'content-type': 'text/html' } });
  throw new Error('nicht erreichbar');
};
const r = await handle(req, { env: { CONTEXT: 'deploy-preview', WATERMAP_KONTAKT: 'kontakt@example.org' }, fetchFn });
const j = await r.json();
assert.equal(r.status, 200);
assert.ok(aufrufe.every(a => a.ua.startsWith('WaterMap/1.0') && a.ua.includes('kontakt@example.org')), 'eigener User-Agent mit Kontakt');
assert.deepEqual(j.ergebnisse.find(e => e.name.startsWith('Aufbau')).aufbau.properties.high_water_low_water.liste, 2, 'Aufbau einer Station');
assert.equal(j.ergebnisse.find(e => e.name === 'Liste aller Stationen').stationen[0], 'cuxhaven_steubenhoeft | Cuxhaven | 5990020 | aad49293-242a-43ad-a8b1-e91d7792c4b2 | north_sea | ', 'Stationsliste kompakt');
const r2 = await (await handle(new Request('https://x.test/api/gezeiten/probe?runde=2'), { env: {}, fetchFn })).json();
assert.deepEqual(r2.ergebnisse.map(e => e.name), ['Aufbau Station cuxhaven_steubenhoeft', 'Liste aller Stationen'], 'Runde 2 kurz');
assert.ok(j.ergebnisse.find(e => e.name === 'Wasserstand-Anwendung').skripte[0].adressen[0].includes('ldproxy'), 'Datenadressen aus Skripten');
assert.ok(j.ergebnisse.find(e => e.name === 'Gezeiten-Anwendung').fehler, 'Ausfall wird gemeldet, kein Absturz');
assert.deepEqual(verweise('<a href="/x/data.json">', 'https://a.bsh.de/'), ['https://a.bsh.de/x/data.json']);
console.log('gezeiten_probe_test: ok');

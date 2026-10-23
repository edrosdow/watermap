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
  if (url.includes('/items')) return new Response('{"type":"FeatureCollection","features":[]}', { headers: { 'content-type': 'application/geo+json' } });
  if (url.endsWith('.js')) return new Response('fetch("https://gdi.bsh.de/ldproxy/rest/services/WaterLevelForecast/collections/x/items")');
  if (url.startsWith('https://wasserstand')) return new Response('<script src="/app.js"></script>', { headers: { 'content-type': 'text/html' } });
  throw new Error('nicht erreichbar');
};
const r = await handle(req, { env: { CONTEXT: 'deploy-preview', WATERMAP_KONTAKT: 'kontakt@example.org' }, fetchFn });
const j = await r.json();
assert.equal(r.status, 200);
assert.ok(aufrufe.every(a => a.ua.startsWith('WaterMap/1.0') && a.ua.includes('kontakt@example.org')), 'eigener User-Agent mit Kontakt');
assert.ok(j.ergebnisse.some(e => e.name === 'Beispiel stationen'), 'Beispiel-Einträge der Sammlungen');
assert.ok(j.ergebnisse.find(e => e.name === 'Wasserstand-Anwendung').skripte[0].adressen[0].includes('ldproxy'), 'Datenadressen aus Skripten');
assert.ok(j.ergebnisse.find(e => e.name === 'Gezeiten-Anwendung').fehler, 'Ausfall wird gemeldet, kein Absturz');
assert.deepEqual(verweise('<a href="/x/data.json">', 'https://a.bsh.de/'), ['https://a.bsh.de/x/data.json']);
console.log('gezeiten_probe_test: ok');

// Tests der Funktion „In der Nähe“ (netlify/functions/umgebung.mjs) mit nachgebildeten Overpass-Servern.
// Start: node tests/umgebung_test.mjs
import assert from 'node:assert/strict';
import { handle, abfrage, SERVER } from '../netlify/functions/umgebung.mjs';

const req = (q, method = 'GET') => new Request('https://test.example/.netlify/functions/umgebung' + q, { method });

// Abfrage: 500 m, alle gewünschten Arten, Flächen mit Mittelpunkt
const q = abfrage(51.00619, 12.98348);
for (const t of ['around:500,51.00619,12.98348', 'camp_site', 'caravan_site', 'parking', 'toilets', 'restaurant', 'fast_food', 'supermarket', '"lock"="yes"', 'out tags center']) assert.ok(q.includes(t), t);

// Eingaben
let calls = [];
const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const fetchOk = async (url, o) => { calls.push({ url, o }); return ok({ elements: [{ type: 'way', id: 1, center: { lat: 51, lon: 13 }, tags: { tourism: 'camp_site' }, geometry: [1, 2, 3], nodes: [1] }] }); };
assert.equal((await handle(req('?lat=abc&lon=1'), { fetchFn: fetchOk })).status, 400);
assert.equal((await handle(req('?lat=40&lon=13'), { fetchFn: fetchOk })).status, 400, 'außerhalb Deutschlands');
assert.equal((await handle(req('?lat=51&lon=13', 'POST'), { fetchFn: fetchOk })).status, 405);
assert.equal(calls.length, 0);

// Erfolg: eigene Kennung (nur ASCII), POST an alle Server gleichzeitig, Antwort ohne Geometrie, CDN-Cache
let res = await handle(req('?lat=51.00619&lon=12.98348'), { fetchFn: fetchOk });
assert.equal(res.status, 200);
assert.deepEqual(calls.map(c => c.url), SERVER);
assert.ok(/^[\x20-\x7e]+$/.test(calls[0].o.headers['user-agent']));
assert.equal(calls[0].o.method, 'POST');
assert.ok(calls[0].o.headers['user-agent'].startsWith('WaterMap/'));
assert.ok(decodeURIComponent(calls[0].o.body).includes('around:500,51.00619,12.98348'));
let body = await res.json();
assert.deepEqual(body.elements[0], { type: 'way', id: 1, center: { lat: 51, lon: 13 }, tags: { tourism: 'camp_site' } });
assert.ok(res.headers.get('netlify-cdn-cache-control').includes('s-maxage'));

// 406 beim ersten, andere hängen bis auf den letzten → Antwort des letzten, übrige werden abgebrochen
let abgebrochen = 0;
const gemischt = (url, o) => {
  if (url === SERVER[0]) return Promise.resolve({ ok: false, status: 406 });
  if (url === SERVER.at(-1)) return new Promise(r => setTimeout(() => r(ok({ elements: [] })), 10));
  return new Promise((_, rej) => o.signal.addEventListener('abort', () => { abgebrochen++; rej(Object.assign(new Error('abort'), { name: 'AbortError' })); }));
};
res = await handle(req('?lat=51&lon=13'), { fetchFn: gemischt });
assert.equal(res.status, 200);
assert.equal((await res.json()).quelle, new URL(SERVER.at(-1)).host);
assert.equal(abgebrochen, SERVER.length - 2);

// Zeitüberschreitung und Fehler bei allen → 502, nicht zwischengespeichert
const haengt = (url, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(Object.assign(new Error('abort'), { name: 'AbortError' }))));
res = await handle(req('?lat=51&lon=13'), { fetchFn: haengt, timeoutMs: 20 });
assert.equal(res.status, 502);
assert.equal(res.headers.get('cache-control'), 'no-store');
assert.equal((await res.json()).details.length, SERVER.length);

// HTTP 200 mit „runtime error“ (überlastet) gilt als Fehler, nicht als leeres Ergebnis
res = await handle(req('?lat=51&lon=13'), { fetchFn: async () => ok({ elements: [], remark: 'runtime error: Query timed out in "query" at line 1 after 15 seconds.' }) });
assert.equal(res.status, 502);
assert.equal(res.headers.get('cache-control'), 'no-store');

console.log('umgebung: alle Tests OK');

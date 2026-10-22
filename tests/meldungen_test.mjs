// Tests für „Heute vor Ort“ (netlify/lib/meldungen-kern.mjs, netlify/functions/meldungen.mjs) mit nachgebautem Blob-Speicher und Uhr.
// Start: node tests/meldungen_test.mjs
import assert from 'node:assert/strict';
import { meldungenApi, saeubereNotiz, sichtbare, TYPEN, WICHTIGKEIT } from '../netlify/lib/meldungen-kern.mjs';
import { handle } from '../netlify/functions/meldungen.mjs';

function fakeStore() {
  const m = new Map();
  return {
    m,
    async get(k) { return m.has(k) ? JSON.parse(m.get(k)) : null; },
    async setJSON(k, v) { m.set(k, JSON.stringify(v)); },
    async delete(k) { m.delete(k); },
    async list({ prefix }) { return { blobs: [...m.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })) }; },
  };
}
const H = 3600e3;
let uhr = Date.parse('2026-10-22T10:00:00Z');
let nr = 0;
const store = fakeStore();
const GIBT = new Set(['node/1', 'node/2', 'way/3', 'c/neu-1']);
const api = meldungenApi({ store, salz: 'geheim', jetzt: () => uhr, standortGibtEs: async (id) => GIBT.has(id), neueId: () => (++nr).toString(16).padStart(12, '0') });
const anna = { geraet: 'anna-geraet-0000000001', ip: '203.0.113.5' };
const bob = { geraet: 'bob-geraet-00000000002', ip: '198.51.100.7' };
const carl = { geraet: 'carl-geraet-0000000003', ip: '192.0.2.9' };
const dora = { geraet: 'dora-geraet-0000000004', ip: '192.0.2.10' };
const rejects = async (p, status, text) => { await assert.rejects(p, (e) => e.status === status && (!text || e.message.includes(text))); };

// Konstanten
assert.deepEqual(TYPEN, ['alles_frei', 'parkplatz_voll', 'warteschlange', 'rampe_rutschig', 'hindernis', 'gesperrt']);
assert.ok(WICHTIGKEIT.gesperrt > WICHTIGKEIT.hindernis && WICHTIGKEIT.hindernis > WICHTIGKEIT.rampe_rutschig && WICHTIGKEIT.rampe_rutschig > WICHTIGKEIT.parkplatz_voll
  && WICHTIGKEIT.parkplatz_voll > WICHTIGKEIT.warteschlange && WICHTIGKEIT.warteschlange > WICHTIGKEIT.alles_frei);

// Notiz: HTML und Links weg, Länge begrenzt
assert.equal(saeubereNotiz('<b>Voll</b> <script>alert(1)</script> siehe https://spam.example/x und www.boese.de'), 'Voll alert(1) siehe und');
assert.equal(saeubereNotiz('Ausweichparkplatz am Waldweg'), 'Ausweichparkplatz am Waldweg');
assert.equal(saeubereNotiz('x'.repeat(300)).length, 140);
assert.equal(saeubereNotiz('kaufen bei billig.com jetzt'), 'kaufen bei jetzt');

// Prüfungen
await rejects(api.melden({ standortId: 'node/1', typ: 'egal' }, anna), 400, 'Unbekannte');
await rejects(api.melden({ standortId: '../etc', typ: 'gesperrt' }, anna), 400, 'Standort');
await rejects(api.melden({ standortId: 'node/999', typ: 'gesperrt' }, anna), 404);
await rejects(api.melden({ standortId: 'node/1', typ: 'gesperrt', notiz: 5 }, anna), 400);
await rejects(api.melden({ standortId: 'node/1', typ: 'gesperrt' }, { geraet: 'x', ip: '' }), 400, 'Gerät');

// Melden, Sperre 1 h pro Gerät/IP und Standort
let r = await api.melden({ standortId: 'node/1', typ: 'parkplatz_voll', notiz: '<i>Ausweich</i>parkplatz' }, anna);
assert.equal(r.meldung.typ, 'parkplatz_voll'); assert.equal(r.meldung.notiz, 'Ausweich parkplatz'); assert.equal(r.meldung.bestaetigt, 0);
await rejects(api.melden({ standortId: 'node/1', typ: 'warteschlange' }, anna), 429, 'gerade schon');
await rejects(api.melden({ standortId: 'node/1', typ: 'warteschlange' }, { geraet: 'anna-neues-geraet-999', ip: anna.ip }), 429, 'gerade schon');   // gleiche IP
await rejects(api.melden({ standortId: 'node/1', typ: 'warteschlange' }, { geraet: anna.geraet, ip: '10.0.0.1' }), 429);                             // gleiches Gerät
r = await api.melden({ standortId: 'node/2', typ: 'hindernis' }, anna);                                                                              // anderer Standort geht
assert.ok(![...store.m.values()].some(v => v.includes(anna.ip)), 'IP nie im Klartext gespeichert');

// Wichtigste zuerst, kompakte Liste
uhr += 10 * 60e3;
await api.melden({ standortId: 'node/1', typ: 'gesperrt' }, bob);
let liste = await api.standort('node/1');
assert.deepEqual(liste.map(m => m.typ), ['gesperrt', 'parkplatz_voll']);
let aktiv = await api.aktiv();
assert.deepEqual(aktiv.find(a => a.standortId === 'node/1'), { standortId: 'node/1', n: 2, typ: 'gesperrt' });
assert.deepEqual(aktiv.find(a => a.standortId === 'node/2'), { standortId: 'node/2', n: 1, typ: 'hindernis' });

// Bestätigen: einmal pro Gerät, verlängert die 24 h nicht
const voll = liste.find(m => m.typ === 'parkplatz_voll');
r = await api.bestaetigen(voll.id, true, bob);
assert.equal(r.standortId, 'node/1'); assert.equal(r.meldungen.find(m => m.id === voll.id).bestaetigt, 1);
await rejects(api.bestaetigen(voll.id, false, bob), 429, 'schon bewertet');
await rejects(api.bestaetigen(voll.id, 'ja', carl), 400);
await rejects(api.bestaetigen('abcdef1234567890', true, carl), 404);

// Widerspruch: „Nicht mehr“ übersteigt „Stimmt noch“ um 3 → ausgeblendet
const sperr = liste.find(m => m.typ === 'gesperrt');
await api.bestaetigen(sperr.id, false, anna);
await api.bestaetigen(sperr.id, false, carl);
assert.ok((await api.standort('node/1')).some(m => m.id === sperr.id), 'bei 2 Widersprüchen noch sichtbar');
r = await api.bestaetigen(sperr.id, false, dora);
assert.ok(!r.meldungen.some(m => m.id === sperr.id), 'bei 3 mehr Widerspruch ausgeblendet');
assert.equal((await api.aktiv()).find(a => a.standortId === 'node/1').typ, 'parkplatz_voll', 'Übersicht folgt');

// „Alles frei“ blendet ältere „Parkplatz voll“/„Warteschlange“ aus, nicht aber „Rampe rutschig“
uhr += 5 * 60e3;
await api.melden({ standortId: 'way/3', typ: 'warteschlange' }, anna);
await api.melden({ standortId: 'way/3', typ: 'rampe_rutschig' }, bob);
uhr += 60e3;
await api.melden({ standortId: 'way/3', typ: 'alles_frei' }, carl);
assert.deepEqual((await api.standort('way/3')).map(m => m.typ), ['rampe_rutschig', 'alles_frei']);
uhr += 60e3;
await api.melden({ standortId: 'way/3', typ: 'parkplatz_voll' }, dora);   // neuer als „alles frei“ → sichtbar
assert.deepEqual((await api.standort('way/3')).map(m => m.typ), ['rampe_rutschig', 'parkplatz_voll', 'alles_frei']);

// Nach 1 h darf wieder gemeldet werden
uhr += H;
await api.melden({ standortId: 'node/1', typ: 'warteschlange' }, anna);

// Ablauf nach 24 h: nicht mehr ausgeliefert, beim Zugriff gelöscht; Bestätigung setzt die Zeit nicht zurück
uhr = Date.parse('2026-10-22T10:00:00Z') + 24 * H + 1;
liste = await api.standort('node/1');
assert.deepEqual(liste.map(m => m.typ), ['warteschlange'], 'erste Meldungen (trotz Bestätigung) nach 24 h weg');
assert.ok(!JSON.stringify(await store.get('ort/node/1')).includes('parkplatz_voll'), 'abgelaufene Meldung gelöscht');
assert.equal((await api.standort('node/2')).length, 0);
assert.equal(await store.get('ort/node/2'), null);

// Aufräumen: Sperr-Einträge älter als 24 h weg
uhr += 2 * H;
const vorher = [...store.m.keys()].filter(k => k.startsWith('sperre/')).length;
const ar = await api.aufraeumen();
const nachher = [...store.m.keys()].filter(k => k.startsWith('sperre/')).length;
assert.ok(vorher > 0 && ar.geloescht > 0 && nachher < vorher, `Sperren aufgeräumt (${vorher} → ${nachher})`);
assert.ok(!(await api.aktiv()).some(a => a.standortId === 'node/2'));

// sichtbare(): reine Funktion
assert.deepEqual(sichtbare([{ typ: 'alles_frei', erstelltAm: 5, bestaetigt: 0, widersprochen: 0 }, { typ: 'warteschlange', erstelltAm: 4, bestaetigt: 0, widersprochen: 0 }], 10).map(m => m.typ), ['alles_frei']);

// HTTP-Schicht
const s2 = fakeStore();
const ctx = (extra = {}) => ({ store: s2, salz: 'geheim', ip: '203.0.113.5', jetzt: () => uhr, standortGibtEs: async (id) => GIBT.has(id), ...extra });
const req = (method, path, body, headers = {}) => new Request('https://test.example' + path, { method, body: body ? JSON.stringify(body) : undefined,
  headers: { 'content-type': 'application/json', 'x-geraet': 'http-geraet-000000000001', ...headers } });
let res = await handle(req('POST', '/api/meldungen', { standortId: 'node/1', typ: 'gesperrt', notiz: 'Tor zu' }), ctx());
assert.equal(res.status, 201);
const neu = (await res.json()).meldung;
res = await handle(req('POST', '/api/meldungen', { standortId: 'node/1', typ: 'gesperrt' }), ctx());
assert.equal(res.status, 429); assert.match((await res.json()).fehler, /gerade schon gemeldet/);
res = await handle(req('GET', '/api/meldungen?standort=node%2F1'), ctx());
assert.equal(res.status, 200); assert.equal(res.headers.get('cache-control'), 'no-store');
assert.equal((await res.json()).meldungen[0].notiz, 'Tor zu');
res = await handle(req('GET', '/api/meldungen/aktiv'), ctx());
assert.ok(res.headers.get('netlify-cdn-cache-control').includes('s-maxage=60'));
assert.deepEqual((await res.json()).aktiv, [{ standortId: 'node/1', n: 1, typ: 'gesperrt' }]);
res = await handle(req('POST', `/api/meldungen/${neu.id}/bestaetigen`, { stimmt: true }, { 'x-geraet': 'anderes-geraet-0000001' }), ctx({ ip: '198.51.100.1' }));
assert.equal(res.status, 200); assert.equal((await res.json()).meldungen[0].bestaetigt, 1);
res = await handle(req('POST', '/api/meldungen', { standortId: 'node/2', typ: 'gesperrt' }), ctx({ salz: '' }));
assert.equal(res.status, 503, 'ohne Salz keine Meldungen');
res = await handle(req('DELETE', '/api/meldungen'), ctx());
assert.equal(res.status, 405);
res = await handle(new Request('https://test.example/api/meldungen', { method: 'POST', body: '{kaputt', headers: { 'x-geraet': 'http-geraet-000000000001' } }), ctx());
assert.equal(res.status, 400);

console.log('meldungen: alle Tests OK');

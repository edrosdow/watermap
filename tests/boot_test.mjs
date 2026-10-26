// „Wichtig für dein Boot“ (public/js/model.js → bootPunkte): Ampel nur aus vorhandenen Angaben, nichts erfunden.
import assert from 'node:assert/strict';
import { bootPunkte } from '../public/js/model.js';

const k = (p) => Object.fromEntries(bootPunkte(p).map(x => [x.titel, [x.wert, x.ton]]));

const leer = k({ attrs: {} });
assert.deepEqual(Object.keys(leer), ['Zugang', 'Gebühr', 'Rampe', 'Trailer parken', 'Motorboote', 'Bootsgröße']);
for (const [t, [w, ton]] of Object.entries(leer)) { assert.equal(w, 'Unbekannt', t); assert.equal(ton, 'unb', t); }

const voll = k({ access: 'public', fee: true, fee_note: '5 € pro Tag', attrs: { surface: 'Beton', incline: 'flach', trailer_parking: true, motorboat: false, suitable_boats: 'bis 6 m' } });
assert.deepEqual(voll['Zugang'], ['Öffentlich', 'ok']);
assert.deepEqual(voll['Gebühr'], ['Kostenpflichtig – 5 € pro Tag', 'warn']);
assert.deepEqual(voll['Rampe'], ['Beton · flach', 'ok']);
assert.deepEqual(voll['Trailer parken'], ['Ja', 'ok']);
assert.deepEqual(voll['Motorboote'], ['Nicht erlaubt', 'stop']);
assert.deepEqual(voll['Bootsgröße'], ['bis 6 m', 'ok']);

assert.deepEqual(k({ access: 'private', fee: false, attrs: {} })['Zugang'], ['Privat / gesperrt', 'stop']);
assert.deepEqual(k({ access: 'customers', attrs: {} })['Zugang'][1], 'warn');
assert.deepEqual(k({ fee: false, attrs: {} })['Gebühr'], ['Kostenlos', 'ok']);
assert.deepEqual(k({ attrs: { parking: true } })['Trailer parken'], ['Parkplatz da, Trailer unklar', 'warn']);
assert.deepEqual(k({ attrs: { trailer_parking: false } })['Trailer parken'], ['Nein', 'stop']);
assert.deepEqual(k({ attrs: { suitable_trailers: 'Kleintrailer' } })['Bootsgröße'], ['Trailer: Kleintrailer', 'ok']);
console.log('boot: alle Tests OK');

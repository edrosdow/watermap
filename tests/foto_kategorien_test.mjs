// Tests für public/js/foto-kategorien.js (node tests/foto_kategorien_test.mjs).
import assert from 'node:assert/strict';
import { FOTO_KATEGORIEN, kategorieAus, fotoFilter } from '../public/js/foto-kategorien.js';

assert.deepEqual(Object.keys(FOTO_KATEGORIEN), ['rampe', 'steg', 'zufahrt', 'parkplatz', 'umgebung', 'sonstiges']);
assert.equal(kategorieAus('rampe'), 'rampe');
assert.equal(kategorieAus(' Parkplatz '), 'parkplatz');
assert.equal(kategorieAus('Rampe, Steg'), null, 'alte Mehrfachauswahl');
assert.equal(kategorieAus(''), null);
assert.equal(kategorieAus(undefined), null);

const ph = (kategorie) => ({ url: `photos/${Math.random()}.jpg`, kategorie });
assert.deepEqual(fotoFilter([]), []);
assert.deepEqual(fotoFilter([ph('rampe'), ph('rampe'), ph(null)]), [], 'nur eine Kategorie: keine Filter');
assert.deepEqual(fotoFilter([ph('parkplatz'), ph('rampe'), ph('rampe'), ph(null), ph('quatsch')]),
  [{ key: null, text: 'Alle', n: 5 }, { key: 'rampe', text: 'Rampe', n: 2 }, { key: 'parkplatz', text: 'Parkplatz', n: 1 }], 'feste Reihenfolge, Alle zählt alle');
console.log('foto-kategorien.js: alle Tests OK');

// Tests für den Vorhersage-Satz (public/js/pegel-vorhersage.js, auch im Push-Text): node tests/pegel_vorhersage_test.mjs
import assert from 'node:assert/strict';
import { vorhersageSatz } from '../public/js/pegel-vorhersage.js';

const jetzt = new Date(2026, 9, 29, 12).getTime();   // Donnerstag
const reihe = (werte, tage = 3) => werte.map((v, i) => ({ t: jetzt + (i + 1) * (tage * 864e5 / werte.length), v, art: 'forecast' }));
const gm = (value) => ({ id: 'x', name: 'Minden', state: 'low', value, trend: null, refs: { MNW: 98, MW: 210, MHW: 480, HSW: 590 }, tide: false });
assert.equal(vorhersageSatz(gm(96), reihe([93, 92, 91]), jetzt), 'Vorhersage: bleibt bis Sonntag knapp unter MNW (91–93 cm).');
assert.equal(vorhersageSatz(gm(96), reihe([80, 75, 70]), jetzt), 'Vorhersage: bleibt bis Sonntag unter MNW (70–80 cm).');
assert.equal(vorhersageSatz(gm(120), reihe([110, 100, 95]), jetzt), 'Vorhersage: fällt bis Sonntag unter MNW (bis 95 cm).');
assert.equal(vorhersageSatz(gm(96), reihe([97, 105, 120]), jetzt), 'Vorhersage: steigt bis Sonntag wieder über MNW (bis 120 cm).');
assert.equal(vorhersageSatz(gm(300), reihe([300, 320, 350]), jetzt), 'Vorhersage: bleibt bis Sonntag im normalen Bereich (300–350 cm).');
assert.equal(vorhersageSatz(gm(400), reihe([450, 500, 520]), jetzt), 'Vorhersage: steigt bis Sonntag über MHW (bis 520 cm).');
assert.equal(vorhersageSatz(gm(96), reihe([93, 92], 1), jetzt), 'Vorhersage: bleibt bis morgen knapp unter MNW (92–93 cm).');
assert.equal(vorhersageSatz({ ...gm(50), refs: {} }, reihe([50, 60]), jetzt), 'Vorhersage: bis Sonntag zwischen 50–60 cm.');
assert.equal(vorhersageSatz(gm(96), []), null); assert.equal(vorhersageSatz(gm(96), null), null);
console.log('pegel_vorhersage_test: OK');

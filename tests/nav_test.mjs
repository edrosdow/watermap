// Tests für die reinen Teile der Navigation (public/js/nav.js) und die „neu“-Zahl der Meldungen (public/js/meldungen.js): node tests/nav_test.mjs
import assert from 'node:assert/strict';
import { NAV, NAV_ZIEL, badgeText, navLabel } from '../public/js/nav.js';
import { neueAnzahl } from '../public/js/meldungen.js';

assert.deepEqual(NAV.map(n => n.id), ['karte', 'pegel', 'melden', 'meldungen', 'mehr']);
assert.equal(NAV.filter(n => n.center).length, 1);
assert.deepEqual(NAV_ZIEL, { naehe: 'mehr', favoriten: 'mehr' });

assert.equal(badgeText(1), '1');
assert.equal(badgeText(99), '99');
assert.equal(badgeText(100), '99+');
const meldungen = NAV.find(n => n.id === 'meldungen');
assert.equal(navLabel(meldungen), 'Meldungen');
assert.equal(navLabel(meldungen, 0), 'Meldungen');
assert.equal(navLabel(meldungen, 3), 'Meldungen, 3 neu');
assert.equal(navLabel(meldungen, 150), 'Meldungen, über 99 neu');

const m = (id, t) => ({ id, erstelltAm: t });
const liste = [m('a', 1000), m('b', 2000), m('c', 3000)];
assert.equal(neueAnzahl(liste, { gesehen: 0, eigene: [] }), 3, 'noch nie angesehen: alle neu');
assert.equal(neueAnzahl(liste, { gesehen: 1000, eigene: [] }), 2, 'nur neuere als der letzte Besuch (gleich alt zählt nicht)');
assert.equal(neueAnzahl(liste, { gesehen: 3000, eigene: [] }), 0);
assert.equal(neueAnzahl(liste, { gesehen: 0, eigene: ['b'] }), 2, 'eigene Meldungen zählen nicht');
assert.equal(neueAnzahl(liste, { gesehen: 1500, eigene: ['c'] }), 1);
assert.equal(neueAnzahl(null, { gesehen: 0, eigene: [] }), 0);
assert.equal(neueAnzahl([null, m('x', 5000)], { gesehen: 0, eigene: [] }), 1, 'ungültige Einträge werden übersprungen');
assert.equal(neueAnzahl(liste), 3, 'ohne Speicher (kein localStorage): alle neu');
console.log('nav.js / neueAnzahl: alle Tests OK');

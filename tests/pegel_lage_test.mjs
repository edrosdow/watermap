// Tests für den Lage-Satz und den Wochenend-Ausblick (public/js/pegel-lage.js): node tests/pegel_lage_test.mjs
import assert from 'node:assert/strict';
import { lageText, lageSatz, wochenendTage, tageAusStunden, wochenendEtiketten } from '../public/js/pegel-lage.js';

const g = (name, state, trend = null, extra = {}) => ({ id: name, name, state, trend, refs: { MNW: 100, MHW: 400 }, tide: false, ...extra });

// Satz: normale nur zählen, auffällige mit Namen und Trend
assert.equal(lageText([{ g: g('Vlotho', 'normal') }, { g: g('Petershagen', 'normal') }, { g: g('Minden', 'low', -1) }, { g: g('Trier', 'hsw', 0) }]),
  'Deine 4 Pegel: 2 normal, Minden niedrig und fallend, Trier über HSW.');
assert.equal(lageText([{ g: g('Vlotho', 'normal') }, { g: g('Minden', 'low', -1) }, { g: g('Trier', 'hsw') }]), 'Deine 3 Pegel: 1 normal, Minden niedrig und fallend, Trier über HSW.');
assert.equal(lageText([{ g: g('A', 'normal') }, { g: g('B', 'normal') }]), 'Deine 2 Pegel: 2 normal.');
assert.equal(lageText([{ g: g('Minden', 'high', 1) }, { g: g('B', 'normal') }]), 'Deine 2 Pegel: 1 normal, Minden hoch und steigend.');
// gleichbleibend wird nicht genannt, veraltet ohne Trend
assert.equal(lageText([{ g: g('Minden', 'low', 0) }, { g: g('B', 'old', 1) }]), 'Deine 2 Pegel: Minden niedrig, B veraltet.');
// ein Pegel
assert.equal(lageText([{ g: g('Vlotho', 'normal') }]), 'Dein Pegel Vlotho: normal.');
assert.equal(lageText([{ g: g('Minden', 'low', -1) }]), 'Dein Pegel Minden: niedrig und fallend.');
// Tide: auflaufend/ablaufend statt niedrig/hoch
assert.equal(lageText([{ g: g('Cuxhaven', 'unknown', null, { tide: true, refs: {} }), tide: 'auflaufend' }, { g: g('B', 'normal') }]), 'Deine 2 Pegel: 1 normal, Cuxhaven auflaufend.');
// Tonfarbe nie allein: jede Farbe hat den Text dazu
const teile = lageSatz([{ g: g('A', 'normal') }, { g: g('Minden', 'low', -1) }]);
assert.ok(teile.some(t => t.ton === 'gelb' && /niedrig/.test(t.text)));
// keine gemerkten Pegel: kein Satz
assert.equal(lageSatz([]), null); assert.equal(lageSatz(null), null);

// Wochenend-Tage
const d = (s) => new Date(s + 'T10:00:00');
const tage = (s) => wochenendTage(d(s)).tage.map(t => t.toDateString());
assert.deepEqual(tage('2026-10-28'), [new Date(2026, 9, 31).toDateString(), new Date(2026, 10, 1).toDateString()]);   // Mittwoch → Sa/So
assert.deepEqual(tage('2026-10-30'), [new Date(2026, 9, 31).toDateString(), new Date(2026, 10, 1).toDateString()]);   // Freitag
assert.deepEqual(tage('2026-10-31'), [new Date(2026, 9, 31).toDateString(), new Date(2026, 10, 1).toDateString()]);   // Samstag: heute + morgen
assert.deepEqual(tage('2026-11-01'), [new Date(2026, 10, 1).toDateString(), new Date(2026, 10, 2).toDateString()]);   // Sonntag: heute + morgen
assert.equal(wochenendTage(d('2026-10-28')).titel, 'Am Wochenende an deinen Pegeln');
assert.equal(wochenendTage(d('2026-11-01')).titel, 'Heute und morgen an deinen Pegeln');

// Tageswerte aus Stundenwerten (nur 6–21 Uhr, Maxima, Symbol am Mittag)
const stunden = [];
for (let h = 0; h < 24; h++) stunden.push({ t: new Date(2026, 9, 31, h).getTime(), temp: 8 + h / 2, icon: h >= 12 ? 'rain' : 'cloudy', wind: 10 + h, gust: h === 3 ? 90 : 20 + h });
const [sa, so] = tageAusStunden(stunden, [new Date(2026, 9, 31), new Date(2026, 10, 1)]);
assert.equal(so, null);   // keine Daten für den Sonntag
assert.equal(sa.name, 'Samstag'); assert.equal(sa.icon, 'rain'); assert.equal(sa.gustKmh, 41);   // die Böe um 3 Uhr zählt nicht
assert.equal(sa.windKmh, 31); assert.equal(sa.temp, 8 + 21 / 2);

// Etiketten
const n = g('A', 'normal'), niedrig = g('Minden', 'low', -1), hoch = g('Trier', 'hsw');
assert.deepEqual(wochenendEtiketten({ pegel: [n, g('B', 'normal')], boeKmh: 20 }), [{ text: 'gute Bedingungen', ton: 'gruen' }]);
assert.deepEqual(wochenendEtiketten({ pegel: [n], boeKmh: 45 }), [{ text: 'windig', ton: 'gelb' }]);   // Böen ab 39 km/h
assert.deepEqual(wochenendEtiketten({ pegel: [n, niedrig], boeKmh: 20 }), [{ text: 'Minden knapp', ton: 'gelb' }]);
assert.deepEqual(wochenendEtiketten({ pegel: [n, hoch], boeKmh: 20 }), [{ text: 'Hochwasser', ton: 'rot' }]);
assert.deepEqual(wochenendEtiketten({ pegel: [n, g('Vlotho', 'normal')], boeKmh: 20, vorhersageNiedrig: ['Vlotho'] }), [{ text: 'Vlotho knapp', ton: 'gelb' }]);   // laut Vorhersage
assert.deepEqual(wochenendEtiketten({ pegel: [n], boeKmh: null }), []);   // ohne Wetterdaten keine Zusage „gute Bedingungen“
console.log('pegel_lage_test: OK');

// Wochenend-Tabelle: eine Zelle je Pegel und Tag
import { zelle } from '../public/js/pegel-lage.js';
const tag = (wind, gust) => ({ windKmh: wind, gustKmh: gust });
assert.deepEqual(zelle(g('A', 'normal'), tag(10, 20)), { ton: 'gruen', text: 'Wind 2 Bft' });
assert.deepEqual(zelle(g('A', 'normal'), tag(12, 45)), { ton: 'gelb', text: 'Böen 6 Bft' });
assert.deepEqual(zelle(g('Minden', 'low'), tag(12, 45)), { ton: 'gelb', text: 'Pegel knapp' });   // Pegel geht vor Wind
assert.deepEqual(zelle(g('Trier', 'hsw'), tag(10, 20)), { ton: 'rot', text: 'Hochwasser' });
assert.deepEqual(zelle(g('Cochem', 'high'), tag(10, 20)), { ton: 'rot', text: 'Hochwasser' });
assert.deepEqual(zelle(g('Cux', 'unknown', null, { tide: true, refs: {} }), tag(10, 20)), { ton: 'grau', text: 'Wind 2 Bft' });
assert.equal(zelle(g('A', 'normal'), null), null);   // ohne Wetter keine Zelle
console.log('pegel_lage_test (Zellen): OK');

// Vorhersage
import { vorhersageSatz, vorhersageTag, vorhersageZustand } from '../public/js/pegel-lage.js';
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
const samstag = new Date(2026, 9, 31);
const wv = [{ t: new Date(2026, 9, 31, 8).getTime(), v: 95 }, { t: new Date(2026, 9, 31, 20).getTime(), v: 101 }, { t: new Date(2026, 10, 1, 8).getTime(), v: 120 }];
assert.deepEqual(vorhersageTag(wv, samstag), { min: 95, max: 101 });
assert.equal(vorhersageTag(wv, new Date(2026, 10, 2)), null);
assert.equal(vorhersageZustand(gm(96), { min: 95, max: 101 }), 'low');
assert.equal(vorhersageZustand(gm(96), { min: 120, max: 130 }), 'normal');
assert.equal(vorhersageZustand(gm(96), { min: 400, max: 500 }), 'high');
assert.equal(vorhersageZustand({ ...gm(96), refs: {} }, { min: 1, max: 2 }), null);
// Zelle: Vorhersage geht vor dem Stand heute
assert.deepEqual(zelle(g('Vlotho', 'normal'), tag(10, 20), 'low'), { ton: 'gelb', text: 'Pegel knapp' });
assert.deepEqual(zelle(g('Minden', 'low'), tag(10, 20), 'normal'), { ton: 'gruen', text: 'Wind 2 Bft' });
assert.deepEqual(zelle(g('Trier', 'normal'), tag(10, 20), 'high'), { ton: 'rot', text: 'Hochwasser' });
console.log('pegel_lage_test (Vorhersage): OK');

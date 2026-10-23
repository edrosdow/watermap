// Tests: Trend aus PEGELONLINE (auch als Text) und Ersatz aus dem Verlauf. Start: node tests/pegel_trend_test.mjs
import assert from 'node:assert/strict';
import { trendAusVerlauf } from '../public/js/pegel-daten.js';
import { normalizeStation } from '../public/js/pegel.js';

const H = 3600e3;
const reihe = (f, stunden = 4) => Array.from({ length: stunden * 4 + 1 }, (_, i) => ({ t: i * 0.25 * H, v: f(i) }));
assert.equal(trendAusVerlauf(reihe(i => 100 + i)), 1, 'steigend');
assert.equal(trendAusVerlauf(reihe(i => 100 - i)), -1, 'fallend');
assert.equal(trendAusVerlauf(reihe(() => 100)), 0, 'gleich');
assert.equal(trendAusVerlauf(reihe(i => 100 + i * 0.1)), 0, 'unter 2 cm in 2 h: gleich');
assert.equal(trendAusVerlauf([{ t: 0, v: 1 }]), null, 'zu kurz');
assert.equal(trendAusVerlauf(reihe(i => i, 1)), null, 'unter 2 h: kein Trend');

const st = (trend) => ({ uuid: 'x', latitude: 50, longitude: 7, water: { shortname: 'RHEIN' },
  timeseries: [{ shortname: 'W', unit: 'cm', currentMeasurement: { timestamp: new Date().toISOString(), value: 100, ...(trend === undefined ? {} : { trend }) } }] });
assert.equal(normalizeStation(st(-1)).trend, -1);
assert.equal(normalizeStation(st('1')).trend, 1, 'Trend als Text');
assert.equal(normalizeStation(st(undefined)).trend, null, 'ohne Trend');
assert.equal(normalizeStation(st(null)).trend, null, 'Trend null');
assert.equal(normalizeStation(st(-999)).trend, null, 'unbekannter Wert');
console.log('pegel_trend_test: ok');

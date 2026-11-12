// Tests: Trend aus PEGELONLINE (auch als Text), Ersatz aus dem Verlauf, Änderung in 24 h, Messlücken. Start: node tests/pegel_trend_test.mjs
import assert from 'node:assert/strict';
import { aenderung24h } from '../public/js/pegel-daten.js';
import { normalizeStation, messluecken } from '../public/js/pegel.js';

const H = 3600e3;
const reihe = (f, stunden = 4) => Array.from({ length: stunden * 4 + 1 }, (_, i) => ({ t: i * 0.25 * H, v: f(i) }));

const st = (trend) => ({ uuid: 'x', latitude: 50, longitude: 7, water: { shortname: 'RHEIN' },
  timeseries: [{ shortname: 'W', unit: 'cm', currentMeasurement: { timestamp: new Date().toISOString(), value: 100, ...(trend === undefined ? {} : { trend }) } }] });
assert.equal(normalizeStation(st(-1)).trend, -1);
assert.equal(normalizeStation(st('1')).trend, 1, 'Trend als Text');
assert.equal(normalizeStation(st(undefined)).trend, null, 'ohne Trend');
assert.equal(normalizeStation(st(null)).trend, null, 'Trend null');
assert.equal(normalizeStation(st(-999)).trend, null, 'unbekannter Wert');
// Tide-Kennwerte: auch als Text, Einheit „cm“ mit Zusatz; ohne erkannte Werte bleiben die gelieferten Namen sichtbar
const tideSt = (cv) => ({ uuid: 't', latitude: 53.87, longitude: 8.72, water: { shortname: 'ELBE' },
  timeseries: [{ shortname: 'W', unit: 'cm', characteristicValues: cv, currentMeasurement: { timestamp: new Date().toISOString(), value: 500 } }] });
const t1 = normalizeStation(tideSt([{ shortname: 'MThw', unit: 'cm', value: 651 }, { shortname: 'MTnw', unit: 'cm über PNP', value: '358,5' }]));
assert.deepEqual(t1.tideRefs, { MThw: 651, MTnw: 358.5 });
assert.ok(t1.tide && !t1.tideRoh);
const t2 = normalizeStation(tideSt([{ shortname: 'MHThw', unit: 'cm', value: 700 }]));
assert.ok(t2.tide);
assert.deepEqual(t2.tideRoh, ['MHThw=700 cm']);
assert.ok(!normalizeStation(tideSt([{ shortname: 'MNW', unit: 'cm', value: 100 }])).tide, 'MNW ist kein Tidekennwert');

// Pegelkarte (7.49.0): Richtung aus der Änderung in 24 h, Messlücken

// Änderung in 24 h aus Messwerten mit unterschiedlichem Abstand
const t0 = Date.UTC(2026, 10, 1, 12);
const viertel = Array.from({ length: 4 * 30 + 1 }, (_, i) => ({ t: t0 + i * H / 4, v: 200 + i / 4 }));   // 30 h, +1 cm/h
assert.equal(aenderung24h(viertel), 24);
const stuendlich = Array.from({ length: 26 }, (_, i) => ({ t: t0 + i * H, v: 300 - i }));
assert.equal(aenderung24h(stuendlich), -24);
assert.equal(aenderung24h(stuendlich.slice(-10)), null);   // weniger als 24 h → keine Angabe
assert.equal(aenderung24h([]), null); assert.equal(aenderung24h(null), null);

// Messlücken: deutlich länger als der übliche Abstand, mindestens 90 Minuten
const mitLuecke = viertel.filter(p => !(p.t > t0 + 10 * H && p.t < t0 + 14 * H));
const l = messluecken(mitLuecke);
assert.equal(l.length, 1); assert.equal(l[0][0], t0 + 10 * H); assert.equal(l[0][1], t0 + 14 * H);
assert.deepEqual(messluecken(viertel), []);
assert.deepEqual(messluecken(stuendlich), []);   // stündlich messende Pegel: keine Lücken
const stLuecke = stuendlich.filter((_, i) => i !== 5 && i !== 6);   // 3 h ohne Wert bei stündlicher Messung
assert.equal(messluecken(stLuecke).length, 1);
assert.deepEqual(messluecken([{ t: 1, v: 1 }, { t: 2, v: 2 }]), []);
console.log('pegel_trend_test: ok');

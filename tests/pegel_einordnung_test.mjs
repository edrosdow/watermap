// Tests für die kurzfristige Tendenz und die Änderung (public/js/pegel-einordnung.js): node tests/pegel_einordnung_test.mjs
import assert from 'node:assert/strict';
import { tendenz, tendenzText, aenderungKurz } from '../public/js/pegel-einordnung.js';

// Tendenz der letzten 2 Stunden – getrennt von der Änderung in 24 h
const H = 3600e3, t0 = Date.UTC(2026, 10, 2, 12);
const reihe = (f, n = 4 * 30) => Array.from({ length: n + 1 }, (_, i) => ({ t: t0 + i * H / 4, v: f(i) }));
// 24 h gestiegen, aber in den letzten 2 h gefallen: beides stimmt, nur für verschiedene Zeiträume
const pts = reihe(i => (i < 112 ? 100 + i / 8 : 114 - (i - 112) * 0.5));
const t = tendenz(pts);
assert.deepEqual(t, { d: -4, richtung: -1, stunden: 2 });
assert.equal(tendenzText(t), '↘ fallend, −4 cm');
assert.equal(tendenzText(tendenz(reihe(() => 100))), '→ gleichbleibend, ±0 cm');
assert.equal(tendenz(reihe(i => 100 + i, 12))?.richtung, 1);
assert.equal(tendenz(reihe(i => i, 4)), null, 'kürzer als 2 h → keine Tendenz');
assert.equal(tendenz([{ t: 0, v: 1 }, { t: 5 * H, v: 3 }]), null, 'kein Messwert nahe 2 h vorher');
assert.equal(tendenz(null), null);
assert.equal(tendenzText(null), null);
assert.equal(aenderungKurz(1), '+1 cm'); assert.equal(aenderungKurz(-6), '−6 cm'); assert.equal(aenderungKurz(0), '±0 cm'); assert.equal(aenderungKurz(null), null);
console.log('pegel_einordnung_test: OK');

// Zusatzwerte: veraltete oder fehlende Werte nie als 0 °C (pegel.js)
import { zusatzAusStation } from '../public/js/pegel.js';
const jetztZ = Date.parse('2026-11-02T21:40:00+01:00');
const station = (wt, extra = []) => ({ timeseries: [
  { shortname: 'W', unit: 'cm', characteristicValues: [
    { shortname: 'M_I', longname: 'Marke_I', unit: 'cm', value: 300 }, { shortname: 'HSW', longname: 'höchster Schifffahrtswasserstand', unit: 'cm', value: 310 },
    { shortname: 'MNW', longname: 'Mittel der Niedrigwasserstände ', unit: 'cm', value: 117, timespanStart: '1996-11-01', timespanEnd: '2006-10-31' },
    { shortname: 'NNW', longname: 'Niedrigster Niedrigwasserstand', unit: 'cm', value: 50, occurrences: ['1953-09-09'] },
    { shortname: 'X', longname: 'ohne Wert', unit: 'cm', value: null }] },
  ...(wt ? [{ shortname: 'WT', unit: '°C', currentMeasurement: wt }] : []), ...extra] });
assert.equal(zusatzAusStation(station({ timestamp: '2026-10-29T14:30:00+01:00', value: 0.0 }), jetztZ).wt, null, 'Celle: 0,0 °C vom 29.10. ist veraltet');
assert.deepEqual(zusatzAusStation(station({ timestamp: '2026-11-02T21:30:00+01:00', value: 0 }), jetztZ).wt, { v: 0, t: Date.parse('2026-11-02T21:30:00+01:00'), unit: '°C' }, 'echte 0 °C bleiben');
assert.equal(zusatzAusStation(station({ timestamp: '2026-11-02T21:30:00+01:00', value: null }), jetztZ).wt, null);
assert.equal(zusatzAusStation(station({ timestamp: '2026-11-02T21:30:00+01:00' }), jetztZ).wt, null);
assert.equal(zusatzAusStation(station({ value: 12 }), jetztZ).wt, null, 'ohne Zeitstempel kein Wert');
assert.equal(zusatzAusStation(station({ timestamp: '2026-11-02T21:30:00+01:00', value: '12' }), jetztZ).wt, null, 'Text ist kein Messwert');
assert.equal(zusatzAusStation(station(null), jetztZ).wt, null, 'ohne Zeitreihe');
assert.equal(zusatzAusStation({}, jetztZ).wt, null);
assert.equal(zusatzAusStation(station(null, [{ shortname: 'Q', unit: 'm³/s', currentMeasurement: { timestamp: '2026-11-02T05:00:00+01:00', value: 10.6 } }]), jetztZ).q.v, 10.6, 'Abfluss von heute früh gilt');
const kw = zusatzAusStation(station(null), jetztZ).kennwerte;
assert.deepEqual(kw.map(k => k.k), ['NNW', 'MNW', 'M I', 'HSW'], 'alle Kennwerte nach Wert, ohne leere');
assert.equal(kw.find(k => k.k === 'MNW').name, 'Mittel der Niedrigwasserstände');
assert.equal(kw.find(k => k.k === 'MNW').zeitraum, '1996–2006');
assert.equal(kw.find(k => k.k === 'NNW').datum, '1953');
assert.equal(kw.find(k => k.k === 'HSW').name, 'Höchster Schifffahrtswasserstand');
assert.equal(kw.find(k => k.k === 'M I').name, 'Marke I');
console.log('pegel_einordnung_test (Zusatzwerte): OK');

// Balken „Niedrig · Normal · Hoch“
import { zonenLage } from '../public/js/pegel-einordnung.js';
const r = { MNW: 113, MW: 170, MHW: 440 };
assert.equal(zonenLage(r, 109).zone, 'low'); assert.ok(zonenLage(r, 109).pos > 18 && zonenLage(r, 109).pos < 22, 'knapp unter MNW: rechts im Bereich Niedrig');
assert.equal(zonenLage(r, 113).pos, 22); assert.equal(zonenLage(r, 440).pos, 78);
assert.equal(zonenLage(r, 276.5).zone, 'normal'); assert.equal(zonenLage(r, 276.5).pos, 50);
assert.equal(zonenLage(r, -100).pos, 0, 'weit darunter: linker Rand');
assert.equal(zonenLage(r, 2000).pos, 100, 'weit darüber: rechter Rand');
assert.equal(zonenLage(r, 500).zone, 'high');
assert.equal(zonenLage({ MNW: 113 }, 109), null); assert.equal(zonenLage({ MNW: 200, MHW: 100 }, 150), null); assert.equal(zonenLage(r, NaN), null);
console.log('pegel_einordnung_test (Balken): OK');

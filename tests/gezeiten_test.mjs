// Tests der Tide-Auswertung (public/js/gezeiten.js) mit einer Beispielkurve. Start: node tests/gezeiten_test.mjs
import assert from 'node:assert/strict';
import { istTidepegel, glaetten, extreme, tendenz, einordnung, auswerten } from '../public/js/gezeiten.js';

const MIN = 60e3, STD = 3600e3, PERIODE = 12.42 * STD;
const T0 = Date.UTC(2026, 9, 24, 0, 0);
// Tidekurve: Mittel 480, Amplitude 150 (HW ≈ 630, NW ≈ 330), HW bei T0 + 3 h, Messwerte alle 5 Minuten mit Rauschen
let saat = 1;
const rauschen = () => { saat = (saat * 16807) % 2147483647; return (saat / 2147483647 - 0.5) * 6; };
const kurve = (stunden, schritt = 5, amp = 150) => Array.from({ length: stunden * 60 / schritt + 1 }, (_, i) => {
  const t = T0 + i * schritt * MIN;
  return { t, v: Math.round(480 + amp * Math.cos(2 * Math.PI * (t - T0 - 3 * STD) / PERIODE) + rauschen()) };
});

assert.ok(istTidepegel({ tide: true, refs: {} }));
assert.ok(!istTidepegel({ tide: true, refs: { MNW: 100, MHW: 300 } }), 'mit MNW/MHW kein Tidepegel');
assert.ok(!istTidepegel({ tide: false, refs: {} }));

const g = glaetten([{ t: 0, v: 0 }, { t: 10 * MIN, v: 10 }, { t: 20 * MIN, v: 20 }], 10);
assert.deepEqual(g.map(p => p.v), [5, 10, 15], 'gleitender Mittelwert');

const pts = kurve(48);
const ex = extreme(pts);
const hws = ex.filter(e => e.typ === 'HW'), nws = ex.filter(e => e.typ === 'NW');
assert.ok(hws.length >= 3 && nws.length >= 3, `Extreme gefunden (${ex.map(e => e.typ).join(',')})`);
assert.ok(ex.every((e, i) => !i || e.typ !== ex[i - 1].typ), 'Hoch- und Niedrigwasser wechseln sich ab');
for (const [k, e] of hws.entries()) {
  const soll = T0 + 3 * STD + (k + (hws[0].t > T0 + 6 * STD ? 1 : 0)) * PERIODE;
  assert.ok(Math.abs(e.t - soll) < 25 * MIN, `HW-Zeit ±25 min (${new Date(e.t).toISOString()} statt ${new Date(soll).toISOString()})`);
  assert.ok(Math.abs(e.v - 630) <= 5, `HW-Wert ≈ 630 (${e.v})`);
}
assert.ok(nws.every(e => Math.abs(e.v - 330) <= 5), 'NW-Werte ≈ 330');
assert.ok(ex.every(e => e.t - pts[0].t >= STD && pts[pts.length - 1].t - e.t >= STD), 'nur bestätigte Extreme (nicht am Rand)');

// Tendenz: steigend nach NW, fallend nach HW
const bis = (h) => pts.filter(p => p.t <= T0 + h * STD);
assert.equal(tendenz(bis(3 + 6.21 + 2)), 'auflaufend', '2 h nach NW');
assert.equal(tendenz(bis(3 + 2)), 'ablaufend', '2 h nach HW');
assert.equal(tendenz(bis(3.25)), 'kentert', 'um Hochwasser');
assert.equal(tendenz([]), null);

// Einordnung zu MThw/MTnw
assert.equal(einordnung(641, 636, 'HW'), 'wie mittleres Tidehochwasser');
assert.equal(einordnung(659, 636, 'HW'), '23 cm über dem mittleren Tidehochwasser');
assert.equal(einordnung(300, 330, 'NW'), '30 cm unter dem mittleren Tideniedrigwasser');
assert.equal(einordnung(300, undefined, 'NW'), null);

// Gesamtauswertung
const a = auswerten({ tide: true, refs: {}, tideRefs: { MThw: 636, MTnw: 330 } }, pts);
assert.ok(a.hw && a.nw && a.tidehub > 280 && a.tidehub < 320, `Tidehub ≈ 300 (${a.tidehub})`);
assert.ok(a.hwText.includes('mittleres Tidehochwasser') && a.nwText.includes('Tideniedrigwasser'));
assert.ok(a.extreme.every(e => e.t >= pts[pts.length - 1].t - 24 * STD) && a.extreme.length >= 3, 'Extreme der letzten 24 h');
assert.equal(auswerten({}, []), null);
// flache Kurve (z. B. Ostsee ohne Tide): keine Extreme
assert.deepEqual(extreme(kurve(24, 5, 0).map(p => ({ ...p, v: 500 }))), [], 'ohne Tide keine Extreme');
console.log('gezeiten_test: ok');

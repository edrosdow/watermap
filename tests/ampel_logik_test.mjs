// Tests der Pegel-Ampel-Logik (public/js/ampel-logik.js). Start: node tests/ampel_logik_test.mjs
import assert from 'node:assert/strict';
import { bewerte, trend, pruefePegel, PUFFER_CM, STATUS } from '../public/js/ampel-logik.js';

const H = 3600e3;
const reihe = (start, cmProStunde, stunden = 24, schritt = 0.25) => {
  const out = [];
  for (let i = 0; i <= stunden / schritt; i++) out.push({ t: i * schritt * H, v: start + cmProStunde * i * schritt });
  return out;
};
const pegel = (value, extra = {}) => ({ value, unit: 'cm', state: 'normal', ...extra });

// Trend
assert.equal(trend([]), null, 'leere Reihe: kein Trend');
assert.equal(trend(reihe(100, 1, 3)), null, 'unter 6 h: kein Trend');
assert.equal(trend(reihe(100, 0.05)).richtung, 'gleich', '1,2 cm/Tag gilt als gleich');
assert.equal(trend(reihe(100, 1)).richtung, 'steigend');
const fall = trend(reihe(200, -1));
assert.equal(fall.richtung, 'fallend');
assert.ok(Math.abs(fall.cmProTag + 24) < 1e-9, 'Rate in cm pro Tag');
// nur die letzten 24 h zählen
const lang = [...reihe(0, 10, 48).map(p => ({ ...p })), ];
const nurLetzte = trend(lang.map(p => ({ t: p.t, v: p.t < 24 * H ? p.v : 240 })));
assert.equal(nurLetzte.richtung, 'gleich', 'ältere Werte als 24 h werden ignoriert');

// Grenzen grün/gelb/rot (Mindestpegel 100, Puffer 20)
assert.equal(PUFFER_CM, 20);
assert.equal(bewerte({ pegel: pegel(120), mindest: 100 }).status, 'gruen', 'genau Mindestpegel + Puffer: grün');
assert.equal(bewerte({ pegel: pegel(119), mindest: 100 }).status, 'gelb');
assert.equal(bewerte({ pegel: pegel(100), mindest: 100 }).status, 'gelb', 'genau Mindestpegel: gelb');
assert.equal(bewerte({ pegel: pegel(99), mindest: 100 }).status, 'rot');
assert.equal(bewerte({ pegel: pegel(99), mindest: 100 }).reserve, -1);

// Grün, aber fallend: Prognose in 3 Tagen unter Mindestpegel → gelb
const g1 = bewerte({ pegel: pegel(150), mindest: 100, trend: { richtung: 'fallend', cmProTag: -20 } });
assert.equal(g1.status, 'gelb', '150 − 3×20 = 90 < 100');
assert.ok(g1.hinweise.some(h => h.typ === 'warn' && h.text.includes('2,5 Tagen') && h.text.includes('Minimum')), JSON.stringify(g1.hinweise));
const g2 = bewerte({ pegel: pegel(150), mindest: 100, trend: { richtung: 'fallend', cmProTag: -10 } });
assert.equal(g2.status, 'gruen', '150 − 30 = 120 ≥ 100 bleibt grün');
assert.ok(g2.hinweise.some(h => h.typ === 'warn' && h.text.includes('3 Tagen wird es knapp')), JSON.stringify(g2.hinweise));
assert.equal(g2.hinweise[0].typ, 'ok');
assert.equal(bewerte({ pegel: pegel(150), mindest: 100, trend: { richtung: 'steigend', cmProTag: 30 } }).status, 'gruen');
// Rot bleibt rot, Hinweis bei steigendem Pegel
const r = bewerte({ pegel: pegel(90), mindest: 100, trend: { richtung: 'steigend', cmProTag: 20 } });
assert.equal(r.status, 'rot');
assert.ok(r.hinweise.some(h => h.text.includes('steigt') && h.text.includes('0,5 Tagen') === false) && r.hinweise[0].typ === 'bad', JSON.stringify(r.hinweise));

// Unvollständige Eingaben
assert.equal(bewerte({ pegel: pegel(150), mindest: NaN }).status, 'unbekannt');
assert.equal(bewerte({ pegel: null, mindest: 100 }).status, 'unbekannt');
// Veralteter Messwert: Hinweis, höchstens 3 Hinweise
const alt = bewerte({ pegel: pegel(105, { state: 'old' }), mindest: 100, trend: { richtung: 'fallend', cmProTag: -5 } });
assert.ok(alt.hinweise[0].text.includes('alt'));
assert.ok(alt.hinweise.length <= 3);
// Erweiterbar: weitere Prüfung verschlechtert das Ergebnis
const bruecke = () => ({ status: 'rot', hinweise: [{ typ: 'bad', text: 'Brücke zu niedrig' }] });
assert.equal(bewerte({ pegel: pegel(200), mindest: 100 }, [pruefePegel, bruecke]).status, 'rot');
assert.equal(STATUS.gelb.label, 'Knapp');

console.log('ampel-logik: alle Tests OK');

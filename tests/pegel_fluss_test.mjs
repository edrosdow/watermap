// Tests der Fluss-Logik (public/js/pegel-fluss.js): Gruppierung Küste/Tide/Kanäle, Zustand eines Flusses, rel, Profil.
// Start: node tests/pegel_fluss_test.mjs
import assert from 'node:assert/strict';
import { slug, rel, gruppieren, gruppeZu, flussZustand, kachelnSortieren, punkte, profil, flussKm, istKueste, slipsAmFluss, artikel, flussReihenfolge, abschnitt } from '../public/js/pegel-fluss.js';
import { schoenerName } from '../public/js/pegel-namen.js';

const R = { MNW: 100, MW: 200, MHW: 300, HSW: 400 };
let n = 0;
const P = (water, km, value, state, extra = {}) => ({ id: `g${++n}`, name: extra.name || `${water} ${km}`, water, km, value, unit: 'cm', state, trend: null, lat: 51, lon: 8,
  refs: extra.refs === undefined ? (['hsw', 'high', 'low', 'normal'].includes(state) || state === 'old' ? R : {}) : extra.refs, tide: !!extra.tide });

// Adressen, rel
assert.equal(slug('Außenjade'), 'aussenjade');
assert.equal(slug('Müritz-Elde-Wasserstraße'), 'mueritz-elde-wasserstrasse');
assert.equal(rel(P('Elbe', 1, 200, 'normal')), 0.5, 'rel = (W − MNW) / (MHW − MNW)');
assert.equal(rel(P('Elbe', 1, 100, 'low')), 0, 'MNW = 0');
assert.equal(rel(P('Elbe', 1, 300, 'normal')), 1, 'MHW = 1');
assert.equal(rel(P('Elbe', 1, 0, 'low')), -0.5, 'unten begrenzt auf −0,5');
assert.equal(rel(P('Elbe', 1, 900, 'hsw')), 1.6, 'oben begrenzt auf 1,6');
assert.equal(rel(P('Elbe', 1, 200, 'none', { refs: { MNW: 100 } })), null, 'ohne MHW kein rel');

// Gruppierung: Küste (inkl. Außenjade), Kanäle ohne Kennwerte, Flüsse nach km (ohne km ans Ende)
assert.ok(istKueste('NORDSEE'.toLowerCase()) && istKueste('Außenjade') && istKueste('Aussenjade') && istKueste('Ostsee') && !istKueste('Elbe'));
const gauges = [
  P('Elbe', 586, 250, 'normal'), P('Elbe', 2, 80, 'low', { name: 'Schöna' }), P('Elbe', 55, 62, 'low', { name: 'Dresden' }), P('Elbe', null, 90, 'low', { name: 'Ohne km' }),
  P('Elbe', 623, 500, 'unknown', { tide: true, name: 'Hamburg St. Pauli' }), P('Elbe', 727, 600, 'unknown', { tide: true, name: 'Cuxhaven' }),
  P('Nordsee', null, 500, 'unknown', { name: 'Helgoland' }), P('Ostsee', null, 500, 'unknown', { name: 'Kiel' }), P('Außenjade', 10, 500, 'unknown'),
  P('Mittellandkanal', 100, 300, 'unknown'), P('Mittellandkanal', 200, 300, 'unknown'),
];
const gr = gruppieren(gauges);
assert.deepEqual(gr.fluesse.map(f => f.name), ['Elbe']);
assert.equal(gr.kueste.pegel.length, 3, 'Nordsee, Ostsee, Außenjade in der Küste');
assert.equal(gr.kueste.slug, 'kueste');
assert.deepEqual(gr.ohne.map(f => f.name), ['Mittellandkanal'], 'Kanal ohne Kennwerte eigene Gruppe');
const elbe = gr.fluesse[0];
assert.deepEqual(elbe.pegel.map(g => g.name), ['Schöna', 'Dresden', 'Elbe 586', 'Hamburg St. Pauli', 'Cuxhaven', 'Ohne km'], 'nach km, ohne km ans Ende');
assert.equal(gruppeZu(gr, 'elbe'), elbe);
assert.equal(gruppeZu(gr, 'mittellandkanal').art, 'ohne');
assert.equal(gruppeZu(gr, 'kueste').art, 'kueste');
assert.equal(gruppeZu(gr, 'gibtsnicht'), null);

// Zustand eines Flusses (nur bewertete Pegel)
const z = flussZustand(elbe);
assert.equal(z.key, 'niedrig', '3 von 4 niedrig → niedrig');
assert.equal(z.n, 4, 'Tidepegel ohne Kennwerte zählen nicht');
assert.equal(z.kachel, '3 von 4 niedrig');
assert.equal(z.kopf, '3 von 4 bewerteten Pegeln unter MNW');
assert.equal(z.hervor.name, 'Dresden', 'relativ tiefster Pegel');
assert.equal(z.hervorArt, 'tiefster');
const fluss = (...pegel) => ({ name: 'X', slug: 'x', art: 'fluss', pegel });
assert.equal(flussZustand(fluss(P('X', 1, 450, 'hsw'), P('X', 2, 150, 'low'), P('X', 3, 200, 'normal'))).key, 'hsw', 'ein Pegel über HSW reicht');
assert.equal(flussZustand(fluss(P('X', 1, 450, 'hsw'))).kachel, 'Schifffahrt eingeschränkt');
assert.equal(flussZustand(fluss(P('X', 1, 350, 'high'), P('X', 2, 200, 'normal'))).key, 'hoch', '50 % über MHW → hoch');
assert.equal(flussZustand(fluss(P('X', 1, 350, 'high'), P('X', 2, 200, 'normal'), P('X', 3, 200, 'normal'))).key, 'teils-hoch');
const th = flussZustand(fluss(P('X', 1, 310, 'high'), P('X', 2, 380, 'high', { name: 'Spitze' }), P('X', 3, 50, 'low')));
assert.equal(th.key, 'hoch', 'hoch geht vor niedrig');
assert.equal(th.hervor.name, 'Spitze', 'relativ höchster Pegel');
assert.equal(flussZustand(fluss(P('X', 1, 90, 'low'), P('X', 2, 200, 'normal'), P('X', 3, 200, 'normal'))).key, 'teils-niedrig');
const nz = flussZustand(fluss(P('X', 1, 200, 'normal'), P('X', 2, 220, 'normal')));
assert.equal(nz.key, 'normal'); assert.equal(nz.hervor, null); assert.equal(nz.kachel, 'keine Auffälligkeiten');
const alt = flussZustand(fluss(P('X', 1, 200, 'old'), P('X', 2, 220, 'old')));
assert.equal(alt.key, 'keine', 'nur veraltete Werte → keine aktuellen Daten'); assert.equal(alt.kachel, 'keine aktuellen Daten');
assert.equal(flussZustand(gr.kueste).key, 'kueste');
assert.equal(flussZustand(gr.ohne[0]).key, 'ohne');

// Kacheln: Meine Pegel zuerst, dann Schwere, dann Anzahl
const A = { name: 'Aaa', slug: 'a', art: 'fluss', pegel: [P('A', 1, 200, 'normal'), P('A', 2, 200, 'normal'), P('A', 3, 200, 'normal')] };
const B = { name: 'Bbb', slug: 'b', art: 'fluss', pegel: [P('B', 1, 450, 'hsw')] };
const C = { name: 'Ccc', slug: 'c', art: 'fluss', pegel: [P('C', 1, 50, 'low')] };
const D = { name: 'Ddd', slug: 'd', art: 'fluss', pegel: [P('D', 1, 50, 'low'), P('D', 2, 50, 'low')] };
assert.deepEqual(kachelnSortieren([A, C, B, D]).map(f => f.name), ['Bbb', 'Ddd', 'Ccc', 'Aaa'], 'Schwere, dann Anzahl');
assert.deepEqual(kachelnSortieren([A, C, B, D], [A.pegel[1].id]).map(f => f.name), ['Aaa', 'Bbb', 'Ddd', 'Ccc'], 'Meine Pegel zuerst');

// Punktreihe: höchstens 12, gleichmäßig, erster und letzter dabei
const viele = fluss(...Array.from({ length: 30 }, (_, i) => P('X', i, 200, 'normal')));
const pk = punkte(viele);
assert.equal(pk.length, 12); assert.equal(pk[0], viele.pegel[0]); assert.equal(pk[11], viele.pegel[29]);
assert.equal(punkte(elbe).length, 4, 'nur bewertete Pegel als Punkte');

// Profil: nur bewertete Pegel, gleiche Abstände; Tidepegel nicht im Diagramm, sondern als eigene Angabe
const pr = profil(elbe);
assert.equal(pr.punkte.length, 3, 'bewertete Pegel mit km, Tidepegel und Pegel ohne km nicht');
assert.deepEqual(pr.punkte.map(p => p.pos), [0, 0.5, 1], 'gleiche Abstände in Fließrichtung');
assert.equal(pr.von.name, 'Schöna');
assert.equal(pr.tide.ab.name, 'Elbe 586', 'Tidepegel folgen nach dem letzten Pegel mit Kennwerten');
assert.equal(pr.tide.pegel.length, 2); assert.ok(pr.tide.mitTide);
const tideFluss = fluss(P('X', 1, 200, 'normal'), P('X', 5, 200, 'unknown'), P('X', 9, 90, 'low', { name: 'Letzter' }), P('X', 20, 500, 'unknown', { tide: true }), P('X', 30, 500, 'unknown', { tide: true }));
const tp = profil(tideFluss);
assert.equal(tp.tide.ab.name, 'Letzter'); assert.equal(tp.tide.pegel.length, 2); assert.ok(tp.tide.mitTide);
assert.equal(tp.punkte.length, 2, 'Pegel ohne Kennwerte mitten im Fluss nicht im Diagramm');
assert.equal(profil(fluss(P('X', 1, 200, 'normal'), P('X', 9, 200, 'normal'))).tide, null);

// Höhe: nur so groß wie nötig, MNW immer im Bild; MHW nur, wenn im Bereich; alles hoch → MHW im Bild statt MNW
const tief = profil(fluss(P('X', 0, 60, 'low'), P('X', 1, 80, 'low'), P('X', 2, 95, 'low'), P('X', 3, 120, 'normal')));
assert.ok(tief.mnw && !tief.mhw, 'niedrig: MNW sichtbar, MHW liegt weiter oben');
assert.ok(tief.yBereich[1] < 0.3 && tief.yBereich[0] < rel(P('X', 0, 60, 'low')), `y-Bereich eng (${tief.yBereich})`);
const hochFl = profil(fluss(P('X', 0, 520, 'high'), P('X', 1, 560, 'hsw')));
assert.ok(hochFl.mhw && !hochFl.mnw, 'alles über MHW: MHW sichtbar, MNW liegt weiter unten');
const beide = profil(fluss(P('X', 0, 90, 'low'), P('X', 1, 500, 'high')));
assert.ok(beide.mnw && beide.mhw);
assert.ok(beide.yBereich[0] >= -0.55 && beide.yBereich[1] <= 1.65);

// Reihenfolge in Fließrichtung: km durchgehend → nach km; Sprung (Weser) → Kette über die Lage; km ab Mündung (Mosel)
const W = (name, km, lat, lon) => ({ ...P('Weser', km, 200, 'normal', { name }), lat, lon });
const weser = [W('Bremerhaven', 65, 53.54, 8.58), W('Hann. Münden', 0.7, 51.42, 9.65), W('Vlotho', 201.4, 52.17, 8.86), W('Große Weserbrücke', 0, 53.07, 8.81),
  W('Hameln', 135, 52.10, 9.36), W('Minden', 204.5, 52.29, 8.92), W('Dreye', 362, 52.99, 8.88), W('Vegesack', 17.8, 53.17, 8.62), W('Nienburg', 268, 52.64, 9.21), W('Leuchtturm Alte Weser', 115, 53.86, 8.13)];
assert.deepEqual(flussReihenfolge(weser).map(g => g.name),
  ['Hann. Münden', 'Hameln', 'Vlotho', 'Minden', 'Nienburg', 'Dreye', 'Große Weserbrücke', 'Vegesack', 'Bremerhaven', 'Leuchtturm Alte Weser'], 'Weser über die Lage');
assert.deepEqual([abschnitt(weser[1]), abschnitt(weser[6]), abschnitt(weser[7]), abschnitt(weser[9])], ['Oberweser', 'Mittelweser', 'Unterweser', 'Außenweser']);
assert.equal(abschnitt(P('Elbe', 55, 62, 'low')), null, 'Abschnitt nur bei der Weser');
const M = (name, km, lat, lon) => ({ ...P('Mosel', km, 200, 'normal', { name }), lat, lon });
assert.deepEqual(flussReihenfolge([M('Cochem', 51.6, 50.15, 7.17), M('Trier', 195.8, 49.76, 6.63), M('Koblenz', 2, 50.36, 7.6)]).map(g => g.name), ['Trier', 'Cochem', 'Koblenz'], 'Mosel: km ab Mündung');
assert.deepEqual(flussReihenfolge(elbe.pegel).map(g => g.name), elbe.pegel.map(g => g.name), 'Elbe: km durchgehend');

// Namen
assert.equal(schoenerName('HANN.MUENDEN'), 'Hann. Münden');
assert.equal(schoenerName('HAMBURG ST.PAULI'), 'Hamburg St. Pauli');
assert.equal(schoenerName('MÜRITZ-ELDE-WASSERSTRASSE'), 'Müritz-Elde-Wasserstraße');
assert.equal(schoenerName('NEUENKIRCHEN'), 'Neuenkirchen', 'keine allgemeine Regel ue → ü');

// Weser: Unterweser (eigene km ab Bremen) hinter der Mittelweser
const unterweser = { ...P('Weser', 17.8, 588, 'unknown'), lat: 53.17 };
assert.ok(flussKm(unterweser) > flussKm({ ...P('Weser', 360, 200, 'normal'), lat: 53.05 }));

// Slipanlagen, Artikel
const places = [{ type: 'slip', water: { name: 'Elbe' } }, { type: 'slip', water: { name: 'Rhein' } }, { type: 'marina', water: { name: 'Elbe' } }];
assert.equal(slipsAmFluss('Elbe', places).length, 1);
assert.deepEqual(artikel('Elbe'), { entlang: 'entlang der Elbe', an: 'an der Elbe' });
assert.deepEqual(artikel('Rhein'), { entlang: 'entlang des Rheins', an: 'am Rhein' });
assert.equal(artikel('Mittellandkanal').an, 'am Mittellandkanal');
console.log('pegel_fluss_test: ok');

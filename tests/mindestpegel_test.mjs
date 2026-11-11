// Tests für „Passt mein Boot?“ (public/js/mindestpegel.js, 7.71.0): Speicher je Pegel, einmalige Übernahme aus der alten
// Pegel-Ampel, Bootstyp, Sätze und Vorschau. Start: node tests/mindestpegel_test.mjs
import assert from 'node:assert/strict';

const speicher = new Map();
globalThis.localStorage = { getItem: (k) => (speicher.has(k) ? speicher.get(k) : null), setItem: (k, v) => speicher.set(k, String(v)), removeItem: (k) => speicher.delete(k) };
const ereignisse = [];
globalThis.document = { dispatchEvent: (e) => ereignisse.push(e.type) };
globalThis.CustomEvent ??= class { constructor(type, o) { this.type = type; this.detail = o?.detail; } };

const { mindestAlle, mindestFuer, mindestSetzen, bootTyp, bootTypSetzen, ampel, ampelVorschau } = await import('../public/js/mindestpegel.js');
const pegel = (value, extra = {}) => ({ id: 'A', value, unit: 'cm', state: 'normal', ...extra });

// Übernahme aus watermap.ampel (einmalig)
speicher.set('watermap.ampel', JSON.stringify({ pegel: 'A', min: 120, boot: 'segel', hoehe: 2 }));
assert.deepEqual(mindestAlle(), { A: 120 });
assert.equal(bootTyp(), 'segel', 'Bootstyp aus der alten Ampel gelesen');
mindestSetzen('A', null);
assert.deepEqual(mindestAlle(), {}, 'nach dem Entfernen keine zweite Übernahme');
assert.deepEqual(ereignisse, ['mindestpegel']);

// Setzen, Runden, ungültige Werte
mindestSetzen('B', 87.6); mindestSetzen('C', 5000); mindestSetzen('D', NaN);
assert.deepEqual(mindestAlle(), { B: 88 });
assert.equal(mindestFuer('B'), 88); assert.equal(mindestFuer('X'), null); assert.equal(mindestFuer(null), null);

// Bootstyp: neu in watermap.boot (Maße bleiben)
speicher.set('watermap.boot', JSON.stringify({ laenge: 6.5 }));
bootTypSetzen('kanu'); bootTypSetzen('quatsch');
assert.deepEqual(JSON.parse(speicher.get('watermap.boot')), { laenge: 6.5, typ: 'kanu' });
assert.equal(bootTyp(), 'kanu');

// Ampel: Wort und Abstand
assert.equal(ampel(pegel(162), { mindest: 120 }).satz, 'Passt – 42 cm über deinem Mindestpegel');
assert.equal(ampel(pegel(162), { mindest: 120 }).zustand, 'gut');
const knapp = ampel(pegel(130), { mindest: 120 });
assert.equal(knapp.satz, 'Knapp – 10 cm über deinem Mindestpegel'); assert.equal(knapp.zustand, 'warn');
const rot = ampel(pegel(90), { mindest: 120 });
assert.equal(rot.satz, 'Zu niedrig – 30 cm unter deinem Mindestpegel'); assert.equal(rot.zustand, 'stop'); assert.equal(rot.wort, 'Zu niedrig');
assert.equal(ampel(pegel(90), { mindest: null }), null, 'ohne Mindestpegel keine Ampel');
assert.equal(ampel({ id: 'B', value: 120, state: 'normal' }).mindest, 88, 'Standard: gespeicherter Mindestpegel');

// Vorschau mit WSV-Vorhersage: Wechsel der Stufe bzw. „bleibt“
const t = Date.now();
const wv = [{ t: t + 3600e3, v: 150 }, { t: t + 26 * 3600e3, v: 135 }, { t: t + 50 * 3600e3, v: 110 }];
const a = ampel(pegel(162), { mindest: 120 });
assert.match(ampelVorschau(pegel(162), a, { wv }), /^Vorhersage: ab \S+ \d+ Uhr knapp$/);
assert.match(ampelVorschau(pegel(162), a, { wv: wv.slice(0, 1) }), /^Vorhersage bis \S+ \d+ Uhr: bleibt passend$/);
// ohne Vorhersage: Trend-Hinweis der Ampel-Logik (fallend → „in ca. … unter deinem Minimum“)
const H = 3600e3, pts = Array.from({ length: 97 }, (_, i) => ({ t: t - (96 - i) * 0.25 * H, v: 160 + (96 - i) * 0.25 * 1.5 }));   // −36 cm/Tag
const fallend = ampel(pegel(130), { mindest: 120, pts });
assert.match(ampelVorschau(pegel(130), fallend), /^Pegel sinkt – in ca\. .* unter deinem Minimum$/);
assert.equal(ampelVorschau(pegel(162), ampel(pegel(162), { mindest: 120 })), null, 'ohne Trend und Vorhersage keine Zeile');

console.log('mindestpegel_test: alle Prüfungen bestanden');

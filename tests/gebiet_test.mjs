// Kartengebiet (public/js/gebiet.js + public/data/gebiet-de.json): Punkte, Suchtreffer, Kacheln.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gebietLaden, imGebiet, aufGebietBeschneiden, kachelNoetig, gebietGeladen } from '../public/js/gebiet.js';

const datei = new URL('../public/data/gebiet-de.json', import.meta.url);
const fetchFn = async () => ({ ok: true, json: async () => JSON.parse(await readFile(datei, 'utf8')) });

// vor dem Laden: nur das Rechteck
assert.equal(gebietGeladen(), null);
assert.equal(imGebiet(48.58, 7.745), true, 'Straßburg liegt im Rechteck (vor dem Laden noch erlaubt)');
assert.equal(imGebiet(55.75, 37.62), false, 'Moskau nie');
assert.equal(kachelNoetig(2200, 1343, 12), true, 'vor dem Laden: Rechteck (Berlin)');
assert.equal(kachelNoetig(0, 0, 12), false, 'vor dem Laden: außerhalb des Rechtecks nein');

await gebietLaden(fetchFn);
const drin = {
  Berlin: [52.52, 13.405], München: [48.137, 11.575], Hamburg: [53.55, 9.99], Helgoland: [54.18, 7.885], Sylt: [54.9, 8.31],
  'Nordsee vor Cuxhaven': [53.95, 8.45], Fehmarn: [54.45, 11.2], 'Kieler Bucht': [54.5, 10.3], Rügen: [54.45, 13.4], Usedom: [53.95, 14.0],
  'Bodensee (Mitte)': [47.6, 9.4], 'Nordsee vor Borkum (offene See)': [53.9, 6.3], 'Ostsee vor Rügen (offene See)': [54.8, 13.9], 'Pommersche Bucht': [54.1, 14.3], 'Bodensee bei Romanshorn': [47.57, 9.39], 'Rhein bei Kehl (Strommitte)': [48.575, 7.803], Konstanz: [47.66, 9.175],
};
const draussen = {
  Moskau: [55.75, 37.62], London: [51.507, -0.128], Paris: [48.857, 2.352], Straßburg: [48.583, 7.745], Basel: [47.558, 7.588], Szczecin: [53.43, 14.55],
  Kopenhagen: [55.68, 12.57], Amsterdam: [52.37, 4.9], Salzburg: [47.8, 13.04], Prag: [50.08, 14.43], 'Offene Nordsee (Doggerbank)': [54.8, 2.5],
  'Bornholm': [55.1, 14.9], 'Lolland (DK)': [54.75, 11.4], 'Amriswil (CH, 3 km vom See)': [47.547, 9.30], 'Venlo (NL)': [51.37, 6.17], 'Aalborg (DK)': [57.05, 9.92],
};
for (const [n, [la, lo]] of Object.entries(drin)) assert.equal(imGebiet(la, lo), true, `${n} muss im Gebiet liegen`);
for (const [n, [la, lo]] of Object.entries(draussen)) assert.equal(imGebiet(la, lo), false, `${n} darf nicht im Gebiet liegen`);
assert.equal(imGebiet(NaN, 10), false);

// Suchtreffer mit großem Rechteck (z. B. „Europa“) werden aufs Gebiet beschnitten; ganz außerhalb → null
assert.deepEqual(aufGebietBeschneiden([[35, -10], [70, 40]]), [[47.2613, 5.8586], [55.1047, 15.0471]]);
assert.deepEqual(aufGebietBeschneiden([[53.4, 9.7], [53.7, 10.3]]), [[53.4, 9.7], [53.7, 10.3]]);
assert.equal(aufGebietBeschneiden([[55.5, 37], [56, 38]]), null);

// Kacheln: Berlin ja, Moskau/London/Paris nein – auf allen Zoomstufen
const kachel = (la, lo, z) => { const n = 2 ** z; const s = Math.sin(la * Math.PI / 180); return [Math.floor((lo + 180) / 360 * n), Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n), z]; };
for (const z of [5, 7, 10, 13, 17]) {
  assert.equal(kachelNoetig(...kachel(52.52, 13.405, z)), true, `Berlin z${z}`);
  assert.equal(kachelNoetig(...kachel(54.18, 7.885, z)), true, `Helgoland z${z}`);
  // Nachbarländer abgeblendet sichtbar (CONFIG.GEBIET.nachbarn < 1): bis z 7 alles, darüber nur bis ≈ 1,5° um Deutschland
  if (z >= 8) assert.equal(kachelNoetig(...kachel(48.857, 2.352, z)), false, `Paris z${z}`);
  if (z >= 8) assert.equal(kachelNoetig(...kachel(51.507, -0.128, z)), false, `London z${z}`);
  if (z >= 8) assert.equal(kachelNoetig(...kachel(53.2, 6.6, z)), true, `Groningen (Nachbar, abgeblendet) z${z}`);
}
assert.equal(kachelNoetig(...kachel(55.75, 37.62, 10)), false, 'Moskau');
console.log('gebiet: alle Tests OK');

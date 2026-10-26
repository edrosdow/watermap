// Kartengebiet: Deutschland mit Küstenmeer in Nord- und Ostsee (12 sm), Bodensee und schmalem Grenzsaum.
// Grenze aus data/gebiet-de.json (erzeugt mit scripts/gebiet_de.py aus OpenStreetMap-Grenzen, ODbL).
// Vor dem Laden gilt das umschließende Rechteck (CONFIG.GEBIET.bounds), danach die genaue Grenze.
import { CONFIG } from './config.js';

let daten = null;     // { bounds, ringe: [[[lat, lon], …], …], kacheln: Map(z → Set('x/y')) }
let laden = null;

/** Grenze laden (einmal; offline aus dem Service-Worker-Zwischenspeicher). */
export function gebietLaden(fetchFn = fetch) {
  laden ||= fetchFn(CONFIG.GEBIET.url).then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))).then((j) => {
    const ringe = (j.ringe || []).filter(r => Array.isArray(r) && r.length > 3);
    // je Ring das umschließende Rechteck – damit Punkttests nur wenige Ringe wirklich durchlaufen
    const boxen = ringe.map((r) => {
      let s = 90, n = -90, w = 180, e = -180;
      for (const [la, lo] of r) { if (la < s) s = la; if (la > n) n = la; if (lo < w) w = lo; if (lo > e) e = lo; }
      return { s, n, w, e };
    });
    const kacheln = new Map(Object.entries(j.kacheln || {}).map(([z, v]) => [Number(z), new Set(String(v).split(' ').filter(Boolean))]));
    daten = { bounds: j.deutschland || CONFIG.GEBIET.bounds, ringe, boxen, kacheln };
    return daten;
  }).catch((e) => { laden = null; throw e; });
  return laden;
}

export const gebietGeladen = () => daten;

const imRechteck = (lat, lon, [[s, w], [n, e]]) => lat >= s && lat <= n && lon >= w && lon <= e;

/** Liegt der Punkt im erlaubten Gebiet? (gerade/ungerade Regel über alle Ringe: Inseln und Aussparungen stimmen) */
export function imGebiet(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (!imRechteck(lat, lon, CONFIG.GEBIET.bounds)) return false;
  if (!daten) return true;
  let drin = false;
  daten.ringe.forEach((r, k) => {
    const b = daten.boxen[k];
    if (lat < b.s || lat > b.n || lon < b.w || lon > b.e) return;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [yi, xi] = r[i], [yj, xj] = r[j];
      if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) drin = !drin;
    }
  });
  return drin;
}

/** Rechteck (z. B. Treffer der Ortssuche) auf das erlaubte Rechteck beschneiden; null, wenn keine Überschneidung. */
export function aufGebietBeschneiden([[s, w], [n, e]]) {
  const [[gs, gw], [gn, ge]] = CONFIG.GEBIET.bounds;
  const b = [[Math.max(s, gs), Math.max(w, gw)], [Math.min(n, gn), Math.min(e, ge)]];
  return b[0][0] <= b[1][0] && b[0][1] <= b[1][1] ? b : null;
}

const kachelLat = (y, z) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 2 ** z))) * 180 / Math.PI;

/** Muss die Kartenkachel geladen werden? Ab Zoom 11 zählt die Vorfahrenkachel auf Zoom 10. Vor dem Laden: Rechteck. */
export function kachelNoetig(x, y, z) {
  if (!daten || !daten.kacheln.size) {
    const [[s, w], [n, e]] = CONFIG.GEBIET.bounds, k = 2 ** z;
    const lw = x / k * 360 - 180, le = (x + 1) / k * 360 - 180;
    return le >= w && lw <= e && kachelLat(y + 1, z) <= n && kachelLat(y, z) >= s;
  }
  if (z < 5) return true;
  if (z <= 10) return daten.kacheln.get(z)?.has(`${x}/${y}`) ?? true;
  const f = 2 ** (z - 10);
  return daten.kacheln.get(10)?.has(`${Math.floor(x / f)}/${Math.floor(y / f)}`) ?? true;
}

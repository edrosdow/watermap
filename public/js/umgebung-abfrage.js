// „In der Nähe“: Overpass-Abfrage – gemeinsam für App (Abfrage direkt aus dem Browser) und Netlify-Funktion (Rückfall).
export const RADIUS_M = 500;

/** Overpass-Abfrage: Camping, Rastplätze, Parkplätze, Toiletten, Wasser, Gastronomie, Läden, Schleusen; Flächen mit Mittelpunkt. */
// Umkreissuche nur einmal (nwr(around) → .a), danach filtern – deutlich schneller als je Art eine eigene Umkreissuche,
// wichtig, wenn die Overpass-Server ausgelastet sind.
export function abfrage(lat, lon, radius = RADIUS_M) {
  return `[out:json][timeout:25];nwr(around:${radius},${lat.toFixed(5)},${lon.toFixed(5)})->.a;(`
    + 'nwr.a["tourism"~"^(camp_site|caravan_site|picnic_site)$"];nwr.a["leisure"="picnic_site"];'
    + 'nwr.a["amenity"~"^(parking|toilets|drinking_water|water_point|restaurant|cafe|fast_food|biergarten|pub)$"];'
    + 'nwr.a["shop"~"^(supermarket|convenience|kiosk)$"];'
    + 'way.a["lock"="yes"]["waterway"];nwr.a["seamark:type"="lock_basin"];'
    + ');out tags center;';
}

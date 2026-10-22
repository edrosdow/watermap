// „In der Nähe“: Overpass-Abfrage – gemeinsam für App (Abfrage direkt aus dem Browser) und Netlify-Funktion (Rückfall).
export const RADIUS_M = 500;

/** Overpass-Abfrage: Camping, Rastplätze, Parkplätze, Toiletten, Wasser, Gastronomie, Läden, Schleusen; Flächen mit Mittelpunkt. */
export function abfrage(lat, lon, radius = RADIUS_M) {
  const a = `(around:${radius},${lat.toFixed(5)},${lon.toFixed(5)})`;
  return `[out:json][timeout:15];(`
    + `nwr["tourism"~"^(camp_site|caravan_site|picnic_site)$"]${a};nwr["leisure"="picnic_site"]${a};`
    + `nwr["amenity"~"^(parking|toilets|drinking_water|water_point|restaurant|cafe|fast_food|biergarten|pub)$"]${a};`
    + `nwr["shop"~"^(supermarket|convenience|kiosk)$"]${a};`
    + `way["lock"="yes"]["waterway"]${a};nwr["seamark:type"="lock_basin"]${a};`
    + `);out tags center;`;
}

// „In der Nähe“: Einrichtungen im Umkreis eines Standorts live aus OpenStreetMap (Overpass API).
// Aufruf: GET /.netlify/functions/umgebung?lat=51.00619&lon=12.98348
// Die Abfrage baut die Funktion selbst (kein offener Proxy für beliebige Overpass-Abfragen) und schickt sie mit
// eigener Kennung (User-Agent) – overpass-api.de lehnt weitergeleitete Anfragen ohne Kennung mit 406 ab.
// Alle Server werden gleichzeitig gefragt, die erste brauchbare Antwort gewinnt (einzelne Server sind oft
// überlastet oder lehnen Cloud-Adressen ab). Antworten werden einen Tag im Netlify-CDN gehalten.
import { abfrage, RADIUS_M } from '../../public/js/umgebung-abfrage.js';

export { abfrage, RADIUS_M };
export const SERVER = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const TIMEOUT_MS = 18000;
const USER_AGENT = 'WaterMap/1.0 (+https://watermaps.netlify.app; map of slipways and marinas)';

const json = (status, body, cache) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': cache ? 'public, max-age=3600' : 'no-store',
    ...(cache ? { 'netlify-cdn-cache-control': 'public, durable, s-maxage=86400, stale-while-revalidate=86400' } : {}),
  },
});

export async function handle(req, { fetchFn = fetch, server = SERVER, timeoutMs = TIMEOUT_MS } = {}) {
  if (req.method !== 'GET') return json(405, { fehler: 'Nur GET.' });
  const u = new URL(req.url);
  const lat = Number(u.searchParams.get('lat')), lon = Number(u.searchParams.get('lon'));
  // WaterMap deckt Deutschland ab (mit etwas Rand)
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 46 || lat > 56 || lon < 4 || lon > 17) return json(400, { fehler: 'Ungültige Koordinaten.' });
  const body = 'data=' + encodeURIComponent(abfrage(lat, lon));
  const fehler = [];
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const frage = async (url) => {
    const host = new URL(url).host;
    try {
      const res = await fetchFn(url, { method: 'POST', body, signal: ctl.signal,
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', 'user-agent': USER_AGENT, referer: 'https://watermaps.netlify.app/' } });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data?.elements)) throw new Error('unerwartete Antwort');
      if (!data.elements.length && /runtime error/i.test(data.remark || '')) throw new Error('überlastet');   // HTTP 200, aber abgebrochen – nicht zwischenspeichern
      return { data, host };
    } catch (e) {
      fehler.push(`${host}: ${e.name === 'AbortError' ? 'Zeitüberschreitung' : e.message}`);
      throw e;
    }
  };
  try {
    const { data, host } = await Promise.any(server.map(frage));
    // nur, was die App braucht (keine Geometrien, keine Metadaten)
    const elements = data.elements.map(e => ({ type: e.type, id: e.id, lat: e.lat, lon: e.lon, center: e.center, tags: e.tags }));
    return json(200, { elements, quelle: host }, true);
  } catch { /* alle gescheitert */ } finally {
    clearTimeout(timer);
    ctl.abort(); // übrige Anfragen beenden
  }
  return json(502, { fehler: 'OpenStreetMap ist gerade nicht erreichbar.', details: fehler });
}

export default (req) => handle(req);

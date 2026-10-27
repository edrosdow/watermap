// Zentrale Einstellungen. Hier – und nur hier – werden Dienste und Grenzwerte angepasst.
// Entwicklungsmodus: lokal und in Netlify-Vorschauen (deploy-preview-…), nie auf der Live-Seite
const host = typeof location !== 'undefined' ? location.hostname : '';
export const ENTWICKLUNG = /^(localhost|127\.0\.0\.1)$|^deploy-preview-/.test(host);

export const CONFIG = {
  VERSION: '7.35.1',

  // Datenquellen (relativ zur Seite). Welche Dateien geladen werden, steht in data/meta.json.
  DATA_BASE: './data/',

  // Kartenkacheln. Der Standardserver von OpenStreetMap ist nur für geringe Last gedacht
  // (https://operations.osmfoundation.org/policies/tiles/). Für mehr Nutzer: eigenen
  // Kachel-Anbieter eintragen (z. B. MapTiler, Stadia, Thunderforest) – ohne Schlüssel im Code
  // nur mit Anbietern, die Domain-Beschränkung erlauben.
  TILE_URL: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  TILE_ATTRIBUTION: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap-Mitwirkende</a>',
  TILE_MAX_ZOOM: 19,

  // Ortssuche (Geocoder). Wird nur auf Nutzeraktion hin abgefragt, nie bei Kartenbewegung.
  GEOCODER_URL: 'https://nominatim.openstreetmap.org/search',

  // Startansicht: 'germany' = ganz Deutschland mit Nord- und Ostseeküste, 'data' = auf vorhandene Standorte zoomen.
  START_MODE: 'germany',
  // Kartengebiet: Deutschland mit Nord- und Ostsee hervorgehoben, Europa leicht grau. Verschieben und Herauszoomen bis Europa;
  // Kartenkacheln mit Straßen gibt es nur für Deutschland und knapp darüber hinaus. Suche, Standort und neue Slipanlagen
  // nur im deutschen Gebiet (inkl. Küstenmeer). Grenze: data/gebiet-de.json.
  GEBIET: {
    url: './data/gebiet-de.json',
    bounds: [[47.2613, 5.8586], [55.1047, 15.0471]],   // Deutschland (Startansicht, Ortssuche)
    europa: [[34.5, -12], [71.5, 42]],                  // so weit lässt sich die Karte verschieben und herauszoomen
    maske: '#D3D6D9',
    nachbarn: 0.5,      // Deckkraft des grauen Schleiers außerhalb Deutschlands (1 = ganz abgedeckt)
    strassenRand: 1.5,  // ab Zoom 9 Kacheln nur bis so viele Grad um Deutschland (keine fremden Straßenkarten)
    hinweis: 'WaterMap ist derzeit auf Deutschland sowie die deutschen Nord- und Ostseegebiete begrenzt.',
  },
  GERMANY_VIEW: { center: [51.1, 10.4], zoom: 6 },
  FALLBACK_VIEW: { center: [51.45, 7.55], zoom: 8 },

  // Pegelstände (PEGELONLINE der WSV). Abruf über die eigene Domain; Netlify leitet weiter (public/_redirects).
  PEGEL_BASE: '/api/pegel/',
  PEGEL_REFRESH_MIN: 15,       // so oft misst die WSV
  PEGEL_STALE_HOURS: 6,        // ältere Messwerte gelten als veraltet
  PEGEL_HISTORY_DAYS: 7,
  // Küstengewässer: eigene Kachel „Küste“ (Tide, ohne Niedrig/Hoch-Bewertung) statt Flussseite. Groß-/Kleinschreibung egal.
  PEGEL_KUESTE: ['Nordsee', 'Ostsee', 'Jade', 'Jadebusen', 'Außenjade', 'Außenems', 'Außenweser', 'Außenelbe', 'Dollart', 'Wattenmeer',
    'Strelasund', 'Peenestrom', 'Kleines Haff', 'Greifswalder Bodden', 'Kieler Förde', 'Flensburger Förde', 'Schlei', 'Trave-Mündung'],
  // Gezeitenvorhersage des BSH (über die eigene Funktion /api/gezeiten, Lizenz CC BY 4.0). false = aus.
  GEZEITEN_BSH_AKTIV: true,
  GEZEITEN_BASE: '/api/gezeiten',
  GEZEITEN_OFFLINE_STUNDEN: 24,      // so lange wird die letzte Vorhersage offline noch gezeigt
  GEZEITEN_KUESTE_PEGEL: { id: 'aad49293-242a-43ad-a8b1-e91d7792c4b2', number: '5990020', name: 'Cuxhaven' },   // Küsten-Kachel
  PEGEL_ATTRIBUTION: 'Pegel: <a href="https://www.pegelonline.wsv.de" target="_blank" rel="noopener noreferrer">WSV/PEGELONLINE</a>',

  // Wetter und Wind (DWD-Daten über Bright Sky). Abruf über die eigene Domain (public/_redirects).
  WETTER_BASE: '/api/wetter/',
  WETTER_HOURS: 48,            // Vorhersagezeitraum im Diagramm
  WETTER_CACHE_MIN: 10,        // gleiche Stelle innerhalb dieser Zeit nicht erneut abfragen
  WETTER_GUST_HINT_KMH: 39,    // ab 6 Bft Böen ein Hinweis (gerade für kleine Boote)

  // „In der Nähe“ (Schleusen, Toiletten, Parkplätze … aus osm/extras.geojson)
  NEARBY_EXTRAS_M: 500,
  OVERPASS_API: 'https://overpass-api.de/api/interpreter',   // „In der Nähe“ direkt aus dem Browser
  VOR_ORT_RADIUS_M: 1000,   // „Heute vor Ort“: so nah gilt man als „vor Ort“ (nur Bedienhilfe, der Server prüft keine Position)
  UMGEBUNG_API: '/.netlify/functions/umgebung',   // „In der Nähe“ live aus OSM (Umkreis NEARBY_EXTRAS_M, fest in der Funktion)
  NEARBY_EXTRAS_MAX: 12,

  // Hafeninfos von den Websites (data/hafeninfo.json): ab diesem Alter als möglicherweise veraltet markieren
  HAFENINFO_STALE_DAYS: 365,

  // Liste
  LIST_LIMIT: 120,

  // Meldungen
  NEARBY_RADIUS_M: 150,        // Prüfung auf bereits vorhandene Slipanlage
  MAX_PHOTO_BYTES: 5 * 1024 * 1024,
  PHOTO_MAX_EDGE_PX: 2000,
  SUBMIT_COOLDOWN_MS: 20000,   // einfache Bremse gegen Mehrfach-Absenden

  // Preise
  PRICE_STALE_DAYS: 14,
  PRICE_MIN: 0.5,
  PRICE_MAX: 5,

  // Bibliotheken (Leaflet + MarkerCluster). Standard: CDN mit Ausweichadresse.
  // Selbst hosten (empfohlen für Produktion, siehe docs/INSTALLATION.md): `python3 scripts/vendor_libs.py`
  // lädt die Dateien nach public/vendor und setzt dieses Flag auf true. Die CDN-Adressen werden dann nicht mehr
  // genutzt; wer zurück auf CDN will, muss unpkg.com/cdn.jsdelivr.net auch wieder in public/_headers (CSP) eintragen.
  USE_LOCAL_LIBS: true,
  LIBS: {
    leaflet: {
      css: ['https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css'],
      js: ['https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js'],
      local: { css: './vendor/leaflet/leaflet.css', js: './vendor/leaflet/leaflet.js' },
    },
    cluster: {
      css: ['https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css', 'https://cdn.jsdelivr.net/npm/leaflet.markercluster@1.5.3/dist/MarkerCluster.css'],
      js: ['https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js', 'https://cdn.jsdelivr.net/npm/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js'],
      local: { css: './vendor/markercluster/MarkerCluster.css', js: './vendor/markercluster/leaflet.markercluster.js' },
    },
  },
};

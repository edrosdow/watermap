// Zentrale Einstellungen. Hier – und nur hier – werden Dienste und Grenzwerte angepasst.
export const CONFIG = {
  VERSION: '7.15.0',

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

  // Startansicht: 'data' = auf vorhandene Standorte zoomen, 'germany' = ganz Deutschland.
  START_MODE: 'data',
  GERMANY_VIEW: { center: [51.1, 10.4], zoom: 6 },
  FALLBACK_VIEW: { center: [51.45, 7.55], zoom: 8 },

  // Pegelstände (PEGELONLINE der WSV). Abruf über die eigene Domain; Netlify leitet weiter (public/_redirects).
  PEGEL_BASE: '/api/pegel/',
  PEGEL_REFRESH_MIN: 15,       // so oft misst die WSV
  PEGEL_STALE_HOURS: 6,        // ältere Messwerte gelten als veraltet
  PEGEL_HISTORY_DAYS: 7,
  PEGEL_ATTRIBUTION: 'Pegel: <a href="https://www.pegelonline.wsv.de" target="_blank" rel="noopener noreferrer">WSV/PEGELONLINE</a>',

  // Wetter und Wind (DWD-Daten über Bright Sky). Abruf über die eigene Domain (public/_redirects).
  WETTER_BASE: '/api/wetter/',
  WETTER_HOURS: 48,            // Vorhersagezeitraum im Diagramm
  WETTER_CACHE_MIN: 10,        // gleiche Stelle innerhalb dieser Zeit nicht erneut abfragen
  WETTER_GUST_HINT_KMH: 39,    // ab 6 Bft Böen ein Hinweis (gerade für kleine Boote)

  // „In der Nähe“ (Schleusen, Toiletten, Parkplätze … aus osm/extras.geojson)
  NEARBY_EXTRAS_M: 500,
  OVERPASS_API: 'https://overpass-api.de/api/interpreter',   // „In der Nähe“ direkt aus dem Browser
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

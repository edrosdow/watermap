// Zentrale Einstellungen. Hier – und nur hier – werden Dienste und Grenzwerte angepasst.
export const CONFIG = {
  VERSION: '7.0.0',

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

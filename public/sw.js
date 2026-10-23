// Service Worker: macht WaterMap installierbar und lässt Standortdaten offline lesbar bleiben.
// Strategie:
//  * eigene Dateien (Seite, Skripte, Daten): erst Netzwerk, bei Ausfall Zwischenspeicher → Updates kommen sofort an
//  * Bibliotheken von CDN und bereits gesehene Kartenkacheln: Zwischenspeicher zuerst (mit Obergrenze)
// Offline heißt deshalb: Standortliste und Details funktionieren; Kartenkacheln nur dort, wo man vorher war.
const VERSION = 'v7.22.2';
const SHELL = `watermap-shell-${VERSION}`;
const TILES = `watermap-tiles-${VERSION}`;
const LIBS = `watermap-libs-${VERSION}`;
const MAX_TILES = 400;

const SHELL_FILES = [
  './', './index.html', './css/app.css', './css/chart.css', './css/ampel.css', './css/nav.css', './css/pegel.css', './css/naehe.css', './css/page.css', './pegel-ampel.html', './manifest.webmanifest',
  './js/main.js', './js/config.js', './js/dom.js', './js/icons.js', './js/model.js', './js/data.js',
  './js/map.js', './js/search.js', './js/favorites.js', './js/forms.js', './js/photo-form.js', './js/nav.js', './js/meldungen.js', './js/lage-form.js', './js/pegel-daten.js', './js/pegel-ansicht.js', './js/pegel-dashboard.js', './js/pegel-fluss.js', './js/pegel-fluss-ansicht.js', './js/naehe.js', './js/detail.js', './js/pegel.js', './js/wetter.js', './js/chart.js', './js/extras.js', './js/umgebung-abfrage.js', './js/hafeninfo.js', './js/photos.js', './js/ampel.js', './js/ampel-logik.js',
  './icons/icon-192.png', './icons/favicon.svg',
  './vendor/leaflet/leaflet.js', './vendor/leaflet/leaflet.css',
  './vendor/markercluster/leaflet.markercluster.js', './vendor/markercluster/MarkerCluster.css',
  './data/meta.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL, TILES, LIBS]);
    for (const k of await caches.keys()) if (k.startsWith('watermap-') && !keep.has(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;          // Formular-Uploads laufen immer direkt ins Netz
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    // Nie zwischenspeichern: Formular-Endpunkte und der Service Worker selbst
    if (url.pathname.endsWith('/sw.js')) return;
    // Foto-Freigabe: nie zwischenspeichern (passwortgeschützt, eingereichte Bilder sind privat)
    if (url.pathname.startsWith('/.netlify/functions/') || url.pathname.startsWith('/admin/')) return;
    // Pegel-Verläufe nicht speichern (je Pegel eine Datei, nach 15 Minuten veraltet); die Pegelliste schon (offline mit Zeitstempel)
    if (url.pathname.includes('/api/pegel/') && url.pathname.includes('/measurements')) return;
    // Wetter nie aus dem Zwischenspeicher zeigen – veraltete Warnungen wären schlimmer als keine
    if (url.pathname.includes('/api/wetter/')) return;
    if (url.pathname.startsWith('/api/meldungen')) return;   // Lagemeldungen: immer frisch (Offline-Stand hält meldungen.js)
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) { const c = await caches.open(SHELL); c.put(req, res.clone()); }
        return res;
      } catch {
        const hit = await caches.match(req, { ignoreSearch: true });
        if (hit) return hit;
        if (req.mode === 'navigate') { const idx = await caches.match('./index.html'); if (idx) return idx; }
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    })());
    return;
  }

  const isTile = /(^|\.)tile\.openstreetmap\.org$/.test(url.hostname);
  const isLib = /(^|\.)(unpkg\.com|cdn\.jsdelivr\.net)$/.test(url.hostname);
  if (!isTile && !isLib) return;
  const name = isTile ? TILES : LIBS;
  event.respondWith((async () => {
    const cache = await caches.open(name);
    const hit = await cache.match(req);
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') { cache.put(req, res.clone()); if (isTile) trim(TILES, MAX_TILES); }
      return res;
    } catch {
      return hit || Response.error();
    }
  })());
});

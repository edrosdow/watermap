// Kapselt Leaflet (+ MarkerCluster). Der Rest der App kennt nur diese Schnittstelle.
import { CONFIG } from './config.js';
import { pinSvg } from './icons.js';
import { displayName, TYPES } from './model.js';

// ------------------------------------------------------------------ Bibliotheken laden
function loadCss(urls) {
  return new Promise((resolve) => {
    const next = (i) => {
      if (i >= urls.length) return resolve(false);
      const l = document.createElement('link');
      l.rel = 'stylesheet'; l.href = urls[i];
      l.onload = () => resolve(true);
      l.onerror = () => { l.remove(); next(i + 1); };
      document.head.append(l);
    };
    next(0);
  });
}

function loadScript(urls, isLoaded) {
  return new Promise((resolve) => {
    const next = (i) => {
      if (isLoaded()) return resolve(true);
      if (i >= urls.length) return resolve(false);
      const s = document.createElement('script');
      s.src = urls[i]; s.async = true;
      s.onload = () => resolve(isLoaded());
      s.onerror = () => { s.remove(); next(i + 1); };
      document.head.append(s);
    };
    next(0);
  });
}

// Selbst gehostet: keine CDN-Ausweichadressen (sonst gehen doch IP-Adressen an Dritte; die CSP blockt sie ohnehin)
const sources = (lib, kind) => (CONFIG.USE_LOCAL_LIBS ? [lib.local[kind]] : lib[kind]);

export async function loadMapLibraries() {
  const lf = CONFIG.LIBS.leaflet, cl = CONFIG.LIBS.cluster;
  const [, ok] = await Promise.all([loadCss(sources(lf, 'css')), loadScript(sources(lf, 'js'), () => !!window.L?.map)]);
  if (!ok) return { leaflet: false, cluster: false };
  await loadCss(sources(cl, 'css'));
  const cluster = await loadScript(sources(cl, 'js'), () => !!window.L?.markerClusterGroup);
  return { leaflet: true, cluster };
}

// ------------------------------------------------------------------ Karte
export function createMap(el, { onMoveEnd, onMapClick, onMarkerClick, useCluster }) {
  const L = window.L;
  const map = L.map(el, { zoomControl: false, worldCopyJump: false, tap: true }).setView(CONFIG.FALLBACK_VIEW.center, CONFIG.FALLBACK_VIEW.zoom);
  L.control.zoom({ position: 'bottomright', zoomInTitle: 'Vergrößern', zoomOutTitle: 'Verkleinern' }).addTo(map);
  L.tileLayer(CONFIG.TILE_URL, { maxZoom: CONFIG.TILE_MAX_ZOOM, attribution: CONFIG.TILE_ATTRIBUTION }).addTo(map);
  map.attributionControl.setPrefix(false);

  const layer = useCluster
    ? L.markerClusterGroup({
        showCoverageOnHover: false, chunkedLoading: true, maxClusterRadius: 52, disableClusteringAtZoom: 15,
        iconCreateFunction: (c) => {
          const n = c.getChildCount();
          const size = n < 10 ? 38 : n < 100 ? 44 : 50;
          return L.divIcon({ html: `<span>${n}</span>`, className: 'wm-cluster', iconSize: [size, size] });
        },
      })
    : L.layerGroup();
  layer.addTo(map);

  const markers = new Map(); // id → Leaflet-Marker
  let selectedId = null;
  let pickMarker = null;
  let pickHandler = null;
  let userMarker = null;

  const iconFor = (p, selected) => L.divIcon({
    className: 'wm-pin' + (selected ? ' is-selected' : ''),
    html: pinSvg(p.type, { selected }),
    iconSize: [44, 54], iconAnchor: [22, 52],
  });

  map.on('moveend', () => onMoveEnd && onMoveEnd());
  map.on('click', (e) => {
    if (pickHandler) { pickHandler(e.latlng); return; }
    onMapClick && onMapClick(e.latlng);
  });

  return {
    raw: map,

    setPlaces(places) {
      layer.clearLayers();
      markers.clear();
      const list = [];
      for (const p of places) {
        const m = L.marker([p.lat, p.lon], {
          icon: iconFor(p, p.id === selectedId),
          title: `${displayName(p)} – ${TYPES[p.type].label}`,
          alt: displayName(p), keyboard: true, riseOnHover: true,
        });
        m.on('click', () => onMarkerClick && onMarkerClick(p.id));
        markers.set(p.id, { marker: m, place: p });
        list.push(m);
      }
      if (layer.addLayers) layer.addLayers(list); else list.forEach(m => m.addTo(layer));
    },

    select(id) {
      const prev = markers.get(selectedId);
      if (prev) prev.marker.setIcon(iconFor(prev.place, false));
      selectedId = id;
      const cur = markers.get(id);
      if (cur) cur.marker.setIcon(iconFor(cur.place, true));
    },

    /** Zeigt den Standort sichtbar an; `inset` = von Panels verdeckte Ränder in Pixeln. */
    reveal(p, { zoom = 14, inset = {} } = {}) {
      const z = Math.max(map.getZoom(), zoom);
      const size = map.getSize();
      const left = inset.left || 0, right = inset.right || 0, top = inset.top || 0, bottom = inset.bottom || 0;
      const cx = (left + (size.x - right)) / 2, cy = (top + (size.y - bottom)) / 2;
      const target = map.project([p.lat, p.lon], z);
      const centerPx = target.add([size.x / 2 - cx, size.y / 2 - cy]);
      map.flyTo(map.unproject(centerPx, z), z, { duration: 0.6 });
    },

    flyTo(lat, lon, zoom) { map.flyTo([lat, lon], zoom, { duration: 0.7 }); },
    fitBounds(points, opts = {}) {
      if (!points.length) return;
      map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 12, ...opts });
    },
    setView(view) { map.setView(view.center, view.zoom); },
    getBounds() { const b = map.getBounds(); return { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }; },
    getCenter() { const c = map.getCenter(); return { lat: c.lat, lon: c.lng }; },
    getZoom() { return map.getZoom(); },
    invalidate() { map.invalidateSize(); },

    showUser(lat, lon, accuracy) {
      if (userMarker) userMarker.remove();
      userMarker = L.layerGroup([
        L.circle([lat, lon], { radius: Math.min(accuracy || 0, 2000), color: '#087F9C', weight: 1, fillOpacity: 0.08, interactive: false }),
        L.circleMarker([lat, lon], { radius: 7, color: '#fff', weight: 3, fillColor: '#087F9C', fillOpacity: 1, interactive: false }),
      ]).addTo(map);
    },

    /** Standort per Tippen auf die Karte wählen. Liefert {lat, lon} oder null (Abbruch). */
    pickLocation(initial) {
      return new Promise((resolve) => {
        const setMark = (ll) => {
          if (pickMarker) pickMarker.remove();
          pickMarker = L.marker(ll, { icon: L.divIcon({ className: 'wm-pick', html: '<span></span>', iconSize: [28, 28], iconAnchor: [14, 14] }), interactive: false }).addTo(map);
        };
        if (initial) setMark([initial.lat, initial.lon]);
        let current = initial ? { lat: initial.lat, lon: initial.lon } : null;
        pickHandler = (ll) => { current = { lat: ll.lat, lon: ll.lng }; setMark(ll); api.onPick && api.onPick(current); };
        const api = this.__pickApi = {
          confirm: () => { cleanup(); resolve(current); },
          cancel: () => { cleanup(); resolve(null); },
          onPick: null,
        };
        const cleanup = () => { pickHandler = null; if (pickMarker) { pickMarker.remove(); pickMarker = null; } this.__pickApi = null; };
      });
    },
    get pickApi() { return this.__pickApi; },
  };
}

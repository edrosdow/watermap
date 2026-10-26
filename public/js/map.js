// Kapselt Leaflet (+ MarkerCluster). Der Rest der App kennt nur diese Schnittstelle.
import { CONFIG } from './config.js';
import { gaugeMarkerHtml } from './pegel.js';
import { extraMarkerHtml, extraTitle, KINDS, GROUPS } from './extras.js';
import { pinSvg } from './icons.js';
import { favorites } from './favorites.js';
import { displayName, TYPES } from './model.js';
import { gebietLaden, kachelNoetig, imGebiet } from './gebiet.js';

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
export function createMap(el, { onMoveEnd, onMapClick, onMarkerClick, onAusserhalb, useCluster }) {
  const L = window.L;
  // Kartengebiet (CONFIG.GEBIET): Verschieben nur im Rechteck um Deutschland, Herauszoomen nur bis ganz Deutschland.
  // maxBounds begrenzt auch setView/flyTo/fitBounds (Leaflet verschiebt die Mitte ins Rechteck).
  const G = CONFIG.GEBIET, [[gs, gw], [gn, ge]] = G.bounds;
  const rahmen = L.latLngBounds([[gs - G.rand, gw - G.rand * 1.6], [gn + G.rand, ge + G.rand * 1.6]]);
  const map = L.map(el, { zoomControl: false, worldCopyJump: false, tap: true, maxBounds: rahmen, maxBoundsViscosity: 0.9, minZoom: 5, bounceAtZoomLimits: false,
    zoomSnap: 0.25, zoomDelta: 1 });   // Viertelstufen: ganz Deutschland füllt das Fenster möglichst gut
  // gleich mit ganz Deutschland beginnen (keine Kacheln eines Zwischenausschnitts)
  if (map.getSize().x > 50) map.fitBounds(L.latLngBounds(G.bounds), { padding: [6, 6], animate: false });
  else map.setView(CONFIG.FALLBACK_VIEW.center, CONFIG.FALLBACK_VIEW.zoom);
  L.control.zoom({ position: 'topright', zoomInTitle: 'Vergrößern', zoomOutTitle: 'Verkleinern' }).addTo(map);
  // Kacheln nur für das Gebiet laden (außerhalb liegt ohnehin die Maske)
  const Kacheln = L.TileLayer.extend({
    _isValidTile(c) { return L.TileLayer.prototype._isValidTile.call(this, c) && kachelNoetig(c.x, c.y, c.z); },
  });
  new Kacheln(CONFIG.TILE_URL, { maxZoom: CONFIG.TILE_MAX_ZOOM, attribution: CONFIG.TILE_ATTRIBUTION }).addTo(map);
  map.attributionControl.setPrefix(false);
  // Kleinster Zoom: ganz Deutschland passt gerade ins Kartenfenster (je nach Fenstergröße neu)
  const minZoomSetzen = () => {
    const s = map.getSize();
    if (s.x < 50 || s.y < 50) return;
    map.setMinZoom(Math.max(4, Math.min(8, map.getBoundsZoom(L.latLngBounds(G.bounds), false))));   // getBoundsZoom rundet auf zoomSnap ab
  };
  map.on('resize', minZoomSetzen); minZoomSetzen();
  // Maske: außerhalb des Gebiets eine neutrale Fläche (Canvas, eigene Ebene über den Kacheln, unter Markern)
  gebietLaden().then((g) => {
    const pane = map.createPane('wm-maske');
    pane.style.zIndex = 250; pane.style.pointerEvents = 'none';
    const welt = [[25, -45], [25, 65], [75, 65], [75, -45]];
    L.polygon([welt, ...g.ringe], { pane: 'wm-maske', renderer: L.canvas({ pane: 'wm-maske', padding: 0.5 }), interactive: false,
      color: '#0B3045', opacity: 0.35, weight: 1.2, fillColor: G.maske, fillOpacity: 1, smoothFactor: 1 }).addTo(map);
  }, () => { /* ohne Grenze bleibt das Rechteck */ });

  let meld = new Map();   // Standort-ID → { n, typ } aktiver Lagemeldungen („Heute vor Ort“)
  const layer = useCluster
    ? L.markerClusterGroup({
        showCoverageOnHover: false, chunkedLoading: true, chunkInterval: 40, chunkDelay: 16, maxClusterRadius: 52, disableClusteringAtZoom: 15,
        iconCreateFunction: (c) => {
          const n = c.getChildCount();
          const size = n < 10 ? 38 : n < 100 ? 44 : 50;
          // Roter Punkt, wenn ein enthaltener Standort als gesperrt gemeldet ist
          const stop = meld.size && c.getAllChildMarkers().some(m => meld.get(m.options.placeId)?.typ === 'gesperrt');
          return L.divIcon({ html: `<span>${n}</span>${stop ? '<b class="wm-cstop" aria-hidden="true"></b>' : ''}`, className: 'wm-cluster', iconSize: [size, size] });
        },
      })
    : L.layerGroup();
  layer.addTo(map);

  const markers = new Map(); // id → Leaflet-Marker
  let selectedId = null;
  let pickMarker = null;
  let pickHandler = null;
  let userMarker = null;

  const FAV_STAR = '<span class="wm-fav" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16"><path d="m12 3 2.8 5.8 6.2.8-4.5 4.4 1.1 6.2L12 17.2 6.4 20.2l1.1-6.2L3 9.6l6.2-.8z"/></svg></span>';
  const badge = (info) => (!info ? '' : info.typ === 'gesperrt'
    ? '<span class="wm-mbadge is-stop" aria-hidden="true"><i></i></span>'
    : `<span class="wm-mbadge" aria-hidden="true">${Math.min(99, info.n | 0)}</span>`);
  const iconFor = (p, selected) => L.divIcon({
    className: 'wm-pin' + (selected ? ' is-selected' : '') + (favorites.has(p.id) ? ' is-fav' : '') + (meld.has(p.id) ? ' has-meld' : ''),
    html: pinSvg(p.type, { selected }) + (favorites.has(p.id) ? FAV_STAR : '') + badge(meld.get(p.id)),
    iconSize: [44, 54], iconAnchor: [22, 52],
  });
  const titleFor = (p) => {
    const info = meld.get(p.id);
    return `${displayName(p)} – ${TYPES[p.type].label}` + (info ? (info.typ === 'gesperrt' ? ' – gesperrt gemeldet' : ` – ${info.n} aktuelle Meldung${info.n === 1 ? '' : 'en'}`) : '');
  };

  // Pegel: eigene Ebene, ohne Cluster, unter den Standort-Pins; bei kleinem Zoom nur Punkte (CSS)
  let gaugeLayer = null, gaugeMarkers = new Map(), gaugeSel = null;
  const gaugeIcon = (g, sel) => L.divIcon({ className: 'wm-gauge', html: gaugeMarkerHtml(g, sel), iconSize: null, iconAnchor: [9, 13] });
  const zoomClass = () => el.classList.toggle('wm-gauges-compact', map.getZoom() < 9);
  map.on('zoomend', zoomClass); zoomClass();

  // Extras: je Gruppe eine Ebene (mit kleinen Clustern, wenn verfügbar)
  const extraLayers = {}, extraMarkers = new Map();
  let extraSel = null;
  const extraIcon = (x, sel) => L.divIcon({ className: 'wm-extra-icon', html: extraMarkerHtml(x, sel), iconSize: null, iconAnchor: [13, 13] });

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
          icon: iconFor(p, p.id === selectedId), placeId: p.id,
          title: titleFor(p),
          alt: displayName(p), keyboard: true, riseOnHover: true,
        });
        m.on('click', () => onMarkerClick && onMarkerClick(p.id));
        markers.set(p.id, { marker: m, place: p });
        list.push(m);
      }
      if (layer.addLayers) layer.addLayers(list); else list.forEach(m => m.addTo(layer));
    },

    /** Aktive Lagemeldungen (Map Standort-ID → { n, typ }): Abzeichen an Pins und Clustern neu zeichnen. */
    setMeldungen(next) {
      const alt = meld;
      meld = next || new Map();
      for (const [id, { marker, place }] of markers) {
        const a = alt.get(id), b = meld.get(id);
        if (a?.n === b?.n && a?.typ === b?.typ) continue;
        marker.setIcon(iconFor(place, id === selectedId));
        if (marker.options) marker.options.title = titleFor(place);
        marker.getElement?.()?.setAttribute('title', titleFor(place));
      }
      layer.refreshClusters?.();
    },

    /** Pin neu zeichnen (z. B. nach Favorit an/aus). */
    refresh(id) {
      const cur = markers.get(id);
      if (cur) cur.marker.setIcon(iconFor(cur.place, id === selectedId));
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

    /** Pegel zeigen (Liste) oder entfernen (null). */
    setGauges(list, onClick) {
      if (gaugeLayer) { gaugeLayer.remove(); gaugeLayer = null; gaugeMarkers.clear(); }
      if (!list) { map.attributionControl.removeAttribution(CONFIG.PEGEL_ATTRIBUTION); return; }
      gaugeLayer = L.layerGroup().addTo(map);
      for (const g of list) {
        const m = L.marker([g.lat, g.lon], { icon: gaugeIcon(g, g.id === gaugeSel), title: `Pegel ${g.name}`, alt: `Pegel ${g.name}`, keyboard: true, zIndexOffset: 500 });
        m.on('click', () => onClick(g.id));
        gaugeMarkers.set(g.id, { marker: m, gauge: g });
        m.addTo(gaugeLayer);
      }
      map.attributionControl.addAttribution(CONFIG.PEGEL_ATTRIBUTION);
    },
    /** Extras einer Gruppe zeigen (Liste) oder entfernen (null). */
    setExtras(group, list, onClick) {
      if (extraLayers[group]) { extraLayers[group].remove(); delete extraLayers[group]; }
      for (const [id, e] of extraMarkers) if (e.group === group) extraMarkers.delete(id);
      if (!list) return;
      const color = GROUPS[group].color;
      const layer = useCluster
        ? L.markerClusterGroup({ showCoverageOnHover: false, chunkedLoading: true, chunkInterval: 40, chunkDelay: 16, maxClusterRadius: 40, disableClusteringAtZoom: 15,
            iconCreateFunction: (c) => L.divIcon({ html: `<span style="--c:${color}">${c.getChildCount()}</span>`, className: 'wm-extra-cluster', iconSize: [30, 30] }) })
        : L.layerGroup();
      const ms = list.map((x) => {
        const m = L.marker([x.lat, x.lon], { icon: extraIcon(x, x.id === extraSel), title: `${KINDS[x.kind].label}: ${extraTitle(x)}`, alt: extraTitle(x), keyboard: true, zIndexOffset: 400 });
        m.on('click', () => onClick(x.id));
        extraMarkers.set(x.id, { marker: m, x, group });
        return m;
      });
      if (layer.addLayers) layer.addLayers(ms); else ms.forEach(m => m.addTo(layer));
      extraLayers[group] = layer.addTo(map);
    },
    selectExtra(id) {
      const prev = extraMarkers.get(extraSel);
      if (prev) prev.marker.setIcon(extraIcon(prev.x, false));
      extraSel = id;
      const cur = extraMarkers.get(id);
      if (cur) cur.marker.setIcon(extraIcon(cur.x, true));
    },
    selectGauge(id) {
      const prev = gaugeMarkers.get(gaugeSel);
      if (prev) { prev.marker.setIcon(gaugeIcon(prev.gauge, false)); prev.marker.setZIndexOffset(500); }
      gaugeSel = id;
      const cur = gaugeMarkers.get(id);
      if (cur) { cur.marker.setIcon(gaugeIcon(cur.gauge, true)); cur.marker.setZIndexOffset(1000); }
    },
    fitBounds(points, opts = {}) {
      if (!points.length) return;
      map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 12, ...opts });
    },
    setView(view) { map.setView(view.center, view.zoom); },
    /** Ganz Deutschland mit Nord- und Ostseeküste zeigen (Startansicht). */
    zeigeGebiet() { map.fitBounds(L.latLngBounds(CONFIG.GEBIET.bounds), { padding: [6, 6] }); },
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
        pickHandler = (ll) => {
          if (!imGebiet(ll.lat, ll.lng)) { onAusserhalb && onAusserhalb(); return; }   // nur im Kartengebiet wählbar
          current = { lat: ll.lat, lon: ll.lng }; setMark(ll); api.onPick && api.onPick(current);
        };
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

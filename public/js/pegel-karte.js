// Karte im Pegel-Tab: eine eigene Leaflet-Karte (dieselbe Bibliothek und dieselben Kacheln wie die Hauptkarte) mit allen Pegeln
// als Wert-Pillen. Farbe nur, wenn der Pegel amtliche Kennwerte hat (MNW/MHW), sonst neutral grau. Viele Pegel → Cluster.
// Die Auswahl zeigt das Panel bzw. Bottom Sheet (pegel-dashboard.js); die Karte meldet nur, welcher Pegel gewählt wurde.
import { CONFIG } from './config.js';
import { h } from './dom.js';
import { loadMapLibraries } from './map.js';
import { fmt, zustand } from './pegel-ansicht.js';
import { meinePegel } from './pegel-daten.js';

// Ampel nach den Kennwerten DIESES Pegels: normal grün, unter MNW gelb-orange, über MHW rot, über HSW dunkelrot (gefüllt), ohne Kennwerte grau
export const FARBE = { low: '#E59A00', normal: '#2E9E5B', high: '#D9381E', hsw: '#B42318', neutral: '#8E9EAA' };
const PFEIL = { 1: '↗', 0: '→', '-1': '↘' }, PFEIL_WORT = { 1: 'steigend', 0: 'gleichbleibend', '-1': 'fallend' };
const MIT_FARBE = new Set(['low', 'normal', 'high', 'hsw']);
const WELLE = '<svg class="pk-welle" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M2 9c3-3 5 3 8 0s5 3 8 0 3 2 4 1M2 16c3-3 5 3 8 0s5 3 8 0 3 2 4 1"/></svg>';
export const ZOOM_MIT_ZAHL = 8;
export const ZOOM_OHNE_CLUSTER = 10;
export const ZOOM_AUSWAHL = 11;

/** Marker-HTML einer Pille: „● 245 cm ↗“ (Pfeil = Tendenz laut PEGELONLINE); nur feste Strings und Zahlen. */
export function pillenHtml(g, { gewaehlt = false, gemerkt = false } = {}) {
  const z = zustand(g);
  const farbe = MIT_FARBE.has(z) ? FARBE[z] : FARBE.neutral;
  const punkt = g.tide ? WELLE : '<b></b>';
  const pfeil = g.state !== 'old' && !g.tide && PFEIL[g.trend] ? `<em class="pk-pfeil" title="${PFEIL_WORT[g.trend]}">${PFEIL[g.trend]}</em>` : '';
  return `<span class="pk-pille is-${g.tide ? 'tide' : z}${gewaehlt ? ' is-gewaehlt' : ''}${gemerkt ? ' is-gemerkt' : ''}" style="--pk:${farbe}">${punkt}<span class="pk-zahl">${fmt(g.value)}<small> ${g.unit === 'cm' ? 'cm' : ''}</small></span>${pfeil}${gemerkt ? '<i class="pk-stern" aria-hidden="true">★</i>' : ''}</span>`;
}

/**
 * ctx = { stand(): { gauges, byId }, user(): {lat,lon}|null, waehlen(id), abwaehlen(), bewegt(), unten(): px, das Panel/Sheet unten verdeckt }
 * Rückgabe: { el, zeigen(), aktualisieren(), markieren(id), hinzeigen(g, {zoom}), filtern(fn), imAusschnitt(), mitte(), flyTo(lat, lon, zoom), passend(gauges) }
 */
export function pegelKarteAnsicht(ctx) {
  let map = null, layer = null, L = null, gewaehlt = null, filter = () => true, cluster = false;
  const marker = new Map();   // id → { m, g }
  const behaelter = h('div', { class: 'pk-karte', role: 'region', 'aria-label': 'Karte der Pegel' });
  const meldung = h('p', { class: 'pk-meldung', role: 'status', hidden: true });
  const legende = h('ul', { class: 'pk-legende', 'aria-label': 'Legende' },
    [['zwischen MNW und MHW', FARBE.normal], ['unter MNW', FARBE.low], ['über MHW', FARBE.high], ['über HSW', FARBE.hsw], ['ohne Kennwerte', FARBE.neutral]].map(([t, f]) =>
      h('li', { class: 'pk-leg' }, h('i', { style: `background:${f}`, 'aria-hidden': 'true' }), t)));
  const el = h('section', { class: 'pk-ansicht', 'aria-label': 'Pegel auf der Karte' }, behaelter, legende, meldung);

  const ikone = (g) => L.divIcon({ className: 'pk-marker', html: pillenHtml(g, { gewaehlt: g.id === gewaehlt, gemerkt: meinePegel.hat(g.id) }), iconSize: null, iconAnchor: [20, 13] });
  const kompakt = () => behaelter.classList.toggle('pk-kompakt', map.getZoom() < ZOOM_MIT_ZAHL);
  const zIndex = (g) => (g.id === gewaehlt ? 1000 : meinePegel.hat(g.id) ? 600 : 0);

  function startAusschnitt() {
    const gemerkt = meinePegel.alle().map(id => ctx.stand()?.byId.get(id)).filter(Boolean);
    if (gemerkt.length) { map.fitBounds(L.latLngBounds(gemerkt.map(g => [g.lat, g.lon])), { padding: [60, 60], maxZoom: 10, animate: false }); return; }
    const u = ctx.user();
    if (u) { map.setView([u.lat, u.lon], 9, { animate: false }); return; }
    map.fitBounds(L.latLngBounds(CONFIG.GEBIET.bounds), { padding: [6, 6], animate: false });
  }

  function markerSetzen() {
    if (layer) layer.remove();
    marker.clear();
    layer = cluster
      ? L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 44, disableClusteringAtZoom: ZOOM_OHNE_CLUSTER, chunkedLoading: true, spiderfyOnMaxZoom: false,
        iconCreateFunction: (c) => L.divIcon({ html: `<span>${c.getChildCount()}</span>`, className: 'pk-cluster', iconSize: [40, 40] }) })
      : L.layerGroup();
    const liste = [];
    for (const g of ctx.stand()?.gauges || []) {
      if (!filter(g)) continue;
      const m = L.marker([g.lat, g.lon], { icon: ikone(g), title: `Pegel ${g.name}, ${fmt(g.value)} ${g.unit}${g.state !== 'old' && PFEIL_WORT[g.trend] ? `, ${PFEIL_WORT[g.trend]}` : ''}`, alt: `Pegel ${g.name}`, keyboard: true, zIndexOffset: zIndex(g) });
      m.on('click', () => ctx.waehlen(g.id));
      marker.set(g.id, { m, g });
      liste.push(m);
    }
    if (layer.addLayers) layer.addLayers(liste); else liste.forEach(m => m.addTo(layer));
    layer.addTo(map);
  }

  /** Bildschirmpunkt eines Orts in der Karte (ohne Leaflet-Hilfen, damit es auch mit dem Test-Ersatz geht). */
  function punkt(lat, lon) {
    const z = map.getZoom(), c = map.project(map.getCenter(), z), p = map.project([lat, lon], z), s = map.getSize();
    return { x: p.x - c.x + s.x / 2, y: p.y - c.y + s.y / 2 };
  }

  /** Pegel sichtbar machen: in den freien Teil der Karte rücken (über dem Bottom Sheet), bei Bedarf hineinzoomen. */
  function hinzeigen(g, { zoom = null, immer = false } = {}) {
    if (!map) return;
    const s = map.getSize(), unten = Math.min(ctx.unten?.() || 0, s.y * 0.7);
    const z = zoom !== null ? Math.max(map.getZoom(), zoom) : map.getZoom();
    const p = punkt(g.lat, g.lon), rand = 40;
    const sichtbar = p.x > rand && p.x < s.x - rand && p.y > rand + 60 && p.y < s.y - unten - rand;
    if (!immer && sichtbar && z === map.getZoom()) return;
    // Mitte so setzen, dass der Pegel in der Mitte des freien Bereichs liegt
    const ziel = map.project([g.lat, g.lon], z).add([0, unten / 2]);
    map.setView(map.unproject(ziel, z), z, { animate: true });
  }

  function markieren(id) {
    const alt = marker.get(gewaehlt);
    gewaehlt = id;
    if (alt) { alt.m.setIcon(ikone(alt.g)); alt.m.setZIndexOffset(zIndex(alt.g)); }
    const neu = marker.get(id);
    if (neu) { neu.m.setIcon(ikone(neu.g)); neu.m.setZIndexOffset(1000); }
  }

  async function erzeugen() {
    const libs = await loadMapLibraries();
    if (!libs.leaflet) { meldung.textContent = 'Die Karte konnte nicht geladen werden. Suche und „Meine Pegel“ funktionieren trotzdem.'; meldung.hidden = false; return false; }
    L = window.L; cluster = !!libs.cluster && typeof L.markerClusterGroup === 'function';
    map = L.map(behaelter, { zoomControl: false, worldCopyJump: false, tap: true, zoomSnap: 0.25, zoomDelta: 1, minZoom: 5, maxBounds: L.latLngBounds(CONFIG.GEBIET.europa), maxBoundsViscosity: 0.9 });
    L.control.zoom({ position: 'topright', zoomInTitle: 'Vergrößern', zoomOutTitle: 'Verkleinern' }).addTo(map);
    L.tileLayer(CONFIG.TILE_URL, { maxZoom: CONFIG.TILE_MAX_ZOOM, attribution: `${CONFIG.TILE_ATTRIBUTION} · ${CONFIG.PEGEL_ATTRIBUTION}` }).addTo(map);
    map.attributionControl.setPrefix(false);
    map.on('zoomend', kompakt);
    map.on('moveend', () => ctx.bewegt?.());
    map.on('click', () => { if (gewaehlt) ctx.abwaehlen(); });
    return true;
  }

  let bereit = null, ersterAusschnitt = true;
  return {
    el,
    /** Beim Anzeigen: Karte (einmal) aufbauen, Größe neu bestimmen. */
    async zeigen() {
      bereit ||= erzeugen();
      if (!(await bereit)) return false;
      map.invalidateSize();
      if (behaelter.offsetWidth < 50) return false;   // noch unsichtbar: Ausschnitt erst beim Anzeigen setzen
      if (ersterAusschnitt || !layer) { markerSetzen(); startAusschnitt(); kompakt(); ersterAusschnitt = false; }
      return true;
    },
    get bereit() { return !!map && !ersterAusschnitt; },
    /** Neue Messwerte, geänderter Filter oder „Meine Pegel“: Marker neu setzen (Ausschnitt bleibt). */
    aktualisieren() { if (map && layer) { markerSetzen(); kompakt(); } },
    filtern(fn) { filter = fn || (() => true); if (map && layer) markerSetzen(); },
    markieren, hinzeigen,
    /** Pegel im sichtbaren Kartenausschnitt (über dem Sheet), nach Abstand zur Mitte. */
    imAusschnitt() {
      if (!map) return [];
      const s = map.getSize(), unten = Math.min(ctx.unten?.() || 0, s.y * 0.7);
      const mx = s.x / 2, my = (s.y - unten) / 2;
      return (ctx.stand()?.gauges || []).map(g => ({ g, p: punkt(g.lat, g.lon) }))
        .filter(({ p }) => p.x >= 0 && p.x <= s.x && p.y >= 0 && p.y <= s.y - unten)
        .sort((a, b) => Math.hypot(a.p.x - mx, a.p.y - my) - Math.hypot(b.p.x - mx, b.p.y - my)).map(e => e.g);
    },
    flyTo(lat, lon, zoom) { if (!map) return; const z = zoom ?? map.getZoom(); const unten = Math.min(ctx.unten?.() || 0, map.getSize().y * 0.7); map.setView(map.unproject(map.project([lat, lon], z).add([0, unten / 2]), z), z); },
    /** Alle genannten Pegel ins Bild holen. */
    passend(gauges) { if (!map || !gauges.length) return; map.fitBounds(L.latLngBounds(gauges.map(g => [g.lat, g.lon])), { padding: [50, 50], paddingBottomRight: [50, 50 + (ctx.unten?.() || 0)], maxZoom: 11 }); },
    get gewaehlt() { return gewaehlt; },
    get map() { return map; },
  };
}

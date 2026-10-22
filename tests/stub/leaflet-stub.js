// NUR FÜR TESTS: minimaler Ersatz für Leaflet + MarkerCluster (Web-Mercator, echte DOM-Marker).
// Er prüft die Anwendungslogik, NICHT die echte Kartendarstellung.
(function () {
  const T = 256;
  const proj = (lat, lon, z) => {
    const s = T * 2 ** z, sin = Math.sin(lat * Math.PI / 180);
    return { x: (lon + 180) / 360 * s, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s };
  };
  const unproj = (x, y, z) => {
    const s = T * 2 ** z, n = Math.PI - 2 * Math.PI * y / s;
    return { lat: 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lng: x / s * 360 - 180 };
  };
  class Pt { constructor(x, y) { this.x = x; this.y = y; } add(p) { const a = Array.isArray(p) ? p : [p.x, p.y]; return new Pt(this.x + a[0], this.y + a[1]); } }
  const ll = (a) => Array.isArray(a) ? { lat: a[0], lng: a[1] } : a;

  class Marker {
    constructor(latlng, opts) { this.ll = ll(latlng); this.opts = opts || {}; this.icon = this.opts.icon; this.h = {}; this.node = null; this.map = null; }
    on(ev, fn) { this.h[ev] = fn; return this; }
    setIcon(i) { this.icon = i; if (this.map) this.map._draw(); }
    setZIndexOffset(z) { this.zOffset = z; return this; }
    addTo(layer) { (layer._add ? layer._add(this) : layer.addLayer(this)); return this; }
    remove() { if (this.group) this.group._remove(this); }
  }
  class Group {
    constructor() { this.items = []; this.map = null; }
    addTo(map) { this.map = map; map._groups.add(this); map._draw(); return this; }
    _add(m) { m.group = this; this.items.push(m); this.map && this.map._draw(); }
    _remove(m) { this.items = this.items.filter(x => x !== m); this.map && this.map._draw(); }
    addLayer(m) { this._add(m); }
    addLayers(arr) { arr.forEach(m => { m.group = this; this.items.push(m); }); this.map && this.map._draw(); }
    clearLayers() { this.items = []; this.map && this.map._draw(); }
    remove() { if (this.map) { this.map._groups.delete(this); this.map._draw(); } }
  }

  class MapObj {
    constructor(el) {
      this.el = el; this.z = 8; this.c = { lat: 51.4, lng: 7.5 }; this._groups = new Set(); this.h = {};
      el.classList.add('leaflet-container'); el.style.position = 'absolute';
      this.layerEl = document.createElement('div'); this.layerEl.style.cssText = 'position:absolute;inset:0;overflow:hidden';
      el.append(this.layerEl);
      el.addEventListener('click', (e) => { if (e.target.closest('.leaflet-marker-icon')) return; const r = el.getBoundingClientRect(); const p = this._unproject(e.clientX - r.left, e.clientY - r.top); this._fire('click', { latlng: p }); });
      this.attributionControl = { setPrefix() {}, addAttribution() {}, removeAttribution() {} };
    }
    _fire(ev, d) { (this.h[ev] || []).forEach(f => f(d)); }
    on(ev, fn) { (this.h[ev] ||= []).push(fn); return this; }
    getSize() { return new Pt(this.el.clientWidth || 800, this.el.clientHeight || 600); }
    project(l, z = this.z) { const a = ll(l), p = proj(a.lat, a.lng, z); return new Pt(p.x, p.y); }
    unproject(p, z = this.z) { return unproj(p.x, p.y, z); }
    _unproject(px, py) { const s = this.getSize(), c = proj(this.c.lat, this.c.lng, this.z); return unproj(c.x + px - s.x / 2, c.y + py - s.y / 2, this.z); }
    setView(l, z) { this.c = ll(l); if (z !== undefined) this.z = z; this._draw(); this._fire('moveend'); return this; }
    flyTo(l, z) { return this.setView(l, z); }
    getZoom() { return this.z; }
    getCenter() { return this.c; }
    getBounds() {
      const s = this.getSize(), c = proj(this.c.lat, this.c.lng, this.z);
      const nw = unproj(c.x - s.x / 2, c.y - s.y / 2, this.z), se = unproj(c.x + s.x / 2, c.y + s.y / 2, this.z);
      return { getSouth: () => se.lat, getNorth: () => nw.lat, getWest: () => nw.lng, getEast: () => se.lng };
    }
    fitBounds(b, o = {}) {
      const pts = b.pts; const lats = pts.map(p => p.lat), lons = pts.map(p => p.lng);
      const c = { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lng: (Math.min(...lons) + Math.max(...lons)) / 2 };
      const s = this.getSize(); let z = o.maxZoom ?? 12;
      while (z > 2) { const a = proj(Math.max(...lats), Math.min(...lons), z), d = proj(Math.min(...lats), Math.max(...lons), z); if (Math.abs(d.x - a.x) < s.x - 80 && Math.abs(d.y - a.y) < s.y - 80) break; z--; }
      return this.setView(c, z);
    }
    addLayer(m) { const g = new Group(); g.map = this; this._groups.add(g); g._add(m); }
    invalidateSize() { this._draw(); }
    _draw() {
      if (!this.layerEl) return;
      this.layerEl.replaceChildren();
      const s = this.getSize(), c = proj(this.c.lat, this.c.lng, this.z);
      for (const g of this._groups) for (const m of g.items) {
        const p = proj(m.ll.lat, m.ll.lng, this.z), x = p.x - c.x + s.x / 2, y = p.y - c.y + s.y / 2;
        if (x < -60 || y < -60 || x > s.x + 60 || y > s.y + 60) continue;
        const i = m.icon || {}, [w, h] = i.iconSize || [20, 20], [ax, ay] = i.iconAnchor || [w / 2, h / 2];
        const n = document.createElement('div');
        n.className = 'leaflet-marker-icon ' + (i.className || '');
        n.style.cssText = `position:absolute;left:${x - ax}px;top:${y - ay}px;width:${w}px;height:${h}px`;
        n.innerHTML = i.html || '';
        if (m.opts.title) { n.setAttribute('title', m.opts.title); n.setAttribute('role', 'button'); n.tabIndex = 0; }
        if (m.h.click) n.addEventListener('click', (e) => { e.stopPropagation(); m.h.click(e); });
        this.layerEl.append(n);
      }
    }
  }

  window.L = {
    map: (el) => new MapObj(el),
    control: { zoom: () => ({ addTo() { } }) },
    tileLayer: () => ({ addTo() { } }),
    layerGroup: (items) => { const g = new Group(); (items || []).forEach(() => { }); return g; },
    markerClusterGroup: () => new Group(),
    divIcon: (o) => o,
    marker: (l, o) => new Marker(l, o),
    latLngBounds: (pts) => ({ pts: pts.map(ll) }),
    circle: () => new Marker([0, 0], {}), circleMarker: () => new Marker([0, 0], {}),
  };
  const lg = window.L.layerGroup;
  window.L.layerGroup = (items) => { const g = lg(); if (items) { /* Nutzer-Marker: im Stub unsichtbar */ } return g; };
})();

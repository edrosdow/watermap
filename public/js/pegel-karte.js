// Ansicht „Karte“ im Pegel-Tab: eigene Leaflet-Karte mit allen Pegeln als Wert-Pillen (Zustandsfarbe, Tidepegel mit Wellen-Symbol),
// Legende, Vorschau-Karte zum gewählten Pegel. Die Hauptkarte bleibt unberührt.
import { CONFIG } from './config.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { loadMapLibraries } from './map.js';
import { formatDistance, haversine } from './model.js';
import { fmt, zustand, ZUSTAND, etikett, trendText, trendKlasse, sternKnopf } from './pegel-ansicht.js';
import { meinePegel, zusatzLaden } from './pegel-daten.js';
import { zusatzEtiketten } from './pegel-ansicht.js';

const FARBE = { low: '#FAB219', normal: '#6CBF84', high: '#EC835A', hsw: '#D03B3B', none: '#9AAAB5' };
const FARBE_ZUSTAND = (z) => (FARBE[z] || FARBE.none);
const WELLE = '<svg class="pk-welle" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M2 9c3-3 5 3 8 0s5 3 8 0 3 2 4 1M2 16c3-3 5 3 8 0s5 3 8 0 3 2 4 1"/></svg>';
export const ZOOM_MIT_ZAHL = 9;

/** Marker-HTML einer Pille: nur feste Strings und Zahlen. */
export function pillenHtml(g, { gewaehlt = false, gemerkt = false } = {}) {
  const z = zustand(g);
  const tide = !!g.tide;
  const farbe = tide ? '#4A90B8' : FARBE_ZUSTAND(z);
  const punkt = tide ? WELLE : '<b></b>';
  return `<span class="pk-pille is-${tide ? 'tide' : z}${gewaehlt ? ' is-gewaehlt' : ''}${gemerkt ? ' is-gemerkt' : ''}" style="--pk:${farbe}">${punkt}<span class="pk-zahl">${fmt(g.value)}</span></span>`;
}

/**
 * ctx = { stand(): { gauges, byId }, user(): {lat,lon}|null, isMobile(), open(id), toast(text) }
 * Rückgabe: { el, zeigen(), aktualisieren(), waehlen(id) }
 */
export function pegelKarteAnsicht(ctx) {
  let map = null, layer = null, L = null, gewaehlt = null;
  const marker = new Map();   // id → { m, g }
  const behaelter = h('div', { class: 'pk-karte', role: 'application', 'aria-label': 'Karte der Pegel' });
  const meldung = h('p', { class: 'pk-meldung', role: 'status', hidden: true });
  const vorschau = h('div', { class: 'pk-vorschau', hidden: true });
  const legende = h('ul', { class: 'pk-legende', 'aria-label': 'Legende' },
    [['niedrig', FARBE.low], ['normal', FARBE.normal], ['hoch', FARBE.high], ['über HSW', FARBE.hsw]].map(([t, f]) =>
      h('li', { class: 'pk-leg' }, h('i', { style: `background:${f}`, 'aria-hidden': 'true' }), t)));
  const el = h('section', { class: 'pk-ansicht', 'aria-label': 'Pegel auf der Karte' }, behaelter, legende, meldung, vorschau);

  const ikone = (g) => L.divIcon({ className: 'pk-marker', html: pillenHtml(g, { gewaehlt: g.id === gewaehlt, gemerkt: meinePegel.hat(g.id) }), iconSize: null, iconAnchor: [20, 13] });
  const kompakt = () => behaelter.classList.toggle('pk-kompakt', map.getZoom() < ZOOM_MIT_ZAHL);

  function startAusschnitt(liste) {
    const gemerkt = meinePegel.alle().map(id => ctx.stand().byId.get(id)).filter(Boolean);
    if (gemerkt.length) { map.fitBounds(L.latLngBounds(gemerkt.map(g => [g.lat, g.lon])), { padding: [60, 60], maxZoom: 11, animate: false }); return; }
    const u = ctx.user();
    if (u) { map.setView([u.lat, u.lon], 10, { animate: false }); return; }
    map.fitBounds(L.latLngBounds(CONFIG.GEBIET.bounds), { padding: [6, 6], animate: false });
  }

  function markerSetzen() {
    if (layer) layer.remove();
    marker.clear();
    layer = L.layerGroup().addTo(map);
    for (const g of ctx.stand().gauges) {
      const m = L.marker([g.lat, g.lon], { icon: ikone(g), title: `Pegel ${g.name}`, alt: `Pegel ${g.name}`, keyboard: true, zIndexOffset: meinePegel.hat(g.id) ? 600 : 0 });
      m.on('click', () => waehlen(g.id));
      marker.set(g.id, { m, g });
      m.addTo(layer);
    }
  }

  function vorschauZeichnen(g) {
    const z = zustand(g), u = ctx.user();
    const d = u ? haversine(u.lat, u.lon, g.lat, g.lon) : null;
    const gemerkt = () => meinePegel.hat(g.id);
    const merken = h('button', { type: 'button', class: 'pk-merken', 'aria-pressed': String(gemerkt()), onclick: () => { meinePegel.umschalten(g.id); vorschauZeichnen(g); } },
      gemerkt() ? 'Gemerkt ' : 'Merken ', h('span', { html: icon('star', 18, gemerkt()), 'aria-hidden': 'true' }));
    vorschau.replaceChildren(
      h('div', { class: 'pk-v-kopf' },
        h('div', {}, h('h3', { class: 'pk-v-name', text: g.name }), h('p', { class: 'pk-v-sub', text: [g.water, d !== null ? `${formatDistance(d)} entfernt` : ''].filter(Boolean).join(' · ') })),
        etikett(g)),
      h('div', { class: 'pk-v-wert' }, h('strong', { text: fmt(g.value) }), h('span', { class: 'pk-v-einheit', text: ` ${g.unit}` }),
        g.trend !== null ? h('span', { class: `pk-v-trend ${trendKlasse(g)}`, text: trendText(g) }) : null,
        h('span', { class: 'pk-v-extra', 'data-extra': '' })),
      h('div', { class: 'pk-v-knoepfe' },
        h('button', { type: 'button', class: 'btn btn-primary pk-details', onclick: () => ctx.open(g.id) }, 'Details'), merken));
    vorschau.hidden = false;
    vorschau.dataset.id = g.id;
    zusatzLaden(g.id).then((z) => { if (vorschau.dataset.id === g.id) { const e = vorschau.querySelector('[data-extra]'); if (e) e.textContent = zusatzEtiketten(z).join(' · '); } });
  }

  function waehlen(id, { fly = false } = {}) {
    const alt = marker.get(gewaehlt);
    gewaehlt = id;
    if (alt) { alt.m.setIcon(ikone(alt.g)); alt.m.setZIndexOffset(meinePegel.hat(alt.g.id) ? 600 : 0); }
    const neu = marker.get(id);
    if (!neu) { vorschau.hidden = true; return; }
    neu.m.setIcon(ikone(neu.g)); neu.m.setZIndexOffset(1000);
    vorschauZeichnen(neu.g);
    if (fly) map.panTo([neu.g.lat, neu.g.lon]);
  }

  async function erzeugen() {
    const libs = await loadMapLibraries();
    if (!libs.leaflet) { meldung.textContent = 'Die Karte konnte nicht geladen werden.'; meldung.hidden = false; return false; }
    L = window.L;
    map = L.map(behaelter, { zoomControl: false, worldCopyJump: false, tap: true, zoomSnap: 0.25, zoomDelta: 1, minZoom: 4, maxBounds: L.latLngBounds(CONFIG.GEBIET.europa), maxBoundsViscosity: 0.9 });
    L.control.zoom({ position: 'topright', zoomInTitle: 'Vergrößern', zoomOutTitle: 'Verkleinern' }).addTo(map);
    L.tileLayer(CONFIG.TILE_URL, { maxZoom: CONFIG.TILE_MAX_ZOOM, attribution: `${CONFIG.TILE_ATTRIBUTION} · ${CONFIG.PEGEL_ATTRIBUTION}` }).addTo(map);
    map.attributionControl.setPrefix(false);
    map.on('zoomend', kompakt);
    map.on('click', () => { if (gewaehlt) { const a = marker.get(gewaehlt); gewaehlt = null; if (a) a.m.setIcon(ikone(a.g)); vorschau.hidden = true; } });
    return true;
  }

  let bereit = null, ersterAusschnitt = true;
  return {
    el,
    /** Beim Anzeigen: Karte (einmal) aufbauen, Größe neu bestimmen. */
    async zeigen() {
      bereit ||= erzeugen();
      if (!(await bereit)) return;
      map.invalidateSize();
      if (behaelter.offsetWidth < 50) return;   // noch unsichtbar (Hintergrundaufbau): Ausschnitt erst beim Anzeigen setzen
      if (ersterAusschnitt || !layer) { markerSetzen(); startAusschnitt(); kompakt(); ersterAusschnitt = false; }
    },
    /** Neue Messwerte / geänderte „Meine Pegel“: Marker neu setzen (Ausschnitt bleibt). */
    aktualisieren() {
      if (!map || !layer) return;
      const id = gewaehlt;
      markerSetzen(); kompakt();
      if (id && marker.has(id)) waehlen(id);
    },
    waehlen,
    get gewaehlt() { return gewaehlt; },
    /** Zusatzzeile in der Vorschau (z. B. Wassertemperatur in Stufe 2). */
    extra(text) { const e = vorschau.querySelector('[data-extra]'); if (e) e.textContent = text || ''; },
  };
}

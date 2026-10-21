// Extras aus OpenStreetMap: Schleusen, Brücken, Wehre (Ebene „Wasserstraße“) sowie Kanu-Einstiege, Verleih,
// Toiletten, Wasser, Gastronomie, Rastplätze und Parkplätze (Ebene „Service“). Datei: data/osm/extras.geojson.
// Text aus den Daten wird nur als Text eingefügt.
import { CONFIG } from './config.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { haversine, formatDistance, navUrl, safeHttpUrl, safeTel, UNKNOWN } from './model.js';

export const GROUPS = {
  wasser: { label: 'Schleusen & Brücken', color: '#3D4F63', kinds: ['lock', 'bridge', 'weir'] },
  service: { label: 'Service', color: '#4C7A2E', kinds: ['canoe', 'rental', 'toilets', 'water', 'food', 'rest', 'parking'] },
};

// Zeichen im 24er-Raster (Linien, weiß auf Gruppenfarbe)
const G = {
  lock: '<path d="M5 4v16M19 4v16M5 9h14M5 15h14"/><path d="M9.5 12h5"/>',
  bridge: '<path d="M3 9h18M5 9v9M19 9v9"/><path d="M5 18c0-4 3-6.5 7-6.5s7 2.5 7 6.5"/>',
  weir: '<path d="M3 8h8v8h10"/><path d="M11 9.5q2.5 1 3 4.5"/><path d="M14.5 19q1.5-1.2 3 0t3 0"/>',
  canoe: '<path d="M2.5 13.5c4 2.5 15 2.5 19 0-4-1.5-15-1.5-19 0z"/><path d="M8 6l8 12"/><path d="M6.6 4l2.6 3.8M14.8 16.2l2.6 3.8"/>',
  rental: '<path d="M3 15c3.5 2 14.5 2 18 0-3.5-1.3-14.5-1.3-18 0z"/><circle cx="16.5" cy="7" r="2.5"/><path d="M14.7 8.8 9 14.5M10.5 13l1.5 1.5"/>',
  toilets: '<circle cx="8" cy="5.5" r="1.8"/><circle cx="16" cy="5.5" r="1.8"/><path d="M8 9v11M6 10h4l-1 5M16 9l-2.5 7h5L16 9M16 16v4"/>',
  water: '<path d="M12 3.5s6 6.5 6 10.5a6 6 0 0 1-12 0c0-4 6-10.5 6-10.5z"/>',
  food: '<path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M16 3c-2 1.5-2.5 4-2.5 7H17V3zM17 10v11"/>',
  rest: '<path d="M4 18 12 5l8 13z"/><path d="M12 5v13M9 18l3-5 3 5"/>',
  parking: '<path d="M8 20V4h5a4.5 4.5 0 0 1 0 9H8"/>',
};

export const KINDS = {
  lock:    { group: 'wasser', label: 'Schleuse', plural: 'Schleusen' },
  bridge:  { group: 'wasser', label: 'Brücke', plural: 'Brücken mit Durchfahrtshöhe' },
  weir:    { group: 'wasser', label: 'Wehr', plural: 'Wehre' },
  canoe:   { group: 'service', label: 'Kanu-Einstieg', plural: 'Kanu-Ein-/Ausstiege' },
  rental:  { group: 'service', label: 'Bootsverleih', plural: 'Bootsverleih' },
  toilets: { group: 'service', label: 'Toilette', plural: 'Toiletten' },
  water:   { group: 'service', label: 'Wasserstelle', plural: 'Wasserstellen' },
  food:    { group: 'service', label: 'Gastronomie', plural: 'Gastronomie' },
  rest:    { group: 'service', label: 'Rastplatz', plural: 'Rast- und Zeltplätze' },
  parking: { group: 'service', label: 'Parkplatz', plural: 'Parkplätze' },
};

const SUB = {
  restaurant: 'Restaurant', cafe: 'Café', biergarten: 'Biergarten', fast_food: 'Imbiss', pub: 'Kneipe', kiosk: 'Kiosk',
  camp_site: 'Zeltplatz', picnic_site: 'Rastplatz', drinking_water: 'Trinkwasser', water_point: 'Wasserstelle',
};

export function glyph(kind, px = 16) {
  return `<svg width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${G[kind] || ''}</svg>`;
}

export const kindColor = (kind) => GROUPS[KINDS[kind].group].color;

/** Anzeigename: eigener Name, sonst die Art (bei Gastronomie/Rast die genauere Unterart). */
export function extraTitle(x) {
  if (x.name) return x.name;
  if (x.kind === 'canoe') return x.attrs.put_in && x.attrs.egress ? 'Kanu-Ein- und Ausstieg' : x.attrs.egress ? 'Kanu-Ausstieg' : 'Kanu-Einstieg';
  return SUB[x.attrs.sub] || KINDS[x.kind].label;
}

const fmtM = (v) => `${v.toLocaleString('de-DE', { maximumFractionDigits: 2 })} m`;

/** Kurzinfo hinter dem Namen, z. B. „Durchfahrtshöhe 4,5 m“. */
export function extraShort(x) {
  const a = x.attrs;
  if (x.kind === 'bridge' && (a.clearance ?? a.clearance_closed) !== undefined) return `Durchfahrtshöhe ${fmtM(a.clearance ?? a.clearance_closed)}`;
  if (x.kind === 'lock' && a.length) return `Kammer ${fmtM(a.length)}${a.width ? ` × ${fmtM(a.width)}` : ''}`;
  if (x.kind === 'water' && a.drinkable === false) return 'kein Trinkwasser';
  if (x.kind === 'parking' && a.trailer) return 'auch für Anhänger';
  return x.name ? (SUB[a.sub] || KINDS[x.kind].label) : '';
}

// ------------------------------------------------------------------ Laden
let loading = null;

export function loadExtras(meta) {
  const rel = meta?.files?.extras;
  if (!rel) return Promise.resolve([]);
  if (!loading) {
    loading = fetch(CONFIG.DATA_BASE + rel).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(fc => (fc.features || []).map(normalize).filter(Boolean))
      .catch((e) => { loading = null; throw e; });
  }
  return loading;
}

function normalize(f) {
  const p = f?.properties || {}, c = f?.geometry?.coordinates;
  if (!KINDS[p.kind] || !Array.isArray(c) || typeof f.id !== 'string') return null;
  const [lon, lat] = c;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { id: f.id, kind: p.kind, name: p.name || null, lat, lon, attrs: p.attrs || {}, fee: p.fee ?? null,
    opening_hours: p.opening_hours || null, operator: p.operator || null, website: p.website || null, phone: p.phone || null, osm: p.osm || null };
}

/** Extras im Umkreis (Meter), nach Entfernung sortiert. */
export function nearby(list, lat, lon, radius, exclude) {
  const dLat = radius / 111000, dLon = radius / (111000 * Math.cos(lat * Math.PI / 180));
  return list.filter(x => x.id !== exclude && Math.abs(x.lat - lat) <= dLat && Math.abs(x.lon - lon) <= dLon)
    .map(x => ({ x, d: haversine(lat, lon, x.lat, x.lon) })).filter(e => e.d <= radius).sort((a, b) => a.d - b.d);
}

// ------------------------------------------------------------------ Marker
export function extraMarkerHtml(x, selected = false) {
  const color = kindColor(x.kind);
  const label = x.kind === 'bridge' && (x.attrs.clearance ?? x.attrs.clearance_closed) !== undefined
    ? `<span>${(x.attrs.clearance ?? x.attrs.clearance_closed).toLocaleString('de-DE', { maximumFractionDigits: 1 })}&nbsp;m</span>` : '';
  return `<span class="wm-extra${label ? ' has-label' : ''}${selected ? ' is-selected' : ''}" style="--c:${color}"><b>${glyph(x.kind, 14)}</b>${label}</span>`;
}

// ------------------------------------------------------------------ Detail
const yesNo = (v) => (v === true ? 'ja' : v === false ? 'nein' : null);

function facts(x) {
  const a = x.attrs, out = [];
  const add = (label, value) => out.push({ label, value: value ?? null });
  switch (x.kind) {
    case 'lock':
      add('Kammerlänge', a.length ? fmtM(a.length) : null); add('Kammerbreite', a.width ? fmtM(a.width) : null);
      if (a.ref) add('Kennung', a.ref);
      add('UKW-Kanal', a.vhf || null); add('Betriebszeiten', x.opening_hours); break;
    case 'bridge':
      add('Durchfahrtshöhe', a.clearance !== undefined ? fmtM(a.clearance) : null);
      if (a.clearance_closed !== undefined) add('geschlossen', fmtM(a.clearance_closed));
      if (a.clearance_open !== undefined) add('geöffnet', fmtM(a.clearance_open));
      add('Durchfahrtsbreite', a.width ? fmtM(a.width) : null);
      if (a.category) add('Bauart', { fixed: 'fest', opening: 'beweglich', lifting: 'Hubbrücke', bascule: 'Klappbrücke', swing: 'Drehbrücke', draw: 'Zugbrücke' }[a.category] || a.category);
      break;
    case 'canoe':
      add('Einstieg', yesNo(a.put_in)); add('Ausstieg', yesNo(a.egress)); add('Umtragen', yesNo(a.portage)); break;
    case 'toilets':
      add('Gebühr', yesNo(x.fee)); add('Rollstuhlgerecht', yesNo(a.wheelchair)); add('Wickeltisch', yesNo(a.changing_table)); add('Öffnungszeiten', x.opening_hours); break;
    case 'water':
      add('Art', SUB[a.sub]); add('Trinkwasser', yesNo(a.drinkable)); add('Nur saisonal', yesNo(a.seasonal)); add('Gebühr', yesNo(x.fee)); break;
    case 'food':
      add('Art', SUB[a.sub]); add('Küche', a.cuisine ? a.cuisine.replace(/_/g, ' ').replace(/;/g, ', ') : null); add('Öffnungszeiten', x.opening_hours); break;
    case 'rest':
      add('Art', SUB[a.sub]); add('Gebühr', yesNo(x.fee)); break;
    case 'parking':
      add('Gebühr', yesNo(x.fee)); add('Stellplätze', a.capacity ? String(a.capacity) : null); add('Für Anhänger', yesNo(a.trailer));
      if (a.maxstay) add('Höchstparkdauer', a.maxstay); break;
    case 'rental':
      add('Öffnungszeiten', x.opening_hours); add('Gebühr', yesNo(x.fee)); break;
    default:
      add('Öffnungszeiten', x.opening_hours);
  }
  if (x.operator) add('Betreiber', x.operator);
  return out;
}

const NOTES = {
  weir: ['alert', 'Wehre können lebensgefährlich sein: nicht überfahren und Abstand halten. Ob und wo umgetragen werden kann, vor Ort prüfen.'],
  bridge: ['info', 'Durchfahrtshöhen beziehen sich auf einen Bezugswasserstand. Die tatsächliche Höhe hängt vom aktuellen Pegel ab – bei Hochwasser ist sie geringer.'],
  lock: ['info', 'Betriebszeiten, Sperrungen und Funkkanäle bitte vor der Fahrt bei der Wasserstraßen- und Schifffahrtsverwaltung prüfen.'],
};

export function renderExtraDetail(x, { close, user }) {
  const k = KINDS[x.kind];
  const dist = user ? formatDistance(haversine(user.lat, user.lon, x.lat, x.lon)) : null;
  const head = h('header', { class: 'detail-head' },
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Schließen', title: 'Schließen', html: icon('close', 22), onclick: close }),
    h('div', { class: 'detail-title' },
      h('span', { class: 'badge', style: `background:${kindColor(x.kind)}`, html: glyph(x.kind, 16) }, h('span', { text: k.label })),
      h('h2', { id: 'detail-name', text: extraTitle(x) }),
      extraShort(x) ? h('p', { class: 'detail-sub', text: extraShort(x) }) : null,
      dist ? h('p', { class: 'detail-sub', text: `${dist} Luftlinie von deinem Standort` }) : null),
    h('span', { class: 'detail-spacer' }));

  const body = h('div', { class: 'detail-body' });
  const note = NOTES[x.kind];
  body.append(note ? h('div', { class: `note ${note[0] === 'alert' ? 'note-warn' : 'note-info'}`, html: icon(note[0], 18) }, h('span', { text: note[1] }))
    : h('div', { class: 'note note-warn', html: icon('alert', 18) }, h('span', { text: 'Aus OpenStreetMap, nicht vor Ort geprüft.' })));

  body.append(h('section', { class: 'block' }, h('h3', { text: 'Angaben' }),
    h('dl', { class: 'facts' }, facts(x).map(f => [h('dt', { text: f.label }), h('dd', { class: f.value ? '' : 'unknown', text: f.value || UNKNOWN })]))));

  const web = safeHttpUrl(x.website), tel = safeTel(x.phone);
  if (web || tel) {
    body.append(h('section', { class: 'block' }, h('h3', { text: 'Kontakt' }), h('div', { class: 'contacts' },
      web ? h('a', { class: 'contact', href: web, target: '_blank', rel: 'noopener noreferrer', html: icon('globe', 18) }, h('span', { text: web.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') })) : null,
      tel ? h('a', { class: 'contact', href: 'tel:' + tel, html: icon('phone', 18) }, h('span', { text: x.phone })) : null)));
  }

  body.append(h('section', { class: 'block' }, h('h3', { text: 'Lage' }),
    h('p', { class: 'coords', text: `${x.lat.toFixed(5)}, ${x.lon.toFixed(5)}` }),
    h('div', { class: 'btn-row' },
      h('a', { class: 'btn btn-primary', href: navUrl(x), target: '_blank', rel: 'noopener noreferrer', html: icon('navigate', 18) + '<span>Navigation starten</span>' }))));

  const [type, id] = x.id.split('/');
  body.append(h('footer', { class: 'source' }, h('p', {}, 'Quelle: ',
    h('a', { href: `https://www.openstreetmap.org/${type}/${id}`, target: '_blank', rel: 'noopener noreferrer', text: `OpenStreetMap ${x.id}` }),
    x.kind === 'bridge' || x.kind === 'lock' ? ' (Seezeichen-Angaben aus OpenSeaMap)' : '', ' · © OpenStreetMap-Mitwirkende, ODbL')));
  return [head, body];
}

/** Abschnitt „In der Nähe“ für die Detailansicht eines Standorts. */
export function nearbySection(listPromise, lat, lon, { onSelect, exclude }) {
  const box = h('div', { class: 'nearby-list', 'aria-busy': 'true' }, h('p', { class: 'muted small', text: 'Wird geladen …' }));
  const section = h('section', { class: 'block' }, h('h3', { text: `In der Nähe (bis ${CONFIG.NEARBY_EXTRAS_M} m)` }), box);
  listPromise.then((list) => {
    box.removeAttribute('aria-busy');
    const near = nearby(list, lat, lon, CONFIG.NEARBY_EXTRAS_M, exclude);
    if (!near.length) { box.replaceChildren(h('p', { class: 'unknown', text: 'Keine Schleusen, Toiletten, Parkplätze o. Ä. in OpenStreetMap eingetragen.' })); return; }
    const shown = near.slice(0, CONFIG.NEARBY_EXTRAS_MAX);
    box.replaceChildren(h('ul', {}, shown.map(({ x, d }) => h('li', {},
      h('button', { type: 'button', class: 'nearby-item', onclick: () => onSelect(x.id) },
        h('span', { class: 'nearby-ico', style: `background:${kindColor(x.kind)}`, html: glyph(x.kind, 15) }),
        h('span', { class: 'nearby-text' }, h('span', { class: 'nearby-name', text: extraTitle(x) }),
          h('span', { class: 'nearby-sub', text: [x.name ? KINDS[x.kind].label : '', extraShort(x)].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' · ') })),
        h('span', { class: 'nearby-dist', text: formatDistance(d) }))))),
      ...(near.length > shown.length ? [h('p', { class: 'muted small', text: `… und ${near.length - shown.length} weitere.` })] : []));   // replaceChildren macht aus null den Text „null“
  }, () => { box.removeAttribute('aria-busy'); box.replaceChildren(h('p', { class: 'unknown', text: 'Konnte nicht geladen werden.' })); });
  return section;
}

// Detailansicht eines Standorts (Seitenpanel am Desktop, Bottom Sheet am Smartphone).
import { h } from './dom.js';
import { icon, glyphSvg } from './icons.js';
import {
  TYPES, UNKNOWN, displayName, subtitle, describeFacts, describePrices, formatDate, navUrl, osmNavUrl,
  osmUrl, safeHttpUrl, safeTel, formatDistance, haversine,
} from './model.js';
import { favorites } from './favorites.js';
import { CONFIG } from './config.js';

/**
 * actions = { close, share, report, addPhoto, reportPrice, onFavorite }
 */
export function renderDetail(p, { user, actions, weather }) {
  const isFav = favorites.has(p.id);
  const sub = subtitle(p);
  const dist = user ? haversine(user.lat, user.lon, p.lat, p.lon) : null;

  const head = h('header', { class: 'detail-head' },
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Zurück zur Liste', title: 'Schließen', html: icon('close', 22), onclick: actions.close }),
    h('div', { class: 'detail-title' },
      h('span', { class: `badge badge-${p.type}`, html: glyphSvg(p.type, 18) }, h('span', { text: TYPES[p.type].label })),
      h('h2', { id: 'detail-name', text: displayName(p) }),
      sub ? h('p', { class: 'detail-sub', text: sub }) : null,
      dist !== null ? h('p', { class: 'detail-sub', text: `${formatDistance(dist)} Luftlinie von deinem Standort` }) : null),
    h('button', { type: 'button', class: 'icon-btn fav' + (isFav ? ' is-on' : ''), 'aria-pressed': String(isFav),
      'aria-label': isFav ? 'Aus Favoriten entfernen' : 'Als Favorit speichern', title: isFav ? 'Aus Favoriten entfernen' : 'Favorit speichern',
      html: icon('star', 22, isFav), onclick: actions.onFavorite }));

  const body = h('div', { class: 'detail-body' });

  // Fotos
  if (p.photos.length) {
    body.append(h('div', { class: 'photos' }, p.photos.map(ph => h('figure', {},
      h('img', { src: ph.url, alt: ph.alt || `Foto: ${displayName(p)}`, loading: 'lazy', decoding: 'async' }),
      ph.credit ? h('figcaption', { text: `Foto: ${ph.credit}` }) : null))));
  }

  // Herkunfts-Hinweis
  body.append(p.source === 'community'
    ? h('div', { class: 'note note-info', html: icon('info', 18) }, h('span', { text: 'Von der Community gemeldet und geprüft. Bitte trotzdem vor Ort auf Hinweise achten.' }))
    : h('div', { class: 'note note-warn', html: icon('alert', 18) }, h('span', { text: 'Aus OpenStreetMap, nicht vor Ort geprüft. Zugang, Gebühren und Eignung bitte vor der Anfahrt klären.' })));

  if (p.description) body.append(h('p', { class: 'desc', text: p.description }));

  if (weather) body.append(weather);

  // Preise (nur Bootstankstellen)
  if (p.type === 'fuel') {
    const rows = describePrices(p);
    body.append(h('section', { class: 'block' }, h('h3', { text: 'Kraftstoffpreise' }),
      h('div', { class: 'prices' }, rows.map(r => h('div', { class: 'price' + (r.stale ? ' is-stale' : '') },
        h('span', { class: 'price-label', text: r.label }),
        r.price
          ? [h('strong', { text: r.price }), h('span', { class: 'price-date', text: `gemeldet am ${r.observed || 'unbekanntem Datum'}` }),
             r.stale ? h('span', { class: 'price-warn', text: r.age === null ? 'Aktualität unklar' : `Älter als ${CONFIG.PRICE_STALE_DAYS} Tage – möglicherweise nicht mehr aktuell` }) : null]
          : h('span', { class: 'unknown', text: 'Kein Preis gemeldet' })))),
      h('button', { type: 'button', class: 'btn btn-outline small', html: icon('plus', 16) + '<span>Preis melden</span>', onclick: actions.reportPrice })));
  }

  // Fakten
  const facts = describeFacts(p);
  body.append(h('section', { class: 'block' }, h('h3', { text: 'Eigenschaften' }),
    h('dl', { class: 'facts' }, facts.map(f => [
      h('dt', { text: f.label }),
      h('dd', { class: f.value ? '' : 'unknown', text: f.value || UNKNOWN }),
    ]))));

  // Kontakt
  const contacts = [];
  const web = safeHttpUrl(p.website);
  if (web) contacts.push(h('a', { class: 'contact', href: web, target: '_blank', rel: 'noopener noreferrer', html: icon('globe', 18) }, h('span', { text: web.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') })));
  const tel = safeTel(p.phone);
  if (tel) contacts.push(h('a', { class: 'contact', href: 'tel:' + tel, html: icon('phone', 18) }, h('span', { text: p.phone })));
  if (p.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) contacts.push(h('a', { class: 'contact', href: 'mailto:' + p.email, html: icon('external', 18) }, h('span', { text: p.email })));
  body.append(h('section', { class: 'block' }, h('h3', { text: 'Kontakt' }),
    contacts.length ? h('div', { class: 'contacts' }, contacts) : h('p', { class: 'unknown', text: UNKNOWN })));

  // Lage und Navigation
  body.append(h('section', { class: 'block' }, h('h3', { text: 'Lage' }),
    h('p', { class: 'coords', text: `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}` }),
    h('div', { class: 'btn-row' },
      h('a', { class: 'btn btn-primary', href: navUrl(p), target: '_blank', rel: 'noopener noreferrer', html: icon('navigate', 18) + '<span>Navigation starten</span>' }),
      h('a', { class: 'btn btn-outline', href: osmNavUrl(p), target: '_blank', rel: 'noopener noreferrer', text: 'OpenStreetMap-Route' })),
    h('p', { class: 'hint', text: 'Die Route führt über Straßen bis zum Standort. Sie ist keine Wasserroute und nicht für die Navigation auf dem Wasser geeignet.' })));

  // Mitmachen
  body.append(h('section', { class: 'block actions' },
    h('button', { type: 'button', class: 'btn btn-outline', html: icon('share', 18) + '<span>Teilen</span>', onclick: actions.share }),
    h('button', { type: 'button', class: 'btn btn-outline', html: icon('camera', 18) + '<span>Foto hinzufügen</span>', onclick: actions.addPhoto }),
    h('button', { type: 'button', class: 'btn btn-outline', html: icon('flag', 18) + '<span>Fehler melden</span>', onclick: actions.report })));

  // Quelle
  const src = osmUrl(p);
  const osmStamp = p.osm?.timestamp ? formatDate(p.osm.timestamp) : null;
  body.append(h('footer', { class: 'source' },
    h('p', {}, 'Letzte Aktualisierung der Daten: ', h('strong', { text: formatDate(p.updated) || UNKNOWN }),
      osmStamp ? ` · OSM-Eintrag zuletzt bearbeitet am ${osmStamp}` : ''),
    src ? h('p', {}, 'Quelle: ', h('a', { href: src, target: '_blank', rel: 'noopener noreferrer', text: `OpenStreetMap ${p.osm.type}/${p.osm.id}` }), ' · © OpenStreetMap-Mitwirkende, ODbL') : h('p', { text: 'Quelle: WaterMap-Community' }),
    p.community_fields.length ? h('p', { text: 'Teile dieser Angaben wurden von der Community ergänzt.' }) : null));

  return [head, body];
}

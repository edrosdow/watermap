// Detailansicht eines Standorts (Seitenpanel am Desktop, Bottom Sheet am Smartphone).
import { h } from './dom.js';
import { icon, glyphSvg } from './icons.js';
import {
  TYPES, UNKNOWN, displayName, subtitle, describeFacts, describePrices, formatDate, navUrl,
  osmUrl, safeHttpUrl, safeTel, formatDistance, haversine,
} from './model.js';
import { favorites } from './favorites.js';
import { CONFIG } from './config.js';
import { photoCarousel } from './photos.js';

/**
 * actions = { close, share, report, addPhoto, reportPhoto, reportPrice, onFavorite }
 */
/** Tabelle der Eigenschaften; Zeilen mit `web` zeigen die wörtlichen Website-Angaben (markiert).
 *  Unbekannte Zeilen sind eingeklappt („N weitere unbekannt“). */
export function factList(rows) {
  const isKnown = f => Boolean(f.value || (f.web || []).length);
  const unknown = rows.filter(f => !isKnown(f)).length;
  const dl = h('dl', { class: 'facts' }, rows.map((f) => {
    const web = f.web || [];
    const known = isKnown(f);
    const hide = known ? null : 'is-unknown';
    return [
      h('dt', { class: hide, text: f.label }),
      h('dd', { class: known ? (web.length ? 'from-web' : null) : 'unknown is-unknown' },
        f.value && !web.length ? f.value : null,
        !known ? UNKNOWN : null,
        f.value && f.web && !web.length ? webMark() : null,                 // aus der Website abgeleitet („Ja“)
        web.map(w => h('span', { class: 'web-line', title: w.quote ? `„${w.quote}“` : null }, w.value, webMark()))),
    ];
  }));
  const wrap = h('div', { class: 'facts-list' }, unknown === rows.length ? h('p', { class: 'unknown facts-none', text: 'Noch keine Angaben bekannt.' }) : null, dl);
  if (unknown) {
    const label = (open) => open ? 'Unbekannte ausblenden' : unknown === rows.length ? `Alle ${unknown} anzeigen` : `${unknown} weitere unbekannt`;
    const btn = h('button', { type: 'button', class: 'facts-more', 'aria-expanded': 'false', text: label(false) });
    btn.onclick = () => {
      const open = !wrap.classList.contains('show-all');
      wrap.classList.toggle('show-all', open);
      btn.setAttribute('aria-expanded', String(open));
      btn.textContent = label(open);
    };
    wrap.append(btn);
  }
  return wrap;
}

function webMark() {
  return h('span', { class: 'web-mark', html: icon('globe', 13), title: 'laut Website des Hafens', 'aria-label': '(laut Website)', role: 'img' });
}

export function renderDetail(p, { user, actions, weather, nearby, enrichFacts }) {
  const isFav = favorites.has(p.id);
  const sub = subtitle(p);
  const dist = user ? haversine(user.lat, user.lon, p.lat, p.lon) : null;

  const head = h('header', { class: 'detail-head' },
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Zurück zur Liste', title: 'Schließen', html: icon('close', 22), onclick: actions.close }),
    h('div', { class: 'detail-title' },
      h('span', { class: `badge badge-${p.type}`, html: glyphSvg(p.type, 18) }, h('span', { text: TYPES[p.type].label })),
      h('h2', { id: 'detail-name', text: displayName(p) }),
      sub || dist !== null ? h('p', { class: 'detail-sub', text: [sub, dist !== null ? formatDistance(dist) : null].filter(Boolean).join(' · '),
        title: dist !== null ? 'Luftlinie von deinem Standort' : null }) : null,
      trustLine(p)),
    h('button', { type: 'button', class: 'icon-btn fav' + (isFav ? ' is-on' : ''), 'aria-pressed': String(isFav),
      'aria-label': isFav ? 'Aus Favoriten entfernen' : 'Als Favorit speichern', title: isFav ? 'Aus Favoriten entfernen' : 'Favorit speichern',
      html: icon('star', 22, isFav), onclick: actions.onFavorite }));

  const body = h('div', { class: 'detail-body' });

  // Aktionsleiste
  body.append(h('div', { class: 'action-bar' },
    h('a', { class: 'act act-primary', href: navUrl(p), target: '_blank', rel: 'noopener noreferrer', title: 'Route über Straßen bis zum Standort (keine Wasserroute)' },
      h('span', { class: 'act-ico', html: icon('navigate', 20) }), h('span', { text: 'Route' })),
    actionButton('share', 'Teilen', 'Link teilen', actions.share),
    actionButton('camera', 'Foto', 'Foto hinzufügen', actions.addPhoto),
    actionButton('flag', 'Melden', 'Fehler melden', actions.report)));

  // Fotos
  if (p.photos.length) body.append(photoCarousel(p.photos, { name: displayName(p), onReport: actions.reportPhoto }));

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

  // Fakten (Hafeninfos von der Website füllen die Tabelle nach, sobald sie geladen sind)
  const facts = describeFacts(p);
  const factsBlock = h('section', { class: 'block facts-block' }, h('h3', { text: 'Eigenschaften' }), factList(facts));
  body.append(factsBlock);
  if (enrichFacts) enrichFacts(factsBlock, facts, factList);

  if (nearby) body.append(nearby);

  // Kontakt
  const contacts = [];
  const web = safeHttpUrl(p.website);
  if (web) contacts.push(h('a', { class: 'contact', href: web, target: '_blank', rel: 'noopener noreferrer', title: web.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''), html: icon('globe', 18) }, h('span', { text: 'Website' })));
  const tel = safeTel(p.phone);
  if (tel) contacts.push(h('a', { class: 'contact', href: 'tel:' + tel, title: p.phone, html: icon('phone', 18) }, h('span', { text: 'Anrufen' })));
  if (p.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) contacts.push(h('a', { class: 'contact', href: 'mailto:' + p.email, title: p.email, html: icon('external', 18) }, h('span', { text: 'E-Mail' })));
  if (contacts.length) body.append(h('section', { class: 'block' }, h('h3', { text: 'Kontakt' }), h('div', { class: 'contacts contact-chips' }, contacts)));

  // Lage
  const coords = `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;
  const copy = h('button', { type: 'button', class: 'btn btn-outline small', text: 'Kopieren' });
  copy.onclick = () => navigator.clipboard?.writeText(coords).then(() => { copy.textContent = 'Kopiert'; setTimeout(() => { copy.textContent = 'Kopieren'; }, 1800); }, () => {});
  body.append(h('div', { class: 'coords-row' }, h('span', { class: 'coords', html: icon('pin', 16) }, h('span', { text: coords })), navigator.clipboard ? copy : null));

  // Quelle (eine Zeile)
  const src = osmUrl(p);
  const stand = formatDate(p.updated);
  body.append(h('footer', { class: 'source' },
    'Quelle: ', src ? h('a', { href: src, target: '_blank', rel: 'noopener noreferrer', text: '© OpenStreetMap', title: `OpenStreetMap ${p.osm.type}/${p.osm.id} · ODbL` }) : 'WaterMap-Community',
    p.community_fields.length ? ' + Community' : '', stand ? ` · Stand ${stand}` : ''));

  return [head, body];
}

function actionButton(name, label, title, onclick) {
  return h('button', { type: 'button', class: 'act', title, onclick }, h('span', { class: 'act-ico', html: icon(name, 20) }), h('span', { text: label }));
}

/** Kleine Herkunftszeile unter dem Namen; Antippen zeigt den Hinweis. */
function trustLine(p) {
  const community = p.source === 'community';
  const tip = h('span', { class: 'trust-tip', hidden: true, text: community
    ? 'Von der Community gemeldet und geprüft. Bitte vor Ort auf Hinweise achten.'
    : 'Nicht vor Ort geprüft. Zugang, Gebühren und Eignung vor der Anfahrt klären.' });
  const btn = h('button', { type: 'button', class: 'trust', 'aria-expanded': 'false', html: icon('info', 14) },
    h('span', { text: community ? 'WaterMap-Community · geprüft' : 'OpenStreetMap · ungeprüft' }));
  btn.onclick = () => { tip.hidden = !tip.hidden; btn.setAttribute('aria-expanded', String(!tip.hidden)); };
  return h('div', { class: 'trust-wrap' }, btn, tip);
}

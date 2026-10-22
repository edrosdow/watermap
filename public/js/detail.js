// Detailansicht eines Standorts (Seitenpanel am Desktop, Bottom Sheet am Smartphone).
import { h } from './dom.js';
import { icon, glyphSvg } from './icons.js';
import {
  TYPES, UNKNOWN, FILTERS, displayName, subtitle, describeFacts, describePrices, formatDate, navUrl,
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

/** Bis zu `max` Merkmal-Etiketten aus den Filtern (nur bestätigte Angaben), z. B. „Kostenlos“, „Öffentlich“. */
export function placeTags(p, max = 3) {
  return (FILTERS[p.type] || []).filter(d => d.test(p)).slice(0, max).map(d => ({ text: d.label, good: d.id === 'free' }));
}

export function tagRow(tags) {
  return tags.length ? h('div', { class: 'dtags' }, tags.map(t => h('span', { class: 'dtag' + (t.good ? ' is-good' : '') + (t.cls ? ' ' + t.cls : ''), text: t.text }))) : null;
}

/** „Route“ – Straßen-Navigation bis zum Standort (keine Wasserroute). */
export function routeLink(p, cls = 'dbtn dbtn-primary') {
  return h('a', { class: cls, href: navUrl(p), target: '_blank', rel: 'noopener noreferrer', title: 'Route über Straßen bis zum Standort (keine Wasserroute)' },
    h('span', { html: icon('navigate', 18) }), h('span', { text: 'Route' }));
}

export function renderDetail(p, { user, actions, weather, nearby, enrichFacts, pegel, vorOrt }) {
  const isFav = favorites.has(p.id);
  const dist = user ? haversine(user.lat, user.lon, p.lat, p.lon) : null;
  const kicker = [TYPES[p.type].label, p.water?.name && !p.water.approx ? p.water.name : null].filter(Boolean).join(' · ');

  const head = h('header', { class: 'detail-head dh' },
    h('div', { class: 'detail-title' },
      h('p', { class: `dh-kicker k-${p.type}`, text: kicker }),
      h('h2', { id: 'detail-name', text: displayName(p) }),
      h('div', { class: 'dh-meta' }, trustLine(p),
        dist !== null ? h('span', { title: 'Luftlinie von deinem Standort', text: `· ${formatDistance(dist)} entfernt` }) : null)),
    h('button', { type: 'button', class: 'dh-close', 'aria-label': 'Details schließen', title: 'Schließen', html: icon('close', 22), onclick: actions.close }));

  const body = h('div', { class: 'detail-body' });
  if (vorOrt?.zeile) body.append(vorOrt.zeile);   // wichtigste Lagemeldung („Heute vor Ort“)
  const sub = subtitle(p);
  if (sub && sub !== p.water?.name) body.append(h('p', { class: 'detail-sub', text: sub }));
  const tags = tagRow(placeTags(p, 4));
  if (tags) body.append(tags);

  // Route · Merken · Teilen
  body.append(h('div', { class: 'dbtns' },
    routeLink(p),
    h('button', { type: 'button', class: 'dbtn fav', 'aria-pressed': String(isFav), title: isFav ? 'Aus Favoriten entfernen' : 'Als Favorit speichern', onclick: actions.onFavorite },
      h('span', { html: icon('star', 18, isFav) }), h('span', { text: isFav ? 'Gemerkt' : 'Merken' })),
    h('button', { type: 'button', class: 'dbtn', title: 'Link teilen', onclick: actions.share }, h('span', { html: icon('share', 18) }), h('span', { text: 'Teilen' }))));

  // Pegel am selben Gewässer (wird nachgeladen; ohne Pegel bleibt der Platz leer)
  if (pegel) {
    const slot = h('div', { class: 'pegel-slot' });
    body.append(slot);
    pegel.then(box => { if (box) slot.replaceWith(box); else slot.remove(); }, () => slot.remove());
  }

  // „Heute vor Ort“ direkt unter Titel und Knöpfen, vor Fotos und Wetter
  if (vorOrt?.section) body.append(vorOrt.section);

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

  // Ganz unten, für genau diesen Standort
  body.append(h('div', { class: 'detail-links' },
    h('button', { type: 'button', onclick: actions.addPhoto, text: 'Foto hinzufügen' }),
    h('button', { type: 'button', onclick: actions.report, text: 'Fehler melden' })));

  return [head, body];
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

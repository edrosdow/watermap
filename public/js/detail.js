// Detailansicht eines Standorts im Sheet-Rahmen (Designumbau 3b, 7.72.1): Handy von unten (Stufe klein = Kopf, Aktionen, „Details“),
// Desktop Panel rechts. Kopf (Titel links, ×) kommt vom Rahmen; renderDetail liefert die Angaben dafür und den Inhalt.
import { h } from './dom.js';
import { aktionen, zeile, gruppe } from './bausteine.js';
import { icon } from './icons.js';
import { TYPES, UNKNOWN, FILTERS, displayName, describeFacts, describePrices, bootPunkte, formatDate, navUrl, osmUrl, safeHttpUrl, safeTel, formatDistance, haversine } from './model.js';
import { favorites } from './favorites.js';
import { CONFIG } from './config.js';
import { photoCarousel } from './photos.js';

/**
 * actions = { close, share, report, addPhoto, reportPhoto, onFavorite, ergaenzen }
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

/** Kopf-Angaben für den Sheet-Rahmen: Name, „Slipanlage · Weser · 4,3 km“. */
export function detailKopf(p, user) {
  const dist = user ? haversine(user.lat, user.lon, p.lat, p.lon) : null;
  const ort = p.locality ? (p.locality_kind === 'nearest' ? `bei ${p.locality}` : p.locality) : null;   // 8.0.5: Ort im Kopf statt eigener Zeile
  return { titel: displayName(p), titelId: 'detail-name', unter: [TYPES[p.type].label, p.water?.name || null, ort, dist !== null ? formatDistance(dist) : null].filter(Boolean).join(' · ') };
}

/** Rückgabe: [kopf-Angaben, Inhalt]. actions.details(): Stufe „groß“ (Knopf „Details“, nur in der Stufe „klein“ sichtbar). */
export function renderDetail(p, { user, actions, weather, nearby, enrichFacts, pegel, vorOrt }) {
  const isFav = favorites.has(p.id);

  const body = h('div', { class: 'detail-body' });
  // 8.0.5: Ort steht im Kopf, Herkunft („OpenStreetMap · ungeprüft“) in der Quellenzeile ganz unten
  if (vorOrt?.zeile) body.append(vorOrt.zeile);   // wichtigste Lagemeldung („Heute vor Ort“)
  const slip = p.type === 'slip';
  const tags = tagRow(placeTags(p, 4));
  if (tags && !slip) body.append(tags);   // Slipanlagen: Etiketten erst nach den Knöpfen

  // Aktionsleiste (Bausteine): Route (primär) · Merken · Teilen
  const leiste = aktionen([
    { icon: 'navigate', text: 'Route', primaer: true, href: navUrl(p) },
    { icon: 'star', text: isFav ? 'Gemerkt' : 'Merken', gemerkt: isFav, onclick: actions.onFavorite },
    { icon: 'share', text: 'Teilen', onclick: actions.share },
  ]);
  leiste.classList.add('dbtns');
  const route = leiste.querySelector('a');
  Object.assign(route, { target: '_blank', rel: 'noopener noreferrer', title: 'Route über Straßen bis zum Standort (keine Wasserroute)' });
  const fav = leiste.querySelectorAll('.wm-aktion')[1];
  fav.classList.add('fav'); fav.title = isFav ? 'Aus „Gemerkt“ entfernen' : 'Merken';
  if (isFav) fav.querySelector('span').innerHTML = icon('star', 22, true);
  leiste.querySelectorAll('.wm-aktion')[2].title = 'Link teilen';
  body.append(leiste);
  // Handy, Stufe „klein“: „Details“ öffnet die Stufe „groß“; bis hierher reicht die Stufe „klein“
  body.append(h('button', { type: 'button', class: 'wm-btn is-primaer st-details', onclick: actions.details }, 'Details'), h('span', { class: 'st-klein-ende', 'aria-hidden': 'true' }));
  if (tags && slip) body.append(tags);

  // Pegel am selben Gewässer (wird nachgeladen; ohne Pegel bleibt der Platz leer)
  const pegelTeil = () => {
    if (!pegel) return;
    const slot = h('div', { class: 'pegel-slot' });
    body.append(slot);
    pegel.then(box => { if (box) slot.replaceWith(box); else slot.remove(); }, () => slot.remove());
  };

  // Fotos – „Foto hinzufügen“ direkt dabei; ohne Fotos eine Einladung an derselben Stelle
  const fotenTeil = () => {
    if (p.photos.length) {
      const fotos = photoCarousel(p.photos, { name: displayName(p), onReport: actions.reportPhoto });
      fotos.append(h('button', { type: 'button', class: 'ph-add', onclick: actions.addPhoto }, h('span', { html: icon('camera', 18), 'aria-hidden': 'true' }), h('span', { text: 'Foto hinzufügen' })));
      body.append(fotos);
    } else {
      // 8.0.5: schlanke Ortszeile statt großem gestricheltem Kasten
      const z = zeile({ ico: 'camera', titel: 'Erstes Foto hinzufügen', unter: 'Zeig anderen, wie es hier aussieht', onClick: actions.addPhoto, label: 'Foto hinzufügen' });
      z.classList.add('ph-leer-btn');
      const g = gruppe([z]); g.classList.add('ph-leer'); g.setAttribute('aria-label', 'Fotos'); g.setAttribute('role', 'group');
      body.append(g);
    }
  };

  if (slip) {
    // Slipanlage: Titel → Knöpfe → Etiketten → Fotos → Heute vor Ort → (Wetterwarnung) → Pegel → Wichtig für dein Boot → Wetter-Zeile → Rest
    fotenTeil();
    if (vorOrt?.section) body.append(vorOrt.section);
    const wxOben = h('span', { hidden: true });   // Platz für die Wetter-Zeile, wenn eine amtliche Warnung vorliegt
    body.append(wxOben);
    pegelTeil();
    body.append(bootBox(p, actions));
    if (weather?.zeile) {
      body.append(weather.zeile);
      weather.warnung.then((warnung) => { if (warnung) wxOben.replaceWith(weather.zeile); });
    }
  } else {
    pegelTeil();
    // „Heute vor Ort“ direkt unter Titel und Knöpfen, vor Fotos und Wetter
    if (vorOrt?.section) body.append(vorOrt.section);
    fotenTeil();
  }

  if (p.description) body.append(h('p', { class: 'desc', text: p.description }));

  if (weather && !slip) body.append(weather);

  // Preise (nur Bootstankstellen)
  if (p.type === 'fuel') {
    const rows = describePrices(p);
    body.append(h('section', { class: 'block' }, h('h3', { text: 'Kraftstoffpreise' }),
      h('div', { class: 'prices' }, rows.map(r => h('div', { class: 'price' + (r.stale ? ' is-stale' : '') },
        h('span', { class: 'price-label', text: r.label }),
        r.price
          ? [h('strong', { text: r.price }), h('span', { class: 'price-date', text: `gemeldet am ${r.observed || 'unbekanntem Datum'}` }),
             r.stale ? h('span', { class: 'price-warn', text: r.age === null ? 'Aktualität unklar' : `Älter als ${CONFIG.PRICE_STALE_DAYS} Tage – möglicherweise nicht mehr aktuell` }) : null]
          : h('span', { class: 'unknown', text: 'Kein Preis gemeldet' }))))));
  }

  // Fakten (Hafeninfos von der Website füllen die Tabelle nach, sobald sie geladen sind) – bei Slipanlagen steht alles in „Wichtig für dein Boot“
  if (!slip) {
    const facts = describeFacts(p);
    const factsBlock = h('section', { class: 'block facts-block' }, h('h3', { text: 'Eigenschaften' }), factList(facts));
    body.append(factsBlock);
    if (enrichFacts) enrichFacts(factsBlock, facts, factList);
  }

  if (nearby) body.append(nearby);

  // Kontakt
  const contacts = [];
  const web = safeHttpUrl(p.website);
  if (web) contacts.push(h('a', { class: 'contact', href: web, target: '_blank', rel: 'noopener noreferrer', title: web.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''), html: icon('globe', 18) }, h('span', { text: 'Website' })));
  const tel = safeTel(p.phone);
  if (tel) contacts.push(h('a', { class: 'contact', href: 'tel:' + tel, title: p.phone, html: icon('phone', 18) }, h('span', { text: 'Anrufen' })));
  if (p.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) contacts.push(h('a', { class: 'contact', href: 'mailto:' + p.email, title: p.email, html: icon('external', 18) }, h('span', { text: 'E-Mail' })));
  if (contacts.length) body.append(h('section', { class: 'block' }, h('h3', { text: 'Kontakt' }), h('div', { class: 'contacts contact-chips' }, contacts)));

  // Ende (8.0.5): eine kleine graue Fußzeile – Koordinaten mit „Kopieren“, Quelle mit Herkunft und Hinweis, „Fehler melden“
  const coords = `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;
  const copy = h('button', { type: 'button', class: 'st-fuss-link', text: 'Kopieren', 'aria-label': `Koordinaten ${coords} kopieren` });
  copy.onclick = () => navigator.clipboard?.writeText(coords).then(() => { copy.textContent = 'Kopiert'; setTimeout(() => { copy.textContent = 'Kopieren'; }, 1800); }, () => {});
  const src = osmUrl(p);
  const stand = formatDate(p.updated);
  const community = p.source === 'community';
  body.append(h('footer', { class: 'st-fuss' },
    h('p', { class: 'coords-row' }, h('span', { class: 'coords', text: coords }), navigator.clipboard ? [' · ', copy] : null),
    h('p', { class: 'source' },
      'Quelle: ', src ? h('a', { href: src, target: '_blank', rel: 'noopener noreferrer', text: '© OpenStreetMap', title: `OpenStreetMap ${p.osm.type}/${p.osm.id} · ODbL` }) : 'WaterMap-Community',
      p.community_fields.length ? ' + Community' : '', stand ? ` · Stand ${stand}` : '',
      community ? ' · geprüft. ' : ' · nicht vor Ort geprüft – Zugang, Gebühren und Eignung vor der Anfahrt klären. ',
      h('span', { class: 'detail-links' }, h('button', { type: 'button', class: 'st-fuss-link', onclick: actions.report, text: 'Fehler melden' })))));

  return [detailKopf(p, user), body];
}

/** „Wichtig für dein Boot“: sechs Angaben mit Ampel (Text, nie nur Farbe), fehlende Angaben zum Ergänzen. */
function bootBox(p, actions) {
  const punkte = bootPunkte(p);
  const fehlen = punkte.filter(x => x.ton === 'unb').length;
  const TON = { ok: 'passt', warn: 'mit Einschränkung', stop: 'nicht möglich', unb: 'unbekannt' };
  const extra = [p.opening_hours ? `Öffnungszeiten: ${p.opening_hours}` : null, p.operator ? `Betreiber: ${p.operator}` : null].filter(Boolean);
  return h('section', { class: 'wb', 'aria-labelledby': 'wb-titel' },
    h('h3', { class: 'wm-abschnitt wb-titel', id: 'wb-titel', text: 'Wichtig für dein Boot' }),
    h('ul', { class: 'wb-liste' }, punkte.map(x => h('li', { class: `wb-p is-${x.ton}` },
      h('i', { 'aria-hidden': 'true' }),
      h('div', {}, h('small', { text: x.titel }), h('strong', { text: x.wert }), h('span', { class: 'sr-only', text: ` (${TON[x.ton]})` }))))),
    extra.length ? h('p', { class: 'wb-extra', text: extra.join(' · ') }) : null,
    h('div', { class: 'wb-fuss' },
      h('span', { text: fehlen ? `${fehlen} ${fehlen === 1 ? 'Angabe fehlt' : 'Angaben fehlen'}` : 'Angaben laut OpenStreetMap' }),
      h('button', { type: 'button', class: 'wb-link', onclick: actions.ergaenzen || actions.report }, fehlen ? 'Weißt du mehr? Ergänzen' : 'Angaben ändern', h('span', { html: icon('chevron', 16), 'aria-hidden': 'true' }))));
}

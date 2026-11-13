// Detailansicht eines Standorts im Sheet-Rahmen (Designumbau 3b, 7.72.1): Handy von unten (Stufe klein = Kopf, Aktionen, „Details“),
// Desktop Panel rechts. Kopf (Titel links, ×) kommt vom Rahmen; renderDetail liefert die Angaben dafür und den Inhalt.
import { h } from './dom.js';
import { aktionen, zeile, gruppe } from './bausteine.js';
import { icon } from './icons.js';
import { TYPES, UNKNOWN, displayName, describeFacts, bootPunkte, hafenPunkte, hafenExtra, formatDate, navUrl, osmUrl, safeHttpUrl, safeTel, formatDistance, haversine } from './model.js';
import { favorites } from './favorites.js';
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
    return h('div', { class: 'af-p' + (known ? '' : ' is-unknown') },   // 8.0.8: Kachel je Angabe
      h('dt', { class: hide, text: f.label }),
      h('dd', { class: known ? (web.length ? 'from-web' : null) : 'unknown is-unknown' },
        f.value && !web.length ? f.value : null,
        !known ? UNKNOWN : null,
        f.value && f.web && !web.length ? webMark() : null,                 // aus der Website abgeleitet („Ja“)
        web.map(w => h('span', { class: 'web-line', title: w.quote ? `„${w.quote}“` : null }, w.value, webMark()))));
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
  // 8.0.8 (Nutzer): keine Etiketten mehr – dieselben Angaben stehen in „Wichtig für dein Boot“ bzw. „Ausstattung“

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
    body.append(punkteBox(bootPunkte(p), [p.opening_hours ? `Öffnungszeiten: ${p.opening_hours}` : null, p.operator ? `Betreiber: ${p.operator}` : null].filter(Boolean), actions));
    if (weather?.zeile) {
      body.append(weather.zeile);
      weather.warnung.then((warnung) => { if (warnung) wxOben.replaceWith(weather.zeile); });
    }
  } else {
    // Hafen, Tankstelle, Zusatzorte (8.0.8): wie beim Slip – Fotos → Heute vor Ort → Pegel → Ausstattung → Wetter-Zeile → Kontakt → Rest
    fotenTeil();
    if (vorOrt?.section) body.append(vorOrt.section);
    pegelTeil();
    // Häfen (8.0.8, Nutzer): „Wichtig für dein Boot“ wie bei Slipanlagen, mit „Ergänzen“; Angaben laut Website darunter.
    // Tankstellen und Zusatzorte: „Ausstattung“ als Kacheln.
    let factsBlock;
    if (p.type === 'marina') {
      factsBlock = punkteBox(hafenPunkte(p), hafenExtra(p), actions);
      factsBlock.classList.add('facts-block');
      const web = h('div', { class: 'facts-list hb-web' });   // Platz für die Website-Angaben (enrichFacts ersetzt ihn)
      factsBlock.querySelector('.wb-fuss').before(web);
      if (enrichFacts) enrichFacts(factsBlock, describeFacts(p), (rows) => webListe(rows));
    } else {
      const facts = describeFacts(p);
      factsBlock = h('section', { class: 'block facts-block af-karte', 'aria-labelledby': 'af-titel' }, h('h3', { id: 'af-titel', text: 'Ausstattung' }), factList(facts));
      if (enrichFacts) enrichFacts(factsBlock, facts, factList);
    }
    body.append(factsBlock);
    if (weather?.zeile) {
      body.append(weather.zeile);
      weather.warnung.then((warnung) => { if (warnung) factsBlock.before(weather.zeile); });   // amtliche Warnung rückt nach oben
    }
  }

  if (p.description) body.append(h('p', { class: 'desc', text: p.description }));

  // Kontakt als Ortszeilen in einer weißen Gruppe (8.0.8)
  const kontakt = [];
  const web = safeHttpUrl(p.website);
  if (web) kontakt.push(Object.assign(zeile({ ico: 'globe', titel: 'Website', unter: web.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''), href: web }), { target: '_blank', rel: 'noopener noreferrer' }));
  const tel = safeTel(p.phone);
  if (tel) kontakt.push(zeile({ ico: 'phone', titel: 'Anrufen', unter: p.phone, href: 'tel:' + tel }));
  if (p.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) kontakt.push(zeile({ ico: 'mail', titel: 'E-Mail', unter: p.email, href: 'mailto:' + p.email }));
  if (kontakt.length) { const g = gruppe(kontakt, { label: 'Kontakt' }); g.classList.add('st-kontakt'); body.append(g); }

  if (nearby) body.append(nearby);

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

/** Nur die Angaben laut Website (Hafeninfos) als kleine Liste unter den Hafen-Punkten. */
function webListe(rows) {
  const web = rows.filter(f => (f.web || []).length);
  if (!web.length) return h('div', { class: 'facts-list hb-web' });
  return h('div', { class: 'facts-list hb-web' }, h('p', { class: 'hb-web-titel', text: 'Laut Website des Hafens' }),
    h('dl', { class: 'facts' }, web.map(f => h('div', { class: 'af-p' }, h('dt', { text: f.label }),
      h('dd', { class: 'from-web' }, f.web.map(w => h('span', { class: 'web-line', title: w.quote ? `„${w.quote}“` : null }, w.value, webMark())))))));
}

/** „Wichtig für dein Boot“ (Slipanlage und Hafen): sechs Angaben mit Ampel (Text, nie nur Farbe), fehlende Angaben zum Ergänzen. */
function punkteBox(punkte, extra, actions) {
  const fehlen = punkte.filter(x => x.ton === 'unb').length;
  const TON = { ok: 'passt', warn: 'mit Einschränkung', stop: 'nicht möglich', unb: 'unbekannt' };
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

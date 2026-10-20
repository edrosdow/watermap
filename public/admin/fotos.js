// Verwaltung: Fotos · Gemeldete Fotos · Slipanlagen · Preise · Hinweise · Veröffentlicht · Verlauf (netlify/functions/fotos.mjs).
const API = '/.netlify/functions/fotos';
const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids.flat(Infinity).filter(k => k !== null && k !== undefined && k !== false));
  return n;
};
const ID = /^(node|way|relation|community|c)\/[A-Za-z0-9_-]{1,80}$/;
const parseStandort = (t) => { const m = String(t).trim().match(/[#&]p=([^&\s]+)/); const id = m ? decodeURIComponent(m[1]) : String(t).trim(); return ID.test(id) ? id : null; };
const when = (iso) => iso ? new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : '';
const placeLink = (id, name) => ID.test(id || '') ? el('a', { href: `../#p=${encodeURIComponent(id)}`, target: '_blank', rel: 'noopener', textContent: name || id }) : el('span', { textContent: name || 'ohne Standort' });

let pw = '';
try { pw = sessionStorage.getItem('wm.fotoPw') || ''; } catch { /* privat */ }
let tab = 'neu';

function say(text, err = false) { const m = $('#msg'); m.textContent = text; m.classList.toggle('err', err); }

async function call(method, query = '', body) {
  const res = await fetch(API + query, { method, headers: { 'x-passwort': pw, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  if (res.status === 401) { try { sessionStorage.removeItem('wm.fotoPw'); } catch { /* egal */ } throw new Error('Passwort falsch.'); }
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.fehler || `Fehler ${res.status}`); }
  return res;
}

/** Bild über die Funktion laden (Einreichungen sind privat, veröffentlichte kommen aus dem Repository). */
function image(query, alt) {
  const img = el('img', { alt: alt || 'Foto', loading: 'lazy' });
  call('GET', query).then(r => r.blob()).then(b => { img.src = URL.createObjectURL(b); })
    .catch(e => img.replaceWith(el('p', { className: 'warn', textContent: `Bild nicht ladbar: ${e.message}` })));
  return img;
}

function showTab(name) {
  tab = name;
  for (const b of document.querySelectorAll('#tabs button')) {
    const on = b.dataset.tab === name;
    b.classList.toggle('is-active', on); b.setAttribute('aria-selected', String(on));
  }
  for (const s of document.querySelectorAll('main > section')) s.hidden = s.id !== `tab-${name}`;
}

function setCount(name, n, hot = false) {
  const c = $(`#n-${name}`);
  c.textContent = String(n); c.classList.toggle('hot', hot && n > 0);
}

/** Nach einer Aktion: Meldung oben zeigen, alles neu laden. */
async function act(button, body, done, confirmText) {
  if (confirmText && !confirm(confirmText)) return;
  button.disabled = true;
  try {
    await call('POST', '', body);
    say(done);
    await loadAll();
  } catch (e) { say(e.message, true); button.disabled = false; }
}

async function loadAll() {
  const all = await Promise.allSettled([
    call('GET').then(r => r.json()), call('GET', '?meldungen=1').then(r => r.json()),
    call('GET', '?veroeffentlicht=1').then(r => r.json()), call('GET', '?verlauf=1').then(r => r.json()),
    call('GET', '?form=slipanlage-melden').then(r => r.json()), call('GET', '?form=tankpreis-melden').then(r => r.json()),
    call('GET', '?form=fehler-melden').then(r => r.json())]);
  const [neu, gemeldet, veroeffentlicht, verlauf, slips, preise, hinweise] = all;
  const failed = all.find(x => x.status === 'rejected');
  if (failed && /Passwort/.test(failed.reason?.message)) throw failed.reason;
  try { sessionStorage.setItem('wm.fotoPw', pw); } catch { /* privat */ }
  $('#login').hidden = true; $('#tabs').hidden = false;
  renderNew(neu.status === 'fulfilled' ? neu.value.fotos : null, neu.reason);
  renderReports(gemeldet.status === 'fulfilled' ? gemeldet.value.meldungen : null, gemeldet.reason);
  renderPublished(veroeffentlicht.status === 'fulfilled' ? veroeffentlicht.value.fotos : null, veroeffentlicht.reason);
  renderLog(verlauf.status === 'fulfilled' ? verlauf.value.verlauf : null, verlauf.reason);
  renderSlips(slips.status === 'fulfilled' ? slips.value.slips : null, slips.reason);
  renderPrices(preise.status === 'fulfilled' ? preise.value.preise : null, preise.reason);
  renderHints(hinweise.status === 'fulfilled' ? hinweise.value.hinweise : null, hinweise.reason);
  showTab(tab);
}

const failNote = (err) => el('p', { className: 'status err', textContent: `Nicht ladbar: ${err?.message || 'unbekannter Fehler'}` });

// ---------------------------------------------------------------- Eingereicht
function renderNew(list, err) {
  const box = $('#list');
  box.replaceChildren();
  setCount('neu', list ? list.length : 0, true);
  if (!list) { box.append(failNote(err)); return; }
  if (!list.length) { box.append(el('p', { className: 'empty', textContent: 'Keine neuen Fotos.' })); return; }
  for (const f of list) box.append(submissionCard(f));
}

function submissionCard(f) {
  const hasId = ID.test(f.standort_id);
  const where = hasId ? null : el('input', { type: 'text', placeholder: 'Link zum Standort aus der App, z. B. …#p=node/632876845', className: 'where' });
  const yes = el('button', { className: 'ok', type: 'button', textContent: 'Freigeben' });
  const no = el('button', { type: 'button', textContent: 'Ablehnen' });
  const valid = () => f.hat_foto && f.rechte && (hasId || Boolean(parseStandort(where.value)));
  yes.disabled = !valid();
  where?.addEventListener('input', () => { yes.disabled = !valid(); });
  yes.addEventListener('click', () => act(yes, { aktion: 'freigeben', id: f.id, ...(where ? { standort: parseStandort(where.value) } : {}) },
    'Freigegeben – in etwa einer Minute in der App sichtbar.'));
  no.addEventListener('click', () => act(no, { aktion: 'ablehnen', id: f.id }, 'Abgelehnt und gelöscht.', 'Foto wirklich ablehnen? Die Einreichung wird gelöscht.'));
  return el('section', { className: 'card' },
    f.hat_foto ? image(`?bild=${encodeURIComponent(f.id)}`, f.beschreibung) : el('p', { className: 'warn', textContent: 'Kein Foto in der Einreichung.' }),
    el('h2', {}, placeLink(hasId ? f.standort_id : '', f.standort_name || f.standort_id)),
    el('p', { className: 'meta', textContent: `Eingereicht ${when(f.created)}` }),
    el('p', { textContent: f.beschreibung || '(keine Beschreibung)' }),
    f.rechte ? null : el('p', { className: 'warn', textContent: 'Rechte am Foto nicht bestätigt – nicht freigeben.' }),
    hasId ? null : el('p', { className: 'warn', textContent: `Kein Standort aus der Liste gewählt („${f.standort_name || 'ohne Namen'}“). Standort in der App öffnen, Link kopieren und hier einfügen:` }),
    where, el('div', { className: 'actions' }, yes, no));
}

// ---------------------------------------------------------------- Gemeldet
function renderReports(list, err) {
  const box = $('#reports');
  box.replaceChildren();
  setCount('gemeldet', list ? list.length : 0, true);
  if (!list) { box.append(failNote(err)); return; }
  if (!list.length) { box.append(el('p', { className: 'empty', textContent: 'Keine gemeldeten Fotos.' })); return; }
  for (const m of list) {
    const remove = m.veroeffentlicht ? el('button', { className: 'danger', type: 'button', textContent: 'Foto entfernen' }) : null;
    const dismiss = el('button', { type: 'button', textContent: m.veroeffentlicht ? 'Meldung verwerfen' : 'Meldung löschen' });
    remove?.addEventListener('click', () => act(remove, { aktion: 'entfernen', standort_id: m.standort_id, url: m.foto, meldung: m.id },
      'Foto entfernt – in etwa einer Minute aus der App verschwunden.', 'Dieses Foto wirklich aus der App entfernen?'));
    dismiss.addEventListener('click', () => act(dismiss, { aktion: 'meldung_verwerfen', id: m.id }, 'Meldung verworfen.'));
    box.append(el('section', { className: 'card' },
      m.veroeffentlicht ? image(`?datei=${encodeURIComponent(m.foto)}`, 'Gemeldetes Foto') : el('p', { className: 'meta', textContent: `Das Foto (${m.foto}) ist schon nicht mehr veröffentlicht.` }),
      el('h2', {}, placeLink(m.standort_id, m.standort_name || m.standort_id)),
      el('p', { className: 'meta', textContent: `Gemeldet ${when(m.created)}` }),
      el('p', {}, el('strong', { textContent: 'Grund: ' }), m.grund || '(kein Grund angegeben)'),
      el('div', { className: 'actions' }, remove, dismiss)));
  }
}

// ---------------------------------------------------------------- Veröffentlicht
function renderPublished(list, err) {
  const box = $('#published');
  box.replaceChildren();
  setCount('veroeffentlicht', list ? list.length : 0);
  if (!list) { box.append(failNote(err)); return; }
  if (!list.length) { box.append(el('p', { className: 'empty', textContent: 'Noch keine Fotos veröffentlicht.' })); return; }
  for (const f of list) {
    const rm = el('button', { type: 'button', textContent: 'Entfernen' });
    rm.addEventListener('click', () => act(rm, { aktion: 'entfernen', standort_id: f.standort_id, url: f.url },
      'Foto entfernt – in etwa einer Minute aus der App verschwunden.', 'Dieses Foto wirklich aus der App entfernen?'));
    box.append(el('div', { className: 'card pub' }, image(`?datei=${encodeURIComponent(f.url)}`, f.alt),
      el('p', {}, placeLink(f.standort_id)), f.alt ? el('p', { textContent: f.alt }) : null, rm));
  }
}

// ---------------------------------------------------------------- Verlauf
const LABEL = { freigegeben: ['Freigegeben', 'a-freigegeben'], abgelehnt: ['Abgelehnt', 'a-abgelehnt'], entfernt: ['Entfernt', 'a-entfernt'],
  'meldung verworfen': ['Meldung verworfen', 'a-meldung'], erledigt: ['Erledigt', 'a-freigegeben'], verworfen: ['Verworfen', 'a-abgelehnt'] };
const BEREICH = { foto: 'Foto', slip: 'Slipanlage', preis: 'Preis', hinweis: 'Hinweis' };

function renderLog(list, err) {
  const box = $('#log');
  box.replaceChildren();
  if (!list) { box.append(el('li', {}, failNote(err))); return; }
  if (!list.length) { box.append(el('li', { className: 'empty', textContent: 'Noch keine Aktionen.' })); return; }
  for (const e of list) {
    const [label, cls] = LABEL[e.aktion] || [e.aktion, ''];
    const detail = [e.beschreibung ? `„${e.beschreibung}“` : '', e.grund ? `Grund: ${e.grund}` : '', e.foto || ''].filter(Boolean).join(' · ');
    box.append(el('li', {}, el('time', { dateTime: e.zeit, textContent: when(e.zeit) }),
      el('span', {}, el('span', { className: 'tag', textContent: BEREICH[e.bereich || 'foto'] || e.bereich }),
        el('span', { className: `what ${cls}`, textContent: label }), ' – ', placeLink(e.standort_id, e.standort_name || e.standort_id)),
      detail ? el('span', { className: 'detail', textContent: detail }) : null));
  }
}

// ---------------------------------------------------------------- Slipanlagen
const ZUGANG = { oeffentlich: 'Öffentlich', privat: 'Privat / Verein', kunden: 'Nur Kunden / Gäste' };
const JN = { ja: 'Ja', nein: 'Nein' };
const facts = (rows) => el('dl', { className: 'facts' }, rows.filter(([, v]) => v).map(([k, v]) => [el('dt', { textContent: k }), el('dd', {}, v)]));

/** Bekannte Slipanlagen (OSM und Community) für die Dublettenprüfung – einmal laden. */
let known = null;
function knownSlips() {
  known ||= Promise.all([
    fetch('../data/osm/slip.geojson').then(r => r.json()).then(j => j.features.map(f => ({ id: f.id, name: f.properties?.name, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] }))),
    fetch('../data/community/places.json').then(r => r.json()).catch(() => []).then(a => a.filter(p => p.type === 'slip' && p.status === 'approved')),
  ]).then(([a, b]) => [...a, ...b]).catch(() => []);
  return known;
}
const dist = (a, b, c, d) => { const R = 6371000, r = Math.PI / 180, x = (d - b) * r * Math.cos((a + c) / 2 * r), y = (c - a) * r; return Math.sqrt(x * x + y * y) * R; };

function renderSlips(list, err) {
  const box = $('#slips');
  box.replaceChildren();
  setCount('slips', list ? list.length : 0, true);
  if (!list) { box.append(failNote(err)); return; }
  if (!list.length) { box.append(el('p', { className: 'empty', textContent: 'Keine neuen Slipanlagen.' })); return; }
  for (const s of list) {
    const okCoords = Number.isFinite(s.lat) && Number.isFinite(s.lon);
    const near = el('p', { className: 'near', textContent: okCoords ? 'Prüfe Dubletten …' : 'Koordinaten fehlen – nicht freigebbar.' });
    if (okCoords) knownSlips().then((all) => {
      let best = null;
      for (const k of all) { const m = dist(s.lat, s.lon, k.lat, k.lon); if (!best || m < best.m) best = { ...k, m }; }
      if (best && best.m < 300) near.replaceChildren(`Achtung: bekannte Slipanlage ${Math.round(best.m)} m entfernt – `, placeLink(best.id, best.name || 'ohne Namen'));
      else { near.classList.add('ok'); near.textContent = best ? `Keine bekannte Slipanlage im Umkreis von 300 m (nächste: ${(best.m / 1000).toFixed(1)} km).` : 'Dublettenprüfung nicht möglich.'; }
    });
    const yes = el('button', { className: 'ok', type: 'button', textContent: 'Freigeben', disabled: !okCoords });
    const no = el('button', { type: 'button', textContent: 'Ablehnen' });
    yes.addEventListener('click', () => act(yes, { form: 'slipanlage-melden', aktion: 'freigeben', id: s.id }, 'Slipanlage freigegeben – in etwa einer Minute in der Karte.'));
    no.addEventListener('click', () => act(no, { form: 'slipanlage-melden', aktion: 'ablehnen', id: s.id }, 'Slipanlage abgelehnt.', 'Meldung wirklich ablehnen? Sie wird gelöscht.'));
    const mapLink = okCoords ? el('a', { href: `https://www.openstreetmap.org/?mlat=${s.lat}&mlon=${s.lon}#map=17/${s.lat}/${s.lon}`, target: '_blank', rel: 'noopener', textContent: `${s.lat.toFixed(5)}, ${s.lon.toFixed(5)} (Karte)` }) : 'fehlt';
    box.append(el('section', { className: 'card' },
      s.hat_foto ? image(`?form=slipanlage-melden&bild=${encodeURIComponent(s.id)}`, s.name) : null,
      el('h2', { textContent: s.name || 'Ohne Namen' }),
      el('p', { className: 'meta', textContent: `Gemeldet ${when(s.created)}` }),
      facts([['Gewässer', s.gewaesser], ['Lage', mapLink], ['Zugang', ZUGANG[s.zugang]], ['Gebühr', [s.gebuehr === 'kostenlos' ? 'Kostenlos' : s.gebuehr === 'kostenpflichtig' ? 'Kostenpflichtig' : '', s.gebuehr_betrag].filter(Boolean).join(' – ')],
        ['Parkplatz', JN[s.parkplatz]], ['Trailerparkplatz', JN[s.trailerparkplatz]], ['Beschreibung', s.beschreibung],
        ['Rückfragen', s.kontakt ? el('a', { href: `mailto:${s.kontakt}`, textContent: s.kontakt }) : '']]),
      s.dublette ? el('p', { className: 'warn', textContent: 'Der Melder hat bestätigt, dass in der Nähe schon eine Slipanlage ist.' }) : null,
      s.hat_foto && !s.rechte ? el('p', { className: 'warn', textContent: 'Rechte am Foto nicht bestätigt – das Foto wird nicht übernommen.' }) : null,
      near, el('div', { className: 'actions' }, yes, no)));
  }
}

// ---------------------------------------------------------------- Preise
function renderPrices(list, err) {
  const box = $('#preise');
  box.replaceChildren();
  setCount('preise', list ? list.length : 0, true);
  if (!list) { box.append(failNote(err)); return; }
  if (!list.length) { box.append(el('p', { className: 'empty', textContent: 'Keine neuen Preise.' })); return; }
  for (const pr of list) {
    const inList = ID.test(pr.tankstelle_id), plausible = Number.isFinite(pr.preis) && pr.preis >= 0.5 && pr.preis <= 5;
    const yes = el('button', { className: 'ok', type: 'button', textContent: 'Freigeben', disabled: !(inList && plausible) });
    const no = el('button', { type: 'button', textContent: 'Ablehnen' });
    yes.addEventListener('click', () => act(yes, { form: 'tankpreis-melden', aktion: 'freigeben', id: pr.id }, 'Preis freigegeben – in etwa einer Minute in der App.'));
    no.addEventListener('click', () => act(no, { form: 'tankpreis-melden', aktion: 'ablehnen', id: pr.id }, 'Preis abgelehnt.', 'Preismeldung wirklich ablehnen?'));
    box.append(el('section', { className: 'card' },
      el('h2', {}, placeLink(inList ? pr.tankstelle_id : '', pr.tankstelle_name || pr.tankstelle_id)),
      el('p', { className: 'meta', textContent: `Gemeldet ${when(pr.created)}` }),
      facts([['Kraftstoff', pr.kraftstoff === 'benzin' ? 'Benzin' : 'Diesel'], ['Preis', Number.isFinite(pr.preis) ? `${pr.preis.toFixed(3).replace('.', ',')} €/l` : 'ungültig'],
        ['Beobachtet am', pr.datum], ['Kommentar', pr.kommentar]]),
      inList ? null : el('p', { className: 'warn', textContent: 'Tankstelle nicht in der Liste – nicht zuzuordnen.' }),
      plausible ? null : el('p', { className: 'warn', textContent: 'Preis außerhalb 0,50–5,00 €/l – nicht freigebbar.' }),
      pr.hat_beleg ? image(`?form=tankpreis-melden&bild=${encodeURIComponent(pr.id)}`, 'Belegfoto') : null,
      el('div', { className: 'actions' }, yes, no)));
  }
}

// ---------------------------------------------------------------- Hinweise
function renderHints(list, err) {
  const box = $('#hinweise');
  box.replaceChildren();
  setCount('hinweise', list ? list.length : 0, true);
  if (!list) { box.append(failNote(err)); return; }
  if (!list.length) { box.append(el('p', { className: 'empty', textContent: 'Keine offenen Hinweise.' })); return; }
  for (const x of list) {
    const done = el('button', { className: 'ok', type: 'button', textContent: 'Erledigt' });
    const drop = el('button', { type: 'button', textContent: 'Verwerfen' });
    done.addEventListener('click', () => act(done, { form: 'fehler-melden', aktion: 'erledigt', id: x.id }, 'Hinweis als erledigt abgeschlossen.'));
    drop.addEventListener('click', () => act(drop, { form: 'fehler-melden', aktion: 'verwerfen', id: x.id }, 'Hinweis verworfen.', 'Hinweis wirklich verwerfen?'));
    box.append(el('section', { className: 'card' },
      el('h2', {}, placeLink(x.standort_id, x.standort_name || (x.standort_id === '__other' ? 'Allgemeiner Hinweis' : x.standort_id))),
      el('p', { className: 'meta', textContent: `${x.art_text} · gemeldet ${when(x.created)}` }),
      el('p', { textContent: x.details }),
      x.kontakt ? el('p', { className: 'meta' }, 'Rückfragen: ', el('a', { href: `mailto:${x.kontakt}`, textContent: x.kontakt })) : null,
      el('div', { className: 'actions' }, done, drop)));
  }
}

// ---------------------------------------------------------------- Start
for (const b of document.querySelectorAll('#tabs button')) b.addEventListener('click', () => showTab(b.dataset.tab));
$('#login').addEventListener('submit', async (e) => {
  e.preventDefault(); pw = $('#pw').value; say('Lade …');
  try { await loadAll(); say(''); } catch (err) { say(err.message, true); }
});
if (pw) loadAll().then(() => say(''), (err) => { say(err.message, true); });

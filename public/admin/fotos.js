// Foto-Freigabe: listet eingereichte Fotos (netlify/functions/fotos.mjs) und gibt sie per Klick frei.
const API = '/.netlify/functions/fotos';
const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids.filter(k => k !== null && k !== undefined));
  return n;
};

let pw = '';
try { pw = sessionStorage.getItem('wm.fotoPw') || ''; } catch { /* privat */ }

function say(text, err = false) { const m = $('#msg'); m.textContent = text; m.classList.toggle('err', err); }

async function call(method, query = '', body) {
  const res = await fetch(API + query, { method, headers: { 'x-passwort': pw, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  if (res.status === 401) { try { sessionStorage.removeItem('wm.fotoPw'); } catch { /* egal */ } throw new Error('Passwort falsch.'); }
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.fehler || `Fehler ${res.status}`); }
  return res;
}

async function load() {
  say('Lade …');
  const list = $('#list');
  list.replaceChildren();
  try {
    const { fotos } = await (await call('GET')).json();
    try { sessionStorage.setItem('wm.fotoPw', pw); } catch { /* privat */ }
    say(fotos.length ? `${fotos.length} Foto(s) warten auf Freigabe.` : 'Keine Fotos zu prüfen.');
    for (const f of fotos) list.append(card(f));
    loadPublished();
  } catch (e) { say(e.message, true); }
}

// Veröffentlichte Fotos – mit „Entfernen“
async function loadPublished() {
  const box = $('#published'), msg = $('#pub-msg');
  $('#pub-section').hidden = false;
  box.replaceChildren();
  msg.textContent = 'Lade …'; msg.classList.remove('err');
  try {
    const { fotos } = await (await call('GET', '?veroeffentlicht=1')).json();
    msg.textContent = fotos.length ? `${fotos.length} Foto(s) veröffentlicht.` : 'Noch keine Fotos veröffentlicht.';
    for (const f of fotos) box.append(publishedCard(f));
  } catch (e) { msg.textContent = e.message; msg.classList.add('err'); }
}

function publishedCard(f) {
  const img = el('img', { alt: f.alt || 'Veröffentlichtes Foto', loading: 'lazy' });
  const status = el('p', { className: 'status' });
  const rm = el('button', { type: 'button', textContent: 'Entfernen' });
  call('GET', `?datei=${encodeURIComponent(f.url)}`).then(r => r.blob()).then(b => { img.src = URL.createObjectURL(b); })
    .catch(() => { img.replaceWith(el('p', { className: 'warn', textContent: `Bild fehlt: ${f.url}` })); });
  rm.addEventListener('click', async () => {
    if (!confirm('Dieses Foto wirklich aus der App entfernen?')) return;
    rm.disabled = true; status.textContent = 'Wird entfernt …'; status.classList.remove('err');
    try {
      await call('POST', '', { aktion: 'entfernen', standort_id: f.standort_id, url: f.url });
      status.textContent = 'Entfernt – in etwa einer Minute aus der App verschwunden.';
    } catch (e) { status.textContent = e.message; status.classList.add('err'); rm.disabled = false; }
  });
  return el('div', { className: 'pub' }, img,
    el('p', {}, el('a', { href: `../#p=${encodeURIComponent(f.standort_id)}`, target: '_blank', rel: 'noopener', textContent: f.standort_id })),
    f.alt ? el('p', { textContent: f.alt }) : null, rm, status);
}

function card(f) {
  const img = el('img', { alt: f.beschreibung || 'Eingereichtes Foto' });
  const status = el('p', { className: 'status' });
  const yes = el('button', { className: 'ok', type: 'button', textContent: 'Freigeben' });
  const no = el('button', { type: 'button', textContent: 'Ablehnen' });
  const ID = /^(node|way|relation|community)\/[A-Za-z0-9_-]{1,40}$/;
  const parse = (t) => { const m = String(t).trim().match(/[#&]p=([^&\s]+)/); const id = m ? decodeURIComponent(m[1]) : String(t).trim(); return ID.test(id) ? id : null; };
  const hasId = ID.test(f.standort_id);
  // Bei „Anderer Standort“ fehlt die ID: Link zum Standort aus der App einfügen
  const where = hasId ? null : el('input', { type: 'text', placeholder: 'Link zum Standort aus der App, z. B. …#p=node/632876845', className: 'where' });
  const valid = () => f.hat_foto && f.rechte && (hasId || Boolean(parse(where.value)));
  yes.disabled = !valid();
  where?.addEventListener('input', () => { yes.disabled = !valid(); });
  const link = hasId ? el('a', { href: `../#p=${encodeURIComponent(f.standort_id)}`, target: '_blank', rel: 'noopener', textContent: 'in der Karte ansehen' }) : null;
  const node = el('section', { className: 'card' }, img,
    el('h2', { textContent: f.standort_name || f.standort_id || 'Ohne Standort' }),
    el('p', { className: 'meta' }, f.created ? new Date(f.created).toLocaleString('de-DE') + ' · ' : '', link),
    el('p', { textContent: f.beschreibung || '(keine Beschreibung)' }),
    f.rechte ? null : el('p', { className: 'warn', textContent: 'Rechte am Foto nicht bestätigt – nicht freigeben.' }),
    f.hat_foto ? null : el('p', { className: 'warn', textContent: 'Kein Foto in der Einreichung.' }),
    hasId ? null : el('p', { className: 'warn', textContent: `Kein Standort aus der Liste gewählt („${f.standort_name || 'ohne Namen'}“). Standort in der App öffnen, Link kopieren und hier einfügen:` }),
    where,
    el('div', { className: 'actions' }, yes, no), status);
  if (f.hat_foto) {
    call('GET', `?bild=${encodeURIComponent(f.id)}`).then(r => r.blob()).then(b => { img.src = URL.createObjectURL(b); })
      .catch(e => { img.replaceWith(el('p', { className: 'warn', textContent: `Bild nicht ladbar: ${e.message}` })); yes.disabled = true; });
  }
  const act = (aktion) => async () => {
    if (aktion === 'ablehnen' && !confirm('Foto wirklich ablehnen? Die Einreichung wird gelöscht.')) return;
    yes.disabled = no.disabled = true;
    status.textContent = aktion === 'freigeben' ? 'Wird veröffentlicht …' : 'Wird gelöscht …';
    try {
      await call('POST', '', { aktion, id: f.id, ...(aktion === 'freigeben' && where ? { standort: parse(where.value) } : {}) });
      status.textContent = aktion === 'freigeben' ? 'Freigegeben – in etwa einer Minute in der App sichtbar.' : 'Abgelehnt und gelöscht.';
      status.classList.remove('err');
    } catch (e) {
      status.textContent = e.message; status.classList.add('err');
      yes.disabled = !valid(); no.disabled = false;
    }
  };
  yes.addEventListener('click', act('freigeben'));
  no.addEventListener('click', act('ablehnen'));
  return node;
}

$('#login').addEventListener('submit', (e) => { e.preventDefault(); pw = $('#pw').value; load(); });
if (pw) load();

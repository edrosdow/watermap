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
  } catch (e) { say(e.message, true); }
}

function card(f) {
  const img = el('img', { alt: f.beschreibung || 'Eingereichtes Foto' });
  const status = el('p', { className: 'status' });
  const yes = el('button', { className: 'ok', type: 'button', textContent: 'Freigeben' });
  const no = el('button', { type: 'button', textContent: 'Ablehnen' });
  const valid = f.hat_foto && f.rechte && /^(node|way|relation|community)\//.test(f.standort_id);
  yes.disabled = !valid;
  const link = f.standort_id ? el('a', { href: `../#p=${encodeURIComponent(f.standort_id)}`, target: '_blank', rel: 'noopener', textContent: 'in der Karte ansehen' }) : null;
  const node = el('section', { className: 'card' }, img,
    el('h2', { textContent: f.standort_name || f.standort_id || 'Ohne Standort' }),
    el('p', { className: 'meta' }, f.created ? new Date(f.created).toLocaleString('de-DE') + ' · ' : '', link),
    el('p', { textContent: f.beschreibung || '(keine Beschreibung)' }),
    f.rechte ? null : el('p', { className: 'warn', textContent: 'Rechte am Foto nicht bestätigt – nicht freigeben.' }),
    f.hat_foto ? null : el('p', { className: 'warn', textContent: 'Kein Foto in der Einreichung.' }),
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
      await call('POST', '', { aktion, id: f.id });
      status.textContent = aktion === 'freigeben' ? 'Freigegeben – in etwa einer Minute in der App sichtbar.' : 'Abgelehnt und gelöscht.';
      status.classList.remove('err');
    } catch (e) {
      status.textContent = e.message; status.classList.add('err');
      yes.disabled = !valid; no.disabled = false;
    }
  };
  yes.addEventListener('click', act('freigeben'));
  no.addEventListener('click', act('ablehnen'));
  return node;
}

$('#login').addEventListener('submit', (e) => { e.preventDefault(); pw = $('#pw').value; load(); });
if (pw) load();

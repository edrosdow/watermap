// Foto-Freigabe per Klick (Seite /admin/fotos.html).
// Liest eingereichte Fotos aus Netlify Forms („foto-einreichen“) und veröffentlicht ein freigegebenes Foto, indem es
// public/photos/<datei> und public/data/community/overrides.json im GitHub-Repository aktualisiert. Netlify baut die
// Seite danach automatisch neu (≈ 1 Minute).
//
// Einstellungen (Netlify → Site configuration → Environment variables):
//   FOTO_ADMIN_PASSWORT  frei gewähltes, langes Passwort für die Freigabe-Seite
//   NETLIFY_API_TOKEN    Netlify → User settings → Applications → Personal access token
//   GITHUB_TOKEN         GitHub → Settings → Developer settings → Fine-grained token, nur dieses Repository,
//                        Berechtigung „Contents: Read and write“
//   optional GITHUB_REPO (Standard edrosdow/watermap), FOTO_BRANCH (Standard main)
import { createHash, timingSafeEqual } from 'node:crypto';

const FORM = 'foto-einreichen';
const MAX_BYTES = 6 * 1024 * 1024;
const ID_RE = /^(node|way|relation|community)\/[A-Za-z0-9_-]{1,40}$/;
const OVERRIDES = 'public/data/community/overrides.json';

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
const sha = (s) => createHash('sha256').update(String(s)).digest();

export function passwordOk(given, expected) {
  if (!expected || !given) return false;
  return timingSafeEqual(sha(given), sha(expected));
}

/** Bildformat am Dateiinhalt erkennen (nicht am Dateinamen). */
export function imageType(bytes) {
  const b = bytes;
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: 'png', mime: 'image/png' };
  if (b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  return null;
}

/** Netlify speichert Datei-Felder als Objekt {url, filename, …} oder direkt als URL. */
export function fileUrl(field) {
  const u = typeof field === 'string' ? field : field?.url;
  return typeof u === 'string' && /^https:\/\//.test(u) ? u : null;
}

/** Eintrag in overrides.json ergänzen (bestehenden freigegebenen Eintrag des Standorts erweitern). */
export function addPhoto(overrides, id, photo, today) {
  const list = Array.isArray(overrides) ? overrides : [];
  let rec = list.find(o => o && o.id === id && o.status === 'approved');
  if (!rec) { rec = { id, status: 'approved' }; list.push(rec); }
  rec.photos = [...(rec.photos || []), photo];
  rec.updated = today;
  return list;
}

export function submissionView(s) {
  const d = s.data || s;
  return {
    id: s.id, created: s.created_at || null,
    standort_id: String(d.standort_id || ''), standort_name: String(d.standort_name || ''),
    beschreibung: String(d.beschreibung || '').slice(0, 500), rechte: Boolean(d.foto_rechte),
    hat_foto: Boolean(fileUrl(d.foto)),
  };
}

function api(env, fetchFn) {
  const nf = async (path, init = {}) => {
    const res = await fetchFn(`https://api.netlify.com/api/v1${path}`, { ...init, headers: { authorization: `Bearer ${env.NETLIFY_API_TOKEN}`, ...(init.headers || {}) } });
    if (!res.ok) throw new Error(`Netlify-API ${res.status}`);
    return res.status === 204 ? null : res.json();
  };
  const gh = async (path, init = {}) => {
    const res = await fetchFn(`https://api.github.com/repos/${env.GITHUB_REPO || 'edrosdow/watermap'}${path}`, {
      ...init, headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'user-agent': 'watermap-fotos', ...(init.headers || {}) },
    });
    return res;
  };
  return { nf, gh };
}

async function submissions(nf, siteId) {
  const forms = await nf(`/sites/${siteId}/forms`);
  const form = (forms || []).find(f => f.name === FORM);
  if (!form) return [];
  return (await nf(`/forms/${form.id}/submissions?per_page=100`)) || [];
}

async function publish(gh, env, sub, fetchFn, today) {
  const d = sub.data || {};
  const id = String(d.standort_id || '');
  if (!ID_RE.test(id)) throw new Error('Standort-ID fehlt oder ist ungültig');
  if (!d.foto_rechte) throw new Error('Rechte am Foto nicht bestätigt');
  const url = fileUrl(d.foto);
  if (!url) throw new Error('Kein Foto in der Einreichung');
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`Foto nicht abrufbar (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new Error('Foto größer als 6 MB');
  const type = imageType(bytes);
  if (!type) throw new Error('Keine JPEG-, PNG- oder WebP-Datei');

  const branch = env.FOTO_BRANCH || 'main';
  const name = `${id.replace('/', '-')}-${Date.now().toString(36)}.${type.ext}`;
  const put = await gh(`/contents/public/photos/${name}`, { method: 'PUT', body: JSON.stringify({
    message: `Foto freigegeben: ${id}`, branch, content: Buffer.from(bytes).toString('base64') }) });
  if (!put.ok) throw new Error(`GitHub: Foto nicht gespeichert (${put.status})`);

  const photo = { url: `photos/${name}`, credit: 'WaterMap-Community', alt: String(d.beschreibung || '').trim().slice(0, 200) };
  for (let attempt = 0; attempt < 3; attempt++) {                // bei gleichzeitigen Freigaben neu versuchen
    const cur = await gh(`/contents/${OVERRIDES}?ref=${encodeURIComponent(branch)}`);
    if (!cur.ok) throw new Error(`GitHub: overrides.json nicht lesbar (${cur.status})`);
    const file = await cur.json();
    const list = addPhoto(JSON.parse(Buffer.from(file.content, 'base64').toString('utf8') || '[]'), id, photo, today);
    const upd = await gh(`/contents/${OVERRIDES}`, { method: 'PUT', body: JSON.stringify({
      message: `Foto freigegeben: ${id}`, branch, sha: file.sha,
      content: Buffer.from(JSON.stringify(list, null, 2) + '\n').toString('base64') }) });
    if (upd.ok) return photo;
    if (upd.status !== 409) throw new Error(`GitHub: overrides.json nicht gespeichert (${upd.status})`);
  }
  throw new Error('GitHub: overrides.json wurde gleichzeitig geändert, bitte noch einmal versuchen');
}

export async function handle(req, { env, siteId, fetchFn = fetch, today = new Date().toISOString().slice(0, 10) }) {
  const missing = ['FOTO_ADMIN_PASSWORT', 'NETLIFY_API_TOKEN', 'GITHUB_TOKEN'].filter(k => !env[k]);
  if (missing.length) {
    return json(503, { fehler: `Foto-Freigabe ist noch nicht eingerichtet – in diesem Deploy fehlt: ${missing.join(', ')}. ` +
      'Werte müssen auch für „Deploy Previews“ gesetzt sein; danach neu deployen.' });
  }
  if (!passwordOk(req.headers.get('x-passwort'), env.FOTO_ADMIN_PASSWORT)) return json(401, { fehler: 'Passwort falsch.' });
  const { nf, gh } = api(env, fetchFn);
  const url = new URL(req.url);
  try {
    const subs = await submissions(nf, siteId);
    if (req.method === 'GET' && url.searchParams.has('bild')) {
      const sub = subs.find(s => s.id === url.searchParams.get('bild'));
      const src = sub && fileUrl((sub.data || {}).foto);
      if (!src) return json(404, { fehler: 'Foto nicht gefunden.' });
      const res = await fetchFn(src);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const type = imageType(bytes);
      if (!res.ok || !type || bytes.length > MAX_BYTES) return json(422, { fehler: 'Datei ist kein gültiges Bild.' });
      return new Response(bytes, { headers: { 'content-type': type.mime, 'cache-control': 'no-store' } });
    }
    if (req.method === 'GET') return json(200, { fotos: subs.map(submissionView) });
    if (req.method !== 'POST') return json(405, { fehler: 'Nicht erlaubt.' });
    const body = await req.json().catch(() => ({}));
    const sub = subs.find(s => s.id === body.id);
    if (!sub) return json(404, { fehler: 'Einreichung nicht gefunden (schon erledigt?).' });
    if (body.aktion === 'freigeben') {
      const photo = await publish(gh, env, sub, fetchFn, today);
      await nf(`/submissions/${sub.id}`, { method: 'DELETE' });
      return json(200, { ok: true, foto: photo, standort_id: (sub.data || {}).standort_id });
    }
    if (body.aktion === 'ablehnen') {
      await nf(`/submissions/${sub.id}`, { method: 'DELETE' });
      return json(200, { ok: true });
    }
    return json(400, { fehler: 'Unbekannte Aktion.' });
  } catch (e) {
    return json(502, { fehler: e.message });
  }
}

const KEYS = ['FOTO_ADMIN_PASSWORT', 'NETLIFY_API_TOKEN', 'GITHUB_TOKEN', 'GITHUB_REPO', 'FOTO_BRANCH'];
function runtimeEnv() {
  // Netlify.env (Functions-Laufzeit) kennt auch als „Secret“ markierte Werte; process.env als Rückfall
  const nenv = globalThis.Netlify?.env;
  return Object.fromEntries(KEYS.map(k => [k, nenv?.get?.(k) || process.env[k] || '']));
}

export default async (req, context) => handle(req, { env: runtimeEnv(), siteId: context?.site?.id || process.env.SITE_ID });

// Foto-Verwaltung (Seite /admin/fotos.html): eingereichte Fotos freigeben oder ablehnen, gemeldete und veröffentlichte
// Fotos entfernen, Verlauf aller Aktionen.
// Eingereichte und gemeldete Fotos kommen aus Netlify Forms („foto-einreichen“, „fehler-melden“ mit art=foto). Jede
// Aktion ist genau ein Commit im GitHub-Repository: public/photos/<datei>, public/data/community/overrides.json und
// der Verlauf admin/verlauf.json (liegt außerhalb von public/ und wird nicht veröffentlicht). Netlify baut die Seite
// danach automatisch neu (≈ 1 Minute); reine Verlaufs-Commits lösen keinen Deploy aus (netlify.toml, ignore).
//
// Einstellungen (Netlify → Site configuration → Environment variables):
//   FOTO_ADMIN_PASSWORT  frei gewähltes, langes Passwort für die Freigabe-Seite
//   NETLIFY_API_TOKEN    Netlify → User settings → Applications → Personal access token
//   GITHUB_TOKEN         GitHub → Settings → Developer settings → Fine-grained token, nur dieses Repository,
//                        Berechtigung „Contents: Read and write“
//   optional GITHUB_REPO (Standard edrosdow/watermap), FOTO_BRANCH (Standard main)
import { createHash, timingSafeEqual } from 'node:crypto';

const FORM = 'foto-einreichen';
const REPORT_FORM = 'fehler-melden';
const MAX_BYTES = 6 * 1024 * 1024;
const ID_RE = /^(node|way|relation|community)\/[A-Za-z0-9_-]{1,40}$/;
const OVERRIDES = 'public/data/community/overrides.json';
const HISTORY = 'admin/verlauf.json';
const MAX_HISTORY = 500;

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

/** Foto aus overrides.json nehmen; ein Eintrag ohne Fotos und ohne sonstige Änderungen fällt ganz weg. */
export function removePhoto(overrides, id, url) {
  const out = [];
  let found = false;
  for (const o of Array.isArray(overrides) ? overrides : []) {
    if (o && o.id === id && Array.isArray(o.photos) && o.photos.some(ph => ph.url === url)) {
      found = true;
      const rest = { ...o, photos: o.photos.filter(ph => ph.url !== url) };
      if (!rest.photos.length) delete rest.photos;
      if (Object.keys(rest).some(k => !['id', 'status', 'updated'].includes(k))) out.push(rest);
      continue;
    }
    out.push(o);
  }
  if (!found) throw new Error('Foto ist nicht (mehr) veröffentlicht.');
  return out;
}

/** Alle freigegebenen Fotos aus overrides.json. */
export function publishedPhotos(overrides) {
  return (Array.isArray(overrides) ? overrides : []).filter(o => o && o.status === 'approved')
    .flatMap(o => (o.photos || []).map(ph => ({ standort_id: o.id, url: ph.url, alt: ph.alt || '', credit: ph.credit || '' })));
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

const PHOTO_PATH = /^photos\/[A-Za-z0-9._-]{1,120}$/;
const b64 = (data) => Buffer.from(data).toString('base64');
const cleanPath = (u) => String(u || '').replace(/^\.?\//, '');

/** Verlaufseintrag vorne anfügen (neueste zuerst, höchstens MAX_HISTORY). */
export function addHistory(list, entry) {
  return [entry, ...(Array.isArray(list) ? list : [])].slice(0, MAX_HISTORY);
}

/** „Fehler melden“-Einreichung als Foto-Meldung lesen – oder null, wenn sie kein Foto betrifft. */
export function photoReport(s) {
  const d = s.data || {};
  const details = String(d.details || '');
  const m = details.match(/photos\/[A-Za-z0-9._-]{1,120}/);
  if (!m || (d.art !== 'foto' && !/Foto unpassend/i.test(details))) return null;
  const grund = details.replace(/^.*photos\/[A-Za-z0-9._-]+\s*/s, '').replace(/^Grund:\s*/i, '').trim();
  return { id: s.id, created: s.created_at || null, standort_id: String(d.standort_id || ''), standort_name: String(d.standort_name || ''),
    foto: m[0], grund: grund.slice(0, 500) };
}

/** Datei aus dem Repository als Text (oder null, wenn es sie nicht gibt). */
async function readText(gh, ref, path) {
  const res = await gh(`/contents/${path}?ref=${encodeURIComponent(ref)}`, { headers: { accept: 'application/vnd.github.raw' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub: ${path} nicht lesbar (${res.status})`);
  return res.text();
}
const readJson = async (gh, ref, path, fallback) => { const t = await readText(gh, ref, path); return t ? JSON.parse(t) : fallback; };

async function ghJson(gh, path, init) {
  const res = await gh(path, init);
  if (!res.ok) throw new Error(`GitHub: ${path.split('?')[0]} (${res.status})`);
  return res.json();
}

/**
 * Ein Commit mit mehreren Dateien (Git-Data-API). build(read, exists) liefert [{path, content}] – content null löscht.
 * Ändert jemand gleichzeitig den Zweig, wird mit dem neuen Stand neu gebaut (bis zu 3 Versuche).
 */
async function commitChanges(gh, branch, message, build) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const head = (await ghJson(gh, `/git/ref/heads/${encodeURIComponent(branch)}`)).object.sha;
    const base = (await ghJson(gh, `/git/commits/${head}`)).tree.sha;
    const exists = async (path) => (await gh(`/contents/${path}?ref=${head}`)).ok;
    const files = await build((path, fallback) => readJson(gh, head, path, fallback), exists);
    const tree = [];
    for (const f of files) {
      if (f.content === null) { tree.push({ path: f.path, mode: '100644', type: 'blob', sha: null }); continue; }
      const blob = await ghJson(gh, '/git/blobs', { method: 'POST', body: JSON.stringify({ content: b64(f.content), encoding: 'base64' }) });
      tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    const t = await ghJson(gh, '/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: base, tree }) });
    const c = await ghJson(gh, '/git/commits', { method: 'POST', body: JSON.stringify({ message, tree: t.sha, parents: [head] }) });
    const upd = await gh(`/git/refs/heads/${encodeURIComponent(branch)}`, { method: 'PATCH', body: JSON.stringify({ sha: c.sha, force: false }) });
    if (upd.ok) return c.sha;
    if (upd.status !== 422 && upd.status !== 409) throw new Error(`GitHub: Commit nicht gespeichert (${upd.status})`);
  }
  throw new Error('GitHub: Daten wurden gleichzeitig geändert, bitte noch einmal versuchen');
}

const jsonFile = (path, data) => ({ path, content: JSON.stringify(data, null, 2) + '\n' });

async function formSubmissions(nf, siteId, name) {
  const forms = await nf(`/sites/${siteId}/forms`);
  const form = (forms || []).find(f => f.name === name);
  if (!form) return [];
  return (await nf(`/forms/${form.id}/submissions?per_page=100`)) || [];
}

/** Standort aus einer ID oder einem App-Link („…/#p=node%2F123“) lesen. */
export function standortAus(text) {
  const s = String(text || '').trim();
  const m = s.match(/[#&]p=([^&\s]+)/);
  const id = m ? decodeURIComponent(m[1]) : s;
  return ID_RE.test(id) ? id : null;
}

async function fetchPhoto(sub, fetchFn) {
  const d = sub.data || {};
  if (!d.foto_rechte) throw new Error('Rechte am Foto nicht bestätigt');
  const url = fileUrl(d.foto);
  if (!url) throw new Error('Kein Foto in der Einreichung');
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`Foto nicht abrufbar (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new Error('Foto größer als 6 MB');
  const type = imageType(bytes);
  if (!type) throw new Error('Keine JPEG-, PNG- oder WebP-Datei');
  return { bytes, type };
}

export async function handle(req, { env, siteId, fetchFn = fetch, now = new Date() }) {
  const missing = ['FOTO_ADMIN_PASSWORT', 'NETLIFY_API_TOKEN', 'GITHUB_TOKEN'].filter(k => !env[k]);
  if (missing.length) {
    return json(503, { fehler: `Foto-Freigabe ist noch nicht eingerichtet – in diesem Deploy fehlt: ${missing.join(', ')}. ` +
      'Werte müssen auch für „Deploy Previews“ gesetzt sein; danach neu deployen.' });
  }
  if (!passwordOk(req.headers.get('x-passwort'), env.FOTO_ADMIN_PASSWORT)) return json(401, { fehler: 'Passwort falsch.' });
  const { nf, gh } = api(env, fetchFn);
  const url = new URL(req.url);
  const q = url.searchParams;
  const branch = env.FOTO_BRANCH || 'main';
  const zeit = now.toISOString(), today = zeit.slice(0, 10);
  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  const history = (entry) => async (read) => jsonFile(HISTORY, addHistory(await read(HISTORY, []), { zeit, ...entry }));
  try {
    if (req.method === 'GET') {
      if (q.has('veroeffentlicht')) return json(200, { fotos: publishedPhotos(await readJson(gh, branch, OVERRIDES, [])) });
      if (q.has('verlauf')) return json(200, { verlauf: await readJson(gh, branch, HISTORY, []) });
      if (q.has('datei')) {
        const path = cleanPath(q.get('datei'));
        if (!PHOTO_PATH.test(path)) return json(400, { fehler: 'Ungültiger Dateiname.' });
        const res = await gh(`/contents/public/${path}?ref=${encodeURIComponent(branch)}`, { headers: { accept: 'application/vnd.github.raw' } });
        const bytes = new Uint8Array(await res.arrayBuffer());
        const type = imageType(bytes);
        if (!res.ok || !type) return json(404, { fehler: 'Foto nicht gefunden.' });
        return new Response(bytes, { headers: { 'content-type': type.mime, 'cache-control': 'no-store' } });
      }
      if (q.has('meldungen')) {
        const published = new Set(publishedPhotos(await readJson(gh, branch, OVERRIDES, [])).map(f => cleanPath(f.url)));
        const meldungen = (await formSubmissions(nf, siteId, REPORT_FORM)).map(photoReport).filter(Boolean)
          .map(m => ({ ...m, veroeffentlicht: published.has(m.foto) }));
        return json(200, { meldungen });
      }
    }

    // Veröffentlichtes Foto entfernen (auch aus einer Meldung heraus: dann wird die Meldung mit erledigt)
    if (req.method === 'POST' && body.aktion === 'entfernen') {
      const path = cleanPath(body.url);
      if (!ID_RE.test(String(body.standort_id || '')) || !PHOTO_PATH.test(path)) return json(400, { fehler: 'Ungültige Angaben.' });
      const report = body.meldung ? (await formSubmissions(nf, siteId, REPORT_FORM)).find(s => s.id === body.meldung) : null;
      await commitChanges(gh, branch, `Foto entfernt: ${body.standort_id}`, async (read, exists) => {
        const ov = await read(OVERRIDES, []);
        const alt = (ov.find(o => o && o.id === body.standort_id)?.photos || []).find(ph => cleanPath(ph.url) === path)?.alt || '';
        return [jsonFile(OVERRIDES, removePhoto(ov, body.standort_id, body.url)),
          ...(await exists(`public/${path}`) ? [{ path: `public/${path}`, content: null }] : []),
          await history({ aktion: 'entfernt', standort_id: body.standort_id, foto: path, beschreibung: alt,
            grund: report ? photoReport(report)?.grund || '' : '' })(read)];
      });
      if (report) await nf(`/submissions/${report.id}`, { method: 'DELETE' });
      return json(200, { ok: true });
    }
    if (req.method === 'POST' && body.aktion === 'meldung_verwerfen') {
      const report = (await formSubmissions(nf, siteId, REPORT_FORM)).find(s => s.id === body.id);
      const m = report && photoReport(report);
      if (!m) return json(404, { fehler: 'Meldung nicht gefunden (schon erledigt?).' });
      await commitChanges(gh, branch, `Foto-Meldung verworfen: ${m.standort_id}`, async (read) => [
        await history({ aktion: 'meldung verworfen', standort_id: m.standort_id, foto: m.foto, grund: m.grund })(read)]);
      await nf(`/submissions/${report.id}`, { method: 'DELETE' });
      return json(200, { ok: true });
    }

    const subs = await formSubmissions(nf, siteId, FORM);
    if (req.method === 'GET' && q.has('bild')) {
      const sub = subs.find(s => s.id === q.get('bild'));
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
    const sub = subs.find(s => s.id === body.id);
    if (!sub) return json(404, { fehler: 'Einreichung nicht gefunden (schon erledigt?).' });
    const d = sub.data || {};
    if (body.aktion === 'freigeben') {
      // Standort nachtragen, wenn bei der Einreichung „Anderer Standort“ gewählt wurde
      const standort = body.standort ? standortAus(body.standort) : null;
      if (body.standort && !standort) return json(400, { fehler: 'Standort nicht erkannt – Link aus der App (…#p=node/123) oder ID einfügen.' });
      const id = standort || String(d.standort_id || '');
      if (!ID_RE.test(id)) throw new Error('Standort-ID fehlt oder ist ungültig');
      const { bytes, type } = await fetchPhoto(sub, fetchFn);
      const name = `${id.replace('/', '-')}-${now.getTime().toString(36)}.${type.ext}`;
      const photo = { url: `photos/${name}`, credit: 'WaterMap-Community', alt: String(d.beschreibung || '').trim().slice(0, 200) };
      await commitChanges(gh, branch, `Foto freigegeben: ${id}`, async (read) => [
        { path: `public/photos/${name}`, content: bytes },
        jsonFile(OVERRIDES, addPhoto(await read(OVERRIDES, []), id, photo, today)),
        await history({ aktion: 'freigegeben', standort_id: id, standort_name: String(d.standort_name || ''), foto: photo.url, beschreibung: photo.alt })(read)]);
      await nf(`/submissions/${sub.id}`, { method: 'DELETE' });
      return json(200, { ok: true, foto: photo, standort_id: id });
    }
    if (body.aktion === 'ablehnen') {
      await commitChanges(gh, branch, `Foto abgelehnt: ${d.standort_id || 'ohne Standort'}`, async (read) => [
        await history({ aktion: 'abgelehnt', standort_id: String(d.standort_id || ''), standort_name: String(d.standort_name || ''),
          beschreibung: String(d.beschreibung || '').slice(0, 200) })(read)]);
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

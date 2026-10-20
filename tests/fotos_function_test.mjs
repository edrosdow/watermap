// Tests für netlify/functions/fotos.mjs mit nachgebauter Netlify- und GitHub-API (node tests/fotos_function_test.mjs).
import assert from 'node:assert/strict';
import { handle, imageType, addPhoto, passwordOk, fileUrl } from '../netlify/functions/fotos.mjs';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const env = { FOTO_ADMIN_PASSWORT: 'geheim-123', NETLIFY_API_TOKEN: 'nf', GITHUB_TOKEN: 'gh' };

function fakeWorld({ photo = JPEG, rights = 'ja', standort = 'node/632876845', overrides = [] } = {}) {
  const state = { subs: [{ id: 's1', created_at: '2026-10-20T12:00:00Z', data: {
    standort_id: standort, standort_name: 'Slip Vössen', beschreibung: 'Rampe bei Niedrigwasser', foto_rechte: rights,
    foto: { filename: 'x.jpg', url: 'https://files.netlify.example/s1/x.jpg' } } }],
  files: {}, overrides: JSON.stringify(overrides), sha: 'a1', deleted: [], calls: [] };
  const fetchFn = async (url, init = {}) => {
    const method = init.method || 'GET';
    state.calls.push(`${method} ${url}`);
    const ok = (body, status = 200) => new Response(body === null ? null : JSON.stringify(body), { status });
    if (url === 'https://api.netlify.com/api/v1/sites/site-1/forms') return ok([{ id: 'f9', name: 'foto-einreichen' }, { id: 'f1', name: 'fehler-melden' }]);
    if (url.startsWith('https://api.netlify.com/api/v1/forms/f9/submissions')) return ok(state.subs);
    if (url.startsWith('https://api.netlify.com/api/v1/submissions/') && method === 'DELETE') {
      state.deleted.push(url.split('/').pop()); state.subs = state.subs.filter(s => !url.endsWith(s.id)); return new Response(null, { status: 204 });
    }
    if (url === 'https://files.netlify.example/s1/x.jpg') return new Response(photo, { status: 200 });
    const gh = 'https://api.github.com/repos/edrosdow/watermap/contents/';
    if (url.startsWith(gh + 'public/photos/') && method === 'PUT') {
      const b = JSON.parse(init.body); assert.equal(b.branch, 'main'); assert.equal(init.headers.authorization, 'Bearer gh');
      state.files[url.slice(gh.length)] = Buffer.from(b.content, 'base64'); return ok({}, 201);
    }
    if (url.startsWith(gh + 'public/data/community/overrides.json') && method === 'GET') {
      return ok({ sha: state.sha, content: Buffer.from(state.overrides).toString('base64') });
    }
    if (url === gh + 'public/data/community/overrides.json' && method === 'PUT') {
      const b = JSON.parse(init.body);
      if (b.sha !== state.sha) return ok({}, 409);
      state.overrides = Buffer.from(b.content, 'base64').toString('utf8'); state.sha += 'x'; return ok({}, 200);
    }
    throw new Error('unerwarteter Aufruf ' + method + ' ' + url);
  };
  return { state, fetchFn };
}
const req = (method, query = '', body, pw = 'geheim-123') => new Request('https://watermaps.netlify.app/.netlify/functions/fotos' + query, {
  method, headers: { 'x-passwort': pw, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const run = (r, w, extra = {}) => handle(r, { env, siteId: 'site-1', fetchFn: w.fetchFn, today: '2026-10-20', ...extra });

// Hilfsfunktionen
assert.equal(imageType(JPEG).ext, 'jpg');
assert.equal(imageType(new TextEncoder().encode('<svg onload=alert(1)>')), null);
assert.equal(passwordOk('geheim-123', 'geheim-123'), true);
assert.equal(passwordOk('falsch', 'geheim-123'), false);
assert.equal(passwordOk('', ''), false);
assert.equal(fileUrl('http://unsicher.example/x.jpg'), null);
assert.deepEqual(addPhoto([{ id: 'node/1', status: 'approved', photos: [{ url: 'photos/a.jpg' }] }], 'node/1', { url: 'photos/b.jpg' }, '2026-10-20'),
  [{ id: 'node/1', status: 'approved', photos: [{ url: 'photos/a.jpg' }, { url: 'photos/b.jpg' }], updated: '2026-10-20' }]);

// nicht eingerichtet / falsches Passwort
{ const w = fakeWorld(); const r = await handle(req('GET'), { env: {}, siteId: 'site-1', fetchFn: w.fetchFn });
  assert.equal(r.status, 503); assert.equal(w.state.calls.length, 0); }
{ const w = fakeWorld(); const r = await run(req('GET', '', null, 'falsch'), w);
  assert.equal(r.status, 401); assert.equal(w.state.calls.length, 0, 'ohne Passwort keine API-Aufrufe'); }

// Liste und Bild
{ const w = fakeWorld(); const j = await (await run(req('GET'), w)).json();
  assert.deepEqual(j.fotos.map(f => [f.id, f.standort_id, f.rechte, f.hat_foto]), [['s1', 'node/632876845', true, true]]);
  const img = await run(req('GET', '?bild=s1'), w);
  assert.equal(img.headers.get('content-type'), 'image/jpeg'); assert.equal(img.headers.get('cache-control'), 'no-store'); }
{ const w = fakeWorld({ photo: new TextEncoder().encode('<html>') }); assert.equal((await run(req('GET', '?bild=s1'), w)).status, 422); }

// Freigeben: Foto und overrides.json im Repo, Einreichung gelöscht
{ const w = fakeWorld({ overrides: [{ id: 'node/9', status: 'approved', fields: { name: 'X' } }] });
  const r = await run(req('POST', '', { aktion: 'freigeben', id: 's1' }), w);
  const j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j));
  const [path] = Object.keys(w.state.files);
  assert.match(path, /^public\/photos\/node-632876845-[a-z0-9]+\.jpg$/);
  assert.deepEqual([...w.state.files[path]], [...JPEG]);
  const ov = JSON.parse(w.state.overrides);
  assert.equal(ov.length, 2);
  assert.deepEqual(ov[1], { id: 'node/632876845', status: 'approved', photos: [{ url: path.replace('public/', ''), credit: 'WaterMap-Community', alt: 'Rampe bei Niedrigwasser' }], updated: '2026-10-20' });
  assert.deepEqual(w.state.deleted, ['s1']); }

// Freigeben verweigert: Rechte fehlen, falsche ID, kein Bild
for (const [opts, msg] of [[{ rights: '' }, /Rechte/], [{ standort: '../../etc' }, /Standort-ID/], [{ photo: new TextEncoder().encode('GIF89a') }, /JPEG/]]) {
  const w = fakeWorld(opts);
  const r = await run(req('POST', '', { aktion: 'freigeben', id: 's1' }), w);
  assert.equal(r.status, 502); assert.match((await r.json()).fehler, msg);
  assert.deepEqual(Object.keys(w.state.files), []); assert.deepEqual(w.state.deleted, [], 'bei Fehler nichts löschen');
}

// Ablehnen löscht nur die Einreichung
{ const w = fakeWorld(); const r = await run(req('POST', '', { aktion: 'ablehnen', id: 's1' }), w);
  assert.equal(r.status, 200); assert.deepEqual(w.state.deleted, ['s1']); assert.deepEqual(Object.keys(w.state.files), []); }
{ const w = fakeWorld(); assert.equal((await run(req('POST', '', { aktion: 'freigeben', id: 'gibtsnicht' }), w)).status, 404); }

console.log('fotos.mjs: alle Tests OK');

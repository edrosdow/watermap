// Tests für netlify/functions/fotos.mjs mit nachgebauter Netlify- und GitHub-API (node tests/fotos_function_test.mjs).
import assert from 'node:assert/strict';
import { handle, imageType, addPhoto, passwordOk, fileUrl, standortAus } from '../netlify/functions/fotos.mjs';

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
    if (url.startsWith(gh + 'public/photos/') && method === 'GET') {
      const path = url.slice(gh.length).split('?')[0];
      if (!(path in state.files)) return new Response('{}', { status: 404 });
      if (init.headers.accept === 'application/vnd.github.raw') return new Response(state.files[path], { status: 200 });
      return ok({ sha: 'f-' + path });
    }
    if (url.startsWith(gh + 'public/photos/') && method === 'DELETE') {
      const path = url.slice(gh.length);
      assert.equal(JSON.parse(init.body).sha, 'f-' + path);
      delete state.files[path]; state.deletedFiles = [...(state.deletedFiles || []), path]; return ok({});
    }
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

// „Anderer Standort“: Standort beim Freigeben als App-Link nachtragen
assert.equal(standortAus('https://watermaps.netlify.app/#p=node%2F632876845'), 'node/632876845');
assert.equal(standortAus('way/12'), 'way/12');
assert.equal(standortAus('https://x/#p=..%2F..%2Fetc'), null);
{ const w = fakeWorld({ standort: '__other' });
  const bad = await run(req('POST', '', { aktion: 'freigeben', id: 's1' }), w);
  assert.equal(bad.status, 502);
  const wrong = await run(req('POST', '', { aktion: 'freigeben', id: 's1', standort: 'irgendwas' }), w);
  assert.equal(wrong.status, 400);
  const r = await run(req('POST', '', { aktion: 'freigeben', id: 's1', standort: 'https://watermaps.netlify.app/#p=node%2F632876845' }), w);
  assert.equal(r.status, 200);
  assert.match(Object.keys(w.state.files)[0], /^public\/photos\/node-632876845-/);
  assert.equal(JSON.parse(w.state.overrides)[0].id, 'node/632876845'); }

// Veröffentlichte Fotos: auflisten, Bild ausliefern, entfernen
{ const w = fakeWorld({ overrides: [
    { id: 'node/5', status: 'approved', photos: [{ url: 'photos/a.jpg', credit: 'X', alt: 'Babybett' }, { url: 'photos/b.jpg', credit: 'X', alt: 'Rampe' }], updated: '2026-10-01' },
    { id: 'node/6', status: 'approved', photos: [{ url: 'photos/c.jpg', credit: 'X' }], updated: '2026-10-01' },
    { id: 'node/7', status: 'approved', fields: { name: 'Neu' }, photos: [{ url: 'photos/d.jpg' }] }] });
  w.state.files = { 'public/photos/a.jpg': JPEG, 'public/photos/c.jpg': JPEG, 'public/photos/d.jpg': JPEG };
  const list = (await (await run(req('GET', '?veroeffentlicht=1'), w)).json()).fotos;
  assert.deepEqual(list.map(f => [f.standort_id, f.url]), [['node/5', 'photos/a.jpg'], ['node/5', 'photos/b.jpg'], ['node/6', 'photos/c.jpg'], ['node/7', 'photos/d.jpg']]);
  const img = await run(req('GET', '?datei=photos/a.jpg'), w);
  assert.equal(img.headers.get('content-type'), 'image/jpeg');
  assert.equal((await run(req('GET', '?datei=../../netlify.toml'), w)).status, 400);
  assert.equal((await run(req('GET', '?datei=photos/fehlt.jpg'), w)).status, 404);
  // eins von zweien: Eintrag bleibt mit dem anderen Foto
  assert.equal((await run(req('POST', '', { aktion: 'entfernen', standort_id: 'node/5', url: 'photos/a.jpg' }), w)).status, 200);
  let ov = JSON.parse(w.state.overrides);
  assert.deepEqual(ov[0].photos.map(p => p.url), ['photos/b.jpg']);
  assert.deepEqual(w.state.deletedFiles, ['public/photos/a.jpg']);
  // einziges Foto: Eintrag fällt weg; mit sonstigen Änderungen bleibt er (ohne photos)
  await run(req('POST', '', { aktion: 'entfernen', standort_id: 'node/6', url: 'photos/c.jpg' }), w);
  await run(req('POST', '', { aktion: 'entfernen', standort_id: 'node/7', url: 'photos/d.jpg' }), w);
  ov = JSON.parse(w.state.overrides);
  assert.deepEqual(ov.map(o => o.id), ['node/5', 'node/7']);
  assert.deepEqual(ov[1], { id: 'node/7', status: 'approved', fields: { name: 'Neu' } });
  const gone = await run(req('POST', '', { aktion: 'entfernen', standort_id: 'node/6', url: 'photos/c.jpg' }), w);
  assert.equal(gone.status, 502); assert.match((await gone.json()).fehler, /nicht \(mehr\) veröffentlicht/);
  assert.equal((await run(req('POST', '', { aktion: 'entfernen', standort_id: 'node/5', url: '../x.jpg' }), w)).status, 400);
  assert.equal(w.state.calls.filter(c => c.includes('api.netlify.com')).length, 0, 'Entfernen braucht kein Netlify-Formular'); }

// Ablehnen löscht nur die Einreichung
{ const w = fakeWorld(); const r = await run(req('POST', '', { aktion: 'ablehnen', id: 's1' }), w);
  assert.equal(r.status, 200); assert.deepEqual(w.state.deleted, ['s1']); assert.deepEqual(Object.keys(w.state.files), []); }
{ const w = fakeWorld(); assert.equal((await run(req('POST', '', { aktion: 'freigeben', id: 'gibtsnicht' }), w)).status, 404); }

console.log('fotos.mjs: alle Tests OK');

// Tests für netlify/functions/fotos.mjs mit nachgebauter Netlify- und GitHub-API (node tests/fotos_function_test.mjs).
import assert from 'node:assert/strict';
import { handle, imageType, addPhoto, passwordOk, fileUrl, standortAus, addHistory, photoReport, slug, slipFromSubmission, priceFromSubmission } from '../netlify/functions/fotos.mjs';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const env = { FOTO_ADMIN_PASSWORT: 'geheim-123', NETLIFY_API_TOKEN: 'nf', GITHUB_TOKEN: 'gh' };
const OV = 'public/data/community/overrides.json', HIST = 'admin/verlauf.json';
const NOW = new Date('2026-10-20T12:34:56Z');

/** Nachgebaute Welt: Netlify-Formulare + ein Git-Zweig „main“ (Dateien als Buffer). */
function fakeWorld({ photo = JPEG, rights = 'ja', beschreibung = 'Rampe bei Niedrigwasser', motiv = undefined, standort = 'node/632876845', overrides = [], files = {}, reports = [], slips = [], prices = [], raceOnce = false } = {}) {
  const repo = { [OV]: Buffer.from(JSON.stringify(overrides)) };
  for (const [k, v] of Object.entries(files)) repo[k] = Buffer.from(v);
  const state = {
    subs: [{ id: 's1', created_at: '2026-10-20T12:00:00Z', data: {
      standort_id: standort, standort_name: 'Slip Vössen', beschreibung, ...(motiv ? { motiv } : {}), foto_rechte: rights,
      foto: { filename: 'x.jpg', url: 'https://files.netlify.example/s1/x.jpg' } } }],
    reports, slips, prices, repo, commits: { c0: { files: repo } }, head: 'c0', n: 0, blobs: {}, trees: {}, messages: [], deleted: [], calls: [], raceOnce,
  };
  const json = (body, status = 200) => new Response(body === null ? null : JSON.stringify(body), { status });
  const fetchFn = async (url, init = {}) => {
    const method = init.method || 'GET';
    state.calls.push(`${method} ${url}`);
    const nf = 'https://api.netlify.com/api/v1';
    if (url === `${nf}/sites/site-1/forms`) return json([{ id: 'f9', name: 'foto-einreichen' }, { id: 'f1', name: 'fehler-melden' }, { id: 'f2', name: 'slipanlage-melden' }, { id: 'f3', name: 'tankpreis-melden' }]);
    if (url.startsWith(`${nf}/forms/f9/submissions`)) return json(state.subs);
    if (url.startsWith(`${nf}/forms/f1/submissions`)) return json(state.reports);
    if (url.startsWith(`${nf}/forms/f2/submissions`)) return json(state.slips);
    if (url.startsWith(`${nf}/forms/f3/submissions`)) return json(state.prices);
    if (url.startsWith(`${nf}/submissions/`) && method === 'DELETE') {
      const id = url.split('/').pop();
      state.deleted.push(id);
      for (const k of ['subs', 'reports', 'slips', 'prices']) state[k] = state[k].filter(s => s.id !== id);
      return new Response(null, { status: 204 });
    }
    if (url === 'https://files.netlify.example/s1/x.jpg') return new Response(photo, { status: 200 });
    const gh = 'https://api.github.com/repos/edrosdow/watermap';
    assert.ok(url.startsWith(gh), url);
    assert.equal(init.headers.authorization, 'Bearer gh');
    const p = url.slice(gh.length);
    if (p.startsWith('/contents/') && method === 'GET') {
      const [path, query] = p.slice('/contents/'.length).split('?');
      const ref = new URLSearchParams(query).get('ref');
      const files = ref === 'main' ? state.repo : state.commits[ref].files;
      if (!(path in files)) return new Response('{}', { status: 404 });
      return init.headers.accept === 'application/vnd.github.raw' ? new Response(files[path]) : json({ sha: 'x' });
    }
    if (p === '/git/ref/heads/main') return json({ object: { sha: state.head } });
    if (p.startsWith('/git/commits/') && method === 'GET') return json({ tree: { sha: 'tree-' + p.split('/').pop() } });
    if (p === '/git/blobs') { const sha = 'b' + (++state.n); state.blobs[sha] = Buffer.from(JSON.parse(init.body).content, 'base64'); return json({ sha }, 201); }
    if (p === '/git/trees') { const sha = 't' + (++state.n); state.trees[sha] = JSON.parse(init.body); return json({ sha }, 201); }
    if (p === '/git/commits') {
      const b = JSON.parse(init.body), sha = 'c' + (++state.n);
      const files = { ...state.commits[b.parents[0]].files };
      for (const e of state.trees[b.tree].tree) {
        if (e.sha === null) { assert.ok(e.path in files, 'nur vorhandene Dateien löschen: ' + e.path); delete files[e.path]; } else files[e.path] = state.blobs[e.sha];
      }
      state.commits[sha] = { files, parent: b.parents[0], message: b.message };
      return json({ sha }, 201);
    }
    if (p === '/git/refs/heads/main' && method === 'PATCH') {
      const b = JSON.parse(init.body);
      if (state.raceOnce) {                                        // jemand anderes committet dazwischen
        state.raceOnce = false;
        const other = 'c' + (++state.n);
        state.commits[other] = { files: { ...state.repo, 'README.md': Buffer.from('x') }, parent: state.head };
        state.head = other; state.repo = state.commits[other].files;
        return json({ message: 'Update is not a fast forward' }, 422);
      }
      assert.equal(state.commits[b.sha].parent, state.head);
      state.head = b.sha; state.repo = state.commits[b.sha].files; state.messages.push(state.commits[b.sha].message);
      return json({ object: { sha: b.sha } });
    }
    throw new Error('unerwarteter Aufruf ' + method + ' ' + url);
  };
  const file = (path) => state.repo[path];
  const jsonAt = (path) => JSON.parse(state.repo[path].toString('utf8'));
  return { state, fetchFn, file, jsonAt };
}
const req = (method, query = '', body, pw = 'geheim-123') => new Request('https://watermaps.netlify.app/.netlify/functions/fotos' + query, {
  method, headers: { 'x-passwort': pw, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const run = (r, w, extra = {}) => handle(r, { env, siteId: 'site-1', fetchFn: w.fetchFn, now: NOW, ...extra });

// Hilfsfunktionen
assert.equal(imageType(JPEG).ext, 'jpg');
assert.equal(imageType(new TextEncoder().encode('<svg onload=alert(1)>')), null);
assert.equal(passwordOk('geheim-123', 'geheim-123'), true);
assert.equal(passwordOk('falsch', 'geheim-123'), false);
assert.equal(passwordOk('', ''), false);
assert.equal(fileUrl('http://unsicher.example/x.jpg'), null);
assert.deepEqual(addPhoto([{ id: 'node/1', status: 'approved', photos: [{ url: 'photos/a.jpg' }] }], 'node/1', { url: 'photos/b.jpg' }, '2026-10-20'),
  [{ id: 'node/1', status: 'approved', photos: [{ url: 'photos/a.jpg' }, { url: 'photos/b.jpg' }], updated: '2026-10-20' }]);
assert.equal(addHistory(Array.from({ length: 500 }, (_, i) => ({ i })), { neu: 1 }).length, 500);
assert.deepEqual(addHistory(null, { a: 1 }), [{ a: 1 }]);
assert.equal(standortAus('https://watermaps.netlify.app/#p=node%2F632876845'), 'node/632876845');
assert.equal(standortAus('way/12'), 'way/12');
assert.equal(standortAus('https://x/#p=..%2F..%2Fetc'), null);
assert.deepEqual(photoReport({ id: 'r1', data: { art: 'foto', standort_id: 'node/5', details: 'Foto unpassend: photos/a.jpg\nGrund: Babybett' } }),
  { id: 'r1', created: null, standort_id: 'node/5', standort_name: '', foto: 'photos/a.jpg', grund: 'Babybett' });
assert.equal(photoReport({ id: 'r2', data: { art: 'preis', details: 'Diesel kostet 2 €' } }), null);
assert.equal(photoReport({ id: 'r3', data: { art: 'sonstiges', details: 'Foto unpassend: photos/b.jpg\nGrund: ' } }).foto, 'photos/b.jpg');   // ältere Meldungen

// nicht eingerichtet / falsches Passwort
{ const w = fakeWorld(); const r = await handle(req('GET'), { env: {}, siteId: 'site-1', fetchFn: w.fetchFn });
  assert.equal(r.status, 503); assert.equal(w.state.calls.length, 0); }
{ const w = fakeWorld(); const r = await run(req('GET', '', null, 'falsch'), w);
  assert.equal(r.status, 401); assert.equal(w.state.calls.length, 0, 'ohne Passwort keine API-Aufrufe'); }

// Liste und Bild der Einreichungen
{ const w = fakeWorld(); const j = await (await run(req('GET'), w)).json();
  assert.deepEqual(j.fotos.map(f => [f.id, f.standort_id, f.rechte, f.hat_foto]), [['s1', 'node/632876845', true, true]]);
  const img = await run(req('GET', '?bild=s1'), w);
  assert.equal(img.headers.get('content-type'), 'image/jpeg'); assert.equal(img.headers.get('cache-control'), 'no-store'); }
{ const w = fakeWorld({ photo: new TextEncoder().encode('<html>') }); assert.equal((await run(req('GET', '?bild=s1'), w)).status, 422); }

// Freigeben: ein Commit mit Foto, overrides.json und Verlauf; Einreichung gelöscht
{ const w = fakeWorld({ overrides: [{ id: 'node/9', status: 'approved', fields: { name: 'X' } }] });
  const r = await run(req('POST', '', { aktion: 'freigeben', id: 's1' }), w);
  const j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j));
  assert.deepEqual(w.state.messages, ['Foto freigegeben: node/632876845'], 'genau ein Commit');
  const path = 'public/' + j.foto.url;
  assert.match(path, /^public\/photos\/node-632876845-[a-z0-9]+\.jpg$/);
  assert.deepEqual([...w.file(path)], [...JPEG]);
  const ov = w.jsonAt(OV);
  assert.deepEqual(ov[1], { id: 'node/632876845', status: 'approved', photos: [{ url: j.foto.url, credit: 'WaterMap-Community', alt: 'Rampe bei Niedrigwasser' }], updated: '2026-10-20' });
  assert.deepEqual(w.jsonAt(HIST), [{ zeit: NOW.toISOString(), bereich: 'foto', aktion: 'freigegeben', standort_id: 'node/632876845', standort_name: 'Slip Vössen', foto: j.foto.url, beschreibung: 'Rampe bei Niedrigwasser' }]);
  assert.deepEqual(w.state.deleted, ['s1']); }

// Neues Foto-Formular: Motiv in der Liste; ohne Notiz wird das Motiv zur Bildbeschreibung
{ const w = fakeWorld({ beschreibung: '', motiv: 'Rampe, Steg' });
  const f = (await (await run(req('GET'), w)).json()).fotos[0];
  assert.equal(f.motiv, 'Rampe, Steg'); assert.equal(f.beschreibung, '');
  const j = await (await run(req('POST', '', { aktion: 'freigeben', id: 's1' }), w)).json();
  assert.equal(w.jsonAt(OV)[0].photos[0].alt, 'Rampe, Steg', JSON.stringify(j)); }

// Gleichzeitige Änderung am Zweig: neu aufbauen, nichts geht verloren
{ const w = fakeWorld({ raceOnce: true });
  assert.equal((await run(req('POST', '', { aktion: 'freigeben', id: 's1' }), w)).status, 200);
  assert.ok(w.file('README.md') && w.jsonAt(OV).length === 1 && w.jsonAt(HIST).length === 1, 'fremder Commit bleibt, eigener kommt dazu'); }

// Freigeben verweigert: Rechte fehlen, falsche ID, kein Bild – nichts committet, nichts gelöscht
for (const [opts, msg] of [[{ rights: '' }, /Rechte/], [{ standort: '../../etc' }, /Standort-ID/], [{ photo: new TextEncoder().encode('GIF89a') }, /JPEG/]]) {
  const w = fakeWorld(opts);
  const r = await run(req('POST', '', { aktion: 'freigeben', id: 's1' }), w);
  assert.equal(r.status, 502); assert.match((await r.json()).fehler, msg);
  assert.deepEqual(w.state.messages, []); assert.deepEqual(w.state.deleted, [], 'bei Fehler nichts löschen');
}

// „Anderer Standort“: Standort beim Freigeben als App-Link nachtragen
{ const w = fakeWorld({ standort: '__other' });
  assert.equal((await run(req('POST', '', { aktion: 'freigeben', id: 's1' }), w)).status, 502);
  assert.equal((await run(req('POST', '', { aktion: 'freigeben', id: 's1', standort: 'irgendwas' }), w)).status, 400);
  const r = await run(req('POST', '', { aktion: 'freigeben', id: 's1', standort: 'https://watermaps.netlify.app/#p=node%2F632876845' }), w);
  assert.equal(r.status, 200);
  assert.equal(w.jsonAt(OV)[0].id, 'node/632876845'); }

// Ablehnen: Einreichung gelöscht, nur der Verlauf wird committet
{ const w = fakeWorld(); const r = await run(req('POST', '', { aktion: 'ablehnen', id: 's1' }), w);
  assert.equal(r.status, 200); assert.deepEqual(w.state.deleted, ['s1']);
  assert.deepEqual(Object.keys(w.state.repo).sort(), [HIST, OV]);
  assert.equal(w.jsonAt(HIST)[0].aktion, 'abgelehnt'); assert.equal(w.jsonAt(HIST)[0].beschreibung, 'Rampe bei Niedrigwasser'); }
{ const w = fakeWorld(); assert.equal((await run(req('POST', '', { aktion: 'freigeben', id: 'gibtsnicht' }), w)).status, 404); }

// Veröffentlichte Fotos: auflisten, Bild ausliefern, entfernen
{ const w = fakeWorld({ overrides: [
    { id: 'node/5', status: 'approved', photos: [{ url: 'photos/a.jpg', credit: 'X', alt: 'Babybett' }, { url: 'photos/b.jpg', credit: 'X', alt: 'Rampe' }], updated: '2026-10-01' },
    { id: 'node/6', status: 'approved', photos: [{ url: 'photos/c.jpg', credit: 'X' }], updated: '2026-10-01' },
    { id: 'node/7', status: 'approved', fields: { name: 'Neu' }, photos: [{ url: 'photos/d.jpg' }] }],
    files: { 'public/photos/a.jpg': JPEG, 'public/photos/b.jpg': JPEG, 'public/photos/c.jpg': JPEG } });   // d.jpg fehlt im Repo
  const list = (await (await run(req('GET', '?veroeffentlicht=1'), w)).json()).fotos;
  assert.deepEqual(list.map(f => [f.standort_id, f.url]), [['node/5', 'photos/a.jpg'], ['node/5', 'photos/b.jpg'], ['node/6', 'photos/c.jpg'], ['node/7', 'photos/d.jpg']]);
  assert.equal((await run(req('GET', '?datei=photos/a.jpg'), w)).headers.get('content-type'), 'image/jpeg');
  assert.equal((await run(req('GET', '?datei=../../netlify.toml'), w)).status, 400);
  assert.equal((await run(req('GET', '?datei=photos/fehlt.jpg'), w)).status, 404);
  assert.equal((await run(req('POST', '', { aktion: 'entfernen', standort_id: 'node/5', url: 'photos/a.jpg' }), w)).status, 200);
  assert.deepEqual(w.jsonAt(OV)[0].photos.map(p => p.url), ['photos/b.jpg']);
  assert.equal(w.file('public/photos/a.jpg'), undefined);
  assert.deepEqual(w.jsonAt(HIST)[0], { zeit: NOW.toISOString(), bereich: 'foto', aktion: 'entfernt', standort_id: 'node/5', foto: 'photos/a.jpg', beschreibung: 'Babybett', grund: '' });
  await run(req('POST', '', { aktion: 'entfernen', standort_id: 'node/6', url: 'photos/c.jpg' }), w);
  assert.equal((await run(req('POST', '', { aktion: 'entfernen', standort_id: 'node/7', url: 'photos/d.jpg' }), w)).status, 200, 'fehlende Datei: Eintrag trotzdem entfernen');
  assert.deepEqual(w.jsonAt(OV).map(o => o.id), ['node/5', 'node/7']);
  assert.deepEqual(w.jsonAt(OV)[1], { id: 'node/7', status: 'approved', fields: { name: 'Neu' } });
  const gone = await run(req('POST', '', { aktion: 'entfernen', standort_id: 'node/6', url: 'photos/c.jpg' }), w);
  assert.equal(gone.status, 502); assert.match((await gone.json()).fehler, /nicht \(mehr\) veröffentlicht/);
  assert.equal((await run(req('POST', '', { aktion: 'entfernen', standort_id: 'node/5', url: '../x.jpg' }), w)).status, 400);
  assert.equal(w.jsonAt(HIST).length, 3);
  const verlauf = (await (await run(req('GET', '?verlauf=1'), w)).json()).verlauf;
  assert.deepEqual(verlauf.map(e => e.foto), ['photos/d.jpg', 'photos/c.jpg', 'photos/a.jpg'], 'Verlauf: neueste zuerst'); }

// Gemeldete Fotos: auflisten, Foto entfernen (erledigt die Meldung), Meldung verwerfen
{ const reports = [
    { id: 'r1', created_at: '2026-10-20T10:00:00Z', data: { art: 'foto', standort_id: 'node/5', standort_name: 'Tegel', details: 'Foto unpassend: photos/a.jpg\nGrund: Babybett, kein Slip' } },
    { id: 'r2', created_at: '2026-10-20T11:00:00Z', data: { art: 'foto', standort_id: 'node/5', details: 'Foto unpassend: photos/b.jpg\nGrund: passt doch' } },
    { id: 'r3', data: { art: 'preis', standort_id: 'node/8', details: 'Diesel 2 €' } }];
  const w = fakeWorld({ reports, overrides: [{ id: 'node/5', status: 'approved', photos: [{ url: 'photos/a.jpg', alt: 'Babybett' }, { url: 'photos/b.jpg', alt: 'Rampe' }] }],
    files: { 'public/photos/a.jpg': JPEG, 'public/photos/b.jpg': JPEG } });
  const m = (await (await run(req('GET', '?meldungen=1'), w)).json()).meldungen;
  assert.deepEqual(m.map(x => [x.id, x.foto, x.grund, x.veroeffentlicht]), [['r1', 'photos/a.jpg', 'Babybett, kein Slip', true], ['r2', 'photos/b.jpg', 'passt doch', true]]);
  assert.equal((await run(req('POST', '', { aktion: 'entfernen', standort_id: 'node/5', url: 'photos/a.jpg', meldung: 'r1' }), w)).status, 200);
  assert.deepEqual(w.state.deleted, ['r1']);
  assert.equal(w.jsonAt(HIST)[0].grund, 'Babybett, kein Slip');
  assert.equal((await run(req('POST', '', { aktion: 'meldung_verwerfen', id: 'r2' }), w)).status, 200);
  assert.deepEqual(w.state.deleted, ['r1', 'r2']);
  assert.deepEqual(w.jsonAt(OV)[0].photos.map(p => p.url), ['photos/b.jpg'], 'verworfene Meldung: Foto bleibt');
  assert.deepEqual(w.jsonAt(HIST).map(e => e.aktion), ['meldung verworfen', 'entfernt']);
  assert.equal((await run(req('POST', '', { aktion: 'meldung_verwerfen', id: 'r3' }), w)).status, 404, 'keine Foto-Meldung'); }

// Neue Slipanlagen
assert.equal(slug('Slip „Großer Müggelsee“ – Nord'), 'slip-grosser-muggelsee-nord');
{ const sub = { id: 'abcdef123456', created_at: '2026-10-19T08:00:00Z', data: { name: 'Slip Nord', gewaesser: 'Weser', lat: '52,20528', lon: '8.85582',
    zugang: 'oeffentlich', gebuehr: 'kostenpflichtig', gebuehr_betrag: '5 €', parkplatz: 'ja', trailerparkplatz: '', beschreibung: 'Betonrampe', kontakt: 'a@b.de' } };
  assert.deepEqual(slipFromSubmission(sub, '2026-10-20'), { id: 'c/slip-nord-20261019-123456', status: 'approved', type: 'slip', name: 'Slip Nord',
    lat: 52.20528, lon: 8.85582, water: { name: 'Weser', approx: false }, access: 'public', fee: true, fee_note: '5 €', description: 'Betonrampe',
    attrs: { parking: true, trailer_parking: null }, submitted: '2026-10-19', updated: '2026-10-20' });
  assert.throws(() => slipFromSubmission({ id: 'x', data: { name: 'A', lat: '', lon: '8' } }, '2026-10-20'), /Koordinaten/);
  const w = fakeWorld({ slips: [{ ...sub, data: { ...sub.data, foto: { url: 'https://files.netlify.example/s1/x.jpg' }, foto_rechte: 'ja' } },
    { id: 'z9', data: { name: 'Doppelt', lat: '52', lon: '8' } }], files: { 'public/data/community/places.json': '[]' } });
  const list = (await (await run(req('GET', '?form=slipanlage-melden'), w)).json()).slips;
  assert.deepEqual(list.map(x => [x.id, x.name, x.lat, x.hat_foto, x.rechte, x.kontakt]), [['abcdef123456', 'Slip Nord', 52.20528, true, true, 'a@b.de'], ['z9', 'Doppelt', 52, false, false, '']]);
  assert.equal((await run(req('GET', '?form=slipanlage-melden&bild=abcdef123456'), w)).headers.get('content-type'), 'image/jpeg');
  const r = await run(req('POST', '', { form: 'slipanlage-melden', aktion: 'freigeben', id: 'abcdef123456' }), w);
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual(w.state.messages, ['Slipanlage freigegeben: c/slip-nord-20261019-123456'], 'ein Commit');
  assert.equal(w.jsonAt('public/data/community/places.json')[0].id, 'c/slip-nord-20261019-123456');
  const ov = w.jsonAt(OV)[0];
  assert.equal(ov.id, 'c/slip-nord-20261019-123456'); assert.ok(w.file('public/' + ov.photos[0].url), 'Foto der Meldung übernommen');
  assert.deepEqual(w.jsonAt(HIST)[0], { zeit: NOW.toISOString(), bereich: 'slip', aktion: 'freigegeben', standort_id: 'c/slip-nord-20261019-123456', standort_name: 'Slip Nord', beschreibung: 'Weser · mit Foto' });
  assert.ok(!JSON.stringify(w.jsonAt(HIST)).includes('a@b.de'), 'keine E-Mail im Verlauf');
  assert.equal((await run(req('POST', '', { form: 'slipanlage-melden', aktion: 'ablehnen', id: 'z9' }), w)).status, 200);
  assert.deepEqual(w.state.deleted, ['abcdef123456', 'z9']);
  assert.deepEqual(w.state.messages.at(-1), 'Slipanlage abgelehnt: Doppelt');
  assert.equal(w.jsonAt('public/data/community/places.json').length, 1); }

// Preise
{ assert.throws(() => priceFromSubmission({ id: 'p', data: { tankstelle_id: '__other', kraftstoff: 'diesel', preis: '2' } }, '2026-10-20'), /nicht in der Liste/);
  assert.throws(() => priceFromSubmission({ id: 'p', data: { tankstelle_id: 'node/7', kraftstoff: 'diesel', preis: '25' } }, '2026-10-20'), /außerhalb/);
  assert.deepEqual(priceFromSubmission({ id: 'p', created_at: '2026-10-20T09:00:00Z', data: { tankstelle_id: 'node/7', kraftstoff: 'benzin', preis: '2,1899', datum: '2026-10-30' } }, '2026-10-20'),
    { station_id: 'node/7', fuel: 'petrol', price: 2.19, observed: '2026-10-20', status: 'approved', submitted: '2026-10-20' }, 'Datum nie in der Zukunft');
  const w = fakeWorld({ prices: [{ id: 'p1', created_at: '2026-10-20T09:00:00Z', data: { tankstelle_id: 'node/7000', tankstelle_name: 'Tanke', kraftstoff: 'diesel', preis: '2,189', datum: '2026-10-19', kommentar: 'Schild', beleg: { url: 'https://files.netlify.example/s1/x.jpg' } } },
    { id: 'p2', data: { tankstelle_id: '__other', tankstelle_name: 'Irgendwo', kraftstoff: 'diesel', preis: '2' } }], files: { 'public/data/community/prices.json': '[{"station_id":"node/7000","fuel":"diesel","price":2.1,"observed":"2026-10-01","status":"approved"}]' } });
  const list = (await (await run(req('GET', '?form=tankpreis-melden'), w)).json()).preise;
  assert.deepEqual(list.map(x => [x.id, x.preis, x.hat_beleg]), [['p1', 2.189, true], ['p2', 2, false]]);
  assert.equal((await run(req('GET', '?form=tankpreis-melden&bild=p1'), w)).status, 200, 'Belegfoto ansehbar');
  assert.equal((await run(req('POST', '', { form: 'tankpreis-melden', aktion: 'freigeben', id: 'p1' }), w)).status, 200);
  assert.deepEqual(w.jsonAt('public/data/community/prices.json').map(x => x.price), [2.1, 2.189], 'nur anhängen');
  assert.equal(w.jsonAt(HIST)[0].beschreibung, 'Diesel 2,189 €/l, beobachtet 2026-10-19');
  const bad = await run(req('POST', '', { form: 'tankpreis-melden', aktion: 'freigeben', id: 'p2' }), w);
  assert.equal(bad.status, 502); assert.deepEqual(w.state.deleted, ['p1'], 'unzuordenbarer Preis bleibt liegen');
  assert.equal((await run(req('POST', '', { form: 'tankpreis-melden', aktion: 'ablehnen', id: 'p2' }), w)).status, 200);
  assert.equal(w.state.messages.at(-1), 'Preis abgelehnt: __other'); }

// Hinweise (Fehler melden ohne Foto)
{ const w = fakeWorld({ reports: [
    { id: 'h1', created_at: '2026-10-20T10:00:00Z', data: { art: 'oeffnungszeiten', standort_id: 'node/5', standort_name: 'Hafen', details: 'Mo zu', kontakt: 'x@y.de' } },
    { id: 'r1', data: { art: 'foto', standort_id: 'node/5', details: 'Foto unpassend: photos/a.jpg\nGrund: x' } }] });
  const list = (await (await run(req('GET', '?form=fehler-melden'), w)).json()).hinweise;
  assert.deepEqual(list.map(x => [x.id, x.art_text, x.details, x.kontakt]), [['h1', 'Falsche Öffnungszeiten', 'Mo zu', 'x@y.de']], 'Foto-Meldungen nicht unter Hinweisen');
  assert.equal((await run(req('POST', '', { form: 'fehler-melden', aktion: 'erledigt', id: 'h1' }), w)).status, 200);
  assert.deepEqual(w.jsonAt(HIST)[0], { zeit: NOW.toISOString(), bereich: 'hinweis', aktion: 'erledigt', standort_id: 'node/5', standort_name: 'Hafen', beschreibung: 'Falsche Öffnungszeiten: Mo zu' });
  assert.equal(w.state.messages.at(-1), 'Hinweis erledigt: node/5');
  assert.equal((await run(req('POST', '', { form: 'unbekannt', aktion: 'erledigt', id: 'h1' }), w)).status, 400); }

console.log('fotos.mjs: alle Tests OK');

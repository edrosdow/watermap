// Foto-Verwaltung (Seite /admin/fotos.html): eingereichte Fotos freigeben oder ablehnen, gemeldete und veröffentlichte
// Fotos entfernen, als unpassend gemeldete Lagemeldungen („Heute vor Ort“) entfernen, Verlauf aller Aktionen.
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
import { getStore } from '@netlify/blobs';
import { meldungenApi } from '../lib/meldungen-kern.mjs';

const FORM = 'foto-einreichen';
const REPORT_FORM = 'fehler-melden';
const MAX_BYTES = 6 * 1024 * 1024;
const ID_RE = /^(node|way|relation|community|c)\/[A-Za-z0-9_-]{1,80}$/;
const OVERRIDES = 'public/data/community/overrides.json';
const HISTORY = 'admin/verlauf.json';
const PLACES = 'public/data/community/places.json';
const PRICES = 'public/data/community/prices.json';
const SLIP_FORM = 'slipanlage-melden', PRICE_FORM = 'tankpreis-melden', ERG_FORM = 'slip-ergaenzen';
const FILE_FIELD = { [FORM]: 'foto', [SLIP_FORM]: 'foto', [PRICE_FORM]: 'beleg' };   // Datei-Feld je Formular
const ACCESS = { oeffentlich: 'public', privat: 'private', kunden: 'customers' };
const YNU = { ja: true, nein: false };
const FUEL = { diesel: 'diesel', benzin: 'petrol' };
const PRICE_MIN = 0.5, PRICE_MAX = 5;
const ART = { 'existiert-nicht': 'Existiert nicht mehr', koordinaten: 'Falsche Koordinaten', 'nicht-oeffentlich': 'Nicht öffentlich',
  preis: 'Falscher Preis', oeffnungszeiten: 'Falsche Öffnungszeiten', foto: 'Unpassendes Foto', meldung: 'Unpassende Lagemeldung', sonstiges: 'Sonstiges' };
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

const text = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const num = (v) => { const n = Number(String(v ?? '').trim().replace(',', '.')); return String(v ?? '').trim() && Number.isFinite(n) ? n : null; };

export function slug(t) {
  return String(t || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'ohne-name';
}

/** Gemeldete Slipanlage → Eintrag für community/places.json (wie scripts/submissions_to_json.py, aber freigegeben). */
export function slipFromSubmission(sub, today) {
  const d = sub.data || {};
  const lat = num(d.lat), lon = num(d.lon);
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error('Koordinaten fehlen oder sind ungültig');
  const name = text(d.name, 120);
  const day = String(sub.created_at || today).slice(0, 10);
  const fee = text(d.gebuehr);
  return {
    id: `c/${slug(name)}-${day.replace(/-/g, '')}-${String(sub.id).replace(/[^A-Za-z0-9]/g, '').slice(-6) || 'x'}`,
    status: 'approved', type: 'slip', name: name || null,
    lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6,
    water: text(d.gewaesser, 120) ? { name: text(d.gewaesser, 120), approx: false } : null,
    access: ACCESS[text(d.zugang)] || null,
    fee: fee === 'kostenlos' ? false : fee === 'kostenpflichtig' ? true : null,
    fee_note: text(d.gebuehr_betrag, 80) || null,
    description: text(d.beschreibung, 1000) || null,
    attrs: { parking: YNU[text(d.parkplatz)] ?? null, trailer_parking: YNU[text(d.trailerparkplatz)] ?? null },
    submitted: day, updated: today,
  };
}

/** Preismeldung → Eintrag für community/prices.json (nur plausible Preise an bekannten Tankstellen). */
export function priceFromSubmission(sub, today) {
  const d = sub.data || {};
  const sid = text(d.tankstelle_id);
  if (!ID_RE.test(sid)) throw new Error('Tankstelle nicht in der Liste – nicht zuzuordnen');
  const price = num(d.preis), fuel = FUEL[text(d.kraftstoff)];
  if (!fuel) throw new Error('Kraftstoff ungültig');
  if (price === null || price < PRICE_MIN || price > PRICE_MAX) throw new Error(`Preis außerhalb ${PRICE_MIN}–${PRICE_MAX} €/l`);
  const observed = /^\d{4}-\d{2}-\d{2}/.test(text(d.datum)) ? text(d.datum).slice(0, 10) : today;
  return { station_id: sid, fuel, price: Math.round(price * 1000) / 1000, observed: observed > today ? today : observed,
    status: 'approved', submitted: String(sub.created_at || today).slice(0, 10) };
}

export function slipView(s) {
  const d = s.data || {};
  return { id: s.id, created: s.created_at || null, name: text(d.name, 120), gewaesser: text(d.gewaesser, 120), lat: num(d.lat), lon: num(d.lon),
    zugang: text(d.zugang), gebuehr: text(d.gebuehr), gebuehr_betrag: text(d.gebuehr_betrag, 80), parkplatz: text(d.parkplatz),
    trailerparkplatz: text(d.trailerparkplatz), beschreibung: text(d.beschreibung, 1000), kontakt: text(d.kontakt, 120),
    hat_foto: Boolean(fileUrl(d.foto)), rechte: Boolean(d.foto_rechte), dublette: Boolean(d.dublette_bestaetigt) };
}

export function priceView(s) {
  const d = s.data || {};
  return { id: s.id, created: s.created_at || null, tankstelle_id: text(d.tankstelle_id), tankstelle_name: text(d.tankstelle_name, 120),
    kraftstoff: text(d.kraftstoff), preis: num(d.preis), datum: text(d.datum, 10), kommentar: text(d.kommentar), hat_beleg: Boolean(fileUrl(d.beleg)) };
}

export function hintView(s) {
  const d = s.data || {};
  return { id: s.id, created: s.created_at || null, standort_id: text(d.standort_id), standort_name: text(d.standort_name, 120),
    art: text(d.art), art_text: ART[text(d.art)] || text(d.art), details: text(d.details, 1000), kontakt: text(d.kontakt, 120),
    meldung_id: text(d.art) === 'meldung' ? meldungIdAus(d.details) : null };
}

// „Angaben ergänzen“ (public/js/slip-ergaenzen.js): erlaubte Werte → Felder in community/overrides.json
const ERGAENZUNG = {
  access: { public: ['Öffentlich', { access: 'public' }], customers: ['Nur Kunden', { access: 'customers' }], members: ['Nur Mitglieder', { access: 'members' }], private: ['Privat', { access: 'private' }] },
  fee: { kostenlos: ['Kostenlos', { fee: false, fee_note: null }], kostenpflichtig: ['Kostenpflichtig', { fee: true }] },
  surface: Object.fromEntries(['Beton', 'Pflaster', 'Asphalt', 'Kies', 'Holz', 'Naturboden'].map(v => [v, [v, null, { surface: v }]])),
  incline: Object.fromEntries(['flach', 'mittel', 'steil'].map(v => [v, [v, null, { incline: v }]])),
  trailer: { ja: ['Ja, am Slip', null, { trailer_parking: true, trailer_note: 'am Slip' }], naehe: ['In der Nähe', null, { trailer_parking: true, trailer_note: 'in der Nähe' }],
    nein: ['Nein', null, { trailer_parking: false, trailer_note: null }] },
  motorboat: { ja: ['Erlaubt', null, { motorboat: true }], nein: ['Nicht erlaubt', null, { motorboat: false }] },
  boote: { bis5: ['bis 5 m', null, { suitable_boats: 'bis 5 m' }], bis7: ['bis 7 m', null, { suitable_boats: 'bis 7 m' }], bis9: ['bis 9 m', null, { suitable_boats: 'bis 9 m' }],
    groesser: ['größer als 9 m', null, { suitable_boats: 'größer als 9 m' }] },
};
const ERG_TITEL = { access: 'Zugang', fee: 'Gebühr', surface: 'Belag', incline: 'Neigung', trailer: 'Trailer parken', motorboat: 'Motorboote', boote: 'Bootsgröße' };

/** Angaben aus dem Formular prüfen → { fields, attrs, liste: [[Titel, Text]] }; Unbekanntes fällt weg. */
export function ergaenzungLesen(roh) {
  let a = {};
  try { a = JSON.parse(String(roh || '{}')); } catch { a = {}; }
  if (!a || typeof a !== 'object' || Array.isArray(a)) a = {};
  const fields = {}, attrs = {}, liste = [];
  for (const [k, tabelle] of Object.entries(ERGAENZUNG)) {
    const e = Object.hasOwn(tabelle, a[k]) ? tabelle[a[k]] : null;
    if (!e) continue;
    const [anzeige, f, at] = e;
    Object.assign(fields, f || {}); Object.assign(attrs, at || {});
    liste.push([ERG_TITEL[k], anzeige]);
  }
  if (fields.fee === true && typeof a.fee_note === 'string' && a.fee_note.trim()) {
    fields.fee_note = text(a.fee_note.replace(/[<>]/g, ''), 80);
    liste.push(['Betrag', fields.fee_note]);
  }
  return { fields, attrs, liste };
}

export function ergaenzungView(s) {
  const d = s.data || {};
  const e = ergaenzungLesen(d.angaben);
  return { id: s.id, created: s.created_at || null, standort_id: text(d.standort_id), standort_name: text(d.standort_name, 120),
    angaben: e.liste, bemerkung: text(d.bemerkung, 300), leer: !e.liste.length };
}

/** Ergänzung in overrides.json eintragen (bestehenden Eintrag des Standorts erweitern; null-Werte löschen ein Feld). */
export function ergaenzungEintragen(overrides, id, { fields, attrs }, today) {
  const list = Array.isArray(overrides) ? overrides.map(o => ({ ...o })) : [];
  let ov = list.find(o => o && o.id === id && o.status === 'approved');
  if (!ov) { ov = { id, status: 'approved' }; list.push(ov); }
  const setzen = (ziel, quelle) => {
    const neu = { ...(ov[ziel] || {}) };
    for (const [k, v] of Object.entries(quelle)) { if (v === null) delete neu[k]; else neu[k] = v; }
    if (Object.keys(neu).length) ov[ziel] = neu; else delete ov[ziel];
  };
  setzen('fields', fields); setzen('attrs', attrs);
  ov.updated = today;
  return list;
}

/** ID der Lagemeldung aus dem Hinweistext („Meldung-ID: 3f2a…“). */
export function meldungIdAus(details) {
  return String(details || '').match(/Meldung-ID:\s*([a-f0-9]{8,32})\b/)?.[1] || null;
}

export function submissionView(s) {
  const d = s.data || s;
  return {
    id: s.id, created: s.created_at || null,
    standort_id: String(d.standort_id || ''), standort_name: String(d.standort_name || ''),
    beschreibung: String(d.beschreibung || '').slice(0, 500), motiv: String(d.motiv || '').slice(0, 120), rechte: Boolean(d.foto_rechte),
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

export async function handle(req, { env, siteId, fetchFn = fetch, now = new Date(), meldungEntfernen = null }) {
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
          await history({ bereich: 'foto', aktion: 'entfernt', standort_id: body.standort_id, foto: path, beschreibung: alt,
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
        await history({ bereich: 'foto', aktion: 'meldung verworfen', standort_id: m.standort_id, foto: m.foto, grund: m.grund })(read)]);
      await nf(`/submissions/${report.id}`, { method: 'DELETE' });
      return json(200, { ok: true });
    }

    // Einreichungen eines Formulars: auflisten, Datei zeigen, freigeben/ablehnen/erledigen
    const formName = body.form || q.get('form') || FORM;
    if (![FORM, SLIP_FORM, PRICE_FORM, REPORT_FORM, ERG_FORM].includes(formName)) return json(400, { fehler: 'Unbekanntes Formular.' });
    const subs = await formSubmissions(nf, siteId, formName);
    if (req.method === 'GET' && q.has('bild')) {
      const sub = subs.find(s => s.id === q.get('bild'));
      const src = sub && FILE_FIELD[formName] && fileUrl((sub.data || {})[FILE_FIELD[formName]]);
      if (!src) return json(404, { fehler: 'Foto nicht gefunden.' });
      const res = await fetchFn(src);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const type = imageType(bytes);
      if (!res.ok || !type || bytes.length > MAX_BYTES) return json(422, { fehler: 'Datei ist kein gültiges Bild.' });
      return new Response(bytes, { headers: { 'content-type': type.mime, 'cache-control': 'no-store' } });
    }
    if (req.method === 'GET') {
      if (formName === SLIP_FORM) return json(200, { slips: subs.map(slipView) });
      if (formName === PRICE_FORM) return json(200, { preise: subs.map(priceView) });
      if (formName === REPORT_FORM) return json(200, { hinweise: subs.filter(s => !photoReport(s)).map(hintView) });
      if (formName === ERG_FORM) return json(200, { ergaenzungen: subs.map(ergaenzungView) });
      return json(200, { fotos: subs.map(submissionView) });
    }
    if (req.method !== 'POST') return json(405, { fehler: 'Nicht erlaubt.' });
    const sub = subs.find(s => s.id === body.id);
    if (!sub) return json(404, { fehler: 'Einreichung nicht gefunden (schon erledigt?).' });
    const d = sub.data || {};
    const finish = async (message, files) => {
      await commitChanges(gh, branch, message, files);
      await nf(`/submissions/${sub.id}`, { method: 'DELETE' });
    };

    if (formName === SLIP_FORM) {
      if (body.aktion === 'freigeben') {
        const place = slipFromSubmission(sub, today);
        // Foto aus der Meldung nur mit bestätigten Rechten übernehmen
        const pic = fileUrl(d.foto) && d.foto_rechte ? await fetchPhoto(sub, fetchFn) : null;
        const name = pic ? `${place.id.replace('/', '-')}-${now.getTime().toString(36)}.${pic.type.ext}` : null;
        await finish(`Slipanlage freigegeben: ${place.id}`, async (read) => {
          const places = await read(PLACES, []);
          if (places.some(x => x && x.id === place.id)) throw new Error('Diese Slipanlage ist schon eingetragen.');
          return [jsonFile(PLACES, [...places, place]),
            ...(pic ? [{ path: `public/photos/${name}`, content: pic.bytes },
              jsonFile(OVERRIDES, addPhoto(await read(OVERRIDES, []), place.id, { url: `photos/${name}`, credit: 'WaterMap-Community', alt: text(d.beschreibung, 200) }, today))] : []),
            await history({ bereich: 'slip', aktion: 'freigegeben', standort_id: place.id, standort_name: place.name || '',
              beschreibung: [place.water?.name, pic ? 'mit Foto' : (fileUrl(d.foto) ? 'Foto ohne Rechte nicht übernommen' : '')].filter(Boolean).join(' · ') })(read)];
        });
        return json(200, { ok: true, standort_id: place.id });
      }
      if (body.aktion === 'ablehnen') {
        await finish(`Slipanlage abgelehnt: ${text(d.name, 60) || 'ohne Namen'}`, async (read) => [
          await history({ bereich: 'slip', aktion: 'abgelehnt', standort_id: '', standort_name: text(d.name, 120), beschreibung: text(d.gewaesser, 120) })(read)]);
        return json(200, { ok: true });
      }
    }
    if (formName === PRICE_FORM) {
      const label = `${text(d.kraftstoff) === 'benzin' ? 'Benzin' : 'Diesel'} ${text(d.preis, 10)} €/l`;
      if (body.aktion === 'freigeben') {
        const entry = priceFromSubmission(sub, today);
        await finish(`Preis freigegeben: ${entry.station_id}`, async (read) => [
          jsonFile(PRICES, [...await read(PRICES, []), entry]),
          await history({ bereich: 'preis', aktion: 'freigegeben', standort_id: entry.station_id, standort_name: text(d.tankstelle_name, 120),
            beschreibung: `${label}, beobachtet ${entry.observed}` })(read)]);
        return json(200, { ok: true });
      }
      if (body.aktion === 'ablehnen') {
        await finish(`Preis abgelehnt: ${text(d.tankstelle_id) || 'ohne Tankstelle'}`, async (read) => [
          await history({ bereich: 'preis', aktion: 'abgelehnt', standort_id: text(d.tankstelle_id), standort_name: text(d.tankstelle_name, 120), beschreibung: label })(read)]);
        return json(200, { ok: true });
      }
    }
    // Angaben zu einer Slipanlage übernehmen (→ overrides.json) oder ablehnen
    if (formName === ERG_FORM && (body.aktion === 'uebernehmen' || body.aktion === 'ablehnen')) {
      const v = ergaenzungView(sub);
      if (body.aktion === 'uebernehmen') {
        const e = ergaenzungLesen(d.angaben);
        if (!ID_RE.test(v.standort_id)) return json(400, { fehler: 'Standort-ID fehlt oder ist ungültig.' });
        if (!e.liste.length) return json(400, { fehler: 'Keine Angaben zum Übernehmen.' });
        await finish(`Angaben übernommen: ${v.standort_id}`, async (read) => [
          jsonFile(OVERRIDES, ergaenzungEintragen(await read(OVERRIDES, []), v.standort_id, e, today)),
          await history({ bereich: 'ergaenzung', aktion: 'übernommen', standort_id: v.standort_id, standort_name: v.standort_name,
            beschreibung: e.liste.map(([t, w]) => `${t}: ${w}`).join(', ').slice(0, 300) })(read)]);
        return json(200, { ok: true });
      }
      await finish(`Angaben abgelehnt: ${v.standort_id || 'ohne Standort'}`, async (read) => [
        await history({ bereich: 'ergaenzung', aktion: 'abgelehnt', standort_id: v.standort_id, standort_name: v.standort_name,
          beschreibung: v.angaben.map(([t, w]) => `${t}: ${w}`).join(', ').slice(0, 300) })(read)]);
      return json(200, { ok: true });
    }
    // Als unpassend gemeldete Lagemeldung entfernen (ist sie schon abgelaufen, wird nur der Hinweis erledigt)
    if (formName === REPORT_FORM && body.aktion === 'lagemeldung_entfernen') {
      const v = hintView(sub);
      if (!v.meldung_id) return json(400, { fehler: 'Hinweis enthält keine Meldung-ID.' });
      if (!meldungEntfernen) return json(503, { fehler: 'Meldungen sind hier nicht erreichbar.' });
      const r = await meldungEntfernen(v.meldung_id, now.getTime());
      await finish(`Lagemeldung entfernt: ${v.standort_id || r.standortId || v.meldung_id}`, async (read) => [
        await history({ bereich: 'hinweis', aktion: r.entfernt ? 'lagemeldung entfernt' : 'lagemeldung war schon abgelaufen', standort_id: v.standort_id,
          standort_name: v.standort_name, beschreibung: `${v.art_text}: ${v.details}`.slice(0, 300) })(read)]);
      return json(200, { ok: true, entfernt: r.entfernt });
    }
    if (formName === REPORT_FORM && (body.aktion === 'erledigt' || body.aktion === 'verwerfen')) {
      const v = hintView(sub);
      await finish(`Hinweis ${body.aktion === 'erledigt' ? 'erledigt' : 'verworfen'}: ${v.standort_id || 'ohne Standort'}`, async (read) => [
        await history({ bereich: 'hinweis', aktion: body.aktion === 'erledigt' ? 'erledigt' : 'verworfen', standort_id: v.standort_id,
          standort_name: v.standort_name, beschreibung: `${v.art_text}: ${v.details}`.slice(0, 300) })(read)]);   // ohne E-Mail
      return json(200, { ok: true });
    }
    if (formName !== FORM) return json(400, { fehler: 'Unbekannte Aktion.' });

    if (body.aktion === 'freigeben') {
      // Standort nachtragen, wenn bei der Einreichung „Anderer Standort“ gewählt wurde
      const standort = body.standort ? standortAus(body.standort) : null;
      if (body.standort && !standort) return json(400, { fehler: 'Standort nicht erkannt – Link aus der App (…#p=node/123) oder ID einfügen.' });
      const id = standort || String(d.standort_id || '');
      if (!ID_RE.test(id)) throw new Error('Standort-ID fehlt oder ist ungültig');
      const { bytes, type } = await fetchPhoto(sub, fetchFn);
      const name = `${id.replace('/', '-')}-${now.getTime().toString(36)}.${type.ext}`;
      const photo = { url: `photos/${name}`, credit: 'WaterMap-Community', alt: (String(d.beschreibung || '').trim() || String(d.motiv || '').trim()).slice(0, 200) };   // ohne Notiz: Motiv, z. B. „Rampe, Steg“
      await finish(`Foto freigegeben: ${id}`, async (read) => [
        { path: `public/photos/${name}`, content: bytes },
        jsonFile(OVERRIDES, addPhoto(await read(OVERRIDES, []), id, photo, today)),
        await history({ bereich: 'foto', aktion: 'freigegeben', standort_id: id, standort_name: String(d.standort_name || ''), foto: photo.url, beschreibung: photo.alt })(read)]);
      return json(200, { ok: true, foto: photo, standort_id: id });
    }
    if (body.aktion === 'ablehnen') {
      await finish(`Foto abgelehnt: ${d.standort_id || 'ohne Standort'}`, async (read) => [
        await history({ bereich: 'foto', aktion: 'abgelehnt', standort_id: String(d.standort_id || ''), standort_name: String(d.standort_name || ''),
          beschreibung: String(d.beschreibung || '').slice(0, 200) })(read)]);
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

// Lagemeldungen liegen im selben Speicher wie bei /api/meldungen (Vorschauen: „meldungen-vorschau“)
const kontext = () => globalThis.Netlify?.env?.get?.('CONTEXT') || process.env.CONTEXT || '';
const meldungEntfernen = (id, jetzt) => meldungenApi({
  store: getStore(kontext() && kontext() !== 'production' ? 'meldungen-vorschau' : 'meldungen'), jetzt: () => jetzt,
}).entfernen(id);

export default async (req, context) => handle(req, { env: runtimeEnv(), siteId: context?.site?.id || process.env.SITE_ID, meldungEntfernen });

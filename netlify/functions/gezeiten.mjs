// Gezeitenvorhersage des BSH für einen PEGELONLINE-Pegel (nur serverseitig abgerufen, nie direkt vom Browser).
// Aufruf: GET /api/gezeiten?pegel=<PEGELONLINE-UUID>&nr=<Pegelnummer>   → Vorhersage (siehe gezeiten-kern.mjs)
//         GET /api/gezeiten?orte=1                                       → Pegel mit BSH-Vorhersage (für die App und die Prüfliste)
// Zwischenspeicher: Ortsliste 24 h (Netlify Blobs + Speicher), Vorhersage 1 h im Netlify-CDN.
// Abschalten ohne neuen Deploy: Umgebungsvariable GEZEITEN_BSH_AUS=1. Kontakt im User-Agent: WATERMAP_KONTAKT.
import { getStore } from '@netlify/blobs';
import { API, orte, ortFinden, aufbereiten } from '../lib/gezeiten-kern.mjs';

const TIMEOUT_MS = 8000;
const ORTE_MS = 24 * 3600e3;
const USER_AGENT = (env) => `WaterMap/1.0 (+https://watermaps.netlify.app; Gezeitenvorhersage${env.WATERMAP_KONTAKT ? `; ${env.WATERMAP_KONTAKT}` : ''})`;

const json = (status, body, sekunden = 0) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': sekunden ? `public, max-age=${Math.min(sekunden, 900)}` : 'no-store',
    ...(sekunden ? { 'netlify-cdn-cache-control': `public, durable, s-maxage=${sekunden}, stale-while-revalidate=1800` } : {}),
  },
});

async function holen(fetchFn, url, ua) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetchFn(url, { signal: ctl.signal, headers: { 'User-Agent': ua, Accept: 'application/geo+json, application/json' } });
    if (!r.ok) { const e = new Error(`BSH antwortet mit ${r.status}`); e.status = r.status; throw e; }
    return await r.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('BSH antwortet nicht (Zeitüberschreitung)');
    throw e;
  } finally { clearTimeout(timer); }
}

/** Alle Orte seitenweise (höchstens 100 je Seite); erst nur mit den nötigen Feldern, sonst vollständig. */
export async function orteLaden(fetchFn, ua) {
  for (const felder of ['&properties=gauge_label,operator_gauge_id,measurement_url,region', '']) {
    try {
      const alle = [];
      let url = `${API}?f=json&limit=100${felder}`;
      for (let seite = 0; url && seite < 5; seite++) {
        const j = await holen(fetchFn, url, ua);
        alle.push(...orte(j.features));
        url = (j.links || []).find(l => l.rel === 'next')?.href || null;
      }
      if (alle.length) return alle;
    } catch (e) { if (e.status !== 400 || !felder) throw e; }
  }
  throw new Error('BSH liefert keine Orte');
}

let speicher = null;   // { zeit, liste } – hält, solange die Funktion warm ist
async function orteHolen({ fetchFn, ua, store, jetzt }) {
  if (speicher && jetzt - speicher.zeit < ORTE_MS) return speicher.liste;
  try {
    const b = await store?.get('orte', { type: 'json' });
    if (b && jetzt - b.zeit < ORTE_MS && Array.isArray(b.liste)) { speicher = b; return b.liste; }
  } catch { /* ohne Blobs weiter */ }
  const liste = await orteLaden(fetchFn, ua);
  speicher = { zeit: jetzt, liste };
  try { await store?.setJSON('orte', speicher); } catch { /* nur im Speicher */ }
  return liste;
}
export const _zuruecksetzen = () => { speicher = null; };

export async function handle(req, { fetchFn = fetch, env = {}, store = null, jetzt = Date.now() } = {}) {
  if (req.method !== 'GET') return json(405, { fehler: 'Nur GET.' });
  if (/^(1|ja|true)$/i.test(env.GEZEITEN_BSH_AUS || '')) return json(503, { aus: true, fehler: 'Gezeitenvorhersage ist abgeschaltet.' });
  const q = new URL(req.url).searchParams;
  const ua = USER_AGENT(env);
  let liste;
  try { liste = await orteHolen({ fetchFn, ua, store, jetzt }); }
  catch (e) { return json(502, { fehler: `Gezeitenvorhersage nicht erreichbar: ${e.message}` }); }
  if (q.get('orte')) return json(200, { orte: liste.map(o => ({ id: o.id, name: o.name, nr: o.nr, uuid: o.uuid })) }, 6 * 3600);
  const pegel = q.get('pegel') || '', nr = q.get('nr') || '';
  if (!/^[0-9a-f-]{36}$/i.test(pegel) && !/^\d{3,9}$/.test(nr)) return json(400, { fehler: 'pegel (UUID) oder nr fehlt.' });
  const id = ortFinden(liste, { pegel, nr });
  if (!id) return json(404, { keinOrt: true, fehler: 'Für diesen Pegel gibt es keine BSH-Vorhersage.' }, 24 * 3600);
  try {
    const j = await holen(fetchFn, `${API}/${encodeURIComponent(id)}?f=json`, ua);
    const d = aufbereiten(id, j.properties || {}, jetzt);
    if (!d.ereignisse.length && !d.kurve.length) return json(502, { fehler: 'BSH liefert für diesen Ort gerade keine Vorhersage.' });
    return json(200, d, 3600);
  } catch (e) { return json(502, { fehler: `Gezeitenvorhersage nicht erreichbar: ${e.message}` }); }
}

function runtimeEnv() {
  const nenv = globalThis.Netlify?.env;
  return Object.fromEntries(['GEZEITEN_BSH_AUS', 'WATERMAP_KONTAKT'].map(k => [k, nenv?.get?.(k) || process.env[k] || '']));
}
function blobs() { try { return getStore('gezeiten'); } catch { return null; } }

export default (req) => handle(req, { env: runtimeEnv(), store: blobs() });
export const config = { path: '/api/gezeiten' };

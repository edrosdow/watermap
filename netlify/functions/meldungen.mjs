// „Heute vor Ort“: Lagemeldungen lesen, abgeben, bestätigen. Logik: ../lib/meldungen-kern.mjs.
//   GET  /api/meldungen?standort=<id>          aktive Meldungen eines Standorts
//   GET  /api/meldungen/aktiv                  kompakte Liste (Standort-ID, Anzahl, wichtigster Typ)
//   POST /api/meldungen                        { standortId, typ, notiz }
//   POST /api/meldungen/<id>/bestaetigen       { stimmt: true|false }
// Gerät: Kopfzeile „x-geraet“ (zufällige ID aus dem Browser). IP nur gesalzen gehasht (MELDUNG_SALZ).
//
// Einstellung (Netlify → Site configuration → Environment variables):
//   MELDUNG_SALZ   langer Zufallswert, als „Secret“ markiert (ohne ihn nimmt der Server keine Meldungen an)
// Vorschauen speichern in einem eigenen Bereich („meldungen-vorschau“), damit Tests nicht live erscheinen.
import { getStore } from '@netlify/blobs';
import { meldungenApi, Fehler } from '../lib/meldungen-kern.mjs';

export const config = { path: ['/api/meldungen', '/api/meldungen/*'] };

const json = (status, body, cache = 'no-store') => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8', 'cache-control': cache === 'no-store' ? 'no-store' : 'public, max-age=0, must-revalidate',
    ...(cache !== 'no-store' ? { 'netlify-cdn-cache-control': cache } : {}),
  },
});

// Gültige Standort-IDs aus den veröffentlichten Daten (einmal je Funktions-Instanz, eine Stunde lang)
let ids = null, idsAt = 0;
export function standortPruefer(origin, fetchFn = fetch) {
  return async (id) => {
    if (!ids || Date.now() - idsAt > 3600e3) {
      const holen = async (p) => { const r = await fetchFn(`${origin}/data/${p}`); if (!r.ok) throw new Error(`${p}: ${r.status}`); return r.json(); };
      const meta = await holen('meta.json').catch(() => null);
      const osm = meta?.files?.osm || ['osm/slip.geojson', 'osm/marina.geojson', 'osm/fuel.geojson'];
      const set = new Set();
      for (const f of osm) for (const ft of (await holen(f)).features || []) if (ft?.id) set.add(String(ft.id));
      const com = await holen(meta?.files?.community?.places || 'community/places.json').catch(() => []);
      for (const r of Array.isArray(com) ? com : []) if (r?.status === 'approved' && r.id) set.add(String(r.id));
      ids = set; idsAt = Date.now();
    }
    return ids.has(id);
  };
}

export async function handle(req, { store, salz, ip, jetzt = () => Date.now(), standortGibtEs, neueId }) {
  const u = new URL(req.url);
  const pfad = u.pathname.replace(/\/+$/, '');
  const api = meldungenApi({
    store, salz, jetzt,
    standortGibtEs: standortGibtEs || standortPruefer(u.origin),
    neueId: neueId || (() => crypto.randomUUID().replace(/-/g, '').slice(0, 16)),
  });
  const wer = { geraet: req.headers.get('x-geraet') || '', ip };
  try {
    if (req.method === 'GET' && pfad === '/api/meldungen/aktiv') {
      return json(200, { aktiv: await api.aktiv(), zeit: jetzt() }, 'public, s-maxage=60, stale-while-revalidate=30');
    }
    if (req.method === 'GET' && pfad === '/api/meldungen') {
      return json(200, { meldungen: await api.standort(u.searchParams.get('standort') || ''), zeit: jetzt() });
    }
    if (req.method !== 'POST') return json(405, { fehler: 'Methode nicht erlaubt.' });
    if (!salz) return json(503, { fehler: 'Meldungen sind noch nicht eingerichtet.' });
    if ((req.headers.get('content-length') | 0) > 4000) return json(413, { fehler: 'Anfrage zu groß.' });
    let body;
    try { body = await req.json(); } catch { return json(400, { fehler: 'Ungültige Anfrage.' }); }
    if (!body || typeof body !== 'object') return json(400, { fehler: 'Ungültige Anfrage.' });
    if (pfad === '/api/meldungen') return json(201, await api.melden(body, wer));
    const m = pfad.match(/^\/api\/meldungen\/([a-f0-9]{8,32})\/bestaetigen$/);
    if (m) return json(200, await api.bestaetigen(m[1], body.stimmt, wer));
    return json(404, { fehler: 'Unbekannte Adresse.' });
  } catch (e) {
    if (e instanceof Fehler) return json(e.status, { fehler: e.message });
    console.error(e);
    return json(502, { fehler: 'Das hat gerade nicht geklappt. Bitte später erneut versuchen.' });
  }
}

const env = (k) => globalThis.Netlify?.env?.get?.(k) || process.env[k] || '';
export const storeName = () => (env('CONTEXT') && env('CONTEXT') !== 'production' ? 'meldungen-vorschau' : 'meldungen');

export default async (req, context) => handle(req, {
  store: getStore(storeName()), salz: env('MELDUNG_SALZ'),
  ip: context?.ip || req.headers.get('x-nf-client-connection-ip') || '',
});

// Pegel-Alarm als Push: öffentlicher VAPID-Schlüssel (GET) sowie Anmelden, Abmelden und Liste je Gerät (POST, JSON).
// Die stündliche Prüfung steckt in pegel-alarm-pruefen.mjs, die Logik in ../lib/pegel-push-kern.mjs.
//
// Einstellungen (Netlify → Site configuration → Environment variables), erzeugt mit `node scripts/vapid-schluessel.mjs`:
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY   Schlüsselpaar für Web Push
//   VAPID_SUBJECT                         Kontakt für die Push-Dienste, z. B. mailto:info@deine-domain.de
import { getStore } from '@netlify/blobs';
import { anmelden, abmelden, liste } from '../lib/pegel-push-kern.mjs';
import { runtimeEnv } from './pegel-alarm.mjs';

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

export async function handle(req, { store, env, fetchFn = fetch, now = Date.now() }) {
  const bereit = env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT;
  if (req.method === 'GET') return bereit ? json(200, { publicKey: env.VAPID_PUBLIC_KEY }) : json(503, { fehler: 'Push ist noch nicht eingerichtet.' });
  if (req.method !== 'POST') return json(405, { fehler: 'Nur GET oder POST.' });
  if (!bereit) return json(503, { fehler: 'Push ist noch nicht eingerichtet. Bitte die E-Mail wählen.' });
  let body;
  try { body = await req.json(); } catch { return json(400, { fehler: 'Ungültige Anfrage.' }); }
  if (!body || typeof body !== 'object') return json(400, { fehler: 'Ungültige Anfrage.' });
  try {
    let r;
    if (body.aktion === 'anmelden') r = await anmelden({ store, fetchFn, now }, body);
    else if (body.aktion === 'abmelden') r = await abmelden({ store }, body);
    else if (body.aktion === 'liste') r = await liste({ store }, body);
    else return json(400, { fehler: 'Unbekannte Aktion.' });
    return json(r.status, r);
  } catch (e) {
    return json(502, { fehler: 'Das hat gerade nicht geklappt. Bitte später erneut versuchen.', detail: e.message });
  }
}

export default async (req) => handle(req, { store: getStore('pegel-alarm'), env: runtimeEnv() });

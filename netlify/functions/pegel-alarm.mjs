// Pegel-Alarm: Anmeldung, Bestätigung (Double-Opt-in) und Abmeldung. Aufruf nur von /pegel-ampel (POST, JSON).
// Die stündliche Prüfung steckt in pegel-alarm-pruefen.mjs, die Logik in ../lib/pegel-alarm-kern.mjs.
//
// Einstellungen (Netlify → Site configuration → Environment variables):
//   BREVO_API_KEY        Brevo → SMTP & API → API-Schlüssel (kostenlos bis 300 Mails/Tag)
//   ALARM_ABSENDER       bei Brevo bestätigte Absender-Adresse
//   optional ALARM_ABSENDER_NAME (Standard „WaterMap Pegel-Alarm“)
import { getStore } from '@netlify/blobs';
import { anmelden, bestaetigen, abmelden, brevoSender } from '../lib/pegel-alarm-kern.mjs';

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

export async function handle(req, { store, env, fetchFn = fetch, send, now = Date.now() }) {
  if (req.method !== 'POST') return json(405, { fehler: 'Nur POST.' });
  let body;
  try { body = await req.json(); } catch { return json(400, { fehler: 'Ungültige Anfrage.' }); }
  if (!body || typeof body !== 'object') return json(400, { fehler: 'Ungültige Anfrage.' });
  try {
    if (body.aktion === 'anmelden') {
      if (body.website) return json(200, { ok: true });                // Honigtopf-Feld: von Bots ausgefüllt
      const fehlt = ['BREVO_API_KEY', 'ALARM_ABSENDER'].filter(k => !env[k]);
      if (fehlt.length) return json(503, { fehler: `Der E-Mail-Alarm ist noch nicht eingerichtet (fehlt: ${fehlt.join(', ')}).` });
      const r = await anmelden({ store, fetchFn, send: send || brevoSender(env, fetchFn), now, basis: new URL(req.url).origin }, body);
      return json(r.status, r);
    }
    if (body.aktion === 'bestaetigen') { const r = await bestaetigen({ store, now }, body.token); return json(r.status, r); }
    if (body.aktion === 'abmelden') { const r = await abmelden({ store }, body.token); return json(r.status, r); }
    return json(400, { fehler: 'Unbekannte Aktion.' });
  } catch (e) {
    return json(502, { fehler: 'Das hat gerade nicht geklappt. Bitte später erneut versuchen.', detail: e.message });
  }
}

const KEYS = ['BREVO_API_KEY', 'ALARM_ABSENDER', 'ALARM_ABSENDER_NAME'];
export function runtimeEnv() {
  // Netlify.env kennt auch als „Secret“ markierte Werte; process.env als Rückfall
  const nenv = globalThis.Netlify?.env;
  return Object.fromEntries(KEYS.map(k => [k, nenv?.get?.(k) || process.env[k] || '']));
}

export default async (req) => handle(req, { store: getStore('pegel-alarm'), env: runtimeEnv() });

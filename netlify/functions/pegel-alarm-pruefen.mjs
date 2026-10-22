// Pegel-Alarm: stündliche Prüfung aller bestätigten Alarme (Netlify Scheduled Function).
// Läuft nur auf der veröffentlichten Seite, nicht in Deploy-Vorschauen. Logik: ../lib/pegel-alarm-kern.mjs.
import { getStore } from '@netlify/blobs';
import { pruefen, brevoSender } from '../lib/pegel-alarm-kern.mjs';
import { runtimeEnv } from './pegel-alarm.mjs';

export const config = { schedule: '@hourly' };

export default async () => {
  const env = runtimeEnv();
  if (!env.BREVO_API_KEY || !env.ALARM_ABSENDER) { console.log('Pegel-Alarm nicht eingerichtet'); return; }
  const basis = (globalThis.Netlify?.env?.get?.('URL') || process.env.URL || 'https://watermaps.netlify.app').replace(/\/$/, '');
  const r = await pruefen({ store: getStore('pegel-alarm'), fetchFn: fetch, send: brevoSender(env, fetch), now: Date.now(), basis, log: console.log });
  console.log(`Pegel-Alarm: ${r.alarme ?? 0} aktive Alarme, ${r.mails} Mails`);
};

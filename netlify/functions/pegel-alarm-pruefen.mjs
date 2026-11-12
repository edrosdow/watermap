// Pegel-Alarm: stündliche Prüfung aller Alarme (Netlify Scheduled Function) – E-Mail (Ampel- und Schwellen-Alarme) und Push.
// Läuft nur auf der veröffentlichten Seite, nicht in Deploy-Vorschauen. Logik: ../lib/pegel-alarm-kern.mjs, ../lib/pegel-push-kern.mjs.
import { getStore } from '@netlify/blobs';
import webpush from 'web-push';
import { pruefen, brevoSender } from '../lib/pegel-alarm-kern.mjs';
import { pruefenPush, PUSH_TTL_S } from '../lib/pegel-push-kern.mjs';
import { runtimeEnv } from './pegel-alarm.mjs';

export const config = { schedule: '@hourly' };

export default async () => {
  const env = runtimeEnv(), store = getStore('pegel-alarm'), now = Date.now();
  const basis = (globalThis.Netlify?.env?.get?.('URL') || process.env.URL || 'https://watermaps.netlify.app').replace(/\/$/, '');
  if (env.BREVO_API_KEY && env.ALARM_ABSENDER) {
    const r = await pruefen({ store, fetchFn: fetch, send: brevoSender(env, fetch), now, basis, log: console.log });
    console.log(`Pegel-Alarm E-Mail: ${r.alarme ?? 0} aktive Alarme, ${r.mails} Mails`);
  } else console.log('Pegel-Alarm E-Mail nicht eingerichtet');
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT) {
    webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
    const r = await pruefenPush({ store, fetchFn: fetch, now, log: console.log,
      sendePush: (abo, nutzlast) => webpush.sendNotification(abo, nutzlast, { TTL: PUSH_TTL_S, urgency: 'normal' }) });
    console.log(`Pegel-Alarm Push: ${r.alarme} Alarme, ${r.gesendet} gesendet, ${r.geloescht} abgelaufene gelöscht`);
  } else console.log('Pegel-Alarm Push nicht eingerichtet');
};

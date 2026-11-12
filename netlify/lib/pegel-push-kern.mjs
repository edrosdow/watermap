// Pegel-Alarm mit Schwelle („unter/über X cm“) – Push (Web Push, VAPID) und gemeinsame Bewertung für Push und E-Mail.
// Speicher (Netlify Blobs, Store „pegel-alarm“), PEGELONLINE und der Versand sind injizierbar (tests/pegel_push_test.mjs).
//
// Gespeichert wird je Push-Alarm nur, was zum Senden nötig ist: Push-Adresse (Endpoint) und ihre Schlüssel, Pegel,
// Richtung und Wert, Zeitpunkte, letzter Zustand. Kein Name, keine E-Mail, keine IP-Adresse.
import { createHash } from 'node:crypto';
import { PEGEL_API, PEGEL_RE, pegelStammdaten, pegelJetzt } from './pegel-alarm-kern.mjs';
import { trend } from '../../public/js/ampel-logik.js';
import { vorhersageSatz } from '../../public/js/pegel-vorhersage.js';

export const RICHTUNGEN = ['unter', 'ueber'];
export const MAX_ALARME_JE_GERAET = 10;
export const PUSH_TTL_S = 6 * 3600;   // eine Nachricht, die 6 h nicht zugestellt werden konnte, ist veraltet
const tag = (now) => new Date(now).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });   // JJJJ-MM-TT in deutscher Zeit
const geraet = (endpoint) => createHash('sha256').update(endpoint).digest('hex').slice(0, 32);
export const pushSchluessel = (endpoint, pegel) => `push/${geraet(endpoint)}-${pegel}`;

/** Prüft Richtung und Wert einer Schwelle; Fehlertext oder null. */
export function schwelleFehler({ richtung, wert }) {
  if (!RICHTUNGEN.includes(richtung)) return 'Bitte „unter“ oder „über“ wählen.';
  if (!Number.isInteger(wert) || wert < -500 || wert > 2000) return 'Bitte einen Wert in cm eingeben.';
  return null;
}

/**
 * Entprellung (Push und E-Mail): höchstens eine Nachricht pro Tag und Alarm; nach einer Nachricht erst wieder, wenn der
 * Pegel zwischendurch auf die andere Seite der Schwelle zurückgekehrt ist (das setzt zurück).
 * a: { richtung, wert, zustand?: 'frei' | 'ausgeloest', letzteNachricht? } → { senden, neu }
 */
export function schwelleBewerten(a, wert, now) {
  const erfuellt = a.richtung === 'unter' ? wert < a.wert : wert > a.wert;
  if (!erfuellt) return { senden: false, neu: a.zustand === 'frei' ? a : { ...a, zustand: 'frei' } };
  if (a.zustand === 'ausgeloest') return { senden: false, neu: a };
  if (a.letzteNachricht && tag(a.letzteNachricht) === tag(now)) return { senden: false, neu: a };   // heute schon benachrichtigt
  return { senden: true, neu: { ...a, zustand: 'ausgeloest', letzteNachricht: now } };
}

const TREND_WORT = { steigend: 'steigend', fallend: 'fallend', gleich: 'gleichbleibend' };
/** Inhalt der Nachricht: Titel „Minden unter 100 cm“, Text „Aktuell 96 cm, fallend. Vorhersage: …“, Ziel: Pegel-Fenster. */
export function nachricht({ a, wert, punkte = [], satz = null }) {
  const tr = trend(punkte);
  const cm = Math.round(wert).toLocaleString('de-DE');
  return {
    title: `${a.pegelName} ${a.richtung === 'unter' ? 'unter' : 'über'} ${a.wert.toLocaleString('de-DE')} cm`,
    body: [`Aktuell ${cm} cm${tr ? `, ${TREND_WORT[tr.richtung]}` : ''}.`, satz].filter(Boolean).join(' '),
    url: `/#pf=${encodeURIComponent(a.pegel)}`,
    tag: `pegel-${a.pegel}`,
  };
}

/** Vorhersage-Satz für die Nachricht (nur wenn der Pegel eine Vorhersage und Kennwerte liefert), sonst null. */
export async function satzFuer(fetchFn, a, wert, now) {
  try {
    const [w, wv] = await Promise.all([
      fetchFn(`${PEGEL_API}stations/${encodeURIComponent(a.pegel)}/W.json?includeCharacteristicValues=true`, { headers: { accept: 'application/json' } }),
      fetchFn(`${PEGEL_API}stations/${encodeURIComponent(a.pegel)}/WV/measurements.json`, { headers: { accept: 'application/json' } }),
    ]);
    if (!w.ok || !wv.ok) return null;
    const refs = {};
    for (const c of (await w.json())?.characteristicValues || []) if (['MNW', 'MW', 'MHW', 'HSW'].includes(c?.shortname) && typeof c.value === 'number') refs[c.shortname] = c.value;
    const pts = ((await wv.json()) || []).map(m => ({ t: Date.parse(m.timestamp), v: m.value })).filter(p => Number.isFinite(p.t) && typeof p.v === 'number');
    return vorhersageSatz({ value: wert, refs }, pts, now);
  } catch { return null; }
}

// ------------------------------------------------------------------ Anmelden, Abmelden, Liste (je Gerät)
function abo(subscription) {
  const s = subscription || {};
  const ok = typeof s.endpoint === 'string' && /^https:\/\//.test(s.endpoint) && s.endpoint.length <= 1000
    && typeof s.keys?.p256dh === 'string' && s.keys.p256dh.length <= 200 && typeof s.keys?.auth === 'string' && s.keys.auth.length <= 100;
  return ok ? { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } } : null;
}

export async function anmelden({ store, fetchFn, now }, { subscription, pegel, richtung, wert }) {
  const sub = abo(subscription);
  if (!sub) return { status: 400, fehler: 'Push wird von diesem Gerät nicht unterstützt.' };
  if (!PEGEL_RE.test(String(pegel || ''))) return { status: 400, fehler: 'Bitte zuerst einen Pegel wählen.' };
  wert = Number(wert);
  const f = schwelleFehler({ richtung, wert });
  if (f) return { status: 400, fehler: f };
  const key = pushSchluessel(sub.endpoint, pegel);
  const { blobs } = await store.list({ prefix: `push/${geraet(sub.endpoint)}-` });
  if (blobs.length >= MAX_ALARME_JE_GERAET && !blobs.some(b => b.key === key)) return { status: 409, fehler: `Auf diesem Gerät gibt es schon ${MAX_ALARME_JE_GERAET} Alarme. Bitte zuerst einen löschen.` };
  const stamm = await pegelStammdaten(fetchFn, pegel);
  if (!stamm) return { status: 400, fehler: 'Diesen Pegel gibt es nicht (mehr).' };
  const alt = await store.get(key, { type: 'json' });
  await store.setJSON(key, { ...sub, pegel, pegelName: stamm.name, gewaesser: stamm.gewaesser, richtung, wert, erstellt: alt?.erstellt || now, geaendert: now, zustand: null, letzteNachricht: alt?.letzteNachricht || null });
  return { status: 200, ok: true, pegelName: stamm.name };
}

export async function abmelden({ store }, { endpoint, pegel }) {
  if (typeof endpoint !== 'string' || !endpoint) return { status: 400, fehler: 'Ungültige Anfrage.' };
  if (pegel !== undefined && !PEGEL_RE.test(String(pegel))) return { status: 400, fehler: 'Ungültiger Pegel.' };
  const { blobs } = await store.list({ prefix: pegel ? pushSchluessel(endpoint, pegel) : `push/${geraet(endpoint)}-` });
  for (const b of blobs) await store.delete(b.key);
  return { status: 200, ok: true, geloescht: blobs.length };
}

export async function liste({ store }, { endpoint }) {
  if (typeof endpoint !== 'string' || !endpoint) return { status: 400, fehler: 'Ungültige Anfrage.' };
  const { blobs } = await store.list({ prefix: `push/${geraet(endpoint)}-` });
  const alarme = [];
  for (const b of blobs) {
    const a = await store.get(b.key, { type: 'json' });
    if (a) alarme.push({ pegel: a.pegel, pegelName: a.pegelName, gewaesser: a.gewaesser, richtung: a.richtung, wert: a.wert });
  }
  return { status: 200, ok: true, alarme };
}

// ------------------------------------------------------------------ Stündliche Prüfung
/** sendePush(abo, nutzlast) wirft bei Fehlern ein Objekt mit statusCode (wie web-push). 404/410: Abo abgelaufen → löschen. */
export async function pruefenPush({ store, fetchFn, sendePush, now, log = () => {} }) {
  const { blobs } = await store.list({ prefix: 'push/' });
  const proPegel = new Map();
  for (const b of blobs) {
    const a = await store.get(b.key, { type: 'json' });
    if (a) proPegel.set(a.pegel, [...(proPegel.get(a.pegel) || []), { key: b.key, a }]);
  }
  let gesendet = 0, geloescht = 0;
  for (const [id, liste] of proPegel) {
    let jetzt = null;
    try { jetzt = await pegelJetzt(fetchFn, id, now); } catch (e) { log(`Pegel ${id}: ${e.message}`); }
    if (!jetzt || jetzt.pegel.state === 'old') continue;
    let satz;
    for (const { key, a } of liste) {
      const { senden, neu } = schwelleBewerten(a, jetzt.pegel.value, now);
      if (senden) {
        if (satz === undefined) satz = await satzFuer(fetchFn, a, jetzt.pegel.value, now);
        try {
          await sendePush({ endpoint: a.endpoint, keys: a.keys }, JSON.stringify(nachricht({ a, wert: jetzt.pegel.value, punkte: jetzt.punkte, satz })));
          gesendet++;
        } catch (e) {
          if (e?.statusCode === 404 || e?.statusCode === 410) { await store.delete(key); geloescht++; continue; }
          log(`Push an Alarm ${key.slice(5, 13)}…: ${e?.statusCode || e?.message}`);
          continue;   // nicht als gesendet merken – nächste Stunde erneut versuchen
        }
      }
      if (neu !== a) await store.setJSON(key, neu);
    }
  }
  return { gesendet, geloescht, alarme: blobs.length };
}

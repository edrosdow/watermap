// Pegel-Alarm: gemeinsamer Kern für die Anmeldung (functions/pegel-alarm.mjs) und die stündliche Prüfung
// (functions/pegel-alarm-pruefen.mjs). Alles mit Eingaben von außen (Speicher, fetch, Uhr, Mail) ist injizierbar,
// damit es ohne Netlify getestet werden kann (tests/pegel_alarm_test.mjs).
//
// Ablauf: Anmeldung → Bestätigungs-Mail (Double-Opt-in) → Alarm aktiv → stündlich bewerten → Mail, wenn sich die
// Ampel ändert (frühestens nach MAIL_ABSTAND_STUNDEN). Jede Mail enthält einen Abmelde-Link.
// Gespeichert wird je Alarm: E-Mail, Pegel, Mindestpegel, Zeitpunkte, letzter Status. Nichts davon ist öffentlich.
import { createHash, randomBytes } from 'node:crypto';
import { bewerte, trend, STATUS } from '../../public/js/ampel-logik.js';
import { schwelleFehler, schwelleBewerten, nachricht, satzFuer } from './pegel-push-kern.mjs';

export const PEGEL_API = 'https://www.pegelonline.wsv.de/webservices/rest-api/v2/';
export const BESTAETIGEN_STUNDEN = 48;     // unbestätigte Anmeldungen werden danach gelöscht
export const MAIL_ABSTAND_STUNDEN = 6;     // höchstens eine Alarm-Mail je Alarm in diesem Abstand
export const MAX_ALARME_JE_MAIL = 5;
export const MAX_ANMELDUNGEN_JE_TAG = 3;   // je E-Mail-Adresse (schützt vor Mail-Bombing über das Formular)
export const MAX_MAILS_JE_TAG = 250;       // Brevo kostenlos: 300 pro Tag
const STALE_STUNDEN = 6;

export const EMAIL_RE = /^[^\s@<>"',;]{1,64}@[^\s@<>"',;]{1,190}\.[a-z]{2,24}$/i;
export const PEGEL_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const TOKEN_RE = /^[A-Za-z0-9_-]{20,40}$/;

const H = 3600e3;
export const neuesToken = () => randomBytes(18).toString('base64url');
export const mailSchluessel = (email) => 'mail/' + createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
const tag = (now) => new Date(now).toISOString().slice(0, 10);

const titleCase = (s) => String(s || '').toLowerCase().replace(/(^|[\s\-(/])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ------------------------------------------------------------------ PEGELONLINE
export async function pegelStammdaten(fetchFn, id) {
  const res = await fetchFn(`${PEGEL_API}stations/${encodeURIComponent(id)}.json`, { headers: { accept: 'application/json' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`PEGELONLINE antwortet mit ${res.status}`);
  const s = await res.json();
  return { name: titleCase(s.longname || s.shortname || 'Pegel'), gewaesser: titleCase(s.water?.longname || s.water?.shortname || '') };
}

/** Messwerte der letzten 24 h → { pegel: {value, unit, state, time}, punkte } oder null. */
export async function pegelJetzt(fetchFn, id, now) {
  const res = await fetchFn(`${PEGEL_API}stations/${encodeURIComponent(id)}/W/measurements.json?start=P1D`, { headers: { accept: 'application/json' } });
  if (!res.ok) return null;
  const raw = await res.json();
  const punkte = (Array.isArray(raw) ? raw : []).map(m => ({ t: Date.parse(m.timestamp), v: m.value }))
    .filter(p => Number.isFinite(p.t) && typeof p.v === 'number' && Number.isFinite(p.v)).sort((a, b) => a.t - b.t);
  if (!punkte.length) return null;
  const last = punkte[punkte.length - 1];
  return { pegel: { value: last.v, unit: 'cm', time: last.t, state: now - last.t > STALE_STUNDEN * H ? 'old' : 'normal' }, punkte };
}

// ------------------------------------------------------------------ Mail (Brevo, kostenlos bis 300 Mails/Tag)
export function brevoSender(env, fetchFn) {
  return async ({ to, subject, html, text, abmelden }) => {
    const res = await fetchFn('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: env.ALARM_ABSENDER, name: env.ALARM_ABSENDER_NAME || 'WaterMap Pegel-Alarm' },
        to: [{ email: to }], subject, htmlContent: html, textContent: text,
        headers: abmelden ? { 'List-Unsubscribe': `<${abmelden}>` } : undefined,
      }),
    });
    if (!res.ok) throw new Error(`Mailversand fehlgeschlagen (${res.status})`);
  };
}

/** Zählt Mails pro Tag (Schutz für das kostenlose Kontingent). true = darf senden. */
export async function mailKontingent(store, now) {
  const key = 'zaehler/' + tag(now);
  const n = (await store.get(key, { type: 'json' })) || 0;
  if (n >= MAX_MAILS_JE_TAG) return false;
  await store.setJSON(key, n + 1);
  return true;
}

function rahmen(inhalt, fuss) {
  return `<!doctype html><html lang="de"><body style="margin:0;background:#F2F5F4;font-family:Arial,Helvetica,sans-serif;color:#0E2433">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
<p style="font-size:18px;font-weight:700;margin:0 0 16px">WaterMap · Pegel-Ampel</p>
<div style="background:#fff;border-radius:14px;padding:20px">${inhalt}</div>
<p style="font-size:12px;color:#566878;margin:16px 4px 0">${fuss}</p></div></body></html>`;
}
const knopf = (href, text) => `<p style="margin:20px 0 4px"><a href="${esc(href)}" style="display:inline-block;background:#0B5E6B;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px">${esc(text)}</a></p>`;

const schwelleText = (a) => `${a.richtung === 'unter' ? 'unter' : 'über'} ${a.wert} cm`;

export function bestaetigungsMail({ alarm, link }) {
  const ort = `${alarm.pegelName}${alarm.gewaesser ? ' (' + alarm.gewaesser + ')' : ''}`;
  if (alarm.art === 'schwelle') return {
    subject: `Bitte bestätige deinen Pegel-Alarm für ${alarm.pegelName}`,
    html: rahmen(`<p style="margin:0 0 8px">Du möchtest benachrichtigt werden, wenn der Pegel <b>${esc(ort)}</b> <b>${esc(schwelleText(alarm))}</b> liegt.</p>
<p style="margin:0">Bitte bestätige das mit einem Klick:</p>${knopf(link, 'Alarm bestätigen')}
<p style="font-size:13px;color:#566878;margin:12px 0 0">Warst du das nicht? Dann ignoriere diese Mail einfach – ohne Bestätigung wird nichts gespeichert und die Anmeldung nach ${BESTAETIGEN_STUNDEN} Stunden gelöscht.</p>`,
      'Pegeldaten: PEGELONLINE (WSV). Ohne Gewähr, vor Ort immer selbst prüfen.'),
    text: `Bitte bestätige deinen Pegel-Alarm für ${ort} (${schwelleText(alarm)}):\n${link}\n\nWarst du das nicht? Dann ignoriere diese Mail einfach.`,
  };
  return {
    subject: `Bitte bestätige deinen Pegel-Alarm für ${alarm.pegelName}`,
    html: rahmen(`<p style="margin:0 0 8px">Du möchtest benachrichtigt werden, wenn sich die Pegel-Ampel für <b>${esc(ort)}</b> mit deinem Mindestpegel von <b>${alarm.min} cm</b> ändert.</p>
<p style="margin:0">Bitte bestätige das mit einem Klick:</p>${knopf(link, 'Alarm bestätigen')}
<p style="font-size:13px;color:#566878;margin:12px 0 0">Warst du das nicht? Dann ignoriere diese Mail einfach – ohne Bestätigung wird nichts gespeichert und die Anmeldung nach ${BESTAETIGEN_STUNDEN} Stunden gelöscht.</p>`,
    'Pegeldaten: PEGELONLINE (WSV). Ohne Gewähr, vor Ort immer selbst prüfen.'),
    text: `Bitte bestätige deinen Pegel-Alarm für ${ort} (Mindestpegel ${alarm.min} cm):\n${link}\n\nWarst du das nicht? Dann ignoriere diese Mail einfach.`,
  };
}

export function alarmMail({ alarm, ergebnis, pegel, seite, abmelden }) {
  const st = STATUS[ergebnis.status];
  const farbe = { gruen: '#15803D', gelb: '#B45309', rot: '#B91C1C' }[ergebnis.status] || '#0E2433';
  const reserve = ergebnis.reserve === null ? '' : `${ergebnis.reserve >= 0 ? '+' : '−'}${Math.abs(Math.round(ergebnis.reserve))} cm`;
  const hinweise = ergebnis.hinweise.map(h => h.text);
  return {
    subject: `Pegel-Alarm ${alarm.pegelName}: ${st.label}`,
    html: rahmen(`<p style="margin:0;font-size:13px;font-weight:700;letter-spacing:.04em;color:${farbe};text-transform:uppercase">${esc(st.label)}</p>
<p style="margin:4px 0 12px;font-size:20px;font-weight:700">${esc(st.titel)}</p>
<p style="margin:0 0 6px">${esc(alarm.pegelName)}${alarm.gewaesser ? ' · ' + esc(alarm.gewaesser) : ''}: <b>${Math.round(pegel.value)} cm</b>, Reserve <b>${reserve}</b> zu deinem Mindestpegel (${alarm.min} cm).</p>
${hinweise.length ? '<ul style="margin:8px 0;padding-left:20px">' + hinweise.map(t => `<li>${esc(t)}</li>`).join('') + '</ul>' : ''}${knopf(seite, 'In der Pegel-Ampel ansehen')}`,
    `Du bekommst diese Mail, weil du einen Pegel-Alarm bestätigt hast. <a href="${esc(abmelden)}" style="color:#566878">Alarm abbestellen</a>. Pegeldaten: PEGELONLINE (WSV). Ohne Gewähr, vor Ort immer selbst prüfen.`),
    text: `${st.label}: ${st.titel}\n${alarm.pegelName}: ${Math.round(pegel.value)} cm, Reserve ${reserve} (Mindestpegel ${alarm.min} cm)\n${hinweise.map(t => '- ' + t).join('\n')}\n\n${seite}\n\nAbbestellen: ${abmelden}`,
  };
}

/** Mail, wenn ein Schwellen-Alarm auslöst (höchstens eine pro Tag; Inhalt wie die Push-Nachricht). */
export function schwellenMail({ alarm, wert, punkte, satz, basis, abmelden }) {
  const n = nachricht({ a: alarm, wert, punkte, satz });
  const link = basis + n.url;
  return {
    subject: n.title,
    html: rahmen(`<p style="font-size:20px;font-weight:700;margin:0 0 8px">${esc(n.title)}</p><p style="margin:0">${esc(n.body)}</p>${knopf(link, 'Pegel ansehen')}`,
      `Du bekommst diese Mail, weil du einen Pegel-Alarm bestätigt hast (höchstens eine Mail pro Tag). <a href="${esc(abmelden)}" style="color:#566878">Alarm abbestellen</a>. Pegeldaten: PEGELONLINE (WSV). Ohne Gewähr, vor Ort immer selbst prüfen.`),
    text: `${n.title}\n${n.body}\n${link}\n\nAbbestellen: ${abmelden}`,
  };
}

// Ampel-Alarm: Pegel-Ampel mit Mindestpegel; Schwellen-Alarm: Pegel-Ampel nur zum Bestätigen/Abbestellen (Seite kennt beide)
const seiteUrl = (basis, alarm, extra = '') => (alarm.art === 'schwelle'
  ? `${basis}/pegel-ampel${extra.replace(/^&/, '?')}`
  : `${basis}/pegel-ampel?pegel=${encodeURIComponent(alarm.pegel)}&min=${alarm.min}${extra}`);
export const abmeldeUrl = (basis, token) => `${basis}/pegel-ampel?alarm-abmelden=${token}`;

// ------------------------------------------------------------------ Anmeldung, Bestätigung, Abmeldung
export async function anmelden({ store, fetchFn, send, now, basis }, { email, pegel, min, art, richtung, wert }) {
  email = String(email || '').trim();
  if (!EMAIL_RE.test(email) || email.length > 200) return { status: 400, fehler: 'Bitte eine gültige E-Mail-Adresse eingeben.' };
  if (!PEGEL_RE.test(String(pegel || ''))) return { status: 400, fehler: 'Bitte zuerst einen Pegel wählen.' };
  const schwelle = art === 'schwelle';   // „unter/über X cm“ (Pegel-Tab); sonst Ampel-Alarm mit Mindestpegel (Pegel-Ampel)
  if (schwelle) {
    wert = Number(wert);
    const f = schwelleFehler({ richtung, wert });
    if (f) return { status: 400, fehler: f };
    min = null;
  } else {
    min = Number(min);
    if (!Number.isInteger(min) || min < -500 || min > 2000) return { status: 400, fehler: 'Bitte einen Mindestpegel in cm eingeben.' };
  }

  const mk = mailSchluessel(email);
  const liste = ((await store.get(mk, { type: 'json' })) || []).filter(e => e && e.token);
  if (liste.filter(e => now - e.erstellt < 24 * H).length >= MAX_ANMELDUNGEN_JE_TAG) return { status: 429, fehler: 'Zu viele Anmeldungen für diese Adresse heute. Bitte morgen erneut versuchen.' };
  if (liste.length >= MAX_ALARME_JE_MAIL) return { status: 409, fehler: `Für diese Adresse gibt es schon ${MAX_ALARME_JE_MAIL} Alarme. Bitte zuerst einen abbestellen.` };

  const stamm = await pegelStammdaten(fetchFn, pegel);
  if (!stamm) return { status: 400, fehler: 'Diesen Pegel gibt es nicht (mehr).' };
  if (!(await mailKontingent(store, now))) return { status: 503, fehler: 'Heute können keine weiteren Mails verschickt werden. Bitte morgen erneut versuchen.' };

  const token = neuesToken();
  const alarm = { email, pegel, pegelName: stamm.name, gewaesser: stamm.gewaesser, min, aktiv: false, erstellt: now, letzterStatus: null, letzteMail: null,
    ...(schwelle ? { art: 'schwelle', richtung, wert, zustand: null, letzteNachricht: null } : {}) };
  await store.setJSON('alarm/' + token, alarm);
  await store.setJSON(mk, [...liste, { token, erstellt: now }]);
  await send({ to: email, ...bestaetigungsMail({ alarm, link: seiteUrl(basis, alarm, `${schwelle ? '?' : '&'}alarm-bestaetigen=${token}`) }) });
  return { status: 200, ok: true };
}

export async function bestaetigen({ store, now }, token) {
  if (!TOKEN_RE.test(String(token || ''))) return { status: 400, fehler: 'Ungültiger Link.' };
  const alarm = await store.get('alarm/' + token, { type: 'json' });
  if (!alarm) return { status: 404, fehler: 'Dieser Link ist abgelaufen. Bitte melde den Alarm neu an.' };
  if (!alarm.aktiv) {
    if (now - alarm.erstellt > BESTAETIGEN_STUNDEN * H) { await loeschen(store, token, alarm); return { status: 404, fehler: 'Dieser Link ist abgelaufen. Bitte melde den Alarm neu an.' }; }
    await store.setJSON('alarm/' + token, { ...alarm, aktiv: true, bestaetigt: now });
  }
  return { status: 200, ok: true, pegelName: alarm.pegelName, min: alarm.min, ...(alarm.art === 'schwelle' ? { art: 'schwelle', richtung: alarm.richtung, wert: alarm.wert } : {}) };
}

export async function abmelden({ store }, token) {
  if (!TOKEN_RE.test(String(token || ''))) return { status: 400, fehler: 'Ungültiger Link.' };
  const alarm = await store.get('alarm/' + token, { type: 'json' });
  if (alarm) await loeschen(store, token, alarm);
  return { status: 200, ok: true };       // auch wenn schon weg: Ziel erreicht
}

async function loeschen(store, token, alarm) {
  await store.delete('alarm/' + token);
  const mk = mailSchluessel(alarm.email);
  const rest = ((await store.get(mk, { type: 'json' })) || []).filter(e => e.token !== token);
  if (rest.length) await store.setJSON(mk, rest); else await store.delete(mk);
}

// ------------------------------------------------------------------ Stündliche Prüfung
export async function pruefen({ store, fetchFn, send, now, basis, log = () => {} }) {
  const { blobs } = await store.list({ prefix: 'alarm/' });
  const alarme = [];
  for (const b of blobs) {
    const a = await store.get(b.key, { type: 'json' });
    if (!a) continue;
    const token = b.key.slice(6);
    if (!a.aktiv) { if (now - a.erstellt > BESTAETIGEN_STUNDEN * H) await loeschen(store, token, a); continue; }
    alarme.push({ token, a });
  }
  const proPegel = new Map();
  for (const x of alarme) proPegel.set(x.a.pegel, [...(proPegel.get(x.a.pegel) || []), x]);
  let mails = 0;
  for (const [id, liste] of proPegel) {
    let jetzt = null;
    try { jetzt = await pegelJetzt(fetchFn, id, now); } catch (e) { log(`Pegel ${id}: ${e.message}`); }
    if (!jetzt) continue;
    const tr = trend(jetzt.punkte);
    let satz;
    for (const { token, a } of liste) {
      if (a.art === 'schwelle') {
        if (jetzt.pegel.state === 'old') continue;
        const { senden, neu } = schwelleBewerten(a, jetzt.pegel.value, now);
        if (senden) {
          if (!(await mailKontingent(store, now))) { log('Tageskontingent erreicht'); return { mails }; }
          if (satz === undefined) satz = await satzFuer(fetchFn, a, jetzt.pegel.value, now);
          try {
            await send({ to: a.email, abmelden: abmeldeUrl(basis, token), ...schwellenMail({ alarm: a, wert: jetzt.pegel.value, punkte: jetzt.punkte, satz, basis, abmelden: abmeldeUrl(basis, token) }) });
            mails++;
          } catch (e) { log(`Mail an Alarm ${token.slice(0, 6)}…: ${e.message}`); continue; }
        }
        if (neu !== a) await store.setJSON('alarm/' + token, neu);
        continue;
      }
      const ergebnis = bewerte({ pegel: jetzt.pegel, mindest: a.min, trend: tr });
      if (ergebnis.status === 'unbekannt' || jetzt.pegel.state === 'old') continue;
      if (a.letzterStatus === null) { await store.setJSON('alarm/' + token, { ...a, letzterStatus: ergebnis.status }); continue; }
      if (ergebnis.status === a.letzterStatus) continue;
      if (a.letzteMail && now - a.letzteMail < MAIL_ABSTAND_STUNDEN * H) continue;   // später erneut, falls noch anders
      if (!(await mailKontingent(store, now))) { log('Tageskontingent erreicht'); return { mails }; }
      try {
        await send({ to: a.email, abmelden: abmeldeUrl(basis, token),
          ...alarmMail({ alarm: a, ergebnis, pegel: jetzt.pegel, seite: seiteUrl(basis, a), abmelden: abmeldeUrl(basis, token) }) });
        await store.setJSON('alarm/' + token, { ...a, letzterStatus: ergebnis.status, letzteMail: now });
        mails++;
      } catch (e) { log(`Mail an Alarm ${token.slice(0, 6)}…: ${e.message}`); }
    }
  }
  return { mails, alarme: alarme.length };
}

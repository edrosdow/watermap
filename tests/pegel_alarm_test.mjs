// Tests des Pegel-Alarms (netlify/lib/pegel-alarm-kern.mjs, netlify/functions/pegel-alarm.mjs) ohne Netlify:
// Speicher, PEGELONLINE und Brevo werden nachgebildet.   Start: node tests/pegel_alarm_test.mjs
import assert from 'node:assert/strict';
import { anmelden, bestaetigen, abmelden, pruefen, mailSchluessel, MAX_ANMELDUNGEN_JE_TAG, brevoSender } from '../netlify/lib/pegel-alarm-kern.mjs';
import { handle } from '../netlify/functions/pegel-alarm.mjs';

const H = 3600e3;
const PEGEL = '1d26e504-7f9e-480a-b52c-5932be6549ab';

function fakeStore() {
  const m = new Map();
  return {
    m,
    async get(k) { return m.has(k) ? JSON.parse(m.get(k)) : null; },
    async setJSON(k, v) { m.set(k, JSON.stringify(v)); },
    async delete(k) { m.delete(k); },
    async list({ prefix }) { return { blobs: [...m.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })) }; },
  };
}
const welt = { wert: 150, rate: 0, now: Date.UTC(2026, 9, 21, 12) };
const fetchFn = async (url) => {
  const ok = (body) => ({ ok: true, status: 200, json: async () => body });
  if (url.endsWith(`stations/${PEGEL}.json`)) return ok({ longname: 'KAUB', water: { longname: 'RHEIN' } });
  if (url.includes(`stations/${PEGEL}/W/measurements.json`)) {
    const pts = []; for (let i = 0; i <= 96; i++) { const t = welt.now - (96 - i) * 15 * 60e3; pts.push({ timestamp: new Date(t).toISOString(), value: welt.wert - welt.rate * (96 - i) / 96 }); }
    return ok(pts);
  }
  if (url.includes('/stations/')) return { ok: false, status: 404, json: async () => ({}) };
  throw new Error('unerwartet: ' + url);
};
const post = [];
const send = async (m) => { post.push(m); };
const store = fakeStore();
const ctx = () => ({ store, fetchFn, send, now: welt.now, basis: 'https://test.example' });
const token = (mail) => mail.text.match(/alarm-(?:bestaetigen|abmelden)=([A-Za-z0-9_-]+)/)[1];

// Eingaben prüfen
assert.equal((await anmelden(ctx(), { email: 'kein-mail', pegel: PEGEL, min: 100 })).status, 400);
assert.equal((await anmelden(ctx(), { email: 'a@b.de', pegel: 'xyz', min: 100 })).status, 400);
assert.equal((await anmelden(ctx(), { email: 'a@b.de', pegel: PEGEL, min: 'abc' })).status, 400);
assert.equal((await anmelden(ctx(), { email: 'a@b.de', pegel: '00000000-0000-0000-0000-000000000000', min: 100 })).status, 400, 'unbekannter Pegel');
assert.equal(post.length, 0);

// Anmeldung → Bestätigungs-Mail, noch nicht aktiv
let r = await anmelden(ctx(), { email: 'Anna@Example.de', pegel: PEGEL, min: 100 });
assert.equal(r.status, 200);
assert.equal(post.length, 1);
assert.ok(post[0].subject.includes('Kaub') && post[0].to === 'Anna@Example.de');
assert.ok(post[0].text.includes('https://test.example/pegel-ampel?pegel=' + PEGEL + '&min=100&alarm-bestaetigen='));
assert.ok(!post[0].html.includes('<script'));
const t1 = token(post[0]);
let gespeichert = await store.get('alarm/' + t1);
assert.equal(gespeichert.aktiv, false);
assert.deepEqual((await store.get(mailSchluessel('anna@example.de'))).map(e => e.token), [t1], 'Index unabhängig von Groß/Klein');

// Unbestätigt: Prüfung verschickt nichts
await pruefen(ctx()); assert.equal(post.length, 1);

// Bestätigen
assert.equal((await bestaetigen(ctx(), 'kurz')).status, 400);
r = await bestaetigen(ctx(), t1); assert.equal(r.status, 200); assert.equal(r.pegelName, 'Kaub');
assert.equal((await store.get('alarm/' + t1)).aktiv, true);

// Erste Prüfung merkt sich den Status ohne Mail (150 cm, Min 100 → grün)
r = await pruefen(ctx()); assert.equal(r.mails, 0);
assert.equal((await store.get('alarm/' + t1)).letzterStatus, 'gruen');
// unverändert: keine Mail
welt.now += H; await pruefen(ctx()); assert.equal(post.length, 1);
// Pegel fällt unter Mindestpegel → Mail „Nicht befahrbar“ mit Abmelde-Link
welt.wert = 90; welt.now += H;
r = await pruefen(ctx()); assert.equal(r.mails, 1);
const alarmMail = post.at(-1);
assert.ok(alarmMail.subject.includes('Nicht befahrbar'), alarmMail.subject);
assert.ok(alarmMail.html.includes('−10 cm') && alarmMail.abmelden.includes('alarm-abmelden='));
// Wieder grün, aber innerhalb von 6 h: noch keine Mail; danach schon
welt.wert = 160; welt.now += H; await pruefen(ctx()); assert.equal(post.length, 2, 'Mindestabstand');
welt.now += 6 * H; r = await pruefen(ctx()); assert.equal(r.mails, 1); assert.ok(post.at(-1).subject.includes('Heute befahrbar'));

// Grenzen je Adresse
for (let i = 0; i < MAX_ANMELDUNGEN_JE_TAG; i++) await anmelden(ctx(), { email: 'bob@example.de', pegel: PEGEL, min: 50 });
assert.equal((await anmelden(ctx(), { email: 'bob@example.de', pegel: PEGEL, min: 50 })).status, 429);

// Abgelaufene unbestätigte Anmeldungen werden gelöscht
const bobToken = token(post.at(-1));
welt.now += 49 * H;
assert.equal((await bestaetigen(ctx(), bobToken)).status, 404);
await pruefen(ctx());
assert.equal([...store.m.keys()].filter(k => k.startsWith('alarm/')).length, 1, 'nur Annas Alarm bleibt');
assert.equal(await store.get(mailSchluessel('bob@example.de')), null);

// Abmelden (auch doppelt ohne Fehler)
const abToken = alarmMail.abmelden.split('alarm-abmelden=')[1];
assert.equal((await abmelden(ctx(), abToken)).status, 200);
assert.equal((await abmelden(ctx(), abToken)).status, 200);
assert.equal(await store.get('alarm/' + t1), null);
assert.equal(await store.get(mailSchluessel('anna@example.de')), null);

// HTTP-Schicht
const req = (body, method = 'POST') => new Request('https://vorschau.example/.netlify/functions/pegel-alarm', { method, body: method === 'POST' ? JSON.stringify(body) : undefined });
const env = { BREVO_API_KEY: 'k', ALARM_ABSENDER: 'absender@example.de' };
let res = await handle(req({}, 'GET'), { store, env, fetchFn, send, now: welt.now }); assert.equal(res.status, 405);
res = await handle(req({ aktion: 'anmelden', email: 'x@example.de', pegel: PEGEL, min: 10 }), { store, env: {}, fetchFn, send, now: welt.now });
assert.equal(res.status, 503); assert.ok((await res.json()).fehler.includes('BREVO_API_KEY'));
const vorher = post.length;
res = await handle(req({ aktion: 'anmelden', email: 'x@example.de', pegel: PEGEL, min: 10, website: 'spam' }), { store, env, fetchFn, send, now: welt.now });
assert.equal(res.status, 200); assert.equal(post.length, vorher, 'Honigtopf: keine Mail');
res = await handle(req({ aktion: 'anmelden', email: 'x@example.de', pegel: PEGEL, min: 10 }), { store, env, fetchFn, send, now: welt.now });
assert.equal(res.status, 200); assert.ok(post.at(-1).text.includes('https://vorschau.example/pegel-ampel'), 'Link zur aufrufenden Seite');
res = await handle(req({ aktion: 'bestaetigen', token: token(post.at(-1)) }), { store, env, fetchFn, send, now: welt.now });
assert.equal(res.status, 200);

// Brevo-Aufruf
let brevo = null;
await brevoSender({ BREVO_API_KEY: 'geheim', ALARM_ABSENDER: 'a@b.de' }, async (url, o) => { brevo = { url, o }; return { ok: true }; })({ to: 'c@d.de', subject: 's', html: 'h', text: 't', abmelden: 'https://x/abmelden' });
assert.equal(brevo.url, 'https://api.brevo.com/v3/smtp/email');
assert.equal(brevo.o.headers['api-key'], 'geheim');
assert.equal(JSON.parse(brevo.o.body).headers['List-Unsubscribe'], '<https://x/abmelden>');

console.log('pegel-alarm: alle Tests OK');

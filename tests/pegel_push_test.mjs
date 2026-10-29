// Tests des Schwellen-Alarms (Push und E-Mail): netlify/lib/pegel-push-kern.mjs, Schwellen-Teil von pegel-alarm-kern.mjs,
// netlify/functions/pegel-push.mjs – Speicher, PEGELONLINE und Versand nachgebildet.   Start: node tests/pegel_push_test.mjs
import assert from 'node:assert/strict';
import { schwelleBewerten, nachricht, anmelden, abmelden, liste, pruefenPush, pushSchluessel, MAX_ALARME_JE_GERAET } from '../netlify/lib/pegel-push-kern.mjs';
import { anmelden as mailAnmelden, bestaetigen, pruefen } from '../netlify/lib/pegel-alarm-kern.mjs';
import { handle } from '../netlify/functions/pegel-push.mjs';

const H = 3600e3;
const PEGEL = '1d26e504-7f9e-480a-b52c-5932be6549ab';
function fakeStore() {
  const m = new Map();
  return { m, async get(k) { return m.has(k) ? JSON.parse(m.get(k)) : null; }, async setJSON(k, v) { m.set(k, JSON.stringify(v)); },
    async delete(k) { m.delete(k); }, async list({ prefix }) { return { blobs: [...m.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })) }; } };
}
const welt = { wert: 96, now: Date.UTC(2026, 9, 29, 10), wv: true };
const fetchFn = async (url) => {
  const ok = (body) => ({ ok: true, status: 200, json: async () => body });
  if (url.endsWith(`stations/${PEGEL}.json`)) return ok({ longname: 'MINDEN', water: { longname: 'WESER' } });
  if (url.includes(`stations/${PEGEL}/W/measurements.json`)) {
    const pts = []; for (let i = 0; i <= 96; i++) pts.push({ timestamp: new Date((welt.mz ?? welt.now) - (96 - i) * 15 * 60e3).toISOString(), value: welt.wert + (96 - i) * 0.1 });
    return ok(pts);
  }
  if (url.includes(`stations/${PEGEL}/W.json`)) return ok({ characteristicValues: [{ shortname: 'MNW', value: 98 }, { shortname: 'MHW', value: 480 }] });
  if (url.includes(`stations/${PEGEL}/WV/measurements.json`)) return welt.wv ? ok([1, 2, 3].map(i => ({ timestamp: new Date(welt.now + i * 24 * H).toISOString(), value: 94 - i }))) : { ok: false, status: 404, json: async () => ({}) };
  return { ok: false, status: 404, json: async () => ({}) };
};

// ---- Entprellung
const a0 = { richtung: 'unter', wert: 100, zustand: null, letzteNachricht: null };
let r = schwelleBewerten(a0, 96, welt.now);
assert.equal(r.senden, true); assert.equal(r.neu.zustand, 'ausgeloest');
r = schwelleBewerten(r.neu, 95, welt.now + H);
assert.equal(r.senden, false, 'unter der Schwelle geblieben: keine zweite Nachricht');
r = schwelleBewerten(r.neu, 101, welt.now + 2 * H);
assert.equal(r.senden, false); assert.equal(r.neu.zustand, 'frei', 'Rückkehr über die Schwelle setzt zurück');
r = schwelleBewerten(r.neu, 97, welt.now + 3 * H);
assert.equal(r.senden, false, 'am selben Tag höchstens eine Nachricht');
assert.equal(schwelleBewerten(r.neu, 97, welt.now + 24 * H).senden, true, 'am nächsten Tag wieder');
assert.equal(schwelleBewerten({ richtung: 'ueber', wert: 500, zustand: null }, 520, welt.now).senden, true);
assert.equal(schwelleBewerten({ richtung: 'ueber', wert: 500, zustand: null }, 500, welt.now).senden, false, 'genau auf der Schwelle: nicht „über“');
// Tagesgrenze in deutscher Zeit: 23:30 und 00:30 (MEZ) sind verschiedene Tage
const spaet = Date.UTC(2026, 10, 2, 22, 30), frueh = Date.UTC(2026, 10, 2, 23, 30);
assert.equal(schwelleBewerten({ ...a0, zustand: 'frei', letzteNachricht: spaet }, 96, frueh).senden, true);

// ---- Nachricht
const n = nachricht({ a: { pegel: PEGEL, pegelName: 'Minden', richtung: 'unter', wert: 100 }, wert: 96.4, punkte: Array.from({ length: 25 }, (_, i) => ({ t: i * H, v: 110 - i * 14 / 24 })), satz: 'Vorhersage: bleibt bis Sonntag knapp unter MNW (91–93 cm).' });
assert.equal(n.title, 'Minden unter 100 cm');
assert.equal(n.body, 'Aktuell 96 cm, fallend. Vorhersage: bleibt bis Sonntag knapp unter MNW (91–93 cm).');
assert.equal(n.url, `/#pf=${PEGEL}`);

// ---- Anmelden, Liste, Abmelden
const store = fakeStore();
const sub = (i = 1) => ({ endpoint: `https://push.example/abc${i}`, keys: { p256dh: 'BKEY', auth: 'AUTH' } });
const c = { store, fetchFn, now: welt.now };
assert.equal((await anmelden(c, { subscription: { endpoint: 'http://x' }, pegel: PEGEL, richtung: 'unter', wert: 100 })).status, 400);
assert.equal((await anmelden(c, { subscription: sub(), pegel: 'xyz', richtung: 'unter', wert: 100 })).status, 400);
assert.equal((await anmelden(c, { subscription: sub(), pegel: PEGEL, richtung: 'quer', wert: 100 })).status, 400);
assert.equal((await anmelden(c, { subscription: sub(), pegel: PEGEL, richtung: 'unter', wert: 'abc' })).status, 400);
r = await anmelden(c, { subscription: sub(), pegel: PEGEL, richtung: 'unter', wert: 100 });
assert.equal(r.status, 200); assert.equal(r.pegelName, 'Minden');
const gespeichert = await store.get(pushSchluessel(sub().endpoint, PEGEL));
assert.deepEqual(Object.keys(gespeichert).sort(), ['endpoint', 'erstellt', 'geaendert', 'gewaesser', 'keys', 'letzteNachricht', 'pegel', 'pegelName', 'richtung', 'wert', 'zustand'].sort(), 'nur, was zum Senden nötig ist');
assert.deepEqual((await liste({ store }, { endpoint: sub().endpoint })).alarme, [{ pegel: PEGEL, pegelName: 'Minden', gewaesser: 'Weser', richtung: 'unter', wert: 100 }]);
// erneut anmelden ändert nur (kein zweiter Eintrag)
await anmelden(c, { subscription: sub(), pegel: PEGEL, richtung: 'unter', wert: 110 });
assert.equal((await liste({ store }, { endpoint: sub().endpoint })).alarme.length, 1);
assert.equal(MAX_ALARME_JE_GERAET, 10);

// ---- Prüfung: senden, nicht wiederholen, abgelaufenes Abo löschen
const gesendet = [];
let fehler = null;
const pp = (now) => { welt.mz = now; return pruefenPush({ store, fetchFn, sendePush, now }); };
const sendePush = async (abo, nutzlast) => { if (fehler) { const e = new Error('weg'); e.statusCode = fehler; throw e; } gesendet.push({ abo, n: JSON.parse(nutzlast) }); };
let p = await pp(welt.now);
assert.equal(p.gesendet, 1); assert.equal(gesendet[0].n.title, 'Minden unter 110 cm');
assert.match(gesendet[0].n.body, /^Aktuell 96 cm, fallend\. Vorhersage: bleibt bis \w+ (knapp )?unter MNW \(91–93 cm\)\.$/);
p = await pp(welt.now + H);
assert.equal(p.gesendet, 0, 'zweite Prüfung: keine neue Nachricht');
welt.wv = false; welt.wert = 120;
await pp(welt.now + 2 * H);   // zurück über die Schwelle
welt.wert = 96;
p = await pp(welt.now + 26 * H);
assert.equal(p.gesendet, 1, 'nächster Tag nach Rückkehr: wieder eine Nachricht');
assert.equal(gesendet[1].n.body, 'Aktuell 96 cm, fallend.', 'ohne Vorhersage nur Wert und Trend');
fehler = 410; welt.wert = 120;
await pp(welt.now + 27 * H); welt.wert = 96;
p = await pp(welt.now + 50 * H);
assert.equal(p.geloescht, 1); assert.equal(store.m.size, 0, 'abgelaufenes Abo (410) gelöscht');
fehler = null;
// Abmelden
await anmelden(c, { subscription: sub(2), pegel: PEGEL, richtung: 'ueber', wert: 400 });
assert.equal((await abmelden({ store }, { endpoint: sub(2).endpoint, pegel: PEGEL })).geloescht, 1);
assert.equal(store.m.size, 0);

welt.mz = null;
// ---- Schwellen-Alarm per E-Mail (Double-Opt-in, höchstens eine Mail pro Tag)
const mstore = fakeStore(), mails = [];
const send = async (m) => { mails.push(m); };
welt.wv = true;
r = await mailAnmelden({ store: mstore, fetchFn, send, now: welt.now, basis: 'https://t.example' }, { email: 'a@b.de', pegel: PEGEL, art: 'schwelle', richtung: 'unter', wert: 100 });
assert.equal(r.status, 200);
assert.match(mails[0].text, /Minden \(Weser\) \(unter 100 cm\)/);
assert.match(mails[0].text, /https:\/\/t\.example\/pegel-ampel\?alarm-bestaetigen=/);
const tok = mails[0].text.match(/alarm-bestaetigen=([A-Za-z0-9_-]+)/)[1];
r = await bestaetigen({ store: mstore, now: welt.now }, tok);
assert.equal(r.art, 'schwelle'); assert.equal(r.wert, 100);
await pruefen({ store: mstore, fetchFn, send, now: welt.now + H, basis: 'https://t.example' });
assert.equal(mails.length, 2); assert.equal(mails[1].subject, 'Minden unter 100 cm'); assert.match(mails[1].text, /Aktuell 96 cm, fallend\. Vorhersage:/);
await pruefen({ store: mstore, fetchFn, send, now: welt.now + 2 * H, basis: 'https://t.example' });
assert.equal(mails.length, 2, 'keine zweite Mail am selben Tag');
assert.equal((await mailAnmelden({ store: mstore, fetchFn, send, now: welt.now, basis: 'x' }, { email: 'c@d.de', pegel: PEGEL, art: 'schwelle', richtung: 'unter' })).status, 400);

// ---- Funktion
const req = (method, body) => new Request('https://t.example/.netlify/functions/pegel-push', { method, body: body ? JSON.stringify(body) : undefined });
assert.equal((await handle(req('GET'), { store, env: {} })).status, 503, 'ohne VAPID-Schlüssel: nicht eingerichtet');
const env = { VAPID_PUBLIC_KEY: 'PUB', VAPID_PRIVATE_KEY: 'PRIV', VAPID_SUBJECT: 'mailto:x@y.de' };
assert.deepEqual(await (await handle(req('GET'), { store, env })).json(), { publicKey: 'PUB' }, 'nur der öffentliche Schlüssel');
assert.equal((await handle(req('POST', { aktion: 'anmelden', subscription: sub(3), pegel: PEGEL, richtung: 'unter', wert: 100 }), { store, env, fetchFn })).status, 200);
assert.equal((await handle(req('POST', { aktion: 'liste', endpoint: sub(3).endpoint }), { store, env })).status, 200);
assert.equal((await handle(req('POST', { aktion: 'kaputt' }), { store, env })).status, 400);
assert.equal((await handle(req('PUT'), { store, env })).status, 405);
console.log('pegel-push: alle Tests OK');

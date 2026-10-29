// Pegel-Alarm „unter/über X cm“ als Fenster (Handy: von unten): Push aufs Handy (Web Push über den Service Worker) oder E-Mail.
// Auf diesem Gerät gemerkt wird nur, welche Alarme es hier gibt (für die Anzeige im Pegel-Fenster und unter Einstellungen).
import { CONFIG } from './config.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { fenster } from './wetter.js';

const LS = 'watermap.alarme';   // [{ pegel, name, gewaesser, richtung, wert, kanal: 'push' | 'mail', erstellt }]
const PUSH_API = '/.netlify/functions/pegel-push';
const MAIL_API = '/.netlify/functions/pegel-alarm';
const SCHRITT = 5;

export function alarmeLesen() {
  try { const a = JSON.parse(localStorage.getItem(LS) || '[]'); return Array.isArray(a) ? a.filter(x => x && x.pegel && x.kanal) : []; } catch { return []; }
}
function alarmeSchreiben(liste) {
  try { localStorage.setItem(LS, JSON.stringify(liste)); } catch { /* ohne Speicher */ }
  document.dispatchEvent(new CustomEvent('pegel-alarme'));
}
const merken = (e) => alarmeSchreiben([...alarmeLesen().filter(a => !(a.pegel === e.pegel && a.kanal === e.kanal)), e]);
const vergessen = (pegel, kanal) => alarmeSchreiben(alarmeLesen().filter(a => !(a.pegel === pegel && a.kanal === kanal)));
export const alarmFuer = (pegel) => alarmeLesen().filter(a => a.pegel === pegel);
const schwelleText = (a) => `${a.richtung === 'unter' ? 'unter' : 'über'} ${a.wert.toLocaleString('de-DE')} cm`;
/** Kurztext für die Zeile im Pegel-Fenster, z. B. „Push, wenn unter 100 cm · aktiv“; ohne Alarm null. */
export function alarmStatus(pegel) {
  const a = alarmFuer(pegel);
  if (!a.length) return null;
  return a.map(x => (x.kanal === 'push' ? `Push, wenn ${schwelleText(x)} · aktiv` : `E-Mail, wenn ${schwelleText(x)}`)).join(' · ');
}

// ------------------------------------------------------------------ Gerät
export const pushMoeglich = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const istIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const istHomeApp = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

const b64 = (s) => { const p = '='.repeat((4 - s.length % 4) % 4); const r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(r, c => c.charCodeAt(0)); };
async function api(url, body) {
  const res = await fetch(url, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.fehler || 'Das hat gerade nicht geklappt. Bitte später erneut versuchen.');
  return j;
}
async function pushAbo() {
  const { publicKey } = await api(PUSH_API);
  const erlaubt = await Notification.requestPermission();
  if (erlaubt !== 'granted') throw new Error('Benachrichtigungen sind für WaterMap nicht erlaubt. Du kannst das in den Einstellungen deines Geräts ändern – oder die E-Mail wählen.');
  const reg = await navigator.serviceWorker.ready;
  return (await reg.pushManager.getSubscription()) || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(publicKey) });
}
async function aktuellesAbo() {
  if (!pushMoeglich()) return null;
  try { return await (await navigator.serviceWorker.ready).pushManager.getSubscription(); } catch { return null; }
}
/** Push-Alarm eines Pegels löschen (auf dem Server und hier). */
export async function pushAlarmLoeschen(pegel) {
  const abo = await aktuellesAbo();
  if (abo) await api(PUSH_API, { aktion: 'abmelden', endpoint: abo.endpoint, pegel });
  vergessen(pegel, 'push');
}
export const mailAlarmVergessen = (pegel) => vergessen(pegel, 'mail');

// ------------------------------------------------------------------ Fenster
/** g: Pegel aus der Stationsliste; opener: Element für den Fokus danach; toast(text). */
export function alarmFenster(g, { opener = null, toast = (t) => document.dispatchEvent(new CustomEvent('wm-toast', { detail: t })) } = {}) {
  const vorhanden = alarmFuer(g.id);
  const alt = vorhanden.find(a => a.kanal === 'push') || vorhanden[0] || null;
  let richtung = alt?.richtung || 'unter';
  let wert = alt?.wert ?? Math.round(g.value / SCHRITT) * SCHRITT;
  const iosOhneApp = istIos() && !istHomeApp();
  const pushGeht = pushMoeglich() && !iosOhneApp;
  let kanal = alt?.kanal === 'mail' || !pushGeht ? 'mail' : 'push';
  let dlg;

  const meldung = h('p', { class: 'al-meldung', role: 'status', hidden: true });
  const melden = (t, fehler = false) => { meldung.hidden = !t; meldung.textContent = t || ''; meldung.classList.toggle('is-fehler', fehler); };

  const richtungKnopf = (r, text) => h('button', { type: 'button', class: 'al-r', 'aria-pressed': String(richtung === r), dataset: { r },
    onclick: () => { richtung = r; for (const b of seg.children) b.setAttribute('aria-pressed', String(b.dataset.r === r)); } }, text);
  const seg = h('div', { class: 'al-seg', role: 'group', 'aria-label': 'Richtung' }, richtungKnopf('unter', 'unter'), richtungKnopf('ueber', 'über'));
  const feld = h('input', { type: 'number', id: 'al-wert', class: 'al-wert', inputmode: 'numeric', min: '-500', max: '2000', step: '1', value: String(wert), 'aria-label': 'Wert in Zentimetern',
    oninput: () => { const v = Math.round(Number(feld.value)); if (Number.isFinite(v)) wert = v; } });
  const schritt = (d) => { wert = Math.round((wert + d) / SCHRITT) * SCHRITT; feld.value = String(wert); };
  const stepper = h('div', { class: 'al-stepper' },
    h('button', { type: 'button', class: 'al-pm', 'aria-label': `${SCHRITT} cm weniger`, text: '−', onclick: () => schritt(-SCHRITT) }),
    h('label', { class: 'al-wert-box', for: 'al-wert' }, feld, h('span', { text: 'cm' })),
    h('button', { type: 'button', class: 'al-pm', 'aria-label': `${SCHRITT} cm mehr`, text: '+', onclick: () => schritt(SCHRITT) }));
  const hochwasser = CONFIG.HOCHWASSER_AKTIV ? h('label', { class: 'al-check' }, h('input', { type: 'checkbox', id: 'al-hw', checked: true }), 'auch bei Hochwasserwarnung für diesen Pegel') : null;

  const mail = h('input', { type: 'email', id: 'al-mail', class: 'al-mail', autocomplete: 'email', placeholder: 'deine@adresse.de', 'aria-label': 'E-Mail-Adresse' });
  const honig = h('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off', class: 'al-honig', 'aria-hidden': 'true' });
  const mailBox = h('div', { class: 'al-mailbox', hidden: kanal !== 'mail' }, mail, honig,
    h('p', { class: 'al-klein', text: 'Du bekommst zuerst eine Mail zum Bestätigen. Versand über Brevo; jederzeit abbestellbar.' }));
  const option = (k, titel, sub, gesperrt = false) => h('label', { class: 'al-opt' + (gesperrt ? ' is-aus' : '') },
    h('input', { type: 'radio', name: 'al-kanal', value: k, checked: kanal === k, disabled: gesperrt,
      onchange: () => { kanal = k; mailBox.hidden = k !== 'mail'; } }),
    h('span', { class: 'al-opt-text' }, h('strong', { text: titel }), h('small', { text: sub })));
  const pushSub = iosOhneApp ? 'auf dem iPhone nur, wenn WaterMap auf dem Home-Bildschirm liegt'
    : !pushMoeglich() ? 'auf diesem Gerät bzw. Browser nicht möglich' : 'empfohlen · auch wenn WaterMap geschlossen ist';
  const anleitung = iosOhneApp ? h('div', { class: 'al-anleitung' },
    h('strong', { text: 'So geht Push auf dem iPhone:' }),
    h('ol', {}, h('li', { text: 'In Safari unten auf „Teilen“ tippen' }), h('li', { text: '„Zum Home-Bildschirm“ wählen' }), h('li', { text: 'WaterMap vom Home-Bildschirm öffnen und hier den Alarm anlegen' })),
    h('p', { class: 'al-klein', text: 'Oder einfach die E-Mail wählen.' })) : null;

  const los = h('button', { type: 'submit', class: 'btn btn-primary al-los', text: alt ? 'Alarm ändern' : 'Alarm aktivieren' });
  const loeschen = vorhanden.length ? h('button', { type: 'button', class: 'al-loeschen', text: 'Alarm löschen', onclick: async () => {
    try {
      for (const a of vorhanden) { if (a.kanal === 'push') await pushAlarmLoeschen(g.id); else mailAlarmVergessen(g.id); }
      toast(vorhanden.some(a => a.kanal === 'mail') ? 'Alarm gelöscht. E-Mail-Alarme bestellst du über den Link in der Mail ab.' : 'Alarm gelöscht.');
      dlg.close();
    } catch (e) { melden(e.message, true); }
  } }) : null;

  const form = h('form', { class: 'al-form', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    if (!Number.isInteger(wert) || wert < -500 || wert > 2000) { melden('Bitte einen Wert zwischen −500 und 2000 cm eingeben.', true); feld.focus(); return; }
    los.disabled = true; melden('Wird eingerichtet …');
    try {
      if (kanal === 'push') {
        const abo = await pushAbo();
        await api(PUSH_API, { aktion: 'anmelden', subscription: abo.toJSON(), pegel: g.id, richtung, wert });
        merken({ pegel: g.id, name: g.name, gewaesser: g.water, richtung, wert, kanal: 'push', erstellt: Date.now() });
        toast(`Alarm aktiv: Push, wenn ${g.name} ${schwelleText({ richtung, wert })}.`);
        dlg.close();
      } else {
        const email = mail.value.trim();
        if (!mail.checkValidity() || !email) { melden('Bitte eine gültige E-Mail-Adresse eingeben.', true); mail.focus(); los.disabled = false; return; }
        await api(MAIL_API, { aktion: 'anmelden', art: 'schwelle', email, pegel: g.id, richtung, wert, website: honig.value });
        merken({ pegel: g.id, name: g.name, gewaesser: g.water, richtung, wert, kanal: 'mail', erstellt: Date.now() });
        melden(`Fast geschafft: Wir haben dir eine Mail an ${email} geschickt. Bitte bestätige den Alarm über den Link darin.`);
        los.hidden = true;
      }
    } catch (err) { melden(err.message, true); }
    finally { los.disabled = false; }
  } },
    h('p', { class: 'al-h', text: 'Benachrichtige mich, wenn …' }), seg, stepper, hochwasser,
    h('p', { class: 'al-h', text: 'Wie?' }),
    h('div', { class: 'al-optionen', role: 'radiogroup', 'aria-label': 'Wie benachrichtigen?' },
      option('push', 'Push aufs Handy', pushSub, !pushGeht), option('mail', 'E-Mail', 'wie bisher')),
    anleitung, mailBox, meldung, los, loeschen,
    h('p', { class: 'al-fuss', text: 'Höchstens eine Nachricht pro Tag und Pegel. Jederzeit abbestellbar.' }));

  dlg = fenster({ inhalt: form, klasse: 'wxd-alarm', labelId: 'al-titel', opener, kopf: h('header', { class: 'wxd-kopf' },
    h('div', {}, h('h2', { id: 'al-titel', tabindex: '-1', text: 'Pegel-Alarm' }),
      h('p', { class: 'wxd-unter', text: [g.name, g.water, `jetzt ${Math.round(g.value).toLocaleString('de-DE')} cm`].filter(Boolean).join(' · ') })),
    h('button', { type: 'button', class: 'wxd-x', 'aria-label': 'Schließen', html: icon('close', 22), onclick: () => dlg.close() })) });
  return dlg;
}

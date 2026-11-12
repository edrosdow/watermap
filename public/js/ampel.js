// Einstiegsseite /pegel-ampel (Designumbau Phase 2b, 7.71.0). Die Pegel-Ampel selbst ist jetzt „Passt mein Boot?“ im Pegel-Sheet der Karte.
// Hier bleibt nur:
//  · ?pegel=<id>            → ./#karte/pegel/<id>   (alte Links, geteilte Ampel-Links, „Pegel ansehen“ aus den Alarm-Mails)
//  · #am-alarm              → mit Pegel: ./#karte/pegel/<id>/alarm (Alarm-Fenster), ohne: ./#pegel/suche
//  · ?alarm-bestaetigen=… / ?alarm-abmelden=…  Links aus den Alarm-Mails: erst diese Seite bestätigt per POST (Mail-Scanner lösen nichts aus).
const ALARM_API = '/.netlify/functions/pegel-alarm';
const params = new URLSearchParams(location.search);
const pegel = params.get('pegel');
const ja = params.get('alarm-bestaetigen'), nein = params.get('alarm-abmelden');
const zielPegel = (id, alarm = false) => `./#karte/pegel/${encodeURIComponent(id)}${alarm ? '/alarm' : ''}`;

async function alarmLink() {
  const u = new URL(location.href); u.searchParams.delete('alarm-bestaetigen'); u.searchParams.delete('alarm-abmelden');
  history.replaceState(null, '', u);   // Token nicht im Verlauf oder beim Teilen weitergeben
  const box = document.getElementById('pa-meldung');
  const melden = (text, fehler = false) => { box.textContent = text; box.hidden = false; box.classList.toggle('is-fehler', fehler); };
  melden(ja ? 'Alarm wird bestätigt …' : 'Alarm wird abbestellt …');
  if (pegel) { const k = document.getElementById('pa-suchen'); k.href = zielPegel(pegel); k.textContent = 'Pegel ansehen'; }
  try {
    const res = await fetch(ALARM_API, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ja ? { aktion: 'bestaetigen', token: ja } : { aktion: 'abmelden', token: nein }) });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(r.fehler || 'Das hat gerade nicht geklappt. Bitte später erneut versuchen.');
    melden(ja ? (r.art === 'schwelle'
      ? `Dein Pegel-Alarm für ${r.pegelName} ist aktiv. Wir melden uns, wenn der Pegel ${r.richtung === 'unter' ? 'unter' : 'über'} ${r.wert} cm liegt (höchstens eine Mail am Tag).`
      : `Dein Pegel-Alarm für ${r.pegelName} ist aktiv. Wir melden uns, wenn sich die Ampel ändert.`)
      : 'Dein Pegel-Alarm ist abbestellt. Wir schicken dir keine Mails mehr dazu.');
  } catch (err) { melden(err.message, true); }
}

if (ja || nein) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', alarmLink); else alarmLink();
} else if (pegel) location.replace(zielPegel(pegel, location.hash === '#am-alarm'));
else if (location.hash === '#am-alarm') location.replace('./#pegel/suche');

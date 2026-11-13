// „Angaben ergänzen“ zu einer Slipanlage oder einem Hafen (aus „Wichtig für dein Boot“; Häfen seit 8.0.8).
// Nur gewählte Angaben werden gesendet (Netlify-Formular „slip-ergaenzen“); leer = „weiß nicht“.
// Freigabe in der Verwaltung (/admin/fotos.html → Ergänzungen) schreibt sie nach community/overrides.json.
import { h } from './dom.js';
import { sendReport } from './forms.js';
import { displayName } from './model.js';
import { sheetOeffnen } from './bausteine.js';

/** Felder des Formulars. Werte sind die Schlüssel, die die Verwaltung kennt (netlify/functions/fotos.mjs → ERGAENZUNG). */
export const ERG_FELDER = [
  { key: 'access', titel: 'Zugang', art: 'seg', optionen: [['public', 'Öffentlich'], ['customers', 'Nur Kunden'], ['members', 'Nur Mitglieder'], ['private', 'Privat']] },
  { key: 'fee', titel: 'Gebühr', art: 'seg', optionen: [['kostenlos', 'Kostenlos'], ['kostenpflichtig', 'Kostenpflichtig']] },
  { key: 'rampe', titel: 'Rampe', art: 'rampe' },
  { key: 'trailer', titel: 'Trailer parken', art: 'seg', optionen: [['ja', 'Ja, am Slip'], ['naehe', 'In der Nähe'], ['nein', 'Nein']] },
  { key: 'motorboat', titel: 'Motorboote', art: 'seg', optionen: [['ja', 'Erlaubt'], ['nein', 'Nicht erlaubt']] },
  { key: 'boote', titel: 'Bootsgröße', art: 'seg', optionen: [['bis5', 'bis 5 m'], ['bis7', 'bis 7 m'], ['bis9', 'bis 9 m'], ['groesser', 'größer']] },
];
/** Felder für Häfen (8.0.8). Schlüssel kennt die Verwaltung (fotos.mjs → ERGAENZUNG); „liegegeld“ ist ein freier Text. */
const JN = [['ja', 'Ja'], ['nein', 'Nein']];
export const HAFEN_FELDER = [
  { key: 'access', titel: 'Zugang', art: 'seg', optionen: [['public', 'Öffentlich'], ['customers', 'Nur Kunden'], ['members', 'Nur Mitglieder'], ['private', 'Privat']] },
  { key: 'gast', titel: 'Gastliegeplätze', art: 'seg', optionen: JN },
  { key: 'liegegeld', titel: 'Liegegebühr', art: 'text', platzhalter: 'z. B. 1,50 € pro Meter und Nacht' },
  { key: 'strom', titel: 'Strom', art: 'seg', optionen: JN },
  { key: 'wasser', titel: 'Wasser', art: 'seg', optionen: JN },
  { key: 'toiletten', titel: 'Toiletten', art: 'seg', optionen: JN },
  { key: 'duschen', titel: 'Duschen', art: 'seg', optionen: JN },
  { key: 'hafenmeister', titel: 'Hafenmeister', art: 'seg', optionen: JN },
];
export const BELAG = ['Beton', 'Pflaster', 'Asphalt', 'Kies', 'Holz', 'Naturboden'];
export const NEIGUNG = ['flach', 'mittel', 'steil'];
const ACCESS_TEXT = { public: 'Öffentlich', permissive: 'Öffentlich (geduldet)', customers: 'Nur Kunden', members: 'Nur Mitglieder', permit: 'Mit Erlaubnis', private: 'Privat' };

/** Was zu diesem Standort schon bekannt ist: [{ key, text }] (Reihenfolge wie die Felder). */
export function bekannteAngaben(p) {
  const a = p.attrs || {}, out = [];
  if (p.type === 'marina') {
    const jn = (v) => (v === true ? 'Ja' : 'Nein');
    if (p.access) out.push({ key: 'access', text: ACCESS_TEXT[p.access] || p.access });
    if (a.visitor_berths === true || a.visitor_berths === false) out.push({ key: 'gast', text: jn(a.visitor_berths) });
    if (a.berth_fee) out.push({ key: 'liegegeld', text: a.berth_fee });
    for (const [key, attr] of [['strom', 'electricity'], ['wasser', 'water_tap'], ['toiletten', 'toilets'], ['duschen', 'showers'], ['hafenmeister', 'harbour_master']]) {
      if (a[attr] === true || a[attr] === false) out.push({ key, text: jn(a[attr]) });
    }
    return out;
  }
  if (p.access) out.push({ key: 'access', text: ACCESS_TEXT[p.access] || p.access });
  if (p.fee === true || p.fee === false) out.push({ key: 'fee', text: p.fee ? 'Kostenpflichtig' : 'Kostenlos' });
  if (a.surface || a.incline) out.push({ key: 'rampe', text: [a.surface, a.incline].filter(Boolean).join(' · '), teilweise: !(a.surface && a.incline) });
  if (a.trailer_parking === true || a.trailer_parking === false) out.push({ key: 'trailer', text: a.trailer_parking ? 'Ja' : 'Nein' });
  if (a.motorboat === true || a.motorboat === false) out.push({ key: 'motorboat', text: a.motorboat ? 'Erlaubt' : 'Nicht erlaubt' });
  if (a.suitable_boats) out.push({ key: 'boote', text: a.suitable_boats });
  return out;
}

/** Sheet öffnen (8.0.6: gemeinsamer Sheet-Rahmen, Auswahl als Chips, Felder wie im Designsystem). opts = { place, toast(text) } */
export function slipErgaenzen({ place: p, toast }) {
  let sh = null;
  const FELDER = p.type === 'marina' ? HAFEN_FELDER : ERG_FELDER;
  const bekannt = bekannteAngaben(p);
  const bekanntKeys = new Set(bekannt.filter(b => !b.teilweise).map(b => b.key));
  const wahl = {};            // key → Wert (nur Gewähltes)
  let aendern = !FELDER.some(f => !bekanntKeys.has(f.key));   // alles bekannt → gleich alle Felder zeigen

  const senden = h('button', { type: 'submit', class: 'wm-btn is-primaer ae-senden' });
  const fehler = h('p', { class: 'ae-fehler', role: 'alert', hidden: true });
  const feeNote = h('input', { type: 'text', class: 'wm-eingabe ae-ein', name: 'fee_note', maxlength: 80, autocomplete: 'off', placeholder: 'Betrag (optional), z. B. 5 € pro Slipvorgang', hidden: true });
  const bemerkung = h('textarea', { id: 'ae-bemerkung', class: 'wm-eingabe ae-text', name: 'bemerkung', rows: 2, maxlength: 300, placeholder: 'z. B. Schlüssel beim Hafenmeister' });

  const zaehlen = () => {
    const n = Object.keys(wahl).length;
    senden.disabled = n === 0 && !bemerkung.value.trim();
    senden.textContent = n ? `${n} ${n === 1 ? 'Angabe' : 'Angaben'} senden` : (bemerkung.value.trim() ? 'Hinweis senden' : 'Nichts ausgewählt');
  };

  function seg(f) {
    const tipp = h('p', { class: 'ae-tipp', hidden: !(f.key in wahl), text: 'Nochmal antippen hebt die Auswahl auf.' });
    const knoepfe = f.optionen.map(([wert, text]) => h('button', { type: 'button', class: 'wm-chip ae-opt', 'aria-pressed': String(wahl[f.key] === wert), dataset: { wert }, text,
      onclick: (e) => {
        const an = wahl[f.key] !== wert;
        if (an) wahl[f.key] = wert; else delete wahl[f.key];
        for (const k of knoepfe) k.setAttribute('aria-pressed', String(an && k === e.currentTarget));
        tipp.hidden = !an;
        if (f.key === 'fee') { feeNote.hidden = wahl.fee !== 'kostenpflichtig'; if (feeNote.hidden) feeNote.value = ''; }
        zaehlen();
      } }));
    return [h('div', { class: 'ae-chips', role: 'group', 'aria-label': f.titel }, knoepfe), f.key === 'fee' ? feeNote : null, tipp];
  }
  function rampe() {
    const auswahl = (name, titel, werte) => {
      const sel = h('select', { class: 'wm-eingabe ae-ein', name, onchange: () => { if (sel.value) wahl[name] = sel.value; else delete wahl[name]; zaehlen(); } },
        h('option', { value: '', text: '– weiß nicht –' }), werte.map(v => h('option', { value: v, text: v, selected: wahl[name] === v })));
      return h('label', { class: 'ae-wahl' }, h('span', { text: titel }), sel);
    };
    return [h('div', { class: 'ae-paar' }, auswahl('surface', 'Belag', BELAG), auswahl('incline', 'Neigung', NEIGUNG))];
  }
  function textFeld(f) {
    const ein = h('input', { type: 'text', class: 'wm-eingabe ae-ein', name: f.key, maxlength: 80, autocomplete: 'off', placeholder: f.platzhalter || '', value: wahl[f.key] || '',
      oninput: () => { const v = ein.value.trim(); if (v) wahl[f.key] = v; else delete wahl[f.key]; zaehlen(); } });
    return [ein];
  }
  const feld = (f) => h('fieldset', { class: 'ae-feld', dataset: { key: f.key } }, h('legend', { text: f.titel }), ...(f.art === 'rampe' ? rampe() : f.art === 'text' ? textFeld(f) : seg(f)));

  const fehlend = FELDER.filter(f => !bekanntKeys.has(f.key));
  const felderBox = h('div', { class: 'ae-felder' });
  const zeichneFelder = () => {
    const liste = aendern ? FELDER : fehlend;
    felderBox.replaceChildren(
      h('p', { class: 'ae-teil', text: aendern ? 'Alle Angaben' : `Es ${fehlend.length === 1 ? 'fehlt' : 'fehlen'} noch ${fehlend.length} ${fehlend.length === 1 ? 'Angabe' : 'Angaben'}` }),
      ...liste.map(feld));
  };
  const bekanntZeile = bekannt.length ? h('div', { class: 'ae-bekannt' }, h('i', { 'aria-hidden': 'true' }),
    h('span', {}, 'Schon bekannt: ', h('strong', { text: bekannt.map(b => `${FELDER.find(f => f.key === b.key).titel} · ${b.text}`).join(', ') })),
    aendern ? null : h('button', { type: 'button', class: 'ae-aendern', text: 'ändern', onclick: (e) => {
      aendern = true; e.currentTarget.remove();
      zeichneFelder(); zaehlen(); felderBox.querySelector('button, select')?.focus();
    } })) : null;
  zeichneFelder();

  const form = h('form', { class: 'ae-form', novalidate: true },
    h('p', { class: 'ae-hinweis', text: 'Nur ausfüllen, was du sicher weißt – Leeres bleibt „unbekannt“.' }),
    bekanntZeile, felderBox,
    h('p', { class: 'ae-teil', text: 'Optional' }),
    h('div', { class: 'ae-feld ae-bem wm-feld' }, h('label', { for: 'ae-bemerkung', text: 'Noch etwas?' }), bemerkung),
    fehler,
    h('div', { class: 'ae-knoepfe' }, h('button', { type: 'button', class: 'wm-btn ae-abbrechen', text: 'Abbrechen', onclick: () => schliessen() }), senden));
  bemerkung.addEventListener('input', zaehlen);
  zaehlen();

  function schliessen() { sh?.schliessen({ durchNutzer: true }); }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (senden.disabled) return;
    const angaben = { ...wahl };
    if (angaben.fee === 'kostenpflichtig' && feeNote.value.trim()) angaben.fee_note = feeNote.value.trim().slice(0, 80);
    const fd = new FormData();
    fd.set('form-name', 'slip-ergaenzen'); fd.set('bot-field', '');
    fd.set('standort_id', p.id); fd.set('standort_name', displayName(p));
    fd.set('angaben', JSON.stringify(angaben)); fd.set('bemerkung', bemerkung.value.trim().slice(0, 300));
    senden.disabled = true; senden.textContent = 'Wird gesendet …'; fehler.hidden = true;
    try {
      await sendReport(fd);
      sh?.schliessen();
      toast?.('Danke! Deine Angaben werden geprüft und erscheinen danach für alle.');
    } catch (ex) {
      fehler.textContent = ex.message; fehler.hidden = false; zaehlen();
    }
  });

  sh = sheetOeffnen({ inhalt: form, kopf: { titel: 'Angaben ergänzen', titelId: 'ae-titel', unter: [displayName(p), p.water?.name].filter(Boolean).join(' · ') },
    klasse: 'ae-sheet', stufe: 'gross', verlauf: true });
  return sh;
}

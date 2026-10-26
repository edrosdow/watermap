// „Angaben ergänzen“ zu einer Slipanlage (aus „Wichtig für dein Boot“).
// Nur gewählte Angaben werden gesendet (Netlify-Formular „slip-ergaenzen“); leer = „weiß nicht“.
// Freigabe in der Verwaltung (/admin/fotos.html → Ergänzungen) schreibt sie nach community/overrides.json.
import { h } from './dom.js';
import { icon } from './icons.js';
import { sendReport } from './forms.js';
import { displayName } from './model.js';

/** Felder des Formulars. Werte sind die Schlüssel, die die Verwaltung kennt (netlify/functions/fotos.mjs → ERGAENZUNG). */
export const ERG_FELDER = [
  { key: 'access', titel: 'Zugang', art: 'seg', optionen: [['public', 'Öffentlich'], ['customers', 'Nur Kunden'], ['members', 'Nur Mitglieder'], ['private', 'Privat']] },
  { key: 'fee', titel: 'Gebühr', art: 'seg', optionen: [['kostenlos', 'Kostenlos'], ['kostenpflichtig', 'Kostenpflichtig']] },
  { key: 'rampe', titel: 'Rampe', art: 'rampe' },
  { key: 'trailer', titel: 'Trailer parken', art: 'seg', optionen: [['ja', 'Ja, am Slip'], ['naehe', 'In der Nähe'], ['nein', 'Nein']] },
  { key: 'motorboat', titel: 'Motorboote', art: 'seg', optionen: [['ja', 'Erlaubt'], ['nein', 'Nicht erlaubt']] },
  { key: 'boote', titel: 'Bootsgröße', art: 'seg', optionen: [['bis5', 'bis 5 m'], ['bis7', 'bis 7 m'], ['bis9', 'bis 9 m'], ['groesser', 'größer']] },
];
export const BELAG = ['Beton', 'Pflaster', 'Asphalt', 'Kies', 'Holz', 'Naturboden'];
export const NEIGUNG = ['flach', 'mittel', 'steil'];
const ACCESS_TEXT = { public: 'Öffentlich', permissive: 'Öffentlich (geduldet)', customers: 'Nur Kunden', members: 'Nur Mitglieder', permit: 'Mit Erlaubnis', private: 'Privat' };

/** Was zu dieser Slipanlage schon bekannt ist: [{ key, text }] (Reihenfolge wie ERG_FELDER). */
export function bekannteAngaben(p) {
  const a = p.attrs || {}, out = [];
  if (p.access) out.push({ key: 'access', text: ACCESS_TEXT[p.access] || p.access });
  if (p.fee === true || p.fee === false) out.push({ key: 'fee', text: p.fee ? 'Kostenpflichtig' : 'Kostenlos' });
  if (a.surface || a.incline) out.push({ key: 'rampe', text: [a.surface, a.incline].filter(Boolean).join(' · '), teilweise: !(a.surface && a.incline) });
  if (a.trailer_parking === true || a.trailer_parking === false) out.push({ key: 'trailer', text: a.trailer_parking ? 'Ja' : 'Nein' });
  if (a.motorboat === true || a.motorboat === false) out.push({ key: 'motorboat', text: a.motorboat ? 'Erlaubt' : 'Nicht erlaubt' });
  if (a.suitable_boats) out.push({ key: 'boote', text: a.suitable_boats });
  return out;
}

/** Fenster öffnen. opts = { place, toast(text) } */
export function slipErgaenzen({ place: p, toast }) {
  const vorher = document.activeElement;
  const bekannt = bekannteAngaben(p);
  const bekanntKeys = new Set(bekannt.filter(b => !b.teilweise).map(b => b.key));
  const wahl = {};            // key → Wert (nur Gewähltes)
  let aendern = !ERG_FELDER.some(f => !bekanntKeys.has(f.key));   // alles bekannt → gleich alle Felder zeigen

  const senden = h('button', { type: 'submit', class: 'ae-senden' });
  const fehler = h('p', { class: 'ae-fehler', role: 'alert', hidden: true });
  const feeNote = h('input', { type: 'text', class: 'ae-ein', name: 'fee_note', maxlength: 80, autocomplete: 'off', placeholder: 'Betrag (optional), z. B. 5 € pro Slipvorgang', hidden: true });
  const bemerkung = h('textarea', { class: 'ae-ein ae-text', name: 'bemerkung', rows: 2, maxlength: 300, placeholder: 'z. B. Schlüssel beim Hafenmeister' });

  const zaehlen = () => {
    const n = Object.keys(wahl).length;
    senden.disabled = n === 0 && !bemerkung.value.trim();
    senden.textContent = n ? `${n} ${n === 1 ? 'Angabe' : 'Angaben'} senden` : (bemerkung.value.trim() ? 'Hinweis senden' : 'Nichts ausgewählt');
  };

  function seg(f) {
    const tipp = h('p', { class: 'ae-tipp', hidden: !(f.key in wahl), text: 'Nochmal antippen hebt die Auswahl auf.' });
    const knoepfe = f.optionen.map(([wert, text]) => h('button', { type: 'button', class: 'ae-opt', 'aria-pressed': String(wahl[f.key] === wert), dataset: { wert }, text,
      onclick: (e) => {
        const an = wahl[f.key] !== wert;
        if (an) wahl[f.key] = wert; else delete wahl[f.key];
        for (const k of knoepfe) k.setAttribute('aria-pressed', String(an && k === e.currentTarget));
        tipp.hidden = !an;
        if (f.key === 'fee') { feeNote.hidden = wahl.fee !== 'kostenpflichtig'; if (feeNote.hidden) feeNote.value = ''; }
        zaehlen();
      } }));
    return [h('div', { class: 'ae-seg', role: 'group', 'aria-label': f.titel }, knoepfe), f.key === 'fee' ? feeNote : null, tipp];
  }
  function rampe() {
    const auswahl = (name, titel, werte) => {
      const sel = h('select', { class: 'ae-ein', name, onchange: () => { if (sel.value) wahl[name] = sel.value; else delete wahl[name]; zaehlen(); } },
        h('option', { value: '', text: '– weiß nicht –' }), werte.map(v => h('option', { value: v, text: v, selected: wahl[name] === v })));
      return h('label', { class: 'ae-wahl' }, h('span', { text: titel }), sel);
    };
    return [h('div', { class: 'ae-paar' }, auswahl('surface', 'Belag', BELAG), auswahl('incline', 'Neigung', NEIGUNG))];
  }
  const feld = (f) => h('fieldset', { class: 'ae-feld', dataset: { key: f.key } }, h('legend', { text: f.titel }), ...(f.art === 'rampe' ? rampe() : seg(f)));

  const fehlend = ERG_FELDER.filter(f => !bekanntKeys.has(f.key));
  const felderBox = h('div', { class: 'ae-felder' });
  const zeichneFelder = () => {
    const liste = aendern ? ERG_FELDER : fehlend;
    felderBox.replaceChildren(
      h('p', { class: 'ae-teil', text: aendern ? 'Alle Angaben' : `Es ${fehlend.length === 1 ? 'fehlt' : 'fehlen'} noch ${fehlend.length} ${fehlend.length === 1 ? 'Angabe' : 'Angaben'}` }),
      ...liste.map(feld));
  };
  const bekanntZeile = bekannt.length ? h('div', { class: 'ae-bekannt' }, h('i', { 'aria-hidden': 'true' }),
    h('span', {}, 'Schon bekannt: ', h('strong', { text: bekannt.map(b => `${ERG_FELDER.find(f => f.key === b.key).titel} · ${b.text}`).join(', ') })),
    aendern ? null : h('button', { type: 'button', class: 'ae-aendern', text: 'ändern', onclick: (e) => {
      aendern = true; e.currentTarget.remove();
      zeichneFelder(); zaehlen(); felderBox.querySelector('button, select')?.focus();
    } })) : null;
  zeichneFelder();

  const form = h('form', { class: 'ae-form', novalidate: true },
    h('div', { class: 'ae-kopf' }, h('h2', { id: 'ae-titel', text: 'Angaben ergänzen' }),
      h('p', { text: [displayName(p), p.water?.name].filter(Boolean).join(' · ') }),
      h('button', { type: 'button', class: 'ae-zu', 'aria-label': 'Schließen', html: icon('close', 22), onclick: () => schliessen() })),
    h('p', { class: 'ae-hinweis', text: 'Nur ausfüllen, was du sicher weißt – Leeres bleibt „unbekannt“.' }),
    bekanntZeile, felderBox,
    h('p', { class: 'ae-teil', text: 'Optional' }),
    h('label', { class: 'ae-feld ae-bem' }, h('span', { class: 'ae-legende', text: 'Noch etwas?' }), bemerkung),
    h('div', { class: 'ae-fuss' }, fehler, h('div', { class: 'ae-knoepfe' },
      h('button', { type: 'button', class: 'ae-abbrechen', text: 'Abbrechen', onclick: () => schliessen() }), senden)));
  bemerkung.addEventListener('input', zaehlen);
  zaehlen();

  const dlg = h('dialog', { class: 'ae-dlg', 'aria-labelledby': 'ae-titel' }, form);
  function schliessen() { if (dlg.open) dlg.close(); dlg.remove(); if (vorher?.isConnected) vorher.focus(); }
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); schliessen(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) schliessen(); });

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
      schliessen();
      toast?.('Danke! Deine Angaben werden geprüft und erscheinen danach für alle.');
    } catch (ex) {
      fehler.textContent = ex.message; fehler.hidden = false; zaehlen();
    }
  });

  document.body.append(dlg);
  dlg.showModal();
  dlg.querySelector('.ae-opt, select')?.focus();
  return dlg;
}

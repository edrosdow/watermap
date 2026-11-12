// „Unpassend melden“ für Lagemeldungen („Heute vor Ort“, „Aktuelle Meldungen“).
// Der Hinweis geht über das vorhandene Netlify-Formular „fehler-melden“ (Art „meldung“, mit Meldung-ID) an die Verwaltung
// (/admin/fotos.html → Hinweise → „Meldung entfernen“). Auf diesem Gerät wird die Meldung sofort ausgeblendet.
import { h } from './dom.js';
import { icon } from './icons.js';
import { sendReport } from './forms.js';
import { TYPEN, alter, ausblenden } from './meldungen.js';

const GRUENDE = ['Beleidigend', 'Werbung / Spam', 'Persönliche Daten', 'Falsch / Unsinn', 'Sonstiges'];

/** Fenster öffnen. opts = { meldung, ortName, toast(text), onFertig() } */
export function unpassendMelden({ meldung: m, ortName = '', toast, onFertig }) {
  const vorher = document.activeElement;
  const t = TYPEN[m.typ] || TYPEN.hindernis;
  let grund = null;
  const fehler = h('p', { class: 'um-fehler', role: 'alert', hidden: true });
  const senden = h('button', { type: 'submit', class: 'um-senden', text: 'Hinweis senden', disabled: true });
  const gruende = h('div', { class: 'um-gruende' }, GRUENDE.map(g => h('label', { class: 'um-grund' },
    h('input', { type: 'radio', name: 'um-grund', value: g, onchange: () => { grund = g; senden.disabled = false; fehler.hidden = true; } }), h('span', { text: g }))));
  const form = h('form', { class: 'um-form', method: 'dialog', novalidate: true },
    h('h2', { id: 'um-titel', text: 'Meldung als unpassend melden?' }),
    h('div', { class: 'um-zitat' },
      h('small', { text: [t.text, ortName, alter(m.erstelltAm)].filter(Boolean).join(' · ') }),
      h('span', { text: `„${m.notiz || ''}“` })),
    h('fieldset', { class: 'um-feld' }, h('legend', { text: 'Warum?' }), gruende),
    h('p', { class: 'um-hinweis', text: 'Die Meldung wird für dich sofort ausgeblendet. WaterMap prüft den Hinweis und entfernt die Meldung, wenn sie gegen die Regeln verstößt.' }),
    fehler,
    h('div', { class: 'um-knoepfe' },
      h('button', { type: 'button', class: 'um-abbrechen', text: 'Abbrechen', onclick: () => schliessen() }),
      senden));
  const dlg = h('dialog', { class: 'um-dlg', 'aria-labelledby': 'um-titel' },
    h('button', { type: 'button', class: 'um-zu', 'aria-label': 'Schließen', html: icon('close', 22), onclick: () => schliessen() }), form);

  function schliessen() {
    if (dlg.open) dlg.close();
    dlg.remove();
    if (vorher?.isConnected) vorher.focus();
  }
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); schliessen(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) schliessen(); });   // Tipp auf den Hintergrund

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!grund) return;
    senden.disabled = true; senden.textContent = 'Wird gesendet …'; fehler.hidden = true;
    const fd = new FormData();
    fd.set('form-name', 'fehler-melden'); fd.set('bot-field', '');
    fd.set('standort_id', m.standortId || ''); fd.set('standort_name', ortName);
    fd.set('art', 'meldung');
    fd.set('details', [`Lagemeldung unpassend`, `Meldung-ID: ${m.id}`, `Art: ${t.text}`, `Notiz: „${m.notiz || ''}“`,
      `Gemeldet: ${new Date(m.erstelltAm).toLocaleString('de-DE')}`, `Grund: ${grund}`].join('\n'));
    fd.set('kontakt', '');
    try {
      await sendReport(fd);
      ausblenden(m.id);
      schliessen();
      toast?.('Danke – Hinweis gesendet. Die Meldung ist für dich ausgeblendet.');
      onFertig?.();
    } catch (ex) {
      fehler.textContent = ex.message; fehler.hidden = false;
      senden.disabled = false; senden.textContent = 'Hinweis senden';
    }
  });

  document.body.append(dlg);
  dlg.showModal();
  dlg.querySelector('input')?.focus();
  return dlg;
}

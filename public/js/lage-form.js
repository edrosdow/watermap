// „Wie ist die Lage?“ – Lagemeldung mit zwei Tipps (Kachel wählen, senden).
// 8.0.6 (Nutzer): im gemeinsamen Sheet-Rahmen wie alle anderen Sheets (Handy von unten, Desktop Panel rechts; Wischen, Esc und
// Zurück-Taste schließen). Aus dem Melden-Menü geöffnet, liegt das Sheet darüber – Schließen führt zurück zur Auswahl.
import { h, announce } from './dom.js';
import { icon } from './icons.js';
import { displayName, formatDistance } from './model.js';
import { TYPEN, NOTIZ_MAX, senden } from './meldungen.js';
import { sheetOeffnen } from './bausteine.js';

/**
 * opts = { place, distance (m, optional), opener, onSent(meldungen), toast }
 * Rückgabe: das Sheet ({ el, schliessen() … }).
 */
export function openLageForm({ place: p, distance = null, opener = null, onSent, toast }) {
  let typ = null, busy = false, sh = null;

  const unter = [displayName(p), p.water?.name, distance !== null ? `du bist ${formatDistance(distance)} entfernt` : null].filter(Boolean).join(' · ');

  const tiles = Object.entries(TYPEN).map(([key, t]) => h('button', { type: 'button', class: `lf-tile lf-${t.ton}`, 'aria-pressed': 'false', dataset: { typ: key },
    onclick: (e) => {
      typ = key;
      for (const b of grid.children) b.setAttribute('aria-pressed', String(b === e.currentTarget));
      update();
    } }, h('span', { class: 'lf-ico', html: icon(t.ico, 26) }), h('span', { text: t.text })));
  const grid = h('div', { class: 'lf-grid', role: 'group', 'aria-label': 'Wie ist die Lage?' }, tiles);

  const count = h('span', { class: 'lf-count', 'aria-live': 'polite', text: `0 / ${NOTIZ_MAX}` });
  const note = h('input', { type: 'text', id: 'lf-note', class: 'wm-eingabe', maxlength: NOTIZ_MAX, autocomplete: 'off', enterkeyhint: 'send', placeholder: 'z. B. Ausweichparkplatz am Waldweg',
    oninput: () => { count.textContent = `${[...note.value].length} / ${NOTIZ_MAX}`; } });
  const noteSec = h('div', { class: 'wm-feld lf-notiz' },
    h('div', { class: 'lf-note-head' }, h('label', { for: 'lf-note' }, 'Notiz ', h('span', { class: 'lf-opt', text: '(optional)' })), count), note);

  const status = h('p', { class: 'lf-status', role: 'status', 'aria-live': 'polite', hidden: true });
  const sendBtn = h('button', { type: 'submit', class: 'wm-btn is-primaer lf-send', text: 'Meldung senden', 'aria-disabled': 'true' });
  const form = h('form', { class: 'lf-form', novalidate: true, autocomplete: 'off' }, grid, noteSec, status, sendBtn,
    h('p', { class: 'lf-hinweis', text: 'Öffentlich sichtbar · verschwindet nach 24 Stunden' }));

  function update() {
    const ok = !!typ && !busy && navigator.onLine !== false;
    sendBtn.classList.toggle('is-ready', ok);
    sendBtn.setAttribute('aria-disabled', ok ? 'false' : 'true');
  }
  const zeige = (text) => { status.hidden = false; status.textContent = text; announce(text); };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!typ) return zeige('Bitte zuerst antippen, wie die Lage ist.');
    if (navigator.onLine === false) return zeige('Keine Verbindung, bitte später erneut versuchen.');
    busy = true; update();
    sendBtn.textContent = 'Wird gesendet …'; sendBtn.setAttribute('aria-busy', 'true');
    try {
      const j = await senden(p.id, typ, note.value.trim());
      sh?.schliessen();
      toast?.('Danke! Deine Meldung ist jetzt sichtbar.');
      onSent?.(j.meldungen || []);
    } catch (ex) {
      busy = false; sendBtn.textContent = 'Meldung senden'; sendBtn.removeAttribute('aria-busy'); update();
      zeige(ex.message);
    }
  });

  update();
  sh = sheetOeffnen({ inhalt: form, kopf: { titel: 'Wie ist die Lage?', titelId: 'lf-titel', unter }, klasse: 'lf-sheet', stufe: 'gross', verlauf: true, opener });
  return sh;
}

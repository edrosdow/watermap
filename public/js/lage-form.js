// „Wie ist die Lage?“ – Lagemeldung mit zwei Tipps (Kachel wählen, senden). Im Formular-Dialog (#dlg), auf dem Handy als Bottom-Sheet.
import { h, clear, $, announce } from './dom.js';
import { icon, glyphSvg } from './icons.js';
import { displayName, formatDistance } from './model.js';
import { TYPEN, NOTIZ_MAX, senden } from './meldungen.js';

/**
 * opts = { dialog, place, distance (m, optional), onBack (zurück zu „Was möchtest du melden?“), onSent(meldungen), toast }
 */
export function openLageForm({ dialog: dlg, place: p, distance = null, onBack, onSent, toast }) {
  const root = clear($('#dlg-body', dlg));
  dlg.classList.add('dialog-photo', 'dialog-lage');
  dlg.addEventListener('close', () => dlg.classList.remove('dialog-photo', 'dialog-lage'), { once: true });
  let typ = null, busy = false;

  const title = h('h2', { id: 'dlg-title', class: 'pf-title', tabindex: '-1', text: 'Wie ist die Lage?' });
  const head = h('header', { class: 'pf-head lf-head' }, h('span', { class: 'pf-grip', 'aria-hidden': 'true' }),
    onBack ? h('button', { type: 'button', class: 'lf-back', 'aria-label': 'Zurück', html: icon('back', 22), onclick: () => { dlg.close(); onBack(); } }) : null,
    title,
    h('button', { type: 'button', class: 'pf-x', 'aria-label': 'Schließen', html: icon('close', 22), onclick: () => dlg.close() }));

  const sub = [p.water?.name, distance !== null ? `du bist ${formatDistance(distance)} entfernt` : null].filter(Boolean).join(' · ');
  const place = h('div', { class: 'pf-place' },
    h('span', { class: 'pf-place-ico', html: glyphSvg(p.type, 28) }),
    h('span', { class: 'pf-place-text' }, h('strong', { text: displayName(p) }), sub ? h('small', { text: sub }) : null));

  const tiles = Object.entries(TYPEN).map(([key, t]) => h('button', { type: 'button', class: `lf-tile lf-${t.ton}`, 'aria-pressed': 'false', dataset: { typ: key },
    onclick: (e) => {
      typ = key;
      for (const b of grid.children) b.setAttribute('aria-pressed', String(b === e.currentTarget));
      update();
    } }, h('span', { class: 'lf-ico', html: icon(t.ico, 26) }), h('span', { text: t.text })));
  const grid = h('div', { class: 'lf-grid', role: 'group', 'aria-label': 'Wie ist die Lage?' }, tiles);

  const count = h('span', { class: 'lf-count', 'aria-live': 'polite', text: `0 / ${NOTIZ_MAX}` });
  const note = h('input', { type: 'text', id: 'lf-note', maxlength: NOTIZ_MAX, autocomplete: 'off', enterkeyhint: 'send', placeholder: 'z. B. Ausweichparkplatz am Waldweg',
    oninput: () => { count.textContent = `${[...note.value].length} / ${NOTIZ_MAX}`; } });
  const noteSec = h('div', { class: 'pf-sec' },
    h('div', { class: 'lf-note-head' }, h('label', { class: 'pf-label', for: 'lf-note' }, 'Notiz ', h('span', { class: 'pf-opt', text: '(optional)' })), count), note);

  const status = h('p', { class: 'pf-status', role: 'status', 'aria-live': 'polite', hidden: true });
  const sendBtn = h('button', { type: 'submit', class: 'pf-send lf-send', text: 'Meldung senden', 'aria-disabled': 'true' });
  const foot = h('footer', { class: 'pf-foot' }, status, sendBtn, h('p', { class: 'pf-consent', text: 'Öffentlich sichtbar · verschwindet nach 24 Stunden' }));
  const form = h('form', { class: 'pf-form', novalidate: true, autocomplete: 'off' }, h('div', { class: 'pf-scroll' }, place, grid, noteSec), foot);

  function update() {
    const ok = !!typ && !busy && navigator.onLine !== false;
    sendBtn.classList.toggle('is-ready', ok);
    sendBtn.setAttribute('aria-disabled', ok ? 'false' : 'true');
  }
  const zeige = (text) => { status.hidden = false; status.className = 'pf-status error'; status.textContent = text; announce(text); };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!typ) return zeige('Bitte zuerst antippen, wie die Lage ist.');
    if (navigator.onLine === false) return zeige('Keine Verbindung, bitte später erneut versuchen.');
    busy = true; update();
    sendBtn.textContent = 'Wird gesendet …'; sendBtn.setAttribute('aria-busy', 'true');
    try {
      const j = await senden(p.id, typ, note.value.trim());
      dlg.close();
      toast?.('Danke! Deine Meldung ist jetzt sichtbar.');
      onSent?.(j.meldungen || []);
    } catch (ex) {
      busy = false; sendBtn.textContent = 'Meldung senden'; sendBtn.removeAttribute('aria-busy'); update();
      zeige(ex.message);
    }
  });

  update();
  root.append(head, form);
  dlg.setAttribute('aria-labelledby', 'dlg-title');
  if (!dlg.open) dlg.showModal();
  title.focus();
}

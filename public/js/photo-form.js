// „Foto hinzufügen“: eigenes, fotozentriertes Formular im Dialog (Bottom-Sheet auf dem Handy).
// Versand wie alle Meldungen über Netlify Forms (Formular „foto-einreichen“), Prüfung vor Veröffentlichung.
// Das Bild wird schon beim Auswählen geprüft und neu kodiert – dabei gehen EXIF-/GPS-Daten verloren.
import { h, clear, $, announce } from './dom.js';
import { icon, glyphSvg } from './icons.js';
import { displayName } from './model.js';
import { prepareImage, sendReport } from './forms.js';
import { FOTO_KATEGORIEN } from './foto-kategorien.js';

export const NOTIZ_MAX = 140;

const fmtSize = (b) => b >= 1024 * 1024
  ? `${(b / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`
  : `${Math.max(1, Math.round(b / 1024))} KB`;

/** ctx und preset wie bei openForm (forms.js). */
export function openPhotoForm(ctx, preset = {}) {
  const dlg = ctx.dialog;
  const root = clear($('#dlg-body', dlg));
  dlg.classList.add('dialog-photo');
  dlg.addEventListener('close', () => { dlg.classList.remove('dialog-photo'); revoke(); }, { once: true });

  const p = preset.standort_id ? ctx.places.find(x => x.id === preset.standort_id) : null;
  const state = { file: null, name: '', url: null, busy: false, preparing: 0 };
  const revoke = () => { if (state.url) URL.revokeObjectURL(state.url); state.url = null; };

  // ---- Kopfzeile
  const title = h('h2', { id: 'dlg-title', class: 'pf-title', tabindex: '-1', text: 'Foto hinzufügen' });
  const head = h('header', { class: 'pf-head' }, h('span', { class: 'pf-grip', 'aria-hidden': 'true' }), title,
    h('button', { type: 'button', class: 'pf-x', 'aria-label': 'Schließen', html: icon('close', 22), onclick: () => dlg.close() }));

  // ---- Standort
  const idIn = h('input', { type: 'hidden', name: 'standort_id', value: p ? p.id : '' });
  const nameIn = h('input', { type: 'hidden', name: 'standort_name', value: p ? displayName(p) : '' });
  const sub = p ? [p.water?.name, `${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}`].filter(Boolean).join(' · ') : 'Bitte auf der Karte antippen';
  const place = h('div', { class: 'pf-place' },
    h('span', { class: 'pf-place-ico', html: p ? glyphSvg(p.type, 28) : icon('pin', 22) }),
    h('span', { class: 'pf-place-text' }, h('strong', { text: p ? displayName(p) : 'Kein Standort gewählt' }), h('small', { text: sub })),
    ctx.choosePlace ? h('button', { type: 'button', class: 'pf-link', text: p ? 'Ändern' : 'Wählen', 'aria-label': p ? 'Standort ändern' : 'Standort wählen',
      onclick: () => ctx.choosePlace('foto-einreichen', { entwurf: entwurf() }) }) : null,
    idIn, nameIn);

  // ---- Foto
  const accept = 'image/jpeg,image/png,image/webp';
  const camIn = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'pf-file', tabindex: '-1', 'aria-hidden': 'true', 'data-quelle': 'kamera' });
  const galIn = h('input', { type: 'file', accept, class: 'pf-file', tabindex: '-1', 'aria-hidden': 'true', 'data-quelle': 'galerie' });
  const pick = (input) => { input.value = ''; input.click(); };
  const photoErr = h('p', { class: 'pf-error', role: 'alert', hidden: true });
  const photoOk = h('p', { class: 'pf-ok', hidden: true });
  const photo = h('div', { class: 'pf-photo' });

  const drawEmpty = () => photo.replaceChildren(h('div', { class: 'pf-drop' },
    h('span', { class: 'pf-cam', html: icon('camera', 30) }),
    h('p', { class: 'pf-drop-title', text: 'Zeig anderen, wie es hier aussieht' }),
    h('p', { class: 'pf-drop-sub', text: 'JPEG, PNG oder WebP · bis 5 MB' }),
    h('div', { class: 'pf-pick' },
      h('button', { type: 'button', class: 'pf-btn pf-btn-fill', html: icon('camera', 20) + '<span>Kamera</span>', onclick: () => pick(camIn) }),
      h('button', { type: 'button', class: 'pf-btn pf-btn-line', text: 'Galerie', onclick: () => pick(galIn) }))));
  const drawPreview = () => photo.replaceChildren(h('div', { class: 'pf-preview' },
    h('img', { src: state.url, alt: 'Vorschau deines Fotos' }),
    h('button', { type: 'button', class: 'pf-remove', 'aria-label': 'Foto entfernen', html: icon('close', 20), onclick: removePhoto }),
    h('button', { type: 'button', class: 'pf-again', text: 'Anderes Foto', onclick: () => pick(galIn) })));
  const drawBusy = () => photo.replaceChildren(h('div', { class: 'pf-drop is-busy', 'aria-busy': 'true' },
    h('span', { class: 'pf-cam', html: icon('camera', 30) }), h('p', { class: 'pf-drop-title', text: 'Foto wird aufbereitet …' })));

  function removePhoto() {
    revoke(); state.file = null; state.name = '';
    photoOk.hidden = true; photoErr.hidden = true;
    drawEmpty(); update();
    photo.querySelector('button')?.focus();
    announce('Foto entfernt.');
  }

  async function onFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const run = ++state.preparing;
    photoErr.hidden = true; photoOk.hidden = true;
    drawBusy();
    try {
      const clean = await prepareImage(f);
      if (run !== state.preparing) return;
      showPhoto(clean, f.name || 'Foto');
      announce('Foto gewählt. GPS-Daten entfernt.');
    } catch (ex) {
      if (run !== state.preparing) return;
      revoke(); state.file = null;
      drawEmpty();
      photoErr.textContent = ex.message || 'Das Foto konnte nicht verwendet werden.';
      photoErr.hidden = false;
    }
    update();
  }
  camIn.addEventListener('change', onFile);
  galIn.addEventListener('change', onFile);
  function showPhoto(file, name) {
    revoke();
    state.file = file; state.name = name; state.url = URL.createObjectURL(file);
    drawPreview();
    photoOk.replaceChildren(h('span', { class: 'pf-ok-ico', html: icon('check', 14) }), h('span', { text: `${name} · ${fmtSize(file.size)} · GPS-Daten entfernt` }));
    photoOk.hidden = false;
  }
  drawEmpty();

  // ---- Kategorie (Pflicht, genau eine)
  const katIn = h('input', { type: 'hidden', name: 'kategorie', value: '' });
  const kacheln = Object.entries(FOTO_KATEGORIEN).map(([key, k]) => h('button', { type: 'button', class: 'pf-kat', 'aria-pressed': 'false', dataset: { kat: key },
    onclick: () => katWaehlen(key) }, h('span', { class: 'pf-kat-ico', html: icon(k.ico, 24), 'aria-hidden': 'true' }), h('span', { text: k.text })));
  function katWaehlen(key) {
    katIn.value = key;
    for (const b of kacheln) b.setAttribute('aria-pressed', String(b.dataset.kat === key));
    update();
  }
  const motiv = h('div', { class: 'pf-sec' },
    h('p', { class: 'pf-label', id: 'pf-kat' }, 'Was zeigt das Foto? ', h('span', { class: 'pf-pflicht', text: '*', 'aria-hidden': 'true' }), h('span', { class: 'sr-only', text: '(Pflichtangabe)' })),
    h('div', { class: 'pf-kats', role: 'group', 'aria-labelledby': 'pf-kat' }, kacheln),
    h('p', { class: 'pf-hint', text: 'Eine Auswahl. Hilft anderen, schnell das passende Foto zu finden.' }), katIn);

  // ---- Notiz
  const note = h('input', { type: 'text', name: 'beschreibung', id: 'pf-note', maxlength: NOTIZ_MAX, autocomplete: 'off', enterkeyhint: 'done',
    placeholder: 'z. B. bei Niedrigwasser, Mai 2026' });
  const noteSec = h('div', { class: 'pf-sec' }, h('label', { class: 'pf-label', for: 'pf-note' }, 'Notiz ', h('span', { class: 'pf-opt', text: '(optional)' })), note);

  // ---- Einverständnis
  const rights = h('input', { type: 'checkbox', name: 'foto_rechte', id: 'pf-rights', onchange: () => update() });
  const rightsSec = h('label', { class: 'pf-check', for: 'pf-rights' }, rights,
    h('span', {}, 'Das Foto ist von mir und zeigt ', h('strong', { text: 'keine erkennbaren Personen oder Kennzeichen' }), '.'));

  // Honeypot
  const hp = h('div', { class: 'hp', 'aria-hidden': 'true' }, h('label', {}, 'Nicht ausfüllen: ', h('input', { type: 'text', name: 'bot-field', tabindex: '-1', autocomplete: 'off' })));

  // ---- Fußzeile
  const status = h('p', { class: 'pf-status', role: 'status', 'aria-live': 'polite', hidden: true });
  const sendBtn = h('button', { type: 'submit', class: 'pf-send', text: 'Foto einreichen', 'aria-disabled': 'true' });
  const foot = h('footer', { class: 'pf-foot' },
    h('p', { class: 'pf-facts' },
      h('span', {}, h('span', { html: icon('shield', 14) }), 'GPS-Daten werden entfernt'),
      h('span', {}, h('span', { html: icon('clock', 14) }), 'Prüfung vor Freigabe')),
    h('p', { class: 'pf-consent' }, 'Mit dem Einreichen bist du einverstanden, dass das Foto nach Prüfung veröffentlicht wird. ',
      h('a', { href: './datenschutz.html#meldungen', target: '_blank', rel: 'noopener', text: 'Datenschutz' })),
    status, sendBtn);

  const scroll = h('div', { class: 'pf-scroll' }, place, h('div', { class: 'pf-sec' }, photo, photoErr, photoOk), motiv, noteSec, rightsSec, hp, camIn, galIn);
  const form = h('form', { class: 'pf-form', novalidate: true, autocomplete: 'off' }, scroll, foot);

  // Beim Standortwechsel bleibt das Ausgefüllte erhalten (der Dialog schließt für die Kartenauswahl)
  function entwurf() {
    return { file: state.file, name: state.name, kategorie: katIn.value, note: note.value, rights: rights.checked };
  }
  const e0 = preset.entwurf;
  if (e0) {
    if (e0.file) showPhoto(e0.file, e0.name);
    if (FOTO_KATEGORIEN[e0.kategorie]) katWaehlen(e0.kategorie);
    note.value = e0.note || ''; rights.checked = Boolean(e0.rights);
  }

  function ready() { return Boolean(state.file && katIn.value && rights.checked && idIn.value); }
  function update() {
    const ok = ready() && !state.busy;
    sendBtn.classList.toggle('is-ready', ok);
    sendBtn.setAttribute('aria-disabled', ok ? 'false' : 'true');
  }
  function showStatus(kind, text) { status.hidden = false; status.className = 'pf-status ' + kind; status.textContent = text; announce(text); }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (state.busy) return;
    // Knopf bleibt fokussierbar (aria-disabled), sagt aber, was fehlt
    if (!idIn.value) return showStatus('error', 'Bitte zuerst den Standort auf der Karte wählen.');
    if (!state.file) return showStatus('error', 'Bitte zuerst ein Foto auswählen.');
    if (!katIn.value) { kacheln[0].focus(); return showStatus('error', 'Bitte wähle, was das Foto zeigt (z. B. Rampe).'); }
    if (!rights.checked) { rights.focus(); return showStatus('error', 'Bitte bestätige, dass das Foto von dir ist und keine Personen oder Kennzeichen zeigt.'); }
    const fd = new FormData(form);
    fd.set('form-name', 'foto-einreichen');
    fd.set('beschreibung', String(fd.get('beschreibung') || '').trim().slice(0, NOTIZ_MAX));
    fd.set('foto', state.file, 'foto.jpg');
    state.busy = true; update();
    sendBtn.textContent = 'Wird hochgeladen …'; sendBtn.setAttribute('aria-busy', 'true');
    status.hidden = true;
    try {
      await sendReport(fd, { multipart: true });
      revoke();
      root.replaceChildren(h('div', { class: 'pf-done' },
        h('div', { class: 'thanks-ico', html: icon('check', 32) }),
        h('h2', { id: 'dlg-title', tabindex: '-1', text: 'Danke!' }),
        h('p', { text: 'Dein Foto wird geprüft und erscheint meist innerhalb von 24 Stunden.' }),
        h('button', { type: 'button', class: 'pf-send is-ready', text: 'Fertig', onclick: () => dlg.close() })));
      $('#dlg-title', root).focus();
      announce('Foto gesendet. Es wird geprüft.');
    } catch (ex) {
      state.busy = false;
      sendBtn.textContent = 'Foto einreichen'; sendBtn.removeAttribute('aria-busy');
      update();
      showStatus('error', ex.message || 'Senden fehlgeschlagen. Bitte erneut versuchen.');
    }
  });

  update();
  root.append(head, form);
  dlg.setAttribute('aria-labelledby', 'dlg-title');
  dlg.showModal();
  title.focus();   // nicht der Schließen-Knopf – sonst zeigt er beim Öffnen einen Fokus-Rahmen
}

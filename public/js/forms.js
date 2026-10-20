// Community-Formulare (Netlify Forms). Meldungen landen im Netlify-Dashboard und werden manuell geprüft;
// sie erscheinen NIE automatisch auf der Karte.
import { CONFIG } from './config.js';
import { h, clear, $, announce } from './dom.js';
import { icon } from './icons.js';
import { displayName, formatDistance } from './model.js';
import { prefs } from './favorites.js';

const YNU = [['', 'Nicht bekannt'], ['ja', 'Ja'], ['nein', 'Nein']];

/** Feldlisten – müssen 1:1 zu den versteckten Netlify-Formularen in index.html passen (wird getestet). */
export const FORMS = {
  'slipanlage-melden': {
    title: 'Neue Slipanlage melden',
    intro: 'Du kennst eine Slipanlage, die auf der Karte fehlt? Melde sie hier. Nach der Prüfung nehmen wir sie auf.',
    fields: [
      { name: 'name', label: 'Name der Slipanlage', type: 'text', required: true, max: 120 },
      { name: 'gewaesser', label: 'Gewässer', type: 'text', required: true, max: 120 },
      { name: 'standort', type: 'location' },
      { name: 'zugang', label: 'Zugang', type: 'select', options: [['', 'Nicht bekannt'], ['oeffentlich', 'Öffentlich'], ['privat', 'Privat / Verein'], ['kunden', 'Nur Kunden / Gäste']] },
      { name: 'gebuehr', label: 'Gebühr', type: 'select', options: [['', 'Nicht bekannt'], ['kostenlos', 'Kostenlos'], ['kostenpflichtig', 'Kostenpflichtig']] },
      { name: 'gebuehr_betrag', label: 'Gebührenhöhe (falls bekannt)', type: 'text', max: 80, placeholder: 'z. B. 10 € pro Slipvorgang' },
      { name: 'parkplatz', label: 'Parkplatz für Pkw', type: 'select', options: YNU },
      { name: 'trailerparkplatz', label: 'Parkplatz für Bootstrailer', type: 'select', options: YNU },
      { name: 'beschreibung', label: 'Beschreibung', type: 'textarea', max: 1000, placeholder: 'Zufahrt, Rampe, Besonderheiten …' },
      { name: 'foto', label: 'Foto (optional, max. 5 MB)', type: 'file' },
      { name: 'kontakt', label: 'E-Mail für Rückfragen (optional)', type: 'email', max: 120 },
    ],
    rights: true,
    submit: 'Zur Prüfung senden',
  },
  'tankpreis-melden': {
    title: 'Kraftstoffpreis melden',
    intro: 'Melde den Preis, den du an der Bootstankstelle gesehen hast. Er wird erst nach Prüfung angezeigt – mit Datum.',
    fields: [
      { name: 'tankstelle', type: 'station' },
      { name: 'kraftstoff', label: 'Kraftstoff', type: 'select', required: true, options: [['diesel', 'Diesel'], ['benzin', 'Benzin']] },
      { name: 'preis', label: 'Preis pro Liter in €', type: 'number', required: true, placeholder: 'z. B. 2,189' },
      { name: 'datum', label: 'Datum der Beobachtung', type: 'date', required: true },
      { name: 'beleg', label: 'Belegfoto (optional, max. 5 MB)', type: 'file' },
      { name: 'kommentar', label: 'Kommentar (optional)', type: 'textarea', max: 500 },
    ],
    rights: true,
    submit: 'Preis zur Prüfung senden',
  },
  'foto-einreichen': {
    title: 'Foto einreichen',
    intro: 'Fotos helfen anderen bei der Einschätzung vor Ort. Sie werden vor der Veröffentlichung geprüft.',
    fields: [
      { name: 'standort_ref', type: 'station', any: true },
      { name: 'beschreibung', label: 'Bildbeschreibung', type: 'textarea', required: true, max: 500, placeholder: 'Was ist zu sehen? Aufnahmedatum?' },
      { name: 'foto', label: 'Foto (max. 5 MB)', type: 'file', required: true },
    ],
    rights: true,
    submit: 'Foto zur Prüfung senden',
  },
  'fehler-melden': {
    title: 'Informationen korrigieren',
    intro: 'Stimmt etwas nicht? Sag uns, was falsch oder veraltet ist.',
    fields: [
      { name: 'standort_ref', type: 'station', any: true },
      { name: 'art', label: 'Was stimmt nicht?', type: 'select', required: true, options: [
        ['existiert-nicht', 'Standort existiert nicht mehr'], ['koordinaten', 'Falsche Koordinaten'],
        ['nicht-oeffentlich', 'Nicht öffentlich zugänglich'], ['preis', 'Falscher Preis'],
        ['oeffnungszeiten', 'Falsche Öffnungszeiten'], ['sonstiges', 'Sonstiges']] },
      { name: 'details', label: 'Details', type: 'textarea', required: true, max: 1000, placeholder: 'Wie ist es richtig?' },
      { name: 'kontakt', label: 'E-Mail für Rückfragen (optional)', type: 'email', max: 120 },
    ],
    rights: false,
    submit: 'Korrektur senden',
  },
};

/** Alle Feldnamen, die ein Formular tatsächlich absendet (für den Abgleich mit den Netlify-Vorlagen). */
export function submittedFieldNames(formName) {
  const spec = FORMS[formName];
  const names = new Set(['form-name', 'bot-field']);
  for (const f of spec.fields) {
    if (f.type === 'location') ['lat', 'lon'].forEach(n => names.add(n));
    else if (f.type === 'station') {
      if (formName === 'tankpreis-melden') { names.add('tankstelle_id'); names.add('tankstelle_name'); }
      else { names.add('standort_id'); names.add('standort_name'); }
    } else names.add(f.name);
  }
  if (spec.rights) names.add('foto_rechte');
  if (formName === 'slipanlage-melden') names.add('dublette_bestaetigt');
  return names;
}

// ------------------------------------------------------------------ Foto-Prüfung und -Aufbereitung
const sniff = async (file) => {
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
};

/**
 * Prüft Typ (an den Dateiinhalten, nicht am Namen) und Größe und kodiert das Bild neu.
 * Dabei gehen EXIF-Daten – insbesondere GPS-Koordinaten – verloren.
 * Wirft Error mit nutzerfreundlicher Meldung.
 */
export async function prepareImage(file) {
  if (file.size > CONFIG.MAX_PHOTO_BYTES) throw new Error('Das Foto ist größer als 5 MB. Bitte ein kleineres Bild wählen.');
  const type = await sniff(file);
  if (!type) throw new Error('Nur JPEG-, PNG- oder WebP-Bilder sind erlaubt.');
  let bitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw new Error('Das Bild konnte nicht gelesen werden. Bitte ein anderes Foto wählen.'); }
  const scale = Math.min(1, CONFIG.PHOTO_MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale)), hgt = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = hgt;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, hgt);
  ctx.drawImage(bitmap, 0, 0, w, hgt);
  bitmap.close?.();
  const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.86));
  if (!blob) throw new Error('Das Bild konnte nicht aufbereitet werden. Bitte ein anderes Foto wählen.');
  if (blob.size > CONFIG.MAX_PHOTO_BYTES) throw new Error('Das aufbereitete Foto ist noch größer als 5 MB.');
  return new File([blob], 'foto.jpg', { type: 'image/jpeg' });
}

// ------------------------------------------------------------------ Formular-Dialog
/**
 * ctx = {
 *   dialog, places, userPos(): {lat,lon}|null, requestUserPos(): Promise<{lat,lon}>,
 *   pickLocation(initial): Promise<{lat,lon}|null>, showPlace(id), nearestSlips(lat, lon, radius)
 * }
 * preset = { standort_id, standort_name, lat, lon, art }
 */
export function openForm(formName, ctx, preset = {}) {
  const spec = FORMS[formName];
  const dlg = ctx.dialog;
  const root = clear($('#dlg-body', dlg));
  const state = { lat: preset.lat ?? null, lon: preset.lon ?? null, busy: false, nearby: null };

  const status = h('div', { class: 'form-status', role: 'status', 'aria-live': 'polite', hidden: true });
  const form = h('form', { class: 'report-form', novalidate: true, autocomplete: 'off' });
  const controls = {};

  const labelWrap = (field, control, hint) => h('label', { class: 'field' },
    h('span', { class: 'field-label', text: field.label + (field.required ? '' : '') }),
    control, hint ? h('span', { class: 'hint', text: hint }) : null);

  for (const f of spec.fields) {
    let control, node;
    if (f.type === 'text' || f.type === 'email' || f.type === 'number' || f.type === 'date') {
      // Zahlen als Text mit Dezimaltastatur: „2,189“ und „2.189“ funktionieren unabhängig von der Geräte-Sprache.
      const isNum = f.type === 'number';
      control = h('input', { type: isNum ? 'text' : f.type, name: f.name, required: f.required, maxlength: isNum ? 8 : f.max, placeholder: f.placeholder,
        max: f.type === 'date' ? new Date().toISOString().slice(0, 10) : null, inputmode: isNum ? 'decimal' : null, autocomplete: 'off' });
      if (f.type === 'date') control.value = new Date().toISOString().slice(0, 10);
      if (f.name === 'name' && preset.name) control.value = preset.name;
      node = labelWrap(f, control);
    } else if (f.type === 'textarea') {
      control = h('textarea', { name: f.name, required: f.required, maxlength: f.max, placeholder: f.placeholder, rows: 4 });
      node = labelWrap(f, control);
    } else if (f.type === 'select') {
      control = h('select', { name: f.name, required: f.required }, f.options.map(([v, t]) => h('option', { value: v, text: t })));
      if (f.name === 'art' && preset.art) control.value = preset.art;
      if (f.name === 'kraftstoff' && preset.kraftstoff) control.value = preset.kraftstoff;
      node = labelWrap(f, control);
    } else if (f.type === 'file') {
      control = h('input', { type: 'file', name: f.name, accept: 'image/jpeg,image/png,image/webp', required: f.required });
      node = labelWrap(f, control, 'JPEG, PNG oder WebP. Standortdaten (GPS) im Bild werden vor dem Senden entfernt.');
    } else if (f.type === 'location') {
      node = buildLocation();
    } else if (f.type === 'station') {
      node = buildStation(f);
    }
    if (control) controls[f.name] = control;
    form.append(node);
  }

  function buildLocation() {
    const latIn = h('input', { type: 'text', name: 'lat', readonly: true, required: true, 'aria-label': 'Breitengrad', placeholder: 'Breitengrad' });
    const lonIn = h('input', { type: 'text', name: 'lon', readonly: true, required: true, 'aria-label': 'Längengrad', placeholder: 'Längengrad' });
    controls.lat = latIn; controls.lon = lonIn;
    const note = h('div', { class: 'nearby', role: 'status', 'aria-live': 'polite', hidden: true });
    const ack = h('label', { class: 'check', hidden: true }, h('input', { type: 'checkbox', name: 'dublette_bestaetigt' }), h('span', { text: 'Ich habe die vorhandene Anlage gesehen und melde trotzdem eine neue.' }));
    controls.ack = ack;
    const set = (pos) => {
      state.lat = pos.lat; state.lon = pos.lon;
      latIn.value = pos.lat.toFixed(6); lonIn.value = pos.lon.toFixed(6);
      const near = ctx.nearestSlips(pos.lat, pos.lon, CONFIG.NEARBY_RADIUS_M);
      state.nearby = near;
      clear(note);
      if (near) {
        note.hidden = false; ack.hidden = false;
        note.append(icon('alert', 18),
          h('span', { text: `Hier gibt es schon eine Slipanlage: „${displayName(near.place)}“ (${formatDistance(near.distance)} entfernt). ` }),
          h('button', { type: 'button', class: 'link', text: 'Ansehen', onclick: () => { dlg.close(); ctx.showPlace(near.place.id); } }));
      } else { note.hidden = true; ack.hidden = true; ack.querySelector('input').checked = false; }
    };
    controls.setLocation = set;
    const pickBtn = h('button', { type: 'button', class: 'btn btn-outline', html: icon('pin', 18) + '<span>Auf Karte wählen</span>', onclick: async () => {
      dlg.close();
      const pos = await ctx.pickLocation(state.lat !== null ? { lat: state.lat, lon: state.lon } : null);
      dlg.showModal();
      if (pos) set(pos);
    } });
    const gpsBtn = h('button', { type: 'button', class: 'btn btn-outline', html: icon('locate', 18) + '<span>Meine Position</span>', onclick: async () => {
      try { set(await ctx.requestUserPos()); }
      catch (e) { showStatus('error', e.message || 'Standort nicht verfügbar. Bitte auf der Karte wählen.'); }
    } });
    if (state.lat !== null) setTimeout(() => set({ lat: state.lat, lon: state.lon }), 0);
    return h('fieldset', { class: 'field fieldset' },
      h('legend', { class: 'field-label', text: 'Standort' }),
      h('p', { class: 'hint', text: 'Tippe auf „Auf Karte wählen“ und dann auf die Stelle der Rampe.' }),
      h('div', { class: 'row2' }, latIn, lonIn),
      h('div', { class: 'btn-row' }, pickBtn, gpsBtn), note, ack);
  }

  function buildStation(f) {
    const isPrice = formName === 'tankpreis-melden';
    const idName = isPrice ? 'tankstelle_id' : 'standort_id';
    const nameName = isPrice ? 'tankstelle_name' : 'standort_name';
    const label = isPrice ? 'Bootstankstelle' : 'Standort';
    // Keine Auswahlliste: der Standort kommt immer von der Karte (Detailansicht oder Auswahlmodus, main.js)
    const p = preset.standort_id && ctx.places.find(x => x.id === preset.standort_id && (!isPrice || x.type === 'fuel'));
    const general = !p && preset.standort_id === '__other' && formName === 'fehler-melden';
    const idIn = h('input', { type: 'hidden', name: idName, value: p ? p.id : general ? '__other' : '' });
    const nameIn = h('input', { type: 'hidden', name: nameName, value: p ? displayName(p) : '' });
    controls[idName] = idIn; controls[nameName] = nameIn;
    const shown = p ? displayName(p) + (p.locality ? ` – ${p.locality}` : '') : general ? 'Allgemeiner Hinweis (kein bestimmter Standort)' : null;
    const change = ctx.choosePlace ? h('button', { type: 'button', class: 'btn btn-outline small', text: shown ? 'Anderen Standort wählen' : 'Auf der Karte wählen',
      onclick: () => ctx.choosePlace(formName) }) : null;
    return h('div', { class: 'field' }, h('span', { class: 'field-label', text: label }),
      shown ? h('p', { class: 'fixed-place', text: shown }) : h('p', { class: 'hint', text: isPrice ? 'Bitte die Bootstankstelle auf der Karte antippen.' : 'Bitte den Standort auf der Karte antippen.' }),
      idIn, nameIn, change);
  }

  // Honeypot (für Menschen unsichtbar)
  form.append(h('div', { class: 'hp', 'aria-hidden': 'true' }, h('label', {}, 'Nicht ausfüllen: ', h('input', { type: 'text', name: 'bot-field', tabindex: '-1', autocomplete: 'off' }))));

  let rights = null;
  if (spec.rights) {
    rights = h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'foto_rechte' }),
      h('span', { text: 'Ich habe die Rechte an dem Foto, auf dem Bild sind keine erkennbaren Personen oder Kfz-Kennzeichen, und ich bin mit der Veröffentlichung nach Prüfung einverstanden.' }));
    form.append(rights);
  }
  form.append(h('p', { class: 'hint privacy', html: '' }, 'Deine Angaben werden zur Prüfung über Netlify Forms gespeichert. Mehr dazu in der ', h('a', { href: './datenschutz.html', target: '_blank', rel: 'noopener', text: 'Datenschutzerklärung' }), '.'));

  const sendBtn = h('button', { type: 'submit', class: 'btn btn-primary', text: spec.submit });
  const cancelBtn = h('button', { type: 'button', class: 'btn btn-outline', text: 'Abbrechen', onclick: () => dlg.close() });
  form.append(status, h('div', { class: 'btn-row end' }, cancelBtn, sendBtn));

  function showStatus(kind, text) {
    status.hidden = false; status.className = 'form-status ' + kind; status.textContent = text; announce(text);
    status.scrollIntoView?.({ block: 'nearest' });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (state.busy) return;
    const fd = new FormData(form);
    // ---- Validierung (clientseitig; zusätzlich prüft Netlify auf Spam)
    const err = validate(formName, form, fd, state, controls);
    if (err) { showStatus('error', err.message); err.focus?.focus(); return; }
    if (fd.get('bot-field')) { showStatus('success', 'Danke! Deine Meldung wurde empfangen.'); return; } // Bots bekommen Erfolg vorgespielt
    const last = Number(prefs.get('lastSubmit') || 0);
    if (Date.now() - last < CONFIG.SUBMIT_COOLDOWN_MS) { showStatus('error', 'Bitte warte einen Moment, bevor du die nächste Meldung sendest.'); return; }

    state.busy = true; sendBtn.disabled = true;
    showStatus('info', 'Meldung wird gesendet …');
    try {
      const fileField = spec.fields.find(f => f.type === 'file');
      let hasFile = false;
      if (fileField) {
        const file = fd.get(fileField.name);
        if (file && file.size > 0) {
          showStatus('info', 'Foto wird geprüft und aufbereitet …');
          const clean = await prepareImage(file);
          fd.set(fileField.name, clean, 'foto.jpg');
          hasFile = true;
        } else fd.delete(fileField.name);
      }
      fd.set('form-name', formName);
      if (formName === 'tankpreis-melden') fd.set('preis', String(fd.get('preis')).trim().replace(',', '.'));
      if (!hasFile && !(fileField && fd.has(fileField.name))) { /* kein Anhang */ }
      const body = hasFile ? fd : new URLSearchParams([...fd.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : '']));
      const res = await fetch('/', { method: 'POST', body });
      if (!res.ok) throw new Error(res.status === 404 || res.status === 405 || res.status === 501
        ? 'Hier läuft die Seite nur lokal. Meldungen funktionieren erst auf der veröffentlichten Netlify-Website.'
        : `Der Server hat die Meldung abgelehnt (HTTP ${res.status}). Bitte später erneut versuchen.`);
      prefs.set('lastSubmit', String(Date.now()));
      clear(root).append(h('div', { class: 'thanks' }, h('div', { class: 'thanks-ico', html: icon('check', 32) }),
        h('h2', { text: 'Danke für deine Meldung!' }),
        h('p', { text: 'Sie ist jetzt „Wartet auf Prüfung“. Sie erscheint erst nach einer Kontrolle auf der Karte – nicht automatisch.' }),
        h('button', { type: 'button', class: 'btn btn-primary', text: 'Schließen', onclick: () => dlg.close() })));
      announce('Meldung gesendet. Sie wartet auf Prüfung.');
    } catch (ex) {
      const offline = !navigator.onLine;
      showStatus('error', offline ? 'Du bist offline. Bitte später erneut senden.' : (ex.message || 'Senden fehlgeschlagen.') + ' Deine Eingaben sind noch da – bitte erneut versuchen.');
      sendBtn.disabled = false; state.busy = false;
    }
  });

  root.append(h('h2', { id: 'dlg-title', text: spec.title }), h('p', { class: 'muted', text: spec.intro }), form);
  dlg.setAttribute('aria-labelledby', 'dlg-title');
  dlg.showModal();
  if (preset.lat != null && controls.setLocation) { /* bereits gesetzt */ }
}

function validate(formName, form, fd, state, controls) {
  const bad = (msg, el) => ({ message: msg, focus: el });
  for (const el of form.querySelectorAll('[required]')) {
    if (el.hidden || el.closest('[hidden]')) continue;
    if (el.type === 'file') { if (!el.files.length) return bad('Bitte ein Foto auswählen.', el); continue; }
    if (!String(el.value).trim()) {
      if (el.name === 'lat' || el.name === 'lon') return bad('Bitte den Standort auf der Karte wählen.', form.querySelector('.btn-outline'));
      return bad('Bitte alle Pflichtfelder ausfüllen.', el);
    }
  }
  const email = fd.get('kontakt');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) return bad('Bitte eine gültige E-Mail-Adresse eingeben – oder das Feld leer lassen.', controls.kontakt);
  if (formName === 'tankpreis-melden') {
    const rawPrice = String(fd.get('preis')).trim().replace(',', '.');
    const price = /^\d{1,2}(\.\d{1,3})?$/.test(rawPrice) ? Number(rawPrice) : NaN;
    if (!Number.isFinite(price) || price < CONFIG.PRICE_MIN || price > CONFIG.PRICE_MAX) return bad(`Bitte einen Preis zwischen ${CONFIG.PRICE_MIN} und ${CONFIG.PRICE_MAX} € pro Liter eingeben.`, controls.preis);
    const d = String(fd.get('datum'));
    if (d > new Date().toISOString().slice(0, 10)) return bad('Das Datum darf nicht in der Zukunft liegen.', controls.datum);
    if (!fd.get('tankstelle_id')) return bad('Bitte die Bootstankstelle auf der Karte wählen.', controls.tankstelle_id);
  }
  if ((formName === 'foto-einreichen' || formName === 'fehler-melden') && !fd.get('standort_id')) return bad('Bitte den Standort auf der Karte wählen.', controls.standort_id);
  if (formName === 'slipanlage-melden') {
    const la = Number(fd.get('lat')), lo = Number(fd.get('lon'));
    if (!(la >= 47 && la <= 55.2 && lo >= 5.5 && lo <= 15.1)) return bad('Der Standort liegt außerhalb von Deutschland. Bitte erneut auf der Karte wählen.', null);
    if (state.nearby && !fd.get('dublette_bestaetigt')) return bad('In der Nähe gibt es schon eine Slipanlage. Bitte bestätige, dass du trotzdem eine neue melden möchtest.', null);
  }
  const hasFile = [...form.querySelectorAll('input[type=file]')].some(i => i.files.length);
  if (hasFile && !fd.get('foto_rechte')) return bad('Bitte bestätige, dass du die Rechte an dem Foto hast.', form.querySelector('input[name=foto_rechte]'));
  return null;
}


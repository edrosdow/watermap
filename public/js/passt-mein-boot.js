// Abschnitt „Passt mein Boot?“ im Pegel-Sheet (Designumbau Phase 2b, 7.71.0) – ersetzt die frühere Seite „Pegel-Ampel“.
//  Ohne Mindestpegel: eine Zeile „Passt mein Boot? · Mindestpegel festlegen ›“; ein Tipp öffnet im selben Sheet ein kleines Formular.
//  Mit Mindestpegel: Hinweiszeile im Zustand der Ampel (Wort und Abstand), darunter eine kurze Zeile zu den nächsten Tagen, „Ändern“.
import { h, announce } from './dom.js';
import { BOOTSTYPEN } from './ampel-logik.js';
import { gruppe, zeile, hinweis, seg } from './bausteine.js';
import { mindestFuer, mindestSetzen, bootTyp, bootTypSetzen, ampel, ampelVorschau, SCHRITT } from './mindestpegel.js';

let nr = 0;

/** g: Pegel · verlauf: Promise der Messreihe (Trend) · vorhersage: Promise der WSV-Vorhersage oder null */
export function passtMeinBoot(g, { verlauf = null, vorhersage = null } = {}) {
  const box = h('section', { class: 'pmb', 'aria-label': 'Passt mein Boot?' });
  let pts = null, wv = null, imFormular = false;

  function ansicht({ fokus = false } = {}) {
    imFormular = false;
    const mindest = mindestFuer(g.id);
    if (mindest === null) {
      box.replaceChildren(gruppe([zeile({ ico: 'boat', titel: 'Passt mein Boot?', unter: 'Mindestpegel festlegen', onClick: formular })]));
    } else {
      const a = ampel(g, { mindest, pts });
      const vorschau = ampelVorschau(g, a, { wv });
      box.replaceChildren(
        h('h2', { class: 'pmb-titel', text: 'Passt mein Boot?' }),
        a ? hinweis({ zustand: a.zustand, ico: 'boat', text: a.satz, aktion: { text: 'Ändern', onclick: formular } })
          : hinweis({ text: `Mindestpegel ${mindest} cm – gerade kein aktueller Wert`, aktion: { text: 'Ändern', onclick: formular } }),
        h('p', { class: 'pmb-klein' }, [vorschau, `Mindestpegel ${mindest.toLocaleString('de-DE')} cm · ${BOOTSTYPEN[bootTyp()]}`].filter(Boolean).join(' · ')));
      const knopf = box.querySelector('.wm-hinweis-aktion');
      knopf.setAttribute('aria-label', 'Mindestpegel ändern');
    }
    if (fokus) (box.querySelector('.wm-hinweis-aktion, .wm-zeile'))?.focus({ preventScroll: true });
  }

  function formular() {
    imFormular = true;
    const alt = mindestFuer(g.id);
    let wert = alt ?? Math.round(g.value / SCHRITT) * SCHRITT;
    let typ = bootTyp();
    const id = `pmb-min-${++nr}`;
    const fehler = h('p', { class: 'wm-feld-fehler', id: `${id}-f`, hidden: true });
    const feld = h('input', { class: 'wm-eingabe pmb-wert', id, type: 'number', inputmode: 'numeric', min: '-500', max: '2000', step: '1', value: String(wert),
      'aria-describedby': `${id}-hilfe ${id}-f`,
      oninput: () => { const v = Math.round(Number(feld.value)); if (feld.value.trim() !== '' && Number.isFinite(v)) wert = v; feld.removeAttribute('aria-invalid'); fehler.hidden = true; } });
    const schritt = (d) => { wert = Math.round((wert + d) / SCHRITT) * SCHRITT; feld.value = String(wert); feld.removeAttribute('aria-invalid'); fehler.hidden = true; };
    const rund = (text, label, d) => h('button', { type: 'button', class: 'wm-rund pmb-pm', 'aria-label': label, text, onclick: () => schritt(d) });
    const form = h('form', { class: 'pmb-form', novalidate: true, onsubmit: (e) => {
      e.preventDefault();
      const v = Math.round(Number(feld.value));
      if (feld.value.trim() === '' || !Number.isFinite(v) || v < -500 || v > 2000) {
        feld.setAttribute('aria-invalid', 'true'); fehler.hidden = false; fehler.textContent = 'Bitte einen Wert zwischen −500 und 2000 cm eingeben.'; feld.focus(); return;
      }
      bootTypSetzen(typ);
      mindestSetzen(g.id, v);
      announce(`Mindestpegel ${v} cm gespeichert.`);
      ansicht({ fokus: true });
    } },
      h('h2', { class: 'pmb-titel', text: 'Passt mein Boot?' }),
      h('div', { class: 'wm-feld' },
        h('label', { for: id, text: 'Mindestpegel' }),
        h('div', { class: 'pmb-stepper' }, rund('−', `${SCHRITT} cm weniger`, -SCHRITT),
          h('span', { class: 'pmb-einheit' }, feld, h('span', { 'aria-hidden': 'true', text: 'cm' })),
          rund('+', `${SCHRITT} cm mehr`, SCHRITT)),
        fehler,
        h('p', { class: 'pmb-klein', id: `${id}-hilfe`, text: `Der Pegelstand, ab dem du an dieser Stelle erfahrungsgemäß durchkommst. Der Pegel ist nicht die Wassertiefe. Jetzt: ${Math.round(g.value).toLocaleString('de-DE')} ${g.unit || 'cm'}.` })),
      h('div', { class: 'wm-feld' },
        h('span', { class: 'pmb-label', id: `${id}-boot`, text: 'Boot' }),
        seg({ label: 'Bootstyp', wert: typ, optionen: Object.entries(BOOTSTYPEN).map(([w, text]) => ({ wert: w, text })), onWahl: (w) => { typ = w; } })),
      h('div', { class: 'pmb-knoepfe' },
        h('button', { type: 'submit', class: 'wm-btn is-primaer', text: 'Speichern' }),
        h('button', { type: 'button', class: 'wm-btn is-leise', text: 'Abbrechen', onclick: () => ansicht({ fokus: true }) }),
        alt !== null ? h('button', { type: 'button', class: 'wm-btn is-leise pmb-entfernen', text: 'Entfernen',
          onclick: () => { mindestSetzen(g.id, null); announce('Mindestpegel entfernt.'); ansicht({ fokus: true }); } }) : null));
    box.replaceChildren(form);
    feld.focus({ preventScroll: true });
    feld.select?.();
    box.scrollIntoView?.({ block: 'nearest' });
  }

  ansicht();
  const neu = () => { if (!imFormular && box.isConnected) ansicht(); };
  verlauf?.then((p) => { pts = p; neu(); }, () => {});
  vorhersage?.then((v) => { wv = v; neu(); }, () => {});
  // anderer Stelle (z. B. Pegel-Fenster darunter) geändert → neu zeichnen; Aufräumen, sobald der Abschnitt weg ist
  const lauscher = () => { if (!box.isConnected) { document.removeEventListener('mindestpegel', lauscher); return; } neu(); };
  document.addEventListener('mindestpegel', lauscher);
  return box;
}

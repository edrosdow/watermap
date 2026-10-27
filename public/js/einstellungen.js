// „Mein WaterMap“: Einstellungen (#mehr/einstellungen). Alles bleibt im Browser dieses Geräts, kein Konto.
// Liest und schreibt die vorhandenen Speicher (Bootstyp der Pegel-Ampel, Kategorien, Bezugspunkt „In der Nähe“);
// neu sind nur Bootsmaße (watermap.boot) und der Startausschnitt der Karte (watermap.start, watermap.ansicht).
import { h } from './dom.js';
import { icon } from './icons.js';
import { BOOTSTYPEN } from './ampel-logik.js';

const LS_AMPEL = 'watermap.ampel';   // { pegel, min, boot, hoehe } – Bootstyp gehört der Pegel-Ampel
const LS_BOOT = 'watermap.boot';     // { laenge, tiefgang } in Metern, beides optional
const BEHALTEN = new Set(['watermap.geraet']);   // zufällige Geräte-ID (Missbrauchsschutz der Meldungen)

export const STARTARTEN = { deutschland: 'Ganz Deutschland', letzte: 'Letzte Ansicht', position: 'Meine Position' };
const MASSE = {
  laenge: { label: 'Länge', min: 1, max: 30, bsp: 'z. B. 6,5' },
  tiefgang: { label: 'Tiefgang', min: 0.1, max: 5, bsp: 'z. B. 0,8' },
};

const lesen = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const schreiben = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* nur Komfort */ } };

/** Boot aus beiden Speichern: { typ, laenge, tiefgang } (Maße null, wenn nicht angegeben). */
export function bootLesen() {
  const a = lesen(LS_AMPEL) || {}, b = lesen(LS_BOOT) || {};
  const zahl = (v) => (Number.isFinite(v) ? v : null);
  return { typ: BOOTSTYPEN[a.boot] ? a.boot : 'motor', laenge: zahl(b.laenge), tiefgang: zahl(b.tiefgang) };
}
function bootSchreiben({ typ, ...masse }) {
  if (typ) schreiben(LS_AMPEL, { ...(lesen(LS_AMPEL) || {}), boot: typ });
  if (Object.keys(masse).length) schreiben(LS_BOOT, { ...(lesen(LS_BOOT) || {}), ...masse });
}

/** Startausschnitt der Karte: 'deutschland' (Standard) | 'letzte' | 'position'. */
export function startArt() { const v = lesen('watermap.start'); return STARTARTEN[v] ? v : 'deutschland'; }
export function startArtSetzen(v) { schreiben('watermap.start', v); }
/** Letzte Kartenansicht { lat, lon, zoom } (nur gespeichert, solange „Letzte Ansicht“ gewählt ist). */
export const ansichtLesen = () => { const v = lesen('watermap.ansicht'); return v && Number.isFinite(v.lat) && Number.isFinite(v.lon) && Number.isFinite(v.zoom) ? v : null; };
export const ansichtSchreiben = (v) => schreiben('watermap.ansicht', v);

/** Alle WaterMap-Daten im Browser löschen (außer der Geräte-ID). Liefert die Anzahl gelöschter Einträge. */
export function allesLoeschen() {
  let n = 0;
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('watermap.') && !BEHALTEN.has(k)) { localStorage.removeItem(k); n++; }
  } catch { /* gesperrt */ }
  return n;
}

/** Zahl mit Komma oder Punkt; leer → null; sonst NaN bei Unsinn. */
export function massLesen(text) {
  const t = String(text || '').trim().replace(',', '.');
  if (!t) return null;
  return /^\d{1,2}(\.\d{1,2})?$/.test(t) ? Number(t) : NaN;
}
const massText = (v) => (v === null ? '' : v.toLocaleString('de-DE', { maximumFractionDigits: 2 }));

/** Unterzeile der Karte „Mein WaterMap“ in „Mehr“. */
export function profilZeile() {
  const b = bootLesen();
  const masse = [b.laenge !== null ? `${massText(b.laenge)} m` : null, b.tiefgang !== null ? `Tiefgang ${massText(b.tiefgang)} m` : null].filter(Boolean);
  return [BOOTSTYPEN[b.typ], ...masse].join(' · ') + ' · ohne Konto';
}

const abschnitt = (titel, kinder) => h('section', { class: 'bs-abschnitt' },
  h('div', { class: 'bs-abschnitt-kopf' }, h('h2', { text: titel })), h('div', { class: 'bs-gruppe' }, kinder));

/** Umschalter mit Segmenten (eine Wahl). */
function segmente(label, optionen, wert, onWahl) {
  return h('div', { class: 'ei-seg', role: 'group', 'aria-label': label },
    Object.entries(optionen).map(([k, text]) => h('button', { type: 'button', 'aria-pressed': String(k === wert), dataset: { wert: k }, text,
      onclick: (e) => {
        if (k === wert) return;
        wert = k;
        for (const b of e.currentTarget.parentNode.children) b.setAttribute('aria-pressed', String(b === e.currentTarget));
        onWahl(k);
      } })));
}

/**
 * Seite zeichnen. ctx = { cats: Set, katLabels: {typ: {label, farbe}}, toggleCat(typ), bezug(): 'position'|'kartenmitte'|'ort',
 *   setBezug(art), freigabe(): Promise<'granted'|'denied'|'prompt'|…>, erlauben(): Promise, ausgeblendet(): Zahl, ausgeblendetZeigen(),
 *   stand(): { orte, pegel }, aktualisieren(): Promise, zuruecksetzen(), zurueck(), alarmHref, dialog, toast }
 */
export function einstellungenSeite(root, ctx) {
  const boot = bootLesen();

  // ---- Mein Boot
  const massFeld = (key) => {
    const m = MASSE[key];
    const fehler = h('p', { class: 'ei-fehler', id: `ei-${key}-f`, role: 'alert', hidden: true });
    const input = h('input', { type: 'text', id: `ei-${key}`, class: 'ei-zahl', inputmode: 'decimal', autocomplete: 'off', maxlength: 5,
      placeholder: m.bsp, value: massText(boot[key]), 'aria-describedby': `ei-${key}-f` });
    const speichern = () => {
      const v = massLesen(input.value);
      const ok = v === null || (v >= m.min && v <= m.max);
      fehler.hidden = ok; input.setAttribute('aria-invalid', String(!ok));
      if (!ok) { fehler.textContent = `Bitte ${m.label} zwischen ${massText(m.min)} und ${massText(m.max)} m angeben – oder leer lassen.`; return; }
      bootSchreiben({ [key]: v });
      input.value = massText(v);
    };
    input.addEventListener('change', speichern);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
    return h('div', { class: 'ei-mass' },
      h('label', { class: 'ei-label', for: `ei-${key}` }, m.label, ' ', h('span', { class: 'ei-opt', text: '(optional)' })),
      h('span', { class: 'ei-zahl-wrap' }, input, h('span', { class: 'ei-einheit', text: 'm', 'aria-hidden': 'true' })), fehler);
  };
  const bootTeil = abschnitt('Mein Boot', [
    h('div', { class: 'ei-zeile' },
      h('span', { class: 'ei-label', id: 'ei-boot-l', text: 'Bootstyp' }),
      h('span', { class: 'ei-hilfe', text: 'Für die Pegel-Ampel und „Passt mein Boot?“' }),
      segmente('Bootstyp', BOOTSTYPEN, boot.typ, (typ) => bootSchreiben({ typ }))),
    h('div', { class: 'ei-zeile' },
      h('div', { class: 'ei-masse' }, massFeld('laenge'), massFeld('tiefgang')),
      h('span', { class: 'ei-hilfe', text: 'Bleibt auf diesem Gerät. Damit kann WaterMap später zeigen, ob eine Slipanlage zu deinem Boot passt.' })),
  ]);

  // ---- Karte beim Start
  const schalter = (typ) => {
    const k = ctx.katLabels[typ];
    const btn = h('button', { type: 'button', class: 'ei-sw', role: 'switch', 'aria-checked': String(ctx.cats.has(typ)), dataset: { typ },
      onclick: () => {
        ctx.toggleCat(typ);
        for (const b of root.querySelectorAll('.ei-sw[data-typ]')) b.setAttribute('aria-checked', String(ctx.cats.has(b.dataset.typ)));
      } },
      h('span', { class: 'ei-dot', style: `background:${k.farbe}`, 'aria-hidden': 'true' }), h('span', { class: 'ei-sw-label', text: k.label }),
      h('span', { class: 'ei-tr', 'aria-hidden': 'true' }));
    return btn;
  };
  const startHinweis = h('p', { class: 'ei-hilfe ei-unter', hidden: true });
  const startHinweisSetzen = async (art) => {
    startHinweis.hidden = true;
    if (art !== 'position') return;
    const f = await ctx.freigabe();
    if (f === 'granted') return;
    startHinweis.textContent = f === 'denied' ? 'Die Standortfreigabe ist blockiert – die Karte startet dann mit ganz Deutschland.'
      : 'Beim Start wird deine Position nur genutzt, wenn du sie freigegeben hast (unten „Erlauben“).';
    startHinweis.hidden = false;
  };
  const karteTeil = abschnitt('Karte beim Start', [
    ...Object.keys(ctx.katLabels).map(schalter),
    h('div', { class: 'ei-zeile' },
      h('span', { class: 'ei-label', text: 'Ausschnitt' }),
      segmente('Ausschnitt beim Start', STARTARTEN, startArt(), (art) => { ctx.setStart(art); startHinweisSetzen(art); }),
      startHinweis),
  ]);

  // ---- In der Nähe
  const freigabeWert = h('span', { class: 'ei-status' });
  const freigabeHilfe = h('span', { class: 'ei-hilfe' });
  const freigabeKnopf = h('button', { type: 'button', class: 'ei-knopf', text: 'Erlauben', hidden: true,
    onclick: async () => { try { await ctx.erlauben(); } catch { /* Hinweis kommt als Toast */ } freigabeZeigen(); startHinweisSetzen(startArt()); } });
  async function freigabeZeigen() {
    const f = await ctx.freigabe();
    const [text, ton, hilfe] = f === 'granted' ? ['Erlaubt', 'ok', 'Ändern in den Einstellungen deines Browsers']
      : f === 'denied' ? ['Blockiert', 'stop', 'Freigeben in den Einstellungen deines Browsers (Website-Einstellungen → Standort)']
        : ['Noch nicht erlaubt', 'offen', 'Der Browser fragt erst, wenn du „Erlauben“ tippst'];
    freigabeWert.textContent = text; freigabeWert.className = `ei-status is-${ton}`;
    freigabeHilfe.textContent = hilfe;
    freigabeKnopf.hidden = f === 'granted' || f === 'denied';
    freigabeWert.hidden = !freigabeKnopf.hidden;
  }
  const bezug = ctx.bezug();
  const naeheTeil = abschnitt('In der Nähe', [
    h('div', { class: 'ei-zeile' },
      h('span', { class: 'ei-label', text: 'Entfernungen messen ab' }),
      bezug === 'ort' ? h('span', { class: 'ei-hilfe', text: 'Zurzeit ab einem gesuchten Ort.' }) : null,
      segmente('Entfernungen messen ab', { position: 'Meine Position', kartenmitte: 'Kartenmitte' }, bezug, (art) => ctx.setBezug(art))),
    h('div', { class: 'ei-reihe' },
      h('span', { class: 'ei-reihe-text' }, h('span', { class: 'ei-label', text: 'Standortfreigabe' }), freigabeHilfe),
      freigabeWert, freigabeKnopf),
  ]);
  freigabeZeigen();
  startHinweisSetzen(startArt());

  // ---- Benachrichtigungen
  const alarmTeil = abschnitt('Benachrichtigungen', [
    h('a', { class: 'bs-zeile', href: ctx.alarmHref },
      h('span', { class: 'bs-ico', html: icon('bell', 22), 'aria-hidden': 'true' }),
      h('span', { class: 'bs-text' }, h('strong', { text: 'Pegel-Alarm' }), h('small', { text: 'Mail, wenn sich die Ampel deines Pegels ändert' })),
      h('span', { class: 'bs-pfeil', html: icon('chevron', 18), 'aria-hidden': 'true' })),
  ]);

  // ---- Daten auf diesem Gerät
  const n = ctx.ausgeblendet();
  const ausgeblendetZeile = h('div', { class: 'ei-reihe' },
    h('span', { class: 'ei-reihe-text' }, h('span', { class: 'ei-label', text: 'Ausgeblendete Meldungen' }),
      h('span', { class: 'ei-hilfe', text: n ? `${n} ${n === 1 ? 'Meldung' : 'Meldungen'}, die du als unpassend markiert hast` : 'Keine' })),
    n ? h('button', { type: 'button', class: 'ei-knopf', text: 'Wieder zeigen',
      onclick: () => { ctx.ausgeblendetZeigen(); ctx.toast('Ausgeblendete Meldungen werden wieder gezeigt.'); einstellungenSeite(root, ctx); } }) : null);
  const st = ctx.stand();
  const standText = [st.orte ? `Standorte vom ${st.orte}` : null, st.pegel ? `Pegel von ${st.pegel}` : null].filter(Boolean).join(', ') || 'Noch nicht geladen';
  const aktKnopf = h('button', { type: 'button', class: 'ei-knopf', text: 'Aktualisieren',
    onclick: async () => {
      aktKnopf.disabled = true; aktKnopf.setAttribute('aria-busy', 'true'); aktKnopf.textContent = 'Lädt …';
      try { await ctx.aktualisieren(); ctx.toast('Daten aktualisiert.'); }
      catch { ctx.toast(navigator.onLine === false ? 'Du bist offline. Bitte später erneut versuchen.' : 'Aktualisieren hat nicht geklappt. Bitte später erneut versuchen.'); }
      einstellungenSeite(root, ctx);
    } });
  const datenTeil = abschnitt('Daten auf diesem Gerät', [
    ausgeblendetZeile,
    h('div', { class: 'ei-reihe' }, h('span', { class: 'ei-reihe-text' }, h('span', { class: 'ei-label', text: 'Offline-Daten' }), h('span', { class: 'ei-hilfe ei-stand', text: standText })), aktKnopf),
    h('button', { type: 'button', class: 'bs-zeile ei-rot', onclick: () => zuruecksetzenFragen(ctx) },
      h('span', { class: 'bs-ico', html: icon('close', 22), 'aria-hidden': 'true' }),
      h('span', { class: 'bs-text' }, h('strong', { text: 'Alles zurücksetzen' }), h('small', { text: 'Merkliste, Meine Pegel und Einstellungen löschen' }))),
  ]);

  root.replaceChildren(h('div', { class: 'bs-seite ei-seite' },
    h('header', { class: 'bs-kopf' },
      h('button', { type: 'button', class: 'bs-zurueck', 'aria-label': 'Zurück zu „Mehr“', html: icon('back', 24), onclick: ctx.zurueck }),
      h('div', {}, h('h1', { class: 'bs-titel', id: 'bs-titel', tabindex: '-1', text: 'Mein WaterMap' }),
        h('p', { class: 'bs-unter', text: 'Einstellungen – gespeichert nur auf diesem Gerät, kein Konto nötig.' }))),
    h('div', { class: 'ei-spalten' }, h('div', {}, bootTeil, karteTeil, naeheTeil), h('div', {}, alarmTeil, datenTeil)),
    h('p', { class: 'bs-fuss', text: 'Konto, Bewertungen und Abgleich zwischen Geräten kommen später.' })));
}

/** Rückfrage vor „Alles zurücksetzen“. */
function zuruecksetzenFragen(ctx) {
  const dlg = ctx.dialog;
  const body = dlg.querySelector('#dlg-body');
  body.replaceChildren(
    h('h2', { id: 'dlg-title', text: 'Alles zurücksetzen?' }),
    h('p', { text: 'Gelöscht werden auf diesem Gerät: Merkliste, Meine Pegel, die Einstellungen der Pegel-Ampel, Bootsangaben, Filter und gespeicherte Orte.' }),
    h('p', { class: 'muted small', text: 'Pegel-Alarme per Mail bleiben bestehen – abmelden kannst du sie über den Link in jeder Alarm-Mail.' }),
    h('div', { class: 'btn-row end' },
      h('button', { type: 'button', class: 'btn btn-outline', text: 'Abbrechen', onclick: () => dlg.close() }),
      h('button', { type: 'button', class: 'btn btn-gefahr', text: 'Alles löschen', onclick: () => { dlg.close(); ctx.zuruecksetzen(); } })));
  dlg.setAttribute('aria-labelledby', 'dlg-title');
  if (!dlg.open) dlg.showModal();
  body.querySelector('.btn-outline').focus();
}

// „Heute vor Ort“: Lagemeldungen laden, senden, bestätigen – und die kleinen Bausteine für Vorschau und Detailpanel.
// Alles aus Meldungen wird als Text eingesetzt (nie als HTML).
import { h } from './dom.js';
import { icon } from './icons.js';

export const API = '/api/meldungen';
export const NOTIZ_MAX = 140;
const CACHE_MS = 2 * 60e3;
const LS_AKTIV = 'watermap.meldungen.aktiv';
const LS_GERAET = 'watermap.geraet';
const LS_BEWERTET = 'watermap.meldungen.bewertet';
const LS_AUSGEBLENDET = 'watermap.meldungen.ausgeblendet';

/** Typen in der Reihenfolge der Kacheln; `ton`: Farbton der Kachel/Zeile. */
export const TYPEN = {
  alles_frei:     { text: 'Alles frei',     zeile: 'Alles frei',            ico: 'check',    farbe: '#15803D', ton: 'gut',   rang: 1 },
  parkplatz_voll: { text: 'Parkplatz voll', zeile: 'Parkplatz voll',        ico: 'car',      farbe: '#B45309', ton: 'warn',  rang: 3 },
  warteschlange:  { text: 'Warteschlange',  zeile: 'Warteschlange am Slip', ico: 'clock',    farbe: '#B45309', ton: 'warn',  rang: 2 },
  rampe_rutschig: { text: 'Rampe rutschig', zeile: 'Rampe rutschig',        ico: 'slippery', farbe: '#B45309', ton: 'warn',  rang: 4 },
  hindernis:      { text: 'Hindernis',      zeile: 'Hindernis gemeldet',    ico: 'alert',    farbe: '#B45309', ton: 'warn',  rang: 5 },
  gesperrt:       { text: 'Gesperrt',       zeile: 'Gesperrt',              ico: 'blocked',  farbe: '#B91C1C', ton: 'stop',  rang: 6 },
};

// ------------------------------------------------------------------ Gerät (zufällige ID, nur für den Missbrauchsschutz)
let geraetMem = null;
export function geraetId() {
  if (geraetMem) return geraetMem;
  try { geraetMem = localStorage.getItem(LS_GERAET); } catch { /* gesperrt */ }
  if (!geraetMem || !/^[A-Za-z0-9_-]{16,64}$/.test(geraetMem)) {
    const b = new Uint8Array(16); crypto.getRandomValues(b);
    geraetMem = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    try { localStorage.setItem(LS_GERAET, geraetMem); } catch { /* nur für diese Sitzung */ }
  }
  return geraetMem;
}

// ------------------------------------------------------------------ Als unpassend gemeldet: auf diesem Gerät ausblenden
function ausgeblendetLesen() { try { return new Set(JSON.parse(localStorage.getItem(LS_AUSGEBLENDET) || '[]')); } catch { return new Set(); } }
/** Meldung auf diesem Gerät ausblenden (nach „Unpassend melden“). Löst „meldung-ausgeblendet“ aus. */
export function ausblenden(id) {
  const set = ausgeblendetLesen(); set.add(id);
  try { localStorage.setItem(LS_AUSGEBLENDET, JSON.stringify([...set].slice(-200))); } catch { /* nur bis zum Neuladen */ }
  ausgeblendetMem.add(id);
  window.dispatchEvent(new CustomEvent('meldung-ausgeblendet', { detail: { id } }));
}
const ausgeblendetMem = new Set();
/** Anzahl der auf diesem Gerät ausgeblendeten Meldungen (Einstellungen). */
export const ausgeblendetAnzahl = () => new Set([...ausgeblendetLesen(), ...ausgeblendetMem]).size;
/** Ausgeblendete Meldungen wieder zeigen (Einstellungen). */
export function ausgeblendetZuruecksetzen() {
  try { localStorage.removeItem(LS_AUSGEBLENDET); } catch { /* egal */ }
  ausgeblendetMem.clear();
}
/** Liste ohne die auf diesem Gerät ausgeblendeten Meldungen. */
export const ohneAusgeblendete = (liste) => {
  const set = ausgeblendetLesen();
  return (liste || []).filter(m => !set.has(m.id) && !ausgeblendetMem.has(m.id));
};

// ------------------------------------------------------------------ Laden
let aktivCache = null;   // { zeit, map: Map(id → {n, typ, at}), offline }
const lokale = new Map(); // eigene, gerade gesendete Stände (bis der CDN-Zwischenspeicher nachzieht)

function snapshotLesen() {
  try { const j = JSON.parse(localStorage.getItem(LS_AKTIV) || 'null'); return j && Array.isArray(j.aktiv) ? j : null; } catch { return null; }
}
function zuMap(liste) { return new Map(liste.map(a => [a.standortId, { n: a.n, typ: a.typ, at: a.at }])); }
function mitLokalen(map) {
  const out = new Map(map);
  for (const [id, v] of lokale) { if (Date.now() - v.at > 90e3) { lokale.delete(id); continue; } if (v.info) out.set(id, v.info); else out.delete(id); }
  return out;
}

/** Kompakte Übersicht aller aktiven Meldungen (2 Minuten im Speicher; offline: letzter Stand). */
export async function aktivLaden({ fetchFn = fetch, force = false } = {}) {
  if (!force && aktivCache && Date.now() - aktivCache.geladen < CACHE_MS) return { ...aktivCache, map: mitLokalen(aktivCache.map) };
  try {
    const r = await fetchFn(`${API}/aktiv`, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const liste = Array.isArray(j?.aktiv) ? j.aktiv : [];
    aktivCache = { zeit: j.zeit || Date.now(), geladen: Date.now(), map: zuMap(liste), offline: false };
    try { localStorage.setItem(LS_AKTIV, JSON.stringify({ zeit: aktivCache.zeit, aktiv: liste })); } catch { /* egal */ }
  } catch {
    const s = snapshotLesen();
    aktivCache = { zeit: s?.zeit || null, geladen: Date.now(), map: zuMap(s?.aktiv || []), offline: true };
  }
  return { ...aktivCache, map: mitLokalen(aktivCache.map) };
}

// Übersicht „Aktuelle Meldungen“: alle aktiven Meldungen in einem Abruf (1 Minute im Speicher; offline: letzter Stand)
const LS_LISTE = 'watermap.meldungen.liste';
let listeCache = null;   // { zeit, geladen, meldungen, offline }
export async function listeLaden({ fetchFn = fetch, force = false } = {}) {
  if (force || !listeCache || listeCache.offline || Date.now() - listeCache.geladen >= 60e3) await listeAbrufen(fetchFn);
  // eigene, gerade abgegebene Meldungen/Bewertungen sofort zeigen (bis der Zwischenspeicher nachzieht)
  const eigene = [...standortMem.entries()].filter(([, v]) => !v.offline && Date.now() - v.zeit < 90e3);
  if (!eigene.length || listeCache.offline) return { ...listeCache, meldungen: ohneAusgeblendete(listeCache.meldungen) };
  const ersetzt = new Set(eigene.map(([id]) => id));
  return { ...listeCache, meldungen: ohneAusgeblendete([...listeCache.meldungen.filter(m => !ersetzt.has(m.standortId)), ...eigene.flatMap(([, v]) => v.meldungen)])
    .sort((a, b) => b.erstelltAm - a.erstelltAm) };
}

async function listeAbrufen(fetchFn) {
  try {
    const r = await fetchFn(`${API}/liste`, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const meldungen = Array.isArray(j?.meldungen) ? j.meldungen : [];
    listeCache = { zeit: j.zeit || Date.now(), geladen: Date.now(), meldungen, offline: false };
    try { localStorage.setItem(LS_LISTE, JSON.stringify({ zeit: listeCache.zeit, meldungen })); } catch { /* egal */ }
  } catch {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(LS_LISTE) || 'null'); } catch { /* ohne Speicher */ }
    // Offline: nur noch nicht abgelaufene Meldungen des letzten Stands (sie gelten 24 h)
    const meldungen = (Array.isArray(s?.meldungen) ? s.meldungen : []).filter(m => Date.now() - m.erstelltAm < 24 * 3600e3);
    listeCache = { zeit: s?.zeit || null, geladen: Date.now(), meldungen, offline: true, unbekannt: !s };
  }
}

const standortMem = new Map();   // id → { zeit, meldungen }
/** Meldungen eines Standorts – immer frisch; offline der zuletzt geladene Stand. */
export async function standortLaden(id, { fetchFn = fetch } = {}) {
  try {
    const r = await fetchFn(`${API}?standort=${encodeURIComponent(id)}`, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const res = { zeit: j.zeit || Date.now(), meldungen: Array.isArray(j?.meldungen) ? j.meldungen : [], offline: false };
    standortMem.set(id, res);
    return { ...res, meldungen: ohneAusgeblendete(res.meldungen) };
  } catch {
    const alt = standortMem.get(id);
    return { zeit: alt?.zeit || null, meldungen: ohneAusgeblendete(alt?.meldungen), offline: true, unbekannt: !alt };
  }
}

/** Zusammenfassung aus einer Liste (wichtigste zuerst, wie vom Server geliefert). */
export function zusammenfassen(meldungen) {
  const s = [...meldungen].sort((a, b) => (TYPEN[b.typ]?.rang || 0) - (TYPEN[a.typ]?.rang || 0) || b.erstelltAm - a.erstelltAm);
  return s.length ? { n: s.length, typ: s[0].typ, at: s[0].erstelltAm } : null;
}

function merkeLokal(id, meldungen) {
  lokale.set(id, { at: Date.now(), info: zusammenfassen(meldungen) });
  standortMem.set(id, { zeit: Date.now(), meldungen, offline: false });
}

async function post(url, body, fetchFn) {
  let r;
  try {
    r = await fetchFn(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-geraet': geraetId() }, body: JSON.stringify(body) });
  } catch { throw new Error('Keine Verbindung, bitte später erneut versuchen.'); }
  let j = null; try { j = await r.json(); } catch { /* leer */ }
  if (!r.ok) {
    if (r.status === 429) throw new Error(j?.fehler || 'Du hast hier gerade schon gemeldet.');
    if (r.status === 404 && url === API) throw new Error('Meldungen sind hier gerade nicht verfügbar.');
    throw new Error(j?.fehler || 'Das hat gerade nicht geklappt. Bitte später erneut versuchen.');
  }
  return j;
}

/** Neue Meldung senden; liefert die aktuellen Meldungen des Standorts. */
export async function senden(standortId, typ, notiz, { fetchFn = fetch } = {}) {
  if (navigator.onLine === false) throw new Error('Keine Verbindung, bitte später erneut versuchen.');
  const j = await post(API, { standortId, typ, notiz: notiz || '' }, fetchFn);
  merkeLokal(standortId, j.meldungen || []);
  eigeneMerken(j.meldung?.id);
  return j;
}

// ------------------------------------------------------------------ „neu“-Zahl am Navigationspunkt „Meldungen“
const LS_GESEHEN = 'watermap.meldungen.gesehen';   // Zeitpunkt des letzten Besuchs der Übersicht
const LS_EIGENE = 'watermap.meldungen.eigene';     // IDs eigener Meldungen (zählen nicht als neu)
export function gesehenLesen() { try { const v = Number(localStorage.getItem(LS_GESEHEN)); return Number.isFinite(v) ? v : 0; } catch { return 0; } }
export function gesehenSetzen(zeit = Date.now()) { try { localStorage.setItem(LS_GESEHEN, String(zeit)); } catch { /* nur Komfort */ } }
function eigeneLesen() { try { const a = JSON.parse(localStorage.getItem(LS_EIGENE) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } }
export function eigeneMerken(id) {
  if (!id) return;
  try { localStorage.setItem(LS_EIGENE, JSON.stringify([...eigeneLesen().filter(x => x !== id), id].slice(-100))); } catch { /* nur Komfort */ }
}
/** Meldungen, die neuer sind als der letzte Besuch der Übersicht und nicht von diesem Gerät stammen. */
export function neueAnzahl(meldungen, { gesehen = gesehenLesen(), eigene = eigeneLesen() } = {}) {
  const meine = new Set(eigene);
  return (meldungen || []).filter(m => m && m.erstelltAm > gesehen && !meine.has(m.id)).length;
}

function bewertetLesen() { try { return new Set(JSON.parse(localStorage.getItem(LS_BEWERTET) || '[]')); } catch { return new Set(); } }
export const schonBewertet = (id) => bewertetLesen().has(id);

/** „Stimmt noch“ / „Nicht mehr“. */
export async function bestaetigen(meldung, stimmt, { fetchFn = fetch } = {}) {
  const j = await post(`${API}/${encodeURIComponent(meldung.id)}/bestaetigen`, { stimmt }, fetchFn);
  const set = bewertetLesen(); set.add(meldung.id);
  try { localStorage.setItem(LS_BEWERTET, JSON.stringify([...set].slice(-200))); } catch { /* egal */ }
  if (j?.standortId) merkeLokal(j.standortId, j.meldungen || []);
  return j;
}

// ------------------------------------------------------------------ Darstellung
export function alter(ms, jetzt = Date.now()) {
  const min = Math.max(0, Math.round((jetzt - ms) / 60e3));
  if (min < 1) return 'gerade eben';
  if (min < 60) return `vor ${min} Min.`;
  const std = Math.floor(min / 60);
  return `vor ${std} Std.`;
}

export function standVon(zeit) {
  if (!zeit) return 'Stand unbekannt';
  const d = new Date(zeit);
  return `Stand von ${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}, ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr`;
}

const tonKlasse = (typ) => `ton-${TYPEN[typ]?.ton || 'warn'}`;

/** Statuszeile (Vorschau-Karte, Kopf des Detailpanels): wichtigste Meldung + „vor … · 3× bestätigt · +1 weitere“. */
export function statusZeile(meldungen, { onOpen, offline = false, zeit = null } = {}) {
  if (!meldungen?.length) return null;
  const m = meldungen[0];
  const t = TYPEN[m.typ] || TYPEN.hindernis;
  const sub = [alter(m.erstelltAm), m.bestaetigt ? `${m.bestaetigt}× bestätigt` : null, meldungen.length > 1 ? `+${meldungen.length - 1} weitere` : null,
    offline ? standVon(zeit) : null].filter(Boolean).join(' · ');
  return h('button', { type: 'button', class: `meld-zeile ${tonKlasse(m.typ)}`, onclick: onOpen, 'aria-label': `${t.zeile}, ${sub}. Heute vor Ort öffnen` },
    h('span', { class: 'meld-punkt', style: `--c:${t.farbe}`, 'aria-hidden': 'true' }),
    h('span', { class: 'meld-zeile-text' }, h('strong', { text: t.zeile }), h('small', { text: sub })),
    h('span', { class: 'meld-pfeil', html: icon('chevron', 18), 'aria-hidden': 'true' }));
}

/** „gestern 16:20“, „heute 9:05“ (für „Zuletzt: …“). */
export function zeitpunkt(ms, jetzt = Date.now()) {
  const d = new Date(ms), heute = new Date(jetzt);
  const uhr = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const tag = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((tag(heute) - tag(d)) / 86400e3);
  return diff === 0 ? `heute ${uhr}` : diff === 1 ? `gestern ${uhr}` : `${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} ${uhr}`;
}

/** Passende Chips für „Lage hat sich geändert?“ (die gemeldete Lage selbst nicht noch einmal). */
function aenderungsChips(haupt) {
  return ['alles_frei', haupt === 'warteschlange' ? 'parkplatz_voll' : 'warteschlange', haupt === 'gesperrt' ? 'hindernis' : 'gesperrt'].filter(t => t !== haupt);
}

/**
 * Karte „Heute vor Ort“ im Detailpanel (nur Slipanlagen, Häfen, Tankstellen).
 *   a  nah, keine Probleme      → „Heute keine Probleme gemeldet“ + „Bist du gerade hier?“ mit Chips
 *   b  Meldungen vorhanden      → wichtigste Meldung; nah: „Stimmt das noch?“ + „Lage hat sich geändert?“
 *   c  nach Antippen eines Chips → „Deine Meldung“ mit Notiz, Abbrechen / Meldung senden
 *   d  weiter weg / ohne Position → Status ohne Knöpfe, unten die Zeile „Lage melden“
 * opts = { standortId, daten: Promise<{meldungen, offline, zeit, unbekannt}>, nah: bool,
 *          onMehr() (alle sechs Typen), onGesendet(meldungen), onGeaendert(meldungen), toast }
 */
/**
 * Karte „Heute vor Ort“. onUnpassend(meldung, fertig) öffnet „Unpassend melden“ (fertig() nach dem Senden),
 * onAlle() führt zur Übersicht „Aktuelle Meldungen“.
 */
export function vorOrtKarte({ standortId, daten, nah, onMehr, onGesendet, onGeaendert, onUnpassend, onAlle, toast }) {
  const live = h('p', { class: 'sr-only', 'aria-live': 'polite' });
  const inhalt = h('div', { class: 'vo-inhalt', 'aria-busy': 'true' }, h('p', { class: 'muted small vo-laden', text: 'Wird geladen …' }));
  const karte = h('section', { class: 'vo-karte', id: 'heute-vor-ort', tabindex: '-1', 'aria-label': 'Heute vor Ort' }, inhalt, live);
  const st = { meldungen: [], offline: false, zeit: null, unbekannt: false, wahl: null, notiz: '', busy: false, offen: new Set(), danke: new Set() };
  const online = () => navigator.onLine !== false && !st.offline;
  const sag = (text) => { live.textContent = ''; setTimeout(() => { live.textContent = text; }, 30); };

  const kreis = (ico, cls) => h('span', { class: `vo-kreis ${cls}`, html: icon(ico, 20), 'aria-hidden': 'true' });
  // „Unpassend melden“ nur bei Meldungen mit Notiz (nur dort kann etwas Unpassendes stehen)
  const unpassend = (m) => (m.notiz && onUnpassend ? h('button', { type: 'button', class: 'vo-unpassend', 'aria-label': `Notiz „${m.notiz}“ als unpassend melden`,
    onclick: () => onUnpassend(m, () => { zeichnen(); onGeaendert?.(st.meldungen); sag('Meldung ausgeblendet.'); karte.focus(); }) },
    h('span', { html: icon('flag', 15), 'aria-hidden': 'true' }), h('span', { text: 'Unpassend melden' })) : null);

  function kopf({ klein = false } = {}) {
    const probleme = st.meldungen.filter(m => m.typ !== 'alles_frei');
    if (!probleme.length) {
      const frei = st.meldungen.find(m => m.typ === 'alles_frei');
      const sub = st.offline ? (st.unbekannt ? 'Offline – aktuelle Meldungen nicht verfügbar' : `Offline · ${standVon(st.zeit)}`)
        : frei ? `Zuletzt: „Alles frei“ · ${zeitpunkt(frei.erstelltAm)}` : null;
      return h('div', { class: 'vo-kopf' + (klein ? ' is-klein' : '') }, kreis('check', 'is-ok'),
        h('div', { class: 'vo-kopf-text' }, h('strong', { class: 'vo-status vo-ok', text: 'Heute keine Probleme gemeldet' }), sub && !klein ? h('small', { text: sub }) : null));
    }
    const m = probleme[0], t = TYPEN[m.typ] || TYPEN.hindernis;
    const sub = [alter(m.erstelltAm), m.bestaetigt ? `${m.bestaetigt}× bestätigt` : null, st.offline ? standVon(st.zeit) : null].filter(Boolean).join(' · ');
    return h('div', { class: 'vo-kopf' + (klein ? ' is-klein' : '') },
      h('span', { class: 'vo-kreis is-typ', style: `--c:${t.farbe}`, html: icon(t.ico, 20), 'aria-hidden': 'true' }),
      h('div', { class: 'vo-kopf-text' }, h('strong', { class: 'vo-status', text: t.zeile }),
        h('small', { text: sub }), m.notiz && !klein ? h('p', { class: 'vo-notiz', text: m.notiz }) : null, klein ? null : unpassend(m)));
  }

  function bewerten(m, box) {
    const fertig = schonBewertet(m.id) || st.danke.has(m.id);
    const ja = h('button', { type: 'button', class: 'vo-pille', text: 'Ja', disabled: fertig || !online(), 'aria-label': `Stimmt noch: ${TYPEN[m.typ]?.text || ''}` });
    const nein = h('button', { type: 'button', class: 'vo-pille', text: 'Nicht mehr', disabled: fertig || !online() });
    const danke = h('span', { class: 'vo-danke', text: st.danke.has(m.id) ? 'Danke!' : (fertig ? 'Bewertet' : '') });
    const klick = (stimmt) => async () => {
      ja.disabled = nein.disabled = true;
      try {
        const j = await bestaetigen(m, stimmt);
        st.danke.add(m.id); danke.textContent = 'Danke!'; sag('Danke für deine Bestätigung.');
        const liste = j.meldungen || [];
        setTimeout(() => { st.meldungen = liste; zeichnen(); onGeaendert?.(liste); }, 1200);
      } catch (e) { toast?.(e.message); if (!/schon bewertet/.test(e.message)) ja.disabled = nein.disabled = false; }
    };
    ja.onclick = klick(true); nein.onclick = klick(false);
    box.append(h('span', { class: 'vo-frage-text', text: 'Stimmt das noch?' }), h('span', { class: 'vo-pillen' }, danke, ja, nein));
    return box;
  }

  function weitere(liste) {
    if (!liste.length) return null;
    return h('ul', { class: 'vo-weitere' }, liste.map((m) => {
      const t = TYPEN[m.typ] || TYPEN.hindernis;
      const offen = st.offen.has(m.id);
      const knopf = h('button', { type: 'button', class: 'vo-weiter-btn', 'aria-expanded': String(offen),
        onclick: () => { if (offen) st.offen.delete(m.id); else st.offen.add(m.id); zeichnen(); } },
        h('span', { class: 'vo-punkt', style: `--c:${t.farbe}`, 'aria-hidden': 'true' }),
        h('span', { class: 'vo-weiter-text' }, h('strong', { text: t.text }), ` · ${alter(m.erstelltAm)}`),
        h('span', { class: 'vo-auf', html: icon('chevron', 18), 'aria-hidden': 'true' }));
      const details = offen ? h('div', { class: 'vo-weiter-details' },
        m.notiz ? h('p', { class: 'vo-notiz', text: m.notiz }) : null,
        h('p', { class: 'vo-meta', text: m.bestaetigt ? `${m.bestaetigt}× bestätigt` : 'noch nicht bestätigt' }),
        unpassend(m),
        nah ? bewerten(m, h('div', { class: 'vo-frage is-klein' })) : null) : null;
      return h('li', {}, knopf, details);
    }));
  }

  function chips(typen) {
    return h('div', { class: 'vo-chips', role: 'group', 'aria-label': 'Lage melden' },
      typen.map(typ => h('button', { type: 'button', class: `vo-chip vo-chip-${TYPEN[typ].ton}`, 'aria-pressed': 'false', disabled: !online(), dataset: { typ },
        onclick: () => { st.wahl = typ; st.notiz = ''; zeichnen(); karte.querySelector('#vo-notiz')?.focus(); sag(`${TYPEN[typ].text} gewählt. Notiz optional, dann Meldung senden.`); } },
        typ === 'alles_frei' ? h('span', { html: icon('check', 16), 'aria-hidden': 'true' }) : null, h('span', { text: TYPEN[typ].text }))),
      h('button', { type: 'button', class: 'vo-chip vo-chip-mehr', disabled: !online(), onclick: () => onMehr?.() },
        h('span', { text: 'Mehr' }), h('span', { html: icon('chevron', 16), 'aria-hidden': 'true' })));
  }

  const meldenZeile = () => h('button', { type: 'button', class: 'vo-melden', disabled: !online(), onclick: () => onMehr?.() },
    h('span', { class: 'vo-melden-ico', html: icon('pin', 22), 'aria-hidden': 'true' }),
    h('span', { class: 'vo-melden-text' }, h('strong', { text: 'Lage melden' }), h('small', { text: online() ? 'Warst du heute dort? Hilf anderen.' : 'Offline – gerade nicht möglich' })),
    h('span', { class: 'vo-melden-pfeil', html: icon('chevron', 20), 'aria-hidden': 'true' }));

  function bearbeiten() {
    const t = TYPEN[st.wahl];
    const status = h('p', { class: 'vo-fehler', role: 'alert', hidden: true });
    const notiz = h('input', { type: 'text', id: 'vo-notiz', class: 'vo-notizfeld', maxlength: NOTIZ_MAX, autocomplete: 'off', enterkeyhint: 'send',
      placeholder: 'Notiz (optional), z. B. Ausweichparkplatz am Waldweg', 'aria-label': `Notiz (optional, höchstens ${NOTIZ_MAX} Zeichen)`, value: st.notiz,
      oninput: () => { st.notiz = notiz.value; } });
    const sendBtn = h('button', { type: 'submit', class: 'vo-senden', text: st.busy ? 'Wird gesendet …' : 'Meldung senden', disabled: st.busy });
    const form = h('form', { class: 'vo-edit', novalidate: true },
      h('div', { class: 'vo-edit-kopf' }, h('strong', { text: 'Deine Meldung' }),
        h('button', { type: 'button', class: 'vo-aendern', text: 'Ändern', onclick: () => { st.wahl = null; zeichnen(); karte.querySelector('.vo-chip')?.focus(); } })),
      h('div', { class: 'vo-wahl' }, h('span', { html: icon(t.ico, 20), 'aria-hidden': 'true' }), h('span', { text: t.text })),
      notiz,
      h('div', { class: 'vo-edit-knoepfe' },
        h('button', { type: 'button', class: 'vo-abbrechen', text: 'Abbrechen', onclick: () => { st.wahl = null; st.notiz = ''; zeichnen(); karte.focus(); } }),
        sendBtn),
      status,
      h('p', { class: 'vo-hinweis', text: 'Öffentlich sichtbar · verschwindet nach 24 Stunden' }));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (st.busy) return;
      st.busy = true; sendBtn.disabled = true; sendBtn.textContent = 'Wird gesendet …';
      try {
        const j = await senden(standortId, st.wahl, notiz.value.trim());
        st.busy = false; st.wahl = null; st.notiz = ''; st.meldungen = j.meldungen || [];
        zeichnen();
        sag('Deine Meldung ist jetzt sichtbar.');
        onGesendet?.(st.meldungen);
      } catch (ex) {
        st.busy = false; sendBtn.disabled = false; sendBtn.textContent = 'Meldung senden';
        status.hidden = false; status.textContent = ex.message;
      }
    });
    return form;
  }

  // Fußzeile: Weg zur Übersicht aller Meldungen (Anzahl kommt aus dem gemeinsamen Abruf nach)
  const alleZahl = h('span', { class: 'vo-alle-zahl' });
  const alleZeile = onAlle ? h('div', { class: 'vo-alle' }, alleZahl,
    h('a', { class: 'vo-alle-link', href: '#meldungen', onclick: (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return; e.preventDefault(); onAlle(); } },
      'Alle Meldungen', h('span', { html: icon('chevron', 18), 'aria-hidden': 'true' }))) : null;
  if (onAlle) listeLaden().then((d) => { const n = d.meldungen.length; alleZahl.textContent = n ? `${n} ${n === 1 ? 'Meldung' : 'Meldungen'} im Revier` : ''; }, () => {});

  function zeichnen() {
    inhalt.removeAttribute('aria-busy');
    st.meldungen = ohneAusgeblendete(st.meldungen);
    const probleme = st.meldungen.filter(m => m.typ !== 'alles_frei');
    const ton = probleme.length ? (probleme[0].typ === 'gesperrt' ? 'vo-stop' : 'vo-warn') : 'vo-ok';
    karte.className = `vo-karte ${ton}` + (st.wahl ? ' is-edit' : '');
    const teile = [];
    // Keine Probleme, du bist nicht vor Ort: nur eine schmale Zeile (spart Platz für „Wichtig für dein Boot“)
    const schmal = !st.wahl && !probleme.length && !nah && !(st.offline && st.unbekannt);
    karte.classList.toggle('vo-schmal', schmal);
    if (schmal) {
      const frei = st.meldungen.find(m => m.typ === 'alles_frei');
      const sub = st.offline ? `Offline · ${standVon(st.zeit)}` : frei ? `Zuletzt: „Alles frei“ · ${zeitpunkt(frei.erstelltAm)}` : null;
      teile.push(h('div', { class: 'vo-schmal-zeile' }, kreis('check', 'is-ok'),
        h('div', { class: 'vo-kopf-text' }, h('strong', { class: 'vo-status vo-ok', text: 'Heute keine Probleme gemeldet' }), sub ? h('small', { text: sub }) : null),
        h('button', { type: 'button', class: 'vo-schmal-btn', disabled: !online(), 'aria-label': 'Lage melden', onclick: () => onMehr?.() },
          h('span', { html: icon('pin', 16), 'aria-hidden': 'true' }), h('span', { text: 'Lage melden' }))));
    } else if (st.wahl) {
      teile.push(h('div', { class: 'vo-oben' }, kopf({ klein: true })), bearbeiten());
    } else {
      const oben = h('div', { class: 'vo-oben' }, kopf());
      if (probleme.length && nah) oben.append(bewerten(probleme[0], h('div', { class: 'vo-frage' })));
      teile.push(oben);
      const w = weitere(probleme.slice(1));
      if (w) teile.push(w);
      if (nah) {
        teile.push(h('div', { class: 'vo-unten' },
          h('div', { class: 'vo-unten-kopf' }, h('strong', { text: probleme.length ? 'Lage hat sich geändert?' : 'Bist du gerade hier?' }),
            probleme.length ? null : h('small', { text: 'ein Tipp genügt' })),
          chips(probleme.length ? aenderungsChips(probleme[0].typ) : ['alles_frei', 'parkplatz_voll', 'warteschlange'])));
      } else {
        teile.push(meldenZeile());
      }
      if (alleZeile) teile.push(alleZeile);
    }
    inhalt.replaceChildren(...teile);
  }

  daten.then((d) => { Object.assign(st, { meldungen: d.meldungen || [], offline: !!d.offline, zeit: d.zeit, unbekannt: !!d.unbekannt }); zeichnen(); },
    () => { Object.assign(st, { offline: true, unbekannt: true }); zeichnen(); });
  karte.aktualisieren = (liste) => { st.meldungen = liste; st.wahl = null; zeichnen(); };
  return karte;
}

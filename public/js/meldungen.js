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

// ------------------------------------------------------------------ Laden
let aktivCache = null;   // { zeit, map: Map(id → {n, typ}), offline }
const lokale = new Map(); // eigene, gerade gesendete Stände (bis der CDN-Zwischenspeicher nachzieht)

function snapshotLesen() {
  try { const j = JSON.parse(localStorage.getItem(LS_AKTIV) || 'null'); return j && Array.isArray(j.aktiv) ? j : null; } catch { return null; }
}
function zuMap(liste) { return new Map(liste.map(a => [a.standortId, { n: a.n, typ: a.typ }])); }
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

const standortMem = new Map();   // id → { zeit, meldungen }
/** Meldungen eines Standorts – immer frisch; offline der zuletzt geladene Stand. */
export async function standortLaden(id, { fetchFn = fetch } = {}) {
  try {
    const r = await fetchFn(`${API}?standort=${encodeURIComponent(id)}`, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const res = { zeit: j.zeit || Date.now(), meldungen: Array.isArray(j?.meldungen) ? j.meldungen : [], offline: false };
    standortMem.set(id, res);
    return res;
  } catch {
    const alt = standortMem.get(id);
    return { zeit: alt?.zeit || null, meldungen: alt?.meldungen || [], offline: true, unbekannt: !alt };
  }
}

/** Zusammenfassung aus einer Liste (wichtigste zuerst, wie vom Server geliefert). */
export function zusammenfassen(meldungen) {
  const s = [...meldungen].sort((a, b) => (TYPEN[b.typ]?.rang || 0) - (TYPEN[a.typ]?.rang || 0) || b.erstelltAm - a.erstelltAm);
  return s.length ? { n: s.length, typ: s[0].typ } : null;
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
  return j;
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

/**
 * Abschnitt „Heute vor Ort“ im Detailpanel. daten: Promise<{meldungen, offline, zeit}>.
 * onMelden(): Lage melden; onGeaendert(meldungen): nach Bestätigung.
 */
export function heuteVorOrt(daten, { onMelden, onGeaendert, toast, online = () => navigator.onLine !== false }) {
  const box = h('div', { class: 'meld-liste', 'aria-busy': 'true' }, h('p', { class: 'muted small', text: 'Wird geladen …' }));
  const link = h('button', { type: 'button', class: 'meld-link', html: icon('pin', 16) }, h('span', { text: 'Lage hier melden' }));
  link.onclick = onMelden;
  const sec = h('section', { class: 'block meld-block', id: 'heute-vor-ort', tabindex: '-1', 'aria-labelledby': 'hvo-titel' },
    h('div', { class: 'meld-kopf' }, h('h3', { id: 'hvo-titel', text: 'Heute vor Ort' }), h('span', { class: 'muted small', text: 'verschwindet nach 24 h' })),
    box, link);
  const zeichnen = ({ meldungen, offline, zeit, unbekannt }) => {
    box.removeAttribute('aria-busy');
    const items = [];
    if (offline) items.push(h('p', { class: 'meld-offline', text: unbekannt ? 'Offline – aktuelle Meldungen können nicht geladen werden.' : `Offline · ${standVon(zeit)}` }));
    if (!meldungen.length && !(offline && unbekannt)) {
      items.push(h('p', { class: 'meld-keine' }, h('span', { html: icon('check', 18) }), h('span', { text: 'Keine Probleme gemeldet' })));
    }
    if (meldungen.length) {
      items.push(h('ul', {}, meldungen.map((m) => {
        const t = TYPEN[m.typ] || TYPEN.hindernis;
        const fertig = schonBewertet(m.id);
        const knoepfe = h('div', { class: 'meld-knoepfe' });
        const danke = h('span', { class: 'meld-danke', role: 'status' });
        const ja = h('button', { type: 'button', class: 'meld-btn', text: 'Stimmt noch', disabled: fertig || offline });
        const nein = h('button', { type: 'button', class: 'meld-btn', text: 'Nicht mehr', disabled: fertig || offline });
        const klick = (stimmt) => async () => {
          ja.disabled = nein.disabled = true;
          try {
            const j = await bestaetigen(m, stimmt);
            danke.textContent = 'Danke!';
            onGeaendert?.(j.meldungen || []);
          } catch (e) { toast?.(e.message); if (!/schon bewertet/.test(e.message)) { ja.disabled = nein.disabled = false; } }
        };
        ja.onclick = klick(true); nein.onclick = klick(false);
        knoepfe.append(ja, nein, fertig ? h('span', { class: 'meld-danke', text: 'Bewertet' }) : danke);
        return h('li', { class: `meld-item ${tonKlasse(m.typ)}` },
          h('span', { class: 'meld-ico', style: `--c:${t.farbe}`, html: icon(t.ico, 18) }),
          h('div', { class: 'meld-inhalt' },
            h('strong', { text: t.text }),
            m.notiz ? h('p', { class: 'meld-notiz', text: m.notiz }) : null,
            h('p', { class: 'meld-meta', text: [alter(m.erstelltAm), m.bestaetigt ? `${m.bestaetigt}× bestätigt` : null].filter(Boolean).join(' · ') }),
            knoepfe));
      })));
    }
    box.replaceChildren(...items);
    link.disabled = !online();
    link.title = online() ? '' : 'Offline – Melden ist gerade nicht möglich';
  };
  daten.then(zeichnen, () => zeichnen({ meldungen: [], offline: true, unbekannt: true }));
  sec.aktualisieren = (meldungen) => zeichnen({ meldungen, offline: false, zeit: Date.now() });
  return sec;
}

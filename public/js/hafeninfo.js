// Hafeninfos, automatisch von den Websites der Marinas ausgelesen (scripts/hafeninfo.py → data/hafeninfo.json).
// Sie füllen die Tabelle „Eigenschaften“: leere Felder („Nicht bekannt“) bekommen die Angabe der Website, weitere
// Angaben (Diesel, Kran …) kommen als eigene Zeilen dazu. Jede Angabe ist eine wörtliche Zeile der Website;
// Text wird nur als Text eingefügt.
import { CONFIG } from './config.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { formatDate, ageInDays, safeHttpUrl } from './model.js';

// Schlüssel → Anzeige (muss zu FACTS in scripts/hafeninfo.py passen; ein Test prüft das)
const LABELS = {
  gast_liegeplatz: 'Gastliegeplatz', dauerliegeplatz: 'Dauer-/Saisonliegeplatz', max_laenge: 'Max. Bootslänge',
  wassertiefe: 'Wassertiefe / Tiefgang', strom: 'Strom', wasser: 'Frischwasser', faekalien: 'Fäkalienabsaugung',
  diesel: 'Diesel', benzin: 'Benzin', duschen: 'Duschen', toiletten: 'Toiletten', waschmaschine: 'Waschmaschine / Trockner',
  wlan: 'WLAN', restaurant: 'Restaurant / Imbiss', einkauf: 'Einkauf / Brötchen', parken: 'Parken',
  wohnmobil: 'Wohnmobil-Stellplatz', slip: 'Slipanlage', kran: 'Kran', winterlager: 'Winterlager',
  werkstatt: 'Werkstatt / Service', entsorgung: 'Entsorgung', bootsverleih: 'Bootsverleih / Charter',
  hafenmeister: 'Hafenmeister', funk: 'UKW-Kanal', saison: 'Saison / Zeiten', haustiere: 'Hunde / Haustiere', sonstiges: 'Sonstiges',
};

// Vorhandene Zeilen der Eigenschaften-Tabelle (model.js describeFacts) → Schlüssel der Website-Angaben
const FILLS = {
  'Liegeplatzgebühr': 'gast_liegeplatz', 'Stromanschluss': 'strom', 'Frischwasser': 'wasser', 'Toiletten': 'toiletten',
  'Duschen': 'duschen', 'Restaurant': 'restaurant', 'Hafenmeister': 'hafenmeister', 'Öffnungszeiten': 'saison',
};

let loading = null;
export function loadHafeninfo(meta) {
  const rel = meta?.files?.hafeninfo;
  if (!rel) return Promise.resolve(null);
  if (!loading) {
    loading = fetch(CONFIG.DATA_BASE + rel).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(doc => doc?.places || {})
      .catch((e) => { loading = null; throw e; });
  }
  return loading;
}

const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

/** Zeilen [{label, value, note}] + Website-Angaben → Zeilen mit `web: [{value, quote}]` für Werte von der Website. */
export function mergeFacts(rows, facts) {
  const by = {};
  for (const f of facts) if (LABELS[f.key] && f.key !== 'sonstiges') (by[f.key] ||= []).push({ value: f.value, quote: f.quote });
  const used = new Set();
  const out = rows.map((r) => {
    const key = FILLS[r.label];
    if (key && by[key]) { used.add(key); return { ...r, web: by[key] }; }
    if (r.label === 'Gastliegeplätze' && !r.value && by.gast_liegeplatz) return { ...r, value: 'Ja', web: [] };  // Preis für Gäste → es gibt Gastplätze
    return r;
  });
  // alles Übrige als eigene Zeilen (nur wenn vorhanden), in der Reihenfolge von LABELS
  const extra = Object.keys(LABELS).filter(k => by[k] && !used.has(k)).map(k => ({ label: LABELS[k], value: null, web: by[k] }));
  const at = out.findIndex(r => r.label === 'Öffnungszeiten' || r.label === 'Betreiber');
  out.splice(at < 0 ? out.length : at, 0, ...extra);
  return out;
}

/**
 * Füllt die Eigenschaften-Tabelle nach, sobald die Hafeninfos geladen sind.
 * render(rows) baut die Tabelle (detail.js); block ist der Abschnitt mit der Tabelle.
 */
export function enrichFacts(meta, id) {
  if (!meta?.files?.hafeninfo) return null;
  return (block, rows, render) => loadHafeninfo(meta).then((places) => {
    const entry = places?.[id];
    const facts = (entry?.facts || []).filter(f => LABELS[f.key] && f.key !== 'sonstiges');
    if (!facts.length || !block.isConnected) return;
    block.querySelector('.facts-list')?.replaceWith(render(mergeFacts(rows, facts)));
    block.append(sourceNote(entry));
  }, () => { /* Zusatzinfo – fehlt die Datei, bleibt die Tabelle wie sie ist */ });
}

function sourceNote(entry) {
  const age = ageInDays(entry.checked);
  const stale = age !== null && age > CONFIG.HAFENINFO_STALE_DAYS;
  const src = safeHttpUrl(entry.source);
  return h('p', { class: 'hi-note' + (stale ? ' is-stale' : '') },
    h('span', { class: 'web-mark', html: icon('globe', 13), 'aria-hidden': 'true' }), ' = laut Website',
    src ? [' (', h('a', { href: src, target: '_blank', rel: 'noopener noreferrer', text: host(src) }), ')'] : '',
    ` · Stand ${formatDate(entry.checked) || 'unbekannt'} · ohne Gewähr`);
}

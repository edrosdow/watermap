// Hafeninfos, automatisch von den Websites der Marinas ausgelesen (scripts/hafeninfo.py → data/hafeninfo.json).
// Jede Angabe trägt ein wörtliches Zitat und die Quelle; Text wird nur als Text eingefügt.
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

const GROUPS = [
  ['Liegeplatz', ['gast_liegeplatz', 'dauerliegeplatz', 'max_laenge', 'wassertiefe']],
  ['Versorgung', ['strom', 'wasser', 'faekalien', 'diesel', 'benzin', 'entsorgung']],
  ['Ausstattung', ['duschen', 'toiletten', 'waschmaschine', 'wlan', 'restaurant', 'einkauf', 'parken', 'wohnmobil', 'haustiere']],
  ['Technik und Service', ['slip', 'kran', 'winterlager', 'werkstatt', 'bootsverleih']],
  ['Kontakt und Zeiten', ['hafenmeister', 'funk', 'saison', 'sonstiges']],
];

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

/** Abschnitt für die Detailansicht; leer (null), wenn es für diesen Ort nichts gibt. Füllt sich selbst. */
export function hafeninfoSection(meta, id) {
  if (!meta?.files?.hafeninfo) return null;
  const section = h('section', { class: 'block hi-block', hidden: true });
  loadHafeninfo(meta).then((places) => {
    const entry = places?.[id];
    const facts = (entry?.facts || []).filter(f => LABELS[f.key]);
    if (!facts.length) return;
    section.replaceChildren(...render(entry, facts));
    section.hidden = false;
  }, () => { /* Zusatzinfo – fehlt die Datei, bleibt der Abschnitt weg */ });
  return section;
}

function render(entry, facts) {
  const out = [h('h3', { text: 'Hafeninfos laut Website' })];
  const age = ageInDays(entry.checked);
  for (const [title, keys] of GROUPS) {
    const rows = facts.filter(f => keys.includes(f.key));
    if (!rows.length) continue;
    out.push(h('p', { class: 'hi-group', text: title }),
      h('dl', { class: 'facts hi-facts' }, rows.map(f => [
        h('dt', { text: LABELS[f.key] }),
        h('dd', { title: `„${f.quote}“` }, f.value),
      ])));
  }
  const src = safeHttpUrl(entry.source);
  const verbatim = entry.method === 'regeln';          // Werte sind wörtliche Zeilen der Website – Belege wären doppelt
  if (!verbatim) out.push(h('details', { class: 'hi-proof' }, h('summary', { text: 'Belege von der Website' }),
    h('ul', {}, facts.map(f => {
      const u = safeHttpUrl(f.url);
      return h('li', {}, h('strong', { text: `${LABELS[f.key]}: ` }), `„${f.quote}“ `,
        u ? h('a', { href: u, target: '_blank', rel: 'noopener noreferrer', text: host(u) + (new URL(u).pathname.length > 1 ? new URL(u).pathname : '') }) : null);
    }))));
  out.push(h('div', { class: 'note ' + (age !== null && age > CONFIG.HAFENINFO_STALE_DAYS ? 'note-warn' : 'note-info'), html: icon(age !== null && age > CONFIG.HAFENINFO_STALE_DAYS ? 'alert' : 'info', 18) },
    h('span', {}, verbatim ? 'Wörtliche Auszüge, automatisch von der Website des Hafens übernommen' : 'Automatisch von der Website des Hafens ausgelesen',
      src ? [' (', h('a', { href: src, target: '_blank', rel: 'noopener noreferrer', text: host(src) }), ')'] : '',
      `, Stand ${formatDate(entry.checked) || 'unbekannt'}. Ohne Gewähr – Preise und Leistungen können sich geändert haben; im Zweifel beim Hafen nachfragen.`)));
  return out;
}

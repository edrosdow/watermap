// Prüfliste (pruefung.html): Reihenfolge in Fließrichtung, Namen mit ae/oe/ue, Tidepegel, Gewässer ohne Bewertung – zum Kopieren.
import { pegelLaden } from './pegel-daten.js';
import { gruppieren, abschnitt } from './pegel-fluss.js';
import { umlautVerdacht } from './pegel-namen.js';
import { istTidepegel } from './gezeiten.js';

const aus = document.getElementById('ausgabe');
const km = (g) => (g.km === null || g.km === undefined ? '–' : g.km.toLocaleString('de-DE', { maximumFractionDigits: 1 }));

async function start() {
  let st;
  try { st = await pegelLaden(); } catch { aus.textContent = 'Pegeldaten sind gerade nicht erreichbar.'; return; }
  const gr = gruppieren(st.gauges);
  const teile = [];
  for (const name of ['Weser', 'Elbe', 'Rhein', 'Ems']) {
    const f = gr.fluesse.find(x => x.name === name) || gr.ohne.find(x => x.name === name);
    teile.push([`Reihenfolge ${name}`, f ? f.pegel.map((g, i) => `${i + 1}. ${g.name} (${[abschnitt(g), `km ${km(g)}`].filter(Boolean).join(' ')})${istTidepegel(g) ? ' · Tide' : ''}`).join('\n') : 'nicht gefunden']);
  }
  const verdacht = [...new Set(st.gauges.flatMap(g => [g.nameRoh, g.water]).filter(umlautVerdacht))].sort((a, b) => a.localeCompare(b, 'de'));
  teile.push(['Namen mit ae/oe/ue (Umlaut prüfen)', verdacht.join('\n') || 'keine']);
  const tide = st.gauges.filter(istTidepegel).sort((a, b) => a.water.localeCompare(b.water, 'de') || a.name.localeCompare(b.name, 'de'));
  teile.push([`Erkannte Tidepegel (${tide.length})`, tide.map(g => `${g.water}: ${g.name} (km ${km(g)}) · ${Object.entries(g.tideRefs || {}).map(([k, v]) => `${k} ${v}`).join(', ') || 'ohne Werte'}`).join('\n')]);
  teile.push([`Küste (${gr.kueste?.pegel.length || 0})`, (gr.kueste?.pegel || []).map(g => `${g.water}: ${g.name}`).join('\n') || 'keine']);
  teile.push([`Gewässer ohne Bewertung (${gr.ohne.length})`, gr.ohne.map(f => `${f.name} (${f.pegel.length})`).join('\n') || 'keine']);
  aus.replaceChildren(...teile.flatMap(([t, txt]) => { const h2 = document.createElement('h2'); h2.textContent = t; const pre = document.createElement('pre'); pre.textContent = txt; return [h2, pre]; }));
  document.getElementById('kopieren').onclick = async () => {
    const text = teile.map(([t, txt]) => `## ${t}\n${txt}`).join('\n\n');
    try { await navigator.clipboard.writeText(text); document.getElementById('kopieren').textContent = 'Kopiert ✓'; }
    catch { const r = document.createRange(); r.selectNodeContents(aus); getSelection().removeAllRanges(); getSelection().addRange(r); }
  };
}
start();

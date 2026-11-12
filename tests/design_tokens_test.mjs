// Wächter-Test Designsystem (Designumbau Phase 5, 7.74.0): schlägt fehl bei Werten außerhalb der Tokens (tokens.css, DESIGN_SYSTEM.md).
// Geprüft in public/css (außer tokens.css): Hex-Farben, px-Schriftgrößen, Gewichte außer 300/400/700, Radien und Schatten außerhalb der Tokens,
// alte Variablen (--navy, --ink …), Navy außerhalb von Logo/Kopfleiste. In public/js: Hex-Farben und alte Variablen.
// Begründete Ausnahmen stehen in AUSNAHMEN (Selektor bzw. Datei + Grund). Start: node tests/design_tokens_test.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const AUSNAHMEN = {
  navy: { sel: ['.app-header', 'header'], grund: 'Navy nur Logo und Desktop-Kopfleiste (Ausnahme „Lage melden“ am 12.11.2026 aufgehoben)' },
  klein: { sel: ['.gc-axis', '.gc-reflabel', '.gc-jetzt-text', '.pf-ax', '.pt-ax', '.pt-zeit', '.pt-jetzt', '.nav-badge', '.filter-n',
    '.leaflet-control-attribution', '.wm-extra-cluster', '.wm-cluster', '.wm-mbadge'], grund: 'Plaketten und Achsenbeschriftung unter 13 px (7.66.1)' },
  haar: { grund: 'Radius ≤ 3 px: Griffe, Balken, Striche' },
  js: {
    'icons.js': { muster: /export function logoSvg[\s\S]*$/, grund: 'Logo: Markenzeichen, gleich wie die App-Symbole (PNG)' },
    'config.js': { muster: /maske: '#[0-9A-Fa-f]{6}'/, grund: 'Kartendaten: Farbe der Gebietsmaske' },
    'extras.js': { muster: /color: '#[0-9A-Fa-f]{6}'/g, grund: 'Kartendaten: Farben der Zusatzebenen (Schleusen, Service)' },
  },
};
const ALT = /var\(--(navy|ink|muted|bg|line|slip|marina|fuel|fuel-ink|sky|white|warn-bg|warn-line|info-bg|danger|radius|shadow|shadow-lg)\)/;
const fehler = [];
const hat = (sel, liste) => liste.some(x => sel.includes(x));

function teileKomma(s) {
  const out = []; let t = 0, cur = '';
  for (const ch of s) { if (ch === '(') t++; if (ch === ')') t--; if (ch === ',' && !t) { out.push(cur.trim()); cur = ''; } else cur += ch; }
  out.push(cur.trim()); return out;
}
const radiusOk = (v) => /^calc\(var\(--wm-r-[a-z]+\)[^;]*\)$/.test(v) || v.split(/\s+/).every(t => /^(0|0px|var\(--wm-r-(s|m|l|rund)\)|calc\(var\(--wm-r-[a-z]+\)[^)]*\))$/.test(t) || (/^[0-9.]+px$/.test(t) && parseFloat(t) <= 3));
const schattenOk = (v) => v === 'none' || teileKomma(v).every(t => /^var\(--wm-schatten(-hoch)?\)$/.test(t) || t.startsWith('inset')
  || /^-?[0-9.]+(px)? -?[0-9.]+(px)? 0( |$)/.test(t) || /^0 0 0 /.test(t));

function pruefeCss(datei) {
  let s = readFileSync(join(ROOT, 'css', datei), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of s.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const sel = m[1].trim(), body = m[2];
    if (/^(from|to|[0-9.]+%)/.test(sel)) continue;          // Keyframes
    for (const d of body.split(';')) {
      const i = d.indexOf(':'); if (i < 0) continue;
      const p = d.slice(0, i).trim().toLowerCase(), v = d.slice(i + 1).trim().replace(/\s*!important$/, '');
      const wo = `${datei}: ${sel.slice(0, 70)} { ${p}: ${v.slice(0, 60)} }`;
      if (p.startsWith('--') && /^--(zb|pd)-/.test(p)) { if (/#[0-9a-f]{3,8}\b/i.test(v)) fehler.push(`Hex in Variable: ${wo}`); continue; }
      if (/#[0-9a-f]{3,8}\b/i.test(v)) fehler.push(`Hex-Farbe: ${wo}`);
      if (ALT.test(v)) fehler.push(`alte Variable: ${wo}`);
      if (v.includes('var(--wm-navy)') && !hat(sel, AUSNAHMEN.navy.sel)) fehler.push(`Navy außerhalb der Kopfleiste: ${wo}`);
      if (p === 'font-size' && /^[0-9.]+px$/.test(v) && !hat(sel, AUSNAHMEN.klein.sel)) fehler.push(`px-Schriftgröße: ${wo}`);
      if (p === 'font-weight' && /^[0-9]+$/.test(v) && !['300', '400', '700'].includes(v)) fehler.push(`Gewicht: ${wo}`);
      if (p === 'border-radius' && !radiusOk(v)) fehler.push(`Radius: ${wo}`);
      if (p === 'box-shadow' && !schattenOk(v)) fehler.push(`Schatten: ${wo}`);
    }
  }
}

function pruefeJs(datei) {
  let s = readFileSync(join(ROOT, 'js', datei), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const aus = AUSNAHMEN.js[datei];
  if (aus) s = s.replace(aus.muster, '');
  for (const m of s.matchAll(/['"`(:,\s]#[0-9a-fA-F]{6}\b|['"`(:,\s]#[0-9a-fA-F]{3}\b(?![0-9a-zA-Z])/g)) {
    const zeile = s.slice(0, m.index).split('\n').length;
    fehler.push(`Hex-Farbe in js/${datei} (Zeile ~${zeile}): ${s.slice(m.index - 30, m.index + 12).replace(/\s+/g, ' ')}`);
  }
  if (ALT.test(s)) fehler.push(`alte Variable in js/${datei}: ${s.match(ALT)[0]}`);
}

const css = readdirSync(join(ROOT, 'css')).filter(f => f.endsWith('.css') && f !== 'tokens.css');
const js = readdirSync(join(ROOT, 'js')).filter(f => f.endsWith('.js'));
css.forEach(pruefeCss); js.forEach(pruefeJs);

// Bekannte Token-Namen: jede var(--wm-…) muss in tokens.css stehen
const tokens = new Set([...readFileSync(join(ROOT, 'css', 'tokens.css'), 'utf8').matchAll(/(--wm-[a-z0-9-]+)\s*:/g)].map(m => m[1]));
for (const [ordner, liste] of [['css', css], ['js', js]]) for (const f of liste) {
  const s = readFileSync(join(ROOT, ordner, f), 'utf8');
  const lokal = new Set([...s.matchAll(/(--wm-[a-z0-9-]+)\s*:/g)].map(m => m[1]));   // in der Datei selbst gesetzt (z. B. --wm-sheet-oben)
  for (const m of s.matchAll(/var\((--wm-[a-z0-9-]+)/g)) if (!tokens.has(m[1]) && !lokal.has(m[1]) && !/--wm-sheet-|--wm-seg-|--wm-kopf-/.test(m[1])) fehler.push(`unbekanntes Token ${m[1]} in ${ordner}/${f}`);
}

const einzig = [...new Set(fehler)];
for (const f of einzig) console.log('FAIL ' + f);
console.log(`${css.length} CSS- und ${js.length} JS-Dateien geprüft, ${einzig.length} Verstöße`);
process.exit(einzig.length ? 1 : 0);

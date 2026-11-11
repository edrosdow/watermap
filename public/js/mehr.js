// Bereich „Mehr“ (#mehr) als Sheet über der Karte (Designumbau 3a, 7.72.0): Ortszeilen aus den Bausteinen.
// Die Merkliste ist nach „Gemerkt“ (gemerkt.js) umgezogen; „Mein WaterMap“ (Einstellungen) ist eine helle Zeile statt der dunklen Karte.
import { h } from './dom.js';
import { zeile, gruppe } from './bausteine.js';
import { CONFIG } from './config.js';

const KONTAKT = 'e.drosdow@gmail.com';   // wie im Impressum
const klick = (f) => (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return; e.preventDefault(); f(e); };

/** Inhalt von „Mehr“. ctx = { profil (Unterzeile „Mein WaterMap“), naehe(), einstellungen(opener) } */
export function mehrInhalt(root, ctx) {
  root.replaceChildren(
    gruppe([
      zeile({ ico: 'boat', titel: 'Mein WaterMap', unter: `Einstellungen · ${ctx.profil}`, href: '#mehr/einstellungen', onClick: klick((e) => ctx.einstellungen(e.currentTarget)) }),
      zeile({ ico: 'pin', titel: 'In der Nähe', unter: 'Slipanlagen, Häfen und Tankstellen nach Entfernung', href: '#naehe', onClick: klick(ctx.naehe) }),
    ], { label: 'Unterwegs' }),
    h('h3', { class: 'wm-abschnitt', text: 'WaterMap' }),
    gruppe([
      zeile({ ico: 'mail', titel: 'Hilfe und Feedback', unter: 'Fragen, Fehler, Wünsche per E-Mail', href: `mailto:${KONTAKT}?subject=${encodeURIComponent('WaterMap – Feedback')}` }),
      zeile({ ico: 'info', titel: 'Über WaterMap', unter: 'Datenquellen, Hinweise, Mitmachen', href: './ueber.html' }),
      zeile({ ico: 'shield', titel: 'Datenschutz', href: './datenschutz.html' }),
      zeile({ ico: 'doc', titel: 'Impressum', href: './impressum.html' }),
    ], { label: 'Über WaterMap' }),
    h('p', { class: 'mh-fuss', text: `Version ${CONFIG.VERSION} · Kartendaten © OpenStreetMap-Mitwirkende (ODbL)` }));
}

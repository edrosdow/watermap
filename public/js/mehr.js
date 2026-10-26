// Bereich „Mehr“ (#mehr) und Merkliste (#mehr/merkliste).
// Die Merkliste liest nur die vorhandenen Speicher: Standort-Favoriten (favorites.js) und „Meine Pegel“ (pegel-daten.js).
// Keine eigene Verwaltung, keine Datenumstellung.
import { h } from './dom.js';
import { icon, glyphSvg } from './icons.js';
import { CONFIG } from './config.js';

const KONTAKT = 'e.drosdow@gmail.com';   // wie im Impressum
const fmt = (v) => Math.round(v).toLocaleString('de-DE');
let bearbeiten = false;   // Merkliste im Bearbeiten-Modus (bleibt beim Neuzeichnen nach dem Entfernen erhalten)

/** Zeile in einer Gruppe: Symbol, Titel, Unterzeile, rechts Pfeil (oder eigener Inhalt). */
function zeile({ ico, icoHtml, icoKlasse = '', titel, sub, href, onclick, rechts }) {
  const inhalt = [
    h('span', { class: `bs-ico ${icoKlasse}`, html: icoHtml || icon(ico, 22), 'aria-hidden': 'true' }),
    h('span', { class: 'bs-text' }, h('strong', { text: titel }), sub ? h('small', { text: sub }) : null),
    rechts === undefined ? h('span', { class: 'bs-pfeil', html: icon('chevron', 18), 'aria-hidden': 'true' }) : rechts,
  ];
  if (href) return h('a', { class: 'bs-zeile', href, onclick }, inhalt);
  return h('button', { type: 'button', class: 'bs-zeile', onclick }, inhalt);
}
const abschnitt = (titel, kinder, rechts = null) => h('section', { class: 'bs-abschnitt' },
  h('div', { class: 'bs-abschnitt-kopf' }, h('h2', { text: titel }), rechts), h('div', { class: 'bs-gruppe' }, kinder));
const kopf = (titel, unter, zurueck) => h('header', { class: 'bs-kopf' },
  zurueck ? h('button', { type: 'button', class: 'bs-zurueck', 'aria-label': 'Zurück zu „Mehr“', html: icon('back', 24), onclick: zurueck }) : null,
  h('div', {}, h('h1', { class: 'bs-titel', id: 'bs-titel', tabindex: '-1', text: titel }), unter ? h('p', { class: 'bs-unter', text: unter }) : null));
const klick = (f) => (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return; e.preventDefault(); f(); };

/**
 * Übersicht „Mehr“. ctx = { anzahlOrte, anzahlPegel, naehe(), merkliste() }
 */
export function mehrSeite(root, ctx) {
  bearbeiten = false;
  const merk = [ctx.anzahlOrte ? `${ctx.anzahlOrte} ${ctx.anzahlOrte === 1 ? 'Ort' : 'Orte'}` : null,
    ctx.anzahlPegel ? `${ctx.anzahlPegel} Pegel` : null].filter(Boolean).join(' · ') || 'Gespeicherte Orte und Pegel';
  root.replaceChildren(h('div', { class: 'bs-seite' },
    kopf('Mehr'),
    abschnitt('Unterwegs', [
      zeile({ ico: 'pin', icoKlasse: 'is-dunkel', titel: 'In der Nähe', sub: 'Slipanlagen, Häfen und Tankstellen nach Entfernung', href: '#naehe', onclick: klick(ctx.naehe) }),
      zeile({ ico: 'star', titel: 'Merkliste', sub: merk, href: '#mehr/merkliste', onclick: klick(ctx.merkliste) }),
    ]),
    abschnitt('WaterMap', [
      zeile({ ico: 'mail', titel: 'Hilfe und Feedback', sub: 'Fragen, Fehler, Wünsche per E-Mail', href: `mailto:${KONTAKT}?subject=${encodeURIComponent('WaterMap – Feedback')}` }),
      zeile({ ico: 'info', titel: 'Über WaterMap', sub: 'Datenquellen, Hinweise, Mitmachen', href: './ueber.html' }),
    ]),
    abschnitt('Rechtliches', [
      zeile({ ico: 'shield', titel: 'Datenschutz', href: './datenschutz.html' }),
      zeile({ ico: 'doc', titel: 'Impressum', href: './impressum.html' }),
    ]),
    h('p', { class: 'bs-fuss', text: `Version ${CONFIG.VERSION} · Kartendaten © OpenStreetMap-Mitwirkende (ODbL)` })));
}

/**
 * Merkliste. ctx = {
 *   orte: [{ id, name, typ, sub }] | null (Standorte noch nicht geladen),
 *   pegel: Promise<{ eintraege: [{ id, name, sub, wert, einheit }], offline, stand }>,
 *   pegelIds: [id], oeffneOrt(id), oeffnePegel(id), entferneOrt(id), entfernePegel(id), zurueck(), zuPegel() }
 */
export function merkliste(root, ctx) {
  const umschalten = () => h('button', { type: 'button', class: 'bs-link', 'aria-pressed': String(bearbeiten), text: bearbeiten ? 'Fertig' : 'Bearbeiten',
    onclick: () => { bearbeiten = !bearbeiten; merkliste(root, ctx); root.querySelector('.bs-link')?.focus(); } });
  const entfernen = (titel, f) => h('button', { type: 'button', class: 'bs-entfernen', 'aria-label': `${titel} entfernen`, html: icon('close', 20),
    onclick: (e) => { e.preventDefault(); e.stopPropagation(); f(); } });   // die Speicher melden die Änderung, die Seite zeichnet neu

  // Orte
  let orteTeil;
  if (!ctx.orte) orteTeil = abschnitt('Gespeicherte Orte', [h('p', { class: 'bs-leer', text: 'Standorte werden geladen …' })]);
  else if (!ctx.orte.length) orteTeil = abschnitt('Gespeicherte Orte', [h('p', { class: 'bs-leer', text: 'Noch keine Orte gespeichert. Tippe in einer Standortansicht auf „Merken“.' })]);
  else orteTeil = abschnitt(`Gespeicherte Orte (${ctx.orte.length})`, ctx.orte.map(o => zeile({
    icoHtml: glyphSvg(o.typ, 22), icoKlasse: `bg-${o.typ} is-typ`, titel: o.name, sub: o.sub, href: `#p=${encodeURIComponent(o.id)}`,
    onclick: klick(() => ctx.oeffneOrt(o.id)), rechts: bearbeiten ? entfernen(o.name, () => ctx.entferneOrt(o.id)) : undefined,
  })), umschalten());

  // Pegel (Werte kommen nach)
  const pegelGruppe = h('div', { class: 'bs-gruppe' });
  const pegelHinweis = h('p', { class: 'bs-hinweis', hidden: true });
  const pegelTitel = h('h2', { text: ctx.pegelIds.length ? `Meine Pegel (${ctx.pegelIds.length})` : 'Meine Pegel' });
  const pegelTeil = h('section', { class: 'bs-abschnitt' }, h('div', { class: 'bs-abschnitt-kopf' }, pegelTitel, ctx.pegelIds.length ? umschalten() : null), pegelHinweis, pegelGruppe);
  if (!ctx.pegelIds.length) {
    pegelGruppe.append(h('p', { class: 'bs-leer' }, 'Noch keine Pegel gespeichert. Im Bereich ', h('a', { href: '#pegel', onclick: klick(ctx.zuPegel), text: 'Pegel' }), ' mit dem Stern hinzufügen.'));
  } else {
    pegelGruppe.append(h('p', { class: 'bs-leer', text: 'Pegelstände werden geladen …' }));
    ctx.pegel.then(({ eintraege, offline, stand }) => {
      if (!root.isConnected) return;
      pegelHinweis.hidden = !offline;
      if (offline) pegelHinweis.textContent = `Offline – letzter gespeicherter Stand${stand ? ` von ${new Date(stand).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}`;
      pegelGruppe.replaceChildren(...eintraege.map(p => zeile({
        ico: 'gauge', titel: p.name, sub: p.sub, href: `#pegel/${encodeURIComponent(p.id)}`, onclick: klick(() => ctx.oeffnePegel(p.id)),
        rechts: bearbeiten ? entfernen(p.name, () => ctx.entfernePegel(p.id)) : (p.wert !== null ? h('span', { class: 'bs-wert', text: `${fmt(p.wert)} ${p.einheit || 'cm'}` }) : undefined),
      })));
    }, () => { pegelGruppe.replaceChildren(h('p', { class: 'bs-leer', text: 'Pegelstände sind gerade nicht erreichbar.' })); });
  }

  root.replaceChildren(h('div', { class: 'bs-seite' },
    kopf('Merkliste', 'Gespeichert auf diesem Gerät', ctx.zurueck),
    orteTeil, pegelTeil,
    h('p', { class: 'bs-fuss', text: 'Pegel ordnest du im Bereich „Pegel“ unter „Meine Pegel“.' })));
}

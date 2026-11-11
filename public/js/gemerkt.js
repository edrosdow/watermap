// „Gemerkt“ (#gemerkt, Designumbau 3a, 7.72.0) – gemerkte Pegel und Orte als Sheet über der Karte; übernimmt die frühere Merkliste aus mehr.js.
// Liest nur die vorhandenen Speicher: Standort-Favoriten (favorites.js) und „Meine Pegel“ (pegel-daten.js).
import { h } from './dom.js';
import { icon, glyphSvg } from './icons.js';
import { zeile, gruppe, marke } from './bausteine.js';

const fmt = (v) => Math.round(v).toLocaleString('de-DE');
let bearbeiten = false;   // Bearbeiten-Modus bleibt beim Neuzeichnen nach dem Entfernen erhalten

/** Bearbeiten-Modus zurücksetzen (beim Öffnen des Sheets). */
export const gemerktFrisch = () => { bearbeiten = false; };

/**
 * ctx = {
 *   orte: [{ id, name, typ, sub }] | null (Standorte noch nicht geladen),
 *   pegel: Promise<{ eintraege: [{ id, name, sub, wert, einheit, ampel }], offline, stand }>,
 *   pegelIds: [id], oeffneOrt(id), oeffnePegel(id, opener), entferneOrt(id), entfernePegel(id), zuPegel(), setzeKopf(angaben) }
 */
export function gemerkt(root, ctx) {
  const anzahl = (ctx.orte?.length || 0) + ctx.pegelIds.length;
  const leer = ctx.orte && !ctx.orte.length && !ctx.pegelIds.length;
  // Kopf: Anzahl als Unterzeile, „Bearbeiten“/„Fertig“ als Zusatzknopf (nur mit Einträgen)
  ctx.setzeKopf({
    titel: 'Gemerkt', titelId: 'gm-titel',
    unter: anzahl ? `${anzahl} ${anzahl === 1 ? 'Eintrag' : 'Einträge'} · gespeichert auf diesem Gerät` : 'Gespeichert auf diesem Gerät',
    aktion: anzahl ? { icon: bearbeiten ? 'check' : 'edit', label: bearbeiten ? 'Fertig' : 'Bearbeiten', onclick: () => { bearbeiten = !bearbeiten; gemerkt(root, ctx); root.closest('.wm-sheet')?.querySelector('.wm-kopf .wm-rund:not(.wm-zu)')?.focus(); } } : null,
  });

  if (leer) {
    root.replaceChildren(h('div', { class: 'wm-leer gm-leer' },
      h('span', { class: 'gm-leer-ico', html: icon('star', 32), 'aria-hidden': 'true' }),
      h('p', { text: 'Noch nichts gemerkt – tippe bei einem Ort oder Pegel auf ☆.' }),
      h('button', { type: 'button', class: 'wm-btn', onclick: ctx.zuPegel }, 'Pegel auf der Karte zeigen')));
    return;
  }

  const entfernen = (titel, f) => h('button', { type: 'button', class: 'wm-rund gm-entfernen', 'aria-label': `${titel} entfernen`, html: icon('close', 18),
    onclick: (e) => { e.preventDefault(); e.stopPropagation(); f(); } });   // die Speicher melden die Änderung, das Sheet zeichnet neu

  // ---- Pegel (Werte kommen nach)
  const teile = [];
  if (ctx.pegelIds.length) {
    const box = h('div', { class: 'gm-pegel' }, gruppe([h('p', { class: 'gm-laedt', text: 'Pegelstände werden geladen …' })]));
    teile.push(h('h3', { class: 'wm-abschnitt', text: `Pegel (${ctx.pegelIds.length})` }), box);
    ctx.pegel.then(({ eintraege, offline, stand }) => {
      if (!box.isConnected) return;
      const hinweis = offline ? h('p', { class: 'gm-hinweis', role: 'status',
        text: `Offline – letzter gespeicherter Stand${stand ? ` von ${new Date(stand).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}` }) : null;
      box.replaceChildren(...[hinweis, gruppe(eintraege.map(p => {
        const wertText = p.wert !== null ? `${fmt(p.wert)} ${p.einheit || 'cm'}` : null;
        // rechts genau eines: mit Mindestpegel die Ampel („Passt mein Boot?“), sonst der Wert; im Bearbeiten-Modus „entfernen“
        const rechts = bearbeiten ? entfernen(p.name, () => ctx.entfernePegel(p.id)) : p.ampel ? marke(p.ampel.zustand, p.ampel.wort) : wertText ? { wert: wertText } : 'pfeil';
        const unter = [p.sub, p.ampel ? wertText : null].filter(Boolean).join(' · ');
        return zeile({ ico: 'gauge', titel: p.name, unter, rechts, href: bearbeiten ? null : `#karte/pegel/${encodeURIComponent(p.id)}`,
          onClick: bearbeiten ? null : klick((e) => ctx.oeffnePegel(p.id, e.currentTarget)) });
      }), { label: 'Gemerkte Pegel' })].filter(Boolean));
    }, () => { if (box.isConnected) box.replaceChildren(gruppe([h('p', { class: 'gm-laedt', text: 'Pegelstände sind gerade nicht erreichbar.' })])); });
  }

  // ---- Orte
  if (!ctx.orte) teile.push(h('h3', { class: 'wm-abschnitt', text: 'Orte' }), gruppe([h('p', { class: 'gm-laedt', text: 'Standorte werden geladen …' })]));
  else if (ctx.orte.length) {
    teile.push(h('h3', { class: 'wm-abschnitt', text: `Orte (${ctx.orte.length})` }),
      gruppe(ctx.orte.map(o => zeile({ icoHtml: glyphSvg(o.typ, 22), icoKlasse: `bg-${o.typ} is-typ`, titel: o.name, unter: o.sub,
        rechts: bearbeiten ? entfernen(o.name, () => ctx.entferneOrt(o.id)) : undefined,
        href: bearbeiten ? null : `#p=${encodeURIComponent(o.id)}`, onClick: bearbeiten ? null : klick(() => ctx.oeffneOrt(o.id)) })), { label: 'Gemerkte Orte' }));
  }
  root.replaceChildren(...teile);
}

/** Klick im selben Tab abfangen (neuer Tab mit Strg/Cmd/Mitteltaste bleibt möglich). */
const klick = (f) => (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return; e.preventDefault(); f(e); };

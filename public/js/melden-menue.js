// Melden (aus main.js ausgelagert, Designumbau Phase 5, 7.74.0): Menü „Was möchtest du melden?“ im Sheet-Rahmen (7.73.1),
// „Lage vor Ort melden“ mit Schnellknöpfen, wenn ein Standort in der Nähe ist. Einrichten: meldenEinrichten(ctx).
import { CONFIG } from './config.js';
import { h, $, clear } from './dom.js';
import { icon } from './icons.js';
import { displayName, haversine, formatDistance } from './model.js';
import { senden, TYPEN as MELD_TYPEN } from './meldungen.js';
import { sheetOeffnen, kopf, zeile, gruppe } from './bausteine.js';
import { staffeln } from './bewegung.js';

/** ctx: { state, choosePlaceFor, lageMelden, meldLokal, openReport, requestUserPos, showDetail, toast, standortOffen } – gibt { reportPop, renderReportMenu, closeMenu } zurück. */
export function meldenEinrichten(ctx) {
  const { state, choosePlaceFor, lageMelden, meldLokal, openReport, requestUserPos, showDetail, toast, standortOffen } = ctx;
  function closeMenu() { reportPop.close(); }

  /** „Melden“ im gemeinsamen Sheet-Rahmen (Designumbau, 7.73.1): Handy von unten, Desktop Panel rechts; × , Wischen, Esc und die
   *  Zurück-Taste schließen. Inhalt baut renderReportMenu in meldenRoot. Schnittstelle wie das frühere Popover. */
  const meldenRoot = h('div', { class: 'rm-inhalt' });
  function meldenSheet() {
    let sh = null;
    const api = {
      get isOpen() { return !!sh?.offen; },
      open(opener = null) {
        if (sh?.offen) return;
        sh = sheetOeffnen({ inhalt: meldenRoot, kopf: { titel: 'Was möchtest du melden?', titelId: 'report-title' }, klasse: 'rm-sheet', stufe: 'gross', verlauf: true, opener,
          onSchliessen: () => { sh = null; } });
        sh.el.id = 'report-menu';
        staffeln(meldenRoot.querySelectorAll('.lage-karte, .wm-gruppe, .wm-abschnitt'), { schritt: 55, max: 8 });   // Abschnitte erscheinen versetzt
      },
      // programmatisch (eine Meldung startet): ohne history.back – sonst nähme die Zurück-Taste den nächsten Schritt mit
      close({ nutzer = false } = {}) { const s0 = sh; sh = null; s0?.schliessen({ durchNutzer: nutzer }); },
      toggle(opener) { if (sh?.offen) api.close({ nutzer: true }); else api.open(opener); },
    };
    return api;
  }

  const LAGE_NEU_BIS = Date.parse('2026-11-22T00:00:00Z');   // Etikett „NEU“ 30 Tage nach Einführung
  const LAGE_RADIUS_M = 300;

  /** Nächster Standort (alle Kategorien) im Umkreis von 300 m. */
  function standortInDerNaehe(pos) {
    let best = null;
    for (const p of state.places) {
      if (p.type !== 'slip') continue;   // Lagemeldungen nur für Slipanlagen
      const d = haversine(pos.lat, pos.lon, p.lat, p.lon);
      if (d <= LAGE_RADIUS_M && (!best || d < best.d)) best = { p, d };
    }
    return best;
  }

  /**
   * „Was möchtest du melden?“ – oben „Lage vor Ort melden“ (mit Standortvorschlag), darunter die vier Meldungen und die Links.
   * fragen: Position jetzt abfragen (nur beim Öffnen durch den Nutzer, nie im Hintergrund).
   */
  function renderReportMenu({ fragen = false } = {}) {
    const body = clear(meldenRoot);
    const offline = navigator.onLine === false;
    // Ortszeile (Baustein) mit farbiger Kachel; Klassen menu-item/rm-item bleiben für Tests und Fokus
    const item = (ico, cls, label, unter, run, { online = false } = {}) => {
      const z = zeile({ ico, icoKlasse: `rm-ico ${cls}`, titel: label, unter: online && offline ? 'Offline – gerade nicht möglich' : unter, onClick: () => { closeMenu(); run(); } });
      z.classList.add('menu-item', 'rm-item'); z.disabled = online && offline;
      return z;
    };
    const abschnitt = (text) => h('h3', { class: 'wm-abschnitt rm-abschnitt', text });
    const frage = h('div', { class: 'lage-frage', hidden: true });
    const lageBtn = h('button', { type: 'button', class: 'lage-main', disabled: offline, onclick: () => { closeMenu(); choosePlaceFor('lage-melden'); } },
      h('span', { class: 'lage-ico', html: icon('pin', 24) }),
      h('span', { class: 'lage-text' }, h('strong', { text: 'Lage vor Ort melden' }), h('small', { text: offline ? 'Offline – gerade nicht möglich' : 'Parkplatz, Wartezeit, Rampe, Sperrung' })),
      Date.now() < LAGE_NEU_BIS ? h('span', { class: 'lage-neu', text: 'NEU' }) : null);
    body.append(
      abschnitt('Gerade vor Ort'),
      h('div', { class: 'lage-karte' }, lageBtn, frage),
      abschnitt('Standort verbessern'),
      gruppe([
        item('camera', 'rm-foto', 'Foto einreichen', 'Zeig anderen, wie es dort aussieht', () => choosePlaceFor('foto-einreichen')),
        item('doc', 'rm-ergaenzen', 'Angaben ergänzen', 'Gebühr, Rampe, Parken …', () => choosePlaceFor('slip-ergaenzen'), { online: true }),
        item('plus', 'rm-slip', 'Neue Slipanlage melden', 'Fehlt eine auf der Karte?', () => openReport('slipanlage-melden'))], { label: 'Standort verbessern' }),
      abschnitt('Fehler und Hinweise'),
      gruppe([
        item('flag', 'rm-fehler', 'Fehler oder Hinweis melden', 'Falsche Angabe, geschlossen, Sonstiges', () => choosePlaceFor('fehler-melden', { art: 'sonstiges' }))], { label: 'Fehler und Hinweise' }),
      h('p', { class: 'rmenu-links' },
        h('a', { href: './ueber.html', text: 'Über WaterMap' }), ' · ', h('a', { href: './datenschutz.html', text: 'Datenschutz' }), ' · ', h('a', { href: './impressum.html', text: 'Impressum' })),
      h('p', { class: 'muted small rm-version', text: `Version ${CONFIG.VERSION}` }));
    if (!fragen || offline || !('geolocation' in navigator)) return;
    // Position nur jetzt (Nutzer hat „Melden“ geöffnet); abgelehnt → still bei der Standortauswahl bleiben
    requestUserPos().then((pos) => {
      state.user = pos;
      const near = standortInDerNaehe(pos);
      if (!near || !reportPop.isOpen) return;
      const { p, d } = near;
      const status = h('p', { class: 'lage-status', role: 'status', 'aria-live': 'polite', hidden: true });
      let busy = false;
      // Ein Tipp sendet die Meldung sofort (ohne Notiz); „mehr“ öffnet das Formular mit Notiz
      const schnell = async (typ, btn) => {
        if (busy) return;
        busy = true; btn.setAttribute('aria-busy', 'true'); status.hidden = true;
        for (const b of knoepfe.children) b.disabled = true;
        try {
          const j = await senden(p.id, typ, '');
          closeMenu();
          toast('Danke! Deine Meldung ist jetzt sichtbar.');
          meldLokal(p.id, j.meldungen || []);
          if (state.selectedId === p.id && standortOffen()) showDetail(p, { scrollTo: 'vor-ort' });
        } catch (ex) {
          busy = false; btn.removeAttribute('aria-busy');
          for (const b of knoepfe.children) b.disabled = false;
          status.textContent = ex.message; status.hidden = false;
        }
      };
      const knoepfe = h('div', { class: 'lage-schnell', role: 'group', 'aria-label': 'Wie ist die Lage?' },
        Object.entries(MELD_TYPEN).map(([typ, t]) => h('button', { type: 'button', class: `lage-typ lage-${t.ton}`, dataset: { typ }, onclick: (e) => schnell(typ, e.currentTarget) },
          h('span', { html: icon(t.ico, 22), 'aria-hidden': 'true' }), h('span', { text: t.text }))));
      frage.replaceChildren(
        h('p', {}, 'Wie ist es gerade an der ', h('strong', { text: displayName(p) }), p.water?.name ? `, ${p.water.name}?` : '?', h('span', { class: 'lage-dist', text: ` · ${formatDistance(d)} entfernt` })),
        knoepfe, status,
        h('div', { class: 'lage-schnell-fuss' },
          h('span', {}, 'Mit Notiz: ', h('button', { type: 'button', class: 'lage-link lage-mehr', text: 'mehr', onclick: () => lageMelden(p, { distance: d, zurueck: true }) })),   // 8.0.6: Sheet legt sich über das Menü, Schließen führt zurück
          h('button', { type: 'button', class: 'lage-link lage-anders', text: 'Anderer Standort', onclick: () => { closeMenu(); choosePlaceFor('lage-melden'); } })));
      frage.hidden = false;
    }).catch(() => { /* ohne Position: Eintrag startet die Standortauswahl */ });
  }

  const reportPop = meldenSheet();
  return { reportPop, renderReportMenu, closeMenu };
}

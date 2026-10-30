// Bereich „Pegel“: Dashboard (#pegel) und Pegel-Detailseite (#pegel/<id>); Flussseite siehe pegel-fluss-ansicht.js.
// Daten: eine Stationsliste (pegel-daten.js) für Zähler, Fluss-Kacheln und Tabelle; Verläufe nur für sichtbare Karten.
import { h, announce } from './dom.js';
import { icon } from './icons.js';
import { haversine, formatDistance, displayName } from './model.js';
import { pegelLaden, verlaufLaden, meinePegel, vorhersageWLaden } from './pegel-daten.js';
import { lageSatz, wochenendTage, tageAusStunden, zelle, vorhersageTag, vorhersageZustand } from './pegel-lage.js';
import { pegelKarteAnsicht } from './pegel-karte.js';
import { tendenz } from './gezeiten.js';
import { fenster, loadWetterStunden, wxIcon } from './wetter.js';
import { alarmFenster } from './alarm.js';
import { fmt, kmText, zustand, ZUSTAND, etikett, trendText, trendKlasse, pegelKarte, pegelDetail, sternKnopf, mitTrend } from './pegel-ansicht.js';
import { formatTime } from './pegel.js';
import { ENTWICKLUNG } from './config.js';
import { normW, gleichesGewaesser, flussKm as flussKmRoh, gruppieren, kachelnSortieren, istKueste, slug, KUESTE_SLUG, flussZustand, FLUSS_ZUSTAND } from './pegel-fluss.js';
import { flussKachel, weitereGewaesser } from './pegel-fluss-ansicht.js';
import { umlautVerdacht } from './pegel-namen.js';

const flussKm = (g) => flussKmRoh(g) ?? 1e9;
const UEBERSICHT = ['rhein', 'elbe', 'weser', 'donau', 'main'];   // feste Kacheln (dazu die Küste); alle anderen Gewässer in der Liste
const zeitText = (t) => new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const standText = (st) => (st.offline ? `Offline · Stand von ${new Date(st.zeit).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}, ${zeitText(st.zeit)} Uhr`
  : `Stand ${zeitText(st.zeit)} · WSV/PEGELONLINE`);

/** Nächste Slipanlagen am selben Gewässer (für Detailseite). */
export function slipsAmPegel(g, places, max = 5, radius = 30000) {
  if (!normW(g.water)) return [];
  return places.filter(p => p.type === 'slip' && p.water?.name && gleichesGewaesser(p.water.name, g.water))
    .map(p => ({ p, d: haversine(g.lat, g.lon, p.lat, p.lon), name: displayName(p) }))
    .filter(e => e.d <= radius).sort((a, b) => a.d - b.d).slice(0, max);
}

/**
 * ctx = { user(): {lat,lon}|null, places(): Place[], isMobile(), open(id), ampel(id, {alarm}), karte(g), slip(p), share(g), toast,
 *         fluss(slug), ansicht(): 'liste' | 'karte', setAnsicht(a) }
 * Aufbau: Kopf mit Umschalter Liste | Karte, ein Suchfeld, dann je nach Ansicht
 *  Liste: Meine Pegel (mit Lage-Satz) · Lage in Deutschland (3 Zähler, Flüsse im Überblick) · Wochenende · Werkzeuge
 *  Karte: Pegel als Wert-Pillen, Legende, Vorschau-Karte.
 */
export function pegelDashboard(root, ctx) {
  const ui = { filter: null, sort: null, suche: '', alleMeine: false, bearbeiten: false, zeilen: 60 };
  let stand = null, seite = null, veraltet = false;   // seite: zuletzt gezeichneter Inhalt (wird beim erneuten Öffnen wiederverwendet)
  let karte = null, meineBox = null, trefferBox = null, wochenBox = null, alleBox = null;

  const entfernung = (g) => { const u = ctx.user(); return u ? haversine(u.lat, u.lon, g.lat, g.lon) : null; };
  const ansicht = () => (ctx.ansicht?.() === 'karte' ? 'karte' : 'liste');

  async function laden(force = false) {
    let neu;
    try { neu = await pegelLaden({ force }); }
    catch { neu = null; }
    // Gleicher Datenstand und Inhalt noch da: nichts neu aufbauen (Wechsel zu „Pegel“ ohne Wartezeit)
    if (!force && neu && neu === stand && seite?.isConnected && !veraltet) { if (ansicht() === 'karte') karte?.zeigen(); return; }
    stand = neu;
    if (stand) karte?.aktualisieren();
    zeichnen();
  }

  // ---------------------------------------------------------------- Kopf, Umschalter, Suche
  function kopf() {
    const tab = (a, text) => h('button', { type: 'button', role: 'tab', id: `pg-tab-${a}`, class: 'pg-tab' + (ansicht() === a ? ' is-an' : ''), 'aria-selected': String(ansicht() === a),
      tabindex: ansicht() === a ? '0' : '-1', onclick: () => umschalten(a),
      onkeydown: (e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); umschalten(a === 'liste' ? 'karte' : 'liste', true); } } }, text);
    return h('header', { class: 'pg-kopf' },
      h('div', { class: 'pg-kopf-zeile' },
        h('div', { class: 'pg-kopf-text' },
          h('div', { class: 'pg-titelzeile' }, h('h1', { class: 'pg-titel', text: 'Pegel' }),
            h('button', { type: 'button', class: 'pg-neu', 'aria-label': 'Pegel aktualisieren', html: icon('refresh', 18), onclick: async (e) => {
              e.currentTarget.classList.add('is-busy'); await laden(true); ctx.toast?.(stand?.offline ? 'Keine Verbindung – letzter Stand wird angezeigt.' : 'Pegel aktualisiert.'); } }))),
        h('div', { class: 'pg-tabs', role: 'tablist', 'aria-label': 'Ansicht' }, tab('liste', 'Liste'), tab('karte', 'Karte'))),
      h('p', { class: 'pg-stand', 'aria-live': 'polite', text: stand ? standText(stand) : 'Wird geladen …' }));
  }
  function umschalten(a, fokus = false) {
    if (a === ansicht()) return;
    ctx.setAnsicht?.(a);
    zeichnen();
    if (fokus) root.querySelector(`#pg-tab-${a}`)?.focus();
  }

  const MAX_TREFFER = 40;
  function suche() {
    const feld = h('input', { type: 'search', class: 'pg-suche', id: 'pg-suche', placeholder: 'Pegel oder Gewässer suchen und merken', 'aria-label': 'Pegel oder Gewässer suchen und merken', value: ui.suche, autocomplete: 'off',
      oninput: () => { ui.suche = feld.value; if (feld.value.trim()) ui.filter = null; zeichneTreffer(); zeichneAlle(); } });
    trefferBox = h('div', { class: 'pg-treffer', id: 'pg-treffer' });
    zeichneTreffer();
    return h('div', { class: 'pg-suchzeile' }, h('div', { class: 'pg-suche-box' }, h('span', { class: 'pg-suche-ico', html: icon('search', 20), 'aria-hidden': 'true' }), feld), trefferBox);
  }
  function zeichneTreffer() {
    if (!trefferBox || !stand) return;
    const q = normW(ui.suche);
    if (!q) { trefferBox.replaceChildren(); trefferBox.hidden = true; return; }
    const start = (g) => (normW(g.name).startsWith(q) ? 0 : 1);
    const treffer = stand.gauges.filter(g => normW(g.name).includes(q) || normW(g.water).includes(q))
      .sort((a, b) => start(a) - start(b) || (entfernung(a) ?? 0) - (entfernung(b) ?? 0) || a.name.localeCompare(b.name, 'de'));
    const zeile = (g) => {
      const d = entfernung(g);
      return h('li', { class: 'pa-zeile' },
        h('button', { type: 'button', class: 'pa-text pg-treffer-btn', onclick: () => ctx.open(g.id) }, h('strong', { text: g.name }),
          h('small', { text: [g.water, kmText(g), d !== null ? formatDistance(d) : ''].filter(Boolean).join(' · ') })),
        h('span', { class: 'pa-wert' }, h('b', { text: `${fmt(g.value)} ${g.unit}` }), etikett(g)),
        sternKnopf(g, { klein: true, onChange: () => zeichneTreffer() }));
    };
    trefferBox.hidden = false;
    trefferBox.replaceChildren(
      h('p', { class: 'pa-kopf', role: 'status', text: treffer.length ? `${fmt(treffer.length)} Treffer` : 'Kein Pegel gefunden.' }),
      h('ul', { class: 'pa-liste' }, treffer.slice(0, MAX_TREFFER).map(zeile)),
      ...(treffer.length > MAX_TREFFER ? [h('p', { class: 'pa-mehr', text: `Weitere ${fmt(treffer.length - MAX_TREFFER)} – bitte genauer suchen.` })] : []));
  }
  const sucheFokussieren = () => { const f = root.querySelector('#pg-suche'); root.scrollTop = 0; f?.scrollIntoView({ block: 'center' }); f?.focus(); };

  // ---------------------------------------------------------------- Meine Pegel
  const MAX_KARTEN = 3;
  function meineInhalt() {
    meinePegel.ampelUebernehmen();
    const alle = meinePegel.alle().filter(id => stand.byId.has(id));
    let ids = alle, titel = 'Meine Pegel', hinweis = null;
    if (!ids.length) {
      const u = ctx.user();
      if (u) {
        ids = [...stand.gauges].sort((a, b) => entfernung(a) - entfernung(b)).slice(0, 3).map(g => g.id);
        titel = 'Pegel in deiner Nähe'; hinweis = 'Tippe auf ☆, um Pegel zu merken.';
      } else {
        hinweis = 'Noch keine Pegel gemerkt. Suche oben nach einem Pegel und tippe auf den Stern.';
      }
    }
    const gemerkt = alle.length > 0;
    const sichtbar = ui.alleMeine || ui.bearbeiten ? ids : ids.slice(0, MAX_KARTEN);
    const rest = ids.slice(sichtbar.length);
    const satz = h('p', { class: 'pg-lage-satz', role: 'status', hidden: !gemerkt });
    if (gemerkt) lageSatzFuellen(satz, alle);
    const kopfZeile = h('div', { class: 'pg-h2-zeile' }, h('h2', { id: 'pg-meine-t', class: 'pg-h2', text: titel }),
      h('div', { class: 'pg-h2-links' },
        h('button', { type: 'button', class: 'pg-link pg-hinzu', onclick: sucheFokussieren, 'aria-label': 'Pegel hinzufügen (Suche)' }, '+ Hinzufügen'),
        gemerkt ? h('button', { type: 'button', class: 'pg-link pg-bearb', 'aria-pressed': String(ui.bearbeiten), text: ui.bearbeiten ? 'Fertig' : 'Bearbeiten',
          onclick: () => { ui.bearbeiten = !ui.bearbeiten; aktualisieren(); root.querySelector('.pg-meine .pg-bearb')?.focus(); } }) : null));
    const liste = h('div', { class: 'pg-karten' });
    sichtbar.forEach((id, i) => {
      const g = stand.byId.get(id);
      const bearb = ui.bearbeiten && gemerkt ? h('div', { class: 'pm-bearb' },
        h('button', { type: 'button', class: 'pm-bbtn', 'aria-label': `${g.name} nach oben`, html: icon('back', 18), disabled: i === 0, onclick: () => { meinePegel.verschieben(id, -1); } }),
        h('button', { type: 'button', class: 'pm-bbtn is-runter', 'aria-label': `${g.name} nach unten`, html: icon('back', 18), disabled: i === ids.length - 1, onclick: () => { meinePegel.verschieben(id, 1); } }),
        h('button', { type: 'button', class: 'pm-bbtn is-weg', text: 'Entfernen', onclick: () => { meinePegel.entfernen(id); } })) : null;
      liste.append(pegelKarte(g, { verlauf: verlaufLaden(id), onOpen: () => ctx.open(id), bearbeiten: bearb }));
    });
    const namen = rest.slice(0, 3).map(id => stand.byId.get(id).name).join(', ') + (rest.length > 3 ? ' …' : '');
    return [kopfZeile, satz, hinweis ? h('p', { class: 'pg-hinweis', text: hinweis }) : null, liste,
      rest.length ? h('button', { type: 'button', class: 'pg-link pg-weitere', 'aria-expanded': 'false', text: `+ ${rest.length} weitere Pegel (${namen}) ›`,
        onclick: () => { ui.alleMeine = true; aktualisieren(); } }) : (ui.alleMeine && !ui.bearbeiten && ids.length > MAX_KARTEN
          ? h('button', { type: 'button', class: 'pg-link pg-weitere', 'aria-expanded': 'true', text: 'Weniger anzeigen', onclick: () => { ui.alleMeine = false; aktualisieren(); } }) : null)];
  }
  function meine() {
    meineBox = h('section', { class: 'pg-meine', 'aria-labelledby': 'pg-meine-t' }, ...meineInhalt());
    return meineBox;
  }

  /** Lage-Satz: erst mit den Daten der Stationsliste, dann (sobald die Verläufe da sind) mit Trend und Tide-Tendenz. */
  function lageSatzFuellen(p, ids) {
    const gauges = ids.map(id => stand.byId.get(id)).filter(Boolean);
    const zeigen = (eintraege) => {
      const teile = lageSatz(eintraege);
      if (!teile) { p.hidden = true; return; }
      p.hidden = false;
      p.replaceChildren(...teile.map(t => (t.ton ? h('span', { class: `ls-${t.ton}`, text: t.text }) : t.text)));
    };
    zeigen(gauges.map(g => ({ g, tide: null })));
    Promise.all(gauges.map(g => verlaufLaden(g.id).then(pts => ({ g: g.tide ? g : mitTrend(g, pts), tide: g.tide ? tendenz(pts) : null }), () => ({ g, tide: null }))))
      .then((e) => { if (p.isConnected) zeigen(e); });
  }

  // ---------------------------------------------------------------- Lage in Deutschland, Flüsse im Überblick
  function lage() {
    const n = { hsw: 0, high: 0, low: 0 };
    for (const g of stand.gauges) { const z = zustand(g); if (z in n) n[z]++; }
    const zaehler = (z, titel) => h('button', { type: 'button', class: `pg-zaehler is-${z}` + (ui.filter?.art === 'zustand' && ui.filter.wert === z ? ' is-aktiv' : ''),
      'aria-label': `${n[z]} Pegel ${titel}. Liste filtern`, 'aria-pressed': String(ui.filter?.art === 'zustand' && ui.filter.wert === z),
      onclick: () => setFilter(ui.filter?.wert === z ? null : { art: 'zustand', wert: z, text: titel }) },
      h('i', { 'aria-hidden': 'true' }), h('strong', { text: fmt(n[z]) }), h('b', { text: titel }));
    return h('section', { class: 'pg-lage', 'aria-labelledby': 'pg-lage-t' },
      h('h2', { id: 'pg-lage-t', class: 'pg-h2', text: 'Deutschland heute' }),
      h('div', { class: 'pg-lage-karte' },
        h('div', { class: 'pg-zaehler-reihe' }, zaehler('hsw', 'über HSW'), zaehler('high', 'hoch'), zaehler('low', 'niedrig')),
        fluesseZeile()));
  }

  // Fluss-Kacheln: zuerst Flüsse mit „Meine Pegel“, dann nach Schwere; Küste immer zuletzt; Kanäle nur unter „Alle Gewässer“
  let gemeldet = false;
  function fluesseDaten() {
    meinePegel.ampelUebernehmen();   // vor der Sortierung: Pegel der Pegel-Ampel zählt schon als „Meine Pegel“
    const gr = gruppieren(stand.gauges);
    if (ENTWICKLUNG && !gemeldet) {
      // Prüflisten für die Vorschau: Zuordnung Küste/Kanäle, Reihenfolge in Fließrichtung, Namen mit möglichen Umlauten
      gemeldet = true;
      if (gr.ohne.length) console.info('[WaterMap] Gewässer ohne Bewertung (keine Küste laut CONFIG.PEGEL_KUESTE):', gr.ohne.map(f => `${f.name} (${f.pegel.length})`).join(', '));
      for (const name of ['Weser', 'Elbe', 'Rhein', 'Ems']) {
        const f = gr.fluesse.find(x => x.name === name);
        if (f) console.info(`[WaterMap] Reihenfolge ${name}:`, f.pegel.map(g => `${g.name} (${g.km ?? '–'})`).join(' → '));
      }
      const verdacht = [...new Set(stand.gauges.flatMap(g => [g.nameRoh, g.water]).filter(umlautVerdacht))].sort();
      if (verdacht.length) console.info('[WaterMap] Namen mit ae/oe/ue (Umlaut prüfen, Korrektur in js/pegel-namen.js):', verdacht.join(', '));
    }
    // Übersicht: feste Kacheln der großen Flüsse und der Küste; alle übrigen Gewässer als kompakte Liste darunter
    const fl = kachelnSortieren(gr.fluesse, meinePegel.alle());
    const haupt = UEBERSICHT.map(n => fl.find(f => f.name.toLowerCase() === n)).filter(Boolean);
    const weitere = fl.filter(f => !haupt.includes(f));
    return { gr, haupt, weitere, zeigen: [...haupt, ...(gr.kueste ? [gr.kueste] : [])] };
  }
  /** Kurzfassung für die Zeile: die auffälligen Flüsse („Elbe niedrig · Mosel hoch“), sonst „alle normal“. */
  function fluesseKurz(d) {
    const auff = d.zeigen.filter(f => !['normal', 'keine', 'kueste'].includes(flussZustand(f).key)).slice(0, 2);
    return auff.length ? auff.map(f => `${f.name} ${FLUSS_ZUSTAND[flussZustand(f).key].text}`).join(' · ') : 'Hauptflüsse normal';
  }
  function fluesseZeile() {
    const d = fluesseDaten();
    return h('button', { type: 'button', class: 'pg-fl-zeile', 'aria-haspopup': 'dialog', onclick: (e) => fluesseFenster(e.currentTarget) },
      h('strong', { text: 'Flüsse im Überblick' }), h('span', { class: 'pg-fl-kurz', text: fluesseKurz(d) }), h('span', { class: 'pg-fl-pfeil', html: icon('chevron', 18), 'aria-hidden': 'true' }));
  }
  /** Die Fluss-Kacheln in einem Fenster; ein Fluss darin öffnet sein eigenes Fenster darüber. */
  function fluesseFenster(opener) {
    const d = fluesseDaten();
    let alle = false, dlg;
    const inhalt = h('div', { class: 'pg-fl-fenster' });
    const zeichnenFl = () => {
      const anzahl = d.zeigen.length + d.weitere.length + d.gr.ohne.length, mehr = d.weitere.length + d.gr.ohne.length;
      inhalt.replaceChildren(
        h('div', { class: 'fk-raster' }, d.zeigen.map(f => flussKachel(f, (slug) => ctx.fluss(slug)))),
        mehr ? h('button', { type: 'button', class: 'pg-link pg-fl-alle', 'aria-expanded': String(alle), 'aria-controls': 'fk-weitere',
          text: alle ? 'Weniger Gewässer anzeigen' : `Alle ${anzahl} Gewässer anzeigen ›`,
          onclick: () => { alle = !alle; zeichnenFl(); inhalt.querySelector('.pg-fl-alle')?.focus({ preventScroll: true }); } }) : null,
        alle && mehr ? weitereGewaesser(d.weitere, d.gr.ohne, (slug) => ctx.fluss(slug)) : null);
    };
    zeichnenFl();
    dlg = fenster({ inhalt, klasse: 'wxd-fluesse', labelId: 'pgfl-titel', opener, kopf: h('header', { class: 'wxd-kopf' },
      h('div', {}, h('h2', { id: 'pgfl-titel', tabindex: '-1', text: 'Flüsse im Überblick' }), h('p', { class: 'wxd-unter', text: 'Tippe auf einen Fluss für alle Pegel' })),
      h('button', { type: 'button', class: 'wxd-x', 'aria-label': 'Schließen', html: icon('close', 22), onclick: () => dlg.close() })) });
  }

  // ---------------------------------------------------------------- Wochenende an den gemerkten Pegeln
  function wochenende() {
    wochenBox = h('section', { class: 'pg-wochenende', 'aria-labelledby': 'pg-wo-t', hidden: true });
    wochenFuellen();
    return wochenBox;
  }
  /** Wochenend-Check: je gemerktem Pegel eine Zeile, je Tag Wetter am Ort des Pegels und eine Ampel mit Text. */
  const MAX_WO = 6;
  function wochenFuellen() {
    if (!wochenBox || !stand) return;
    const gemerkt = meinePegel.alle().map(id => stand.byId.get(id)).filter(Boolean).slice(0, MAX_WO);
    if (!gemerkt.length) { wochenBox.hidden = true; wochenBox.replaceChildren(); return; }
    const { titel, tage } = wochenendTage();
    Promise.all([Promise.all(gemerkt.map(g => loadWetterStunden(g.lat, g.lon).then(st => tageAusStunden(st, tage)))),
      Promise.all(gemerkt.map(g => (g.tide ? Promise.resolve(null) : vorhersageWLaden(g.id))))]).then(([jeOrt, prog]) => {
      if (!wochenBox?.isConnected) return;
      if (!jeOrt.some(t => t.some(Boolean))) { wochenBox.hidden = true; wochenBox.replaceChildren(); return; }
      const namen = tage.map(d => ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'][d.getDay()]);
      const kurz = (n) => n.slice(0, 2);
      const zeilen = gemerkt.map((g, i) => h('tr', {},
        h('th', { scope: 'row' }, h('span', { class: 'pg-wo-name', text: g.name }), h('small', { text: `${fmt(g.value)} ${g.unit} · ${ZUSTAND[zustand(g)].text.toLowerCase()}` })),
        jeOrt[i].map((t, j) => {
          const z = zelle(g, t, vorhersageZustand(g, vorhersageTag(prog[i], tage[j])));
          if (!t || !z) return h('td', { class: 'pg-wo-leer', text: '–', 'aria-label': `${namen[j]}: keine Wetterdaten` });
          const w = wxIcon(t.icon, 18);
          return h('td', { 'aria-label': `${namen[j]}: ${w.label ? w.label + ', ' : ''}${t.temp !== null ? Math.round(t.temp) + ' Grad, ' : ''}${z.text}` },
            h('span', { class: 'pg-wo-wx', 'aria-hidden': 'true' }, h('i', { class: `pg-wo-dot is-${z.ton}` }), h('span', { html: t.icon ? w.svg : '' }), t.temp !== null ? `${Math.round(t.temp)}°` : ''),
            h('span', { class: `pg-wo-text is-${z.ton}`, 'aria-hidden': 'true', text: z.text }));
        })));
      wochenBox.hidden = false;
      wochenBox.replaceChildren(h('h2', { id: 'pg-wo-t', class: 'pg-h2', text: titel }),
        h('div', { class: 'pg-wo-karte' },
          h('table', { class: 'pg-wo-tabelle' },
            h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, h('span', { class: 'pg-sr', text: 'Pegel' })), namen.map(n => h('th', { scope: 'col' }, h('span', { 'aria-hidden': 'true', text: kurz(n) }), h('span', { class: 'pg-sr', text: n }))))),
            h('tbody', {}, zeilen)),
          h('p', { class: 'pg-wo-legende' }, h('i', { class: 'pg-wo-dot is-gruen' }), ' gut · ', h('i', { class: 'pg-wo-dot is-gelb' }), ' knapp/windig · ',
            h('i', { class: 'pg-wo-dot is-rot' }), ` Hochwasser. Wetter je Ort (DWD), Pegel: ${prog.some(v => v?.length) ? 'Vorhersage (WSV), wo vorhanden, sonst Stand heute' : 'Stand heute'}.`)));
    });
  }

  function werkzeuge() {
    const erster = meinePegel.alle().find(id => stand?.byId.has(id)) || null;
    return h('section', { class: 'pg-werkzeuge', 'aria-labelledby': 'pg-wz-t' },
      h('h2', { id: 'pg-wz-t', class: 'pg-h2 pg-sr', text: 'Werkzeuge' }),
      h('div', { class: 'pg-wz-reihe' },
        h('a', { class: 'pg-wz is-ampel', href: './pegel-ampel' + (erster ? `?pegel=${encodeURIComponent(erster)}` : '') },
          h('span', { class: 'pg-wz-text' }, h('strong', { text: 'Passt mein Boot?' }), h('small', { text: 'Pegel-Ampel ›' }))),
        // Pegel-Alarm: für den ersten gemerkten Pegel direkt das Fenster, sonst erst einen Pegel suchen
        erster ? h('button', { type: 'button', class: 'pg-wz is-alarm', 'aria-haspopup': 'dialog', onclick: (e) => alarmFenster(stand.byId.get(erster), { opener: e.currentTarget }) },
          h('span', { class: 'pg-wz-text' }, h('strong', { text: 'Pegel-Alarm' }), h('small', { text: `für ${stand.byId.get(erster).name} ›` })))
          : h('button', { type: 'button', class: 'pg-wz is-alarm', onclick: () => { sucheFokussieren(); ctx.toast?.('Wähle zuerst einen Pegel – im Pegel-Fenster findest du „Pegel-Alarm“.'); } },
            h('span', { class: 'pg-wz-text' }, h('strong', { text: 'Pegel-Alarm' }), h('small', { text: 'als Push oder E-Mail ›' })))));
  }

  // ---------------------------------------------------------------- Alle Pegel (über die Zähler; die Suche hat eigene Treffer)
  function setFilter(f) {
    ui.filter = f; ui.suche = ''; ui.zeilen = 60;
    root.querySelector('#pg-suche') && (root.querySelector('#pg-suche').value = '');
    zeichneTreffer();
    const neu = lage();
    root.querySelector('.pg-lage')?.replaceWith(neu);
    zeichneAlle();
    if (f) root.querySelector('#pg-alle')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  function alleSektion() {
    alleBox = h('section', { class: 'pg-alle', id: 'pg-alle', 'aria-labelledby': 'pg-alle-t', hidden: true });
    return alleBox;
  }
  function zeichneAlle() {
    if (!stand || !alleBox) return;
    if (!ui.filter) { alleBox.hidden = true; alleBox.replaceChildren(); return; }
    alleBox.hidden = false;
    let liste = stand.gauges.filter(g => zustand(g) === ui.filter.wert);
    const hatPos = !!ctx.user();
    // Standard: nach Gewässer und Flusskilometer
    const sort = ui.sort === 'entfernung' && hatPos ? 'entfernung' : 'gewaesser';
    const cmp = {
      entfernung: (a, b) => (entfernung(a) ?? 1e12) - (entfernung(b) ?? 1e12),
      gewaesser: (a, b) => a.water.localeCompare(b.water, 'de') || flussKm(a) - flussKm(b),
    }[sort];
    liste = [...liste].sort(cmp);
    const sortKnopf = (key, text) => h('button', { type: 'button', class: 'pg-sort' + (sort === key ? ' is-aktiv' : ''), 'aria-pressed': String(sort === key),
      disabled: key === 'entfernung' && !hatPos, title: key === 'entfernung' && !hatPos ? 'Erst „Meine Position“ auf der Karte freigeben' : null,
      onclick: () => { ui.sort = key; zeichneAlle(); } }, text, sort === key ? ' ↑' : '');
    const zeilen = liste.slice(0, ui.zeilen);
    const handy = ctx.isMobile();
    const inhalt = [];
    if (handy) {
      inhalt.push(h('ul', { class: 'pa-liste pg-alle-liste' }, zeilen.map((g) => {
        const d = entfernung(g);
        return h('li', { class: 'pa-zeile', dataset: { id: g.id } },
          h('button', { type: 'button', class: 'pa-text pg-treffer-btn', onclick: () => ctx.open(g.id) }, h('strong', { text: g.name }),
            h('small', { text: [g.water, kmText(g), d !== null ? formatDistance(d) : ''].filter(Boolean).join(' · ') })),
          h('span', { class: 'pa-wert' }, h('b', { text: `${fmt(g.value)} ${g.unit}` }), etikett(g)));
      })));
    } else {
      const trendSpalte = zeilen.some(g => g.trend !== null);   // ohne Trend von PEGELONLINE keine leere Spalte
      inhalt.push(h('table', { class: 'pg-tabelle' },
        h('thead', {}, h('tr', {}, h('th', { text: 'Pegel' }), h('th', { text: 'Gewässer' }), h('th', { class: 'is-zahl', text: 'Stand' }),
          trendSpalte ? h('th', { text: 'Trend' }) : null, h('th', { text: 'Zustand' }), h('th', { class: 'is-zahl', text: 'Entfernung' }))),
        h('tbody', {}, zeilen.map((g) => {
          const d = entfernung(g);
          return h('tr', { dataset: { id: g.id } },
            h('th', { scope: 'row' }, h('button', { type: 'button', class: 'pg-zeile-btn', onclick: () => ctx.open(g.id), text: g.name })),
            h('td', { class: 'pg-td-wasser', text: [g.water, kmText(g)].filter(Boolean).join(' · ') }),
            h('td', { class: 'is-zahl pg-td-wert', text: `${fmt(g.value)} ${g.unit}` }),
            trendSpalte ? h('td', { class: `pg-td-trend ${trendKlasse(g)}`, text: trendText(g, { kurz: true }) }) : null,
            h('td', { class: 'pg-td-zustand' }, etikett(g)),
            h('td', { class: 'is-zahl pg-td-km', text: d !== null ? formatDistance(d) : '–' }));
        }))));
    }
    if (!liste.length) inhalt.push(h('p', { class: 'muted', text: 'Kein Pegel gefunden.' }));
    if (liste.length > zeilen.length) inhalt.push(h('button', { type: 'button', class: 'btn btn-outline pg-mehr', text: `Weitere ${fmt(Math.min(60, liste.length - zeilen.length))} anzeigen`,
      onclick: () => { ui.zeilen += 60; zeichneAlle(); } }));
    alleBox.replaceChildren(
      h('div', { class: 'pg-h2-zeile' }, h('h2', { id: 'pg-alle-t', class: 'pg-h2', text: `Alle Pegel ${ui.filter.text}` }),
        h('button', { type: 'button', class: 'ftag', 'aria-label': `Filter ${ui.filter.text} entfernen`, onclick: () => setFilter(null) }, h('span', { text: `${fmt(liste.length)} Pegel` }), h('span', { html: icon('close', 16) }))),
      h('div', { class: 'pg-alle-karte' }, h('div', { class: 'pg-sortleiste', role: 'group', 'aria-label': 'Sortieren nach' }, h('span', { class: 'pg-klein', text: 'Sortieren:' }),
        sortKnopf('gewaesser', 'Gewässer'), sortKnopf('entfernung', 'Entfernung')), h('div', { class: 'pg-alle-inhalt' }, ...inhalt)));
  }

  /** „Meine Pegel“ geändert (Stern, Reihenfolge): nur Meine Pegel, Treffer und Wochenende neu, der Rest der Seite (Suchfeld, Scroll) bleibt. */
  function aktualisieren() {
    if (!stand || !meineBox?.isConnected) { veraltet = true; return; }
    meineBox.replaceChildren(...meineInhalt());
    zeichneTreffer();
    wochenFuellen();
  }

  function zeichnen() {
    if (!stand) {
      root.replaceChildren(h('div', { class: 'pg-seite' }, kopf(), h('p', { class: 'pg-fehler', role: 'alert', text: 'Pegeldaten sind gerade nicht erreichbar. Bitte später erneut versuchen.' })));
      return;
    }
    const fokus = document.activeElement?.id === 'pg-suche';
    const a = ansicht();
    root.classList.toggle('pg-ist-karte', a === 'karte');
    let inhalt;
    if (a === 'karte') {
      karte ||= pegelKarteAnsicht({ stand: () => stand, user: ctx.user, isMobile: ctx.isMobile, open: ctx.open, toast: ctx.toast });
      inhalt = [karte.el];
    } else {
      inhalt = [h('div', { class: 'pg-spalte' }, meine(), wochenende(), lage(), alleSektion(), werkzeuge(),
        h('p', { class: 'pg-fuss', text: 'Pegel der WSV (PEGELONLINE). Kleinere Gewässer und Talsperren teils nicht erfasst. Angaben ohne Gewähr.' }))];
    }
    root.replaceChildren(h('div', { class: 'pg-seite' + (a === 'karte' ? ' is-karte' : '') }, kopf(), suche(), ...inhalt));
    seite = root.firstElementChild; veraltet = false;
    if (a === 'karte') karte.zeigen(); else zeichneAlle();
    if (fokus) { const f = root.querySelector('#pg-suche'); f.focus(); f.setSelectionRange(f.value.length, f.value.length); }
  }

  document.addEventListener('meine-pegel', () => {
    if (root.isConnected && !root.hidden && stand) { if (ansicht() === 'karte') { karte?.aktualisieren(); zeichneTreffer(); } else aktualisieren(); } else veraltet = true;
  });
  return {
    zeigen: (force = false) => { if (!stand) root.replaceChildren(h('div', { class: 'pg-seite' }, kopf(), h('p', { class: 'muted pg-laden', text: 'Pegel werden geladen …' }))); return laden(force); },
    neuZeichnen: () => { if (stand) zeichnen(); },
    /** Im Hintergrund laden und (unsichtbar) aufbauen, damit das erste Öffnen sofort geht. */
    vorbereiten: () => laden(false),
    get stand() { return stand; },
  };
}

/** Detailseite eines Pegels im Bereich „Pegel“ (ganze Seite). */
export function pegelSeite(root, g, ctx) {
  const el = pegelDetail(g, {
    verlauf: verlaufLaden(g.id),
    onBack: ctx.back, backLabel: 'Zurück zur Übersicht',
    onShare: () => ctx.share(g),
    onKarte: () => ctx.karte(g),
    onFluss: g.water && ctx.fluss ? () => ctx.fluss(istKueste(g.water) ? KUESTE_SLUG : slug(g.water)) : null,
    slips: slipsAmPegel(g, ctx.places()), onSlip: ctx.slip,
    onStern: () => { const neu = pegelSeite(root, g, ctx); neu.querySelector('.pm-stern')?.focus(); },
  });
  root.replaceChildren(h('div', { class: 'pg-seite pg-detailseite' }, el));
  return el;
}

export { formatTime, etikett, ZUSTAND, zustand };

// Bereich „Pegel“: Dashboard (#pegel) und Pegel-Detailseite (#pegel/<id>).
// Daten: eine Stationsliste (pegel-daten.js) für Zähler, Flussbänder und Tabelle; Verläufe nur für sichtbare Karten.
import { h, announce } from './dom.js';
import { icon } from './icons.js';
import { haversine, formatDistance, displayName } from './model.js';
import { pegelLaden, verlaufLaden, meinePegel } from './pegel-daten.js';
import { fmt, kmText, zustand, ZUSTAND, etikett, trendText, trendKlasse, pegelKarte, pegelDetail } from './pegel-ansicht.js';
import { formatTime } from './pegel.js';
import { popover } from './nav.js';

const RANG = { hsw: 0, high: 1, low: 2, normal: 3, unknown: 4, none: 5, old: 6 };
const normW = (s) => String(s || '').toLowerCase().replace(/[^a-zäöüß]/g, '');
const zeitText = (t) => new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const standText = (st) => (st.offline ? `Offline · Stand von ${new Date(st.zeit).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}, ${zeitText(st.zeit)} Uhr`
  : `Stand ${zeitText(st.zeit)} · alle 15 Min. aktualisiert`);

/** Nächste Slipanlagen am selben Gewässer (für Detailseite). */
export function slipsAmPegel(g, places, max = 5, radius = 30000) {
  const w = normW(g.water);
  if (!w) return [];
  return places.filter(p => p.type === 'slip' && p.water?.name && (normW(p.water.name) === w || normW(p.water.name).includes(w) || w.includes(normW(p.water.name))))
    .map(p => ({ p, d: haversine(g.lat, g.lon, p.lat, p.lon), name: displayName(p) }))
    .filter(e => e.d <= radius).sort((a, b) => a.d - b.d).slice(0, max);
}

/**
 * ctx = { user(): {lat,lon}|null, places(): Place[], isMobile(), open(id), ampel(id, {alarm}), karte(g), slip(p), share(g), toast }
 */
export function pegelDashboard(root, ctx) {
  const ui = { filter: null, sort: null, suche: '', alleOffen: false, alleGewaesser: false, bearbeiten: false, zeilen: 60 };
  let stand = null;

  const entfernung = (g) => { const u = ctx.user(); return u ? haversine(u.lat, u.lon, g.lat, g.lon) : null; };

  async function laden(force = false) {
    try { stand = await pegelLaden({ force }); }
    catch { stand = null; }
    zeichnen();
  }

  function kopf() {
    const suche = h('input', { type: 'search', class: 'pg-suche', placeholder: 'Pegel oder Gewässer suchen', 'aria-label': 'Pegel oder Gewässer suchen', value: ui.suche,
      oninput: () => { ui.suche = suche.value; ui.alleOffen = !!suche.value.trim(); zeichneAlle(); } });
    return h('header', { class: 'pg-kopf' },
      h('div', { class: 'pg-kopf-zeile' },
        h('div', {}, h('h1', { class: 'pg-titel', text: 'Pegel' }), h('p', { class: 'pg-stand', 'aria-live': 'polite', text: stand ? standText(stand) : 'Wird geladen …' })),
        h('button', { type: 'button', class: 'pg-neu', 'aria-label': 'Pegel aktualisieren', html: icon('refresh', 22), onclick: async (e) => {
          e.currentTarget.classList.add('is-busy'); await laden(true); ctx.toast?.(stand?.offline ? 'Keine Verbindung – letzter Stand wird angezeigt.' : 'Pegel aktualisiert.'); } })),
      h('div', { class: 'pg-suche-box' }, h('span', { class: 'pg-suche-ico', html: icon('search', 20), 'aria-hidden': 'true' }), suche));
  }

  function lage() {
    const n = { hsw: 0, high: 0, low: 0, normal: 0 };
    for (const g of stand.gauges) { const z = zustand(g); if (z in n) n[z]++; }
    const zaehler = (z, titel, sub) => h('button', { type: 'button', class: `pg-zaehler is-${z}` + (ui.filter?.art === 'zustand' && ui.filter.wert === z ? ' is-aktiv' : ''),
      'aria-label': `${n[z]} ${titel}. Liste filtern`, onclick: () => setFilter({ art: 'zustand', wert: z, text: titel }) },
      h('strong', { text: fmt(n[z]) }), h('span', { class: 'pg-zaehler-text' }, h('b', { text: titel }), h('small', { text: sub })));
    return h('section', { class: 'pg-lage', 'aria-labelledby': 'pg-lage-t' },
      h('h2', { id: 'pg-lage-t', class: 'pg-h2 pg-nur-handy', text: 'Lage heute' }),
      h('div', { class: 'pg-zaehler-reihe' },
        zaehler('hsw', 'über HSW', 'Schifffahrt eingeschränkt'), zaehler('high', 'Hochwasser', 'über MHW'),
        zaehler('low', 'Niedrigwasser', 'unter MNW'), zaehler('normal', 'Normal', 'zwischen MNW und MHW')),
      h('p', { class: 'pg-klein', text: 'Bewertung nach amtlichen Kennwerten des jeweiligen Pegels' }));
  }

  function meine() {
    meinePegel.ampelUebernehmen();
    let ids = meinePegel.alle().filter(id => stand.byId.has(id));
    let titel = 'Meine Pegel', hinweis = null;
    if (!ids.length) {
      const u = ctx.user();
      if (u) {
        ids = [...stand.gauges].sort((a, b) => entfernung(a) - entfernung(b)).slice(0, 3).map(g => g.id);
        titel = 'Pegel in deiner Nähe'; hinweis = 'Tippe auf ☆, um Pegel zu merken.';
      } else {
        hinweis = 'Noch keine Pegel gemerkt. Tippe auf „Pegel hinzufügen“, um Pegel hier zu sehen.';
      }
    }
    const gemerkt = meinePegel.alle().length > 0;
    const sec = h('section', { class: 'pg-meine', 'aria-labelledby': 'pg-meine-t' },
      h('div', { class: 'pg-h2-zeile' }, h('h2', { id: 'pg-meine-t', class: 'pg-h2', text: titel }),
        gemerkt ? h('button', { type: 'button', class: 'pg-link', 'aria-pressed': String(ui.bearbeiten), text: ui.bearbeiten ? 'Fertig' : 'Bearbeiten',
          onclick: () => { ui.bearbeiten = !ui.bearbeiten; zeichnen(); root.querySelector('.pg-meine .pg-link')?.focus(); } }) : null),
      hinweis ? h('p', { class: 'pg-hinweis', text: hinweis }) : null);
    const liste = h('div', { class: 'pg-karten' });
    ids.forEach((id, i) => {
      const g = stand.byId.get(id);
      const bearb = ui.bearbeiten && gemerkt ? h('div', { class: 'pm-bearb' },
        h('button', { type: 'button', class: 'pm-bbtn', 'aria-label': `${g.name} nach oben`, html: icon('back', 18), disabled: i === 0, onclick: () => { meinePegel.verschieben(id, -1); zeichnen(); } }),
        h('button', { type: 'button', class: 'pm-bbtn is-runter', 'aria-label': `${g.name} nach unten`, html: icon('back', 18), disabled: i === ids.length - 1, onclick: () => { meinePegel.verschieben(id, 1); zeichnen(); } }),
        h('button', { type: 'button', class: 'pm-bbtn is-weg', text: 'Entfernen', onclick: () => { meinePegel.entfernen(id); zeichnen(); } })) : null;
      liste.append(pegelKarte(g, { verlauf: verlaufLaden(id), onOpen: () => ctx.open(id), bearbeiten: bearb }));
    });
    liste.append(h('button', { type: 'button', class: 'pg-hinzu', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': 'pa-pop', onclick: (e) => hinzuOeffnen(e.currentTarget) },
      h('span', { html: icon('plus', 20) }), h('span', { text: 'Pegel hinzufügen' })));
    sec.append(liste);
    return sec;
  }

  // Fenster „Pegel hinzufügen“: Handy Bottom-Sheet, Desktop Dropdown unter dem Knopf
  let hinzu = null;
  function hinzuFenster() {
    if (hinzu) return hinzu;
    const liste = h('ul', { class: 'pa-liste' });
    const kopfzeile = h('p', { class: 'pa-kopf' });
    const feld = h('input', { type: 'search', class: 'pg-suche pa-suche', placeholder: 'Pegel oder Gewässer', 'aria-label': 'Pegel oder Gewässer suchen', 'data-autofocus': true,
      oninput: () => fuellen() });
    const dlg = h('dialog', { id: 'pa-pop', class: 'pop pa-pop', 'aria-labelledby': 'pa-titel' },
      h('span', { class: 'pop-grip', 'aria-hidden': 'true' }),
      h('div', { class: 'pa-oben' }, h('h2', { id: 'pa-titel', text: 'Pegel hinzufügen' }),
        h('div', { class: 'pg-suche-box' }, h('span', { class: 'pg-suche-ico', html: icon('search', 20), 'aria-hidden': 'true' }), feld)),
      h('div', { class: 'sheet-scroll' }, kopfzeile, liste),
      h('div', { class: 'pop-foot' }, h('button', { type: 'button', class: 'btn btn-primary', text: 'Fertig', onclick: () => pop.close() })));
    document.body.append(dlg);
    const pop = popover(dlg, { isMobile: ctx.isMobile });
    window.addEventListener('hashchange', () => pop.close());
    dlg.addEventListener('close', () => { dlg.style.bottom = ''; dlg.style.maxHeight = ''; });

    // Knopf wird an Ort und Stelle umgestellt (kein Neuzeichnen), damit das Fenster beim Klick offen bleibt
    const knopfStellen = (btn, g) => {
      const an = meinePegel.hat(g.id);
      btn.classList.toggle('is-an', an);
      btn.setAttribute('aria-pressed', String(an));
      btn.setAttribute('aria-label', an ? `${g.name} aus „Meine Pegel“ entfernen` : `${g.name} zu „Meine Pegel“ hinzufügen`);
      btn.innerHTML = icon(an ? 'check' : 'plus', 20);
    };
    function zeile(g) {
      const d = entfernung(g);
      const knopf = h('button', { type: 'button', class: 'pa-knopf', onclick: () => {
        const an = meinePegel.umschalten(g.id);
        knopfStellen(knopf, g);
        announce(an ? `${g.name} hinzugefügt` : `${g.name} entfernt`);
      } });
      knopfStellen(knopf, g);
      return h('li', { class: 'pa-zeile' },
        h('span', { class: 'pa-text' }, h('strong', { text: g.name }),
          h('small', { text: [g.water, kmText(g), d !== null ? formatDistance(d) : ''].filter(Boolean).join(' · ') })),
        h('span', { class: 'pa-wert' }, h('b', { text: `${fmt(g.value)} ${g.unit}` }), etikett(g)),
        knopf);
    }
    const MAX = 40;
    function fuellen() {
      if (!stand) return;
      const q = normW(feld.value);
      let treffer = [], text = '';
      if (q) {
        const start = (g) => (normW(g.name).startsWith(q) ? 0 : 1);
        treffer = stand.gauges.filter(g => normW(g.name).includes(q) || normW(g.water).includes(q))
          .sort((a, b) => start(a) - start(b) || (entfernung(a) ?? 0) - (entfernung(b) ?? 0) || a.name.localeCompare(b.name, 'de'));
        text = treffer.length ? `${fmt(treffer.length)} Treffer` : 'Kein Pegel gefunden.';
      } else if (ctx.user()) {
        treffer = [...stand.gauges].sort((a, b) => entfernung(a) - entfernung(b)).slice(0, 8);
        text = 'In deiner Nähe';
      } else {
        text = 'Gib den Namen eines Pegels oder ein Gewässer ein, z. B. „Köln“ oder „Mosel“.';
      }
      kopfzeile.textContent = text;
      liste.replaceChildren(...treffer.slice(0, MAX).map(zeile));
      if (treffer.length > MAX) liste.append(h('li', { class: 'pa-mehr', text: `Weitere ${fmt(treffer.length - MAX)} – bitte genauer suchen.` }));
    }
    hinzu = { pop, feld, fuellen };
    return hinzu;
  }
  function hinzuOeffnen(btn) {
    const f = hinzuFenster();
    if (f.pop.isOpen) { f.pop.close(); return; }
    f.feld.value = '';
    f.fuellen();
    f.pop.open(btn);
    // Desktop: reicht der Platz unter dem Knopf nicht, öffnet das Fenster darüber
    if (!ctx.isMobile()) {
      const dlg = document.getElementById('pa-pop'), r = btn.getBoundingClientRect();
      const unten = window.innerHeight - r.bottom - 20, oben = r.top - 20;
      dlg.style.maxHeight = `${Math.min(560, Math.max(unten, oben))}px`;
      // unten verankert, damit das Fenster beim Filtern am Knopf bleibt
      if (unten < 360 && oben > unten) { dlg.style.top = 'auto'; dlg.style.bottom = `${Math.round(window.innerHeight - r.top + 8)}px`; }
    }
  }

  function fluesse() {
    const gruppen = new Map();
    for (const g of stand.gauges) { if (!g.water) continue; (gruppen.get(g.water) || gruppen.set(g.water, []).get(g.water)).push(g); }
    // Im Band nur eingeordnete Pegel; Gewässer ganz ohne Einordnung weglassen
    const eingeordnet = (g) => ['hsw', 'high', 'low', 'normal'].includes(zustand(g));
    const alle = [...gruppen.entries()].filter(([, liste]) => liste.some(eingeordnet)).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'de'));
    const zeigen = ui.alleGewaesser ? alle : alle.slice(0, 5);
    const zusammen = (liste) => {
      const c = { hsw: 0, high: 0, low: 0, normal: 0, rest: 0 };
      for (const g of liste) { const z = zustand(g); if (z in c) c[z]++; else c.rest++; }
      if (c.hsw) return { text: `${c.hsw} über HSW`, cls: 'is-hsw', c };
      if (c.high) return { text: `${c.high} hoch`, cls: 'is-high', c };
      if (c.low) return { text: `${c.low} niedrig`, cls: 'is-low', c };
      return { text: 'alles normal', cls: 'is-normal', c };
    };
    return h('section', { class: 'pg-fluesse', 'aria-labelledby': 'pg-fl-t' },
      h('h2', { id: 'pg-fl-t', class: 'pg-h2', text: 'Flüsse im Überblick' }),
      h('p', { class: 'pg-klein', text: 'Jedes Feld ein eingeordneter Pegel, von der Quelle zur Mündung' }),
      h('div', { class: 'pg-karte pg-fl-karte' },
        zeigen.map(([name, liste]) => {
          const sortiert = liste.filter(eingeordnet).sort((a, b) => (a.km ?? 1e9) - (b.km ?? 1e9));
          const zs = zusammen(liste);
          const c = zs.c;
          const label = `${name}: ${liste.length} Pegel – ` + [c.hsw && `${c.hsw} über HSW`, c.high && `${c.high} hoch`, c.low && `${c.low} niedrig`, c.normal && `${c.normal} normal`, c.rest && `${c.rest} ohne Einordnung`].filter(Boolean).join(', ') + '. Liste dieses Gewässers zeigen';
          return h('button', { type: 'button', class: 'pg-fluss', 'aria-label': label, onclick: () => setFilter({ art: 'gewaesser', wert: name, text: name }) },
            h('span', { class: 'pg-fluss-kopf' }, h('strong', { text: name }), h('span', { class: `pg-fluss-info ${zs.cls}`, text: zs.text })),
            h('span', { class: 'pg-band', 'aria-hidden': 'true' }, sortiert.map(g => h('i', { style: `background:${ZUSTAND[zustand(g)].farbe}`, title: `${g.name}: ${fmt(g.value)} ${g.unit} (${ZUSTAND[zustand(g)].text})` }))));
        }),
        h('p', { class: 'pg-legende' }, [['low', 'niedrig'], ['normal', 'normal'], ['high', 'hoch'], ['hsw', 'über HSW']]
          .map(([z, t]) => h('span', {}, h('i', { style: `background:${ZUSTAND[z].farbe}` }), t))),
        alle.length > 5 ? h('button', { type: 'button', class: 'pg-link', text: ui.alleGewaesser ? 'Weniger Gewässer anzeigen' : `Alle ${alle.length} Gewässer anzeigen ›`,
          onclick: () => { ui.alleGewaesser = !ui.alleGewaesser; zeichnen(); } }) : null));
  }

  function werkzeuge() {
    const erster = meinePegel.alle().find(id => stand?.byId.has(id)) || null;
    return h('section', { class: 'pg-werkzeuge', 'aria-labelledby': 'pg-wz-t' },
      h('h2', { id: 'pg-wz-t', class: 'pg-h2 pg-nur-handy', text: 'Werkzeuge' }),
      h('div', { class: 'pg-wz-reihe' },
        h('a', { class: 'pg-wz is-ampel', href: './pegel-ampel' + (erster ? `?pegel=${encodeURIComponent(erster)}` : '') },
          h('span', { class: 'pg-ampel-ico', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
          h('span', { class: 'pg-wz-text' }, h('strong', { text: 'Passt mein Boot?' }), h('small', { text: 'Pegel-Ampel für deinen Mindestpegel' })),
          h('span', { class: 'pg-wz-pfeil', html: icon('chevron', 20), 'aria-hidden': 'true' })),
        h('a', { class: 'pg-wz is-alarm', href: './pegel-ampel' + (erster ? `?pegel=${encodeURIComponent(erster)}` : '') + '#am-alarm' },
          h('span', { class: 'pg-alarm-ico', html: icon('bell', 22), 'aria-hidden': 'true' }),
          h('span', { class: 'pg-wz-text' }, h('strong', { text: 'Pegel-Alarm' }), h('small', { text: 'per E-Mail, kostenlos' })),
          h('span', { class: 'pg-wz-pfeil', html: icon('chevron', 20), 'aria-hidden': 'true' }))));
  }

  // ---------------------------------------------------------------- Alle Pegel
  const alleBox = h('div', { class: 'pg-alle-inhalt' });
  function setFilter(f) {
    ui.filter = f; ui.alleOffen = true; ui.zeilen = 60;
    zeichnen();
    root.querySelector('#pg-alle')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  function alleSektion() {
    return h('section', { class: 'pg-alle', id: 'pg-alle', 'aria-labelledby': 'pg-alle-t' },
      h('div', { class: 'pg-h2-zeile' }, h('h2', { id: 'pg-alle-t', class: 'pg-h2', text: 'Alle Pegel' }),
        h('button', { type: 'button', class: 'pg-link pg-nur-handy', 'aria-expanded': String(ui.alleOffen), text: ui.alleOffen ? 'Weniger' : `Alle ${fmt(stand.gauges.length)} anzeigen`,
          onclick: () => { ui.alleOffen = !ui.alleOffen; zeichnen(); } })),
      alleBox);
  }
  function zeichneAlle() {
    if (!stand) return;
    root.classList.toggle('alle-offen', ui.alleOffen);
    const q = normW(ui.suche);
    let liste = stand.gauges.filter(g => {
      if (ui.filter?.art === 'zustand' && zustand(g) !== ui.filter.wert) return false;
      if (ui.filter?.art === 'gewaesser' && g.water !== ui.filter.wert) return false;
      return !q || normW(g.name).includes(q) || normW(g.water).includes(q);
    });
    const hatPos = !!ctx.user();
    const sort = ui.sort || (ui.filter?.art === 'gewaesser' ? 'km' : hatPos ? 'entfernung' : 'zustand');
    const cmp = {
      entfernung: (a, b) => (entfernung(a) ?? 1e12) - (entfernung(b) ?? 1e12),
      zustand: (a, b) => RANG[zustand(a)] - RANG[zustand(b)] || a.name.localeCompare(b.name, 'de'),
      gewaesser: (a, b) => a.water.localeCompare(b.water, 'de') || (a.km ?? 1e9) - (b.km ?? 1e9),
      km: (a, b) => (a.km ?? 1e9) - (b.km ?? 1e9),
    }[sort];
    liste = [...liste].sort(cmp);
    const sortKnopf = (key, text) => h('button', { type: 'button', class: 'pg-sort' + (sort === key ? ' is-aktiv' : ''), 'aria-pressed': String(sort === key),
      disabled: key === 'entfernung' && !hatPos, title: key === 'entfernung' && !hatPos ? 'Erst „Meine Position“ auf der Karte freigeben' : null,
      onclick: () => { ui.sort = key; zeichneAlle(); } }, text, sort === key ? ' ↑' : '');
    const teile = [];
    if (ui.filter) {
      teile.push(h('p', { class: 'pg-filter' }, h('button', { type: 'button', class: 'ftag', 'aria-label': `Filter ${ui.filter.text} entfernen`,
        onclick: () => { ui.filter = null; zeichnen(); } }, h('span', { text: ui.filter.text }), h('span', { html: icon('close', 16) })), ` ${fmt(liste.length)} Pegel`));
    }
    teile.push(h('div', { class: 'pg-sortleiste', role: 'group', 'aria-label': 'Sortieren nach' }, h('span', { class: 'pg-klein', text: 'Sortieren:' }),
      sortKnopf('entfernung', 'Entfernung'), sortKnopf('zustand', 'Zustand'), sortKnopf('gewaesser', 'Gewässer')));
    const zeilen = liste.slice(0, ui.zeilen);
    teile.push(h('table', { class: 'pg-tabelle' },
      h('thead', {}, h('tr', {}, h('th', { text: 'Pegel' }), h('th', { text: 'Gewässer' }), h('th', { class: 'is-zahl', text: 'Stand' }),
        h('th', { text: 'Trend' }), h('th', { text: 'Zustand' }), h('th', { class: 'is-zahl', text: 'Entfernung' }))),
      h('tbody', {}, zeilen.map((g) => {
        const d = entfernung(g);
        return h('tr', { dataset: { id: g.id } },
          h('th', { scope: 'row' }, h('button', { type: 'button', class: 'pg-zeile-btn', onclick: () => ctx.open(g.id), text: g.name })),
          h('td', { class: 'pg-td-wasser', text: [g.water, kmText(g)].filter(Boolean).join(' · ') }),
          h('td', { class: 'is-zahl pg-td-wert', text: `${fmt(g.value)} ${g.unit}` }),
          h('td', { class: `pg-td-trend ${trendKlasse(g)}`, text: trendText(g, { kurz: true }) }),
          h('td', { class: 'pg-td-zustand' }, etikett(g)),
          h('td', { class: 'is-zahl pg-td-km', text: d !== null ? formatDistance(d) : '–' }));
      }))));
    if (!liste.length) teile.push(h('p', { class: 'muted', text: 'Kein Pegel gefunden.' }));
    if (liste.length > zeilen.length) teile.push(h('button', { type: 'button', class: 'btn btn-outline pg-mehr', text: `Weitere ${fmt(Math.min(60, liste.length - zeilen.length))} anzeigen`,
      onclick: () => { ui.zeilen += 60; zeichneAlle(); } }));
    alleBox.replaceChildren(...teile);
  }

  function zeichnen() {
    if (!stand) {
      root.replaceChildren(h('div', { class: 'pg-seite' }, kopf(), h('p', { class: 'pg-fehler', role: 'alert', text: 'Pegeldaten sind gerade nicht erreichbar. Bitte später erneut versuchen.' })));
      return;
    }
    const fokus = document.activeElement?.classList?.contains('pg-suche');
    root.replaceChildren(h('div', { class: 'pg-seite' }, kopf(),
      h('div', { class: 'pg-raster' },
        h('div', { class: 'pg-voll' }, lage()),
        h('div', { class: 'pg-links' }, meine(), alleSektion()),
        h('div', { class: 'pg-rechts' }, fluesse(), werkzeuge(),
          h('p', { class: 'pg-fuss', text: 'Pegel der WSV (PEGELONLINE). Kleinere Gewässer und Talsperren teils nicht erfasst. Angaben ohne Gewähr.' })))));
    zeichneAlle();
    if (fokus) { const f = root.querySelector('.pg-suche'); f.focus(); f.setSelectionRange(f.value.length, f.value.length); }
  }

  document.addEventListener('meine-pegel', () => { if (root.isConnected && !root.hidden && stand) zeichnen(); });
  return {
    zeigen: (force = false) => { if (!stand) root.replaceChildren(h('div', { class: 'pg-seite' }, kopf(), h('p', { class: 'muted pg-laden', text: 'Pegel werden geladen …' }))); return laden(force); },
    neuZeichnen: () => { if (stand) zeichnen(); },
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
    slips: slipsAmPegel(g, ctx.places()), onSlip: ctx.slip,
    onStern: () => { const neu = pegelSeite(root, g, ctx); neu.querySelector('.pm-stern')?.focus(); },
  });
  root.replaceChildren(h('div', { class: 'pg-seite pg-detailseite' }, el));
  return el;
}

export { formatTime, etikett, ZUSTAND, zustand };

// Bereich „In der Nähe“: Bezugspunkt (Meine Position · Kartenmitte · gewählter Ort), Standortfreigabe und die Liste
// der nächsten Standorte. Die eigene Position bleibt im Browser: gespeichert wird nur die Wahl des Bezugspunkts.
import { h, announce } from './dom.js';
import { icon, glyphSvg } from './icons.js';
import { popover } from './nav.js';
import { geocode } from './search.js';
import { TYPES, displayName, haversine, formatDistance, FILTERS } from './model.js';
import { TYPEN, alter, zeitpunkt } from './meldungen.js';
import { CONFIG } from './config.js';

const LS_BEZUG = 'watermap.naehe.bezug';           // { art: 'position' | 'kartenmitte' | 'ort', name?, lat?, lon? }
const LS_ZULETZT = 'watermap.naehe.zuletzt';       // bis zu 3 gesuchte Orte
const LS_ENTSCHIEDEN = 'watermap.naehe.entschieden';
const LS_SORT = 'watermap.naehe.sort';
const RADIEN_KM = [25, 50, 100];
const MIN_TREFFER = 5;

const lesen = (k, f = null) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? f; } catch { return f; } };
const schreiben = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* nur für diese Sitzung */ } };
const kurz = (name) => String(name).split(',')[0].trim();   // „Bünde, Kreis Herford, …“ → „Bünde“
const istOrt = (o) => o && typeof o.name === 'string' && Number.isFinite(o.lat) && Number.isFinite(o.lon);

// ------------------------------------------------------------------ Standortfreigabe (gemeinsam mit „Meine Position“ auf der Karte)
let freigabe = 'unbekannt';   // 'granted' | 'prompt' | 'denied' | 'unbekannt'
const beobachter = new Set();
function freigabeSetzen(s) {
  if (s === freigabe) return;
  freigabe = s;
  beobachter.forEach(f => f(s));
}
export const geoFreigabe = {
  get status() { return freigabe; },
  /** Status ohne Browser-Dialog prüfen (Permissions API, wo vorhanden). */
  async pruefen() {
    try {
      const p = await navigator.permissions?.query({ name: 'geolocation' });
      if (p) { freigabeSetzen(p.state); p.onchange = () => freigabeSetzen(p.state); }
    } catch { /* nicht unterstützt */ }
    return freigabe;
  },
  /** Ergebnis einer Abfrage merken (auch von der Karte). */
  merken(erlaubt) { freigabeSetzen(erlaubt ? 'granted' : 'denied'); },
  beobachten(f) { beobachter.add(f); },
};

/**
 * ctx = { places(): gefilterte Standorte, allPlaces(), user(), setUser(pos), requestUserPos(), mapCenter(),
 *         isMobile(), waehlen(p), aufKarte(liste), filterOeffnen(btn), filterZuruecksetzen(), meld: Map, cats, toggleCat(t),
 *         dialog (generisches <dialog>), toast(text) }
 */
export function naehe(ctx) {
  let bezug = lesen(LS_BEZUG);
  if (!bezug || !['position', 'kartenmitte', 'ort'].includes(bezug.art) || (bezug.art === 'ort' && !istOrt(bezug))) bezug = null;
  let sortierung = lesen(LS_SORT, 'naechste');
  let positionLaeuft = false, letzteZahl = null, scrollMerken = null;
  const ortCache = new Map();

  const entschieden = () => lesen(LS_ENTSCHIEDEN) === true;
  const zuletzt = () => (lesen(LS_ZULETZT, []) || []).filter(istOrt).slice(0, 3);

  /** Ortsname lokal aus den WaterMap-Daten (Ort des nächsten Standorts) – ohne Netz, nichts wird gesendet. */
  function ortsname(lat, lon) {
    const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
    if (ortCache.has(key)) return ortCache.get(key);
    let best = null;
    for (const p of ctx.allPlaces()) {
      if (!p.locality) continue;
      const d = haversine(lat, lon, p.lat, p.lon);
      if (d <= 30000 && (!best || d < best.d)) best = { d, name: p.locality };
    }
    ortCache.set(key, best?.name || null);
    return best?.name || null;
  }

  function kartenmitte() {
    const c = ctx.mapCenter();
    return c || { lat: CONFIG.FALLBACK_VIEW.center[0], lon: CONFIG.FALLBACK_VIEW.center[1] };
  }

  /** Gilt gerade: { art, lat, lon, name } – „Meine Position“ fällt auf die Kartenmitte zurück, solange sie fehlt. */
  function punkt() {
    const art = bezug?.art || 'kartenmitte';
    if (art === 'ort') return { art, lat: bezug.lat, lon: bezug.lon, name: bezug.name };
    if (art === 'position' && ctx.user()) { const u = ctx.user(); return { art, lat: u.lat, lon: u.lon, name: ortsname(u.lat, u.lon) }; }
    const c = kartenmitte();
    return { art: 'kartenmitte', lat: c.lat, lon: c.lon, name: ortsname(c.lat, c.lon) };
  }

  function bezugSetzen(neu) {
    bezug = neu;
    schreiben(LS_BEZUG, neu);
    schreiben(LS_ENTSCHIEDEN, true);
    zeichnen();
  }

  async function positionHolen() {
    if (positionLaeuft) return;
    positionLaeuft = true; zeichnen();
    try {
      const pos = await ctx.requestUserPos();
      ctx.setUser(pos);
      geoFreigabe.merken(true);
    } catch (e) {
      if (/verweigert/.test(e.message)) geoFreigabe.merken(false);
      ctx.toast(e.message);
    } finally { positionLaeuft = false; zeichnen(); }
  }

  function positionVerwenden() {
    bezug = { art: 'position' };
    schreiben(LS_BEZUG, bezug); schreiben(LS_ENTSCHIEDEN, true);
    positionHolen();
  }

  // ---------------------------------------------------------------- Fenster „Entfernungen messen ab …“
  let fenster = null;
  function fensterBauen() {
    if (fenster) return fenster;
    const feld = h('input', { type: 'search', class: 'nb-suche', placeholder: 'Ort, Gewässer oder Postleitzahl', 'aria-label': 'Ort, Gewässer oder Postleitzahl suchen',
      autocomplete: 'off', enterkeyhint: 'search', 'data-autofocus': true });
    const treffer = h('ul', { class: 'nb-liste nb-treffer', 'aria-live': 'polite' });
    const wahl = h('ul', { class: 'nb-liste' });
    const dlg = h('dialog', { id: 'naehe-bezug', class: 'pop nb-pop', 'aria-labelledby': 'nb-titel' },
      h('span', { class: 'pop-grip', 'aria-hidden': 'true' }),
      h('div', { class: 'nb-oben' },
        h('h2', { id: 'nb-titel', text: 'Entfernungen messen ab …' }),
        h('button', { type: 'button', class: 'nb-x', 'aria-label': 'Schließen', html: icon('close', 22), onclick: () => pop.close() })),
      h('div', { class: 'sheet-scroll' },
        h('form', { class: 'nb-form', role: 'search', onsubmit: (e) => { e.preventDefault(); suchen(true); } },
          h('span', { class: 'nb-suche-ico', html: icon('search', 20), 'aria-hidden': 'true' }), feld),
        treffer, wahl));
    document.body.append(dlg);
    const pop = popover(dlg, { isMobile: ctx.isMobile, align: 'right' });
    window.addEventListener('hashchange', () => pop.close());

    let timer = null, ctrl = null, letzteSuche = '';
    feld.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => suchen(false), 600); });
    async function suchen(sofort) {
      const q = feld.value.trim();
      if (q.length < 3) { treffer.replaceChildren(); letzteSuche = ''; return; }
      if (q === letzteSuche && !sofort) return;
      letzteSuche = q;
      ctrl?.abort(); ctrl = new AbortController();
      treffer.replaceChildren(h('li', { class: 'nb-msg', text: 'Suche …' }));
      try {
        const liste = await geocode(q, { signal: ctrl.signal });
        if (feld.value.trim() !== q) return;
        treffer.replaceChildren(...(liste.length ? liste.slice(0, 5).map(o => zeile({ ico: 'pin', titel: kurz(o.name), sub: o.name.split(',').slice(1).join(',').trim(), onclick: () => ortWaehlen(o) }))
          : [h('li', { class: 'nb-msg', text: 'Kein Ort gefunden.' })]));
      } catch (e) {
        if (e.name !== 'AbortError') treffer.replaceChildren(h('li', { class: 'nb-msg', text: 'Die Ortssuche ist gerade nicht erreichbar.' }));
      }
    }
    function ortWaehlen(o) {
      const ort = { name: kurz(o.name), lat: o.lat, lon: o.lon };
      schreiben(LS_ZULETZT, [ort, ...zuletzt().filter(z => z.name !== ort.name)].slice(0, 3));
      pop.close();
      bezugSetzen({ art: 'ort', ...ort });
      announce(`Entfernungen ab ${ort.name}`);
    }
    function zeile({ ico, titel, sub, aktiv = false, gesperrt = false, dunkel = false, onclick }) {
      return h('li', {}, h('button', { type: 'button', class: 'nb-zeile' + (aktiv ? ' is-aktiv' : ''), 'aria-disabled': gesperrt ? 'true' : null, 'aria-current': aktiv ? 'true' : null,
        onclick: () => { if (!gesperrt) onclick(); } },
        h('span', { class: 'nb-ico' + (dunkel ? ' is-dunkel' : ''), html: icon(ico, 22), 'aria-hidden': 'true' }),
        h('span', { class: 'nb-text' }, h('strong', { text: titel }), sub ? h('small', { text: sub }) : null),
        aktiv ? h('span', { class: 'nb-haken', html: icon('check', 22), 'aria-label': 'ausgewählt' }) : null));
    }
    function fuellen() {
      const art = punkt().art, c = kartenmitte(), mitteName = ortsname(c.lat, c.lon);   // gilt gerade (ohne Position: Kartenmitte)
      const gesperrt = freigabe === 'denied';
      const rows = [
        zeile({ ico: 'navigate', titel: 'Meine Position', sub: gesperrt ? 'im Browser blockiert' : 'nur auf deinem Gerät genutzt', aktiv: art === 'position', gesperrt,
          onclick: () => { pop.close(); positionVerwenden(); } }),
        zeile({ ico: 'locate', titel: 'Kartenmitte', sub: mitteName ? `zuletzt: ${mitteName}` : 'Mitte des zuletzt angesehenen Kartenausschnitts', aktiv: art === 'kartenmitte',
          onclick: () => { pop.close(); bezugSetzen({ art: 'kartenmitte' }); } }),
      ];
      if (art === 'ort') rows.push(zeile({ ico: 'pin', titel: bezug.name, sub: 'gemerkt', aktiv: true, dunkel: true, onclick: () => pop.close() }));
      for (const o of zuletzt()) {
        if (art === 'ort' && o.name === bezug.name) continue;
        rows.push(zeile({ ico: 'clock', titel: o.name, sub: 'zuletzt gesucht', onclick: () => ortWaehlen(o) }));
      }
      wahl.replaceChildren(...rows);
      feld.value = ''; treffer.replaceChildren(); letzteSuche = '';
    }
    fenster = { pop, fuellen, feld };
    return fenster;
  }
  function fensterOeffnen(btn) {
    const f = fensterBauen();
    f.fuellen();
    f.pop.open(btn);
    // Desktop: reicht der Platz unter dem Knopf nicht, öffnet das Fenster darüber (unten verankert)
    const dlg = document.getElementById('naehe-bezug');
    dlg.style.bottom = ''; dlg.style.maxHeight = '';
    if (!ctx.isMobile() && btn) {
      const r = btn.getBoundingClientRect(), unten = window.innerHeight - r.bottom - 20, oben = r.top - 20;
      dlg.style.maxHeight = `${Math.min(560, Math.max(unten, oben))}px`;
      if (unten < 380 && oben > unten) { dlg.style.top = 'auto'; dlg.style.bottom = `${Math.round(window.innerHeight - r.top + 8)}px`; }
    }
  }

  // ---------------------------------------------------------------- Anleitung „So aktivierst du ihn“
  function anleitung() {
    const dlg = ctx.dialog, body = dlg.querySelector('#dlg-body');
    const abschnitt = (titel, schritte) => h('section', { class: 'nh-anl' }, h('h3', { text: titel }), h('ol', {}, schritte.map(s => h('li', { text: s }))));
    body.replaceChildren(h('div', { class: 'nh-anleitung' },
      h('h2', { text: 'Standort freigeben' }),
      h('p', { class: 'muted', text: 'Deine Position wird nur auf deinem Gerät für Entfernungen genutzt – nicht gespeichert, nicht gesendet.' }),
      abschnitt('iPhone (Safari)', ['Einstellungen öffnen › Datenschutz & Sicherheit › Ortungsdienste.', 'Ortungsdienste einschalten, dann „Safari-Websites“ › „Beim Verwenden der App“.',
        'In Safari links in der Adressleiste auf „aA“ › Website-Einstellungen › Standort › „Erlauben“.', 'Seite neu laden.']),
      abschnitt('Android (Chrome)', ['Links in der Adressleiste auf das Symbol tippen (Schloss bzw. Regler).', 'Berechtigungen › Standort › „Zulassen“.', 'Seite neu laden.']),
      abschnitt('Computer (Chrome, Edge, Firefox, Safari)', ['In der Adressleiste auf das Schloss- bzw. Regler-Symbol klicken.', 'Bei „Standort“ auf „Zulassen“ stellen.', 'Seite neu laden.']),
      h('button', { type: 'button', class: 'btn btn-primary', text: 'Verstanden', onclick: () => dlg.close() })));
    if (!dlg.open) dlg.showModal();
  }

  // ---------------------------------------------------------------- Kopf (Handy: über den Kategorien, Desktop: oben in der Seitenleiste)
  function kopf({ mitKategorien }) {
    const p = punkt();
    const text = p.art === 'position' ? ['um deine Position', p.name] : p.art === 'kartenmitte' ? ['um Kartenmitte', p.name] : [`um ${p.name}`];
    const ico = p.art === 'position' ? 'navigate' : p.art === 'kartenmitte' ? 'locate' : 'pin';
    const aendern = h('button', { type: 'button', class: 'nh-aendern', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': 'naehe-bezug',
      text: 'Ändern', 'aria-label': 'Bezugspunkt ändern', onclick: (e) => fensterOeffnen(e.currentTarget) });
    return [
      h('div', { class: 'nh-zeile' },
        h('h2', { class: 'nh-titel', text: 'In der Nähe' }),
        h('button', { type: 'button', class: 'nh-knopf', onclick: () => ctx.aufKarte(aktuelleTreffer) },
          h('span', { html: icon('map', 20), 'aria-hidden': 'true' }), h('span', { text: 'Auf Karte' }))),
      h('div', { class: 'nh-zeile nh-bezug-zeile' },
        h('p', { class: 'nh-bezug' }, h('span', { class: 'nh-bezug-ico', html: icon(ico, 16), 'aria-hidden': 'true' }),
          h('span', { text: positionLaeuft ? 'Position wird bestimmt …' : text.filter(Boolean).join(' · ') })),
        aendern),
      mitKategorien ? h('div', { class: 'nh-zeile nh-kat' },
        h('div', { class: 'nh-cats', role: 'group', 'aria-label': 'Kategorien' }, Object.keys(TYPES).map(t => {
          const on = ctx.cats().has(t);
          return h('button', { type: 'button', class: 'cat nh-cat', style: `--cc: var(--${t})`, 'aria-pressed': String(on), dataset: { cat: t }, onclick: () => ctx.toggleCat(t) },
            h('span', { class: 'cat-check', html: icon('check', 16), 'aria-hidden': 'true' }), h('span', { class: 'cat-label', text: { slip: 'Slip', marina: 'Häfen', fuel: 'Tanken' }[t] }));
        })),
        h('button', { type: 'button', class: 'filter-btn nh-filter', 'aria-haspopup': 'dialog', onclick: (e) => ctx.filterOeffnen(e.currentTarget) },
          h('span', { html: icon('filter', 20), 'aria-hidden': 'true' }), h('span', { text: 'Filter' }),
          ctx.filterZahl() ? h('span', { class: 'filter-n', text: String(ctx.filterZahl()) }) : null)) : null,
    ];
  }

  /** Erklär-Karte (noch keine Wahl) bzw. Hinweis (im Browser blockiert). */
  function hinweis() {
    if (freigabe === 'denied') {
      return h('div', { class: 'nh-blockiert', role: 'note' },
        h('span', { class: 'nh-blockiert-ico', html: icon('blocked', 20), 'aria-hidden': 'true' }),
        h('span', { class: 'nh-blockiert-text', text: 'Standort im Browser blockiert.' }),
        h('button', { type: 'button', class: 'nh-link', text: 'So aktivierst du ihn ›', onclick: anleitung }));
    }
    if (freigabe === 'granted' || entschieden()) return null;
    return h('section', { class: 'nh-erklaer', 'aria-labelledby': 'nh-erklaer-t' },
      h('span', { class: 'nh-erklaer-ico', html: icon('pin', 26), 'aria-hidden': 'true' }),
      h('div', { class: 'nh-erklaer-text' },
        h('h3', { id: 'nh-erklaer-t', text: 'Standorte in deiner Nähe finden' }),
        h('p', { text: 'Deine Position wird nur auf deinem Gerät für Entfernungen genutzt – nicht gespeichert, nicht gesendet.' })),
      h('div', { class: 'nh-erklaer-knoepfe' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: positionVerwenden }, h('span', { html: icon('navigate', 20), 'aria-hidden': 'true' }), h('span', { text: 'Position verwenden' })),
        h('button', { type: 'button', class: 'btn btn-outline', text: 'Ort eingeben', onclick: (e) => fensterOeffnen(e.currentTarget) })));
  }

  // ---------------------------------------------------------------- Liste
  let aktuelleTreffer = [];
  const gastSortierbar = () => ctx.cats().size === 1 && ctx.cats().has('marina');

  function meldEtikett(p) {
    const m = p.type === 'slip' ? ctx.meld().get(p.id) : null;
    const t = m && TYPEN[m.typ];
    if (!t) return null;
    const wann = m.at ? (m.typ === 'alles_frei' ? zeitpunkt(m.at) : alter(m.at)) : null;
    return h('span', { class: `nh-meld ton-${t.ton}` }, h('i', { 'aria-hidden': 'true' }), [t.zeile, wann].filter(Boolean).join(' · '));
  }

  function karte(p, d) {
    const merkmale = (FILTERS[p.type] || []).filter(f => f.test(p)).slice(0, 2).map(f => f.label);
    const sub = [p.water?.name || p.locality || TYPES[p.type].label, ...merkmale].join(' · ');
    return h('li', {}, h('button', { type: 'button', class: 'place nk', dataset: { id: p.id }, onclick: () => { scrollMerken = ctx.liste().scrollTop; ctx.waehlen(p); } },
      h('span', { class: `nk-ico bg-${p.type}`, html: glyphSvg(p.type, 26), 'aria-hidden': 'true' }),
      h('span', { class: 'nk-text' },
        h('span', { class: 'place-name nk-name', text: displayName(p) }),
        h('span', { class: 'place-sub nk-sub', text: sub }),
        meldEtikett(p)),
      d !== null ? h('span', { class: 'place-dist nk-dist', text: formatDistance(d) }) : null));
  }

  /** Liste in head (Zeile mit Anzahl/Sortierung, Hinweis) und ul zeichnen. */
  function liste(head, ul) {
    const p = punkt();
    const pool = ctx.places().map(x => ({ p: x, d: haversine(p.lat, p.lon, x.lat, x.lon) }));
    let r = RADIEN_KM.find(km => pool.filter(x => x.d <= km * 1000).length >= MIN_TREFFER) ?? RADIEN_KM[RADIEN_KM.length - 1];
    let treffer = pool.filter(x => x.d <= r * 1000);
    if (sortierung === 'gast' && !gastSortierbar()) sortierung = 'naechste';
    const name = (a, b) => displayName(a.p).localeCompare(displayName(b.p), 'de');
    const gast = (x) => (x.p.attrs?.visitor_berths === true ? 0 : 1);
    treffer.sort(sortierung === 'name' ? name : sortierung === 'gast' ? (a, b) => gast(a) - gast(b) || a.d - b.d : (a, b) => a.d - b.d || name(a, b));
    const n = treffer.length;
    treffer = treffer.slice(0, CONFIG.LIST_LIMIT);
    aktuelleTreffer = treffer.map(x => x.p);

    const zahl = p.art === 'kartenmitte'
      ? [h('strong', { text: String(n) }), ` um die Kartenmitte${r > RADIEN_KM[0] ? ` · Umkreis ${r} km` : ''}`]
      : [h('strong', { text: String(n) }), ` Standort${n === 1 ? '' : 'e'} im Umkreis von ${r} km`];
    const sel = h('select', { class: 'nh-sort', 'aria-label': 'Sortierung', onchange: () => { sortierung = sel.value; schreiben(LS_SORT, sortierung); zeichnen(); } },
      [['naechste', 'Nächste zuerst'], ['name', 'Name A–Z'], ...(gastSortierbar() ? [['gast', 'Gastliegeplätze zuerst']] : [])]
        .map(([v, t]) => h('option', { value: v, selected: v === sortierung, text: t })));
    head.replaceChildren(...[hinweis(), n ? h('div', { class: 'nh-zahlzeile' }, h('p', { class: 'nh-zahl' }, zahl), h('span', { class: 'nh-sort-box' }, sel)) : null].filter(Boolean));
    if (n > CONFIG.LIST_LIMIT) head.append(h('p', { class: 'muted nh-limit', text: `Die ${CONFIG.LIST_LIMIT} nächsten werden gezeigt.` }));
    if (n !== letzteZahl) { announce(n ? `${n} Standorte in der Nähe` : 'Keine Standorte in der Nähe'); letzteZahl = n; }

    if (!n) {
      const spezial = ctx.leer?.();
      if (spezial) { ul.replaceChildren(spezial); return; }
      ul.replaceChildren(h('li', { class: 'empty nh-leer' },
        h('p', { class: 'empty-title', text: `Keine Standorte im Umkreis von ${RADIEN_KM[RADIEN_KM.length - 1]} km` }),
        h('p', { class: 'muted', text: 'Wähle einen anderen Ort oder nimm Filter heraus.' }),
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn btn-outline', text: 'Ort ändern', onclick: (e) => fensterOeffnen(e.currentTarget) }),
          h('button', { type: 'button', class: 'btn btn-outline', text: 'Filter zurücksetzen', onclick: () => ctx.filterZuruecksetzen() }))));
      return;
    }
    ul.replaceChildren(...treffer.map(x => karte(x.p, x.d)));
    if (scrollMerken !== null && !ctx.isMobile()) scrollMerken = null;
  }

  let ziel = null;   // { kopfHandy, kopfDesktop, head, ul }
  function zeichnen() {
    if (!ziel || !ziel.aktiv()) return;
    ziel.kopfHandy.replaceChildren(...kopf({ mitKategorien: true }).filter(Boolean));
    ziel.kopfDesktop.replaceChildren(...kopf({ mitKategorien: false }).filter(Boolean));
    liste(ziel.head, ziel.ul);
  }

  /** Nach dem Zurückkehren (Zurück-Taste) an dieselbe Stelle scrollen. */
  function scrollWiederherstellen() {
    if (scrollMerken === null) return;
    const y = scrollMerken; scrollMerken = null;
    requestAnimationFrame(() => { ctx.liste().scrollTop = y; });
  }

  // Ziehen nach unten aktualisiert (Handy)
  function ziehenAktualisiert(el) {
    let y0 = null, dy = 0;
    el.addEventListener('touchstart', (e) => { y0 = el.scrollTop <= 0 && ctx.isMobile() ? e.touches[0].clientY : null; dy = 0; }, { passive: true });
    el.addEventListener('touchmove', (e) => { if (y0 === null) return; dy = e.touches[0].clientY - y0; el.classList.toggle('nh-zieht', dy > 70); }, { passive: true });
    el.addEventListener('touchend', () => {
      if (y0 === null) return;
      el.classList.remove('nh-zieht');
      if (dy > 70) aktualisieren();
      y0 = null;
    });
  }

  async function aktualisieren() {
    await geoFreigabe.pruefen();
    if (bezug?.art === 'position' && freigabe !== 'denied' && (freigabe === 'granted' || entschieden())) await positionHolen();
    else zeichnen();
  }

  geoFreigabe.beobachten(() => zeichnen());

  return {
    /** Ziele setzen und Ziehen-zum-Aktualisieren anbinden. */
    binden(z) { ziel = z; ziehenAktualisiert(z.ul); },
    /** Tab geöffnet: Freigabe prüfen (ohne Dialog), Position nur bei bestehender Freigabe holen. */
    async oeffnen() {
      zeichnen();
      scrollWiederherstellen();
      await geoFreigabe.pruefen();
      if (!bezug && freigabe === 'granted') bezug = { art: 'position' };
      if (bezug?.art === 'position' && freigabe === 'granted') await positionHolen();
      else zeichnen();
    },
    zeichnen,
    karte,
    get treffer() { return aktuelleTreffer; },
  };
}

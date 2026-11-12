// Suche (aus main.js ausgelagert, Designumbau Phase 5, 7.74.0): Vorschläge (Pegel, Gewässer, Orte, Ortssuche), Tastatur,
// Lupe → Suchfeld auf dem Handy (Phase 4). Einrichten: sucheEinrichten(ctx) mit Zustand und Aktionen aus main.js.
import { CONFIG } from './config.js';
import { h, $, $$, clear, debounce, announce } from './dom.js';
import { icon, glyphSvg } from './icons.js';
import { TYPES, displayName, subtitle } from './model.js';
import { searchLocal, geocode } from './search.js';
import { pegelLaden, pegelStand } from './pegel-daten.js';
import { fmt as pegelFmt, zustand as pegelZustand, ZUSTAND as PEGEL_ZUSTAND } from './pegel-ansicht.js';
import { imGebiet, aufGebietBeschneiden, gebietLaden } from './gebiet.js';
import { staffeln } from './bewegung.js';
import { pegelSuche } from './pegel-sheet.js';

/** ctx: { state, el, isMobile, selectGauge, selectPlace, setGauges, setView, toast, toggleCat, closeDetail } – gibt { pegelAusSuche } zurück. */
export function sucheEinrichten(ctx) {
  const { state, el, isMobile, selectGauge, selectPlace, setGauges, setView, toast, toggleCat, closeDetail } = ctx;
  let suggestItems = [], suggestIdx = -1, geoCtrl = null;

  function renderSuggest(local, extra) {
    const ul = clear(el.suggest);
    suggestItems = [];
    const q = el.q.value.trim();
    if (!q) { el.suggest.hidden = true; return; }
    const add = (node, run) => { suggestItems.push(run); ul.append(h('li', { role: 'option', id: `sg-${suggestItems.length - 1}`, 'aria-selected': 'false' }, node)); };
    // Pegel und Gewässer (Designumbau 2a): Stationsliste aus dem Zwischenspeicher; fehlt sie, einmal laden und neu zeichnen
    const stand = pegelStand();
    if (!stand && state.mapOk && q.length >= 2 && !suggestPegelLaedt) {
      suggestPegelLaedt = true;
      pegelLaden().then(() => { if (el.q.value.trim() === q && !el.suggest.hidden) renderSuggest(local, extra); }, () => {}).finally(() => { suggestPegelLaedt = false; });
    }
    const pt = state.mapOk && stand ? pegelSuche(stand.gauges, q, state.user) : { gewaesser: [], pegel: [] };
    for (const w of pt.gewaesser) {
      add(h('button', { type: 'button', class: 'sg', tabindex: '-1' }, h('span', { class: 'sg-ico', html: icon('welle', 18) }),
        h('span', { class: 'place-text' }, h('span', { class: 'place-name', text: w.name }), h('span', { class: 'place-sub', text: `Gewässer · ${w.liste.length} Pegel und Slipanlagen zeigen` }))),
        () => { endSearch(); gewaesserZeigen(w); });
    }
    for (const g of pt.pegel) {
      const z = PEGEL_ZUSTAND[pegelZustand(g)]?.text;
      add(h('button', { type: 'button', class: 'sg', tabindex: '-1' }, h('span', { class: 'sg-ico sg-pegel', html: icon('gauge', 18) }),
        h('span', { class: 'place-text' }, h('span', { class: 'place-name', text: g.name }),
          h('span', { class: 'place-sub', text: [`Pegel · ${g.water || ''}`.replace(/ · $/, ''), `${pegelFmt(g.value)} ${g.unit}${z ? `, ${z}` : ''}`].join(' · ') }))),
        () => { endSearch(); pegelAusSuche(g.id); });
    }
    for (const p of local) {
      add(h('button', { type: 'button', class: 'sg', tabindex: '-1' },
        h('span', { class: `place-ico small bg-${p.type}`, html: glyphSvg(p.type, 18) }),
        h('span', { class: 'place-text' }, h('span', { class: 'place-name', text: displayName(p) }), h('span', { class: 'place-sub', text: [TYPES[p.type].label, subtitle(p)].filter(Boolean).join(' · ') }))),
        () => { endSearch(); selectPlace(p.id); });
    }
    for (const g of extra.results || []) {
      add(h('button', { type: 'button', class: 'sg', tabindex: '-1' }, h('span', { class: 'sg-ico', html: icon('pin', 18) }), h('span', { class: 'place-text' }, h('span', { class: 'place-name', text: g.name }), h('span', { class: 'place-sub', text: 'Ort' }))), () => { endSearch(); goToGeo(g); });
    }
    if (q.length >= 2 && !extra.results) {
      add(h('button', { type: 'button', class: 'sg', tabindex: '-1' }, h('span', { class: 'sg-ico', html: icon('search', 18) }), h('span', { class: 'place-text' }, h('span', { class: 'place-name', text: `Ort „${q}“ suchen` }), h('span', { class: 'place-sub', text: 'Städte, Orte, Gewässer' }))), () => runGeocode(q));
    }
    if (extra.message) ul.append(h('li', { class: 'sg-msg', text: extra.message }));
    const warZu = el.suggest.hidden;
    el.suggest.hidden = !ul.children.length;
    if (warZu && !el.suggest.hidden) staffeln(ul.children, { schritt: 45, max: 10 });   // Vorschläge: Zeilen versetzt (Karte fällt per CSS ein)
    el.q.setAttribute('aria-expanded', String(!el.suggest.hidden));
    suggestIdx = -1;
  }

  function endSearch() { el.suggest.hidden = true; el.q.setAttribute('aria-expanded', 'false'); el.q.blur(); }
  let suggestPegelLaedt = false;

  /** Pegel aus der Suche: Chip „Pegel“ an, hinfliegen, Sheet öffnen. */
  async function pegelAusSuche(id) {
    setView('karte');
    if (!state.gaugesOn || !state.gauges) await setGauges(true);
    if (!selectGauge(id)) toast('Dieser Pegel wurde nicht gefunden.');
  }

  /** Gewässer aus der Suche: Pegel und Slipanlagen einschalten, das Gewässer zeigen (alle seine Pegel im Bild). */
  async function gewaesserZeigen(w) {
    setView('karte');
    closeDetail();
    if (!state.cats.has('slip')) toggleCat('slip', true);
    if (!state.gaugesOn || !state.gauges) await setGauges(true);
    state.map?.fitBounds(w.liste.map(g => [g.lat, g.lon]), { maxZoom: 11 });
    announce(`${w.name}: ${w.liste.length} Pegel und die Slipanlagen auf der Karte`);
  }

  function goToGeo(g) {
    if (!state.map) { toast('Die Karte ist nicht verfügbar.'); return; }
    if (!imGebiet(g.lat, g.lon)) { toast(CONFIG.GEBIET.hinweis); return; }
    // Große Treffer (z. B. Bundesländer, Flüsse) auf das Kartengebiet beschneiden
    const box = g.bbox && g.bbox.length === 4 && g.bbox.every(Number.isFinite) ? aufGebietBeschneiden([[g.bbox[0], g.bbox[2]], [g.bbox[1], g.bbox[3]]]) : null;
    if (box) state.map.fitBounds(box, { maxZoom: 13 });
    else state.map.flyTo(g.lat, g.lon, 12);
    closeDetail();
  }

  async function runGeocode(q, { auto = false } = {}) {
    if (geoCtrl) geoCtrl.abort();
    geoCtrl = new AbortController();
    renderSuggest(searchLocal(state.index, q), { message: 'Suche läuft …' });
    try {
      const alle = await geocode(q, { signal: geoCtrl.signal });
      // nicht nur auf die Länderkennung verlassen: Position muss im Kartengebiet liegen
      await gebietLaden().catch(() => {});
      const results = alle.filter(r => imGebiet(r.lat, r.lon)).slice(0, 5);
      if (alle.length && !results.length) { renderSuggest(searchLocal(state.index, q), { message: CONFIG.GEBIET.hinweis }); return; }
      if (!results.length) { renderSuggest(searchLocal(state.index, q), { message: 'Nichts gefunden. Prüfe die Schreibweise oder suche einen größeren Ort.' }); return; }
      if (auto) { endSearch(); goToGeo(results[0]); return; }
      renderSuggest(searchLocal(state.index, q), { results });
    } catch (e) {
      if (e.name === 'AbortError') return;
      renderSuggest(searchLocal(state.index, q), { message: navigator.onLine ? 'Die Ortssuche ist gerade nicht erreichbar. Standorte findest du weiterhin über den Namen.' : 'Du bist offline. Die Ortssuche braucht eine Verbindung.' });
    }
  }

  /** Handy: Suche als Lupe rechts, ein Tipp dehnt sie zur Pille (Designumbau 4). Desktop: Suchfeld wie bisher offen in der Kopfleiste. */
  const kopfzeile = $('.app-header'), lupe = $('#search-form .search-btn');
  const sucheZu = () => kopfzeile.classList.contains('such-zu');
  function sucheZustand() {
    const zu = isMobile() && sucheZu();
    lupe.setAttribute('aria-expanded', String(!zu)); lupe.setAttribute('aria-label', isMobile() ? (zu ? 'Suche öffnen' : 'Suche schließen') : 'Suchen');
    el.q.tabIndex = zu ? -1 : 0;
  }
  function sucheOeffnen() {
    if (!sucheZu()) return;
    kopfzeile.classList.remove('such-zu'); sucheZustand();
    if (document.activeElement !== el.q) el.q.focus();   // Tastatur geht auf
  }
  function sucheSchliessen({ fokus = true } = {}) {
    if (sucheZu() || !isMobile()) return;
    el.q.value = ''; el.q.dispatchEvent(new Event('input'));
    endSearch();
    kopfzeile.classList.add('such-zu'); sucheZustand();
    if (fokus) lupe.focus({ preventScroll: true });
  }

  function wireSearch() {
    kopfzeile.classList.add('such-zu'); sucheZustand();
    window.matchMedia('(max-width: 767px)').addEventListener?.('change', () => sucheZustand());
    // Lupe ist ein normaler Knopf (kein submit): Enter im Feld sendet das Formular, ohne die Lupe auszulösen
    lupe.addEventListener('click', (e) => {
      if (!isMobile()) { $('#search-form').requestSubmit(); return; }   // Desktop: Suchen
      e.preventDefault();
      if (sucheZu()) sucheOeffnen(); else sucheSchliessen();
    });
    el.q.addEventListener('focus', () => { if (isMobile()) sucheOeffnen(); });
    el.q.addEventListener('input', debounce(() => {
      const q = el.q.value.trim();
      if (geoCtrl) geoCtrl.abort();
      renderSuggest(q ? searchLocal(state.index, q) : [], {});
    }, 100));
    el.q.addEventListener('focus', () => { if (el.q.value.trim()) renderSuggest(searchLocal(state.index, el.q.value.trim()), {}); });
    el.q.addEventListener('keydown', (e) => {
      const n = suggestItems.length;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!n) return; e.preventDefault();
        suggestIdx = (suggestIdx + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
        $$('#suggest [role=option]').forEach((li, i) => { li.setAttribute('aria-selected', String(i === suggestIdx)); li.classList.toggle('is-active', i === suggestIdx); });
        el.q.setAttribute('aria-activedescendant', `sg-${suggestIdx}`);
      } else if (e.key === 'Escape') { if (!el.suggest.hidden) el.suggest.hidden = true; else sucheSchliessen(); }
    });
    $('#search-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const q = el.q.value.trim();
      if (!q) return;
      if (suggestIdx >= 0 && suggestItems[suggestIdx]) { suggestItems[suggestIdx](); return; }
      const local = searchLocal(state.index, q);
      const exact = local.find(p => displayName(p).toLowerCase() === q.toLowerCase());
      if (exact) { endSearch(); selectPlace(exact.id); return; }
      runGeocode(q, { auto: true });
    });
    el.suggest.addEventListener('click', (e) => {
      const li = e.target.closest('[role=option]');
      if (li) suggestItems[Number(li.id.slice(3))]?.();
    });
    document.addEventListener('click', (e) => { if (!e.target.closest('.search')) { el.suggest.hidden = true; } });
  }

  wireSearch();
  return { pegelAusSuche };
}

// Bereich „Aktuelle Meldungen“ (#meldungen): alle aktiven Lagemeldungen („Heute vor Ort“) aus einem Abruf (/api/meldungen/liste).
// Bewerten nutzt die vorhandene Logik (meldungen.js → bestaetigen); offline nur Lesen mit Hinweis auf den gespeicherten Stand.
import { h } from './dom.js';
import { icon } from './icons.js';
import { TYPEN, listeLaden, bestaetigen, schonBewertet, alter, standVon } from './meldungen.js';

// Filter: Schlüssel → Typen (null = alle)
const FILTER = [
  ['alle', 'Alle', null],
  ['gesperrt', 'Sperrungen', ['gesperrt']],
  ['parkplatz', 'Parkplätze', ['parkplatz_voll']],
  ['warteschlange', 'Warteschlangen', ['warteschlange']],
  ['rampe', 'Rampe', ['rampe_rutschig']],
  ['hindernis', 'Hindernisse', ['hindernis']],
];
const SORT = { neu: 'Neueste zuerst', wichtig: 'Wichtigste zuerst', nah: 'Nächste zuerst' };
const LS_KM = 'watermap.meldungen.umkreis';   // gemerkter Umkreis in km (5–100)
const KM_MIN = 5, KM_MAX = 100, KM_SCHRITT = 5, KM_START = 25;
const kmLesen = () => { try { const v = Number(JSON.parse(localStorage.getItem(LS_KM))); return v >= KM_MIN && v <= KM_MAX ? Math.round(v / KM_SCHRITT) * KM_SCHRITT : KM_START; } catch { return KM_START; } };
const kmMerken = (km) => { try { localStorage.setItem(LS_KM, JSON.stringify(km)); } catch { /* ohne Speicher */ } };
// pos: Stand der Standortabfrage für „Mein Standort“ (frei = noch nicht gefragt, laeuft, fehler)
const ui = { filter: 'alle', bereich: 'ueberall', sort: 'neu', km: kmLesen(), pos: 'frei', posFehler: '' };

const TON = { gut: 'vo-gut', warn: 'vo-warn', stop: 'vo-stop' };

/**
 * ctx = { ort(id) → { name, sub, lat, lon } | null, oeffneOrt(id), bezug() → { lat, lon } | null, grenzen() → { south, north, west, east } | null,
 *         position() → Promise<{ lat, lon }> (fragt den Standort ab, Fehler mit Text), freigegeben() → boolean, entfernung(a, b) → m, formatDistance(m), melden(), toast(text), unpassend(meldung, ortName, fertig) }
 */
export function meldungenSeite(root, ctx) {
  let daten = null, laeuft = null;

  async function laden(force = false) {
    if (!daten) root.replaceChildren(rahmen(h('p', { class: 'bs-leer mu-laden', text: 'Meldungen werden geladen …' })));
    laeuft ||= listeLaden({ force }).finally(() => { laeuft = null; });
    daten = await laeuft;
    zeichnen();
  }

  function rahmen(...inhalt) {
    const n = daten?.meldungen?.length;
    return h('div', { class: 'bs-seite mu-seite' },
      h('header', { class: 'bs-kopf mu-kopf' },
        h('div', {}, h('h1', { class: 'bs-titel', id: 'bs-titel', tabindex: '-1', text: 'Aktuelle Meldungen' }),
          h('p', { class: 'bs-unter', text: 'Das berichten Sportbootfahrer aus deinem Revier.' }),
          n !== undefined ? h('p', { class: 'mu-zahl', text: n ? `${n} aktuelle ${n === 1 ? 'Meldung' : 'Meldungen'}` : 'Keine aktuellen Meldungen' }) : null),
        h('button', { type: 'button', class: 'mu-neu', 'aria-label': 'Meldungen aktualisieren', html: icon('refresh', 22), onclick: async (e) => {
          e.currentTarget.classList.add('is-busy'); await laden(true); ctx.toast(daten.offline ? 'Keine Verbindung – letzter gespeicherter Stand.' : 'Meldungen aktualisiert.'); } })),
      ...inhalt);
  }

  function auswahl() {
    const typen = FILTER.find(f => f[0] === ui.filter)?.[2];
    const b = ui.bereich === 'karte' ? ctx.grenzen() : null;
    const bezug = ctx.bezug();
    if (ui.sort === 'nah' && !bezug) ui.sort = 'neu';
    let liste = daten.meldungen.filter(m => !typen || typen.includes(m.typ));
    if (ui.bereich === 'standort' && bezug) liste = liste.filter((m) => { const o = ctx.ort(m.standortId); return o && ctx.entfernung(bezug, o) <= ui.km * 1000; });
    if (b) liste = liste.filter((m) => { const o = ctx.ort(m.standortId); return o && o.lat >= b.south && o.lat <= b.north && o.lon >= b.west && o.lon <= b.east; });
    const d = (m) => { const o = ctx.ort(m.standortId); return bezug && o ? ctx.entfernung(bezug, o) : Infinity; };
    if (ui.sort === 'wichtig') liste.sort((x, y) => (TYPEN[y.typ]?.rang || 0) - (TYPEN[x.typ]?.rang || 0) || y.erstelltAm - x.erstelltAm);
    else if (ui.sort === 'nah') liste.sort((x, y) => d(x) - d(y) || y.erstelltAm - x.erstelltAm);
    else liste.sort((x, y) => y.erstelltAm - x.erstelltAm);
    return { liste, bezug, d };
  }

  function karte(m, bezug, d) {
    const t = TYPEN[m.typ] || TYPEN.hindernis, o = ctx.ort(m.standortId);
    const bewertet = schonBewertet(m.id), aus = daten.offline || bewertet;
    const unter = [`Gemeldet ${alter(m.erstelltAm)}`, m.bestaetigt ? `${m.bestaetigt}× bestätigt` : null, m.widersprochen ? `${m.widersprochen}× nicht mehr` : null].filter(Boolean).join(' · ');
    const entf = bezug && o ? ctx.formatDistance(d(m)) : null;
    const knopf = (text, stimmt) => h('button', { type: 'button', class: 'mu-knopf', disabled: aus, onclick: async (e) => {
      e.currentTarget.disabled = true;
      try { await bestaetigen(m, stimmt); ctx.toast(stimmt ? 'Danke – als „stimmt noch“ bestätigt.' : 'Danke – als „nicht mehr aktuell“ markiert.'); await laden(false); }
      catch (err) { ctx.toast(err.message); e.currentTarget.disabled = false; }
    } }, text);
    return h('article', { class: `mu-karte ${TON[t.ton] || 'vo-warn'}`, 'aria-label': `${t.zeile}${o ? `, ${o.name}` : ''}` },
      h('div', { class: 'mu-oben' },
        h('span', { class: 'vo-kreis is-typ', style: `--c:${t.farbe}`, html: icon(t.ico, 22), 'aria-hidden': 'true' }),
        h('div', { class: 'mu-text' },
          h('h2', { class: 'mu-typ', text: t.zeile }),
          h('p', { class: 'mu-ort' }, o ? o.name : 'Standort', o?.sub ? h('span', { text: ` · ${o.sub}` }) : null),
          h('p', { class: 'mu-zeit', text: unter }),
          m.notiz ? h('p', { class: 'mu-notiz', text: `„${m.notiz}“` }) : null),
        entf ? h('span', { class: 'mu-entf', text: entf }) : null),
      h('div', { class: 'mu-knoepfe' },
        knopf('Stimmt noch', true), knopf('Nicht mehr aktuell', false),
        o ? h('a', { class: 'mu-ort-link', href: `#p=${encodeURIComponent(m.standortId)}`, onclick: (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return; e.preventDefault(); ctx.oeffneOrt(m.standortId); } },
          'Standort', h('span', { html: icon('chevron', 16), 'aria-hidden': 'true' })) : null),
      bewertet && !daten.offline ? h('p', { class: 'mu-bewertet', text: 'Du hast diese Meldung schon bewertet.' }) : null,
      // nur Meldungen mit Notiz können unpassend sein
      m.notiz && ctx.unpassend && !daten.offline ? h('div', { class: 'mu-unpassend' }, h('button', { type: 'button', class: 'vo-unpassend', 'aria-label': `Notiz „${m.notiz}“ als unpassend melden`,
        onclick: () => ctx.unpassend(m, o?.name || '', async () => { await laden(false); root.querySelector('#bs-titel')?.focus(); }) },
        h('span', { html: icon('flag', 15), 'aria-hidden': 'true' }), h('span', { text: 'Unpassend melden' }))) : null);
  }

  /** „Mein Standort“ antippen: Position nur auf Wunsch (oder wenn schon freigegeben) abfragen. */
  async function bereichWaehlen(k) {
    ui.bereich = k;
    if (k === 'standort' && !ctx.bezug()) {
      if (ctx.freigegeben()) await positionHolen(); else { ui.pos = 'frei'; zeichnen(); }
      return;
    }
    zeichnen();
  }
  async function positionHolen() {
    ui.pos = 'laeuft'; zeichnen();
    try { await ctx.position(); ui.pos = 'frei'; ui.posFehler = ''; }
    catch (e) { ui.pos = 'fehler'; ui.posFehler = e.message; }
    if (ui.bereich === 'standort') zeichnen();
  }

  function inhaltBauen(liste, bezug, d) {
    if (ui.bereich === 'standort' && !bezug) {
      return h('div', { class: 'bs-gruppe mu-leer mu-pos' },
        h('p', { class: 'mu-leer-titel', text: ui.pos === 'laeuft' ? 'Standort wird bestimmt …' : 'Standort verwenden?' }),
        h('p', { class: 'bs-leer', role: ui.pos === 'fehler' ? 'alert' : null, text: ui.pos === 'fehler' ? ui.posFehler
          : 'Damit zeigen wir Meldungen im Umkreis deines Standorts. Dein Standort bleibt auf deinem Gerät.' }),
        ui.pos === 'laeuft' ? null : h('button', { type: 'button', class: 'btn btn-primary mu-melden', onclick: positionHolen }, ui.pos === 'fehler' ? 'Erneut versuchen' : 'Standort verwenden'));
    }
    if (!daten.meldungen.length) {
      return h('div', { class: 'bs-gruppe mu-leer' },
        h('p', { class: 'mu-leer-titel', text: daten.offline ? 'Keine gespeicherten Meldungen' : 'Gerade keine aktuellen Meldungen' }),
        h('p', { class: 'bs-leer', text: 'Meldungen gelten 24 Stunden. Bist du an einer Slipanlage? Teile kurz, wie es vor Ort aussieht.' }),
        h('button', { type: 'button', class: 'btn btn-primary mu-melden', onclick: ctx.melden }, h('span', { html: icon('plus', 18) }), 'Lage melden'));
    }
    if (!liste.length) {
      return h('div', { class: 'bs-gruppe mu-leer' },
        h('p', { class: 'bs-leer', text: ui.bereich === 'karte' ? 'Im Kartenausschnitt gibt es dazu gerade keine Meldungen.'
          : ui.bereich === 'standort' ? `Im Umkreis von ${ui.km} km gibt es dazu gerade keine Meldungen.` : 'Für diesen Filter gibt es gerade keine Meldungen.' }),
        h('button', { type: 'button', class: 'bs-link', text: 'Alle Meldungen zeigen', onclick: () => { ui.filter = 'alle'; ui.bereich = 'ueberall'; zeichnen(); } }));
    }
    return h('div', { class: 'mu-liste' }, liste.map(m => karte(m, bezug, d)));
  }

  function zeichnen() {
    if (!daten) return;
    const fokus = root.contains(document.activeElement) ? document.activeElement.dataset?.fokus : null;
    const { liste, bezug, d } = auswahl();
    const chips = h('div', { class: 'mu-chips', role: 'group', 'aria-label': 'Nach Art filtern' }, FILTER.map(([k, text, typen]) => {
      const farbe = typen ? TYPEN[typen[0]]?.farbe : null;
      return h('button', { type: 'button', class: 'mu-chip' + (ui.filter === k ? ' is-an' : ''), 'aria-pressed': String(ui.filter === k), dataset: { fokus: `f-${k}` },
        style: farbe && ui.filter !== k ? `color:${farbe}` : null, onclick: () => { ui.filter = k; zeichnen(); } },
        farbe ? h('i', { 'aria-hidden': 'true' }) : null, text);
    }));
    const kartenOk = !!ctx.grenzen();
    const seg = h('div', { class: 'mu-seg', role: 'group', 'aria-label': 'Bereich' },
      [['ueberall', 'Überall'], ['karte', 'Kartenausschnitt'], ['standort', 'Mein Standort']].map(([k, text]) => h('button', { type: 'button', class: ui.bereich === k ? 'is-an' : '', 'aria-pressed': String(ui.bereich === k),
        dataset: { fokus: `b-${k}` }, disabled: k === 'karte' && !kartenOk, onclick: () => bereichWaehlen(k) }, text)));
    const sort = h('select', { class: 'mu-sort', 'aria-label': 'Sortierung', dataset: { fokus: 'sort' }, onchange: (e) => { ui.sort = e.target.value; zeichnen(); } },
      Object.entries(SORT).filter(([k]) => k !== 'nah' || bezug).map(([k, text]) => h('option', { value: k, selected: ui.sort === k, text })));
    const hinweis = daten.offline
      ? h('p', { class: 'bs-hinweis mu-offline', role: 'status', text: daten.unbekannt ? 'Offline – noch kein gespeicherter Stand vorhanden.' : `Offline – letzter gespeicherter Stand (${standVon(daten.zeit).replace('Stand von ', '')}). Bewerten ist erst wieder mit Verbindung möglich.` })
      : null;
    // Liste und Zählzeile werden beim Ziehen des Reglers allein neu gezeichnet (der Regler bleibt stehen)
    const zaehler = h('p', { class: 'mu-umkreis-zahl', role: 'status' });
    const rumpf = h('div', { class: 'mu-rumpf' });
    const fuellen = () => {
      const a = auswahl();
      zaehler.textContent = `${a.liste.length} ${a.liste.length === 1 ? 'Meldung' : 'Meldungen'} im Umkreis von ${ui.km} km um deinen Standort.`;
      rumpf.replaceChildren(inhaltBauen(a.liste, a.bezug, a.d));
    };
    const regler = ui.bereich === 'standort' && bezug ? h('div', { class: 'mu-umkreis' },
      h('label', { class: 'mu-umkreis-kopf', for: 'mu-km' }, h('span', { text: 'Umkreis' }), h('b', { class: 'mu-km-wert', text: `${ui.km} km` })),
      h('input', { type: 'range', id: 'mu-km', class: 'mu-range', min: String(KM_MIN), max: String(KM_MAX), step: String(KM_SCHRITT), value: String(ui.km), 'aria-valuetext': `${ui.km} Kilometer`, dataset: { fokus: 'km' },
        oninput: (e) => { ui.km = Number(e.target.value); e.target.setAttribute('aria-valuetext', `${ui.km} Kilometer`); root.querySelector('.mu-km-wert').textContent = `${ui.km} km`; fuellen(); },
        onchange: () => kmMerken(ui.km) }),
      h('div', { class: 'mu-skala', 'aria-hidden': 'true' }, [5, 25, 50, 75, 100].map(n => h('span', { text: n === 100 ? '100 km' : String(n) }))),
      zaehler) : null;
    fuellen();
    root.replaceChildren(rahmen(chips, h('div', { class: 'mu-steuer' }, seg, h('span', { class: 'mu-sort-box' }, sort)), regler, hinweis, rumpf));
    if (fokus) root.querySelector(`[data-fokus="${fokus}"]`)?.focus();
  }

  return {
    zeigen: (force = false) => laden(force),
    /** neu zeichnen ohne Abruf (z. B. Kartenausschnitt geändert) */
    neuZeichnen: () => zeichnen(),
  };
}

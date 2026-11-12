// Bausteine für Pegel: Zustands-Etikett, Skala, Klartext, Kennwerte und das Pegel-Cockpit (Detailansicht).
// Zustand nach den amtlichen Kennwerten des jeweiligen Pegels (PEGELONLINE) – nicht nach dem eigenen Boot.
import { h } from './dom.js';
import { icon } from './icons.js';
import { historyChart, formatTime } from './pegel.js';
import { aenderung24h, meinePegel, zusatzLaden, vorhersageWLaden, wtAenderungLaden, verlauf30Laden } from './pegel-daten.js';
import { vorhersageSatz } from './pegel-vorhersage.js';
import { tendenz, tendenzText as tendenzTextKurz, aenderungKurz, zonenLage, ZONEN } from './pegel-einordnung.js';
import { alarmFenster, alarmStatus } from './alarm.js';
import { istTidepegel } from './gezeiten.js';
import { tideDetail } from './pegel-tide-ansicht.js';
import { passtMeinBoot } from './passt-mein-boot.js';
import { hochzaehlen, merkFlug, sternPop } from './bewegung.js';
import { seg } from './bausteine.js';

export const fmt = (v) => Math.round(v).toLocaleString('de-DE');
export const kmText = (g) => (g.km !== null && g.km !== undefined ? `km ${g.km.toLocaleString('de-DE', { maximumFractionDigits: 1 })}` : '');
const ohneKennwerte = (g) => g.refs.MNW === undefined && g.refs.MHW === undefined;

/** Zustand für Etiketten und Farben (veraltet, Tide und ohne Kennwerte eigens). */
export function zustand(g) {
  if (g.state === 'old') return 'old';
  if (g.state === 'unknown') return ohneKennwerte(g) ? (g.tide ? 'tide' : 'none') : 'unknown';
  return g.state;
}
export const ZUSTAND = {
  hsw:     { text: 'über HSW',       farbe: 'var(--wm-stop)', cls: 'pz-hsw' },
  high:    { text: 'Hoch',           farbe: 'var(--wm-hoch)', cls: 'pz-high' },
  normal:  { text: 'Normal',         farbe: 'var(--wm-gut)', cls: 'pz-normal' },
  low:     { text: 'Niedrig',        farbe: 'var(--wm-warn)', cls: 'pz-low' },
  tide:    { text: 'Tide',           farbe: 'var(--wm-fokus)', cls: 'pz-tide' },
  none:    { text: 'ohne Kennwerte', farbe: 'var(--wm-leise)', cls: 'pz-none' },
  unknown: { text: 'ohne Einordnung', farbe: 'var(--wm-leise)', cls: 'pz-none' },
  old:     { text: 'veraltet',       farbe: 'var(--wm-leise)', cls: 'pz-old' },
};
export const etikett = (g) => { const z = ZUSTAND[zustand(g)]; return h('span', { class: `pz-tag ${z.cls}`, text: z.text }); };

const TREND_TEXT = { 1: 'steigend', 0: 'gleichbleibend', '-1': 'fallend' };
const TREND_PFEIL = { 1: '↗', 0: '→', '-1': '↘' };
export const trendText = (g, { kurz = false } = {}) => (g.trend === null ? '' : `${TREND_PFEIL[g.trend]} ${kurz && g.trend === 0 ? 'gleich' : TREND_TEXT[g.trend]}`);
const KW = ['MNW', 'MW', 'MHW', 'HSW'];
export const KW_NAME = { MNW: 'Mittleres Niedrigwasser', MW: 'Mittelwasser', MHW: 'Mittleres Hochwasser', HSW: 'Höchster Schifffahrtswasserstand' };

const KW_PUNKT = { NNW: 'pz-low', MNW: 'pz-low', MW: 'pz-normal', MHW: 'pz-high', HHW: 'pz-high', HSW: 'pz-hsw' };
const KURZNAME = { NNW: 'niedrigster', MNW: 'mittl. Niedrigwasser', MW: 'Mittelwasser', MHW: 'mittl. Hochwasser', HHW: 'höchster', HSW: 'höchster Schifffahrtsw.' };

/** Karte „Einordnung“: Zustand groß, Balken Niedrig · Normal · Hoch mit Punkt (nur mit MNW und MHW), darunter die Grenzen. */
export function einordnungKarte(g) {
  const z = zustand(g), lage = g.state === 'old' ? null : zonenLage(g.refs, g.value);
  return h('section', { class: 'pd-karte pd-einordnung', 'aria-label': 'Einordnung' },
    h('h2', { class: 'pd-ct', text: 'Einordnung' }),
    h('p', { class: `pd-zst ${ZUSTAND[z].cls}` }, h('i', { 'aria-hidden': 'true' }), ZUSTAND[z].text.replace(/^ü/, 'Ü')),
    lage ? h('div', { class: 'pd-zonen', role: 'img', 'aria-label': `${fmt(g.value)} ${g.unit}: ${{ low: 'unter MNW', normal: 'zwischen MNW und MHW', high: 'über MHW' }[lage.zone]}. MNW ${fmt(g.refs.MNW)}, MHW ${fmt(g.refs.MHW)} ${g.unit}.` },
      h('div', { class: 'pd-zbalken' }, ZONEN.map((w, i) => h('span', { class: `pd-z${i}${['low', 'normal', 'high'][i] === lage.zone ? ' is-an' : ''}`, style: `width:${w}%` })),
        h('span', { class: `pd-zmark is-${lage.zone}`, style: `left:${lage.pos.toFixed(2)}%` }, h('b', { text: `${fmt(g.value)} ${g.unit}` }), h('i'))),
      h('div', { class: 'pd-znamen' }, [['Niedrig', `unter ${fmt(g.refs.MNW)}`], ['Normal', `${fmt(g.refs.MNW)}–${fmt(g.refs.MHW)}`], ['Hoch', `über ${fmt(g.refs.MHW)}`]].map(([t, u], i) =>
        h('span', { class: ['low', 'normal', 'high'][i] === lage.zone ? 'is-an' : '', style: `width:${ZONEN[i]}%` }, h('strong', { text: t }), h('small', { text: u })))))
      : null);
}

/** Karte „Kennwerte“: Kürzel, kurze Bezeichnung, Wert (alle von PEGELONLINE gelieferten; bis dahin die Hauptwerte). null ohne Kennwerte. */
export function kennwerteKarte(g) {
  const keys = KW.filter(k => g.refs[k] !== undefined);
  if (!keys.length) return null;
  // 8.0.3: von hoch nach niedrig wie eine Pegellatte, Farbpunkt je Bereich, der aktuelle Wert als hervorgehobene Zeile dazwischen
  const zeile = (k, name, v, cls, extra = '') => h('li', { class: extra }, h('i', { class: `pd-zdot ${cls}`, 'aria-hidden': 'true' }), h('b', { text: k }), h('span', { text: name }), h('strong', { text: `${fmt(v)} ${g.unit}` }));
  const jetzt = g.state !== 'old' && Number.isFinite(g.value) ? { k: 'Jetzt', name: 'aktueller Wert', v: g.value, jetzt: true } : null;
  const fuellen = (eintraege) => liste.replaceChildren(...[...eintraege, ...(jetzt ? [jetzt] : [])].sort((a, b) => b.v - a.v || (a.jetzt ? -1 : 1))
    .map(e => e.jetzt ? zeile(e.k, e.name, e.v, ZUSTAND[zustand(g)].cls, 'is-jetzt') : zeile(e.k, KURZNAME[e.k] || e.name, e.v, KW_PUNKT[e.k] || 'pz-none')));
  const liste = h('ul', { class: 'pd-kwl' });
  fuellen(keys.map(k => ({ k, v: g.refs[k], name: KW_NAME[k] })));
  zusatzLaden(g.id).then((z) => { if (z?.kennwerte?.length) fuellen(z.kennwerte.map(c => ({ k: c.k, v: c.v, name: c.name }))); });
  return h('section', { class: 'pd-karte pd-kennwerte', 'aria-label': 'Kennwerte' }, h('h2', { class: 'pd-ct', text: 'Kennwerte' }), liste);
}

/** Quellenangabe unter den Pegel-Details (8.0.3): klein und grau, mit Pegelnummer und Link zu PEGELONLINE. text: eigener Satz (Tide). */
export function quelleZeile(g, text = 'Daten: WSV/PEGELONLINE. Der Pegel ist nicht die Wassertiefe; Niedrig/Normal/Hoch beziehen sich auf MNW und MHW dieses Pegels.') {
  return h('p', { class: 'pd-quelle' }, text, g.number ? ' ' : null,
    g.number ? h('a', { href: `https://www.pegelonline.wsv.de/gast/stammdaten?pegelnr=${encodeURIComponent(g.number)}`, target: '_blank', rel: 'noopener noreferrer', text: `Pegel ${g.number} bei PEGELONLINE ↗` }) : null);
}

const fmt1 = (v) => v.toLocaleString('de-DE', { maximumFractionDigits: 1 });
const signiert = (v, e) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${fmt1(Math.abs(v))} ${e}`;
/** Kacheln „Wassertemperatur“ und „Abfluss“ im Pegel-Fenster – nur, wenn der Pegel sie liefert (sonst unsichtbar). */
export function zusatzKacheln(g) {
  const box = h('div', { class: 'pd-zusatz', hidden: true });
  zusatzLaden(g.id).then((z) => {
    const kacheln = [];
    if (z.q) {
      kacheln.push(h('div', { class: 'pd-z is-q' }, h('p', { class: 'pd-ct' }, h('span', { html: icon('welle', 15), 'aria-hidden': 'true' }), 'Abfluss'),
        h('p', { class: 'pd-z-wert' }, h('strong', { text: fmt(z.q.v) }), h('span', { text: ' m³/s' }))));
    }
    if (z.wt) {
      const sub = h('p', { class: 'pd-z-sub', text: '' });
      kacheln.push(h('div', { class: 'pd-z is-wt' }, h('p', { class: 'pd-ct' }, h('span', { html: icon('thermo', 15), 'aria-hidden': 'true' }), 'Wasser'),
        h('p', { class: 'pd-z-wert' }, h('strong', { text: fmt1(Math.round(z.wt.v * 10) / 10) }), h('span', { text: ' °C' })), sub));
      wtAenderungLaden(g.id).then((d) => { if (d !== null) sub.textContent = `${signiert(d, '°C')} seit gestern`; });
    }
    if (!kacheln.length) return;
    box.replaceChildren(...kacheln); box.hidden = false;
  });
  return box;
}

/** Runder Glasknopf mit Symbol und Beschriftung (Alarm, Merken, Teilen). */
export const glasKnopf = (cls, ico, text, attrs = {}) => h('button', { type: 'button', class: `pd-kb ${cls}`, ...attrs }, h('span', { class: 'pd-kb-ico', html: ico, 'aria-hidden': 'true' }), h('span', { class: 'pd-kb-text', text }));

/** Knopf „Alarm“ (aktiv hervorgehoben, Status im Titel); öffnet das Alarm-Fenster. */
export function alarmKnopf(g) {
  const knopf = glasKnopf('pd-alarm', icon('bell', 20), 'Alarm', { 'aria-haspopup': 'dialog', onclick: (e) => alarmFenster(g, { opener: e.currentTarget }) });
  const stellen = () => { const st = alarmStatus(g.id); knopf.classList.toggle('is-an', !!st); knopf.title = st || 'Benachrichtigen lassen'; knopf.setAttribute('aria-label', st ? `Pegel-Alarm: ${st}` : 'Pegel-Alarm einrichten'); };
  stellen();
  const neu = () => { if (!knopf.isConnected) { document.removeEventListener('pegel-alarme', neu); return; } stellen(); };
  document.addEventListener('pegel-alarme', neu);
  return knopf;
}

/** Knopf „Merken“ (Stern, „Meine Pegel“). */
export function merkKnopf(g, onChange) {
  const an = meinePegel.hat(g.id);
  const knopf = glasKnopf('pm-stern pd-merken' + (an ? ' is-on' : ''), icon('star', 20, an), an ? 'Gemerkt' : 'Merken',
    { 'aria-pressed': String(an), 'aria-label': an ? `${g.name} aus „Meine Pegel“ entfernen` : `${g.name} zu „Meine Pegel“ hinzufügen` });
  knopf.onclick = (e) => {
    e.stopPropagation();
    const von = knopf.getBoundingClientRect(), dazu = !meinePegel.hat(g.id), vorher = meinePegel.alle();
    meinePegel.umschalten(g.id); onChange?.();
    // Designumbau 4: Stern ploppt und fliegt zu „Gemerkt“; beim Entfernen Toast mit „Rückgängig“
    if (dazu) { sternPop(document.activeElement?.closest?.('.pd-merken') || knopf); merkFlug(von); }
    else document.dispatchEvent(new CustomEvent('wm-toast', { detail: { text: `${g.name} entfernt.`, aktion: { text: 'Rückgängig', onclick: () => meinePegel.setzen(vorher) } } }));
  };
  return knopf;
}

/** Großer Wert; beim Öffnen zählen die letzten 36 Einheiten hoch (Designumbau 4, nicht bei veralteten Werten). */
export function grosserWert(g, alt = false) {
  const el = h('strong', { text: fmt(g.value) });
  if (!alt) setTimeout(() => hochzaehlen(el, Math.round(g.value), { format: fmt }), 0);
  return el;
}

/** Zeile „Weser · KM 201,4“ in der Kopfleiste; die Art („Pegel“/„Tidepegel“) nur für Screenreader (Etikett zeigt sie sichtbar). */
export function kicker(art, g) {
  return h('p', { class: 'pd-kicker' }, h('span', { class: 'sr-only', text: `${art} · ` }),
    [g.water, kmText(g).replace('km', 'KM')].filter(Boolean).join(' · ') || art);
}

/**
 * Pegel-Details im Sheet-Rahmen (Pegel-Sheet auf der Karte, Pegel-Fenster über Slipanlage und Gemerkt).
 * opts = { verlauf: Promise<pts>, onShare, onStern, eingebettet, wetter }
 */
export function pegelDetail(g, opts) {
  if (istTidepegel(g)) return tideDetail(g, opts);   // Tidepegel: Tidekurve und Einordnung statt MNW/MHW-Skala
  const z = zustand(g);
  // Zustand, Tendenz (2 h) und Änderung (24 h) in einer Zeile – aus derselben Messreihe wie das Diagramm
  const aend24 = h('b', { class: 'pd-24', text: '…' }), tend = h('b', { class: 'pd-2h', text: '…' });
  const alt = g.state === 'old';
  // Immer im Sheet-Rahmen (Pegel-Sheet, Pegel-Fenster): Name, Gewässer und × stehen im Kopf des Rahmens – hier km, Zeit, Wert, Zustand, Aktionen
  const kopf = h('div', { class: 'pd-oben' },
    h('p', { class: 'pd-ort' + (alt ? ' is-alt' : '') }, [kmText(g), alt ? `veraltet – ${formatTime(g.time)}` : formatTime(g.time)].filter(Boolean).join(' · ')),
    h('p', { class: 'pd-wert' }, grosserWert(g, alt), h('span', { text: g.unit })),
    h('p', { class: 'pd-zeile-kopf' }, h('span', { class: `pd-zdot ${ZUSTAND[z].cls}`, 'aria-hidden': 'true' }), h('b', { text: ZUSTAND[z].text.replace(/^ü/, 'Ü') }),
      alt ? null : h('span', { class: 'pd-tz' }, ' · 2 Std. ', tend, ' · 24 Std. ', aend24)),
    h('div', { class: 'pd-knoepfe' }, alarmKnopf(g), merkKnopf(g, opts.onStern),
      glasKnopf('pd-teilen', icon('share', 20), 'Teilen', { onclick: opts.onShare, 'aria-label': 'Pegel teilen' })));

  const body = h('div', { class: 'pd-body' });

  // Verlauf 24 h / 7 Tage / 30 Tage (30 Tage erst auf Wunsch laden); Vorhersage gestrichelt, wenn PEGELONLINE eine liefert
  const chart = h('div', { class: 'gauge-chart', 'aria-busy': 'true' }, h('p', { class: 'muted small', text: 'Verlauf wird geladen …' }));
  let bereich = opts.bereich === '24h' || opts.bereich === '30d' ? opts.bereich : '7d', alle = null, alle30 = null, wv = null, wvFertig = false, fehler30 = false;
  const vorhSatz = h('p', { class: 'pd-vorh-satz', hidden: true });
  const vorhInfo = h('p', { class: 'pd-vorh-info', hidden: true });
  const zeitpunkt = (t) => new Date(t).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const zeichnen = () => {
    const basis = bereich === '30d' ? alle30 : alle;
    if (!basis) {
      if (bereich === '30d' && fehler30) { chart.removeAttribute('aria-busy'); chart.replaceChildren(h('p', { class: 'unknown', text: '30-Tage-Verlauf konnte nicht geladen werden.' })); }
      else if (bereich === '30d') { chart.setAttribute('aria-busy', 'true'); chart.replaceChildren(h('p', { class: 'muted small', text: '30 Tage werden geladen …' })); }
      return;
    }
    const mitV = !!wv?.length;
    const cut = bereich === '24h' && basis.length ? basis[basis.length - 1].t - 24 * 3600e3 : -Infinity;   // leere Messreihe: kein Fehler
    const pts = basis.filter(p => p.t >= cut);
    chart.removeAttribute('aria-busy');
    if (pts.length < 2) { chart.replaceChildren(h('p', { class: 'unknown', text: 'Keine Messreihe verfügbar.' })); return; }
    chart.replaceChildren(...historyChart(pts, g, { vorhersage: mitV ? wv : null }));
    const satz = mitV ? vorhersageSatz(g, wv) : null;
    vorhSatz.hidden = !satz; vorhSatz.textContent = satz || '';
    if (mitV) {
      const bis = wv[wv.length - 1].t;
      vorhInfo.textContent = `Gestrichelt: Vorhersage der WSV bis ${zeitpunkt(bis)} Uhr${wv.some(p => p.art === 'estimate') ? ' (zum Ende nur Abschätzung)' : ''}.`;
      vorhInfo.hidden = false;
    }
  };
  const BEREICHE = { '24h': '24 Std.', '7d': '7 Tage', '30d': '30 Tage' };
  // Umschalter mit gleitender Markierung (Baustein seg, Designumbau 4); die Knöpfe tragen weiter data-bereich
  const umschalter = seg({ label: 'Zeitraum', wert: bereich, optionen: Object.entries(BEREICHE).map(([wert, text]) => ({ wert, text })), onWahl: (k) => waehle(k) });
  umschalter.classList.add('pd-umschalter');
  for (const b of umschalter.querySelectorAll('button')) b.dataset.bereich = b.dataset.wert;
  const waehle = (k) => {
        bereich = k;
        if (k === '30d' && !alle30) {
          fehler30 = false;
          verlauf30Laden(g.id).then((pts) => { alle30 = pts; if (bereich === '30d') zeichnen(); }, () => { fehler30 = true; if (bereich === '30d') zeichnen(); });
        }
        zeichnen();
  };
  body.append(h('section', { class: 'pd-karte pd-verlauf', 'aria-label': 'Verlauf' }, h('h2', { class: 'pd-ct', text: 'Verlauf' }), umschalter, chart, vorhInfo, vorhSatz));
  const vorhersage = vorhersageWLaden(g.id);
  vorhersage.then((v) => { wv = v; wvFertig = true; zeichnen(); });
  // „Passt mein Boot?“ und „Wetter und Wind“ (8.0.3, Nutzer): nicht im Vordergrund, sondern unten nach den Kennwerten
  const pmb = passtMeinBoot(g, { verlauf: opts.verlauf, vorhersage });
  if (bereich === '30d') verlauf30Laden(g.id).then((pts) => { alle30 = pts; zeichnen(); }, () => { fehler30 = true; zeichnen(); });
  opts.verlauf.then((pts) => {
    alle = pts; zeichnen();
    const d = aenderung24h(pts), t = tendenz(pts);
    aend24.textContent = aenderungKurz(d) || '–';
    tend.textContent = t ? aenderungKurz(t.d) : '–'; tend.title = tendenzTextKurz(t) || 'Keine Tendenz verfügbar';
  }, () => {
    aend24.textContent = '–'; tend.textContent = '–';
    if (bereich !== '30d') { chart.removeAttribute('aria-busy'); chart.replaceChildren(h('p', { class: 'unknown', text: 'Verlauf konnte nicht geladen werden.' })); }
  });

  // Einordnung, Abfluss/Wasser, Kennwerte
  body.append(einordnungKarte(g), zusatzKacheln(g));
  const kw = kennwerteKarte(g);
  if (kw) body.append(kw);
  body.append(pmb);
  if (opts.wetter) body.append(opts.wetter);


  // 8.0.3 (Nutzer): keine Liste mehr am Ende – nur die Quellenangabe als kleine Zeile (Lizenz WSV/PEGELONLINE)
  body.append(quelleZeile(g));
  return h('article', { class: `pd ${ZUSTAND[z].cls}` + (opts.eingebettet ? ' is-eingebettet' : ''), 'aria-labelledby': 'pd-name' }, kopf, body);
}

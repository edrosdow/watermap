// Bausteine für Pegel: Zustands-Etikett, Skala, Klartext, Kennwerte und das Pegel-Cockpit (Detailansicht).
// Zustand nach den amtlichen Kennwerten des jeweiligen Pegels (PEGELONLINE) – nicht nach dem eigenen Boot.
import { CONFIG } from './config.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { historyChart, formatTime } from './pegel.js';
import { aenderung24h, meinePegel, zusatzLaden, vorhersageWLaden, wtAenderungLaden, verlauf30Laden } from './pegel-daten.js';
import { vorhersageSatz } from './pegel-vorhersage.js';
import { einordnungSatz, tendenz, tendenzText as tendenzTextKurz, aenderungKurz, zonenLage, ZONEN } from './pegel-einordnung.js';
import { pegelBild, bildTeilen } from './pegel-bild.js';
import { alarmFenster, alarmStatus } from './alarm.js';
import { istTidepegel } from './gezeiten.js';
import { tideDetail } from './pegel-tide-ansicht.js';
import { passtMeinBoot } from './passt-mein-boot.js';

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
export const trendKlasse = (g) => (g.trend === 1 ? 'pt-up' : g.trend === -1 ? 'pt-down' : 'pt-flat');

/** Erklärsatz aus den vorhandenen Kennwerten (pegel-einordnung.js); ohne Kennwerte ein Hinweis. */
export function klartext(g) {
  return einordnungSatz(g) || 'Für diesen Pegel gibt es keine amtlichen Kennwerte – eine Einordnung ist nicht möglich.';
}

const KW = ['MNW', 'MW', 'MHW', 'HSW'];
export const KW_NAME = { MNW: 'Mittleres Niedrigwasser', MW: 'Mittelwasser', MHW: 'Mittleres Hochwasser', HSW: 'Höchster Schifffahrtswasserstand' };

const KURZNAME = { NNW: 'niedrigster', MNW: 'mittl. Niedrigwasser', MW: 'Mittelwasser', MHW: 'mittl. Hochwasser', HHW: 'höchster', HSW: 'höchster Schifffahrtsw.' };

/** Karte „Einordnung“: Zustand groß, Balken Niedrig · Normal · Hoch mit Punkt (nur mit MNW und MHW), darunter die Grenzen. */
export function einordnungKarte(g) {
  const z = zustand(g), lage = g.state === 'old' ? null : zonenLage(g.refs, g.value);
  return h('section', { class: 'pd-karte pd-einordnung', 'aria-label': 'Einordnung' },
    h('h2', { class: 'pd-ct', text: 'Einordnung' }),
    h('p', { class: `pd-zst ${ZUSTAND[z].cls}` }, h('i', { 'aria-hidden': 'true' }), ZUSTAND[z].text.replace(/^ü/, 'Ü')),
    lage ? h('div', { class: 'pd-zonen', role: 'img', 'aria-label': `${fmt(g.value)} ${g.unit}: ${{ low: 'unter MNW', normal: 'zwischen MNW und MHW', high: 'über MHW' }[lage.zone]}. MNW ${fmt(g.refs.MNW)}, MHW ${fmt(g.refs.MHW)} ${g.unit}.` },
      h('div', { class: 'pd-zbalken' }, ZONEN.map((w, i) => h('span', { class: `pd-z${i}`, style: `width:${w}%` })),
        h('span', { class: 'pd-zmark', style: `left:${lage.pos.toFixed(2)}%` }, h('b', { text: `${fmt(g.value)} ${g.unit}` }), h('i'))),
      h('div', { class: 'pd-znamen' }, ['Niedrig', 'Normal', 'Hoch'].map((t, i) => h('span', { class: ['low', 'normal', 'high'][i] === lage.zone ? 'is-an' : '', style: `width:${ZONEN[i]}%`, text: t }))),
      h('div', { class: 'pd-zgrenzen' }, h('span', { style: `left:${ZONEN[0]}%`, text: `MNW ${fmt(g.refs.MNW)}` }), h('span', { style: `left:${ZONEN[0] + ZONEN[1]}%`, text: `MHW ${fmt(g.refs.MHW)}` })))
      : null);
}

/** Karte „Kennwerte“: Kürzel, kurze Bezeichnung, Wert (alle von PEGELONLINE gelieferten; bis dahin die Hauptwerte). null ohne Kennwerte. */
export function kennwerteKarte(g) {
  const keys = KW.filter(k => g.refs[k] !== undefined);
  if (!keys.length) return null;
  const zeile = (k, name, v) => h('li', {}, h('b', { text: k }), h('span', { text: KURZNAME[k] || name }), h('strong', { text: `${fmt(v)} ${g.unit}` }));
  const liste = h('ul', { class: 'pd-kwl' }, keys.map(k => ({ k, v: g.refs[k] })).sort((a, b) => a.v - b.v).map(({ k, v }) => zeile(k, KW_NAME[k], v)));
  zusatzLaden(g.id).then((z) => { if (z?.kennwerte?.length) liste.replaceChildren(...z.kennwerte.map(c => zeile(c.k, c.name, c.v))); });
  return h('section', { class: 'pd-karte pd-kennwerte', 'aria-label': 'Kennwerte' }, h('h2', { class: 'pd-ct', text: 'Kennwerte' }), liste);
}

/** Station und Quelle (aufklappbar in der Liste). */
export function stammdaten(g) {
  const zeilen = [['Gewässer', g.water], ['Flusskilometer', g.km !== null && g.km !== undefined ? g.km.toLocaleString('de-DE', { maximumFractionDigits: 3 }) : null],
    ['Pegelnummer', g.number], ['Zuständig', g.agency], ['Letzte Messung', g.time ? formatTime(g.time) : null]].filter(([, v]) => v);
  return h('details', { class: 'pd-zeile pd-stamm' }, h('summary', {}, h('span', { html: icon('info', 18), 'aria-hidden': 'true' }), 'Station und Quelle'),
    h('dl', { class: 'pd-kw-liste' }, zeilen.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: String(v) })])),
    h('p', { class: 'pd-hinweis', text: 'Daten: WSV/PEGELONLINE. Der Pegel ist nicht die Wassertiefe; Niedrig/Normal/Hoch beziehen sich auf die Kennwerte dieses Pegels (MNW, MW, MHW sind Mittelwerte, keine Warnstufen).' }),
    g.number ? h('a', { class: 'pd-link', href: `https://www.pegelonline.wsv.de/gast/stammdaten?pegelnr=${encodeURIComponent(g.number)}`, target: '_blank', rel: 'noopener noreferrer', text: 'Pegel bei PEGELONLINE ↗' }) : null);
}

export function sternKnopf(g, { klein = false, onChange } = {}) {
  const an = meinePegel.hat(g.id);
  const b = h('button', { type: 'button', class: 'pm-stern' + (klein ? ' is-klein' : '') + (an ? ' is-on' : ''), 'aria-pressed': String(an),
    'aria-label': an ? `${g.name} aus „Meine Pegel“ entfernen` : `${g.name} zu „Meine Pegel“ hinzufügen`, html: icon('star', klein ? 20 : 24, an) });
  b.onclick = (e) => { e.stopPropagation(); meinePegel.umschalten(g.id); onChange?.(); };
  return b;
}


const fmt1 = (v) => v.toLocaleString('de-DE', { maximumFractionDigits: 1 });
const signiert = (v, e) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${fmt1(Math.abs(v))} ${e}`;
/** Kurztexte für Etiketten: „Wasser 13 °C“, „Abfluss 624 m³/s“ (nur was der Pegel liefert). */
export const zusatzEtiketten = (z) => [z?.wt ? `Wasser ${fmt1(Math.round(z.wt.v * 10) / 10)} °C` : null, z?.q ? `Abfluss ${fmt(z.q.v)} m³/s` : null].filter(Boolean);

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
  knopf.onclick = (e) => { e.stopPropagation(); meinePegel.umschalten(g.id); onChange?.(); };
  return knopf;
}

/** Zeile „Als Bild teilen“: Bild mit Wert, Zustand und Kurve erzeugen und teilen bzw. herunterladen. */
function bildZeile(g, daten) {
  return h('button', { type: 'button', class: 'pd-zeile pd-bild', onclick: async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    try {
      const { pts, wv } = await daten();
      const cv = pegelBild({ g, zustand: zustand(g), trend: trendText(g), pts: (pts || []).filter(p => p.t >= (pts?.[pts.length - 1]?.t ?? 0) - 7 * 864e5), wv: wv || [] });
      await bildTeilen(cv, `Pegel-${g.name.replace(/[^\p{L}\p{N}]+/gu, '-')}.png`, `Pegel ${g.name}`);
    } catch { /* ohne Bild bleibt alles, wie es war */ } finally { btn.disabled = false; }
  } }, h('span', { html: icon('image', 18), 'aria-hidden': 'true' }), 'Als Bild teilen');
}

/** Zeile „Weser · KM 201,4“ in der Kopfleiste; die Art („Pegel“/„Tidepegel“) nur für Screenreader (Etikett zeigt sie sichtbar). */
export function kicker(art, g) {
  return h('p', { class: 'pd-kicker' }, h('span', { class: 'sr-only', text: `${art} · ` }),
    [g.water, kmText(g).replace('km', 'KM')].filter(Boolean).join(' · ') || art);
}

/**
 * Pegel-Details im Sheet-Rahmen (Pegel-Sheet auf der Karte, Pegel-Fenster über Slipanlage und Gemerkt).
 * opts = { verlauf: Promise<pts>, onShare, onKarte, slips: [{p, d}], onSlip(p), onStern, eingebettet, wetter }
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
    h('p', { class: 'pd-wert' }, h('strong', { text: fmt(g.value) }), h('span', { text: g.unit })),
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
    const cut = bereich === '24h' ? basis[basis.length - 1].t - 24 * 3600e3 : -Infinity;
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
  const umschalter = h('div', { class: 'pd-umschalter', role: 'group', 'aria-label': 'Zeitraum' },
    Object.entries(BEREICHE).map(([k, text]) => h('button', { type: 'button', 'aria-pressed': String(k === bereich), dataset: { bereich: k }, text,
      onclick: () => {
        bereich = k; for (const b of umschalter.children) b.setAttribute('aria-pressed', String(b.dataset.bereich === k));
        if (k === '30d' && !alle30) {
          fehler30 = false;
          verlauf30Laden(g.id).then((pts) => { alle30 = pts; if (bereich === '30d') zeichnen(); }, () => { fehler30 = true; if (bereich === '30d') zeichnen(); });
        }
        zeichnen();
      } })));
  body.append(h('section', { class: 'pd-karte pd-verlauf', 'aria-label': 'Verlauf' }, h('h2', { class: 'pd-ct', text: 'Verlauf' }), umschalter, chart, vorhInfo, vorhSatz));
  const vorhersage = vorhersageWLaden(g.id);
  vorhersage.then((v) => { wv = v; wvFertig = true; zeichnen(); });
  // „Passt mein Boot?“ (Designumbau 2b): direkt unter der Aktionsleiste, vor dem Verlauf
  body.prepend(passtMeinBoot(g, { verlauf: opts.verlauf, vorhersage }));
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

  // Wetter am Pegel (nur im Kartenpanel)
  if (opts.wetter) { opts.wetter.classList.add('pd-karte', 'pd-wetter'); body.append(opts.wetter); }

  // Liste: Als Bild teilen, Slipanlagen, Station und Quelle
  const zeilen = [
    bildZeile(g, async () => ({ pts: await opts.verlauf.catch(() => []), wv: await vorhersage })),
  ];
  if (opts.slips || opts.onKarte) {
    zeilen.push(h('details', { class: 'pd-zeile pd-slipbox' }, h('summary', {}, h('span', { html: icon('pin', 18), 'aria-hidden': 'true' }), 'Slipanlagen in der Nähe', opts.slips?.length ? h('em', { text: String(opts.slips.length) }) : null),
      opts.slips?.length
        ? h('ul', { class: 'pd-slips' }, opts.slips.map(({ p, d, name }) => h('li', {}, h('button', { type: 'button', onclick: () => opts.onSlip?.(p) },
          h('span', { class: 'pd-slip-name', text: name }), h('span', { class: 'pd-slip-km', text: d < 1000 ? `${Math.round(d / 10) * 10} m` : `${(d / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} km` })))))
        : h('p', { class: 'pd-leer', text: 'Keine Slipanlage am selben Gewässer in der Nähe bekannt.' }),
      opts.onKarte ? h('button', { type: 'button', class: 'pd-link', onclick: opts.onKarte, text: 'Auf der Hauptkarte zeigen ›' }) : null));
  }
  zeilen.push(stammdaten(g));
  body.append(h('section', { class: 'pd-karte pd-liste', 'aria-label': 'Weiteres' }, zeilen));
  return h('article', { class: `pd ${ZUSTAND[z].cls}` + (opts.eingebettet ? ' is-eingebettet' : ''), 'aria-labelledby': 'pd-name' }, kopf, body);
}

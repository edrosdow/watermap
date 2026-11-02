// Bausteine für Pegel: Zustands-Etikett, Skala, Klartext, Kennwerte und das Pegel-Cockpit (Detailansicht).
// Zustand nach den amtlichen Kennwerten des jeweiligen Pegels (PEGELONLINE) – nicht nach dem eigenen Boot.
import { CONFIG } from './config.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { historyChart, formatTime } from './pegel.js';
import { aenderung24h, meinePegel, zusatzLaden, vorhersageWLaden, wtAenderungLaden, verlauf30Laden } from './pegel-daten.js';
import { vorhersageSatz } from './pegel-vorhersage.js';
import { einordnungSatz, einordnungKurz, skalaLage, tendenz, tendenzText as tendenzTextKurz, aenderungKurz } from './pegel-einordnung.js';
import { pegelBild, bildTeilen } from './pegel-bild.js';
import { alarmFenster, alarmStatus } from './alarm.js';
import { istTidepegel } from './gezeiten.js';
import { tideDetail } from './pegel-tide-ansicht.js';

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
  hsw:     { text: 'über HSW',       farbe: '#D03B3B', cls: 'pz-hsw' },
  high:    { text: 'Hoch',           farbe: '#EC835A', cls: 'pz-high' },
  normal:  { text: 'Normal',         farbe: '#6CBF84', cls: 'pz-normal' },
  low:     { text: 'Niedrig',        farbe: '#FAB219', cls: 'pz-low' },
  tide:    { text: 'Tide',           farbe: '#9CCEE3', cls: 'pz-tide' },
  none:    { text: 'ohne Kennwerte', farbe: '#DCE5EA', cls: 'pz-none' },
  unknown: { text: 'ohne Einordnung', farbe: '#DCE5EA', cls: 'pz-none' },
  old:     { text: 'veraltet',       farbe: '#DCE5EA', cls: 'pz-old' },
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

/**
 * „Alle Kennwerte anzeigen“ (eingeklappt): alle Kennwerte des Pegels mit amtlichem Namen aus PEGELONLINE, nach Wert sortiert;
 * bis die geladen sind (oder ohne Verbindung) die vier Hauptwerte. null ohne Kennwerte.
 */
export function kennwerteListe(g) {
  const keys = KW.filter(k => g.refs[k] !== undefined);
  if (!keys.length) return null;
  const zeile = (k, name, v, zusatz) => [h('dt', {}, h('b', { text: k }), ' ', h('span', { class: 'pd-kw-name', text: name + (zusatz ? ` (${zusatz})` : '') })),
    h('dd', { text: `${fmt(v)} ${g.unit}` })];
  const liste = h('dl', { class: 'pd-kw-liste' }, keys.map(k => ({ k, v: g.refs[k] })).sort((a, b) => a.v - b.v).flatMap(({ k, v }) => zeile(k, KW_NAME[k], v)));
  const box = h('details', { class: 'pd-kw' },
    h('summary', { text: 'Alle Kennwerte anzeigen' }), liste,
    h('p', { class: 'pd-kw-hinweis', text: 'Kennwerte und Marken laut PEGELONLINE. Statistische Werte (z. B. MNW, MW, MHW) sind Mittelwerte über eine Zeitspanne – keine Warnstufen.' }));
  zusatzLaden(g.id).then((z) => {
    if (!z?.kennwerte?.length) return;
    liste.replaceChildren(...z.kennwerte.flatMap(c => zeile(c.k, c.name === c.k && KW_NAME[c.k] ? KW_NAME[c.k] : c.name, c.v, c.zeitraum || c.datum)));
  });
  return box;
}

/** Messstation und Datenquelle (Gewässer, Flusskilometer, Pegelnummer, zuständige Stelle, Link, Hinweise). */
function stammdaten(g) {
  const zeilen = [['Gewässer', g.water], ['Flusskilometer', g.km !== null && g.km !== undefined ? g.km.toLocaleString('de-DE', { maximumFractionDigits: 3 }) : null],
    ['Pegelnummer', g.number], ['Zuständig', g.agency], ['Letzte Messung', g.time ? formatTime(g.time) : null]].filter(([, v]) => v);
  return h('section', { class: 'pd-karte pd-stamm' }, h('h2', { text: 'Messstation und Quelle' }),
    h('dl', { class: 'pd-kw-liste' }, zeilen.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: String(v) })])),
    g.number ? h('p', { class: 'pd-kw-hinweis' }, h('a', { href: `https://www.pegelonline.wsv.de/gast/stammdaten?pegelnr=${encodeURIComponent(g.number)}`, target: '_blank', rel: 'noopener noreferrer', text: 'Pegel bei PEGELONLINE ansehen ↗' })) : null,
    h('p', { class: 'pd-hinweis', text: 'Daten: WSV/PEGELONLINE, soweit der Pegel sie liefert. Normal/Niedrig/Hoch beziehen sich auf die statistischen Kennwerte dieses Pegels, nicht auf dein Boot. Der Pegel ist nicht die Wassertiefe – aus einem Pegelstand folgt keine Aussage zur Befahrbarkeit.' }));
}

/**
 * Skala der Kennwerte, maßstabsgetreu nach ihren Zahlenwerten (Lage aus skalaLage()): MNW, MW, MHW unten, HSW (Schifffahrt, ⚓) oben.
 * Dezente Flächen, keine Warnfarben; Punkt = aktueller Wasserstand. Weniger als 2 Kennwerte → null (keine kaputte Skala).
 */
export function skala(g) {
  const lage = skalaLage(g.refs, g.value);
  if (!lage) return null;
  const label = `Aktuell ${fmt(g.value)} ${g.unit}. ` + lage.punkte.map(p => `${p.k} ${fmt(p.v)} ${g.unit}`).join(', ') + '.';
  const mnw = lage.punkte.find(p => p.k === 'MNW'), mhw = lage.punkte.find(p => p.k === 'MHW');
  const band = mnw && mhw ? h('span', { class: 'ps-band', style: `left:${mnw.pos.toFixed(2)}%;width:${(mhw.pos - mnw.pos).toFixed(2)}%` }) : null;
  return h('div', { class: 'ps ps-neu' + (lage.punkte.some(p => p.oben) ? ' mit-oben' : ''), role: 'img', 'aria-label': label },
    h('div', { class: 'ps-labels ps-oben' }, lage.punkte.filter(p => p.oben).map(p => h('span', { style: `left:${p.label.toFixed(2)}%`, title: KW_NAME[p.k], class: 'is-hsw' },
      h('span', { text: `${p.k} ⚓` }), h('b', { text: fmt(p.v) })))),
    h('div', { class: 'ps-track' }, band,
      lage.punkte.map(p => h('span', { class: 'ps-tick' + (p.oben ? ' is-hsw' : ''), style: `left:${p.pos.toFixed(2)}%` })),
      h('span', { class: 'ps-mark', style: `left:${lage.wert.toFixed(2)}%` })),
    h('div', { class: 'ps-labels' }, lage.punkte.filter(p => !p.oben).map(p => h('span', { style: `left:${p.label.toFixed(2)}%`, title: KW_NAME[p.k] },
      h('span', { text: p.k }), h('b', { text: fmt(p.v) })))));
}

/** Pegel-Einordnung kompakt: aktueller Wert und Abstand, Skala, Erklärsatz, „Alle Kennwerte anzeigen“. */
export function einordnungKarte(g) {
  const kurz = einordnungKurz(g);
  return h('section', { class: 'pd-karte pd-einordnung' },
    h('div', { class: 'pd-karte-kopf' }, h('h2', { text: 'Pegel-Einordnung' }), etikett(g)),
    kurz ? h('p', { class: 'pd-ein-kurz' }, h('strong', { text: `${fmt(g.value)} ${g.unit}` }), ` · ${kurz}`) : null,
    skala(g),
    h('p', { class: 'pd-klartext', text: klartext(g) }),
    g.refs.HSW !== undefined ? h('p', { class: 'pd-kw-hinweis', text: '⚓ HSW = höchster Schifffahrtswasserstand: Bezugswert der Schifffahrt, keine Hochwasser-Warnstufe.' }) : null,
    kennwerteListe(g));
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
    if (z.wt) {
      const sub = h('p', { class: 'pd-z-sub', text: '' });
      kacheln.push(h('div', { class: 'pd-z is-wt' }, h('p', { class: 'pd-z-titel' }, h('span', { html: icon('thermo', 16), 'aria-hidden': 'true' }), 'Wassertemperatur'),
        h('p', { class: 'pd-z-wert' }, h('strong', { text: fmt1(Math.round(z.wt.v * 10) / 10) }), h('span', { text: ' °C' })), sub));
      wtAenderungLaden(g.id).then((d) => { if (d !== null) sub.textContent = `${signiert(d, '°C')} seit gestern`; });
    }
    if (z.q) {
      kacheln.push(h('div', { class: 'pd-z is-q' }, h('p', { class: 'pd-z-titel' }, h('span', { html: icon('welle', 16), 'aria-hidden': 'true' }), 'Abfluss'),
        h('p', { class: 'pd-z-wert' }, h('strong', { text: fmt(z.q.v) }), h('span', { text: ' m³/s' })),
        h('p', { class: 'pd-z-sub', text: 'Wassermenge je Sekunde am Pegel' })));
    }
    if (!kacheln.length) return;
    box.replaceChildren(...kacheln); box.hidden = false;
  });
  return box;
}

/** Zeile „Pegel-Alarm“ mit Status („Push, wenn unter 100 cm · aktiv“ bzw. „Benachrichtigen lassen“); öffnet das Alarm-Fenster. */
function alarmZeile(g) {
  const sub = h('small', {});
  const stellen = () => { sub.textContent = alarmStatus(g.id) || 'Benachrichtigen lassen'; };
  stellen();
  const knopf = h('button', { type: 'button', class: 'pd-alarm', 'aria-haspopup': 'dialog', onclick: (e) => alarmFenster(g, { opener: e.currentTarget }) },
    h('span', { class: 'pd-alarm-ico', html: icon('bell', 20), 'aria-hidden': 'true' }),
    h('span', { class: 'pd-alarm-text' }, h('strong', { text: 'Pegel-Alarm' }), sub),
    h('span', { class: 'pd-alarm-pfeil', text: alarmStatus(g.id) ? 'Ändern' : '', 'aria-hidden': 'true' }), h('span', { class: 'pd-alarm-chev', html: icon('chevron', 18), 'aria-hidden': 'true' }));
  const neu = () => { if (!knopf.isConnected) { document.removeEventListener('pegel-alarme', neu); return; } stellen(); knopf.querySelector('.pd-alarm-pfeil').textContent = alarmStatus(g.id) ? 'Ändern' : ''; };
  document.addEventListener('pegel-alarme', neu);
  return knopf;
}

/** Knopf „Als Bild teilen“: Bild mit Wert, Zustand und Kurve erzeugen und teilen bzw. herunterladen. */
function bildKachel(g, daten) {
  return h('button', { type: 'button', class: 'pd-kachel pd-bild', onclick: async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    try {
      const { pts, wv } = await daten();
      const cv = pegelBild({ g, zustand: zustand(g), trend: trendText(g), pts: (pts || []).filter(p => p.t >= (pts?.[pts.length - 1]?.t ?? 0) - 7 * 864e5), wv: wv || [] });
      await bildTeilen(cv, `Pegel-${g.name.replace(/[^\p{L}\p{N}]+/gu, '-')}.png`, `Pegel ${g.name}`);
    } catch { /* ohne Bild bleibt alles, wie es war */ } finally { btn.disabled = false; }
  } }, h('strong', { text: 'Als Bild teilen' }), h('span', { text: 'z. B. in die Vereinsgruppe ›' }));
}

/** Zeile „Weser · KM 201,4“ in der Kopfleiste; die Art („Pegel“/„Tidepegel“) nur für Screenreader (Etikett zeigt sie sichtbar). */
export function kicker(art, g) {
  return h('p', { class: 'pd-kicker' }, h('span', { class: 'sr-only', text: `${art} · ` }),
    [g.water, kmText(g).replace('km', 'KM')].filter(Boolean).join(' · ') || art);
}

/**
 * Pegel-Detailseite (Dashboard, Sheet auf dem Handy, rechtes Panel am Desktop).
 * opts = { verlauf: Promise<pts>, onBack, backLabel, onShare, onAmpel, onKarte, slips: [{p, d}], onSlip(p), onStern, eingebettet, wetter }
 */
export function pegelDetail(g, opts) {
  if (istTidepegel(g)) return tideDetail(g, opts);   // Tidepegel: Tidekurve und Einordnung statt MNW/MHW-Skala
  const z = zustand(g);
  const titel = h('h1', { class: 'pd-name', id: 'pd-name', tabindex: '-1', text: g.name });
  // Änderung in 24 h und kurzfristige Tendenz (2 h) getrennt – beides aus derselben Messreihe wie das Diagramm
  const aend24 = h('strong', { class: 'pt-flat', text: '…' }), tend = h('strong', { class: 'pt-flat', text: '…' });
  const felder = g.state === 'old' ? null : h('div', { class: 'pd-tz' },
    h('div', {}, h('span', { text: 'Änderung 24 h' }), aend24),
    h('div', {}, h('span', { text: 'Tendenz (letzte 2 h)' }), tend));
  const kopf = h('header', { class: 'pd-kopf' },
    h('div', { class: 'pd-leiste' },
      h('button', { type: 'button', class: 'pd-icon', 'aria-label': opts.backLabel || 'Zurück', html: icon(opts.eingebettet ? 'close' : 'back', 24), onclick: opts.onBack }),
      kicker('Pegel', g),
      h('button', { type: 'button', class: 'pd-icon', 'aria-label': 'Pegel teilen', html: icon('share', 22), onclick: opts.onShare }),
      sternKnopf(g, { onChange: opts.onStern })),
    titel,
    h('div', { class: 'pd-wertzeile' },
      h('p', { class: 'pd-wert' }, h('strong', { text: fmt(g.value) }), h('span', { text: g.unit })),
      h('div', { class: 'pd-wertinfo' }, etikett(g),
        h('p', { class: 'pd-zeit' + (g.state === 'old' ? ' is-alt' : '') },
          g.state === 'old' ? h('span', { html: icon('clock', 15) }) : null,
          g.state === 'old' ? `Veraltet – gemessen ${formatTime(g.time)}` : `Gemessen ${formatTime(g.time)}`))),
    felder);

  const body = h('div', { class: 'pd-body' });

  // Verlauf 24 h / 7 Tage / 30 Tage (30 Tage erst auf Wunsch laden); Vorhersage gestrichelt, wenn PEGELONLINE eine liefert
  const chart = h('div', { class: 'gauge-chart', 'aria-busy': 'true' }, h('p', { class: 'muted small', text: 'Verlauf wird geladen …' }));
  const stats = h('div', { class: 'pd-stats' });
  let bereich = opts.bereich === '24h' || opts.bereich === '30d' ? opts.bereich : '7d', alle = null, alle30 = null, wv = null, wvFertig = false, fehler30 = false;
  const vorhSatz = h('p', { class: 'pd-vorh-satz', hidden: true });
  const vorhInfo = h('p', { class: 'pd-vorh-info', hidden: true });
  const titelV = h('h2', { text: 'Verlauf' });
  const zeitpunkt = (t) => new Date(t).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const zeichnen = () => {
    const basis = bereich === '30d' ? alle30 : alle;
    if (!basis) {
      if (bereich === '30d' && fehler30) { chart.removeAttribute('aria-busy'); chart.replaceChildren(h('p', { class: 'unknown', text: '30-Tage-Verlauf konnte nicht geladen werden.' })); stats.replaceChildren(); }
      else if (bereich === '30d') { chart.setAttribute('aria-busy', 'true'); chart.replaceChildren(h('p', { class: 'muted small', text: '30 Tage werden geladen …' })); }
      return;
    }
    const mitV = !!wv?.length;
    titelV.textContent = mitV ? 'Verlauf und Vorhersage' : 'Verlauf';
    const cut = bereich === '24h' ? basis[basis.length - 1].t - 24 * 3600e3 : -Infinity;
    const pts = basis.filter(p => p.t >= cut);
    chart.removeAttribute('aria-busy');
    if (pts.length < 2) { chart.replaceChildren(h('p', { class: 'unknown', text: 'Keine Messreihe verfügbar.' })); stats.replaceChildren(); return; }
    chart.replaceChildren(...historyChart(pts, g, { vorhersage: mitV ? wv : null }));
    const satz = mitV ? vorhersageSatz(g, wv) : null;
    vorhSatz.hidden = !satz; vorhSatz.textContent = satz || '';
    if (mitV) {
      const bis = wv[wv.length - 1].t;
      vorhInfo.textContent = `Gestrichelt: Vorhersage der WSV bis ${zeitpunkt(bis)} Uhr – berechnet, keine Messung${wv.some(p => p.art === 'estimate') ? ', zum Ende hin nur Abschätzung' : ''}.`;
      vorhInfo.hidden = false;
    } else if (wvFertig) { vorhInfo.textContent = 'Für diesen Pegel liefert PEGELONLINE keine Vorhersage.'; vorhInfo.hidden = false; }
    const vs = pts.map(p => p.v); const d = pts[pts.length - 1].v - pts[0].v;
    const kachel = (l, v, cls = '') => h('div', { class: 'pd-stat' }, h('span', { text: l }), h('strong', { class: cls, text: v }));
    stats.replaceChildren(kachel('Höchster', `${fmt(Math.max(...vs))} ${g.unit}`), kachel('Tiefster', `${fmt(Math.min(...vs))} ${g.unit}`),
      kachel('Änderung', `${d > 0 ? '+' : d < 0 ? '−' : '±'}${fmt(Math.abs(d))} ${g.unit}`, d < 0 ? 'is-minus' : d > 0 ? 'is-plus' : ''));
  };
  const BEREICHE = { '24h': '24 h', '7d': '7 Tage', '30d': '30 Tage' };
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
  body.append(h('section', { class: 'pd-karte pd-verlauf' }, h('div', { class: 'pd-karte-kopf' }, titelV, umschalter), chart, vorhInfo, vorhSatz, stats));
  const vorhersage = vorhersageWLaden(g.id);
  vorhersage.then((v) => { wv = v; wvFertig = true; zeichnen(); });
  if (bereich === '30d') verlauf30Laden(g.id).then((pts) => { alle30 = pts; zeichnen(); }, () => { fehler30 = true; zeichnen(); });
  opts.verlauf.then((pts) => {
    alle = pts; zeichnen();
    const d = aenderung24h(pts), t = tendenz(pts);
    aend24.textContent = aenderungKurz(d) || 'nicht verfügbar'; aend24.className = d > 0 ? 'pt-up' : d < 0 ? 'pt-down' : 'pt-flat';
    tend.textContent = tendenzTextKurz(t) || 'Keine Tendenz verfügbar'; tend.className = t?.richtung === 1 ? 'pt-up' : t?.richtung === -1 ? 'pt-down' : 'pt-flat';
  }, () => {
    aend24.textContent = 'nicht verfügbar'; tend.textContent = 'Keine Tendenz verfügbar';
    if (bereich !== '30d') { chart.removeAttribute('aria-busy'); chart.replaceChildren(h('p', { class: 'unknown', text: 'Verlauf konnte nicht geladen werden.' })); }
  });

  // Einordnung (kompakt, Kennwerte aufklappbar), weitere Messwerte
  body.append(einordnungKarte(g), zusatzKacheln(g));

  // Pegel-Alarm und Kacheln
  body.append(alarmZeile(g));
  body.append(h('div', { class: 'pd-kacheln' },
    h('a', { class: 'pd-kachel is-dunkel', href: `./pegel-ampel?pegel=${encodeURIComponent(g.id)}`, onclick: opts.onAmpel },
      h('strong', { text: 'Passt mein Boot?' }), h('span', { text: 'In Pegel-Ampel prüfen ›' })),
    opts.onKarte ? h('button', { type: 'button', class: 'pd-kachel', onclick: opts.onKarte },
      h('strong', { text: 'Auf der Karte' }), h('span', { text: 'mit Slipanlagen in der Nähe ›' })) : null,
    bildKachel(g, async () => ({ pts: await opts.verlauf.catch(() => []), wv: await vorhersage }))));

  // Wetter am Pegel (nur im Kartenpanel)
  if (opts.wetter) { opts.wetter.classList.add('pd-karte', 'pd-wetter'); body.append(opts.wetter); }

  // Slipanlagen an diesem Pegel
  if (opts.slips) {
    body.append(h('section', { class: 'pd-karte' }, h('h2', { text: 'Slipanlagen an diesem Pegel' }),
      opts.slips.length
        ? h('ul', { class: 'pd-slips' }, opts.slips.map(({ p, d, name }) => h('li', {}, h('button', { type: 'button', onclick: () => opts.onSlip?.(p) },
          h('span', { class: 'pd-slip-name', text: name }), h('span', { class: 'pd-slip-km', text: d < 1000 ? `${Math.round(d / 10) * 10} m` : `${(d / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} km` })))))
        : h('p', { class: 'muted', text: 'Keine Slipanlage am selben Gewässer in der Nähe bekannt.' })));
  }
  body.append(stammdaten(g));
  body.append(h('p', { class: 'pd-hinweis', text: 'Kennwerte, Messungen, Wassertemperatur, Abfluss und Vorhersage: WSV/PEGELONLINE, soweit der Pegel sie liefert. Normal/Niedrig/Hoch beziehen sich auf die amtlichen Kennwerte dieses Pegels, nicht auf dein Boot. Der Pegel ist nicht die Wassertiefe.' }));
  return h('article', { class: `pd ${ZUSTAND[z].cls}` + (opts.eingebettet ? ' is-eingebettet' : ''), 'aria-labelledby': 'pd-name' }, kopf, body);
}

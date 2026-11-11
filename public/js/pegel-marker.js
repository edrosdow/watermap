// Pegel auf der Hauptkarte (Designumbau Phase 2a, 7.70.0): EIN Marker für alle Pegel – Wert-Pille nach dem Prototyp.
// Farbe des Punkts nur, wenn der Pegel amtliche Kennwerte hat (MNW/MHW), sonst neutral grau. Tidepegel mit Welle statt Punkt.
// Viele Pegel → Cluster bis ZOOM_OHNE_CLUSTER; unter ZOOM_MIT_ZAHL nur Punkte (Klasse .pk-kompakt am Kartenbehälter).
import { fmt, zustand } from './pegel-ansicht.js';

// Ampel nach den Kennwerten DIESES Pegels: normal grün, unter MNW gelb-orange, über MHW rot, über HSW dunkelrot, ohne Kennwerte grau
export const FARBE = { low: 'var(--wm-warn)', normal: 'var(--wm-gut)', high: 'var(--wm-hoch)', hsw: 'var(--wm-stop)', neutral: 'var(--wm-leise)' };
export const PFEIL = { 1: '↗', 0: '→', '-1': '↘' };
export const PFEIL_WORT = { 1: 'steigend', 0: 'gleichbleibend', '-1': 'fallend' };
const MIT_FARBE = new Set(['low', 'normal', 'high', 'hsw']);
const WELLE = '<svg class="pk-welle" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M2 9c3-3 5 3 8 0s5 3 8 0 3 2 4 1M2 16c3-3 5 3 8 0s5 3 8 0 3 2 4 1"/></svg>';
export const ZOOM_MIT_ZAHL = 8;
export const ZOOM_OHNE_CLUSTER = 10;
export const ZOOM_AUSWAHL = 11;

/** Legende (Wort + Farbe) – für die aufklappbare Pille unten links. */
export const LEGENDE = [['zwischen MNW und MHW', FARBE.normal], ['unter MNW', FARBE.low], ['über MHW', FARBE.high], ['über HSW', FARBE.hsw], ['ohne Kennwerte', FARBE.neutral]];

/** Marker-HTML einer Pille: „● 245 cm ↗“ (Pfeil = Tendenz laut PEGELONLINE); nur feste Strings und Zahlen. */
export function pillenHtml(g, { gewaehlt = false, gemerkt = false } = {}) {
  const z = zustand(g);
  const farbe = MIT_FARBE.has(z) ? FARBE[z] : FARBE.neutral;
  const punkt = g.tide ? WELLE : '<b></b>';
  const pfeil = g.state !== 'old' && !g.tide && PFEIL[g.trend] ? `<em class="pk-pfeil">${PFEIL[g.trend]}</em>` : '';
  const kl = `pk-pille is-${g.tide ? 'tide' : z}${g.state === 'old' ? ' is-old' : ''}${gewaehlt ? ' is-gewaehlt' : ''}${gemerkt ? ' is-gemerkt' : ''}`;
  return `<span class="${kl}" style="--pk:${farbe}">${punkt}<span class="pk-zahl">${fmt(g.value)}<small> ${g.unit === 'cm' ? 'cm' : ''}</small></span>${pfeil}${gemerkt ? '<i class="pk-stern" aria-hidden="true">★</i>' : ''}</span>`;
}

/** Name für Screenreader und Tooltip: „Pegel Vlotho, 182 cm, fallend“. */
export function pegelTitel(g) {
  return `Pegel ${g.name}, ${fmt(g.value)} ${g.unit}${g.state !== 'old' && PFEIL_WORT[g.trend] ? `, ${PFEIL_WORT[g.trend]}` : ''}`;
}

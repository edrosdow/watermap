// Bewegung (Designumbau Phase 4, 7.73.0): kleine Helfer für die Animationen aus dem Prototyp.
// Dauern und Kurven nur aus den Tokens (tokens.css: --wm-kurz/mittel/lang, --wm-feder/sanft); bewegt werden nur transform und opacity
// (Ausnahme laut Auftrag: die Breite der Suchpille). Bei „Bewegung reduzieren“ geschieht alles sofort: kein Flug, kein Zählen, keine Verzögerung.
import { icon } from './icons.js';

export const ruhig = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const mobil = () => !window.matchMedia?.('(min-width: 768px)').matches;

/** Elemente erscheinen 8 px von unten, versetzt (Listen: 55 ms, höchstens die ersten 10; Suchtreffer: 45 ms). */
export function staffeln(elemente, { schritt = 55, max = 10 } = {}) {
  if (ruhig()) return;
  [...elemente].slice(0, max).forEach((el, i) => {
    el.style.animationDelay = `${i * schritt}ms`;
    el.classList.remove('wm-ein'); void el.offsetWidth; el.classList.add('wm-ein');
    el.addEventListener('animationend', () => el.classList.remove('wm-ein'), { once: true });
  });
}

/** Zahl in el zählt die letzten `spanne` Einheiten bis `ziel` hoch (ease-out). format(v) → Text. */
export function hochzaehlen(el, ziel, { spanne = 36, ms = 700, format = (v) => Math.round(v).toLocaleString('de-DE') } = {}) {
  if (!el || !Number.isFinite(ziel)) return;
  el.textContent = format(ziel);
  if (ruhig()) return;
  const von = ziel - spanne, t0 = performance.now();
  const schritt = (t) => {
    if (!el.isConnected) return;
    const x = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - x, 3);
    el.textContent = format(x < 1 ? von + (ziel - von) * e : ziel);
    if (x < 1) requestAnimationFrame(schritt);
  };
  el.textContent = format(von);
  requestAnimationFrame(schritt);
}

/** Stern ploppt (1,45× mit leichter Drehung). */
export function sternPop(knopf) {
  if (!knopf || ruhig()) return;
  knopf.classList.remove('wm-pop'); void knopf.offsetWidth; knopf.classList.add('wm-pop');
  setTimeout(() => knopf.classList.remove('wm-pop'), 520);
}

/** Ziel des Merk-Flugs: „Gemerkt“ unten (Handy) bzw. oben in der Kopfleiste (Desktop). */
function gemerktZiel() {
  const a = document.querySelector(mobil() ? '#bottomnav [data-nav="gemerkt"]' : '#topnav [data-nav="gemerkt"]');
  return a && a.getClientRects().length ? a : null;
}

/** Beim Hinzufügen: ein zweiter Stern fliegt im Bogen vom Knopf zu „Gemerkt“ (820 ms); bei Ankunft springt das Abzeichen. */
export function merkFlug(von) {
  const ziel = gemerktZiel();
  if (!von || !ziel || ruhig()) return;
  const r0 = von.getBoundingClientRect ? von.getBoundingClientRect() : von, r1 = ziel.getBoundingClientRect();
  const x0 = r0.left + r0.width / 2 - 14, y0 = r0.top + r0.height / 2 - 14;
  const x1 = r1.left + r1.width / 2 - 14, y1 = r1.top + r1.height / 2 - 14;
  const flug = document.createElement('span');
  flug.className = 'wm-flug';
  flug.setAttribute('aria-hidden', 'true');
  flug.innerHTML = icon('star', 28, true);
  flug.style.cssText = `--x0:${x0}px;--y0:${y0}px;--x1:${x1}px;--y1:${y1}px;--ym:${Math.min(y0, y1) - 90}px`;
  document.body.append(flug);
  setTimeout(() => {
    flug.remove();
    const b = ziel.querySelector('.nav-badge:not([hidden])') || ziel;
    b.classList.remove('wm-bump'); void b.offsetWidth; b.classList.add('wm-bump');
    setTimeout(() => b.classList.remove('wm-bump'), 520);
  }, 820);
}

/** Haken, der sich als Linie zeichnet (Senden erfolgreich). */
export const hakenSvg = (px = 32) => `<svg class="wm-haken" width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path pathLength="1" d="m5 12 5 5 9-10"/></svg>`;

/** Marker erscheinen: ploppen von .3 ein, 65 ms versetzt, höchstens die ersten 30 im Kartenausschnitt; der Rest sofort. */
export function markerPlopp(kartenEl, selektor) {
  if (!kartenEl || ruhig()) return;
  const r = kartenEl.getBoundingClientRect();
  const sichtbar = [...kartenEl.querySelectorAll(selektor)].filter((m) => {
    const b = m.getBoundingClientRect();
    return b.width && b.right > r.left && b.left < r.right && b.bottom > r.top && b.top < r.bottom;
  }).slice(0, 30);
  sichtbar.forEach((m, i) => {
    m.style.setProperty('--plopp', `${i * 65}ms`);
    m.classList.add('wm-plopp');
    setTimeout(() => { m.classList.remove('wm-plopp'); m.style.removeProperty('--plopp'); }, i * 65 + 500);
  });
}

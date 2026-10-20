// Fotos eines Standorts: immer ein Bild, Pfeile, Wischen und Pfeiltasten; Antippen öffnet das Vollbild.
import { h } from './dom.js';
import { icon } from './icons.js';

const SWIPE_PX = 40;
const EASE = 'cubic-bezier(.22, .8, .24, 1)';
const calm = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || !Element.prototype.animate;

/**
 * Wischen (Touch und Stift): das Foto folgt dem Finger; weit genug → blättern, sonst federt es zurück.
 * Vertikales Scrollen bleibt möglich (touch-action: pan-y). current() liefert das gerade sichtbare Bild.
 */
function onSwipe(frame, current, go) {
  let x0 = null, y0 = 0, horizontal = null;
  const reset = (dx) => {
    const img = current();
    img.style.transform = '';
    if (dx && !calm()) img.animate([{ transform: `translateX(${dx}px)` }, { transform: 'translateX(0)' }], { duration: 220, easing: EASE });
  };
  frame.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') { x0 = e.clientX; y0 = e.clientY; horizontal = null; } });
  frame.addEventListener('pointermove', (e) => {
    if (x0 === null) return;
    const dx = e.clientX - x0, dy = e.clientY - y0;
    if (horizontal === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) horizontal = Math.abs(dx) > Math.abs(dy);
    if (horizontal && !calm()) current().style.transform = `translateX(${dx * 0.85}px)`;
  });
  frame.addEventListener('pointerup', (e) => {
    if (x0 === null) return;
    const dx = e.clientX - x0, dy = e.clientY - y0;
    x0 = null;
    if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1, horizontal ? dx * 0.85 : 0);
    else reset(horizontal ? dx * 0.85 : 0);
  });
  frame.addEventListener('pointercancel', () => { if (x0 !== null) { x0 = null; reset(0); } });
}

/** Bild laden und dekodieren, bevor es gezeigt wird. */
function ready(img) {
  return (img.decode ? img.decode() : new Promise((ok) => { img.onload = img.onerror = ok; })).catch(() => {});
}

/**
 * Gemeinsame Bildanzeige für Karussell und Vollbild. Beim Blättern liegt das neue Foto über dem alten und gleitet
 * aus der Blätterrichtung herein; das alte verschwindet erst danach – das Feld ist nie leer.
 */
function viewer(photos, name, { start = 0, className, onImageClick } = {}) {
  let i = start, token = 0, img = null;
  const multi = photos.length > 1;
  const count = h('span', { class: 'ph-count', 'aria-live': 'polite' });
  const prev = h('button', { type: 'button', class: 'ph-nav ph-prev', 'aria-label': 'Vorheriges Foto', title: 'Vorheriges Foto', html: icon('back', 22), hidden: !multi });
  const next = h('button', { type: 'button', class: 'ph-nav ph-next', 'aria-label': 'Nächstes Foto', title: 'Nächstes Foto', html: icon('next', 22), hidden: !multi });
  const frame = h('div', { class: className, tabindex: '0', role: 'group', 'aria-roledescription': 'Bildergalerie', 'aria-label': `Fotos: ${name}` },
    prev, next, multi ? count : null);
  const listeners = [];
  const makeImg = (ph) => {
    const el = h('img', { src: ph.url, alt: ph.alt || `Foto: ${name}`, draggable: 'false' });
    if (onImageClick) el.addEventListener('click', () => onImageClick(i));
    return el;
  };
  const show = (n, dir = 0, from = 0) => {
    i = (n + photos.length) % photos.length;
    const ph = photos[i], mine = ++token;
    count.textContent = `${i + 1} / ${photos.length}`;
    for (const fn of listeners) fn(ph, i);
    const nimg = makeImg(ph);
    ready(nimg).then(() => {
      if (mine !== token) return;                    // inzwischen weitergeblättert
      const old = img;
      frame.insertBefore(nimg, prev);                // über dem alten Bild, unter den Pfeilen
      img = nimg;
      if (!old) { if (!calm()) nimg.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 280, easing: 'ease-out' }); return; }
      if (!dir || calm()) { old.remove(); return; }
      const w = frame.clientWidth || 300;
      old.animate([{ transform: `translateX(${from}px)` }, { transform: `translateX(${-dir * w * 0.3}px)`, opacity: 0.4 }], { duration: 340, easing: EASE, fill: 'forwards' });
      nimg.animate([{ transform: `translateX(${dir * w * 0.6}px)`, opacity: 0.3 }, { transform: 'translateX(0)', opacity: 1 }], { duration: 340, easing: EASE })
        .finished.catch(() => {}).finally(() => old.remove());
    });
    if (multi) { const pre = new Image(); pre.src = photos[(i + (dir < 0 ? -1 : 1) + photos.length) % photos.length].url; }   // in Blätterrichtung vorladen
  };
  const go = (d, from = 0) => { if (multi) show(i + d, d, from); };
  prev.addEventListener('click', (e) => { e.stopPropagation(); go(-1); });
  next.addEventListener('click', (e) => { e.stopPropagation(); go(1); });
  frame.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    else if ((e.key === 'Enter' || e.key === ' ') && onImageClick && e.target === frame) { e.preventDefault(); onImageClick(i); }
  });
  onSwipe(frame, () => img || frame, go);
  return { frame, show, onChange: (fn) => listeners.push(fn), index: () => i };
}

/** Karussell für die Detailansicht. onReport(photo) meldet ein unpassendes Foto. */
export function photoCarousel(photos, { name, onReport }) {
  const caption = h('p', { class: 'ph-caption' });
  const credit = h('span', { class: 'ph-credit' });
  const v = viewer(photos, name, { className: 'ph-frame', onImageClick: (i) => openLightbox(photos, name, i) });
  const report = onReport ? h('button', { type: 'button', class: 'ph-report', text: 'Foto melden', onclick: () => onReport(photos[v.index()]) }) : null;
  v.onChange((ph) => {
    caption.textContent = ph.alt || '';
    caption.hidden = !ph.alt;
    credit.textContent = ph.credit ? `Foto: ${ph.credit}` : '';
  });
  v.show(0);
  return h('section', { class: 'photos', 'aria-label': 'Fotos' }, v.frame, h('div', { class: 'ph-meta' }, caption, h('div', { class: 'ph-foot' }, credit, report)));
}

/** Vollbild mit denselben Bedienwegen; Escape oder × schließt. */
export function openLightbox(photos, name, start = 0) {
  const caption = h('p', { class: 'lb-caption' });
  const v = viewer(photos, name, { start, className: 'lb-stage' });
  const close = h('button', { type: 'button', class: 'icon-btn lb-close', 'aria-label': 'Vollbild schließen', title: 'Schließen', html: icon('close', 24) });
  const dlg = h('dialog', { class: 'lightbox', 'aria-label': `Fotos: ${name}` }, v.frame, close, caption);
  v.onChange((ph) => { caption.textContent = [ph.alt, ph.credit ? `Foto: ${ph.credit}` : ''].filter(Boolean).join(' · '); });
  close.addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target === v.frame) dlg.close(); });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  v.show(start);
  dlg.showModal();
  v.frame.focus();
  return dlg;
}

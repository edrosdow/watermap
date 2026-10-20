// Fotos eines Standorts: immer ein Bild, Pfeile, Wischen und Pfeiltasten; Antippen öffnet das Vollbild.
import { h } from './dom.js';
import { icon } from './icons.js';

const SWIPE_PX = 40;

/** Wischen nach links/rechts erkennen (Touch und Stift); vertikales Scrollen bleibt möglich. */
function onSwipe(el, go) {
  let x0 = null, y0 = 0;
  el.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') { x0 = e.clientX; y0 = e.clientY; } });
  el.addEventListener('pointerup', (e) => {
    if (x0 === null) return;
    const dx = e.clientX - x0, dy = e.clientY - y0;
    x0 = null;
    if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
  });
  el.addEventListener('pointercancel', () => { x0 = null; });
}

/** Gemeinsame Bildanzeige für Karussell und Vollbild. */
function viewer(photos, name, { start = 0, className, onImageClick } = {}) {
  let i = start;
  const multi = photos.length > 1;
  const img = h('img', { decoding: 'async', draggable: 'false' });
  const count = h('span', { class: 'ph-count', 'aria-live': 'polite' });
  const prev = h('button', { type: 'button', class: 'ph-nav ph-prev', 'aria-label': 'Vorheriges Foto', title: 'Vorheriges Foto', html: icon('back', 22), hidden: !multi });
  const next = h('button', { type: 'button', class: 'ph-nav ph-next', 'aria-label': 'Nächstes Foto', title: 'Nächstes Foto', html: icon('next', 22), hidden: !multi });
  const frame = h('div', { class: className, tabindex: '0', role: 'group', 'aria-roledescription': 'Bildergalerie', 'aria-label': `Fotos: ${name}` },
    img, prev, next, multi ? count : null);
  const listeners = [];
  const show = (n) => {
    i = (n + photos.length) % photos.length;
    const ph = photos[i];
    img.src = ph.url;
    img.alt = ph.alt || `Foto: ${name}`;
    count.textContent = `${i + 1} / ${photos.length}`;
    if (multi) { const pre = new Image(); pre.src = photos[(i + 1) % photos.length].url; }   // nächstes vorladen
    for (const fn of listeners) fn(ph, i);
  };
  const go = (d) => { if (multi) show(i + d); };
  prev.addEventListener('click', (e) => { e.stopPropagation(); go(-1); });
  next.addEventListener('click', (e) => { e.stopPropagation(); go(1); });
  frame.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    else if ((e.key === 'Enter' || e.key === ' ') && onImageClick && e.target === frame) { e.preventDefault(); onImageClick(i); }
  });
  onSwipe(frame, go);
  if (onImageClick) img.addEventListener('click', () => onImageClick(i));
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

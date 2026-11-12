// „X“ zum Leeren in jedem Suchfeld (input[type=search]) der App: erscheint, sobald etwas eingetippt ist, und leert das Feld
// wie ein Tippen (input-Ereignis), danach bleibt der Fokus im Feld. Neue Suchfelder (Fenster, Seiten) bekommen es automatisch.
import { icon } from './icons.js';

const WERT = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

export function mitX(input) {
  if (input.dataset.x) return;
  input.dataset.x = '1';
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'such-x'; btn.hidden = true;
  btn.setAttribute('aria-label', 'Suche löschen');
  btn.innerHTML = `<span>${icon('close', 14)}</span>`;
  const zeigen = () => { const leer = !WERT.get.call(input); btn.hidden = leer; input.classList.toggle('hat-x', !leer); };
  // auch wenn die App das Feld selbst leert (input.value = ''), passt das „X“ dazu
  Object.defineProperty(input, 'value', { configurable: true, get() { return WERT.get.call(this); }, set(v) { WERT.set.call(this, v); zeigen(); } });
  input.addEventListener('input', zeigen);
  btn.addEventListener('click', () => {
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  });
  const p = input.parentElement;
  if (p && getComputedStyle(p).position === 'static') p.style.position = 'relative';
  input.after(btn);
  zeigen();
}

/** Alle vorhandenen und künftigen Suchfelder ausstatten. */
export function suchfelderMitX(root = document) {
  const alle = () => root.querySelectorAll('input[type="search"]:not([data-x])').forEach(mitX);
  alle();
  new MutationObserver(alle).observe(root.body || root, { childList: true, subtree: true });
}

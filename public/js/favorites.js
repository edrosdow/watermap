// Favoriten: lokal im Browser. Funktioniert auch, wenn localStorage gesperrt ist (dann nur bis zum Schließen).
const KEY = 'watermap.favorites.v1';
let memory = [];
let storageOk = true;

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter(x => typeof x === 'string') : [];
  } catch { storageOk = false; return memory; }
}
function write(arr) {
  memory = arr;
  try { localStorage.setItem(KEY, JSON.stringify(arr)); } catch { storageOk = false; }
}

export const favorites = {
  all: () => read(),
  has: (id) => read().includes(id),
  toggle(id) {
    const cur = read();
    const next = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id];
    write(next);
    document.dispatchEvent(new CustomEvent('favorites-changed'));
    return next.includes(id);
  },
  get persistent() { return storageOk; },
};

/** Kleine Helfer für Einstellungen, die nur der Bequemlichkeit dienen (z. B. „Standort-Hinweis geschlossen“). */
export const prefs = {
  get(key) { try { return localStorage.getItem('watermap.' + key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem('watermap.' + key, value); } catch { /* egal */ } },
};

// „Heute vor Ort“: Lagemeldungen an Standorten – Regeln und Speicherung (Netlify Blobs).
// Reine Logik mit eingespeistem Speicher und Uhr, damit sie ohne Netlify testbar ist.
//
// Speicher (Store „meldungen“):
//   ort/<standortId>        { meldungen: [Meldung] }           – je Standort
//   index                   { [standortId]: { n, typ, at } }   – kompakte Übersicht für Karte und Filter
//   sperre/<sha256>         { at }                             – „schon gemeldet/bestätigt“ (Gerät bzw. IP-Hash), 24 h
//   mid/<meldungId>         { standortId, at }                 – Zuordnung für „bestätigen“, 24 h
//
// Meldung = { id, standortId, typ, notiz, erstelltAm, bestaetigt, widersprochen, fotos: [] }
//   (fotos bleibt in dieser Runde leer; später können dort Bild-Verweise stehen)

export const TYPEN = ['alles_frei', 'parkplatz_voll', 'warteschlange', 'rampe_rutschig', 'hindernis', 'gesperrt'];
/** Wichtigkeit: höher = wichtiger (für „wichtigste Meldung“, Marker und Vorschau). */
export const WICHTIGKEIT = { gesperrt: 6, hindernis: 5, rampe_rutschig: 4, parkplatz_voll: 3, warteschlange: 2, alles_frei: 1 };
export const SICHTBAR_MS = 24 * 3600e3;
export const SPERRE_MS = 3600e3;              // pro Gerät/IP und Standort höchstens 1 Meldung pro Stunde
export const HASH_MS = 24 * 3600e3;           // Sperr-Einträge (Gerät, IP-Hash) werden danach gelöscht
export const WIDERSPRUCH_GRENZE = 3;          // „Nicht mehr“ übersteigt „Stimmt noch“ um 3 → ausgeblendet
export const NOTIZ_MAX = 140;
const UEBERHOLT_VON_FREI = new Set(['parkplatz_voll', 'warteschlange']);
const ID_RE = /^(?:(?:node|way|relation)\/\d{1,15}|c\/[a-z0-9-]{1,80})$/;
const GERAET_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** Notiz säubern: HTML und Links entfernen, Leerraum zusammenfassen, Länge begrenzen. */
export function saeubereNotiz(s) {
  let t = String(s ?? '').normalize('NFC');
  t = t.replace(/<[^>]*>/g, ' ')                                   // HTML-Tags
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, ' ')                    // Links
    .replace(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:de|com|net|org|eu|info|io|at|ch|ly|me)\b(?:\/\S*)?/gi, ' ')
    .replace(/[<>]/g, ' ')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return [...t].slice(0, NOTIZ_MAX).join('');
}

export const gueltigeId = (id) => typeof id === 'string' && ID_RE.test(id);

/** Sichtbar: jünger als 24 h, nicht zu oft widersprochen, nicht durch neueres „Alles frei“ überholt. */
export function sichtbare(meldungen, jetzt) {
  const frisch = meldungen.filter(m => jetzt - m.erstelltAm < SICHTBAR_MS && (m.widersprochen - m.bestaetigt) < WIDERSPRUCH_GRENZE);
  const freiAb = Math.max(-Infinity, ...frisch.filter(m => m.typ === 'alles_frei').map(m => m.erstelltAm));
  return frisch.filter(m => !(UEBERHOLT_VON_FREI.has(m.typ) && m.erstelltAm < freiAb))
    .sort((a, b) => WICHTIGKEIT[b.typ] - WICHTIGKEIT[a.typ] || b.erstelltAm - a.erstelltAm);
}

/** Für Ausgabe: nur die öffentlichen Felder. */
const oeffentlich = (m) => ({ id: m.id, standortId: m.standortId, typ: m.typ, notiz: m.notiz, erstelltAm: m.erstelltAm,
  bestaetigt: m.bestaetigt, widersprochen: m.widersprochen });

function zusammenfassung(sicht) {
  if (!sicht.length) return null;
  return { n: sicht.length, typ: sicht[0].typ, at: sicht[0].erstelltAm };
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const ortKey = (id) => `ort/${id}`;

async function lesen(store, key, fallback) {
  try { return (await store.get(key, { type: 'json' })) ?? fallback; } catch { return fallback; }
}

export const MAX_LISTE = 300;   // Übersicht: höchstens so viele Standorte (neueste zuerst)
const VERSUCHE = 6;
const warten = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Eintrag lesen, ändern, schreiben – sicher bei gleichzeitigen Zugriffen: geschrieben wird nur, wenn sich der Eintrag
 * seit dem Lesen nicht geändert hat (ETag, Netlify Blobs „onlyIfMatch“/„onlyIfNew“); sonst neu lesen und noch einmal.
 * aendern(alt) gibt den neuen Inhalt zurück, null = löschen, undefined = nichts tun. Kann Fehler werfen (wird weitergereicht).
 * Speicher ohne getWithMetadata (Tests): einfaches Lesen und Schreiben.
 */
export async function sicherAendern(store, key, fallback, aendern) {
  if (typeof store.getWithMetadata !== 'function') {
    const neu = aendern(structuredClone(await lesen(store, key, fallback)));
    if (neu === null) await store.delete(key); else if (neu !== undefined) await store.setJSON(key, neu);
    return neu;
  }
  for (let i = 0; i < VERSUCHE; i++) {
    let r = null;
    try { r = await store.getWithMetadata(key, { type: 'json' }); } catch { r = null; }
    const neu = aendern(structuredClone(r?.data ?? fallback));
    if (neu === undefined) return neu;
    if (neu === null) { if (r) await store.delete(key); return null; }
    const res = await store.setJSON(key, neu, r?.etag ? { onlyIfMatch: r.etag } : { onlyIfNew: true });
    if (!res || res.modified !== false) return neu;
    await warten(15 * (i + 1) + Math.random() * 20);   // jemand war schneller: kurz warten, neu lesen
  }
  throw new Fehler(503, 'Gerade melden sehr viele gleichzeitig – bitte gleich noch einmal versuchen.');
}

const frische = (ort, jetzt) => (Array.isArray(ort?.meldungen) ? ort.meldungen : []).filter(m => jetzt - m.erstelltAm < SICHTBAR_MS);

/** Standort laden, Abgelaufenes entfernen (und dabei gleich aufräumen). */
async function ortLaden(store, id, jetzt) {
  const ort = await lesen(store, ortKey(id), { meldungen: [] });
  const alle = Array.isArray(ort.meldungen) ? ort.meldungen : [];
  const behalten = frische(ort, jetzt);
  if (behalten.length !== alle.length) {
    const neu = await sicherAendern(store, ortKey(id), { meldungen: [] }, (o) => { const b = frische(o, jetzt); return b.length ? { meldungen: b } : null; });
    const rest = neu?.meldungen || [];
    await indexSetzen(store, id, zusammenfassung(sichtbare(rest, jetzt)), jetzt);
    return rest;
  }
  return behalten;
}

/** Meldungen eines Standorts sicher ändern (aendern(liste) → neue Liste); Abgelaufenes fällt dabei weg. */
async function ortAendern(store, id, jetzt, aendern) {
  const neu = await sicherAendern(store, ortKey(id), { meldungen: [] }, (o) => { const l = aendern(frische(o, jetzt)); return l.length ? { meldungen: l } : null; });
  return neu?.meldungen || [];
}

async function indexSetzen(store, id, eintrag, jetzt) {
  await sicherAendern(store, 'index', {}, (idx) => {
    if (eintrag) idx[id] = eintrag; else delete idx[id];
    // Abgelaufene Einträge anderer Standorte gleich mit entfernen
    for (const [k, v] of Object.entries(idx)) if (!v || jetzt - v.at >= SICHTBAR_MS) delete idx[k];
    return idx;
  });
}

/** Sperre prüfen und (falls frei) setzen. true = gesperrt. */
async function gesperrt(store, schluessel, dauer, jetzt) {
  for (const s of schluessel) {
    const e = await lesen(store, `sperre/${s}`, null);
    if (e && jetzt - e.at < dauer) return true;
  }
  return false;
}
async function sperren(store, schluessel, jetzt) {
  for (const s of schluessel) await store.setJSON(`sperre/${s}`, { at: jetzt });
}

export class Fehler extends Error {
  constructor(status, text) { super(text); this.status = status; }
}

/**
 * deps = { store, jetzt(): ms, salz, standortGibtEs(id): Promise<bool>, neueId(): string }
 */
export function meldungenApi(deps) {
  const now = () => deps.jetzt();
  const kennungen = async ({ geraet, ip }, wofuer) => {
    const out = [];
    if (GERAET_RE.test(geraet || '')) out.push(await sha256(`g|${geraet}|${wofuer}`));
    if (ip) out.push(await sha256(`i|${deps.salz}|${ip}|${wofuer}`));      // IP nie im Klartext
    if (!out.length) throw new Fehler(400, 'Gerät nicht erkennbar.');
    return out;
  };

  return {
    /** Aktive Meldungen eines Standorts (wichtigste zuerst). */
    async standort(id) {
      if (!gueltigeId(id)) throw new Fehler(400, 'Ungültiger Standort.');
      const jetzt = now();
      return sichtbare(await ortLaden(deps.store, id, jetzt), jetzt).map(oeffentlich);
    },

    /**
     * Alle aktiven Meldungen (öffentliche Felder), neueste zuerst – für die Übersicht „Aktuelle Meldungen“.
     * Liest den Index und dann höchstens MAX_LISTE Standorte (die mit den neuesten Meldungen).
     */
    async liste() {
      const jetzt = now();
      const idx = await lesen(deps.store, 'index', {});
      const ids = Object.entries(idx).filter(([, v]) => v && jetzt - v.at < SICHTBAR_MS).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_LISTE).map(([id]) => id);
      const orte = await Promise.all(ids.map(id => lesen(deps.store, ortKey(id), { meldungen: [] })));
      return orte.flatMap(o => sichtbare(frische(o, jetzt), jetzt)).map(oeffentlich).sort((a, b) => b.erstelltAm - a.erstelltAm);
    },

    /** Kompakte Liste aller Standorte mit aktiven Meldungen. */
    async aktiv() {
      const jetzt = now();
      const idx = await lesen(deps.store, 'index', {});
      return Object.entries(idx).filter(([, v]) => v && jetzt - v.at < SICHTBAR_MS)
        .map(([standortId, v]) => ({ standortId, n: v.n, typ: v.typ, at: v.at }));
    },

    /** Neue Meldung. body = { standortId, typ, notiz }, wer = { geraet, ip } */
    async melden(body, wer) {
      const id = body?.standortId, typ = body?.typ;
      if (!gueltigeId(id)) throw new Fehler(400, 'Ungültiger Standort.');
      if (!TYPEN.includes(typ)) throw new Fehler(400, 'Unbekannte Art der Meldung.');
      if (body.notiz != null && typeof body.notiz !== 'string') throw new Fehler(400, 'Ungültige Notiz.');
      if (String(body.notiz ?? '').length > NOTIZ_MAX * 4) throw new Fehler(400, 'Notiz zu lang.');
      if (!(await deps.standortGibtEs(id))) throw new Fehler(404, 'Diesen Standort gibt es nicht.');
      const jetzt = now();
      const keys = await kennungen(wer, `melden|${id}`);
      if (await gesperrt(deps.store, keys, SPERRE_MS, jetzt)) throw new Fehler(429, 'Du hast hier gerade schon gemeldet. Bitte warte eine Stunde.');
      const m = { id: deps.neueId(), standortId: id, typ, notiz: saeubereNotiz(body.notiz) || null, erstelltAm: jetzt, bestaetigt: 0, widersprochen: 0, fotos: [] };
      const alle = await ortAendern(deps.store, id, jetzt, (l) => [...l, m]);
      await deps.store.setJSON(`mid/${m.id}`, { standortId: id, at: jetzt });
      await sperren(deps.store, keys, jetzt);
      const sicht = sichtbare(alle, jetzt);
      await indexSetzen(deps.store, id, zusammenfassung(sicht), jetzt);
      return { meldung: oeffentlich(m), meldungen: sicht.map(oeffentlich) };
    },

    /** „Stimmt noch“ (true) oder „Nicht mehr“ (false). Setzt die 24 h NICHT zurück. */
    async bestaetigen(meldungId, stimmt, wer) {
      if (!/^[a-f0-9]{8,32}$/.test(meldungId || '')) throw new Fehler(400, 'Ungültige Meldung.');
      if (typeof stimmt !== 'boolean') throw new Fehler(400, '„stimmt“ muss true oder false sein.');
      const jetzt = now();
      const zu = await lesen(deps.store, `mid/${meldungId}`, null);
      const standortId = zu?.standortId;
      if (!gueltigeId(standortId)) throw new Fehler(404, 'Diese Meldung ist nicht mehr aktiv.');
      const vorher = await ortLaden(deps.store, standortId, jetzt);
      const m0 = vorher.find(x => x.id === meldungId);
      if (!m0 || !sichtbare(vorher, jetzt).includes(m0)) throw new Fehler(404, 'Diese Meldung ist nicht mehr aktiv.');
      const keys = await kennungen(wer, `bestaetigen|${meldungId}`);
      if (await gesperrt(deps.store, keys, HASH_MS, jetzt)) throw new Fehler(429, 'Du hast diese Meldung schon bewertet.');
      // Zählen auf dem frisch gelesenen Stand (gleichzeitige Bewertungen anderer gehen nicht verloren)
      const alle = await ortAendern(deps.store, standortId, jetzt, (l) => {
        const m = l.find(x => x.id === meldungId);
        if (!m) throw new Fehler(404, 'Diese Meldung ist nicht mehr aktiv.');
        if (stimmt) m.bestaetigt += 1; else m.widersprochen += 1;
        return l;
      });
      await sperren(deps.store, keys, jetzt);
      const sicht = sichtbare(alle, jetzt);
      await indexSetzen(deps.store, standortId, zusammenfassung(sicht), jetzt);
      return { standortId, meldungen: sicht.map(oeffentlich) };
    },

    /** Aufräumen (stündlich): abgelaufene Meldungen und Sperr-Einträge löschen. */
    async aufraeumen() {
      const jetzt = now();
      let geloescht = 0;
      const { blobs: sp = [] } = await deps.store.list({ prefix: 'sperre/' });
      const { blobs: mids = [] } = await deps.store.list({ prefix: 'mid/' });
      for (const b of [...sp, ...mids]) {
        const e = await lesen(deps.store, b.key, null);
        if (!e || jetzt - e.at >= HASH_MS) { await deps.store.delete(b.key); geloescht++; }
      }
      const { blobs: orte = [] } = await deps.store.list({ prefix: 'ort/' });
      for (const b of orte) await ortLaden(deps.store, b.key.slice(4), jetzt);
      await indexSetzen(deps.store, '__keiner__', null, jetzt);
      return { geloescht };
    },
  };
}

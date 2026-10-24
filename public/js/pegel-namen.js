// Pegel- und Gewässernamen aus PEGELONLINE schön schreiben: „HANN.MUENDEN“ → „Hann. Münden“.
// PEGELONLINE liefert Namen in Großbuchstaben, manche ohne Umlaute. Eine allgemeine Regel „ue → ü“ wäre falsch
// („Neuenkirchen“), deshalb gibt es für Umlaute nur diese Korrekturliste (Schlüssel: Name wie geliefert, nur Buchstaben).
// Kandidaten zeigt die Prüfliste (pruefung.html).
export const KORREKTUR = {
  HANNMUENDEN: 'Hann. Münden',
  MEISSEN: 'Meißen',
  ROSSLAU: 'Roßlau',
  STORKOWERGEWAESSER: 'Storkower Gewässer',
  OESTRICH: 'Oestrich',
};

// Kürzel, die groß bleiben (UW = Unterwasser, OW = Oberwasser, UP/OP = Unter-/Oberpegel, AP/BP = Außen-/Binnenpegel …)
const KUERZEL = new Set(['UW', 'OW', 'UP', 'OP', 'AP', 'BP', 'UF', 'SP', 'MPM']);
// Abkürzungen, die ausgeschrieben werden
const AUSGESCHRIEBEN = { BHV: 'Bremerhaven', WHV: 'Wilhelmshaven', LT: 'Leuchtturm' };
// kleine Wörter mitten im Namen („List auf Sylt“, „Itter zur Diemel“)
const KLEIN = new Set(['auf', 'zur', 'zum', 'am', 'im', 'an', 'der', 'den', 'dem', 'bei', 'und', 'ob']);

const schluessel = (s) => String(s || '').normalize('NFC').toUpperCase().replace(/[^\p{L}]/gu, '');
// Punkt-ähnliche Zeichen vereinheitlichen, Unicode zusammensetzen
const vorbereiten = (s) => String(s || '').normalize('NFC').replace(/[․‧·．]/g, '.').replace(/[­​-‍﻿]/g, '').trim();

function titel(s) {
  return s.toLowerCase().replace(/\p{L}+/gu, (w, i) => {
    const gross = w.toUpperCase();
    if (KUERZEL.has(gross) && i > 0) return gross;
    if (AUSGESCHRIEBEN[gross] && s[i + w.length] !== '.') return AUSGESCHRIEBEN[gross];
    if (KLEIN.has(w) && i > 0 && s[i - 1] === ' ') return w;
    return w[0].toUpperCase() + w.slice(1);
  });
}

export function schoenerName(roh) {
  const s = vorbereiten(roh);
  const k = KORREKTUR[schluessel(s)];
  if (k) return k;
  return titel(s)
    .replace(/\.(?=\p{L})/gu, '. ')                              // „Hann.Münden“ → „Hann. Münden“
    .replace(/\b(G)ross(e|er|es|en)?\b/g, '$1roß$2')             // „Grosse Weserbrücke“ → „Große Weserbrücke“
    .replace(/(s)trass(e|en)/gi, (m, a, b) => `${a}traß${b}`);   // „Wasserstrasse“, „Strassenbrücke“ → „…straße“, „Straßen…“
}

/** Namen, die vermutlich Umlaute ohne Punkte enthalten (für die Prüfliste). „aue“, „que“, „eue“ sind unverdächtig. */
export const umlautVerdacht = (roh) => /AE|OE|UE/i.test(String(roh || '').replace(/[AEQ]UE/gi, '')) && !KORREKTUR[schluessel(roh)];

// Pegel- und Gewässernamen aus PEGELONLINE schön schreiben: „HANN.MUENDEN“ → „Hann. Münden“.
// PEGELONLINE liefert Namen in Großbuchstaben, manche ohne Umlaute. Eine allgemeine Regel „ue → ü“ wäre falsch
// („Neuenkirchen“), deshalb gibt es für Umlaute nur diese Korrekturliste (Schlüssel: Name wie geliefert, ohne Leerzeichen).
// Kandidaten listet die Konsole in der Vorschau (Entwicklungsmodus) auf.
export const KORREKTUR = {
  'HANN.MUENDEN': 'Hann. Münden',
};

const titel = (s) => String(s).toLowerCase().replace(/(^|[\s\-(/.])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

export function schoenerName(roh) {
  const s = String(roh || '').trim();
  const k = KORREKTUR[s.toUpperCase().replace(/\s+/g, '')];
  if (k) return k;
  return titel(s)
    .replace(/\.(?=\p{L})/gu, '. ')                       // „Hann.Münden“ → „Hann. Münden“
    .replace(/strasse(?=$|[\s\-)])/g, 'straße');          // „Wasserstrasse“ → „Wasserstraße“
}

/** Namen, die vermutlich Umlaute ohne Punkte enthalten (für die Prüfliste in der Konsole). */
export const umlautVerdacht = (roh) => /AE|OE|UE/i.test(String(roh || '')) && !KORREKTUR[String(roh).toUpperCase().replace(/\s+/g, '')];

// Zuordnung PEGELONLINE-Pegel → BSH-Vorhersageort, wo die automatische Zuordnung (PEGELONLINE-Kennung in
// measurement_url bzw. Pegelnummer = operator_gauge_id) nicht greift. Schlüssel: PEGELONLINE-UUID oder Pegelnummer,
// Wert: Kennung des BSH-Orts (z. B. „cuxhaven_steubenhoeft“). Kandidaten zeigt die Prüfliste (pruefung.html).
export const AUSNAHMEN = {
  5970026: 'grauerort',            // Grauerort Reede (BSH-Nr. 5970020)
  5952065: 'hamburg_blankenese',   // Blankenese UF = Unterfeuer (BSH-Nr. 307)
};

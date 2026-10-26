# „Heute vor Ort“ – Lagemeldungen

Nutzer melden mit zwei Tipps die aktuelle Lage an einem Standort (Alles frei, Parkplatz voll, Warteschlange,
Rampe rutschig, Hindernis, Gesperrt). Meldungen sind sofort für alle sichtbar und verschwinden nach 24 Stunden.

## Einrichten (einmalig)

1. Netlify → *Site configuration* → *Environment variables* → *Add a variable*
   - Key: `MELDUNG_SALZ`
   - Value: ein langer Zufallswert (z. B. 40 Zeichen aus einem Passwort-Generator) – **nicht** weitergeben
   - Haken bei *Contains secret values*, Scopes: *Functions*, Deploy contexts: alle
2. Danach einmal neu veröffentlichen (bei der Vorschau: Deploy öffnen → *Retry deploy* → *Deploy with latest branch commit*).

Ohne `MELDUNG_SALZ` lassen sich Meldungen lesen, aber nicht abgeben (Antwort 503).

## Technik

- Funktion `netlify/functions/meldungen.mjs` (Endpunkte unter `/api/meldungen`), Regeln in `netlify/lib/meldungen-kern.mjs`.
- Speicher: Netlify Blobs, Bereich `meldungen` (live) bzw. `meldungen-vorschau` (Deploy-Vorschauen und lokale Tests).
- `netlify/functions/meldungen-aufraeumen.mjs` löscht stündlich Abgelaufenes (nur auf der veröffentlichten Seite).
- Regeln: 24 h sichtbar (Bestätigen verlängert nicht), ausgeblendet wenn „Nicht mehr“ die „Stimmt noch“ um 3 übersteigt,
  „Alles frei“ blendet ältere „Parkplatz voll“/„Warteschlange“ aus, pro Gerät/IP und Standort 1 Meldung pro Stunde,
  pro Meldung 1 Bewertung. IP-Adressen werden nur gesalzen gehasht gespeichert und nach 24 h gelöscht.
- Unpassende Notizen: „Unpassend melden“ schickt einen Hinweis über das Formular „fehler-melden“ (Art `meldung`, mit Meldung-ID)
  und blendet die Meldung auf dem Gerät aus. Entfernen für alle: `/admin/fotos.html` → Hinweise → „Meldung entfernen“ (siehe `docs/MODERATION.md`).
- Später möglich: Fotos zu Meldungen (Feld `fotos` ist im Datenmodell vorgesehen).

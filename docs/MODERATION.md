# Meldungen prüfen und veröffentlichen (Phase 1: manuell)

Meldungen gehen über **Netlify Forms** ein. Sie sind **nie automatisch sichtbar**. Du entscheidest, was in die Community-Dateien kommt.

## Ablauf
1. **Eingang:** Netlify → *Forms* → Formular öffnen (oder E-Mail-Benachrichtigung).
2. **Prüfen:** Position in der Karte und auf Luftbild ansehen, Angaben plausibel? Bei Preisen: Datum und Belegfoto. Bei Fotos: Rechte, keine Personen/Kennzeichen, Inhalt passend.
3. **Umwandeln (optional, spart Tipparbeit):** *Export CSV*, dann
   ```
   python3 scripts/submissions_to_json.py slipanlage-melden export.csv
   python3 scripts/submissions_to_json.py tankpreis-melden  export.csv
   ```
   Ausgabe sind Einträge mit `"status": "pending"`. E-Mail- und IP-Adressen werden nicht übernommen.
4. **Freigeben:** Eintrag nach Prüfung auf `"approved"` setzen und in die passende Datei einfügen:
   | Meldung | Datei |
   |---|---|
   | Neue Slipanlage | `community/places.json` |
   | Korrektur (Fehler melden) | `community/overrides.json` |
   | Kraftstoffpreis | `community/prices.json` (anhängen, nie löschen) |
   | Foto | per Klick, siehe „Fotos per Klick freigeben“ (oder von Hand: Datei nach `public/photos/`, Eintrag in `overrides.json` unter `photos`) |
5. **Prüfen und veröffentlichen:** `python3 scripts/validate_data.py`, dann `public` bei Netlify neu hochladen (oder committen).
6. **Abgelehnte Meldungen** in Netlify löschen (Datenschutz: nicht länger speichern als nötig; Frist in der Datenschutzerklärung festlegen).

## Fotos per Klick freigeben
Seite **`/admin/fotos.html`** (z. B. `https://watermaps.netlify.app/admin/fotos.html`): Passwort eingeben, Foto ansehen, **Freigeben** oder **Ablehnen**. Freigeben legt das Bild in `public/photos/` ab, trägt es in `community/overrides.json` ein (Urheber „WaterMap-Community“, Beschreibung als Alternativtext) und löscht die Einreichung; nach etwa einer Minute ist das Foto in der App. Ablehnen löscht die Einreichung. Ohne bestätigte Rechte lässt sich nicht freigeben.

**Einmalig einrichten** (Netlify → *Site configuration* → *Environment variables*, danach einmal neu veröffentlichen):
| Variable | Wert |
|---|---|
| `FOTO_ADMIN_PASSWORT` | ein langes, frei gewähltes Passwort |
| `NETLIFY_API_TOKEN` | Netlify → *User settings* → *Applications* → *Personal access tokens* → *New access token* |
| `GITHUB_TOKEN` | GitHub → *Settings* → *Developer settings* → *Fine-grained tokens*: nur Repository `watermap`, Berechtigung *Contents: Read and write* |
| `FOTO_BRANCH` (optional) | Zweig, in den freigegebene Fotos geschrieben werden; Standard `main` |

## Besondere Fälle
- **Doppelte Slipanlage:** Existiert sie schon in OSM, trage die neuen Angaben als Override zur OSM-ID ein statt einen neuen Standort anzulegen. Besser noch: in OpenStreetMap selbst ergänzen – dann profitieren alle.
- **„Standort existiert nicht mehr“:** Erst prüfen (mehrere Meldungen? Luftbild?). Dann in OSM korrigieren; beim nächsten Import verschwindet er. Bis dahin Hinweis per `description` im Override.
- **Fehlende Tankstelle bei Preismeldung:** `tankstelle_id` ist `__other` → Standort erst anlegen, dann Preis zuordnen.
- **Fotos:** Nur mit Urheberangabe (`credit`) veröffentlichen. Die App entfernt GPS/EXIF schon vor dem Senden; Dateinamen nach dem Muster `node-123-1.jpg` vergeben.

## Grenzen von Phase 1 (bewusst)
- Prüfungen im Browser (Dateityp an den Dateiinhalten, Größe, Preisbereich, EXIF-Entfernung) können von Angreifern umgangen werden. Das ist unkritisch, solange **du jede Datei selbst ansiehst, bevor sie auf die Seite kommt**. Eine serverseitige Prüfung und ein Admin-Bereich sind für V8 vorgesehen.
- Netlify Forms speichert Uploads, prüft aber keine Inhalte.

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

## Verwaltung (per Klick)
Seite **`/admin/fotos.html`** (z. B. `https://watermaps.netlify.app/admin/fotos.html`), Passwort eingeben. Acht Reiter:
- **Fotos:** Foto ansehen, **Freigeben** oder **Ablehnen**. Freigeben legt das Bild in `public/photos/` ab und trägt es in `community/overrides.json` ein (Urheber „WaterMap-Community“, Beschreibung als Alternativtext); nach etwa einer Minute ist es in der App. Ohne bestätigte Rechte lässt sich nicht freigeben. Fehlt der Standort („Anderer Standort“), wird der Link aus der App eingefügt.
- **Gemeldet:** Fotos, die Nutzer über „Foto melden“ gemeldet haben (Formular „Fehler melden“, Art „Unpassendes Foto“), mit Grund. **Foto entfernen** nimmt es aus der App und erledigt die Meldung; **Meldung verwerfen** lässt das Foto stehen.
- **Slipanlagen:** neu gemeldete Slipanlagen mit Angaben, Kartenlink und Hinweis auf eine bekannte Slipanlage in der Nähe (unter 300 m = mögliche Dublette). **Freigeben** trägt sie in `community/places.json` ein (ID `c/…`), ein mitgeschicktes Foto nur bei bestätigten Rechten.
- **Preise:** gemeldete Kraftstoffpreise mit Plausibilitätsprüfung (0,50–5,00 €/l, Datum, bekannte Tankstelle) und Beleg. **Freigeben** hängt den Preis an `community/prices.json` an.
- **Ergänzungen:** Angaben zu Slipanlagen aus „Weißt du mehr? Ergänzen“ in der App (Formular „slip-ergaenzen“): Zugang, Gebühr (mit Betrag), Rampe (Belag, Neigung), Trailer parken, Motorboote, Bootsgröße, dazu eine freie Bemerkung. Die Tabelle zeigt „bisher → neu“ (bisher = veröffentlichte Daten). **Übernehmen** trägt die Angaben in `community/overrides.json` ein (bestehender Eintrag des Standorts wird erweitert, Fotos bleiben); **Ablehnen** schließt sie ab. Die Bemerkung wird nicht automatisch übernommen.
- **Hinweise:** Fehler und Hinweise zu Standorten (ohne Foto-Meldungen). Die Korrektur selbst machst du von Hand (am besten in OSM), dann **Erledigt** oder **Verwerfen**. Als unpassend gemeldete Lagemeldungen („Heute vor Ort“, Art „Unpassende Lagemeldung“) haben zusätzlich **Meldung entfernen**: Das löscht die Meldung sofort für alle (im selben Speicher wie die App, Vorschau getrennt von live) und erledigt den Hinweis. Ist sie schon abgelaufen, wird nur der Hinweis erledigt.
- **Veröffentlicht:** alle Fotos in der App, jeweils mit **Entfernen**.
- **Verlauf:** alle Aktionen aller Bereiche (freigegeben, abgelehnt, entfernt, erledigt, verworfen) mit Zeit, Standort, Beschreibung und Grund, die neuesten 500. Gespeichert in `admin/verlauf.json` im Repository – außerhalb von `public/`, also nicht über die Website abrufbar.

Jede Aktion ist **ein** Commit (Daten und Verlauf zusammen). Commits, die nur den Verlauf ändern („Foto abgelehnt“, „Foto-Meldung verworfen“, „Slipanlage abgelehnt“, „Preis abgelehnt“, „Hinweis erledigt“, „Hinweis verworfen“), lösen keinen Netlify-Deploy aus (`netlify.toml`, `ignore`). Erledigte Einreichungen und Meldungen werden in Netlify Forms gelöscht.

**Einmalig einrichten** (Netlify → *Site configuration* → *Environment variables*, danach einmal neu veröffentlichen):
| Variable | Wert |
|---|---|
| `FOTO_ADMIN_PASSWORT` | ein langes, frei gewähltes Passwort |
| `NETLIFY_API_TOKEN` | Netlify → *User settings* → *Applications* → *Personal access tokens* → *New access token* |
| `GITHUB_TOKEN` | GitHub → *Settings* → *Developer settings* → *Fine-grained tokens*: nur Repository `watermap`, Berechtigung *Contents: Read and write* |
| `FOTO_BRANCH` (optional) | Zweig, in den Freigaben auf der Live-Seite geschrieben werden; Standard `main`. Auf einer Vorschau (z. B. deploy-preview-4) schreibt die Verwaltung immer in den Zweig dieser Vorschau. |

## Besondere Fälle
- **Doppelte Slipanlage:** Existiert sie schon in OSM, trage die neuen Angaben als Override zur OSM-ID ein statt einen neuen Standort anzulegen. Besser noch: in OpenStreetMap selbst ergänzen – dann profitieren alle.
- **„Standort existiert nicht mehr“:** Erst prüfen (mehrere Meldungen? Luftbild?). Dann in OSM korrigieren; beim nächsten Import verschwindet er. Bis dahin Hinweis per `description` im Override.
- **Standort bei Meldungen:** Foto, Korrektur und Preis beziehen sich immer auf einen Standort, den man in der App auf der Karte antippt (keine Auswahlliste). Nur „Fehler oder Hinweis melden“ geht auch ohne Standort (`standort_id` = `__other`). Ältere Meldungen können noch `__other` mit freiem Namen enthalten.
- **Fotos:** Nur mit Urheberangabe (`credit`) veröffentlichen. Die App entfernt GPS/EXIF schon vor dem Senden; Dateinamen nach dem Muster `node-123-1.jpg` vergeben.

## Grenzen von Phase 1 (bewusst)
- Prüfungen im Browser (Dateityp an den Dateiinhalten, Größe, Preisbereich, EXIF-Entfernung) können von Angreifern umgangen werden. Das ist unkritisch, solange **du jede Datei selbst ansiehst, bevor sie auf die Seite kommt**. Eine serverseitige Prüfung und ein Admin-Bereich sind für V8 vorgesehen.
- Netlify Forms speichert Uploads, prüft aber keine Inhalte.

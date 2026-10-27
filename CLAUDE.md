# WaterMap – Hinweise für Claude

Projektstand, Architektur, Entscheidungen und offene Aufgaben: **`watermap-stand.md`** (zuerst lesen).

## Arbeitsregeln (vom Nutzer festgelegt)
- Antworten auf Deutsch, kurz.
- Nur als **Vorschau** veröffentlichen (Branch `claude/oms-daten-aktualisieren-0bc073`, PR #4, https://deploy-preview-4--watermaps.netlify.app). PR zusammenführen **nur**, wenn der Nutzer „übernehmen“ sagt.
- Nur kostenlose Dienste.
- API-Schlüssel und Secrets nie im Chat erzeugen oder erfragen; der Nutzer trägt sie selbst in Netlify ein.
- Vor größeren Änderungen an der Oberfläche erst einen Plan zeigen oder Rückfragen stellen. Ist etwas unklar: fragen.
- Keine neuen PRs ohne Auftrag.

## Bei jeder App-Änderung
- Version erhöhen: `VERSION` in `public/js/config.js` **und** `public/sw.js`; neue Dateien in `SHELL_FILES` (`sw.js`) eintragen.
- Tests laufen lassen (siehe README „Tests“), bei Oberflächen 375/390/1024/1440 px prüfen.
- Commit-Nachricht auf Deutsch mit Version, z. B. „Pegel-Dashboard (7.19.0)“.

## Tests in der Cloud-Umgebung
- Playwright: Chromium unter `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` (nicht `playwright install`). Die Tests rufen `chromium.launch(` ohne Pfad auf – dafür eine Kopie mit `executable_path=` im Scratchpad ausführen.
- `ui_smoke.py` und `pwa_test.py` brauchen einen Server auf Port 8765: `(cd public && setsid python3 -m http.server 8765 &)`.
- Achtung: `pkill -f "http.server 876…"` trifft auch die eigene Shell, wenn das Muster im selben Befehl steht – in ein Skript auslagern.
- JS-Syntax prüfen: Datei als `.mjs` kopieren, `node --check`.
- Leaflet-Ersatz für Tests: `tests/stub/leaflet-stub.js` (fehlende Methoden dort ergänzen, nicht die App verbiegen).

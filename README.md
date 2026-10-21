# WaterMap V7 – Dein Revier. Deine Karte.

Interaktive Karte für Slipanlagen, Marinas und Bootstankstellen in ganz Deutschland.
Statische Web-App (HTML/CSS/JavaScript, Leaflet), kostenlos auf Netlify betreibbar, installierbar als PWA.

## In 3 Schritten online
1. **Ordner `public` bei Netlify hochladen** (Netlify → *Add new site → Deploy manually* → Ordner `public` hineinziehen).
2. **Impressum und Datenschutz ausfüllen** (`public/impressum.html`, `public/datenschutz.html`; gelb markierte Stellen).
3. **Formulare prüfen:** Netlify → *Forms* → vier Formulare müssen erscheinen (`slipanlage-melden`, `tankpreis-melden`, `foto-einreichen`, `fehler-melden`).

Details: [docs/INSTALLATION.md](docs/INSTALLATION.md)

## Daten
Die Standorte für **ganz Deutschland** (16 Bundesländer) kommen per Import aus OpenStreetMap – Stand Oktober 2026: 6045 Standorte (3301 Slipanlagen, 2602 Marinas, 142 Bootstankstellen), mit Ort und Gewässer. Der Import dauert etwa 1,5 Stunden und läuft so:

- Windows: Doppelklick auf `Daten-aktualisieren.bat`
- Mac/Linux: `sh daten-aktualisieren.sh`
- Automatisch jeden Monat: [GitHub Action](.github/workflows/update-osm-data.yml)

Details: [docs/DATEN-AKTUALISIEREN.md](docs/DATEN-AKTUALISIEREN.md). Fehlt ein Bundesland, weil die Overpass-Server ausfallen, bricht der Import ab und die alten Daten bleiben.

## Pegel-Ampel
Eigene Seite unter `/pegel-ampel` (`public/pegel-ampel.html`, `js/ampel.js`, Logik in `js/ampel-logik.js`): Pegel wählen, persönlichen Mindestpegel eingeben → Grün/Gelb/Rot mit Trend, 14-Tage-Verlauf und den nächsten Slipanlagen. Puffer (20 cm), Trendschwelle und Prognosezeitraum stehen als Konstanten oben in `ampel-logik.js`. Weitere Prüfungen (z. B. Brücken) werden an `PRUEFUNGEN` angehängt. Teilbare Links: `/pegel-ampel?pegel=<PEGELONLINE-UUID>&min=<cm>`.

## Ordner
| Pfad | Inhalt |
|---|---|
| `public/` | Die Web-App (das wird veröffentlicht) |
| `public/js/` | Programmcode: `main.js` (Ablauf), `map.js` (Leaflet), `data.js`, `model.js`, `forms.js`, `detail.js`, `search.js`, `icons.js`, `config.js` |
| `public/data/osm/` | Standorte aus OpenStreetMap (GeoJSON, wird vom Import überschrieben) |
| `public/data/community/` | Geprüfte Community-Daten (wird **nie** vom Import überschrieben) |
| `scripts/` | `import_osm.py`, `validate_data.py`, `submissions_to_json.py`, `vendor_libs.py` |
| `tests/` | Automatische Tests |
| `docs/` | Anleitungen, Datenschema, Moderation, Status |

## Tests
```
python3 -I -m unittest discover -s tests -v     # Importer, Validator, Moderationsskript
python3 -I tests/ui_full.py                     # Oberfläche (braucht: pip install playwright pillow)
python3 -I tests/ui_ampel.py                    # Pegel-Ampel
```
Die Oberflächentests laufen mit einem Leaflet-Ersatz. Siehe [docs/STATUS.md](docs/STATUS.md) für das, was damit **nicht** geprüft ist.

## Lizenzen und Quellen
Kartendaten und Standorte © OpenStreetMap-Mitwirkende, [ODbL 1.0](https://www.openstreetmap.org/copyright). Die Namensnennung steht in der Karte und in jeder Standortansicht. Leaflet (BSD-2) und Leaflet.markercluster (MIT) werden eingebunden.

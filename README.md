# WaterMap V7 – Dein Revier. Deine Karte.

Interaktive Karte für Slipanlagen, Marinas und Bootstankstellen in Nordrhein-Westfalen.
Statische Web-App (HTML/CSS/JavaScript, Leaflet), kostenlos auf Netlify betreibbar, installierbar als PWA.

## In 3 Schritten online
1. **Ordner `public` bei Netlify hochladen** (Netlify → *Add new site → Deploy manually* → Ordner `public` hineinziehen).
2. **Impressum und Datenschutz ausfüllen** (`public/impressum.html`, `public/datenschutz.html`; gelb markierte Stellen).
3. **Formulare prüfen:** Netlify → *Forms* → vier Formulare müssen erscheinen (`slipanlage-melden`, `tankpreis-melden`, `foto-einreichen`, `fehler-melden`).

Details: [docs/INSTALLATION.md](docs/INSTALLATION.md)

## Daten: wichtigster offener Punkt
Im ZIP stecken **nur die 8 echten Slipanlagen aus V6**. Der Import für **ganz Deutschland** (16 Bundesländer, 30 bis 90 Minuten) konnte in der Entwicklungsumgebung nicht ausgeführt werden (kein Zugriff auf die Overpass-API). Auf deinem Rechner oder per GitHub Action läuft er mit einem Klick (ein erster Lauf nur für NRW lief per GitHub Action erfolgreich: 582 Standorte):

- Windows: Doppelklick auf `Daten-aktualisieren.bat`
- Mac/Linux: `sh daten-aktualisieren.sh`
- Automatisch jeden Monat: [GitHub Action](.github/workflows/update-osm-data.yml)

Details: [docs/DATEN-AKTUALISIEREN.md](docs/DATEN-AKTUALISIEREN.md). Solange der Import nicht lief, zeigt die App das offen an – es werden keine Daten erfunden.

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
```
Die Oberflächentests laufen mit einem Leaflet-Ersatz. Siehe [docs/STATUS.md](docs/STATUS.md) für das, was damit **nicht** geprüft ist.

## Lizenzen und Quellen
Kartendaten und Standorte © OpenStreetMap-Mitwirkende, [ODbL 1.0](https://www.openstreetmap.org/copyright). Die Namensnennung steht in der Karte und in jeder Standortansicht. Leaflet (BSD-2) und Leaflet.markercluster (MIT) werden eingebunden.

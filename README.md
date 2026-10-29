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

„Heute vor Ort“: Lagemeldungen (24 h sichtbar) über `netlify/functions/meldungen.mjs` + Netlify Blobs – Einrichtung in `docs/HEUTE-VOR-ORT.md`.

„In der Nähe“ (500 m um einen Standort) fragt Campingplätze, Parkplätze, Toiletten, Gastronomie, Supermärkte und Schleusen live bei OpenStreetMap ab (direkt aus dem Browser bei overpass-api.de; Rückfall: Netlify-Funktion `netlify/functions/umgebung.mjs` mit Ausweich-Servern); der Import liefert Brücken, Wehre, Kanu-Einstiege und Verleihe und dient als Rückfall.

Details: [docs/DATEN-AKTUALISIEREN.md](docs/DATEN-AKTUALISIEREN.md). Fehlt ein Bundesland, weil die Overpass-Server ausfallen, bricht der Import ab und die alten Daten bleiben.

## Pegel
Bereich „In der Nähe“ unter `#naehe` (`js/naehe.js`, Stil `css/naehe.css`; alter Link `#liste` geht weiter): Standorte im Umkreis von 25 km (bei weniger als 5 Treffern 50 bzw. 100 km) um „Meine Position“, die Kartenmitte oder einen gesuchten Ort. Die Standortfreigabe wird vorher geprüft (Permissions API); der Browser-Dialog kommt erst auf „Position verwenden“. Gespeichert wird nur die Wahl des Bezugspunkts, nie die Position; der Ortsname kommt lokal aus den WaterMap-Daten.

Bereich „Pegel“ unter `#pegel` (`js/pegel-dashboard.js`, Darstellung `js/pegel-ansicht.js`, Daten `js/pegel-daten.js`, Stil `css/pegel.css`): Lage heute, „Meine Pegel“ (eigene Liste im Browser, getrennt von den Favoriten), Flüsse im Überblick, alle Pegel als Tabelle. Detailseite `#pegel/<UUID>`; Pegel auf der Karte `#karte/pegel/<UUID>` (alter Link `#g=<UUID>` geht weiter). Eine gemeinsame Stationsliste für Karte und Dashboard, alle 15 Min. aktualisiert; Verläufe nur für sichtbare Karten und die Detailseite. Offline: letzter gespeicherter Stand mit „Stand von …“. Flussseite `#pegel/fluss/<name>` (`js/pegel-fluss.js` Logik, `js/pegel-fluss-ansicht.js` Darstellung): Profil des Wasserstands entlang des Flusses und alle Pegel nach Flusskilometer; Küstengewässer laut `CONFIG.PEGEL_KUESTE`.

## Pegel-Ampel
Eigene Seite unter `/pegel-ampel` (`public/pegel-ampel.html`, `js/ampel.js`, Logik in `js/ampel-logik.js`): Pegel wählen, persönlichen Mindestpegel eingeben → Grün/Gelb/Rot mit Trend, 14-Tage-Verlauf und den nächsten Slipanlagen. Puffer (20 cm), Trendschwelle und Prognosezeitraum stehen als Konstanten oben in `ampel-logik.js`. Weitere Prüfungen (z. B. Brücken) werden an `PRUEFUNGEN` angehängt. Teilbare Links: `/pegel-ampel?pegel=<PEGELONLINE-UUID>&min=<cm>`.

**E-Mail-Alarm:** `netlify/functions/pegel-alarm.mjs` (Anmeldung mit Double-Opt-in) und `pegel-alarm-pruefen.mjs` (stündlich), Mails über Brevo (kostenlos). Einrichtung: [docs/PEGEL-ALARM.md](docs/PEGEL-ALARM.md).

## Ordner
| Pfad | Inhalt |
|---|---|
| `public/` | Die Web-App (das wird veröffentlicht) |
| `public/js/` | Programmcode: `main.js` (Ablauf), `map.js` (Leaflet), `data.js`, `model.js`, `forms.js`, `detail.js`, `search.js`, `icons.js`, `config.js` |
| `public/data/osm/` | Standorte aus OpenStreetMap (GeoJSON, wird vom Import überschrieben) |
| `public/data/community/` | Geprüfte Community-Daten (wird **nie** vom Import überschrieben) |
| `netlify/` | Netlify-Funktionen (Foto-Verwaltung, Pegel-Alarm); `package.json` nur dafür |
| `scripts/` | `import_osm.py`, `validate_data.py`, `submissions_to_json.py`, `vendor_libs.py` |
| `tests/` | Automatische Tests |
| `docs/` | Anleitungen, Datenschema, Moderation, Status |

## Tests
```
python3 -I -m unittest discover -s tests -v     # Importer, Validator, Moderationsskript
python3 -I tests/ui_full.py                     # Oberfläche (braucht: pip install playwright pillow)
python3 -I tests/ui_ampel.py                    # Pegel-Ampel
python3 -I tests/ui_pegel_dashboard.py          # Pegel-Tab: Liste/Karte, Suche, Lage-Satz, Wochenende (375/390/1024/1440 px)
python3 -I tests/ui_pegel_fluss.py              # Fluss-Kacheln, Flussseite, Tidepegel mit BSH-Vorhersage (375/390/1024/1440 px)
python3 -I tests/ui_naehe.py                    # „In der Nähe“ (Bezugspunkt, Standortfreigabe, Liste; 375/390/1024/1440 px)
python3 -I tests/ui_bereiche.py                 # Navigation, „Aktuelle Meldungen“, „Mehr“, Merkliste (360–1440 px)
python3 -I tests/ui_einstellungen.py            # „Mein WaterMap“ (Einstellungen; 375/390/1024/1440 px)
python3 -I tests/ui_wischen.py                   # Wischen nach unten schließt Fenster von unten (Filter, Melden, Standort, Wetter; echte Touch-Ereignisse)
python3 -I tests/ui_nav.py                      # schwebende Navigationsleiste (Handy; 375/390 px): Glas, Markierung, Abzeichen, Langdruck, nichts verdeckt
python3 -I tests/ui_gebiet.py                   # Kartengebiet Deutschland mit echtem Leaflet (Zoom, Ziehen, Suche, Standort)
node tests/gebiet_test.mjs                      # Kartengebiet: Punkte, Suchtreffer, Kacheln
node tests/foto_kategorien_test.mjs             # Foto-Kategorien: Zuordnung, Filter
node tests/nav_test.mjs                        # Navigation: Beschriftung, Abzeichen-Zahl, „neu“-Zählung
```
Die Oberflächentests laufen mit einem Leaflet-Ersatz. Siehe [docs/STATUS.md](docs/STATUS.md) für das, was damit **nicht** geprüft ist.

## Lizenzen und Quellen
Kartendaten und Standorte © OpenStreetMap-Mitwirkende, [ODbL 1.0](https://www.openstreetmap.org/copyright). Die Namensnennung steht in der Karte und in jeder Standortansicht. Leaflet (BSD-2) und Leaflet.markercluster (MIT) werden eingebunden.
Pegel: WSV/PEGELONLINE. Gezeitenvorhersage: BSH, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.de) – über `/api/gezeiten` (Abschalten: `GEZEITEN_BSH_AKTIV` in `config.js` oder Umgebungsvariable `GEZEITEN_BSH_AUS=1`; Kontakt im User-Agent: `WATERMAP_KONTAKT`), siehe `docs/BSH-Klaerung.md`.

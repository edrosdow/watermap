# OSM-Daten aktualisieren (Import für ganz Deutschland)

Der Import holt `leisure=slipway`, `leisure=marina` und `waterway=fuel` (plus passende `seamark:*`-Tags) für ganz Deutschland aus OpenStreetMap, prüft sie, fasst Dubletten zusammen und schreibt sie nach `public/data/osm/`. Danach `public/data/meta.json` mit Datum, Zahlen und Quelle.

## Drei Wege

### A) Doppelklick (kein Technikwissen)
Voraussetzung: [Python 3](https://www.python.org/downloads/) installiert, Internetverbindung.
- **Windows:** `Daten-aktualisieren.bat` doppelklicken.
- **Mac/Linux:** im Terminal `sh daten-aktualisieren.sh`.

Dauer: bei ganz Deutschland **etwa 30 bis 90 Minuten**, weil die 16 Bundesländer nacheinander und mit Pausen abgefragt werden (die öffentlichen Overpass-Server drosseln bei Last). Das Fenster dabei offen lassen. Am Ende steht „Fertig“, danach `public` bei Netlify neu hochladen.

### B) Automatisch (GitHub Action)
Mit Variante B aus der Installationsanleitung (Git-Verbindung): Die Datei `.github/workflows/update-osm-data.yml` läuft am 1. jedes Monats und auf Knopfdruck (*GitHub → Actions → OSM-Daten aktualisieren → Run workflow*). Sie testet, importiert, prüft und committet nur, wenn sich etwas geändert hat. Netlify veröffentlicht automatisch.

### C) Von Hand über Overpass Turbo (wenn das Skript keinen Zugriff hat)
1. https://overpass-turbo.eu öffnen, die Abfrage aus `scripts/import_osm.py` (Funktion `queries`, Eintrag `main`) einfügen, *Run*, dann *Export → raw OSM data (JSON)* speichern.
2. `python3 scripts/import_osm.py --input gespeicherte-datei.json`

## Optionen
| Option | Wirkung |
|---|---|
| `--dry-run` | rechnen und berichten, nichts schreiben |
| `--no-enrich` | keine Zuordnung von Ort und Gewässer (schneller, weniger Abfragen) |
| `--input DATEI` | gespeicherte Overpass-Antwort statt Live-Abruf |
| `--force` | Schutz gegen Datenverlust übergehen |
| `--area DE` | Standard: ganz Deutschland, Bundesland für Bundesland |
| `--area DE-NW` | nur ein Bundesland; mehrere mit Komma: `DE-NW,DE-NI` |
| `--area AT --bbox 46.3,9.5,49.1,17.2` | anderes Land; `--bbox` (süd,west,nord,ost) ist dann Pflicht |

## Was der Import garantiert
- **Nichts wird erfunden.** Was OSM nicht eindeutig sagt, bleibt `null` und erscheint als „Nicht bekannt“. Werte wie `fee=donation` werden nicht zu „Nein“.
- **Fällt der Abruf aus, bleiben die alten Dateien unverändert** (Exit-Code 2). Schlägt die Standort-Abfrage auch nur eines Bundeslandes fehl, wird nichts geschrieben, damit kein Bundesland stillschweigend fehlt. Fehlen nur Ort oder Gewässer für ein Bundesland, läuft der Import weiter, und `meta.json` nennt unter `enrichment` die betroffenen Länder.
- **Datenverlust-Schutz:** Liefert ein Lauf weniger als die Hälfte der bisherigen Datensätze einer Kategorie, wird nichts überschrieben (Exit-Code 3).
- **Community-Daten bleiben getrennt** (`public/data/community/`) und werden nie angefasst.
- **Dubletten:** Objekte derselben Kategorie, die nah beieinander liegen und gleich oder einseitig unbenannt sind (Slipanlage ≤ 25 m, Marina ≤ 150 m, Tankstelle ≤ 60 m), werden zusammengeführt; Angaben fehlender Felder werden aus dem Duplikat ergänzt. Verschieden benannte Objekte bleiben getrennt. Die zusammengeführten IDs stehen in `also_osm`.
- **Verworfen:** Koordinaten außerhalb des Gültigkeitsbereichs (Deutschland), stillgelegte Objekte (`disused`, `abandoned`), Objekte ohne Position.
- **Ort und Gewässer sind Näherungen:** Fehlt `addr:city`, wird der nächste Ort (≤ 10 km) als „bei …“ angezeigt. Das nächste benannte Gewässer (≤ 80 m) erscheint als „Gewässer in der Nähe“. Beides ist in den Daten (`locality_kind`, `water.approx`) und in der App als automatisch gekennzeichnet.

## Danach prüfen
```
python3 scripts/validate_data.py
```
Prüft Schema, Koordinatenbereiche, doppelte IDs, Preisgrenzen u. a. Warnungen („ohne Namen“) sind normal – viele OSM-Slipanlagen haben keinen Namen.

## Lizenz (ODbL) und Namensnennung
OSM-Daten stehen unter der [ODbL 1.0](https://www.openstreetmap.org/copyright). Pflichten, die die App erfüllt: sichtbare Namensnennung „© OpenStreetMap-Mitwirkende“ in der Karte, in jeder Standortansicht und im Impressum, Link zur Lizenz, Kennzeichnung des Datenstands. Die Standortdateien selbst sind eine abgeleitete Datenbank und müssen bei Weitergabe wieder unter ODbL stehen. Bei Zweifeln (z. B. Kombination mit eigenen Daten, Werbung) Lizenzrat einholen: https://osmfoundation.org/wiki/Licence/Licence_and_Legal_FAQ.

## Hinweise zu Overpass
Die öffentlichen Server sind Gemeinschaftsressourcen. Nicht öfter als nötig abrufen (monatlich reicht), keine Abrufe bei jedem Seitenaufruf. Die App selbst ruft Overpass nie auf – sie lädt nur die vorbereiteten Dateien.

# Gezeiten vom BSH – Stand der Klärung

Ziel: Gezeitenvorhersage (Hoch-/Niedrigwasser-Zeiten, Vorhersagekurve) des Bundesamts für Seeschifffahrt und Hydrographie (BSH)
für die Tidepegel in WaterMap anzeigen – abgerufen nur serverseitig über eine eigene Netlify Function, nie direkt aus dem Browser.

## 1. Was bisher bekannt ist (Websuche, Oktober 2026 – nicht selbst abgerufen)
- Das BSH nennt eine maschinenlesbare Schnittstelle: `https://gdi.bsh.de/ldproxy/rest/services/WaterLevelForecast`
  (Wasserstandsvorhersage Nord- und Ostsee, Gezeitenvorausberechnung 7 Tage).
- Nutzeranwendung: `https://wasserstand.bsh.de/` (Nord- und Ostsee), Gezeiten: `https://gezeiten.bsh.de/`.
- Aktualisierung der Nordsee-Vorhersage laut BSH: 1, 8, 14 und 20 Uhr.
- Eine Home-Assistant-Integration nutzt die Felder `hwnw_forecast` (Zeit, Wert, HW/NW) und `curve_forecast` (Kurve) – Stand etwa 2025.

## 2. Prüf-Funktion (nur Vorschau)
`/api/gezeiten/probe` (netlify/functions/gezeiten-probe.mjs) ruft einmalig auf:
- `…/WaterLevelForecast?f=json` und `…/WaterLevelForecast/collections?f=json`
- je Sammlung `…/collections/<id>/items?f=json&limit=2` (höchstens 6 Sammlungen)
- die HTML-Seiten `wasserstand.bsh.de` und `gezeiten.bsh.de` sowie bis zu drei ihrer Skripte (nur, um die Datenadressen zu sehen)

Kennung (User-Agent): `WaterMap/1.0 (+https://watermaps.netlify.app; Pruefung BSH-Datenabruf; <WATERMAP_KONTAKT>)`.
Auf der Live-Seite (`CONTEXT=production`) antwortet sie mit 404. Kein Zwischenspeicher.

## 3. Offen – nach Auswertung der Prüf-Funktion ergänzen
- genutzte Adressen und Parameter, Format
- Orte (BSH-Kennung ↔ PEGELONLINE-Pegel)
- Zeitraum der Vorhersage, Aktualisierung
- Nutzungsbedingungen / Lizenz, Quellenangabe
- geplante Häufigkeit: höchstens 1 Abruf pro Ort und Stunde (Zwischenspeicher), Anzeigeorte: Tidepegel-Detailseite, Flussseite (Tide-Zeile), Dashboard-Kachel „Küste“, „Meine Pegel“

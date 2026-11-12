# Gezeiten vom BSH – Stand der Klärung

Ziel: Gezeitenvorhersage (Hoch-/Niedrigwasser-Zeiten, Vorhersagekurve) des Bundesamts für Seeschifffahrt und Hydrographie (BSH)
für die Tidepegel in WaterMap anzeigen – abgerufen nur serverseitig über eine eigene Netlify Function, nie direkt aus dem Browser.

## 1. Was bisher bekannt ist (Websuche, Oktober 2026 – nicht selbst abgerufen)
- Das BSH nennt eine maschinenlesbare Schnittstelle: `https://gdi.bsh.de/ldproxy/rest/services/WaterLevelForecast`
  (Wasserstandsvorhersage Nord- und Ostsee, Gezeitenvorausberechnung 7 Tage).
- Nutzeranwendung: `https://wasserstand.bsh.de/` (Nord- und Ostsee), Gezeiten: `https://gezeiten.bsh.de/`.
- Aktualisierung der Nordsee-Vorhersage laut BSH: 1, 8, 14 und 20 Uhr.
- Eine Home-Assistant-Integration nutzt die Felder `hwnw_forecast` (Zeit, Wert, HW/NW) und `curve_forecast` (Kurve) – Stand etwa 2025.

## 2. Prüf-Funktion (nur Vorschau, inzwischen entfernt)
`/api/gezeiten/probe` (netlify/functions/gezeiten-probe.mjs) ruft einmalig auf:
- `…/WaterLevelForecast?f=json` und `…/WaterLevelForecast/collections?f=json`
- je Sammlung `…/collections/<id>/items?f=json&limit=2` (höchstens 6 Sammlungen)
- die HTML-Seiten `wasserstand.bsh.de` und `gezeiten.bsh.de` sowie bis zu drei ihrer Skripte (nur, um die Datenadressen zu sehen)

Kennung (User-Agent): `WaterMap/1.0 (+https://watermaps.netlify.app; Pruefung BSH-Datenabruf; <WATERMAP_KONTAKT>)`.
Auf der Live-Seite (`CONTEXT=production`) antwortet sie mit 404. Kein Zwischenspeicher.

## 3. Ergebnis der Prüf-Funktion (24.10.2026)
**Adressen**
- Ort: `https://gdi.bsh.de/ldproxy/rest/services/WaterLevelForecast/collections/waterlevelforecastdata/items/<kennung>?f=json`
  (z. B. `cuxhaven_steubenhoeft`), etwa 45 KB.
- Ortsliste: `…/items?f=json&limit=100` (+ `offset=100`, Verweis `links[rel=next]`), insgesamt 136 Orte (Nord- und Ostsee).
  `limit=200` → **400** (höchstens 100 je Seite). Eine Seite mit allen Feldern ≈ 4,6 MB – deshalb zuerst mit
  `properties=gauge_label,operator_gauge_id,measurement_url,region` (bei 400 ohne Feldauswahl).

**Felder eines Orts (properties)**
- `gauge_label`, `area`, `region` (`north_sea` / `baltic_sea`), `state`, `latitude`, `longitude`
- `operator_gauge_id` = PEGELONLINE-Pegelnummer (bei manchen Orten andere Kennungen wie `03127.0`, `nan`)
- `measurement_url` = PEGELONLINE-Link mit `#detail?id=<UUID>` (nicht bei allen Orten)
- `mean_high_water`, `mean_low_water` (cm am Pegel; Cuxhaven 656/366 ≈ PEGELONLINE MThw 655/MTnw 363)
- `gaugezero_relative_to_nhn` (Cuxhaven −503), `chartdatum_relative_to_gaugezero`
- `forecast_timestamp` (amtliche Vorhersage), `automated_curveforecast_timestamp` (Kurve, stündlich)
- `forecast_text`, `forecast_text_additional`, `information_text`, `copyright` (je `de`/`en`, Text mit `<b>`)
- `licence` = „CC BY 4.0“, `bsh_url_waterlevel`
- `high_water_low_water`: ~23 Ereignisse (~6 Tage): `event_timestamp` („2026-10-24 12:31:00+02:00“), `event` (HW/NW),
  `tidal_prediction_value` (Gezeitenrechnung, Text), für die nächsten ~4 Ereignisse `forecast_value` (amtlich, mit Wind),
  `forecast_uncertainty` (±cm), `forecast_deviation` („+0,5 bis +0,75 m“ – Abweichung zum **mittleren** HW/NW);
  dazu automatische Modellwerte `mos_forecast_r0…r5_value/deviation` (nicht genutzt).
- `curve`: alle 10 Minuten von gestern bis ~6 Tage voraus: `timestamp`, `tidal_prediction`, `measurement` (Vergangenheit),
  `automated_curve_forecast` (ab jetzt).

**Nutzung in WaterMap (7.25.0)**
- Funktion `/api/gezeiten?pegel=<UUID>&nr=<Pegelnummer>` (netlify/functions/gezeiten.mjs, Logik netlify/lib/gezeiten-kern.mjs):
  Zuordnung über Ausnahmeliste (`netlify/lib/gezeiten-orte.mjs`), dann UUID, dann Pegelnummer.
  Antwort: Ereignisse ab 12 h zurück, Kurve −26 h … +30 h, Texte, Stand, Link. `?orte=1`: Liste der BSH-Orte.
- Zwischenspeicher: Ortsliste 24 h (Netlify Blobs „gezeiten“ + Speicher), Vorhersage 1 h im Netlify-CDN
  (`netlify-cdn-cache-control: s-maxage=3600`); „kein Ort“ 24 h; Fehler (502) nie.
- User-Agent `WaterMap/1.0 (+https://watermaps.netlify.app; Gezeitenvorhersage; <WATERMAP_KONTAKT>)`.
- Abschalten: `GEZEITEN_BSH_AKTIV: false` in `public/js/config.js` (App) bzw. Umgebungsvariable `GEZEITEN_BSH_AUS=1` (Server, ohne Deploy).
- Anzeige: Karte „Gezeiten“ auf der Tidepegel-Seite (nächstes HW/NW mit Höhe, amtliche Vorhersage wo vorhanden, sonst
  Gezeitenrechnung; drei weitere Termine), Vorhersage gestrichelt in der Tidekurve (+12 h), „Meine Pegel“ (nächstes HW/NW),
  Flussseite (Tide-Zeile, Liste „HW 14:32“), Küsten-Kachel („Cuxhaven: Hochwasser 14:32“).
- Quellenangabe überall „Gezeitenvorhersage: BSH (CC BY 4.0)“ mit Link, „Angaben ohne Gewähr, nicht für die Navigation“,
  Abschnitt in „Über WaterMap“. Offline: letzte Vorhersage je Pegel bis 24 h mit „Stand von … (offline)“.
- Ostsee: BSH-Orte haben keine Gezeiten-Kennwerte bei PEGELONLINE → keine Tidepegel, dort nur Wasserstand und Trend.

## 4. Offen
- Orte ohne Zuordnung (Prüfliste `pruefung.html`, Abschnitt „BSH-Orte ohne PEGELONLINE-Pegel“) bei Bedarf in
  `netlify/lib/gezeiten-orte.mjs` eintragen.

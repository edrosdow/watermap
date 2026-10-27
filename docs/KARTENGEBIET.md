# Kartengebiet Deutschland (ab 7.29.0, Europa-Übersicht ab 7.30.0)

WaterMap hebt Deutschland hervor; Europa ist zur Orientierung leicht grau zu sehen. Man kann bis zur Europa-Übersicht
herauszoomen und die Karte bis zum Rand Europas verschieben, aber nicht über die Weltkarte navigieren, nicht in fremde
Straßenkarten hineinzoomen (dort gibt es ab Zoom 9 keine Kacheln) und nicht per Suche oder Standort ins Ausland springen.
Hervorgehoben (ohne Schleier) ist nur deutsches Land samt Inseln und Bodensee – Nord- und Ostsee liegen wie die
Nachbarländer unter dem leichten Schleier, damit sie nicht als Fläche „herausleuchten“.

## Was für Suche, Standort und neue Slipanlagen erlaubt ist
- Deutschland mit Küstenmeer (12 sm) – Grenze aus OpenStreetMap, mit Saum von etwa 0,5 km (Grenzflüsse wie Rhein und Oder ganz sichtbar)
- der ganze Bodensee
- die offene Nord- und Ostsee im Umkreis von etwa 65–110 km um das deutsche Gebiet (z. B. Helgoländer Bucht, Kieler und Mecklenburger Bucht, Pommersche Bucht)

Fremdes Land ist abgeblendet – genau an der OSM-Landgrenze, auch fremde Inseln (Texel, Rømø, Lolland …). Seit 7.29.1 bleiben die
Nachbarländer zur Orientierung leicht sichtbar (`CONFIG.GEBIET.nachbarn` = Deckkraft der Abblendung, 0,55; 1 = ganz abgedeckt).
Verschieben und Herauszoomen bleiben trotzdem auf Deutschland begrenzt – fremde Straßenkarten lassen sich nicht erkunden.
Fremde Inselchen unter etwa 2 km² und fremde Binnenseen am Rand werden aus Datengründen nicht einzeln abgedeckt.

## Wie es technisch umgesetzt ist
| Baustein | Datei | Wirkung |
|---|---|---|
| Grenzdaten | `public/data/gebiet-de.json` (≈ 220 KB, gzip ≈ 80 KB) | Ringe des erlaubten Gebiets und die Liste der nötigen Kartenkacheln (z 5–10). Erzeugt mit `scripts/gebiet_de.py`. |
| Rahmen | `CONFIG.GEBIET` in `js/config.js`, `createMap` in `js/map.js` | Leaflet `maxBounds` = Europa (`CONFIG.GEBIET.europa`) mit `maxBoundsViscosity` 0,9: Verschieben (Maus und Finger) stoppt sanft am Rand. `maxBounds` begrenzt auch `setView`, `flyTo`, `fitBounds` und damit `reveal()`, Cluster-Klicks, Deep-Links, Favoriten, Pegel und „In der Nähe“. |
| Kleinster Zoom | `map.js` (`minZoomSetzen`) | `minZoom` = Zoom, bei dem ganz Europa ins Fenster passt, auf sehr breiten Bildschirmen höchstens ≈ 120 Längengrade (je Fenstergröße neu, Viertelstufen `zoomSnap 0.25`). Weiter heraus geht es weder per Knopf noch per Zwei-Finger-Geste. |
| Maske | `map.js` | Ein Leaflet-Polygon „Welt minus erlaubtes Gebiet“ auf eigener Ebene (`wm-maske`, über den Kacheln, unter den Markern), gezeichnet mit dem Canvas-Renderer – flüssig auch auf dem Handy. Grauer Schleier `#D3D6D9` mit Deckkraft `CONFIG.GEBIET.nachbarn` (0,5) über allem außer deutschem Land (`anzeige` in `gebiet-de.json`), deutsche Grenze und Küste als dunkle Linie. |
| Kacheln | `map.js` (`Kacheln`), `js/gebiet.js` (`kachelNoetig`) | Bis z 8 (Übersicht ohne Ortsstraßen) überall, ab z 9 nur bis ≈ 1,5° um Deutschland (`CONFIG.GEBIET.strassenRand`). Mit `nachbarn: 1`: nur Kacheln im Gebiet (Liste in `gebiet-de.json`). |
| Punktprüfung | `js/gebiet.js` (`imGebiet`) | Gerade/ungerade-Regel über alle Ringe (Inseln und Aussparungen stimmen), mit Rechteck-Vorprüfung. |
| Ortssuche | `js/search.js`, `runGeocode`/`goToGeo` in `js/main.js` | Nominatim nur im Rechteck (`viewbox` + `bounded=1`, findet auch Seegebiete ohne Länderkennung). Jeder Treffer muss zusätzlich `imGebiet` erfüllen; große Treffer-Rechtecke werden aufs Gebiet beschnitten. Sonst Hinweis: „WaterMap ist derzeit auf Deutschland sowie die deutschen Nord- und Ostseegebiete begrenzt.“ |
| Eigener Standort | `locate` in `js/main.js` | Standortfreigabe funktioniert weiter; liegt der Standort außerhalb, springt die Karte nicht dorthin, es kommt ein Hinweis. |
| Neue Slipanlage | `pickLocation` in `js/map.js` | Tippen auf abgedecktes Gebiet setzt keinen Punkt, es kommt der Hinweis. |
| Startansicht | `CONFIG.START_MODE = 'germany'` | Ganz Deutschland mit Nord- und Ostseeküste, so groß wie möglich. |

Der Service Worker hält `gebiet-de.json` und `gebiet.js` vor (offline nutzbar).

## Grenzdaten neu erzeugen
Quellen (kostenlos, Lizenz passt zur App):
- geo-maps v0.6.0, OpenStreetMap-Daten, ODbL: `countries-maritime-10m.geo.json`, `countries-land-10m.geo.json`
  (https://github.com/simonepri/geo-maps/releases/tag/v0.6.0)
- Natural Earth, gemeinfrei: `ne_10m_lakes.geojson` (nur der Bodensee)

```
pip install shapely
python3 scripts/gebiet_de.py <ordner-mit-den-drei-dateien>
```
Danach `CONFIG.GEBIET.bounds` mit der ausgegebenen Deutschland-Ausdehnung vergleichen und die Version erhöhen.

## Tests
- `node tests/gebiet_test.mjs` – Orte im/außerhalb des Gebiets (Helgoland, Bodensee, Rhein bei Kehl / Moskau, London, Straßburg, Basel, Stettin …), Beschneiden großer Suchtreffer, Kachelauswahl
- `python3 tests/ui_gebiet.py` – mit dem echten Leaflet bei 390/1024/1440/2560 px: Startansicht, Herauszoomen, Ziehen nach Osten/Westen/Norden (Maus und Finger), Helgoland/Rügen/Bodensee, nur Kacheln im Gebiet, Suche „Moskau“/„London“/„Europa“/„Hamburg“, Standort in Spanien, Slipanlage öffnen

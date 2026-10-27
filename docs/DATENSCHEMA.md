# Datenschema

Grundregel: **Unbekannt ist nie „Nein“.** Fehlt eine Angabe, steht `null`; die App zeigt „Nicht bekannt“, und Filter lassen nur Standorte mit ausdrücklich bestätigter Angabe durch.

## Dateien
```
public/data/
  meta.json                 Datenstand, Quelle, Lizenz, Zähler, Dateiliste
  osm/slip.geojson          Slipanlagen   (Import, wird überschrieben)
  osm/marina.geojson        Marinas       (Import)
  osm/fuel.geojson          Tankstellen   (Import)
  community/places.json     neue Standorte aus der Community (von Hand gepflegt)
  community/overrides.json  freigegebene Korrekturen/Fotos zu vorhandenen Standorten
  community/prices.json     freigegebene Kraftstoffpreise (nur anhängen, nie löschen)
```
OSM-Schicht und Community-Schicht werden erst im Browser zusammengeführt. So kann ein neuer Import nie Community-Wissen überschreiben. Beispiele: `docs/beispiele/`.

## Standort (OSM-Datei: GeoJSON-Feature; Community: flaches Objekt mit `lat`/`lon`)
| Feld | Typ | Bedeutung |
|---|---|---|
| `id` | Text | `node/123`, `way/123`, `relation/123` (OSM) bzw. `c/…` (Community) |
| `type` | `slip` \| `marina` \| `fuel` | Kategorie |
| `name` | Text \| null | Name; ohne Namen zeigt die App „Slipanlage (ohne Namen)“ |
| `locality`, `locality_kind` | Text \| null; `address` \| `nearest` \| `legacy` | Ort; `nearest` = automatisch zugeordnet („bei …“) |
| `water` | `{name, approx, dist_m}` \| null | Gewässer; `approx: true` = automatisch zugeordnet |
| `access` | `public` `permissive` `customers` `members` `permit` `private` \| null | Zugang |
| `fee` | true \| false \| null | Gebühr (true = kostenpflichtig) |
| `fee_note` | Text \| null | Höhe/Beschreibung der Gebühr |
| `opening_hours`, `operator`, `website`, `phone`, `email`, `description` | Text \| null | `website` nur http(s) |
| `osm` | `{type, id, timestamp}` | Herkunft in OSM (Zeitstempel der letzten Bearbeitung) |
| `also_osm` | Liste | zusammengeführte Dubletten |
| `imported`, `updated` | Datum | Importtag; letzte Aktualisierung (OSM-Bearbeitung oder Importtag) |
| `source` | `osm` \| `community` | Herkunft |
| `attrs` | Objekt | kategoriespezifisch (unten); jeder Wert true/false/null bzw. Text/Zahl/null |

### `attrs` je Kategorie
- **Slipanlage:** `surface`, `incline` (Text), `motorboat`, `parking`, `trailer_parking` (true/false/null), `suitable_boats`, `suitable_trailers` (Text; nur Community)
- **Marina:** `berths` (Zahl), `visitor_berths`, `electricity`, `water_tap`, `toilets`, `showers`, `restaurant`, `harbour_master` (true/false/null), `berth_fee` (Text)
- **Tankstelle:** `diesel`, `petrol`, `reach_water`, `reach_land` (true/false/null), `payment` (Liste)

Welche OSM-Tags in welche Felder fließen, steht in `scripts/import_osm.py` (Funktionen `_slip`, `_marina`, `_fuel`). OSM kennt für Trailerparkplatz, Erreichbarkeit und Preise keinen verlässlichen Standard-Tag – diese Felder kommen nur aus der Community-Schicht.

## Community-Dateien
**`places.json`** – neuer Standort: wie oben, plus `status` (`pending` \| `approved` \| `rejected`) und `submitted`. Nur `approved` wird angezeigt.

**`overrides.json`** – Korrektur: `{ "id": "node/…", "status": "approved", "fields": {…}, "attrs": {…}, "photos": [{ "url": "photos/…jpg", "credit": "…", "alt": "…", "kategorie": "rampe" }], "updated": "JJJJ-MM-TT" }`. Änderbare `fields`: name, locality, access, fee, fee_note, opening_hours, operator, website, phone, email, description, lat+lon. Fotos müssen unter `public/photos/` liegen. `kategorie` (optional bei älteren Fotos): rampe, steg, zufahrt, parkplatz, umgebung, sonstiges (`public/js/foto-kategorien.js`).

**`prices.json`** – Preismeldung: `{ "station_id": "node/…", "fuel": "diesel" \| "petrol", "price": 2.189, "observed": "JJJJ-MM-TT", "status": "approved", "submitted": "…" }`. Die App zeigt je Tankstelle und Kraftstoff die **neueste freigegebene** Meldung mit Datum. Ältere bleiben zur Nachvollziehbarkeit stehen. Preise außerhalb 0,50–5,00 €/l werden nie angezeigt. Ab 14 Tagen Alter erscheint ein Hinweis auf mögliche Veraltung (`PRICE_STALE_DAYS` in `config.js`).

`python3 scripts/validate_data.py` prüft alle Dateien.

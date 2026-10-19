#!/bin/sh
# WaterMap: OSM-Daten für Deutschland aktualisieren (dauert 30-90 Minuten) (macOS/Linux). Start: sh daten-aktualisieren.sh
cd "$(dirname "$0")" || exit 1
python3 scripts/import_osm.py && python3 scripts/validate_data.py && echo "\nFertig. Jetzt den Ordner 'public' bei Netlify neu hochladen."

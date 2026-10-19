# Status WaterMap V7 – was fertig ist, was nicht

Stand: Oktober 2026. Ehrliche Übersicht gegenüber dem Master-Prompt.

## Fertig und getestet
- Responsive Oberfläche (Desktop: Seitenpanel + Detailpanel, Smartphone: Vollbildkarte, Bottom Sheets), Farben und Header laut Master-Prompt.
- Eigene SVG-Marker: Slipanlage (Boot auf schräger Rampe, türkis), Marina (Anker, blau), Bootstankstelle (Zapfsäule, orange).
- Daten: OSM-Schicht und Community-Schicht getrennt, zusammengeführt im Browser; Schema-Validierung; Überschreibschutz.
- Filter nach Kategorie und Eigenschaften – nur auf bestätigten Daten; Zähler je Filter; Leerzustände.
- Suche: lokal (Name, Ort, Gewässer) plus Ortssuche (Nominatim, nur auf Nutzeraktion).
- Detailansicht mit „Nicht bekannt“, Preisen mit Datum und Veraltungshinweis, Navigation, Teilen (Deep-Link), Favoriten (lokal), Fehler melden, Foto, Preis.
- Hinweis: Straßenroute ≠ Wasserroute.
- Standortfreigabe freiwillig, Karte bleibt ohne sie voll nutzbar.
- Community-Formulare (Netlify Forms): Pflichtfelder, Prüfung auf nahe Slipanlage, Foto-Prüfung am Dateiinhalt, Größenlimit, EXIF/GPS-Entfernung, Rechte-Bestätigung, Honeypot, Fehlerbehandlung mit erhaltenen Eingaben.
- Fehlerfälle: Kartenmodul nicht ladbar, Dateien fehlen/kaputt, alle Daten fehlen (Wiederholen-Knopf), offline.
- PWA: Manifest, Icons, Service Worker; Standortdaten offline lesbar (getestet).
- OSM-Importer (Overpass) mit Dublettenbereinigung, Ort/Gewässer-Zuordnung, Verlustschutz, Offline-Eingabe (`--input`), Tests inkl. Mutationsprüfung.
- GitHub Actions: monatlicher Import, Prüfung bei jedem Push.
- Sicherheits-Header (CSP u. a.), kein HTML aus Daten (XSS getestet), keine Schlüssel im Frontend.
- Rechtstexte als Vorlagen, OSM-Namensnennung.

## Nicht gemacht oder nicht geprüft
| Punkt | Stand |
|---|---|
| **Vollständiger NRW-Import** | **Nicht ausgeführt.** In der Entwicklungsumgebung war Overpass gesperrt. Der Importer ist gegen ein synthetisches Fixture getestet, **nicht gegen die echte Overpass-API**. Im Ordner sind weiterhin nur die 8 Slipanlagen aus V6. Erster Lauf bei dir: Ergebnisse stichprobenartig mit OSM vergleichen. |
| **Echte Kartendarstellung** | Die Oberflächentests nutzten einen Leaflet-Ersatz. Leaflet/MarkerCluster und die Kacheln wurden **nicht** im Browser mit echtem Leaflet getestet. Der Code folgt der Leaflet-1.9-API; nach dem ersten Deploy bitte Karte, Clustering, Marker-Klick, Standortwahl und Zoom auf echtem Gerät durchklicken. |
| CSP | Strenge Richtlinie. Die App wurde im Test mit exakt diesen Headern ausgeliefert (Leaflet-Ersatz, keine Verstöße), aber nicht mit echtem Leaflet und echten Kacheln. Falls nach dem Deploy die Karte leer bleibt: Browser-Konsole öffnen, geblockte Domains in `public/_headers` ergänzen. |
| Kartenlibraries selbst gehostet | Skript vorhanden (`vendor_libs.py`), nicht ausgeführt (kein Netzzugriff). |
| Netlify Forms live | Formulare sind vorbereitet und Felder abgeglichen; Zustellung kann erst auf Netlify getestet werden. |
| Bewertungen (Master-Prompt §5) | Nicht umgesetzt – brauchen Nutzerkonten (V8/Phase 2). Es gibt bewusst keine Platzhalter-Sterne. |
| Marker-Clustering-Details, Safari/Firefox | Nur Chromium getestet. |
| Admin-Bereich, Datenbank, Konten | Phase 2 (V8+). Moderation derzeit manuell, siehe MODERATION.md. |
| Serverseitige Upload-Prüfung | Phase 2. Bis dahin: Dateien vor Veröffentlichung selbst ansehen. |
| Werbung | V10, bewusst nicht enthalten. |
| Deutschlandweit | V9. `START_MODE: 'germany'` in `config.js` vorbereitet. |
| Impressum/Datenschutz | Vorlagen, von dir auszufüllen und rechtlich zu prüfen. |

## Abweichungen vom Master-Prompt
- **Startansicht:** Statt ganz Deutschland zoomt die App auf die vorhandenen Daten (NRW), weil sonst alle Marker in einer Ecke kleben. Umstellbar: `START_MODE` in `config.js`.
- **Leaflet statt MapLibre:** laut Prompt zulässig, weil V6 Leaflet nutzt und die Umstellung nichts bringt, solange es um wenige tausend Punkte geht.
- **Datenformat:** GeoJSON für OSM-Daten; die Aufteilung in räumliche Pakete (V9) ist über `meta.json → files` vorbereitet.

## Nächste Schritte (empfohlen)
1. Auf Netlify veröffentlichen, Import laufen lassen, Ergebnis stichprobenartig prüfen.
2. Karte auf Smartphone und Desktop durchklicken, Konsole auf CSP-Fehler prüfen.
3. Impressum und Datenschutz ausfüllen.
4. Echte Meldung durch alle vier Formulare schicken und im Netlify-Dashboard prüfen.
5. Dann V8: Supabase, Admin-Bereich, serverseitige Upload-Prüfung.

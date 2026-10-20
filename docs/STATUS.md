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
- Pegelstände (PEGELONLINE, Bundeswasserstraßen): zuschaltbare Ebene mit Zustandsfarben, Wert und Trend am Marker, Detail mit Einordnung MNW/MW/MHW/HSW und 7-Tage-Verlauf. Abruf über `/api/pegel/` (Netlify-Weiterleitung in `public/_redirects`). Test: `tests/ui_pegel.py`.

## Nicht gemacht oder nicht geprüft
| Punkt | Stand |
|---|---|
| **Import Deutschland (alle 16 Bundesländer)** | Gelaufen (GitHub Action, 19.10.2026): 6045 Standorte, Ort und Gewässer für alle Bundesländer zugeordnet. Leere Server-Antworten gelten als Fehler, bei Ausfall aller Server gibt es eine zweite Runde, sonst Abbruch ohne Datenverlust. Ergebnisse stichprobenartig mit OSM vergleichen. |
| **Echte Kartendarstellung** | Mit echtem Leaflet 1.9.4 + MarkerCluster 1.5.3 in Chromium (Desktop + Mobil) getestet: Clustering, Marker-Klick, Detail, Deep-Link, Standort. Kacheln nur als Platzhalter (OSM-Kachelserver im Test nicht erreichbar). Auf echtem Gerät und in Safari/Firefox noch durchklicken. |
| CSP | Strenge Richtlinie, ohne CDNs. Mit echtem Leaflet und exakt diesen Headern getestet: keine Verstöße. Echte Kacheln und Nominatim nicht live geprüft. Falls nach dem Deploy die Karte leer bleibt: Browser-Konsole öffnen, geblockte Domains in `public/_headers` ergänzen. |
| Kartenlibraries selbst gehostet | Erledigt: `public/vendor/`, `USE_LOCAL_LIBS: true`. |
| Pegel live | Gegen Testdaten im PEGELONLINE-Format getestet; die echte Schnittstelle und die Netlify-Weiterleitung waren in der Entwicklungsumgebung nicht erreichbar. Nach dem Deploy: Ebene „Pegel“ einschalten, einen Pegel öffnen. Lokal (`tests/serve.sh`) gibt es keine Weiterleitung – dort meldet die App „nicht erreichbar“. Nur Bundeswasserstraßen; Landespegel (z. B. an Seen) fehlen. |
| Netlify Forms live | Formulare sind vorbereitet und Felder abgeglichen; Zustellung kann erst auf Netlify getestet werden. |
| Bewertungen (Master-Prompt §5) | Nicht umgesetzt – brauchen Nutzerkonten (V8/Phase 2). Es gibt bewusst keine Platzhalter-Sterne. |
| Marker-Clustering-Details, Safari/Firefox | Nur Chromium getestet. |
| Admin-Bereich, Datenbank, Konten | Phase 2 (V8+). Moderation derzeit manuell, siehe MODERATION.md. |
| Serverseitige Upload-Prüfung | Phase 2. Bis dahin: Dateien vor Veröffentlichung selbst ansehen. |
| Werbung | V10, bewusst nicht enthalten. |
| Deutschlandweit | V9. `START_MODE: 'germany'` in `config.js` vorbereitet. |
| Impressum/Datenschutz | Ausgefüllt. Rechtlich nicht geprüft. Vertrag zur Auftragsverarbeitung mit Netlify muss abgeschlossen sein. Vor Einführung von Werbung (V10) Erklärung und ggf. Einwilligungsbanner ergänzen. |

## Abweichungen vom Master-Prompt
- **Startansicht:** Die App zoomt auf die vorhandenen Daten (bei Deutschland-Import: ganz Deutschland). Umstellbar: `START_MODE` in `config.js`.
- **Leaflet statt MapLibre:** laut Prompt zulässig, weil V6 Leaflet nutzt und die Umstellung nichts bringt, solange es um wenige tausend Punkte geht.
- **Datenformat:** GeoJSON für OSM-Daten; die Aufteilung in räumliche Pakete (V9) ist über `meta.json → files` vorbereitet.

## Nächste Schritte (empfohlen)
1. Auf Netlify veröffentlichen, Import laufen lassen, Ergebnis stichprobenartig prüfen.
2. Karte auf echtem Smartphone (Safari) und Desktop durchklicken, Konsole auf CSP-Fehler prüfen.
3. Vertrag zur Auftragsverarbeitung mit Netlify abschließen.
4. Echte Meldung durch alle vier Formulare schicken und im Netlify-Dashboard prüfen.
5. Dann V8: Supabase, Admin-Bereich, serverseitige Upload-Prüfung.

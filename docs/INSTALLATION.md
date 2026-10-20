# Installation und Betrieb

## 1. Lokal ansehen (optional)
Die App muss über einen Webserver laufen (Doppelklick auf `index.html` geht nicht, weil Browser dann das Laden von Dateien blockieren).
```
sh tests/serve.sh        # öffnet http://localhost:8765
```
Voraussetzung: Python 3. Das Kartenmodul wird beim ersten Start aus dem Internet geladen.

## 2. Bei Netlify veröffentlichen
**Variante A – Ordner hochladen (einfachste):**
1. Bei Netlify anmelden → *Add new site* → *Deploy manually*.
2. Den Ordner **`public`** (nicht das ganze Projekt) ins Fenster ziehen.
3. Fertig. Die Datei `public/_headers` setzt Sicherheits-Header und Zwischenspeicher automatisch.

**Variante B – mit GitHub (empfohlen für Updates):**
1. Das ganze Projekt in ein GitHub-Repository legen.
2. Netlify → *Add new site → Import from Git*. Einstellungen kommen aus `netlify.toml` (veröffentlicht wird `public`, kein Build nötig).
3. Vorteil: Die [GitHub Action](../.github/workflows/update-osm-data.yml) aktualisiert die OSM-Daten monatlich, Netlify veröffentlicht sie automatisch.

## 3. Formulare aktivieren (Netlify Forms)
Nach dem ersten Veröffentlichen: Netlify → *Forms*. Es müssen vier Formulare stehen:
`slipanlage-melden`, `tankpreis-melden`, `foto-einreichen`, `fehler-melden`.
- *Forms → Settings & notifications → Form notifications*: E-Mail-Benachrichtigung bei neuer Meldung einrichten.
- *Spam:* Honeypot ist eingebaut, Netlify filtert zusätzlich. Bei viel Spam kann reCAPTCHA in Netlify aktiviert werden (dann Datenschutzerklärung ergänzen).
- Kostenloser Netlify-Tarif: begrenzte Zahl Einsendungen pro Monat und 8 MB pro Upload – für den Start ausreichend; bei Erfolg Phase 2 (Supabase) einplanen.
- Meldungen erscheinen **nie** automatisch auf der Karte. Ablauf: [MODERATION.md](MODERATION.md).

## 4. Rechtstexte
`public/impressum.html` und `public/datenschutz.html` sind ausgefüllt (Stand Oktober 2026). Vor dem öffentlichen Start am besten juristisch prüfen lassen und den Vertrag zur Auftragsverarbeitung mit Netlify abschließen, auf den die Datenschutzerklärung verweist. Ich bin kein Rechtsanwalt; die Texte beschreiben, was die App technisch tut.

## 5. Kartenmodul selbst hosten (eingerichtet)
Leaflet 1.9.4 und MarkerCluster 1.5.3 liegen in `public/vendor/`, `USE_LOCAL_LIBS` ist `true`, und die CSP lässt unpkg/jsDelivr nicht mehr zu. Zum Neuladen der Dateien (z. B. bei einem Update):
```
python3 scripts/vendor_libs.py
```
Das lädt die Dateien nach `public/vendor/` und stellt `USE_LOCAL_LIBS` in `public/js/config.js` um. Zurück auf CDN: Flag auf `false` und unpkg.com/cdn.jsdelivr.net wieder in `public/_headers` (script-src, style-src, img-src) sowie in die Datenschutzerklärung aufnehmen.

## 6. Pegelstände
Die Ebene „Pegel“ lädt Daten von PEGELONLINE über die eigene Domain: `public/_redirects` leitet `/api/pegel/*` auf Netlify an `https://www.pegelonline.wsv.de/webservices/rest-api/v2/` weiter. Ohne Netlify (z. B. lokal) braucht es eine entsprechende Weiterleitung, sonst meldet die App, dass die Pegeldaten nicht erreichbar sind. Lizenz der Daten: Datenlizenz Deutschland – Zero – 2.0.

## 7. Kartenkacheln
Der Standard-Kachelserver von OpenStreetMap (`tile.openstreetmap.org`) ist nur für geringe Last gedacht ([Nutzungsrichtlinie](https://operations.osmfoundation.org/policies/tiles/)). Bei wachsender Nutzung einen Anbieter in `public/js/config.js` (`TILE_URL`) eintragen. Passe dann auch `img-src` in `public/_headers` an.

## 8. Sicherheits-Header (CSP)
`public/_headers` enthält eine strenge Content-Security-Policy. Wenn du neue externe Dienste einbindest (anderer Kachelserver, Analyse, Werbung), müssen deren Domains dort ergänzt werden – sonst blockiert der Browser sie.

## 9. Eigene Domain, PWA
Netlify → *Domain management*. Die App ist als PWA installierbar (Manifest + Service Worker; nur über HTTPS). Offline funktionieren Standortliste und Details; Kartenkacheln nur für bereits angesehene Bereiche.

# WaterMap – aktueller Stand

Stand: 23.10.2026 · App-Version **7.20.0**

| | |
|---|---|
| Live | Version 7.14.3 (PR #3 übernommen) |
| Vorschau | 7.15.0 – 7.20.0 in PR #4, https://deploy-preview-4--watermaps.netlify.app |

Branch `claude/oms-daten-aktualisieren-0bc073` – **noch nicht veröffentlicht**. Veröffentlicht wird erst auf „übernehmen“.

---

## 1. Was die App ist

WaterMap ist eine Karte für Wassersportler mit Slipanlagen, Häfen und Bootstankstellen in ganz Deutschland. Die Standorte kommen aus OpenStreetMap, dazu gibt es Community-Daten.

Weitere Funktionen:
- Pegelstände, Wetter und Wind
- Pegel-Ampel mit E-Mail-Alarm
- Lagemeldungen „Heute vor Ort“
- Fotos und Hinweise, die vor der Veröffentlichung geprüft werden

Die App ist eine installierbare PWA, auf Deutsch, und nutzt nur kostenlose Dienste.

## 2. Architektur

### Frontend (`public/`, ohne Build-Schritt)
- Statische Seiten mit ES-Modulen. Leaflet 1.9.4 und MarkerCluster 1.5.3 liegen selbst gehostet in `public/vendor/`.
- **Service Worker** `sw.js`: hält die App-Hülle (`SHELL_FILES`) und die Kartenkacheln vor. Der Cache-Name hängt an der Version, also bei jeder Änderung `VERSION` in `sw.js` und `config.js` erhöhen.
- **Routing über den Hash** in `main.js`:

  | Adresse | Ziel |
  |---|---|
  | `#karte` (Standard) | Karte |
  | `#liste` | Liste |
  | `#favoriten` | Favoriten |
  | `#pegel` | Pegel-Dashboard |
  | `#pegel/<id>` | Pegel-Detailseite |
  | `#karte/pegel/<id>` | Pegel auf der Karte (alter Link `#g=<id>` geht weiter) |
  | `#melden` | Melden-Auswahl |
  | `p=` / `x=` | Standort bzw. Extra |

- **Wichtige Module:**

  | Modul | Aufgabe |
  |---|---|
  | `main.js` | Ablauf, Zustand, Routing |
  | `map.js` | Leaflet: Marker, Cluster, Pegel, Melde-Abzeichen |
  | `nav.js` | Navigation oben/unten, Popover (Bottom Sheet / Dropdown) |
  | `detail.js` | Detailansicht der Standorte |
  | `data.js`, `model.js` | Daten laden und zusammenführen |
  | `forms.js`, `photo-form.js`, `lage-form.js` | Formulare |
  | `pegel.js` | PEGELONLINE-Anbindung, Diagramm |
  | `pegel-daten.js` | gemeinsame Stationsliste, Verläufe, „Meine Pegel“ |
  | `pegel-ansicht.js` | Pegel-Karten, Skala, Detail |
  | `pegel-dashboard.js` | Pegel-Dashboard |
  | `meldungen.js` | Lagemeldungen „Heute vor Ort“ |
  | `wetter.js` | Wetter und Wind |
  | `umgebung-abfrage.js` | „In der Nähe“ |
  | `ampel.js`, `ampel-logik.js` | Pegel-Ampel |

- **Gespeicherte Nutzerdaten** liegen nur im Browser (localStorage), es gibt keine Konten. Dazu gehören:
  - Favoriten
  - Meine Pegel (`watermap.meinePegel`)
  - der letzte Pegelstand für den Offline-Betrieb (`watermap.pegel.stand`)
  - die Kategorien
  - eine anonyme Geräte-ID für Meldungen

### Daten
- `public/data/osm/` enthält die OSM-Standorte als GeoJSON und `extras.geojson` (Schleusen, Brücken, Service). Beides schreibt der Import.
- `public/data/community/` enthält geprüfte Community-Daten. Der Import überschreibt sie nie.
- **GitHub Actions:**

  | Workflow | Aufgabe |
  |---|---|
  | `update-osm-data.yml` | monatlicher OSM-Import, alle 16 Bundesländer, mit Verlustschutz |
  | `hafeninfo.yml` | Preise und Leistungen von den Hafen-Websites, kostenlos nach festen Regeln |
  | `entpacken.yml` | Projekt entpacken (nur manuell) |

### Externe Dienste (alle kostenlos)

| Dienst | Weg |
|---|---|
| PEGELONLINE (WSV) | Netlify-Proxy `/api/pegel/*` |
| Bright Sky (DWD) | Netlify-Proxy `/api/wetter/*` |
| Overpass (OSM) „In der Nähe“ | direkt aus dem Browser, Rückfall über die Funktion `umgebung.mjs` |
| Nominatim | Ortssuche, nur auf Nutzeraktion |
| Brevo | E-Mails für den Pegel-Alarm |
| Netlify Forms / Blobs / Functions | Formulare, Speicher, Server-Logik |

### Netlify-Funktionen (`netlify/functions/`, Node 22)

| Funktion | Aufgabe |
|---|---|
| `fotos.mjs` | Foto-Freigabe für `/admin/fotos.html` |
| `pegel-alarm.mjs` | Anmeldung zum Alarm (Double-Opt-in) |
| `pegel-alarm-pruefen.mjs` | stündliche Alarm-Prüfung |
| `meldungen.mjs` | Lagemeldungen: `GET /api/meldungen?standort=`, `GET /api/meldungen/aktiv`, `POST /api/meldungen`, `POST /api/meldungen/<id>/bestaetigen` |
| `meldungen-aufraeumen.mjs` | räumt stündlich die Lagemeldungen auf |
| `umgebung.mjs` | Overpass-Rückfall |

Die Logik für Meldungen und Alarm steckt in `netlify/lib/` und ist dort testbar. Der Blob-Store heißt `meldungen` (Produktion) bzw. `meldungen-vorschau` (Vorschau).

### Umgebungsvariablen in Netlify (Werte nie in den Chat)
- **Fotos:** `FOTO_ADMIN_PASSWORT`, `NETLIFY_API_TOKEN`, `GITHUB_TOKEN`, `FOTO_BRANCH`
- **Pegel-Alarm:** `BREVO_API_KEY`, `ALARM_ABSENDER`, `ALARM_ABSENDER_NAME`
- **Heute vor Ort:** `MELDUNG_SALZ`, als Secret gesetzt. Fehlt die Variable, antwortet die Funktion mit 503.

## 3. Wichtige Entscheidungen

**Arbeitsweise**
- Nur kostenlose Dienste. Keine Konten und keine Datenbank, solange es nicht nötig ist (Phase 2/V8).
- Änderungen gehen zuerst als **Vorschau** in PR #4. Veröffentlicht wird nur auf „übernehmen“.
- Vor größeren Änderungen an der Oberfläche gibt es erst einen Plan bzw. Rückfragen.

**Karte und Daten**
- Leaflet statt MapLibre.
- GeoJSON. Die Aufteilung in räumliche Pakete ist vorbereitet.
- Hafeninfos werden mit Quelle übernommen. Beschwert sich ein Hafen, wird sein Eintrag entfernt.

**Navigation (Entwurf A, 7.16)**
- Kategorien lassen sich mehrfach wählen, mindestens eine bleibt immer aktiv (Standard: Slip).
- Die Ebenen stehen im Filter-Panel.
- Die Vorschaukarte zeigt den nächsten Pegel.
- Das Melde-Menü ist ein Bottom Sheet.

**Heute vor Ort (7.17/7.18)**
- Meldungen sind 24 h sichtbar.
- Pro Gerät und Standort gibt es 1 h Sperre.
- Nach 3 Widersprüchen wird eine Meldung ausgeblendet.
- Notizen haben höchstens 140 Zeichen.
- IP-Adressen werden nur mit Salz gehasht gespeichert.
- Die Karte hat vier Zustände (a/b/c/d). „In der Nähe“ heißt hier 1 km (`VOR_ORT_RADIUS_M`).
- Nur bei Slipanlagen (7.20): Häfen und Tankstellen zeigen keine Karte „Heute vor Ort“; Melde-Menü schlägt nur Slipanlagen vor und nimmt bei der Auswahl nur Slipanlagen an.
- Der Datenschutztext ist abgestimmt.

**Pegel (7.19)**
- Der Bereich „Pegel“ ist ein eigenes Dashboard.
- Die Pegel-Ampel bleibt unverändert und ist über „Passt mein Boot?“ mit `?pegel=` erreichbar.
- Ein Klick auf einen Pegel-Marker bleibt auf der Karte: Handy → kompakte Vorschau, Desktop → Panel rechts.
- „Meine Pegel“ ist eine eigene Liste, getrennt von den Favoriten. Der Ampel-Pegel wird einmalig übernommen.
- Ist die Liste leer, erscheinen die 3 nächsten Pegel als Vorschlag.
- Die Alarm-Kachel verweist auf den bestehenden Alarm (`pegel-ampel#am-alarm`).
- Farben: Normal überall grün `#6CBF84`, auch auf der Karte. Niedrig `#FAB219`, Hoch `#EC835A`, über HSW `#D03B3B`, ohne Daten `#DCE5EA`.
- Ordnet PEGELONLINE einen Pegel nicht ein, aber MNW und MHW sind bekannt, ordnet die App selbst ein: unter MNW niedrig, über MHW hoch, sonst normal (7.19.1).
- „Flüsse im Überblick“ zeigt nur eingeordnete Pegel, keine grauen Felder. Gewässer ganz ohne Einordnung (z. B. Kanäle, Küste) fehlen dort; die Liste zeigt weiter alle Pegel (7.19.1).
- „Pegel hinzufügen“ öffnet ein eigenes Fenster (Handy Bottom-Sheet, Desktop Dropdown, bei wenig Platz nach oben): Suche, ohne Eingabe die nächsten Pegel, „+“ fügt hinzu, Fenster bleibt offen (7.20).
- Karte und Dashboard nutzen eine gemeinsame Stationsliste, die alle 15 Min. und bei Rückkehr in die App aktualisiert wird.
- Verläufe werden nur für sichtbare Karten und die Detailseite geladen.
- Offline gibt es den letzten Stand mit Hinweis „Stand von …“.

**Gestaltung**
- Karten mit 18 px Radius auf `#F3F6F8`.
- Gelbe Etiketten in `#7A5200`.
- Bedienelemente mindestens 44 px groß.
- Maximale Breite 1280 px.

## 4. Versionsverlauf seit der letzten Veröffentlichung

| Version | Inhalt |
|---|---|
| 7.15.0 | Neues, fotozentriertes Formular „Foto hinzufügen“ |
| 7.15.1/2 | „In der Nähe“: überlastete Overpass-Antwort erkannt, eine schnellere Abfrage |
| 7.16.0 | Navigation nach Entwurf A (Kategorien, Filter-Panel, Melde-Menü, Vorschaukarte) |
| 7.17.0 | „Heute vor Ort“: Lagemeldungen (Backend und Oberfläche) |
| 7.18.0 | „Heute vor Ort“ als Karte mit vier Zuständen |
| 7.19.0 | Pegel-Dashboard, Detailseite, „Meine Pegel“, Pegel-Vorschau auf der Karte |
| 7.19.1 | Flüsse im Überblick ohne graue Felder, eigene Einordnung aus MNW/MHW |
| 7.20.0 | Fenster „Pegel hinzufügen“, „Lage melden“ nur bei Slipanlagen |

## 5. Tests

| Bereich | Tests |
|---|---|
| Unit (Python) | `python3 -I -m unittest discover -s tests` (Importer, Validator, Hafeninfo, Moderation) |
| Node | `ampel_logik`, `fotos_function`, `meldungen`, `pegel_alarm`, `umgebung` |
| Oberfläche (Playwright) | `ui_full`, `ui_smoke`, `pwa_test`, `ui_meldungen`, `ui_extras`, `ui_karussell`, `ui_pegel`, `ui_pegel_dashboard`, `ui_wetter`, `ui_ampel`, `ui_fotos` |

Die Oberflächentests laufen mit einem Leaflet-Ersatz (`tests/stub/leaflet-stub.js`) und erfundenen API-Daten.

**Letzter Lauf (7.20.0): alle Tests grün außer `ui_smoke` (bricht in der Cloud-Umgebung auch ohne Änderungen ab: `.place` erscheint nicht).**

## 6. Offene Aufgaben

**Als Nächstes**
1. Pegel-Dashboard in der Vorschau prüfen, auf dem Handy und am Desktop.
2. Danach PR #4 auf „übernehmen“ zusammenführen.

**Nach der Veröffentlichung live prüfen.** Diese Punkte sind nur gegen Testdaten geprüft, weil die echten Dienste in der Entwicklungsumgebung nicht erreichbar waren:
- Pegel (PEGELONLINE-Proxy) und Wetter (Bright Sky)
- „Heute vor Ort“ mit echten Blobs
- Zustellung der Netlify Forms
- Pegel-Alarm-Mails

**Prüfen auf echten Geräten:** Safari (iOS) und Firefox. Bisher ist nur in Chromium getestet.

**Rechtliches und Betrieb**
- Vertrag zur Auftragsverarbeitung mit Netlify abschließen.
- Impressum und Datenschutz sind ausgefüllt, aber nicht juristisch geprüft.

**Bekannte Lücken**
- Nur Bundeswasserstraßen. Landespegel, etwa an Seen, fehlen.
- Hafeninfos haben etwa 300 nicht erreichbare Websites. Bei den Kieler Sporthäfen fehlen die Preise.

**Später (Roadmap)**
- V8: Supabase, Admin-Bereich, serverseitige Upload-Prüfung, Bewertungen (braucht Konten)
- V9: räumliche Datenpakete
- V10: Werbung (dann mit Einwilligungsbanner)

Details stehen in `README.md`, `docs/STATUS.md`, `docs/HEUTE-VOR-ORT.md`, `docs/PEGEL-ALARM.md` und `docs/MODERATION.md`.

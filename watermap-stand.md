# WaterMap – aktueller Stand

Stand: 24.10.2026 · App-Version **7.25.8**

| | |
|---|---|
| Live | Version 7.14.3 (PR #3 übernommen) |
| Vorschau | 7.15.0 – 7.25.8 in PR #4, https://deploy-preview-4--watermaps.netlify.app |

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
  | `#naehe` | In der Nähe (alter Link `#liste` geht weiter) |
  | `#favoriten` | Favoriten |
  | `#pegel` | Pegel-Dashboard |
  | `#pegel/<id>` | Pegel-Detailseite |
  | `#pegel/fluss/<name>` | Flussseite (Profil + Pegelliste; `kueste` = Küstenpegel) |
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
  | `naehe.js` | „In der Nähe“: Bezugspunkt, Standortfreigabe, Liste, Fenster „Entfernungen messen ab …“ |
  | `pegel-ansicht.js` | Pegel-Karten, Skala, Detail |
  | `pegel-dashboard.js` | Pegel-Dashboard |
  | `pegel-fluss.js` | Flüsse: Gruppierung (Küste/Kanäle), Zustand, rel, Profil-Daten (ohne Oberfläche) |
  | `pegel-fluss-ansicht.js` | Fluss-Kacheln und Flussseite |
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

**Flüsse (7.22)**
- „Flüsse im Überblick“ als Kacheln (Handy 2, Desktop 3 Spalten, am Desktop in voller Breite unter „Lage heute“); Farbbänder entfernt.
- Gruppierung nach Gewässer. Küste = feste Liste `CONFIG.PEGEL_KUESTE` (Nordsee, Ostsee, Jade, Außenjade, … – „AUSSENJADE“ passt auch); eigene Kachel „Küste“ (Tide), Seite ohne Profil.
- Gewässer ganz ohne Kennwerte (Kanäle): keine Kachel, aber unter „Alle Gewässer“ im Abschnitt „Kanäle und Gewässer ohne Bewertung“; Seite ohne Profil. In der Vorschau/lokal (`ENTWICKLUNG` in config.js) listet die Konsole diese Gewässer einmal auf – zum Prüfen der Küstenliste.
- Zustand eines Flusses nur aus aktuellen, eingeordneten Pegeln: über HSW (mind. einer) → hoch (≥ 50 % über MHW) / teils hoch → niedrig (≥ 50 % unter MNW) / teils niedrig → normal. Nur veraltete Werte → grau „keine aktuellen Daten“. Hervorgehoben: relativ höchster bzw. tiefster Pegel (`rel = (W − MNW) / (MHW − MNW)`, begrenzt −0,5 … 1,6).
- Kacheln: zuerst Flüsse mit „Meine Pegel“, dann Schwere, dann Anzahl; Küste zuletzt; 6 Kacheln, dann „Alle <n> Gewässer“. Punktreihe nur Pegel mit Kennwerten (max. 12).
- Flussseite `#pegel/fluss/<name>`: SVG-Profil nach km (Unterweser hinten angehängt; seit 7.22.2 x halb nach km, halb nach Reihenfolge, damit Häufungen nicht aufeinanderliegen; y-Achse nur so weit wie nötig, MNW/MHW immer sichtbar; Handy 220 px hoch), Normalbereich, MNW/MHW gestrichelt, keine HSW-Linie. Abschnitt nach dem letzten Pegel mit Kennwerten abgetrennt: „Tidebereich“, wenn diese Pegel Tide-Kennwerte (MThw/MTnw) haben, sonst „ohne Kennwerte“. Handy: Tipp zeigt Blase des nächstgelegenen Punkts, „Details ›“ öffnet; Desktop Hover + Klick.
- Seit 7.23: Pegel in Fließrichtung (`flussReihenfolge`: nach km, bei Sprüngen Kette über die Lage; km ab Mündung bei Mosel, Saar, Main, Neckar, Lahn, Saale). Profil mit gleichen Abständen nur aus bewerteten Pegeln; Höhe passt sich an (MNW immer, MHW nur wenn im Bereich, sonst Hinweis); Flächen normal/niedrig/hoch; tiefster/höchster Pegel als Zeile über dem Diagramm; Tidepegel nicht im Diagramm, sondern Zeile „Ab <Pegel> <n> Tidepegel“ darunter. Kompakter Kopf, am Handy ohne globales Suchfeld. Liste „flussabwärts“, Weser mit Abschnitt („Oberweser km 0,7“).
- Namen: `js/pegel-namen.js` (Korrekturliste für Umlaute, „.“ mit Leerzeichen, „-strasse“ → „-straße“). Die Vorschau-Konsole listet Reihenfolge (Weser, Elbe, Rhein, Ems) und Namen mit ae/oe/ue.
- BSH: Ergebnis der (inzwischen entfernten) Prüf-Funktion in `docs/BSH-Klaerung.md`.

**Gezeiten (7.24, ohne BSH)**
- Tidepegel = Tide-Kennwerte (MThw/MTnw/MTmw, `g.tideRefs`) statt MNW/MHW; Zustand/Etikett „Tide“ (#9CCEE3).
- `js/gezeiten.js` (rein, getestet): Glättung, Hoch-/Niedrigwasser als lokale Extreme (±3 h, abwechselnd, nur bestätigte), Tendenz aus 30 min (auflaufend/ablaufend/kentert), Tidehub, Einordnung zu MThw/MTnw.
- Tidepegel-Detailseite (`js/pegel-tide-ansicht.js`): Kopf „Tidepegel · Gewässer · km“, „Tide“, Tendenz; Tidekurve 24 h gemessen mit MThw/MTnw, HW/NW mit Uhrzeit, „jetzt“; Einordnung; Kacheln „Häfen in der Nähe“ und „<Gewässer> – alle Pegel“. Gilt auch im Kartenpanel.
- „Meine Pegel“: Tidepegel-Karte mit Tendenz und „zuletzt HW … · NW …“ statt Skala. Flussseite: Tide-Zeile „· gerade auflaufend“ (eine Abfrage pro Flussseite).
- Prüfliste `pruefung.html` (nicht verlinkt): Reihenfolge Weser/Elbe/Rhein/Ems, Namen mit ae/oe/ue, erkannte Tidepegel, Küste, Gewässer ohne Bewertung – „Alles kopieren“.

**Gezeitenvorhersage BSH (7.25)**
- Funktion `/api/gezeiten?pegel=<UUID>&nr=<Nr>` (`netlify/functions/gezeiten.mjs`, Logik `netlify/lib/gezeiten-kern.mjs`, Ausnahmen `netlify/lib/gezeiten-orte.mjs`); `?orte=1` = BSH-Orte. Zuordnung automatisch über UUID/Pegelnummer. Ortsliste 24 h (Blobs „gezeiten“), Vorhersage 1 h im CDN, Fehler 502, kein Ort 404. Aus: `GEZEITEN_BSH_AKTIV` (config.js) bzw. Env `GEZEITEN_BSH_AUS=1`. Kontakt im User-Agent: Env `WATERMAP_KONTAKT`.
- App: `js/gezeiten-bsh.js` (Laden, Offline-Stand je Pegel ≤ 24 h, Texte). Tidepegel-Seite: Karte „Gezeiten“ (nächstes HW/NW, „in X Std. Y Min.“, Höhe – amtliche Vorhersage mit Abweichung zum Mittel, sonst Gezeitenrechnung; drei weitere als Pillen; BSH-Text), Vorhersage gestrichelt +12 h in der Tidekurve. „Meine Pegel“: „nächstes HW … · NW …“. Flussseite: Tide-Zeile „· HW <Pegel> 14:32“, Liste „HW 14:32“ (nur Pegel mit BSH-Ort). Küsten-Kachel „Cuxhaven: Hochwasser 14:32“.
- Quelle „Gezeitenvorhersage: BSH (CC BY 4.0)“, „nicht für die Navigation“, Abschnitt in `ueber.html`. Prüfliste zeigt Zuordnung und BSH-Orte ohne Pegel.
- „<n> Slipanlagen an der <Fluss>“: schaltet Slipanlagen zusätzlich ein und zoomt auf alle (fitBounds). Keine Abfragen pro Pegel.

**In der Nähe (7.21)**
- Tab `#naehe` ersetzt „Liste“ (Pin-Symbol). Favoriten bleiben eigener Tab mit denselben Karten; kein Umschalter mehr.
- Bezugspunkt: „Meine Position“, „Kartenmitte“ (Standard beim ersten Öffnen) oder ein gesuchter Ort. Gespeichert (localStorage): nur die Wahl (`watermap.naehe.bezug`), bis zu 3 gesuchte Orte, ob schon entschieden, Sortierung. Die Position selbst nie.
- Ortsname im Kopf lokal aus den WaterMap-Daten (Ort des nächsten Standorts, ≤ 30 km) – keine Rückwärtssuche, damit die Position nicht an Nominatim geht.
- Freigabe vorher per Permissions API: granted → direkt Position; prompt/unbekannt → Erklär-Karte (Browser-Dialog erst auf „Position verwenden“); denied → gelber Hinweis mit Anleitung. Status gemeinsam mit „Meine Position“ auf der Karte. Der einmalige Karten-Hinweis „Karte auf deinen Standort ausrichten?“ ist entfernt.
- Position wird beim Öffnen des Tabs und per Ziehen nach unten aktualisiert, nicht laufend.
- Liste: 25 km, bei < 5 Treffern 50 bzw. 100 km; höchstens `LIST_LIMIT`. Sortierung „Nächste zuerst“, „Name A–Z“, bei nur Häfen „Gastliegeplätze zuerst“. Keine Fahrzeit. Meldungs-Etikett bei Slipanlagen (die Übersicht `/api/meldungen/aktiv` liefert dafür jetzt `at`).
- Handy: Navy-Kopf mit Kategorien und Filter statt der Werkzeugleiste; Tipp → Karte mit Vorschau, Zurück → gleiche Scrollstelle. Desktop: Seitenleiste links, Kategorien in der Werkzeugleiste, bei Kartenmitte läuft die Liste mit der Karte mit.
- Detail-Abschnitt „In der Nähe (bis 500 m)“ heißt jetzt „Umgebung (bis 500 m)“.
- Handy kompakt (7.22.1, nur < 768 px): globales Suchfeld ausgeblendet; Kopf mit Titel, Lupe (→ Fenster „Entfernungen messen ab …“) und Karten-Symbol; Bezugspunkt als Pille; Chips 36 px + Filter-Symbol. Statt Erklär-Karte eine Zeile „Genauere Entfernungen mit deiner Position“ mit „Erlauben“ und „×“ (`watermap.naehe.tippZu`, gilt bis zur nächsten eigenen Wahl des Bezugspunkts); „blockiert“ einzeilig. Zählzeile „<n> Slipanlagen · bis <r> km“. Links „Über WaterMap · …“ als letzter Listeneintrag, Liste unten mit Abstand für Navigation und Melden-Knopf. Test: mindestens 4 Einträge ohne Scrollen bei 375 und 390 px.

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
- Die Suche des Dashboards steht in der Karte „Alle Pegel“ (filtert nur diese Liste); am Handy ist sie auch bei zugeklappter Liste sichtbar und klappt beim Tippen auf (7.20.1).
- „Alle Pegel“ ist standardmäßig nach Gewässer und Flusskilometer sortiert (7.20.2); wählbar sind nur „Gewässer“ und „Entfernung“, „Zustand“ ist auf Wunsch entfernt (7.20.3).
- Trend: kommt aus `currentMeasurement.trend` (auch als Text). Fehlt er, berechnen Karte und Detailseite ihn aus dem Verlauf (2 h, ab 2 cm). Die Tabelle blendet die Spalte „Trend“ aus, wenn keine Zeile einen Trend hat. Ob PEGELONLINE den Trend noch liefert, ließ sich aus der Cloud-Umgebung nicht prüfen (kein Netzzugang) (7.20.2).
- Bei einer Suche kommen zuerst Pegel, deren Gewässer passt (dann Namenstreffer wie „Jade-Weser-Port“). Die Weser hat zwei Kilometrierungen (Ober-/Mittelweser ab Hann. Münden, Unterweser ab Bremen wieder km 0); für die Reihenfolge zählt die Unterweser (nördlich 52,9°, km < 130) als km + 366,7 – angezeigt wird weiter der amtliche km (`flussKm` in `pegel-dashboard.js`, 7.20.4). Andere Flüsse mit mehreren Kilometrierungen sind nicht geprüft.
- Suche und Filter schließen sich aus: Tippen in die Suche entfernt einen Filter (Zähler oder Flussband), ein neuer Filter leert die Suche (7.20.5).
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
| 7.20.1 | Pegel-Suche aus dem Kopf in die Karte „Alle Pegel“ verschoben |
| 7.20.2 | „Alle Pegel“ standardmäßig nach Gewässer und km; Trend aus dem Verlauf, wenn PEGELONLINE keinen liefert |
| 7.20.3 | Sortierung „Zustand“ entfernt (nur noch Gewässer und Entfernung) |
| 7.20.4 | Suche: passendes Gewässer zuerst; Unterweser hinter Ober-/Mittelweser |
| 7.20.5 | Neue Suche hebt den Filter auf; Filter (Zähler, Flussband) leert die Suche |
| 7.24.0 | Gezeiten aus PEGELONLINE: Tidepegel-Detailseite (Tidekurve, letztes HW/NW, Tidehub), Tide in „Meine Pegel“ und Flussseite; Prüfliste `pruefung.html` |
| 7.24.1 | Nach Prüfliste: Ems-Reihenfolge (Unterems ab Papenburg neu ab km 0 → `flussKm` +240), Namen (Groß-/Straß-, Kürzel UW/AP/BP … groß, Bhv/Whv/LT ausgeschrieben, „auf/zur“ klein, Meißen, Roßlau, Storkower Gewässer), Tide-Kennwerte auch als Text/„cm …“, Prüfliste zeigt Datenstand, gelieferte Tide-Kennwerte und Sonderzeichen in Namen; Offline-Stand nur aus derselben Version |
| 7.25.8 | Messzeile und Tipp-Anzeige wieder entfernt. Ergebnis: Tipps, die „nicht ankamen“, fing der In-App-Browser (Link aus einer App) ab – in Safari bzw. als Home-Bildschirm-App tritt das nicht auf |
| 7.25.7 | Vorschau: Fehlersuche „Tipp kommt nicht an“ – rote Zeile zeigt bei jedem Tipp das getroffene Element und offene Fenster |
| 7.25.6 | „In der Nähe“ mit eigener Position: beim Öffnen nur neu orten, wenn die Position älter als 2 Min. ist; „Position wird bestimmt …“ ändert nur den Kopf, die Liste nur bei > ~100 m Bewegung; Messzeile in der Vorschau zeigt zusätzlich „ganz fertig“ (inkl. Pegeldaten bzw. Ortung) |
| 7.25.5 | Ohne Wartezeit: „In der Nähe“ und Pegel-Dashboard werden nach dem Start im Leerlauf unsichtbar vorbereitet (Pegelliste wird dafür einmal geladen); beim erneuten Öffnen bleibt der fertige Inhalt stehen, wenn sich nichts geändert hat (Bezugspunkt ≈ 1 km, Filter, Meldungen, Sortierung, Freigabe, Datenstand); Listeneinträge außerhalb des Bildschirms mit `content-visibility: auto` |
| 7.25.4 | Weiter schneller: Marker-Cluster in 40-ms-Portionen (Tipps warten beim Start nicht mehr Sekunden), „In der Nähe“ zeigt erst 20 Einträge und lädt den Rest nach, Symbole geklont, kein doppeltes Zeichnen beim Öffnen; Tipp-Rückmeldung in der unteren Leiste; Vorschau zeigt oben die Messung „Tipp wartet … · Aufbau …“ |
| 7.25.3 | Schnellerer Wechsel zu „In der Nähe“/„Pegel“: Ansicht wechselt sofort, Inhalt wird im nächsten Bild gezeichnet; Flussgruppen je Datenstand nur einmal berechnet (Entfernungen vorab statt n³); „In der Nähe“ zeichnet beim Öffnen einmal statt dreimal |
| 7.25.2 | Pegel-Dashboard am Handy: „Meine Pegel“ vor „Flüsse im Überblick“ (CSS-Reihenfolge, Desktop unverändert) |
| 7.25.1 | (in der Vorschau mit echten Daten geprüft: Cuxhaven stimmt mit wasserstand.bsh.de überein) BSH-Zuordnung nach Prüfliste (55 Tidepegel automatisch): Ausnahmen Grauerort Reede und Blankenese UF; `?orte=1` liefert `alias`, Prüfliste berücksichtigt sie |
| 7.25.0 | Gezeitenvorhersage des BSH: Funktion `/api/gezeiten`, Karte „Gezeiten“, Vorhersage in der Tidekurve, nächstes HW in „Meine Pegel“, Flussseite und Küsten-Kachel, Offline-Stand, Über-Seite |
| 7.24.2 | Prüfliste bestätigt (Tide-Kennwerte kommen an): „_“ im Namen als Leerzeichen, bestätigte Namen mit ae/oe/ue (Flaesheim, Fuestrup, Itzehoe, Poel, Ueckermünde, Uelzen, Uetersen, Oestrich) nicht mehr als Verdacht |
| 7.23.0 | Flussseite überarbeitet (Reihenfolge in Fließrichtung, Profil ohne Tidepegel, Zeile tiefster/höchster Pegel), Namen mit Umlauten, BSH-Prüf-Funktion |
| 7.22.2 | Flussprofil: y-Achse passt sich an, x halb nach km/halb nach Reihenfolge, Handy 220 px |
| 7.22.1 | „In der Nähe“ am Handy kompakt (Kopf, Hinweiszeile, Links am Listenende) |
| 7.22.0 | Fluss-Kacheln statt Farbbänder, neue Flussseite mit Profil |
| 7.21.0 | Tab „Liste“ → „In der Nähe“ (Bezugspunkt, Standortfreigabe, neue Karten); Detail-Abschnitt „Umgebung“; Datenschutz „Standort“ neu |

## 5. Tests

| Bereich | Tests |
|---|---|
| Unit (Python) | `python3 -I -m unittest discover -s tests` (Importer, Validator, Hafeninfo, Moderation) |
| Node | `ampel_logik`, `fotos_function`, `meldungen`, `pegel_alarm`, `pegel_trend`, `pegel_fluss`, `gezeiten`, `gezeiten_bsh`, `umgebung` |
| Oberfläche (Playwright) | `ui_full`, `ui_smoke`, `pwa_test`, `ui_naehe`, `ui_meldungen`, `ui_extras`, `ui_karussell`, `ui_pegel`, `ui_pegel_dashboard`, `ui_pegel_fluss`, `ui_wetter`, `ui_ampel`, `ui_fotos` |

Die Oberflächentests laufen mit einem Leaflet-Ersatz (`tests/stub/leaflet-stub.js`) und erfundenen API-Daten.

**Letzter Lauf (7.25.8): alle Tests grün.**

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

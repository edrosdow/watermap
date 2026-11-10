# Auftrag: WaterMap Designumbau – eine Karte, ein Sheet, eine Designsprache

Lies zuerst `CLAUDE.md`, `watermap-stand.md` und `DESIGN_SYSTEM.md`. Alle Regeln dort gelten weiter:
- Deutsch.
- Nur Vorschau (Branch `claude/oms-daten-aktualisieren-0bc073`, PR #4).
- Version in `config.js` und `sw.js` erhöhen, neue Dateien in `SHELL_FILES` eintragen.
- Tests laufen lassen und bei 375/390/1024/1440 px prüfen.
- Commit-Nachricht auf Deutsch mit Version.

Dieser Auftrag ist der **freigegebene Plan**. Arbeite ihn **Phase für Phase** ab. Nach jeder Phase:
- committen und in die Vorschau bringen,
- Bildschirmfotos aller betroffenen Bereiche (Handy 390 px und Desktop 1440 px) nebeneinander zeigen,
- **auf meine Freigabe warten**, bevor die nächste Phase beginnt.

Ist etwas unklar oder widerspricht der Code diesem Auftrag, frag nach. Rate nicht.

Als Vorbild dient der freigegebene Prototyp `docs/prototyp-designumbau.dc.html` (liegt bei).
- Er ist ein Design-Artboard, kein lauffähiger App-Code: Markup in `<x-dc>`, Logik in der Klasse `Component`.
- Übernimm von dort **Maße, Farben, Abstände, Bewegungen und Abläufe**, nicht die Technik.
- Alle Zahlen und Orte darin sind Beispieldaten.

---

## Ziel in einem Satz

Die ganze App sieht aus und fühlt sich an wie heute das Slipanlagen-Sheet, „Lage vor Ort“ und „Foto hinzufügen“:
- **eine** Karte,
- **ein** Sheet für alle Inhalte,
- **eine** Ortszeile für alle Listen,
- feste Bewegungs-Tokens.

## Entscheidungen des Nutzers (verbindlich)

1. **Pegel ist ein Chip auf der Hauptkarte** (neben Slipanlagen, Häfen, Tanken). Der Navigationspunkt „Pegel“ und der Pegel-Tab mit eigener Karte entfallen.
2. **Navigation in dieser Reihenfolge (links nach rechts):** Karte · Meldungen · Melden (mittig) · Gemerkt · Mehr. „Gemerkt“ = gemerkte Orte **und** Pegel (heute „Mehr › Merkliste“). Achtung: Der Prototyp zeigt noch die alte Reihenfolge (Gemerkt an zweiter Stelle). Es gilt die Reihenfolge hier.
3. **Alle Bereiche öffnen als Sheet über der Karte:** Standort, Pegel, Gemerkt, Meldungen, Mehr, Einstellungen, Wetter.
   - Handy: von unten, mit Griff.
   - Desktop ≥ 768 px: als Panel rechts (wie heute `.detail`).
4. **Sheet-Kopf:** Griff oben, **Titel links** (24/700), Unterzeile 14 matt, **runder ×-Knopf rechts** (44 px, weiß, Schatten). Das ersetzt in `DESIGN_SYSTEM.md` die Regel „Kopf mittig, Zurück links“.
5. **Pegel-Ampel wandert ins Pegel-Sheet.** „Passt mein Boot?“ wird ein Abschnitt im Pegel-Sheet. `pegel-ampel.html` bleibt nur als Einstiegsseite für Suchmaschinen (siehe Phase 2b).
6. **„Lage melden“** (dunkle Karte im Melden-Fenster und Formular mit Schnellknöpfen) bleibt optisch unverändert. Diese Ausnahme steht schon in `DESIGN_SYSTEM.md`.
7. Animationen sind ausdrücklich gewünscht, siehe Phase 4.

## Versionen

Jede Phase bekommt eine eigene Nebenversion, beginnend mit **7.68.0**: Phase 0 = 7.68.0, Phase 1 = 7.69.0 usw. Die Stände 7.68–7.74 laufen nur in der Vorschau. Wenn ich nach Phase 5 „übernehmen“ sage, wird daraus **8.0.0**.

---

## Phase 0 – Regeln festschreiben (nur Doku und Tokens, 7.68.0)

`DESIGN_SYSTEM.md` ergänzen bzw. ändern, jeweils mit Begründung „Nutzer, 10.11.2026, Prototyp freigegeben“:

- **Kopf (Sheet, Seite, Dialog):** Flexzeile mit Titelblock links (`flex: 1`) und rundem ×-Knopf rechts. Darüber im Sheet der Griff (40 × 5 px, Radius 3, `--wm-rand`, Trefferfläche ganze Breite × 26 px). Optionale Zusatzaktion als zweiter runder Knopf links neben ×. Die alte Regel `38px 1fr 38px` mittig entfällt.
- **Ortszeile** (neuer Standard für Listen): Höhe ≥ 64, Icon-Kachel 40 × 40 (`petrol-hell`/`petrol-tief`, Radius s), Titel `m 700`, Unterzeile `s matt`, rechts **eines** davon: Wert (`m 700`), Zustandsmarke oder Pfeil (`leise`). Zeilen stehen in einer weißen Gruppe (Radius m, `schatten`), getrennt durch 1 px `--wm-linie`.
- **Aktionsleiste:** wie bisher. Slipanlage: Route (primär) · Merken · Teilen. Pegel: Alarm · Merken · Teilen.
- **Chip:** Kategorie-Chips haben links einen 10-px-Farbpunkt der Kategorie. Aktiv: Grund `--wm-tinte`, Text weiß, der Punkt schrumpft auf 0, ein Häkchen (16 px) wächst hinein.
- **Navigation unten:** fünf Ziele in der Reihenfolge Karte · Meldungen · Melden · Gemerkt · Mehr. Abzeichen an „Meldungen“ (neue Meldungen, wie heute) und an „Gemerkt“ (Anzahl).
- **Bewegung**, neuer Abschnitt. Tokens in `tokens.css`:
  ```css
  --wm-kurz: 150ms;    /* Drücken, Farbwechsel, Häkchen */
  --wm-mittel: 260ms;  /* Umschalter, Listen, Inhaltswechsel */
  --wm-lang: 420ms;    /* Sheets, Suche, Navigation */
  --wm-feder: cubic-bezier(.34, 1.36, .5, 1);  /* leicht überschwingend: Bewegung von Flächen */
  --wm-sanft: cubic-bezier(.2, .8, .2, 1);     /* Ein-/Ausblenden */
  ```
  Regel: keine anderen Dauern oder Kurven. Bei `prefers-reduced-motion: reduce` sind alle Dauern 1 ms, es gibt keinen Flug, kein Zählen und keine Verzögerung.
- Abschnitt „Pegel-Ampel“: Sie ist Teil des Pegel-Sheets (Phase 2b).

Keine sichtbare Änderung an der App.

---

## Phase 1 – Gemeinsame Bausteine (7.69.0, keine sichtbare Änderung)

Heute gibt es `css/bausteine.css` mit 34 `.wm-*`-Klassen, von denen **keine** benutzt wird. Dafür baut jeder Bereich seinen eigenen Kopf: `nh-kopf`, `pd-kopf`, `pg-kopf`, `pa-kopf`, `pf-kopf`, `wxd-kopf`, `vo-kopf`, `bs-kopf`, `wb-kopf`, `ae-kopf`, `mu-kopf`, `fk-kopf`, `pm-kopf`, `meld-kopf` u. a.

1. `bausteine.css` nach dem Prototyp neu aufbauen. Werte nur über Tokens:
   - `.wm-sheet` (Handy: absolut unten, Radius l oben, `--wm-verlauf`, `schatten-hoch`; Zustände `.is-offen`, `.is-klein`; Desktop ≥ 768: Panel rechts)
   - `.wm-griff`, `.wm-kopf`, `.wm-kopf-titel`, `.wm-kopf-unter`, `.wm-rund`
   - `.wm-aktionen` und `.wm-aktion` (`.is-primaer`, `.is-gemerkt`)
   - `.wm-gruppe`, `.wm-zeile`, `.wm-kachel-ico`, `.wm-zeile-text`, `.wm-zeile-wert`, `.wm-pfeil`
   - `.wm-chip` (mit `.wm-chip-punkt`, `.wm-chip-haken`)
   - `.wm-marke` (`.is-gut`, `.is-warn`, `.is-hoch`, `.is-stop`, `.is-leise`)
   - `.wm-hinweis` (Zustandsgrund, wie die grüne Zeile „Heute keine Probleme gemeldet“)
   - `.wm-seg` (Umschalter mit gleitender Markierung `.wm-seg-ind`)
   - `.wm-fakten` und `.wm-fakt`
   - `.wm-held` (großer Wert)
   - `.wm-abschnitt` (Abschnittstitel `s 700 matt`)

   Klassen, die niemand braucht, fliegen raus.
2. Neues Modul `js/bausteine.js` mit kleinen Funktionen auf Basis von `h()` aus `dom.js`: `kopf({ titel, unter, onZu, aktion })`, `zeile({ ico, titel, unter, rechts, onClick, href })`, `gruppe(zeilen)`, `aktionen([...])`, `marke(zustand, text)`, `chip({...})`, `seg({ optionen, wert, onWahl })`.
3. Ein gemeinsamer Sheet-Rahmen `sheetOeffnen({ inhalt, label, onZu })`.
   - Er nutzt das vorhandene Wischen (`wischen.js`) und das Einrasten aus `pegel-dashboard.js` (klein/groß, `transform` statt Höhe, ohne Sprung).
   - Prüfe, ob sich `fenster()` aus `wetter.js` und das Standort-Sheet (`#detail`, `mountDetail`) darauf zurückführen lassen. Ziel ist **ein** Rahmen für alles. Wenn nicht in dieser Phase möglich: begründen und in Phase 3 erledigen.
4. Tests für `bausteine.js` (Markup, `aria-*`, Fokus zurück an den Auslöser beim Schließen).

---

## Phase 2a – Pegel auf die Hauptkarte (7.70.0)

Heute gibt es Pegel doppelt, mit unterschiedlichem Code und unterschiedlichen Farben:

| | Hauptkarte | Pegel-Tab |
|---|---|---|
| Karte | `map.js` | eigene Karte `pegel-karte.js` |
| Marker | `.wm-gauge-pill` (`gaugeMarkerHtml` in `pegel.js`) | `.pk-pille` (`pillenHtml` in `pegel-karte.js`, Cluster, Tide-Welle, Stern) |
| Farben | alte feste Werte in `GAUGE_STATES` (`pegel.js`: `#6CBF84`, `#FAB219` …) | Tokens (`FARBE` in `pegel-karte.js`) |
| Auswahl Handy | `showGaugePeek` in `main.js` | Sheet in `pegel-dashboard.js` |
| Details | `gaugePanel` → `pegelDetail` | `pegelDetail` im Sheet |

Die Aufgaben:
1. **Chip „Pegel“** in `#cats` neben den Kategorien (Farbpunkt `--wm-gut`). Der Schalter „Pegelstände“ im Filter-Panel (`renderFilterPanel`, `main.js`) entfällt. Der Chip schaltet `setGauges()`. Gespeichert wird wie bisher (`prefs 'gauges'`). Die Regel „mindestens eine Ebene bleibt aktiv“ gilt jetzt einschließlich Pegel.
2. **Ein Marker:** `pillenHtml` und die Cluster-Logik aus `pegel-karte.js` nach `map.js` übernehmen (`ZOOM_MIT_ZAHL`, `ZOOM_OHNE_CLUSTER`, Tide-Welle, gemerkte größer mit Stern). Entfernen: `gaugeMarkerHtml`, `.wm-gauge-pill*` in `app.css`, die Farben in `GAUGE_STATES`. Wo `GAUGE_STATES` noch gebraucht wird: Farbe über `ZUSTAND`/`FARBE` (Tokens).
3. **Legende** (normal/niedrig/hoch/über HSW/ohne Kennwerte) als kleine aufklappbare Pille unten links über der Navigation, nur sichtbar, wenn der Chip „Pegel“ an ist.
4. **Ein Pegel-Sheet:** Ein Tipp auf einen Pegel-Marker öffnet `pegelDetail` (bzw. die Tide-Ansicht) im gemeinsamen Sheet, auf dem Handy wie auf dem Desktop.
   - Die kompakte Vorstufe aus `pegel-dashboard.js` (Wert, Kurve, „Details“) wird die **kleine** Stufe des Sheets. Hochwischen ergibt die große Stufe mit allen Details. Das flüssige Einrasten (7.54–7.57) muss erhalten bleiben.
   - `showGaugePeek`, `hideGaugePeek`, `.gpeek*` und `renderGaugeDetail` (ungenutzt) entfernen.
5. **Suche:** Die Hauptsuche (`search.js`, `#q`) findet zusätzlich Pegel (Name, Gewässer) mit Wert und Zustand in der Unterzeile. Ein Treffer schaltet den Chip „Pegel“ ein, fliegt hin und öffnet das Sheet. Ein Gewässer-Treffer schaltet Pegel und Slipanlagen ein und zeigt das Gewässer (fitBounds). Die Reihenfolge der Pegel-Suche aus `pegel-dashboard.js` übernehmen: zuerst passendes Gewässer, `flussKm`-Sortierung.
6. **Pegel-Tab entfernen:**
   - `#pegelseite`, den Pegel-Teil von `setView`, `pegelBereich`, `pegelCtx` (soweit nur dafür), `pegel-karte.js` und `pegel-dashboard.js` (was das Sheet noch braucht, wandert in ein passendes Modul, z. B. `slipsAmPegel`, `kurzWerte`), dazu die zugehörigen `pa-*`/`pk-*`-Regeln in `pegel.css`.
   - **Flussseite** (`pegel-fluss-ansicht.js`) bleibt, aber als Sheet („Weser – alle Pegel“ aus dem Pegel-Sheet), nicht als Seite.
7. **Alte Adressen weiterleiten** (Lesezeichen, Push, geteilte Links):
   - `#pegel` → `#karte` mit Chip Pegel an
   - `#pegel/<id>` und `#karte/pegel/<id>` → Karte, Pegel an, Pegel gewählt, Sheet offen
   - `#pegel/fluss/<name>` → Karte mit Fluss-Sheet
   - `#pf=<id>` (Push) → wie `#pegel/<id>`
   - Prüfe auch `sw.js` (`notificationclick`) und die E-Mail-Texte in `netlify/lib/` auf Links.
8. Die Doppelung `pd-blau`/`pa-blau` (109 Regeln in `pegel.css`, Rest aus 7.52/7.53) auflösen: Die Regeln gelten direkt für `.pd`, der Zusatz entfällt.
9. Tests anpassen bzw. ersetzen: `ui_pegel.py`, `ui_pegel_dashboard.py`, `ui_pegel_fluss.py`, `ui_nav.py`, `nav_test.mjs`, `boot_test.mjs`. Neue Tests: Chip an/aus, Marker-Tipp öffnet Sheet, alle Weiterleitungen, Suche findet Pegel.

---

## Phase 2b – Pegel-Ampel ins Pegel-Sheet (7.71.0)

Heute gilt die Ampel für **einen** Pegel (`localStorage watermap.ampel = { pegel, min, boot, hoehe }`) auf einer eigenen Seite im alten Navy-Stil. Die Bewertung steckt in `ampel-logik.js` (getestet) und bleibt.

1. **Abschnitt „Passt mein Boot?“ im Pegel-Sheet**, direkt unter der Aktionsleiste:
   - Noch kein Mindestpegel für diesen Pegel: eine Zeile „Passt mein Boot? · Mindestpegel festlegen ›“. Ein Tipp öffnet im selben Sheet ein kleines Formular: Mindestpegel in cm (Feld nach Designsystem, −/+ in 5-cm-Schritten wie im Alarm-Fenster), Bootstyp aus den Einstellungen vorbelegt.
   - Mit Mindestpegel: eine Hinweiszeile im Zustand der Ampel (`wm-hinweis`) mit Wort und Abstand, z. B. „Passt – 42 cm über deinem Mindestpegel“, „Knapp – …“, „Zu niedrig – …“. Bei Vorhersage die bestehende Ampel-Logik für die nächsten Tage als kurze Zeile. „Ändern“ als leiser Knopf.
   - Die Ampel-Farben kommen aus den Zustands-Tokens (gut/warn/stop), immer mit Wort.
2. **Mindestpegel pro Pegel** in `watermap.mindestpegel = { <pegelId>: cm }`. Einmalige Übernahme aus `watermap.ampel` (Pegel und `min`). Der Bootstyp bleibt in `watermap.ampel.boot` bzw. den Einstellungen; bitte ggf. sauber nach `watermap.boot` zusammenführen und alte Schlüssel lesen.
3. **Überall sichtbar:** Pegel mit Mindestpegel zeigen die Ampel auch in „Gemerkt“ (Marke rechts) und im Pegel-Kasten des Slipanlagen-Sheets (ersetzt das heutige `AMPEL_TAG`/`pegelBox`-Etikett in `main.js`).
4. **Alarm:** Es gibt nur noch das Alarm-Fenster aus `alarm.js` (Push oder E-Mail). Ist ein Mindestpegel gesetzt, schlägt es „unter <Mindestpegel> cm“ vor. Den bisherigen E-Mail-Ampel-Alarm im **Backend nicht entfernen**: Bestehende Anmeldungen laufen weiter. Neu angelegt wird er nicht mehr. Prüfe `pegel-alarm-kern.mjs` und `pegel-alarm-pruefen.mjs`; die Abmelde- und Bestätigungslinks in den E-Mails müssen weiter funktionieren.
5. **`pegel-ampel.html` wird Einstiegsseite:**
   - Titel, Beschreibung und `canonical` bleiben (Suchmaschinen).
   - Inhalt kurz im Designsystem (`page.css`, Wassergrund, weiße Karte, kein Navy-Kopf): was die Pegel-Ampel kann, ein Knopf „Pegel suchen“ → `./#karte` mit Pegel an und offener Suche.
   - `?pegel=<id>` leitet direkt auf `./#pegel/<id>` weiter (Phase 2a leitet weiter ins Sheet). `#am-alarm` → Sheet mit Alarm-Fenster.
   - `ampel.js` und `ampel.css` entfallen bis auf das, was die Einstiegsseite braucht. `theme-color` angleichen.
6. Die Links „Passt mein Boot?“ (`pegel-ansicht.js`, `einstellungen.js` „Ampel-Alarm (Pegel-Ampel)“) zeigen jetzt auf den Abschnitt im Sheet.
7. Tests: `test_ampel_logik.py`/`ampel_logik_test.mjs` bleiben. `ui_ampel.py` wird ersetzt durch Tests für den Abschnitt im Sheet, die Übernahme aus `watermap.ampel` und die Weiterleitungen von `pegel-ampel.html`.

---

## Phase 3 – Navigation und alle Bereiche als Sheet (7.72.0)

1. `NAV` in `nav.js` in genau dieser Reihenfolge: `karte`, `meldungen`, `melden` (mittig), `gemerkt` (Icon Lesezeichen), `mehr`. Auch die Desktop-Kopfleiste: Karte · Meldungen · Gemerkt · Mehr, dazu „+ Melden“ wie bisher.
   - Abzeichen an „Gemerkt“ = Anzahl gemerkter Orte + Pegel.
   - `NAV_ZIEL` anpassen: `favoriten` und `mehr/merkliste` → `gemerkt`.
   - Desktop-Kopfleiste entsprechend.
2. **Gemerkt** (`#gemerkt`, alte Adressen `#favoriten`, `#mehr/merkliste` leiten weiter) als Sheet über der Karte:
   - Abschnitt „Pegel“ (Ortszeile mit Wert, Zustand bzw. Ampel), Abschnitt „Orte“ (Ortszeile mit Art · Gewässer · Entfernung).
   - Tipp → das jeweilige Sheet.
   - „Rückgängig“ beim Entfernen bleibt (Toast aus 7.67.0).
   - Leer: Satz + Handlung („Noch nichts gemerkt – tippe bei einem Ort oder Pegel auf ☆“).
   - `mehr.js` gibt die Merkliste ab.
3. **Meldungen** (`meldungen-uebersicht.js`) als Sheet. Filter, Reiter „Mein Standort“ mit Umkreis-Regler und Bewerten bleiben. Kopf und Listen auf die Bausteine (Ortszeile mit Zustandsmarke).
4. **Mehr** als Sheet. Einträge als Ortszeilen: In der Nähe, Einstellungen, Hilfe, Über WaterMap (Quellen, Datenschutz, Impressum). **Einstellungen** (`einstellungen.js`) öffnet als Sheet. Die dunkle Karte „Mein WaterMap“ wird hell im Designsystem.
5. **In der Nähe** (`naehe.js`): Es ist schon ein Fenster von unten (7.44). Jetzt Kopf und Zeilen auf die Bausteine, Desktop als Panel.
6. **Wetter**, **Pegel-Fenster** und **Fluss** (`fenster()` in `wetter.js`, `pegelFenster`, `flussFenster` in `main.js`) laufen über denselben Sheet-Rahmen. Ein Sheet über einem Sheet (z. B. Pegel aus dem Slipanlagen-Sheet) stapelt sich. × und Wischen führen eine Ebene zurück, der Fokus geht an den Auslöser.
7. **Melden-Menü und Formulare** (Foto, Angaben ergänzen, neue Slipanlage, Fehler melden): Kopf auf `kopf()` umstellen, sonst so lassen; diese Teile sind das Vorbild. „Lage melden“ unverändert.
8. **Seiten** `#pegelseite`, `#meldungsseite`, `#mehrseite` entfallen. Zurück im Browser schließt das oberste Sheet (`history.state`).
9. Die 15 alten Kopf-Varianten (siehe Phase 1) sind danach gelöscht. Prüfe mit `grep`, dass keine übrig ist.
10. Tests: `ui_nav.py`, `ui_meldungen.py`, `ui_extras.py`, `ui_einstellungen.py`, `ui_naehe.py`, `ui_bereiche.py`, `ui_wischen.py` anpassen; Weiterleitungen testen.

---

## Phase 4 – Animationen (7.73.0)

Alle Dauern und Kurven nur aus den Bewegungs-Tokens. Bewegt werden nur `transform` und `opacity`, keine Höhen oder Breiten (Ausnahme: die Suchpille, siehe 1). Bei „Bewegung reduzieren“ geschieht alles sofort. Maße und Abläufe siehe Prototyp.

1. **Lupe → Suchfeld** (Handy; Desktop behält die offene Suche in der Kopfleiste):
   - Zu: links das runde Logo (48 px), rechts ein runder Lupen-Knopf (48 px), dazwischen frei.
   - Tipp auf die Lupe: Die Pille wächst von rechts auf volle Breite (`width`, `--wm-lang`, `--wm-feder`; hier ausnahmsweise Breite, alternativ `clip-path`). Das Logo kippt weg (Skalierung .5, −30°, ausblenden). Die Lupe dreht sich zum × (Kreuzblende mit Drehung ±90°). Das Feld blendet nach 160 ms ein und bekommt den Fokus, die Tastatur geht auf. Die Chips gleiten 8 px nach oben weg.
   - Vorschläge: Karte fällt ein (`translateY(-8px) scale(.96)` → normal), Zeilen um 45 ms versetzt.
   - × bzw. Escape: alles rückwärts. Fokus zurück auf die Lupe.
   - Barrierefreiheit: `aria-expanded` an der Lupe, Feld im zugeklappten Zustand nicht fokussierbar.
2. **Marker → Sheet:** Der gewählte Marker wächst (Ort 1,3×, Pegel 1,15× und dunkel). Das Sheet fährt mit `--wm-feder` hoch. Der Inhalt gleitet 14 px von unten ein (`--wm-mittel`). Ein Inhaltswechsel im offenen Sheet (anderer Ort) blendet weich über.
3. **Marker erscheinen** (Chip an): Sie ploppen von Skalierung .3 ein, 60–70 ms versetzt, höchstens die ersten 30 im Ausschnitt; der Rest ohne Verzögerung.
4. **Merken:**
   - Der Stern ploppt (1,45× mit leichter Drehung, `--wm-feder`, 480 ms) und füllt sich mit `--wm-sonne`.
   - Beim **Hinzufügen** fliegt ein zweiter Stern im Bogen vom Knopf zum Navigationspunkt „Gemerkt“ (820 ms, Start und Ziel per `getBoundingClientRect`, fixed). Bei Ankunft springt das Abzeichen (1,5×). „Gemerkt“ steht rechts neben Melden (vierter Platz); der Bogen führt also nach rechts unten.
   - Desktop: Flug zur „Gemerkt“-Stelle in der Kopfleiste.
   - Beim Entfernen kein Flug, nur Toast mit „Rückgängig“.
5. **Chips:** Der Farbpunkt schrumpft, das Häkchen wächst hinein (`--wm-feder`), die Fläche blendet zu Tinte. Beim Drücken Skalierung .94.
6. **Umschalter** (24 Std./7 Tage/30 Tage und alle anderen `wm-seg`): Die weiße Markierung gleitet per `translateX` zur Wahl (`--wm-feder`).
7. **Navigation:** Die bestehende wandernde Markierung (`.bn-ind`, 7.37) auf die Tokens umstellen (`CONFIG.NAV_ANIM_MS` → `--wm-lang`). Der Melden-Knopf ploppt beim Tipp.
8. **Pegelwert:** Beim Öffnen zählt der große Wert die letzten 36 cm hoch (700 ms, ease-out). Die Kurve zeichnet sich (`stroke-dashoffset`, 900 ms), die Fläche blendet nach. Der Punkt im Einordnungsbalken gleitet von links an seinen Platz. Beim Zeitraumwechsel zeichnet sich die neue Kurve.
9. **Listen** (Gemerkt, Meldungen, Mehr, Suchtreffer, In der Nähe): Die Zeilen erscheinen 8 px von unten, 50–60 ms versetzt, höchstens die ersten 10.
10. **Senden erfolgreich** (Lage, Foto, Angaben, Fehler): Ein Haken zeichnet sich als Linie (`stroke-dashoffset`).
11. **Aktualisieren:** Beim Ziehen nach unten in Listen erscheint statt eines Kreisels eine kleine Welle (Wellen-Icon, das sich seitlich bewegt). Prüfe, wo heute Laden-Kreisel stehen (`@keyframes spin`, `pg-dreh`, `pa-dreh`) und vereinheitliche.
12. **Laden:** Ein gemeinsamer Schimmer-Platzhalter (`@keyframes shimmer` gibt es schon) für Sheets und Listen.
13. Toast (7.67.0): Er fährt mit `--wm-feder` 16 px von unten ein.

Teste die Abläufe mit Playwright: Klassen/Zustände nach der Animation, und mit `reducedMotion: 'reduce'`, dass nichts wartet.

---

## Phase 5 – Aufräumen (7.74.0)

Stand 7.67.0 (gezählt in `public/css`):
- `font-size`: über 20 verschiedene px-Werte (13,5/14,5/15,5/16,5/17/19/21 …), ~550 Stellen ohne Token, 146 mit.
- `font-weight`: ~230 Stellen mit 500/600/650/750/800/900, erlaubt sind nur 300 (nur `held`), 400 und 700.
- `border-radius`: zusätzlich 14, 10, 16, 20, 8, 9, 13, 5 px. Erlaubt sind 12/18/26/rund (Ausnahmen in Abschnitt 9 begründen).
- `box-shadow`: 121 eigene Schatten, erlaubt sind 2 Tokens (+ Fokusring).
- `var(--navy)`: ~280 Stellen, laut Designsystem nur Logo und Desktop-Kopfleiste. Sonst → `--wm-tinte` (Text, aktive Flächen) bzw. `--wm-petrol` (Aktion).
- Alte Variablen in `app.css` (`--navy`, `--ink`, `--muted`, `--bg`, `--line`, `--slip`, `--sky: #9CCEE3`, `--radius: 14px`) und die eigenen in `ampel.css` → Tokens, danach löschen.
- Feste Farben in JS: `wetter.js` (Warnstufen inkl. `#8B1A6B`, dafür ggf. Token `--wm-extrem` ergänzen), `map.js` (Standortkreis, Gebietsmaske), `pegel-bild.js`, `pegel-tide-ansicht.js`, `icons.js`.
- Breakpoints: nur 768 (und 1024, falls nötig). 400/420/1100/1199 prüfen und auflösen.

Die Aufgaben:
1. Mit einem Skript ersetzen: Größe → nächstes Token, 500 → 400, 600/650/750/800 → 700, Radien → s/m/l/rund, Schatten → Tokens. Danach alle Bereiche bei 390 und 1440 px vergleichen; Ausreißer von Hand.
2. **Wächter-Test** (`tests/design_tokens_test.mjs` o. ä.): Er schlägt fehl bei neuen Hex-Werten, px-Schriftgrößen, Gewichten außer 300/400/700, Radien und Schatten außerhalb der Tokens in `public/css` und `public/js`. Begründete Ausnahmen (Leaflet, Kartendaten-Farben, „Lage melden“, Plaketten < 13 px laut 7.66.1) über eine Liste im Test.
3. Ungenutzten Code entfernen: `nearbySection`, `liveNearby` (`extras.js`), `loadWetterStunden` (`wetter.js`), `renderGaugeDetail` falls noch da, alles, was nach Phase 2/3 verwaist ist. Prüfe auch die Funktion `umgebung.mjs` (nach 7.43 ungenutzt?) und frag, bevor du Netlify-Funktionen löschst.
4. `main.js` (1505 Zeilen) entlasten: Routing, Sheets und Pegel in eigene Module, soweit sinnvoll.
5. `watermap-stand.md`, `README.md`, `DESIGN_SYSTEM.md` auf den neuen Stand bringen (Adressen-Tabelle, Module, Navigation).

---

## Abnahme nach jeder Phase

- Alle Tests grün.
- Bildschirmfotos 390 und 1440 px: Karte, Slipanlagen-Sheet, Pegel-Sheet (klein und groß), Gemerkt, Meldungen, Mehr, Einstellungen, Suche offen. Ab Phase 4 zusätzlich kurze Aufnahmen (GIF/Video) von Lupe, Merken, Sheet-Öffnen.
- Kurze Liste: was geändert, was entfernt, offene Punkte.
- Dann warten, bis ich freigebe.

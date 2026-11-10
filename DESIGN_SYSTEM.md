# WaterMap – Designsystem „Wasser“

Verbindlich für jede Arbeit an der Oberfläche (`public/`). Richtung: **C „Contemporary Product“ mit der Disziplin von A** (Entscheidung des Nutzers, Version 7.57.1).
Kurz: freundlich, hell, draußen lesbar – aber mit festen Tokens statt Einzelwerten.

---

## 1. Designprinzipien

1. **Draußen lesbar.** WaterMap wird am Wasser benutzt: Sonne, eine Hand, nasse Finger. Große Zahlen, klare Zustände, Trefferflächen ≥ 44 px, Kontrast mindestens WCAG AA.
2. **Die Antwort zuerst.** Jede Ansicht beantwortet zuerst die Frage des Nutzers („Wie hoch ist der Pegel?“, „Kann ich hier slippen?“) – groß und oben. Erklärungen und Quellen folgen darunter oder hinter „Details“.
3. **Ein Akzent.** Petrol ist die einzige Aktionsfarbe. Ampel- und Warnfarben stehen nur für Zustände, nie für Dekoration.
4. **Ruhe durch Regeln.** Nur die Tokens dieses Dokuments: 7 Schriftgrößen, 3 Radien (+ rund), 2 Schatten, ein 4-px-Raster. Keine Einzelwerte, keine Sonderlösungen.
5. **Bewegung antwortet.** Animation nur als Reaktion auf eine Handlung (öffnen, wischen, bestätigen) und um zu zeigen, was sich geändert hat. Nie als Schmuck.
6. **Wasser als Grund, Weiß als Inhalt.** Der hellblaue Wasserverlauf ist die Bühne (Sheets, Seiten), weiße Flächen tragen den Inhalt. Mehr Ebenen gibt es nicht.

---

## 2. Farb-Tokens

Alle Farben als CSS-Variablen auf `:root` mit Präfix `--wm-`. Neue Hex-Werte im CSS sind nicht erlaubt – fehlt ein Ton, wird hier ein Token ergänzt.

### Grund und Flächen
| Token | Wert | Verwendung |
|---|---|---|
| `--wm-wasser` | `#E4F2F8` | oberer Ton des Wasserverlaufs, Sheet-Kopf (deckend) |
| `--wm-wasser-2` | `#F6FAFC` | unterer Ton des Wasserverlaufs, Seitengrund |
| `--wm-verlauf` | `linear-gradient(180deg, var(--wm-wasser), var(--wm-wasser-2) 45%)` | Grund von Sheets, Seiten, Dialogen |
| `--wm-flaeche` | `#FFFFFF` | Karten, Gruppen, Knöpfe, Felder |
| `--wm-flaeche-2` | `#F1F6F8` | Felder in Karten (Fakten-Kacheln, Segment-Spur, Eingabefelder) |
| `--wm-linie` | `#E3EBEF` | Trennlinien in Listen, Feldrahmen |
| `--wm-rand` | `leise` 50 % auf Weiß (≈ `#BEC7CE`) | kräftigere Linie: Sheet-Griffe, Hover-Rahmen, gestrichelte Ablageflächen, Schraffur (ergänzt 7.66.0, weil `linie` auf Wassergrund nicht sichtbar ist) |

### Text
| Token | Wert | Kontrast auf Weiß |
|---|---|---|
| `--wm-tinte` | `#0E2E42` | 14,1 : 1 – Text, Titel, Icons |
| `--wm-matt` | `#526676` | 6,0 : 1 – Nebentext, Beschriftungen (auf `--wm-wasser` 5,2 : 1) |
| `--wm-leise` | `#7C8F9C` | 3,4 : 1 – nur Icons/Pfeile/Platzhalter, **nie** für Fließtext |

### Akzent
| Token | Wert | Verwendung |
|---|---|---|
| `--wm-petrol` | `#0B7C93` | Hauptaktion (gefüllt, Text weiß 4,9 : 1), Links, aktive Navigation, Kurven |
| `--wm-petrol-tief` | `#075F72` | Text/Icon auf `--wm-petrol-hell` (6,2 : 1), gedrückter Zustand |
| `--wm-petrol-hell` | `#DDF0F5` | aktive Navigation, Icon-Kacheln, sanfte Auswahl |
| `--wm-sonne` | `#F2B33D` | nur Füllung des Merken-Sterns (immer mit Kontur `--wm-tinte`) |
| `--wm-fokus` | `#1C8FB8` | Fokusring |

### Zustände (Ampel, Meldungen, Warnungen)
Jeder Zustand hat **Punkt** (Kreis/Marker, ≥ 3 : 1), **Text** (≥ 4,5 : 1) und **Grund** (Fläche).

| Zustand | Punkt | Text | Grund | Beispiele |
|---|---|---|---|---|
| gut / normal | `--wm-gut` `#1E9E5A` | `--wm-gut-text` `#17703F` | `--wm-gut-hell` `#E3F5EA` | Pegel normal, „Heute keine Probleme“ |
| Achtung / niedrig | `--wm-warn` `#C27A00` | `--wm-warn-text` `#8A5300` | `--wm-warn-hell` `#FFF1D6` | Pegel niedrig, Parkplatz voll, Wetterwarnung |
| hoch | `--wm-hoch` `#D23B21` | `--wm-stop-text` `#A33A1C` | `--wm-stop-hell` `#FDECEA` | Pegel über MHW |
| Sperre / über HSW | `--wm-stop` `#B42318` | `--wm-stop-text` `#A33A1C` | `--wm-stop-hell` `#FDECEA` | gesperrt, über HSW, Unwetter |
| ohne Wert / veraltet | `--wm-leise` `#7C8F9C` | `--wm-matt` | `--wm-flaeche-2` | keine Kennwerte, Messwert alt |

**Rahmen im Zustand** (ergänzt 7.66.0): `--wm-gut-rand`, `--wm-warn-rand`, `--wm-hoch-rand`, `--wm-stop-rand` = Punkt 35 % auf Weiß (`color-mix`), für Rahmen von Hinweisen, Meldungskarten und Chips auf dem Zustandsgrund sowie für die Abschnitte des Einordnungsbalkens (mit Punkt-Farben wirkte er zu schwer). Punkte, Kartenpillen und Marker nutzen die **Punkt**-Farbe: niedrig `warn`, normal `gut`, hoch `hoch`, über HSW `stop`, ohne Kennwerte `leise`.

### Kategorien (Karte)
Bleiben wie bisher, nur als Tokens: `--wm-slip #087F9C`, `--wm-hafen #16619B`, `--wm-tanke #D78B23` (Text: `--wm-tanke-text #8A4F00`).

### App-Leiste
`--wm-navy #0B3045` bleibt **nur** für das Logo und die oberste Leiste mit der Suche (Desktop). Seiten und Sheets nutzen keinen dunklen Grund mehr.

---

## 3. Typografie

**Schrift:** *Atkinson Hyperlegible Next* (SIL Open Font License, kostenlos), selbst gehostet als `woff2` in `public/fonts/` – kein Abruf bei Google, datenschutzfreundlich. Datei in `SHELL_FILES` aufnehmen.
Fallback: `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`. `font-display: swap`.
Zahlen immer mit `font-variant-numeric: tabular-nums` (Werte springen nicht). Die Null wird **ohne Schrägstrich** gezeigt (Wunsch des Nutzers; Glyphe in `public/fonts/atkinson-next-latin.woff2` angepasst, siehe `public/fonts/LIESMICH.txt`).

| Token | Größe / Zeilenhöhe | Gewicht | Verwendung |
|---|---|---|---|
| `--wm-t-held` | 72 / 1,0 | 300 | der eine große Wert (Pegelstand, Wind im Wetterfenster) |
| `--wm-t-xxl` | 32 / 1,1 | 700 | Kachelwerte (z. B. „96 cm“) |
| `--wm-t-xl` | 24 / 1,15 | 700 | Titel von Sheets und Seiten |
| `--wm-t-l` | 20 / 1,25 | 700 | Abschnittstitel, Dialogtitel |
| `--wm-t-m` | 16 / 1,45 | 400 / 700 | Fließtext, Knöpfe, Listenzeilen (Grundgröße) |
| `--wm-t-s` | 14 / 1,4 | 400 / 700 | Nebentext, Beschriftungen, Chips, Navigation |
| `--wm-t-xs` | 13 / 1,35 | 400 / 700 | Quellen, Zeitstempel, Achsen – **kleiner nie** |

Regeln:
- Nur die Gewichte 300 (nur `held`), 400 und 700.
- Überschriften in normaler Schreibweise („Wichtig für dein Boot“), **keine Großbuchstaben-Etiketten** mit Sperrung.
- Zeilenlänge Fließtext ≤ 70 Zeichen.
- Einheiten kleiner als der Wert: `96<small>cm</small>` (Einheit 45–50 % der Wertgröße, Gewicht 400).

---

## 4. Spacing und Layout

**Raster 4 px.** Tokens: `--wm-1: 4px`, `--wm-2: 8px`, `--wm-3: 12px`, `--wm-4: 16px`, `--wm-5: 20px`, `--wm-6: 24px`, `--wm-8: 32px`, `--wm-12: 48px`.

| Regel | Wert |
|---|---|
| Seitenrand Handy | `--wm-4` (16 px), in Sheets 14 px wie heute → wird auf 16 px vereinheitlicht |
| Abstand zwischen Karten | `--wm-3` (12 px) |
| Innenabstand Karte | 12 px oben/unten, 14–16 px seitlich |
| Abstand Abschnittstitel → Inhalt | `--wm-2` |
| Abstand zwischen Abschnitten | `--wm-6` |
| Trefferfläche | mindestens 44 × 44 px |

**Radien:** `--wm-r-s: 12px` (Felder, Fakten-Kacheln, Segmente) · `--wm-r-m: 18px` (Karten, Knöpfe) · `--wm-r-l: 26px` (Sheets, Dialoge oben) · `--wm-r-rund: 999px` (Chips, runde Knöpfe, Marken, Navigation).

**Schatten:** `--wm-schatten: 0 1px 2px rgba(14,46,66,.06), 0 4px 14px rgba(14,46,66,.07)` (alles auf dem Wasser) · `--wm-schatten-hoch: 0 -6px 24px rgba(14,46,66,.14)` (Sheets, schwebende Navigation, Suche über der Karte). Keine weiteren.

**Ebenen (Aufbau einer Ansicht):**
```
Karte / Seitengrund (Wasserverlauf)
 └─ Sheet / Seite          Radius l, schatten-hoch
     └─ Karte / Gruppe     weiß, Radius m, schatten
         └─ Feld / Kachel  flaeche-2, Radius s, ohne Schatten
```
Nie tiefer verschachteln. Keine Karte in einer Karte mit Schatten.

**Ausrichtung:** Kopf von Sheets/Seiten/Dialogen **linksbündig** (Titel, Unterzeile; × rechts), Inhalt **linksbündig**. Große Einzelwerte mittig. Ersetzt „Kopf mittig, Zurück links“ (Nutzer, 10.11.2026, Prototyp freigegeben).

**Sheet (Handy):** zwei Stufen – *klein* (Inhalt bis ~60 %) und *groß* (oben bleibt Suche + 60 px Karte sichtbar). Folgt dem Finger, rastet ohne Sprung ein (siehe `pegel-dashboard.js`, `wischen.js`).

---

## 5. Komponentenstandards

| Komponente | Standard |
|---|---|
| **Griff** (Sheet) | oben mittig 40 × 5 px, Radius 3, `--wm-rand`; Trefferfläche ganze Breite × 26 px (Knopf „Größe ändern“). |
| **Kopf** (Sheet, Seite, Dialog) | Flexzeile: Titelblock links (`flex: 1`) mit Titel `xl` (24/700) und Unterzeile `s matt`, rechts runder ×-Knopf (44 px, weiß, `schatten`). Optionale Zusatzaktion als zweiter runder Knopf links neben ×. Im Sheet steht darüber der Griff. Grund deckend `--wm-wasser`, damit beim Scrollen nichts durchscheint. Die alte Regel `38px 1fr 38px` (mittig, Zurück links) entfällt (Nutzer, 10.11.2026, Prototyp freigegeben). |
| **Aktionsleiste** | 3 gleich breite Knöpfe, Icon über Text, Höhe 62 px, Radius m. Primär (Route) gefüllt Petrol, sonst weiß. Merken: Stern mit Sonne-Füllung, wenn gemerkt. Slipanlage: Route (primär) · Merken · Teilen. Pegel: Alarm · Merken · Teilen. |
| **Knopf** | Primär: Petrol, Text weiß, Höhe 48. Sekundär: weiß + schatten. Leise: Text Petrol ohne Fläche. Beschriftung = Handlung („Lage melden“, nicht „OK“). Kein „→“ im Text. |
| **Karte / Gruppe** | weiß, Radius m, schatten, kein Rahmen. Titel `l` oder `s 700`. |
| **Ortszeile** (Standard für alle Listen) | Höhe ≥ 64, Icon-Kachel 40 × 40 (`petrol-hell` / `petrol-tief`, Radius s), Titel `m 700`, Unterzeile `s matt`, rechts **eines** davon: Wert (`m 700`), Zustandsmarke oder Pfeil (`leise`). Zeilen stehen in einer weißen Gruppe (Radius m, `schatten`), getrennt durch 1 px `--wm-linie`. Ersetzt die „Listenzeile“ (≥ 56) (Nutzer, 10.11.2026, Prototyp freigegeben). |
| **Wert-Kachel** | Beschriftung `s matt` mit Icon, Wert `xxl` tabular, darunter eine Zustandsmarke. Zwei Kacheln nebeneinander. |
| **Zustandsmarke** | Pille, Radius rund, `s 700`, Grund `*-hell`, Text `*-text`. Immer mit Wort („Niedrig“), nie nur Farbe. |
| **Chip** (Filter) | Höhe 40, Radius rund, weiß + schatten, `s 700`. Kategorie-Chips (Slipanlagen, Häfen, Tanken, Pegel) haben links einen 10-px-Farbpunkt der Kategorie (Pegel: `--wm-gut`). Aktiv: Grund `--wm-tinte`, Text weiß, der Punkt schrumpft auf 0, ein Häkchen (16 px) wächst hinein (Nutzer, 10.11.2026, Prototyp freigegeben). |
| **Segment-Umschalter** | Spur `flaeche-2`, Radius s, aktive Option weiß + schatten. |
| **Eingabefeld** | Höhe 48, weiß, Rahmen 1,5 px `--wm-linie`, Radius s, Text `m`. Fokus: Rahmen Petrol + Fokusring. Fehler: Rahmen `--wm-stop`, Text darunter `s stop-text`. Beschriftung immer sichtbar über dem Feld. |
| **Hinweis / Warnung** | Karte mit Grund `*-hell`, Rahmen 1,5 px in Punktfarbe, Icon links. Amtliche Warnungen zusätzlich linker Streifen 4 px. |
| **Navigation unten** (Handy) | schwebende Pille, 5 Ziele in dieser Reihenfolge: **Karte · Meldungen · Melden · Gemerkt · Mehr**; aktives Ziel `petrol-hell` / `petrol`. Melden mittig als runder Petrol-Knopf. Abzeichen an „Meldungen“ (neue Meldungen) und an „Gemerkt“ (Anzahl gemerkter Orte + Pegel). „Gemerkt“ = heute „Mehr › Merkliste“. Desktop-Kopfleiste: Karte · Meldungen · Gemerkt · Mehr, dazu „+ Melden“ (Nutzer, 10.11.2026, Prototyp freigegeben). |
| **Sheet** | ein Rahmen für alle Inhalte (Standort, Pegel, Gemerkt, Meldungen, Mehr, Einstellungen, Wetter, Fluss). Handy: von unten, Griff, Radius l oben, `--wm-verlauf`, `schatten-hoch`, Stufen klein/groß. Desktop ≥ 768: Panel rechts (wie `.detail`). Sheets stapeln sich; × und Wischen führen eine Ebene zurück, der Fokus geht an den Auslöser (Nutzer, 10.11.2026, Prototyp freigegeben). |
| **Kopfleiste** (Desktop ≥ 768) | `--wm-navy` mit Logo, Suche, Navigation – einzige dunkle Fläche. |
| **Kurzmeldung (Toast)** | unten mittig über Navigation/Sheet, Grund `--wm-tinte`, Text weiß `s`, Radius s, `schatten-hoch`, max. 480 px. Optional **eine** Aktion rechts (z. B. „Rückgängig“ nach dem Entfernen aus der Merkliste): Text `--wm-petrol-hell` 700, Trefferfläche ≥ 44 px. Ohne Aktion 5 s, mit Aktion 8 s sichtbar; solange die Aktion den Fokus hat, bleibt die Meldung stehen. Vorbild: Material-3-Snackbar (ergänzt 7.67.0; `--wm-tinte` statt Navy, weil Navy nur Logo/Kopfleiste ist). |
| **Leerer Zustand** | Satz, was fehlt, + eine Handlung („Noch keine Fotos – Foto einreichen“). |
| **Fehler** | Was ist passiert + was tun, im Ton der App, ohne Entschuldigung („Pegeldaten sind gerade nicht erreichbar. Erneut versuchen“). |
| **Icons** | Linien-Icons aus `public/js/icons.js` (`icon(name, px)`), 24er-Raster, Strich 2 px, runde Enden. Größen 16 / 20 / 24. Farbe = Textfarbe. Keine gefüllten Icons außer gemerktem Stern und Kartenmarkern. |
| **Diagramme** | Linie `--wm-petrol` 2,2 px, Fläche Petrol 8 %, Gitter `--wm-linie`, Achsen `xs matt`, Referenzlinien `--wm-leise`, HSW `--wm-stop`. |

---

## 6. Responsive Breakpoints

| Name | Breite | Verhalten |
|---|---|---|
| Handy | < 768 px | Sheets von unten, Navigation unten schwebend, ein Spaltenfluss |
| Tablet | 768–1023 px | Kopfleiste oben, Details als Seitenleiste 420 px |
| Desktop | ≥ 1024 px | wie Tablet, Inhalte max. 760 px breit (Seiten), Raster zweispaltig wo sinnvoll |

Zusätzlich nur `max-width: 400px` für sehr schmale Handys (Schrift/Knöpfe enger). Keine weiteren Grenzen.
Prüfbreiten bei jeder Änderung: **375, 390, 1024, 1440 px**. Keine horizontale Scrollbar.

---

## 7. Interaktionszustände

| Zustand | Darstellung |
|---|---|
| Ruhe | wie oben |
| Hover (Maus) | Fläche 3 % dunkler (`#F3F7F9` statt Weiß), Primär `--wm-petrol-tief` |
| Gedrückt | `transform: scale(.98)`, 80 ms |
| Fokus (Tastatur) | `outline: 3px solid var(--wm-fokus); outline-offset: 2px` – nie entfernen |
| Ausgewählt | `aria-pressed="true"` / `aria-current`: `petrol-hell` + `petrol-tief` bzw. Chip gefüllt |
| Deaktiviert | Deckkraft 45 %, kein Hover, `disabled`-Attribut |
| Lädt | Platzhaltertext („Pegel werden geladen …“) oder Icon dreht sich; Knopf `aria-busy="true"` |
| Veraltet / offline | Zustand „ohne Wert“, Text sagt warum („Messwert von gestern, 14:20 Uhr“) |

**Bewegung:** siehe Abschnitt 7a.

---

## 7a. Bewegung

Neu (Nutzer, 10.11.2026, Prototyp freigegeben). Animationen sind ausdrücklich gewünscht – aber nur mit diesen Tokens (`public/css/tokens.css`):

| Token | Wert | Verwendung |
|---|---|---|
| `--wm-kurz` | 150 ms | Drücken, Farbwechsel, Häkchen |
| `--wm-mittel` | 260 ms | Umschalter, Listen, Inhaltswechsel |
| `--wm-lang` | 420 ms | Sheets, Suche, Navigation |
| `--wm-feder` | `cubic-bezier(.34, 1.36, .5, 1)` | leicht überschwingend: Bewegung von Flächen (Sheet, Markierung, Häkchen, Stern) |
| `--wm-sanft` | `cubic-bezier(.2, .8, .2, 1)` | Ein- und Ausblenden |

Regeln:
- **Keine anderen Dauern oder Kurven.** Ausnahmen mit fester Dauer, weil sie einen Ablauf zeigen (Prototyp): Stern-Plopp 480 ms, Flug zu „Gemerkt“ 820 ms, Zählen des Pegelwerts 700 ms, Kurve zeichnen 900 ms; Verzögerungen für versetzte Listen 45–70 ms je Zeile.
- Bewegt werden nur `transform` und `opacity` (Ausnahme: Breite der Suchpille beim Aufklappen, ersatzweise `clip-path`).
- Bewegung antwortet auf eine Handlung (Prinzip 5): öffnen, wählen, merken, umschalten, senden. Versetztes Einblenden höchstens für die ersten 10 Listenzeilen bzw. 30 Marker.
- `prefers-reduced-motion: reduce`: alle Dauern 1 ms – kein Flug, kein Zählen, keine Verzögerung.
- Die Abläufe im Einzelnen (Lupe → Suchfeld, Marker → Sheet, Merken mit Flug, Chips, Umschalter, Navigation, Pegelwert, Listen, Senden, Aktualisieren, Laden, Toast) stehen im Auftrag `docs/AUFTRAG-designumbau.md`, Phase 4, Vorbild `docs/prototyp-designumbau.dc.html`.

---

## 8. Accessibility-Regeln

- Kontrast: Text ≥ 4,5 : 1, große Zahlen/Icons/Bedienränder ≥ 3 : 1 (Werte siehe Abschnitt 2).
- Information nie nur über Farbe: Zustand immer als Wort oder Pfeil zusätzlich.
- Trefferflächen ≥ 44 × 44 px, Abstand zwischen Trefferflächen ≥ 8 px.
- Jede Seite/jedes Sheet hat eine Überschrift, auf die beim Öffnen der Fokus geht; Dialoge sind `<dialog>` mit `aria-labelledby`.
- Icons ohne Text bekommen `aria-label`; Schmuck-Icons `aria-hidden="true"`.
- Schriftgröße nie unter 13 px; Zoom bis 200 % ohne abgeschnittene Inhalte. Ausgenommen (Entscheidung Nutzer 08.11.2026): Zahlen in Plaketten mit fester Größe (18–22 px), Beschriftungen in SVG-Diagrammen, Leaflet-Quellenangabe – dort passt 13 px nicht in die feste Fläche.
- Gesten haben immer eine Knopf-Alternative (Griff antippen, ×, Esc).
- Statusänderungen über `aria-live="polite"` ansagen.
- Reihenfolge im DOM = Lesereihenfolge (kein `order`-Trick für Inhalte).

---

## 9. Do's und Don'ts

**Do**
- Tokens benutzen (`var(--wm-…)`), auch für Abstände und Radien.
- Die wichtigste Zahl groß, den Rest ruhig.
- Wiederverwendbare Klassen (`.wm-karte`, `.wm-kopf`, `.wm-marke` …) statt bereichseigener Kopien.
- Texte aus Nutzersicht, aktive Verben, Satzschreibung.
- Neue Ansicht → bei 375/390/1024/1440 px fotografieren und prüfen.

**Don't**
- Keine neuen Hex-Werte, Schatten, Radien oder Schriftgrößen außerhalb der Tokens.
- Keine Großbuchstaben-Etiketten mit Sperrung über Abschnitten.
- Keine Ketten aus mehr als zwei Angaben mit „ · “ – lieber zwei Zeilen.
- Kein dunkler Seitenkopf, keine Verläufe als Schmuck (einziger Verlauf: Wasser).
- Keine Karten in Karten, keine Rahmen **und** Schatten zugleich (außer Warnungen).
- Kein `!important`. Ausnahmen (7.64.0, weil sonst nicht lösbar): `[hidden]`, die Hilfsklassen `.nur-handy`/`.nur-desktop` und `input.hat-x` (Zustand muss jede Komponenten-Regel schlagen), `prefers-reduced-motion` (Animationen überall aus), Leaflet-Überschreibungen (`.wm-pin.is-selected`, Kachelgröße, `pointer-events` beim Auswählen) – Leaflet setzt diese Werte im `style`-Attribut.
- Keine Einblende-Animation beim Laden einzelner Abschnitte außer den Abläufen in Abschnitt 7a, kein Hover-Hüpfen.
- Keine externen Schriften/CSS-Bibliotheken, keine neuen Abhängigkeiten.

---

## 10. Beispiele

**Tokens (Auszug, `public/css/tokens.css`):**
```css
:root {
  --wm-wasser: #E4F2F8; --wm-wasser-2: #F6FAFC;
  --wm-verlauf: linear-gradient(180deg, var(--wm-wasser), var(--wm-wasser-2) 45%);
  --wm-flaeche: #FFFFFF; --wm-flaeche-2: #F1F6F8; --wm-linie: #E3EBEF;
  --wm-tinte: #0E2E42; --wm-matt: #526676; --wm-leise: #7C8F9C;
  --wm-petrol: #0B7C93; --wm-petrol-tief: #075F72; --wm-petrol-hell: #DDF0F5;
  --wm-r-s: 12px; --wm-r-m: 18px; --wm-r-l: 26px; --wm-r-rund: 999px;
  --wm-schatten: 0 1px 2px rgba(14,46,66,.06), 0 4px 14px rgba(14,46,66,.07);
  --wm-t-m: 16px; --wm-t-s: 14px; --wm-t-xs: 13px;
}
```

**Karte mit Wert-Kacheln:**
```html
<div class="wm-kacheln">
  <section class="wm-karte wm-kachel">
    <p class="wm-kachel-t">Pegel Minden</p>
    <p class="wm-kachel-wert">96<small>cm</small></p>
    <span class="wm-marke is-warn">Niedrig</span>
  </section>
  …
</div>
```
```css
.wm-karte { background: var(--wm-flaeche); border-radius: var(--wm-r-m); box-shadow: var(--wm-schatten); padding: var(--wm-3) var(--wm-4); }
.wm-kachel-wert { font-size: 32px; font-weight: 700; font-variant-numeric: tabular-nums; }
.wm-marke { display: inline-block; padding: 3px 10px; border-radius: var(--wm-r-rund); font-size: var(--wm-t-s); font-weight: 700; }
.wm-marke.is-warn { background: var(--wm-warn-hell); color: var(--wm-warn-text); }
```

**Kopf eines Sheets** (ab 7.68.0: Titel links, × rechts, Griff darüber):
```html
<button type="button" class="wm-griff" aria-label="Größe ändern"><span></span></button>
<header class="wm-kopf">
  <div class="wm-kopf-titel-block"><h2 class="wm-kopf-titel">Slip Vössen</h2><p class="wm-kopf-unter">Slipanlage · Weser</p></div>
  <button type="button" class="wm-rund" aria-label="Schließen">…×…</button>
</header>
```

**Falsch → richtig**
| Falsch | Richtig |
|---|---|
| `color: #5b6b77;` | `color: var(--wm-matt);` |
| `<h3 style="text-transform:uppercase">WICHTIG FÜR DEIN BOOT</h3>` | `<h3 class="wm-titel-s">Wichtig für dein Boot</h3>` |
| „Weser · km 204,5 · 22:45 Uhr · veraltet“ | „Weser, km 204,5“ + zweite Zeile „Stand 22:45 Uhr“ |
| grüner Punkt allein | grüner Punkt + „Normal“ |

---

## Umsetzungsstand

- Entschieden: Richtung C mit Disziplin von A (Phase 2).
- Phase 4 (Umsetzung) beginnt erst nach ausdrücklicher Freigabe durch den Nutzer – schrittweise: Tokens + Schrift → gemeinsame Bausteine → Bereiche (Karte/Standort, Pegel, Meldungen, Mehr, Melden/Formulare).
- Bestehende Klassen (`pd-*`, `pa-*`, `bs-*`, `detail-*`) werden schrittweise auf Tokens umgestellt; Geschäftslogik und Backend bleiben unverändert.
- **Schritt 1 erledigt (7.58.0):** `public/css/tokens.css` (alle Tokens + `@font-face`), Schrift in `public/fonts/` (variabel 200–800, latin + latin-ext, Lizenz `OFL.txt`), in allen HTML-Seiten vor den übrigen Stylesheets eingebunden, im Service Worker vorgehalten. Alte Variablen (`--navy`, `--ink`, `--muted`, `--slip`, `--marina`, `--fuel`, `--info-bg`, `--pd-*`, `--zb-*`) verweisen jetzt auf Tokens. Das Teilen-Bild (`pegel-bild.js`) nutzt dieselbe Schrift.
- **Schritt 2 begonnen (7.58.1):** `public/css/bausteine.css` mit allen gemeinsamen Bausteinen (`.wm-kopf`, `.wm-rund`, `.wm-karte`, `.wm-btn`, `.wm-aktionen`, `.wm-zeile`, `.wm-kacheln`, `.wm-marke`, `.wm-punkt`, `.wm-chip`, `.wm-seg`, `.wm-feld`/`.wm-eingabe`, `.wm-hinweis`, `.wm-leer`) eingebunden; noch von keinem Bereich benutzt (Musterblatt dem Nutzer gezeigt, Freigabe ausstehend).
- **Schritt 3 erledigt (7.59.0): Karte und Standort.** Handy: auf der Karte schweben Suche (weiße Pille) und Kategorie-Chips (weiß, aktiv Tinte) über der Karte statt der dunklen Leiste (`body.view-karte`); Leaflet-Knöpfe rücken darunter. Vorschaukarte und Standort-Sheet mit Radius l und `schatten-hoch`; Standort-Kopf Titel 24/700, Art als Text in Petrol-tief (keine Großbuchstaben), Abschnittstitel 16/700, Fakten-Kacheln `flaeche-2`, Route gefüllt Petrol, Gemerkt mit Sonnen-Stern. Standort-Knopf und „In der Nähe“ behalten den Glas-Stil. Meldungen/Mehr behalten die dunkle Leiste bis zu ihrem Schritt.
- **Schritt 4 erledigt (7.60.0): Pegel.** Abschnittstitel (Verlauf, Einordnung, Kennwerte, Gezeiten …) in Satzschreibung `s 700 matt` statt Großbuchstaben; Name 24/700; großer Wert `held` 72/300; Aktionsknöpfe und Karten Radius m mit `schatten`; Umschalter-Spur `linie`; Pegel-Chips und Suche wie auf der Karte (weiß schwebend, aktiv Tinte); kleines Sheet: Name 20/700, „Details“ gefüllt Petrol, Radius m; gemerkter Stern gelb gefüllt mit Kontur.
- **7.60.1:** Pegel-Suche wie auf der Karte (Logo links, Pille, Lupe rechts, Chips 40 px).
- **Schritt 5–7 erledigt (7.61.0): Meldungen, Mehr, Merkliste, Einstellungen, „In der Nähe“, Melden-Menü, Formulare.** Handy: oberste Leiste überall hell (Wassergrund, Logo + Such-Pille wie Karte); alle Seiten- und Sheet-Köpfe mittig mit Titel 24/700 und rundem Knopf links (sichtbar 38 px, Tippfläche 44 px); Gruppen/Karten weiß, Radius m, Schatten; Abschnittstitel in Satzschreibung; Chips überall 40 px, weiß, aktiv Tinte; Umschalter mit Spur `linie`; Symbol-Kacheln `petrol-hell`; „Mein WaterMap“ hell; Meldungskarten ohne Rahmen (Zustandsfarbe oben bleibt); Formularfelder Radius s, Fokus Petrol; Knöpfe Radius m; Foto-Formular auf Tokens. „Lage melden“ unverändert.
- **Regel:** Gleiche Elemente überall gleich – nach jeder Änderung alle Bereiche nebeneinander prüfen (siehe CLAUDE.md).
- **Schritt 8, Teil 1 erledigt (7.62.0): Desktop.** Dunkle Kopfleiste bleibt; darunter Wassergrund, Chips/Filter/„In der Nähe“ als weiße Chips (aktiv Tinte), Suche als Pille mit Lupe rechts, Pegel-Kopf und Seitenleiste „In der Nähe“ nach Tokens.
- **Schritt 8, Teil 2 erledigt (7.63.0):** Textseiten (`page.css`) und Wetter-Fenster nach Tokens; Diagramm als eine Karte, Wind Petrol, Böen `--wm-hoch`.
- **Schritt 8, Teil 3 (7.64.0): Reste aufgeräumt.** 366 Farbwerte mit ΔE ≤ 6 auf Tokens (Skript, nächster Token in Lab), `!important` bis auf die Ausnahmen in Abschnitt 9 entfernt, 67 Schriftgrößen unter 13 px auf `--wm-t-xs`.
- **Farbgruppen (Entscheidung Nutzer 07.11.2026: gruppenweise angleichen):**
  - **Blau erledigt (7.65.0):** Pegel-Blau `#1F6FB2` in Diagrammen, Wind, Pegel-Chip und Teilen-Bild → `--wm-petrol` (Fläche 8 %); Hover-Töne → `--wm-petrol-tief`; Trend „steigt“ → `--wm-petrol-tief`; dunkle Pillen auf Navy → `color-mix(in srgb, var(--wm-flaeche) 10%, var(--wm-navy))`; Ampelgehäuse/Bildbetrachter → `--wm-tinte`; Fokus auf Navy → `--wm-fokus`; Hinweis-Rahmen → `--wm-linie`. Das Teilen-Bild (`pegel-bild.js`) liest die Tokens per `getComputedStyle`. Bleibt: „Lage melden“ (`--sky`, `#163F57`), Logo.
  - **Alle übrigen Farben erledigt (7.66.0):** Rot, Gold, Grün, Grau/Rahmen in CSS und JS (`pegel-karte.js`, `pegel-ansicht.js`, `pegel-fluss.js`, `pegel-fluss-ansicht.js`, `meldungen.js`, `pegel-bild.js`) nach Rolle: Text → `*-text`, Fläche → `*-hell`, Punkt/Zone → Punkt-Farbe, Rahmen → `*-rand`/`rand`/`linie`, Nebentext → `matt`, Pfeile/Referenzlinien → `leise`. SVG-Attribute in `pegel-fluss-ansicht.js` tragen die Token-Werte direkt (kennen keine CSS-Variablen). Ausgenommen bleiben „Lage melden“ (`lage-*`, `lf-*`), Logo (`icons.js`), Kartendaten-Farben (`map.js`, `extras.js`, Maske in `config.js`).

- **Designumbau (ab 7.68.0)** nach `docs/AUFTRAG-designumbau.md` und Prototyp `docs/prototyp-designumbau.dc.html` (Nutzer, 10.11.2026, Prototyp freigegeben): Phase 0 Regeln (7.68.0) · 1 Bausteine (7.69.0) · 2a Pegel auf die Hauptkarte (7.70.0) · 2b Pegel-Ampel ins Pegel-Sheet (7.71.0) · 3 Navigation und alle Bereiche als Sheet (7.72.0) · 4 Animationen (7.73.0) · 5 Aufräumen (7.74.0); nach „übernehmen“ 8.0.0. Nach jeder Phase Freigabe des Nutzers.
  - **Phase 0 erledigt (7.68.0):** Kopf links mit × rechts und Griff, Ortszeile, Aktionsleiste je Art, Chip mit Farbpunkt, Navigation Karte · Meldungen · Melden · Gemerkt · Mehr, Sheet als ein Rahmen, Abschnitt 7a Bewegung (Tokens `--wm-kurz/mittel/lang/feder/sanft` ersetzen die ungenutzten `--wm-kurve`/`--wm-dauer`), Abschnitt 11 Pegel-Ampel. Noch keine sichtbare Änderung.
  - **Phase 1 erledigt (7.69.0):** `css/bausteine.css` neu nach dem Prototyp (Sheet, Griff, Kopf, runder Knopf, Aktionen, Gruppe/Ortszeile, Hinweis, Marke, Chip mit Punkt/Häkchen, Umschalter mit gleitender Markierung, Karte, Fakten, großer Wert, Knopf, Feld, Leer); alte, ungenutzte Klassen entfernt (`wm-grund`, `wm-titel*`, `wm-stapel`, `wm-ico`, `wm-kacheln`/`wm-kachel-*`, `wm-punkt`, `wm-kopf-mitte/links/rechts/art`, `wm-feld-hilfe`). `js/bausteine.js`: `kopf`, `zeile`, `gruppe`, `aktionen`, `marke`, `hinweis`, `chip`, `seg` und **ein Sheet-Rahmen** `sheetOeffnen` (Handy von unten mit Griff, Stufen groß/klein, Wischen mit Einrasten wie im Pegel-Sheet; Desktop Panel rechts an der Oberkante der Karte; Stapeln, Esc/×/Wischen schließen das oberste, Fokus zurück an den Auslöser). Stufe „groß“ endet auf dem Handy 120 px unter dem oberen Rand (Suche + 60 px Karte bleiben sichtbar). Fakten-Kacheln wie im Prototyp weiß mit Schatten (statt `flaeche-2`). `fenster()` (Wetter, Pegel-, Fluss-, Alarm-Fenster), das Standort-Sheet (`#detail`/`mountDetail`) und das Pegel-Sheet laufen **noch nicht** über den Rahmen: Die Umstellung ändert ihr Aussehen (Kopf links mit ×, Griff, Wassergrund) und wäre damit eine sichtbare Änderung, die Phase 1 nicht haben darf; außerdem ist `fenster()` ein modaler `<dialog>` (oberste Ebene, Fokus gefangen), der Rahmen dagegen nicht modal, damit die Karte bedienbar bleibt. Pegel-Sheet → Phase 2a (Auftrag 2a.4), `fenster()`/`pegelFenster`/`flussFenster` und Standort-Sheet → Phase 3 (Auftrag 3.6). Test `tests/ui_bausteine.py`. Noch keine sichtbare Änderung.

## 11. Pegel-Ampel

Neu (Nutzer, 10.11.2026, Prototyp freigegeben). Die Pegel-Ampel ist **Teil des Pegel-Sheets** (Phase 2b), keine eigene Seite mehr:
- Abschnitt „Passt mein Boot?“ direkt unter der Aktionsleiste. Ohne Mindestpegel: Ortszeile „Passt mein Boot? · Mindestpegel festlegen ›“, ein Tipp öffnet im selben Sheet ein kleines Formular (Mindestpegel in cm, −/+ in 5-cm-Schritten, Bootstyp aus den Einstellungen vorbelegt).
- Mit Mindestpegel: Hinweiszeile (`wm-hinweis`) im Zustand der Ampel, immer mit Wort und Abstand („Passt – 42 cm über deinem Mindestpegel“, „Knapp – …“, „Zu niedrig – …“), Farben aus den Zustands-Tokens gut/warn/stop; bei Vorhersage eine kurze Zeile für die nächsten Tage; „Ändern“ als leiser Knopf.
- Mindestpegel je Pegel (`watermap.mindestpegel`); die Ampel erscheint auch in „Gemerkt“ (Marke rechts) und im Pegel-Kasten des Slipanlagen-Sheets.
- `pegel-ampel.html` bleibt nur als Einstiegsseite für Suchmaschinen im Seitenstil (`page.css`, Wassergrund, weiße Karte, kein Navy-Kopf).

## Entscheidungen des Nutzers (Ausnahmen)

- **„Lage melden“ bleibt wie bisher** (Entscheidung nach dem Musterblatt zu Schritt 2): die dunkle Karte „Lage vor Ort melden“ im Melden-Fenster und das Formular „Lage melden“ mit den Schnellknöpfen (Alles frei, Parkplatz voll, Warteschlange, …) werden **nicht** auf die Bausteine umgestellt. Sie übernehmen nur Schrift und Farb-Tokens aus Schritt 1. Änderungen daran nur auf ausdrücklichen Wunsch.

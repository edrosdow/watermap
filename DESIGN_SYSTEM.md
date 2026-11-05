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

**Ausrichtung:** Kopf von Sheets/Seiten/Dialogen **mittig** (Titel, Unterzeile), Inhalt **linksbündig**. Große Einzelwerte mittig.

**Sheet (Handy):** zwei Stufen – *klein* (Inhalt bis ~60 %) und *groß* (oben bleibt Suche + 60 px Karte sichtbar). Folgt dem Finger, rastet ohne Sprung ein (siehe `pegel-dashboard.js`, `wischen.js`).

---

## 5. Komponentenstandards

| Komponente | Standard |
|---|---|
| **Kopf** (Sheet, Seite, Dialog) | Raster `38px 1fr 38px`: links runder weißer Knopf (Schließen ×, Zurück ‹), Mitte Titel `xl` + Unterzeile `s matt`, rechts optional eine Aktion. Grund deckend `--wm-wasser`, damit beim Scrollen nichts durchscheint. |
| **Aktionsleiste** | 3 gleich breite Knöpfe, Icon über Text, Höhe 62 px, Radius m. Primär (Route) gefüllt Petrol, sonst weiß. Merken: Stern mit Sonne-Füllung, wenn gemerkt. |
| **Knopf** | Primär: Petrol, Text weiß, Höhe 48. Sekundär: weiß + schatten. Leise: Text Petrol ohne Fläche. Beschriftung = Handlung („Lage melden“, nicht „OK“). Kein „→“ im Text. |
| **Karte / Gruppe** | weiß, Radius m, schatten, kein Rahmen. Titel `l` oder `s 700`. |
| **Listenzeile** | Höhe ≥ 56, Icon-Kachel 40 × 40 (`petrol-hell` / `petrol-tief`, Radius s), Titel `m 700`, Unterzeile `s matt`, Pfeil `leise`. Trennlinie `--wm-linie` zwischen Zeilen. |
| **Wert-Kachel** | Beschriftung `s matt` mit Icon, Wert `xxl` tabular, darunter eine Zustandsmarke. Zwei Kacheln nebeneinander. |
| **Zustandsmarke** | Pille, Radius rund, `s 700`, Grund `*-hell`, Text `*-text`. Immer mit Wort („Niedrig“), nie nur Farbe. |
| **Chip** (Filter) | Höhe 36, Radius rund, weiß + schatten, `s 700`. Aktiv: `--wm-tinte` gefüllt, Text weiß, Haken-Icon. |
| **Segment-Umschalter** | Spur `flaeche-2`, Radius s, aktive Option weiß + schatten. |
| **Eingabefeld** | Höhe 48, weiß, Rahmen 1,5 px `--wm-linie`, Radius s, Text `m`. Fokus: Rahmen Petrol + Fokusring. Fehler: Rahmen `--wm-stop`, Text darunter `s stop-text`. Beschriftung immer sichtbar über dem Feld. |
| **Hinweis / Warnung** | Karte mit Grund `*-hell`, Rahmen 1,5 px in Punktfarbe, Icon links. Amtliche Warnungen zusätzlich linker Streifen 4 px. |
| **Navigation unten** (Handy) | schwebende Pille, 5 Ziele, aktives Ziel `petrol-hell` / `petrol`. Melden mittig als runder Petrol-Knopf. |
| **Kopfleiste** (Desktop ≥ 768) | `--wm-navy` mit Logo, Suche, Navigation – einzige dunkle Fläche. |
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

**Bewegung:** Sheets/Dialoge 260–280 ms `cubic-bezier(.2,.8,.2,1)`, Inhalt einblenden 220 ms, Ausblenden 260 ms. Nur `transform` und `opacity` animieren. `prefers-reduced-motion: reduce` → keine Animation.

---

## 8. Accessibility-Regeln

- Kontrast: Text ≥ 4,5 : 1, große Zahlen/Icons/Bedienränder ≥ 3 : 1 (Werte siehe Abschnitt 2).
- Information nie nur über Farbe: Zustand immer als Wort oder Pfeil zusätzlich.
- Trefferflächen ≥ 44 × 44 px, Abstand zwischen Trefferflächen ≥ 8 px.
- Jede Seite/jedes Sheet hat eine Überschrift, auf die beim Öffnen der Fokus geht; Dialoge sind `<dialog>` mit `aria-labelledby`.
- Icons ohne Text bekommen `aria-label`; Schmuck-Icons `aria-hidden="true"`.
- Schriftgröße nie unter 13 px; Zoom bis 200 % ohne abgeschnittene Inhalte.
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
- Kein `!important` (Ausnahme: `[hidden]`).
- Keine Einblende-Animation beim Laden einzelner Abschnitte, kein Hover-Hüpfen.
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

**Kopf eines Sheets:**
```html
<header class="wm-kopf">
  <button class="wm-rund" aria-label="Schließen">…×…</button>
  <div><p class="wm-kopf-art">Slipanlage</p><h2 class="wm-kopf-titel">Yachthafen Minden</h2><p class="wm-kopf-unter">Weser, km 204,5</p></div>
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
- Nächste Schritte: Meldungen, Mehr, Melden-Menü/Formulare (ohne „Lage melden“).

## Entscheidungen des Nutzers (Ausnahmen)

- **„Lage melden“ bleibt wie bisher** (Entscheidung nach dem Musterblatt zu Schritt 2): die dunkle Karte „Lage vor Ort melden“ im Melden-Fenster und das Formular „Lage melden“ mit den Schnellknöpfen (Alles frei, Parkplatz voll, Warteschlange, …) werden **nicht** auf die Bausteine umgestellt. Sie übernehmen nur Schrift und Farb-Tokens aus Schritt 1. Änderungen daran nur auf ausdrücklichen Wunsch.

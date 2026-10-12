# MathPad II

CAS-Grafikrechner im Stil des Casio ClassPad II (fx-CP400) als **eine einzige HTML-Datei**.
`dist/MathPad-II.html` doppelklicken und der Rechner läuft im Browser (Safari, Chrome, Firefox),
auch offline und auf Apple-Silicon-Macs, wo der offizielle ClassPad Manager nicht läuft.

Kein Casio-Code, keine Casio-ROM, kein Casio-Logo. Die Bedienung ist dem ClassPad II nachgebaut,
gerechnet wird mit eigenem Code plus der eingebetteten Open-Source-CAS-Bibliothek nerdamer.

## Was drin ist

Das App-Menü hat alle 15 Apps des ClassPad II in der Original-Reihenfolge.

| App | Funktionen |
| --- | --- |
| **Main** | Natural Display (Brüche, Wurzeln, Potenzen, ∫, d/dx, lim, Σ, Π, Matrizen, \|x\|, log_b) mit Cursor in den Vorlagen. Exakte Ergebnisse (½, √2, π), Standard/Decimal, Real/Cplx, Rad/Deg/Gra. Befehle: `solve` (inkl. Systeme, Ungleichungen, allgemeine Trig-Lösungen mit `constn(1)`), `diff`, `∫` (unbestimmt/bestimmt/uneigentlich), `lim`, `Σ`, `Π`, `factor`, `expand`, `simplify`, `partfrac`, `det`, `trn`, Matrix-Inverse, Listen, `nCr`, `nPr`, `gcd`, `lcm`, `mod`, `fMax`, `fMin`, `Define f(x)=…`, `⇒` Variablen, `ans`. Verteilungen: `normPDf`, `normCDf`, `invNormCDf`, `binomialPDf/CDf`, `poissonPDf/CDf`, `geoPDf/CDf`, `tPDf/CDf`, `chiPDf/CDf`, `fPDf/CDf` und die Inversen `invTCDf`, `invChiCDf`, `invFCDf` (rechtes Ende wie am ClassPad), `invBinomialCDf`, `invPoissonCDf`, `invGeoCDf`. Alte Zeilen antippen und neu rechnen, Ergebnis antippen und übernehmen. Action- und Interactive-Menüs, ½⇔0.5-Umschalter |
| **eActivity** | Dokument aus Text- und Rechenzeilen, Beispiel „Kurvendiskussion“, alles neu berechnen |
| **Statistics** | list1–list6, One-/Two-Variable (x̄, σ, s, Quartile, Modus …), Regressionen linear, quadratisch, kubisch, quartisch, logarithmisch, exponentiell (a·e^bx und a·b^x), Potenz. Scatter, xyLine, Histogramm, MedBox. Regressionsformel per Klick nach Graph & Table |
| **Spreadsheet** | Zellen A–Z × 999, Formeln mit `=`, Bereiche `A1:A9`, `sum`, `mean`, `count` und alle CAS-Funktionen, Ausfüllen nach unten mit relativen Bezügen, Ausschneiden/Kopieren/Einfügen |
| **Graph & Table** | 5 Sheets × 20 Funktionen, Typen y=, r= (polar), x=. Pan mit Maus, Zoom mit Trackpad oder Mausrad, Zoom-Menü (Box, In, Out, Auto, Square, Integer, Previous, Quick Initialize/Trig/Standard), View Window, Trace, G-Solve (Root, Max, Min, fMax, fMin, y-Intercept, Intersection, y-Cal, x-Cal, Inflection, ∫dx mit Schattierung), Wertetabelle |
| **Geometry** | Punkt, Strecke, Gerade, Kreis, Polygon, Mittelpunkt, Schnittpunkt; Punkte ziehen, alles hängt live mit. Messwerte: Koordinaten, Länge, Geradengleichung, Steigungswinkel, Kreisgleichung, Fläche, Umfang, Abstand, Winkel aus drei Punkten |
| **Conics** | Vorlagen für Parabel, Kreis, Ellipse, Hyperbel und allgemeine Form; Analyse mit Typ, Mittelpunkt, Brennpunkten, Scheitelpunkten, Exzentrizität, Asymptoten |
| **3D Graph** | z1–z3 als schattierte Flächen, mit der Maus drehen, zoomen, 3D-View-Window |
| **Sequence** | Rekursiv (aₙ₊₁ aus aₙ, bₙ, cₙ, n) und explizit, Wertetabelle und Punktgraph |
| **Financial** | Zinseszins/TVM (n, I%, PV, PMT, FV lösen), einfache Zinsen, Zinsumrechnung, Kosten/Verkauf/Marge, Cashflow (NPV, IRR, PBP, NFV), Tilgungsplan, Tage zählen, Abschreibung |
| **Program** | Editor und Interpreter: `Input`, `Print`, `Locate`, `Message`, `ClrText`, `Local`, `If/Then/Else/IfEnd`, `For…To…Step/Next`, `While/WhileEnd`, `Do/LpWhile`, `Break`, `Skip`, `Return`, `⇒`; Beispiele `quadrat` und `fibo` |
| **E-CON EA-200** | Setup Wizard für Bewegung, Temperatur, Spannung, Licht und Mikrofon, Intervall, Anzahl, Trigger. Ohne angeschlossenen Datenlogger läuft die Messung als physikalisch plausible Simulation mit Live-Graph; Messreihe per Klick nach list1/list2 und in Statistics |
| **NumSolve** | Gleichung mit beliebig vielen Variablen, Unbekannte wählen, Grenzen, Left−Right-Kontrolle |
| **DiffEqGraph** | dy/dx = f(x, y): Richtungsfeld, Lösungskurven (Runge-Kutta 4), Anfangswerte per Klick |
| **System** | Speicherübersicht, Variablen löschen, alles zurücksetzen |

Gerät: Gehäuse im Hochformat mit den Proportionen des fx-CP400 (89 × 206 mm, LCD 320 × 528 Pixel),
Hardware-Tasten inkl. Shift-Ebene, Icon-Leiste (Settings, Menu, Main, Resize, Swap, Rotate, Esc),
Soft-Keyboard (Math1, Math2, Trig, Var, abc), Statusleiste zum Antippen, Aus/An über Shift+Clear.
Rotate schaltet auf ein echtes Querformat-Gerät: breites Gehäuse, Display (528 × 320) links, Tastenfeld
rechts daneben, alle Beschriftungen aufrecht. Auf iPhone und iPad folgt das Gerät automatisch dem Drehen in
der Hand. Alles wird im Browser gespeichert (localStorage).

## Erscheinungsbild

Oben in der Titelleiste: **Hell · Dunkel · Auto** als Segmented Control wie in macOS. Dunkel ist der
Standard; Auto folgt der Systemeinstellung, auch live. Bildschirm, Menüs, Dialoge, Soft-Keyboard,
Tabellen und alle Grafiken wechseln mit (Apple-Systemfarben, SF-Schrift, Glas-Effekte, iOS-Icons im
App-Menü). Das Gehäuse ist Hardware und bleibt gleich. Die Wahl wird gespeichert und schon vor dem
ersten Bild gesetzt, nichts blitzt auf. Daneben: Zoom (−, Fit, +) und die Tastatur-Hilfe als Popover.

## Mac-Tastatur

| Taste | Wirkung |
| --- | --- |
| `Enter` / `⇧ Enter` | EXE / Dezimal (≈) |
| `/` `^` `*` | Bruch, Potenz, Mal. Nach `x^2` oder `1/2` verlässt `+ − = ,` die Vorlage automatisch |
| Pfeiltasten | Cursor, Felder in Vorlagen, frühere Zeilen |
| `⌫` / `⌥ ⌫` | Zeichen / ganze Zeile löschen |
| `Esc`, `Tab` | Esc-Taste, Fenster wechseln |
| `⌘C` / `⌘V` | Eingabe kopieren / Text einfügen |
| `sqrt(`, `pi`, `ans`, `define ` | werden zu √, π, ans, Define |

## Entwicklung

```bash
npm install          # nerdamer-prime 1.5.0
npm run build        # baut dist/MathPad-II.html (eine Datei, alles eingebettet)
npm test             # 106 Rechenkern-Tests in Node
npm run test:e2e     # 77 Browser-Prüfungen mit Playwright (Chromium)
```

Aufbau (`src/`):

- `core.js` Tokenizer und Parser (implizite Multiplikation, ClassPad-Syntax), AST nach nerdamer
- `boxes.js` Box-Modell für Natural Display, Rendering, Zeile → AST
- `display.js` Ergebnis-AST → 2D-Anzeige (Brüche, Wurzeln zusammenfassen, ClassPad-Reihenfolge)
- `numeric.js` Numerik: Kompilieren, Nullstellen, Extrema, Integration, Statistik, Regressionen
- `cas.js` CAS-Befehle über nerdamer mit eigenen Fallbacks (exakte Logarithmen, Trig-Tabellen,
  komplexe Normalform, numerische Lösungen mit Wiedererkennung von ln, e, π, √)
- `editor.js` Natural-Input-Editor mit Cursor-Navigation
- `shell.js` Gerät, Tasten, Menüs, Dialoge, Soft-Keyboard, Speichern, Erscheinungsbild
- `plot.js` gemeinsames Grafikfenster (Raster, Achsen, Pan/Zoom) für die Grafik-Apps
- `app-*.js` die Anwendungen

## Grenzen

- E-CON simuliert die Messung; ein echter EA-200 lässt sich aus dem Browser nicht ansprechen.
- Geometry, Program und Spreadsheet decken die gängigen Funktionen ab, nicht jedes Detail des Originals.
- Die Symbolik ist stark, aber nicht auf ClassPad-Niveau. Wo nerdamer keine exakte Form findet, kommt ein
  Dezimalergebnis, zum Beispiel bei manchen bestimmten Integralen (`∫₀¹ e^(−x²)dx = 0.7468241328`).
- Getestet in Chromium. Safari und Firefox nutzen dieselben Standard-APIs, wurden hier aber nicht automatisiert geprüft.

## Lizenzen

Eigener Code: MIT. Eingebettet: nerdamer-prime 1.5.0 (MIT, © together-science), big-integer (Public Domain),
decimal.js (MIT, © Michael Mclaughlin). ClassPad und Casio sind Marken der CASIO Computer Co., Ltd.;
dieses Projekt steht in keiner Verbindung zu Casio.

# MathPad II

CAS-Grafikrechner im Stil des Casio ClassPad II (fx-CP400) als **eine einzige HTML-Datei**.
`dist/MathPad-II.html` doppelklicken und der Rechner läuft im Browser (Safari, Chrome, Firefox),
auch offline und auf Apple-Silicon-Macs, wo der offizielle ClassPad Manager nicht läuft.

Kein Casio-Code, keine Casio-ROM, kein Casio-Logo. Die Bedienung ist dem ClassPad II nachgebaut,
gerechnet wird mit eigenem Code plus der eingebetteten Open-Source-CAS-Bibliothek nerdamer.

## Was drin ist

| App | Funktionen |
| --- | --- |
| **Main** | Natural Display (Brüche, Wurzeln, Potenzen, ∫, d/dx, lim, Σ, Π, Matrizen, \|x\|, log_b) mit Cursor in den Vorlagen. Exakte Ergebnisse (½, √2, π), Standard/Decimal, Real/Cplx, Rad/Deg/Gra. Befehle: `solve` (inkl. Systeme, Ungleichungen, allgemeine Trig-Lösungen mit `constn(1)`), `diff`, `∫` (unbestimmt/bestimmt/uneigentlich), `lim`, `Σ`, `Π`, `factor`, `expand`, `simplify`, `partfrac`, `det`, `trn`, Matrix-Inverse, Listen, `nCr`, `nPr`, `gcd`, `lcm`, `mod`, `fMax`, `fMin`, `Define f(x)=…`, `⇒` Variablen, `ans`. Alte Zeilen antippen und neu rechnen, Ergebnis antippen und übernehmen. Action- und Interactive-Menüs, ½⇔0.5-Umschalter |
| **Graph & Table** | 5 Sheets × 20 Funktionen, Typen y=, r= (polar), x=. Pan mit Maus, Zoom mit Trackpad oder Mausrad, Zoom-Menü (Box, In, Out, Auto, Square, Integer, Previous, Quick Initialize/Trig/Standard), View Window, Trace, G-Solve (Root, Max, Min, fMax, fMin, y-Intercept, Intersection, y-Cal, x-Cal, Inflection, ∫dx mit Schattierung), Wertetabelle |
| **Statistics** | list1–list6, One-/Two-Variable (x̄, σ, s, Quartile, Modus …), Regressionen linear, quadratisch, kubisch, quartisch, logarithmisch, exponentiell (a·e^bx und a·b^x), Potenz. Scatter, xyLine, Histogramm, MedBox. Regressionsformel per Klick nach Graph & Table |
| **Num Solve** | Gleichung mit beliebig vielen Variablen, Unbekannte wählen, Grenzen, Left−Right-Kontrolle |
| **System** | Speicherübersicht, Variablen löschen, alles zurücksetzen |

Gerät: Hardware-Tasten wie am CP400 (inkl. Shift-Ebene), Icon-Leiste (Settings, Menu, Main, Resize,
Swap, Rotate, Esc), Soft-Keyboard (Math1, Math2, Trig, Var, abc), Statusleiste zum Antippen,
Aus/An über Shift+Clear. Auf Laptop-Bildschirmen startet die App quer (Rotate), damit die Schrift groß ist.
Alles wird im Browser gespeichert (localStorage) und ist nach dem Neuladen wieder da.

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
npm test             # 88 Rechenkern-Tests in Node
npm run test:e2e     # 44 Browser-Prüfungen mit Playwright (Chromium)
```

Aufbau (`src/`):

- `core.js` Tokenizer und Parser (implizite Multiplikation, ClassPad-Syntax), AST nach nerdamer
- `boxes.js` Box-Modell für Natural Display, Rendering, Zeile → AST
- `display.js` Ergebnis-AST → 2D-Anzeige (Brüche, Wurzeln zusammenfassen, ClassPad-Reihenfolge)
- `numeric.js` Numerik: Kompilieren, Nullstellen, Extrema, Integration, Statistik, Regressionen
- `cas.js` CAS-Befehle über nerdamer mit eigenen Fallbacks (exakte Logarithmen, Trig-Tabellen,
  komplexe Normalform, numerische Lösungen mit Wiedererkennung von ln, e, π, √)
- `editor.js` Natural-Input-Editor mit Cursor-Navigation
- `shell.js` Gerät, Tasten, Menüs, Dialoge, Soft-Keyboard, Speichern
- `app-*.js` die Anwendungen

## Grenzen

- Nicht nachgebaut: eActivity, Spreadsheet, Geometry, Conics, 3D Graph, Sequence, Financial, Program, E-CON.
- Die Symbolik ist stark, aber nicht auf ClassPad-Niveau. Wo nerdamer keine exakte Form findet, kommt ein
  Dezimalergebnis, zum Beispiel bei manchen bestimmten Integralen (`∫₀¹ e^(−x²)dx = 0.7468241328`).
- Getestet in Chromium. Safari und Firefox nutzen dieselben Standard-APIs, wurden hier aber nicht automatisiert geprüft.

## Lizenzen

Eigener Code: MIT. Eingebettet: nerdamer-prime 1.5.0 (MIT, © together-science), big-integer (Public Domain),
decimal.js (MIT, © Michael Mclaughlin). ClassPad und Casio sind Marken der CASIO Computer Co., Ltd.;
dieses Projekt steht in keiner Verbindung zu Casio.

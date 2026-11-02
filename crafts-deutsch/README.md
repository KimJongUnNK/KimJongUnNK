# WordCraft + DeckCraft auf Deutsch

Rechtschreibprüfung auf **Deutsch statt US-Englisch**. Basis sind die Open-Source-Apps
[storytold/wordcraft](https://github.com/storytold/wordcraft) und
[storytold/deckcraft](https://github.com/storytold/deckcraft) (MIT / Apache-2.0).

## Download (Windows x64)

| App | Download |
|---|---|
| **WordCraft** (Word-Alternative) | [WordCraft-Deutsch-Windows-x64.zip](https://github.com/KimJongUnNK/KimJongUnNK/raw/claude/magical-cerf-jmx3py/crafts-deutsch/downloads/WordCraft-Deutsch-Windows-x64.zip) |
| **DeckCraft** (PowerPoint-Alternative) | [DeckCraft-Deutsch-Windows-x64.zip](https://github.com/KimJongUnNK/KimJongUnNK/raw/claude/magical-cerf-jmx3py/crafts-deutsch/downloads/DeckCraft-Deutsch-Windows-x64.zip) |

Entpacken, `wordcraft.exe` bzw. `deckcraft.exe` starten. Keine Installation nötig.
Die deutschen Wörterbücher (Deutschland, Österreich, Schweiz) liegen im Ordner `dictionaries`
neben der `.exe` und werden automatisch gefunden. Der Ordner muss neben der `.exe` bleiben.

> Windows SmartScreen meckert beim ersten Start, weil die `.exe` nicht signiert ist:
> **Weitere Informationen → Trotzdem ausführen**.

## Was anders ist

**Vorher:** Für Deutsch gab es in WordCraft nur Silbentrennung und **keine Rechtschreibprüfung**.
Neue Dokumente waren auf Englisch (USA) eingestellt, also wurde jedes deutsche Wort rot
unterstrichen. DeckCraft konnte die deutschen Wörterbücher nicht lesen, weil ihm die
Komposita-Logik fehlte, und hat neuen Text ebenfalls immer als US-Englisch geprüft.

**Jetzt:**

- **Echte deutsche Rechtschreibprüfung** mit Deutsch (Deutschland), Deutsch (Österreich) und
  Deutsch (Schweiz), jeweils mit eigenem Wörterbuch. `Jänner` und `Paradeiser` sind in AT
  richtig. In CH gibt es kein `ß` (`Strasse`, `Grüsse`).
- **Zusammengesetzte Wörter (Komposita)** werden geprüft, wie Hunspell bzw. LibreOffice es
  machen: `Kaffeeclubgründer`, `Donaudampfschifffahrt`, `Veranstaltungstechnik` und
  `Rechtschreibprüfung` gelten als richtig, auch wenn sie so nicht im Wörterbuch stehen.
  `KaffeeClub` und `haustür` werden als Fehler markiert.
- **Die Standardsprache folgt deinem System:** Auf einem österreichischen Windows wird jedes
  neue Dokument automatisch als Deutsch (Österreich) geprüft. Es wird nicht mehr als
  US-Englisch angelegt.
- **WordCraft:** Die Oberfläche ist auf Deutsch, wenn Windows auf Deutsch läuft (sonst unter
  Datei › Optionen umstellbar). Fehlermeldungen kommen auf Deutsch, z. B. „Möglicher
  Rechtschreibfehler“ und „Wiederholtes Wort“. Die Vorschläge kennen Umlaute und ß:
  `Strasse` → `Straße`, `Tuer` → `Tür`, `Kaffeclub` → `Kaffeeclub`.
- `GROSSBUCHSTABEN` mit SS werden als ß erkannt (`STRASSE` = `Straße`).
- `E-Mail` und `Kaffee-Club` werden nicht mehr zerlegt und fälschlich markiert.

Sprache manuell setzen: In WordCraft über **Überprüfen › Sprache** → z. B. *Deutsch (Österreich)*.
Mit *Als Standard festlegen* gilt die Sprache für alle neuen Dokumente. DeckCraft hat eine
englische Oberfläche, dort heißt der Weg **Review › Language**.

## Tests

- WordCraft: 329 Proofing-Tests, 1118 Engine-Tests und 1015 UI-Tests grün, dazu Prüfungen
  gegen die echten LibreOffice-Wörterbücher de_DE/de_AT/de_CH.
- DeckCraft: 516 Engine-Tests und 462 UI-Tests grün, ebenfalls gegen die echten Wörterbücher.
- Ende-zu-Ende-Test mit diesem Satz: *„Im Jänner gründet der Kaffeeclubgründer eine
  Veranstaltungstechnik-Firma. Die Rechtschreiprüfung war war früher auf Englisch, das nervt.
  KaffeeClub ist falsch, Strasse auch.“* Markiert werden genau `Rechtschreiprüfung` →
  Rechtschreibprüfung, `war war` → Wiederholtes Wort, `KaffeeClub` → Kaffeeclub und
  `Strasse` → Straße (de-AT).

## Quellcode

Die Änderungen liegen als Patches gegen den jeweiligen Upstream-Stand bei:

- [`patches/wordcraft-deutsch.patch`](patches/wordcraft-deutsch.patch): neue Komposita-Engine,
  Deutsch-Modul `crates/proof/src/de/`, Standardsprache nach Region
- [`patches/deckcraft-deutsch.patch`](patches/deckcraft-deutsch.patch): Komposita in
  `crates/engine/src/spell.rs`, Systemsprache als Standard

Selbst bauen:

```bash
git clone https://github.com/storytold/wordcraft && cd wordcraft
git am /pfad/zu/wordcraft-deutsch.patch   # deckcraft analog mit deckcraft-deutsch.patch
cargo build --release -p wordcraft
```

## Lizenzen

- WordCraft und DeckCraft: MIT OR Apache-2.0 (siehe `LICENSE-*` im ZIP)
- Deutsche Wörterbücher (igerman98 / frami, Björn Jacke, Franz Michael Baumann): GPLv2 oder
  GPLv3. Sie liegen unverändert als eigene Dateien im Ordner `dictionaries` bei, zusammen mit
  den Lizenztexten. Quelle: <https://github.com/LibreOffice/dictionaries/tree/master/de>

# WordCraft + DeckCraft auf Deutsch, FilmCraft mit Filmora-Import

Rechtschreibprüfung auf **Deutsch** (DE / AT / CH) statt US-Englisch.

## ⬇️ Download

**[→ Alle Downloads (Mac + Windows)](https://github.com/KimJongUnNK/KimJongUnNK/releases/tag/crafts-deutsch)**

## Mac

1. `WordCraft-Deutsch-macOS.zip` laden → doppelklicken
2. `WordCraft.app` in **Programme** ziehen
3. Einmal im Terminal (nicht von Apple signiert):
   ```bash
   xattr -dr com.apple.quarantine /Applications/WordCraft.app
   ```
4. Starten

DeckCraft genauso (`DeckCraft.app`).

## Windows

1. ZIP entpacken
2. `wordcraft.exe` starten → *Weitere Informationen → Trotzdem ausführen*

## Was neu ist

- Deutsche Rechtschreibung mit Komposita (`Kaffeeclubgründer` ✓, `KaffeeClub` ✗)
- Österreich: `Jänner`, `Paradeiser` ✓ · Schweiz: ohne ß
- Sprache kommt automatisch vom System
- Vorschläge mit Umlauten und ß (`Strasse` → `Straße`)

## FilmCraft: Filmora-Projekte öffnen

`FilmCraft.app` installieren wie oben, dann **File › Import** → deine `.wfp` wählen.

- Kommt mit: Clips, Schnitte, Spuren, Speed, Bilder, Titel (als editierbarer Text), Position/Größe/Drehung, Lautstärke, Fades, Übergänge
- Kommt nicht mit (wird beim Import aufgelistet): Filmora-Effekte, Farbkorrektur, Masken, Pan & Zoom, KI-Funktionen
- Videos müssen am gleichen Ort liegen wie in Filmora (sonst *Medien verknüpfen*)

## Quellcode

Patches: [`patches/`](patches) · Basis: [storytold/wordcraft](https://github.com/storytold/wordcraft), [storytold/deckcraft](https://github.com/storytold/deckcraft), [storytold/filmcraft](https://github.com/storytold/filmcraft) (MIT/Apache-2.0) · Wörterbücher: LibreOffice igerman98 (GPL, unverändert beigelegt)

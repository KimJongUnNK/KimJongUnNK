# WordCraft & DeckCraft – German Version · FilmCraft – Filmora Edition (modifiziert)

> [!WARNING]
> **Inoffizielle, modifizierte Versionen.** Das sind **nicht** die Original-Apps von ArtCraft / storytold,
> sondern von KimJongUnNK veränderte Builds (deutsche Rechtschreibung, Filmora-Import).
> Originale: [WordCraft](https://github.com/storytold/wordcraft) · [DeckCraft](https://github.com/storytold/deckcraft) · [FilmCraft](https://github.com/storytold/filmcraft).
> Fehler in diesen Versionen bitte **nicht** beim Original-Team melden.

## ⬇️ Download

**[→ Alle Downloads (Mac + Windows)](https://github.com/KimJongUnNK/KimJongUnNK/releases/tag/crafts-deutsch)**

🔄 **Immer aktuell:** Jede Nacht prüft ein GitHub-Workflow, ob die Originale eine neue Version haben. Wenn ja, werden die Änderungen automatisch darauf übertragen, getestet, für Mac und Windows gebaut und hier ausgetauscht. Passt eine Änderung nicht mehr, repariert eine geplante Claude-Aufgabe sie. Bis dahin bleibt die letzte funktionierende Version zum Download.

## Mac

1. `…-Deutsch-macOS.zip` laden → doppelklicken
2. Die `.app` in **Programme** ziehen
3. Einmal im Terminal (nicht von Apple signiert), Namen anpassen:
   ```bash
   xattr -dr com.apple.quarantine /Applications/WordCraft.app
   ```
4. Starten

## Windows

1. `…-Deutsch-Windows-x64.zip` entpacken
2. `.exe` starten → *Weitere Informationen → Trotzdem ausführen*

## WordCraft & DeckCraft – German Version

- Deutsche Rechtschreibung mit Komposita (`Kaffeeclubgründer` ✓, `KaffeeClub` ✗)
- Österreichisches Wörterbuch dabei: `Jänner`, `Paradeiser` ✓ · Schweiz: ohne ß
- Neue Dokumente sind automatisch Deutsch, wenn dein System auf Deutsch/Österreich/Schweiz steht
- Vorschläge mit Umlauten und ß (`Strasse` → `Straße`)

## FilmCraft – Filmora Edition

**File › Open** → deine `.wfp` wählen (oder ins Fenster ziehen). Sie geht als eigenes Projekt auf, *Speichern* legt ein `.fcproj` an, die `.wfp` bleibt unverändert.

- Kommt mit: Clips, Schnitte, Spuren, Speed, Bilder, Titel (als Text), Position/Größe/Drehung, Lautstärke, Fades, Übergänge
- Kommt nicht mit (wird beim Öffnen aufgelistet): Filmora-Effekte, Farbkorrektur, Masken, Pan & Zoom, KI-Funktionen
- Videos müssen am gleichen Ort liegen wie in Filmora (sonst *Medien verknüpfen*)

## Quellcode

Die Änderungen: [`patches/`](patches) (`wordcraft.patch`, `deckcraft.patch`, `filmcraft.patch`), angewendet auf die jeweils neueste Version der Originale. Der Workflow: [`.github/workflows/crafts-deutsch.yml`](../.github/workflows/crafts-deutsch.yml). Lizenz der Apps: MIT/Apache-2.0. Wörterbücher: LibreOffice igerman98 (GPL, unverändert beigelegt).

---
*Modifizierte Versionen, kein offizielles ArtCraft-/storytold-Produkt.*

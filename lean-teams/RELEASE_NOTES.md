## Scheiss Teams (ehemals Lean Teams)

Schlanker, inoffizieller Desktop-Client für Microsoft Teams: die offizielle Teams-Web-App in der System-WebView, ohne mitgeliefertes Chromium, ohne Hintergrunddienste.

### Neu

- **Update-Button:** Tray bzw. Menüleiste → *Nach Updates suchen*. Gibt es einen neueren Build, wird er geladen und installiert, und die App startet neu. Das funktioniert ab dieser Version, ältere Builds einmal von Hand updaten.
- **Neuer Name und neues Icon:** Die App heißt jetzt „Scheiss Teams“, das Icon zeigt „ST“. Login und Einstellungen bleiben erhalten.
- **Icon in deiner Farbe:** Der Strich unter „ST“ übernimmt `accent_color`. Das gilt für Titelleiste, Taskleiste und Tray (Windows) sowie das Dock (macOS) und greift sofort nach *Design neu laden*.
- **Keine lila Icons mehr:** Das Teams-Logo und App-Icons wie „Aufgaben“ oder „Class Notebook“ werden mit eingefärbt. Fotos, Emojis und bunte Fremd-Icons bleiben, wie sie sind. Abschalten: `"recolor_icons": false`.
- **Meetings beitreten:** Meeting-Links öffnen direkt im App-Fenster. Den macOS-Dialog „Kein Programm zum Öffnen der URL“ und den Windows-Hinweis „Diese Seite versucht, Teams zu öffnen“ gibt es nicht mehr. Auf macOS öffnen `msteams:`-Links aus Safari, Mail oder Kalender direkt in der App.

### Installieren / Updaten

**Windows:** Wer noch „Lean Teams“ installiert hat, deinstalliert die zuerst unter *Einstellungen → Apps*. Dann `LeanTeams-Windows-x64-setup.exe` ausführen. Bei SmartScreen *Weitere Informationen → Trotzdem ausführen* wählen.

**macOS:** Im Terminal ausführen. Der Befehl ersetzt auch eine alte „Lean Teams.app“:

```
curl -fsSL https://raw.githubusercontent.com/KimJongUnNK/KimJongUnNK/claude/nifty-ptolemy-d2ami7/lean-teams/scripts/install-macos.sh | bash
```

**Linux:** `.deb` oder `.AppImage`.

Die Builds sind unsigniert (macOS nur ad-hoc signiert). Jeder Push baut neu und ersetzt dieses Release.

# Lean Teams

Ein schlanker, inoffizieller Desktop-Client für Microsoft Teams. Er ist ein nativer Rust-Host (Tauri 2), der die **offizielle Teams-Web-App** in der WebView des Betriebssystems lädt. Es gibt kein mitgeliefertes Chromium, keine Hintergrunddienste und keine Add-ins.

| | Offizieller Client | Lean Teams |
|---|---|---|
| Programm | MSIX-Paket, Microsoft verlangt 3 GB (Win) bzw. 1,5 GB (macOS) freien Platz | **6,1 MB** Binary (Linux, gemessen), `.deb` 2,5 MB |
| Browser-Engine | WebView2 (Win), auf macOS **mitgebündelt** | System-WebView: WebView2 (Win), WKWebView (macOS), WebKitGTK (Linux) |
| Prozesse beim Start | Host, WebView2-Baum, Outlook-/Meeting-Add-in, Preloading | Host + ein WebView-Baum |
| RAM im Hintergrund | läuft normal weiter | Windows: WebView2 `MemoryUsageTargetLevel = Low`, sobald versteckt oder minimiert |
| Disk-Cache | unbegrenzt (Chromium-Default) | auf 256 MB begrenzt (einstellbar), "Cache leeren" im Tray, Login bleibt |

> **Ehrliche Einordnung:** Der neue Teams-Client nutzt auf Windows schon WebView2. Der RAM-Gewinn auf Windows ist deshalb real, aber moderat, keine Größenordnung. Er kommt durch weniger Prozesse, keine Add-ins und den Low-Memory-Modus im Tray. **Massiv** ist der Gewinn beim Speicherplatz und auf **macOS**, wo der offizielle Client eine eigene WebView2-Runtime mitschleppt (Nutzerberichte: rund 1 GB App-Größe). Messen statt glauben: [`scripts/measure.ps1`](scripts/measure.ps1) (Windows) und [`scripts/measure-macos.sh`](scripts/measure-macos.sh) (macOS).

## Warum kein "echter Klon" per Reverse Engineering?

Weil die eigentliche App gar nicht in der `.exe` steckt. Teams 2.x ist ein dünner Host um die Web-App, die Microsoft von `teams.microsoft.com` ausliefert. Das Binary zu dekompilieren (z. B. mit den Tools aus [`reverse-engineer-anything`](https://github.com/topics/reverse-engineer-anything)) bringt nur den Host zurück, und genau den ersetzt Lean Teams durch einen kleineren. Ein Nachbau der Web-App selbst würde an Microsofts Backend und an deren Lizenzbedingungen scheitern und bei jedem Teams-Update brechen. Lean Teams hängt nur an der öffentlichen Web-App und überlebt deshalb Updates.

## Features

- **Tray-App:** Schließen versteckt nur. Linksklick aufs Tray-Icon zeigt oder versteckt das Fenster. Das Menü hat: Startseite, Neu laden, Cache leeren (Windows), Autostart, Einstellungen, Beenden.
- **Native Notifications:** Die Web-Notification-API (`new Notification`, `ServiceWorkerRegistration.showNotification`, `permissions.query`) wird auf echte OS-Notifications umgeleitet. Klick auf die Notification holt das Fenster nach vorn, und die Taskleiste blinkt, solange das Fenster nicht fokussiert ist.
- **Ungelesen-Badge:** Wird aus dem Seitentitel `(3) Chat | Microsoft Teams` gelesen und landet in Fenstertitel, Tray-Tooltip und Taskleiste (Windows: roter Overlay-Punkt, macOS/Linux: Badge-Zahl).
- **Links:** Links aus Chats öffnen im Standardbrowser. Microsoft-Login-Popups (SSO) bleiben in der App. `mailto:`, `tel:` und `sip:` gehen ans System. `file:`, `javascript:` und unbekannte Protokolle werden blockiert.
- **Single Instance:** Ein zweiter Start fokussiert das laufende Fenster.
- **Autostart:** Startet beim Login versteckt im Tray (`--minimized`).
- **Fensterposition und -größe** werden gespeichert.

## Installieren

Fertige Installer baut die GitHub Action [`.github/workflows/lean-teams.yml`](../.github/workflows/lean-teams.yml) bei jedem Push. Du findest sie unter *Actions → Lean Teams → Artifacts*:

- **Windows:** `Lean Teams_x.y.z_x64-setup.exe` (NSIS, ohne Admin) oder `.msi`. Die WebView2-Runtime ist auf Win 10/11 vorinstalliert, fehlt sie, lädt der Installer sie nach.
- **macOS:** `.dmg` (Universal: Apple Silicon + Intel). Details im Abschnitt [macOS](#macos).
- **Linux:** `.deb` (2,5 MB, nutzt System-WebKitGTK) oder `.AppImage` (78 MB, bringt WebKitGTK mit).

### Selbst bauen

Voraussetzungen: [Rust](https://rustup.rs) und Node 18+. Auf Linux zusätzlich:

```bash
sudo apt install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev libssl-dev
```

Dann:

```bash
cd lean-teams
npx @tauri-apps/cli@2.12.4 build
```

Die Installer landen in `src-tauri/target/release/bundle/`.

## macOS

### Installieren

1. Das Artifact `lean-teams-macOS` aus *Actions → Lean Teams* laden, entpacken und `Lean Teams_x.y.z_universal.dmg` öffnen.
2. `Lean Teams.app` nach *Programme* ziehen.
3. Die App ist nur ad-hoc signiert, nicht von Apple notarisiert. Gatekeeper blockt deshalb den ersten Start. Seit macOS 15 gibt es dafür kein Rechtsklick → Öffnen mehr. Entweder *Systemeinstellungen → Datenschutz & Sicherheit → „Trotzdem öffnen“* klicken, oder einmal im Terminal:

```bash
xattr -dr com.apple.quarantine "/Applications/Lean Teams.app"
```

4. Beim ersten Anruf fragt macOS nach Kamera- und Mikrofonzugriff, einmal erlauben.

### Was auf dem Mac anders ist

- **Engine:** WKWebView, also dieselbe WebKit-Engine wie Safari. Sie ist Teil von macOS. Der offizielle Client bringt dagegen eine eigene Chromium/WebView2-Runtime mit. Hier liegt der größte Speicher-Gewinn des ganzen Projekts.
- **User-Agent:** Lean Teams meldet sich als Safari. WKWebView lässt den `Safari/…`-Teil sonst weg, und Teams behandelt die App dann als unbekannten Browser.
- **Menüleiste:** Monochromes Template-Icon, macOS färbt es automatisch für Hell- und Dunkelmodus.
- **Dock:** Fenster schließen versteckt nur, ein Klick aufs Dock-Icon holt es zurück. Die Ungelesen-Zahl erscheint als rote Badge am Dock-Icon. Mit ⌘Q wird wirklich beendet.
- **Cache leeren** (Menüleiste): Löscht Disk-, Memory-, Fetch- und App-Cache von WebKit. Cookies, Local Storage und IndexedDB bleiben, du bleibst also eingeloggt.
- **Notifications:** Kommen als macOS-Mitteilungen von „Lean Teams“. Ein Klick holt das Fenster nach vorn.
- **Nicht auf dem Mac:** `low_memory_when_hidden`, `disk_cache_mb`, `renderer_process_limit` und `extra_browser_args` sind WebView2-Schalter und werden ignoriert. WKWebView hat dafür keine öffentliche API. macOS komprimiert und lagert den Speicher von Hintergrund-Apps aber ohnehin selbst aus.
- **Calls:** Es gilt der Safari-Support von Teams. Chat, Kanäle, Dateien, Audio und Video laufen. Bei Screen-Sharing und Hintergrundeffekten ist Teams auf Safari eingeschränkter als auf Chromium.

### Messen

```bash
sudo bash lean-teams/scripts/measure-macos.sh
```

- **RAM:** Summiert wird der RSS des ganzen Fußabdrucks. Bei Teams ist das `MSTeams` mit allen WebView-Helper-Prozessen.
- **Lean Teams:** Gezählt wird der Host plus die WebKit-Prozesse, die für ihn arbeiten. Das sind XPC-Dienste von macOS, keine Kindprozesse. Sie werden über den „responsible process“ von launchd zugeordnet, deshalb braucht das Skript `sudo`. Ohne `sudo` zählt es jeden WebKit-Prozess auf dem Mac mit, also auch Safari und Mail, und liefert nur eine Obergrenze.
- **Disk:** Gemessen werden App-Bundle plus Benutzerdaten (`~/Library/Containers`, `Group Containers`, `WebKit`, `Caches`).
- **Fairer Vergleich:** Gleicher Account, gleicher Chat, 2 Minuten warten. Einmal mit sichtbaren Fenstern messen, einmal mit beiden im Hintergrund.

## Einstellungen

Beim ersten Start wird `config.json` angelegt. Tray → *Einstellungen öffnen* öffnet sie. Änderungen greifen nach einem Neustart.

| Pfad | |
|---|---|
| Windows | `%APPDATA%\dev.leanteams.app\config.json` |
| macOS | `~/Library/Application Support/dev.leanteams.app/config.json` |
| Linux | `~/.config/dev.leanteams.app/config.json` |

| Feld | Default | Wirkung |
|---|---|---|
| `url` | `https://teams.microsoft.com/v2/` | Startseite. Für private Konten: `https://teams.live.com/v2/` |
| `user_agent` | `null` | Eigener User-Agent. `null` = Plattform-Default auf Windows, Safari-UA auf macOS, Chrome-UA auf Linux (Teams lehnt die nackten WebKit-UAs ab) |
| `low_memory_when_hidden` | `true` | Windows: WebView2 trimmt RAM, solange das Fenster versteckt oder minimiert ist. Calls und Notifications laufen weiter |
| `disk_cache_mb` | `256` | Windows: Obergrenze des HTTP-Caches (`--disk-cache-size`). `0` = Chromium-Default |
| `renderer_process_limit` | `0` | Windows: Obergrenze für Renderer-Prozesse (`--renderer-process-limit`). `2` spart RAM, kann aber große Meetings ruckeln lassen. `0` = Default |
| `extra_browser_args` | `""` | Windows: zusätzliche Chromium-Switches, wörtlich angehängt |
| `native_notifications` | `true` | Web-Notifications auf OS-Notifications umleiten. `false` = WebView-Verhalten |
| `close_to_tray` | `true` | `false` = Schließen beendet die App |

Kaputtes JSON führt nicht zum Absturz, die App startet dann mit Defaults und schreibt eine Warnung auf stderr.

## Messen (Windows)

Für macOS siehe [macOS → Messen](#messen).

```powershell
powershell -ExecutionPolicy Bypass -File .\lean-teams\scripts\measure.ps1
```

Das Skript summiert RAM über den **ganzen Prozessbaum** (Host + alle `msedgewebview2.exe`), mittelt über mehrere Samples und vergleicht Install- plus User-Data-Ordner beider Apps. Für das Teams-Install-Verzeichnis unter `WindowsApps` als Admin ausführen. Für einen fairen Vergleich: gleicher Account, gleicher Chat, 2 Minuten warten. Einmal mit sichtbaren Fenstern messen, einmal mit beiden im Tray.

## Grenzen

- **Linux:** WebKitGTK ist nicht Chromium. Chat, Kanäle und Dateien funktionieren, Anrufe und Screen-Sharing sind je nach WebKitGTK-Version eingeschränkt. Auf Windows (WebView2 = Chromium) läuft alles inklusive Calls. Auf macOS gilt der Safari-Support von Teams.
- **Keine Outlook-Integration:** Kein Teams-Meeting-Add-in in Outlook und kein Präsenzstatus in Office. Genau das ist ein Teil der Ersparnis.
- **`msteams:`-Deep-Links** (z. B. "In Desktop-App öffnen") öffnen den offiziellen Client, falls installiert. Lean Teams registriert das Protokoll nicht.
- **Inoffiziell:** Lean Teams ist nicht von Microsoft. Es lädt nur die öffentliche Web-App, und Microsoft kann dort jederzeit etwas ändern.

## Sicherheit

Die Teams-Seite ist Remote-Content. Sie bekommt genau **zwei** IPC-Befehle, und zwar nur von den Origins in [`capabilities/teams.json`](src-tauri/capabilities/teams.json) (`teams.microsoft.com`, `teams.cloud.microsoft`, `teams.live.com`):

- `notify(title, body)`: zeigt eine Notification an (Titel auf 120, Text auf 400 Zeichen gekürzt).
- `open_link(url)`: öffnet einen Link im Standardbrowser, nur `http(s)`, `mailto`, `tel` und `sip`. Wird nur vom Linux-Link-Shim genutzt.

Alle anderen Origins, also SSO-Provider und beliebige Seiten nach einem Redirect, werden von der ACL abgewiesen (getestet: `Command notify not allowed by ACL`). Plugin-Befehle (Opener, Autostart, Fensterstatus) sind für die Seite nicht freigegeben.

## Aufbau

```
lean-teams/
├── scripts/measure.ps1          RAM/Disk-Vergleich (Windows)
├── scripts/measure-macos.sh     RAM/Disk-Vergleich (macOS)
├── assets/icon-source.png       Quelle für alle Icons (npx @tauri-apps/cli icon)
└── src-tauri/
    ├── capabilities/teams.json  IPC-Freigaben für die Teams-Origins
    ├── tauri.conf.json          Bundle-Konfiguration
    └── src/
        ├── main.rs              Fenster, Tray, Events, IPC-Befehle
        ├── config.rs            config.json + Chromium-Switches
        ├── policy.rs            Link-Routing + Ungelesen-Parser (pure, getestet)
        ├── notify.rs            OS-Notifications via notify-rust
        ├── webview2.rs          Windows: Memory-Target + Cache leeren (COM)
        ├── macos.rs             macOS: Cache leeren (WKWebsiteDataStore)
        ├── notification-shim.js Web-Notification-API → IPC
        └── link-shim.js         Linux: target=_blank-Links → IPC
```

## Entwicklung

```bash
cd lean-teams/src-tauri
cargo test
```

```bash
cargo clippy --all-targets -- -D warnings
```

```bash
cargo run
```

Die CI führt `fmt`, `clippy` und die Tests aus und baut danach Installer für Windows, macOS und Linux. Auf dem macOS-Runner prüft sie außerdem die Signatur und die Universal-Architektur, startet die App und lässt `measure-macos.sh` gegen die laufende App laufen.

**Warum kein `tauri-plugin-notification`?** Das Plugin injiziert ein eigenes `window.Notification`-Polyfill in jede Seite. Das ruft Plugin-Befehle auf, die die Teams-Origin nicht nutzen darf, und hätte Notifications mit `native_notifications: false` komplett abgeschaltet. Aus demselben Grund ist der Link-Handler des Opener-Plugins (`open_js_links_on_click`) deaktiviert, denn mit ihm wären alle Chat-Links stumm verschluckt worden.

## Lizenz

MIT. "Microsoft Teams" ist eine Marke von Microsoft. Dieses Projekt steht in keiner Verbindung zu Microsoft.

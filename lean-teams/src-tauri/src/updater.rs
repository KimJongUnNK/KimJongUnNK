//! "Update" in the tray / menu bar. Compares the commit this binary was built
//! from with the commit of the rolling GitHub release and installs the newer
//! build. Downloads go through the system's curl (built into Windows 10+,
//! macOS and practically every Linux), so the app carries no HTTP stack.

#[cfg(not(target_os = "macos"))]
use std::path::PathBuf;
use std::{
    path::Path,
    process::{Command, Stdio},
    sync::atomic::{AtomicBool, Ordering},
};
use tauri::{menu::MenuItem, AppHandle, Runtime};

const REPO: &str = "KimJongUnNK/KimJongUnNK";
const TAG: &str = "lean-teams-latest";
/// Commit this binary was built from (`dev` for builds outside git/CI).
pub const BUILD: &str = env!("LEAN_TEAMS_BUILD");

static BUSY: AtomicBool = AtomicBool::new(false);

pub fn short(sha: &str) -> &str {
    sha.get(..7).unwrap_or(sha)
}

/// Label of the tray entry while idle.
pub fn idle_label() -> String {
    format!("Nach Updates suchen (Build {})", short(BUILD))
}

pub const AVAILABLE_LABEL: &str = "Update installieren (neue Version da)";

fn release_api() -> String {
    format!("https://api.github.com/repos/{REPO}/releases/tags/{TAG}")
}

#[cfg_attr(target_os = "macos", allow(dead_code))]
fn asset_url(name: &str) -> String {
    format!("https://github.com/{REPO}/releases/download/{TAG}/{name}")
}

#[cfg_attr(any(windows, target_os = "macos"), allow(dead_code))]
fn release_page() -> String {
    format!("https://github.com/{REPO}/releases/tag/{TAG}")
}

/// A command that never flashes a console window on Windows.
fn quiet(program: &str) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

fn curl() -> Command {
    quiet(if cfg!(windows) { "curl.exe" } else { "curl" })
}

/// The commit the rolling release was built from.
pub fn latest_build() -> Result<String, String> {
    let out = curl()
        .args(["-fsSL", "-m", "20", "-A", "lean-teams-updater"])
        .args(["-H", "Accept: application/vnd.github+json"])
        .arg(release_api())
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("curl nicht gefunden ({e})"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    release_commit(&String::from_utf8_lossy(&out.stdout))
}

fn release_commit(json: &str) -> Result<String, String> {
    let value: serde_json::Value =
        serde_json::from_str(json).map_err(|e| format!("Antwort unlesbar: {e}"))?;
    value["target_commitish"]
        .as_str()
        .map(str::to_string)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Release ohne Commit".to_string())
}

/// Whether `latest` is a different (hence newer) build than `current`.
/// Builds outside CI (`dev`) always count as outdated.
pub fn is_newer(current: &str, latest: &str) -> bool {
    current == "dev" || !current.eq_ignore_ascii_case(latest.trim())
}

#[cfg_attr(target_os = "macos", allow(dead_code))]
fn download(url: &str, dest: &Path) -> Result<(), String> {
    let out = curl()
        .args([
            "-fL",
            "--retry",
            "2",
            "-m",
            "600",
            "-A",
            "lean-teams-updater",
            "-o",
        ])
        .arg(dest)
        .arg(url)
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("curl nicht gefunden ({e})"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// Quotes a string for a single-quoted PowerShell literal.
#[cfg_attr(not(windows), allow(dead_code))]
fn ps_quote(text: &str) -> String {
    format!("'{}'", text.replace('\'', "''"))
}

/// PowerShell that waits for this process to exit, runs the NSIS installer
/// silently and starts the updated app.
#[cfg_attr(not(windows), allow(dead_code))]
fn windows_script(pid: u32, setup: &Path, current_exe: &Path) -> String {
    format!(
        "$ErrorActionPreference = 'Continue'\n\
         try {{ Wait-Process -Id {pid} -Timeout 60 -ErrorAction Stop }} catch {{ }}\n\
         Start-Process -FilePath {setup} -ArgumentList '/S' -Wait\n\
         $exe = @(\n  (Join-Path $env:LOCALAPPDATA 'Scheiss Teams\\lean-teams.exe'),\n  \
         (Join-Path $env:LOCALAPPDATA 'Programs\\Scheiss Teams\\lean-teams.exe'),\n  {current}\n) | \
         Where-Object {{ Test-Path -LiteralPath $_ }} | Select-Object -First 1\n\
         if ($exe) {{ Start-Process -FilePath $exe }}\n",
        setup = ps_quote(&setup.to_string_lossy()),
        current = ps_quote(&current_exe.to_string_lossy()),
    )
}

/// Downloads and installs the latest build. On success the app exits (or is
/// replaced by the install script) and the new version starts.
fn install<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    #[cfg(windows)]
    {
        let setup: PathBuf = std::env::temp_dir().join("ScheissTeams-setup.exe");
        download(&asset_url("LeanTeams-Windows-x64-setup.exe"), &setup)?;
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        quiet("powershell.exe")
            .args([
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-WindowStyle",
                "Hidden",
            ])
            .args([
                "-Command",
                &windows_script(std::process::id(), &setup, &exe),
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Installer nicht startbar ({e})"))?;
        app.exit(0);
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        // The bundled install script downloads the .dmg first, then quits
        // this app, swaps the bundle in /Applications and reopens it.
        use std::io::Write;
        let _ = app;
        let log = std::env::temp_dir().join("scheiss-teams-update.log");
        let log_file = std::fs::File::create(&log).map_err(|e| e.to_string())?;
        let mut child = Command::new("/bin/bash")
            .arg("-s")
            .stdin(Stdio::piped())
            .stdout(log_file.try_clone().map_err(|e| e.to_string())?)
            .stderr(log_file)
            .spawn()
            .map_err(|e| format!("bash nicht startbar ({e})"))?;
        child
            .stdin
            .take()
            .ok_or("kein stdin")?
            .write_all(include_bytes!("../../scripts/install-macos.sh"))
            .map_err(|e| e.to_string())?;
        // Only returns if the script failed before replacing the app.
        let status = child.wait().map_err(|e| e.to_string())?;
        if status.success() {
            Ok(())
        } else {
            Err(format!("Installation abgebrochen, Log: {}", log.display()))
        }
    }
    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        let Some(appimage) = std::env::var_os("APPIMAGE").map(PathBuf::from) else {
            // .deb installs need root: hand over to the browser.
            use tauri_plugin_opener::OpenerExt;
            let _ = app.opener().open_url(release_page(), None::<&str>);
            return Err("Bitte die neue .deb von der Release-Seite installieren".into());
        };
        let next = appimage.with_extension("AppImage.new");
        download(&asset_url("LeanTeams-Linux-amd64.AppImage"), &next)?;
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&next, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| e.to_string())?;
        std::fs::rename(&next, &appimage).map_err(|e| e.to_string())?;
        // Start the new AppImage once this process is gone (single instance).
        quiet("/bin/sh")
            .arg("-c")
            .arg(format!(
                "while kill -0 {} 2>/dev/null; do sleep 0.2; done; exec \"$0\"",
                std::process::id()
            ))
            .arg(&appimage)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| e.to_string())?;
        app.exit(0);
        Ok(())
    }
}

/// Tray click: check, then install if there is a newer build.
pub fn run<R: Runtime>(app: &AppHandle<R>, item: MenuItem<R>) {
    if BUSY.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let _ = item.set_text("Suche nach Updates …");
        let result = latest_build().and_then(|latest| {
            if !is_newer(BUILD, &latest) {
                crate::notify::show(
                    &app,
                    crate::APP_NAME.into(),
                    format!(
                        "Du hast schon die neueste Version (Build {}).",
                        short(BUILD)
                    ),
                );
                return Ok(());
            }
            let _ = item.set_text("Update wird geladen …");
            crate::notify::show(
                &app,
                crate::APP_NAME.into(),
                format!(
                    "Update auf Build {} wird geladen. Die App startet gleich neu.",
                    short(&latest)
                ),
            );
            install(&app)
        });
        if let Err(err) = result {
            crate::notify::show(
                &app,
                format!("{} – Update fehlgeschlagen", crate::APP_NAME),
                err,
            );
        }
        let _ = item.set_text(idle_label());
        BUSY.store(false, Ordering::SeqCst);
    });
}

/// Background check shortly after start: flags the tray entry and notifies
/// once if a newer build is out. Silent when offline.
pub fn check_in_background<R: Runtime>(app: &AppHandle<R>, item: MenuItem<R>) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(20));
        if let Ok(latest) = latest_build() {
            if is_newer(BUILD, &latest) && BUILD != "dev" {
                let _ = item.set_text(AVAILABLE_LABEL);
                crate::notify::show(
                    &app,
                    format!("{} – Update verfügbar", crate::APP_NAME),
                    "Tray bzw. Menüleiste → „Update installieren“.".into(),
                );
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn newer_means_a_different_commit() {
        let a = "f3b674702d88fb17c63c5cc6cacd15c8ed8d6b6e";
        assert!(!is_newer(a, a));
        assert!(!is_newer(a, &a.to_uppercase()));
        assert!(!is_newer(a, &format!("{a}\n")));
        assert!(is_newer(a, "d16e24a25a6f73742dc1955bd5e8c5d4e7722365"));
        assert!(is_newer("dev", a));
    }

    #[test]
    fn release_json_yields_the_commit() {
        let json = r#"{"tag_name":"lean-teams-latest","target_commitish":"abc123","assets":[]}"#;
        assert_eq!(release_commit(json).unwrap(), "abc123");
        assert!(release_commit(r#"{"target_commitish":""}"#).is_err());
        assert!(release_commit("<html>rate limited</html>").is_err());
    }

    #[test]
    fn short_and_labels() {
        assert_eq!(short("f3b674702d88"), "f3b6747");
        assert_eq!(short("dev"), "dev");
        assert!(idle_label().starts_with("Nach Updates suchen (Build "));
    }

    #[test]
    fn windows_script_quotes_paths() {
        let s = windows_script(
            42,
            Path::new(r"C:\Users\O'Neil\AppData\Local\Temp\ScheissTeams-setup.exe"),
            Path::new(r"C:\Users\O'Neil\AppData\Local\Lean Teams\lean-teams.exe"),
        );
        assert!(s.contains("Wait-Process -Id 42"));
        assert!(s.contains(r"'C:\Users\O''Neil\AppData\Local\Temp\ScheissTeams-setup.exe'"));
        assert!(s.contains("-ArgumentList '/S' -Wait"));
        assert!(s.contains(r"'C:\Users\O''Neil\AppData\Local\Lean Teams\lean-teams.exe'"));
    }

    #[test]
    fn urls_point_at_the_rolling_release() {
        assert_eq!(
            asset_url("LeanTeams-Windows-x64-setup.exe"),
            "https://github.com/KimJongUnNK/KimJongUnNK/releases/download/lean-teams-latest/LeanTeams-Windows-x64-setup.exe"
        );
        assert!(release_api().ends_with("/releases/tags/lean-teams-latest"));
        assert!(release_page().ends_with("/releases/tag/lean-teams-latest"));
    }
}

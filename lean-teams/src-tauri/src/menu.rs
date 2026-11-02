//! The overlay menu: a small native window (dist/panel.html) floating over
//! Teams, plus everything that applies its settings to the Teams page live.
//!
//! The menu is its own window with a local page rather than markup inside
//! Teams, so it works no matter what Teams does to its page (CSP, key
//! handling, DOM rewrites), and the Teams origin never gets the commands
//! that write settings: it may only open the menu.

use crate::{config::Config, overlay, AppState, MAIN};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{
    AppHandle, LogicalPosition, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_opener::OpenerExt;

pub const PANEL: &str = "overlay-panel";
pub const SHORTCUT: &str = "CommandOrControl+Shift+L";
const PANEL_WIDTH: f64 = 360.0;
const PANEL_HEIGHT: f64 = 640.0;

fn main_window<R: Runtime>(app: &AppHandle<R>) -> Option<WebviewWindow<R>> {
    app.get_webview_window(MAIN)
}

/// Pushes the current overlay into the Teams page and window without a
/// reload: stylesheet, theme engine, button, zoom, always-on-top.
fn apply_live<R: Runtime>(app: &AppHandle<R>, current: &overlay::Overlay) {
    let Some(window) = main_window(app) else {
        return;
    };
    let _ = window.eval(overlay::apply_script(&current.css));
    let _ = window.eval(overlay::theme_script(&current.settings));
    let _ = window.eval(overlay::button_script(current.settings.panel_button));
    let _ = window.set_zoom(current.settings.zoom());
    let _ = window.set_always_on_top(current.settings.always_on_top);
}

/// Applies everything to a page that just finished loading, including the
/// JS mods (which only ever run once per page).
pub fn apply_on_load<R: Runtime>(window: &WebviewWindow<R>) {
    let current = window.state::<AppState>().overlay.lock().unwrap().clone();
    if !current.css.is_empty() {
        let _ = window.eval(overlay::apply_script(&current.css));
    }
    let _ = window.eval(overlay::theme_script(&current.settings));
    for script in &current.js {
        let _ = window.eval(script);
    }
}

/// Re-reads config.json, custom.css and the mods folder. CSS and theme apply
/// in place; JS mods cannot be unloaded, so a change there reloads Teams.
pub fn reload<R: Runtime>(app: &AppHandle<R>) {
    let Ok(dir) = app.path().app_config_dir() else {
        return;
    };
    let next = overlay::Overlay::load(&dir, Config::load_or_init(&dir).overlay);
    let state = app.state::<AppState>();
    let js_changed = {
        let mut current = state.overlay.lock().unwrap();
        let changed = current.js != next.js;
        *current = next.clone();
        changed
    };
    apply_live(app, &next);
    if js_changed {
        if let Some(window) = main_window(app) {
            let _ = window.reload();
        }
    }
    if let Some(panel) = app.get_webview_window(PANEL) {
        let _ = panel.eval("window.leanPanel && window.leanPanel.load();");
    }
}

pub fn panel_visible<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.get_webview_window(PANEL)
        .and_then(|p| p.is_visible().ok())
        .unwrap_or(false)
}

pub fn hide_panel<R: Runtime>(app: &AppHandle<R>) {
    if let Some(panel) = app.get_webview_window(PANEL) {
        let _ = panel.hide();
    }
}

/// Top-right corner inside the Teams window, in logical pixels.
fn panel_position<R: Runtime>(main: &WebviewWindow<R>) -> Option<(f64, f64)> {
    let scale = main.scale_factor().ok()?;
    let pos = main.outer_position().ok()?.to_logical::<f64>(scale);
    // inner_size: outer_size reports 0 on some X11 setups without a WM.
    let size = main.inner_size().ok()?.to_logical::<f64>(scale);
    let x = pos.x + (size.width - PANEL_WIDTH - 16.0).max(0.0);
    let y = pos.y + 56.0;
    Some((x, y))
}

/// Set while the menu window is being created, so a second press of the
/// shortcut during creation does not try to build it twice.
static CREATING: AtomicBool = AtomicBool::new(false);

/// Why the menu window could not be created, if it failed (for the
/// self-test report; release builds on Windows have no console for stderr).
static LAST_ERROR: Mutex<Option<String>> = Mutex::new(None);

fn show_panel<R: Runtime>(panel: &WebviewWindow<R>, position: Option<(f64, f64)>) {
    // Position after show: some window managers ignore it on hidden windows.
    let _ = panel.show();
    if let Some((x, y)) = position {
        let _ = panel.set_position(LogicalPosition::new(x, y));
    }
    let _ = panel.set_focus();
}

fn create_panel<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<WebviewWindow<R>> {
    let main = main_window(app).ok_or(tauri::Error::WindowNotFound)?;
    let builder = WebviewWindowBuilder::new(app, PANEL, WebviewUrl::App("panel.html".into()));
    // All webviews of one app share a WebView2 environment, which only
    // opens if they use the same browser arguments as the Teams window.
    #[cfg(windows)]
    let builder = builder.additional_browser_args(&app.state::<AppState>().config.browser_args());
    builder
        .title("Lean Teams Overlay")
        .inner_size(PANEL_WIDTH, PANEL_HEIGHT)
        .resizable(false)
        .decorations(false)
        .skip_taskbar(true)
        .visible(false)
        // Owned by the Teams window: stays above it, follows minimize.
        .parent(&main)?
        .build()
}

/// Opens the menu next to Teams, or hides it if it is showing. The window is
/// created once and then only shown/hidden, so it opens instantly.
pub fn toggle_panel<R: Runtime>(app: &AppHandle<R>) {
    if panel_visible(app) {
        hide_panel(app);
        if let Some(main) = main_window(app) {
            let _ = main.set_focus();
        }
        return;
    }
    let Some(main) = main_window(app) else {
        return;
    };
    let position = panel_position(&main);

    if let Some(panel) = app.get_webview_window(PANEL) {
        let _ = panel.eval("window.leanPanel && window.leanPanel.load();");
        show_panel(&panel, position);
        return;
    }
    if CREATING.swap(true, Ordering::AcqRel) {
        return;
    }
    // Building a webview on the main thread deadlocks or fails on Windows
    // (tauri-apps/wry#583), and the shortcut, tray and command handlers all
    // run there. Build on a worker thread instead.
    let app = app.clone();
    std::thread::spawn(move || {
        match create_panel(&app) {
            Ok(panel) => show_panel(&panel, position),
            Err(err) => {
                eprintln!("lean-teams: could not open overlay menu: {err}");
                *LAST_ERROR.lock().unwrap() = Some(err.to_string());
            }
        }
        CREATING.store(false, Ordering::Release);
    });
}

/// The shortcut is only registered while Teams has focus, so it never steals
/// Ctrl+Shift+L from other apps (e.g. Excel's filter toggle). Registered at
/// OS level, so neither Teams nor WebView2 can swallow it.
pub fn set_shortcut_active<R: Runtime>(app: &AppHandle<R>, active: bool) {
    let shortcuts = app.global_shortcut();
    let registered = shortcuts.is_registered(SHORTCUT);
    if active && !registered {
        if let Err(err) = shortcuts.register(SHORTCUT) {
            eprintln!("lean-teams: could not register {SHORTCUT}: {err}");
        }
    } else if !active && registered {
        let _ = shortcuts.unregister(SHORTCUT);
    }
}

pub fn shortcut_plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, _shortcut: &Shortcut, event| {
            if event.state == ShortcutState::Pressed {
                toggle_panel(app);
            }
        })
        .build()
}

/// CI self-test: with `LEAN_TEAMS_SELFTEST=<file>` set, opens the overlay
/// menu a few seconds after start, writes what it rendered as JSON to
/// `<file>` and quits. This is how CI proves the menu works in each
/// platform's webview (WebView2, WKWebView, WebKitGTK).
pub fn maybe_selftest<R: Runtime>(app: &AppHandle<R>) {
    let Ok(out) = std::env::var("LEAN_TEAMS_SELFTEST") else {
        return;
    };
    let app = app.clone();
    std::thread::spawn(move || {
        use std::{thread::sleep, time::Duration};
        sleep(Duration::from_secs(4));
        let opener = app.clone();
        let _ = app.run_on_main_thread(move || toggle_panel(&opener));
        sleep(Duration::from_secs(6));
        let report = "JSON.stringify({rows: document.querySelectorAll('#main .row').length, \
swatches: document.querySelectorAll('.sw').length, status: document.getElementById('status').textContent, \
visible: document.visibilityState})";
        match app.get_webview_window(PANEL) {
            Some(panel) => {
                let (file, done) = (out.clone(), app.clone());
                let _ = panel.eval_with_callback(report, move |json| {
                    let _ = std::fs::write(&file, json);
                    done.exit(0);
                });
            }
            None => {
                let reason = LAST_ERROR.lock().unwrap().clone().unwrap_or_default();
                let report =
                    serde_json::json!({ "error": "menu window missing", "reason": reason });
                let _ = std::fs::write(&out, report.to_string());
                app.exit(1);
            }
        }
        sleep(Duration::from_secs(10));
        let _ = std::fs::write(&out, "{\"error\":\"no answer from menu window\"}");
        app.exit(1);
    });
}

// ---- commands -------------------------------------------------------------

#[derive(serde::Serialize)]
pub struct OverlayStateDto {
    settings: overlay::OverlayConfig,
    custom_css: String,
    mods: Vec<overlay::ModFile>,
}

fn config_dir<R: Runtime>(app: &AppHandle<R>) -> Result<std::path::PathBuf, String> {
    app.path().app_config_dir().map_err(|e| e.to_string())
}

/// Menu window: current settings, custom.css and the mods folder.
#[tauri::command]
pub fn overlay_state<R: Runtime>(app: AppHandle<R>) -> Result<OverlayStateDto, String> {
    let dir = config_dir(&app)?;
    let current = app.state::<AppState>().overlay.lock().unwrap().clone();
    Ok(OverlayStateDto {
        settings: current.settings,
        custom_css: current.user_css,
        mods: overlay::list_mods(&dir),
    })
}

/// Menu window: applies settings and custom.css live; with `persist` also
/// writes them to config.json and custom.css.
#[tauri::command]
pub fn overlay_update<R: Runtime>(
    app: AppHandle<R>,
    settings: overlay::OverlayConfig,
    custom_css: String,
    persist: bool,
) -> Result<(), String> {
    if custom_css.len() > overlay::MAX_CUSTOM_CSS_BYTES {
        return Err("custom.css is larger than 1 MB".into());
    }
    let next = {
        let state = app.state::<AppState>();
        let mut current = state.overlay.lock().unwrap();
        let next = overlay::Overlay::build(settings, custom_css, current.mods.clone());
        *current = next.clone();
        next
    };
    apply_live(&app, &next);
    if persist {
        let dir = config_dir(&app)?;
        overlay::save_user_css(&dir, &next.user_css)?;
        let mut config = Config::load_or_init(&dir);
        config.overlay = next.settings;
        config.save(&dir)?;
    }
    Ok(())
}

/// Menu window: switches an existing mod on or off, then applies.
#[tauri::command]
pub fn overlay_toggle_mod<R: Runtime>(
    app: AppHandle<R>,
    file: String,
    enabled: bool,
) -> Result<(), String> {
    overlay::set_mod_enabled(&config_dir(&app)?, &file, enabled)?;
    reload(&app);
    Ok(())
}

/// Menu window: opens the folder with config.json, custom.css and mods/.
#[tauri::command]
pub fn overlay_open_folder<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let dir = config_dir(&app)?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

/// Menu window: dev tools for the Teams page, to find selectors.
#[tauri::command]
pub fn overlay_devtools<R: Runtime>(app: AppHandle<R>) {
    if let Some(main) = main_window(&app) {
        main.open_devtools();
    }
}

/// Teams page ("LT" button) and menu window: open or close the menu.
#[tauri::command]
pub fn overlay_menu_toggle<R: Runtime>(app: AppHandle<R>) {
    toggle_panel(&app);
}

/// Teams page: whether to show the "LT" button.
#[tauri::command]
pub fn overlay_button_visible<R: Runtime>(app: AppHandle<R>) -> bool {
    app.state::<AppState>()
        .overlay
        .lock()
        .unwrap()
        .settings
        .panel_button
}

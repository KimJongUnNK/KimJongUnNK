//! Applies the look from config.json, custom.css and the mods folder to the
//! Teams page: accent color (theme.js), stylesheet, JS mods, zoom and
//! always-on-top. Everything is file-based; there is no extra window.

use crate::{config::Config, overlay, AppState, MAIN};
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};

/// Applies stylesheet, theme and JS mods to a page that just finished
/// loading. JS mods run once per page.
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

/// Re-reads config.json, custom.css and the mods folder ("Design neu laden"
/// in the tray). CSS and colors apply in place; JS mods cannot be unloaded,
/// so a change there reloads Teams.
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
    let Some(window) = app.get_webview_window(MAIN) else {
        return;
    };
    let _ = window.eval(overlay::apply_script(&next.css));
    let _ = window.eval(overlay::theme_script(&next.settings));
    let _ = window.set_zoom(next.settings.zoom());
    let _ = window.set_always_on_top(next.settings.always_on_top);
    if js_changed {
        let _ = window.reload();
    }
}

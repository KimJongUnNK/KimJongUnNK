//! Lean Teams: a native window around the Microsoft Teams web app.
//!
//! The official desktop client ships its own Chromium-based runtime plus
//! background services. This shell instead reuses the browser engine the OS
//! already has (WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux),
//! so the install is a few megabytes and there is exactly one webview.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_icon;
mod appearance;
mod config;
#[cfg(target_os = "macos")]
mod macos;
mod notify;
mod overlay;
mod policy;
#[cfg(windows)]
mod webview2;

use config::Config;
use policy::Route;
use std::{
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    webview::{NewWindowResponse, PageLoadEvent},
    AppHandle, Manager, Runtime, State, UserAttentionType, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as _};
use tauri_plugin_opener::OpenerExt;

pub(crate) const MAIN: &str = "main";
pub(crate) const TRAY: &str = "tray";
pub(crate) const APP_NAME: &str = "Scheiss Teams";
const NOTIFICATION_SHIM: &str = include_str!("notification-shim.js");
const MINIMIZED_ARG: &str = "--minimized";

pub(crate) struct AppState {
    pub(crate) config: Config,
    unread: Mutex<u32>,
    /// Overlay settings, stylesheet and JS mods; replaced live by the
    /// overlay menu and by "Overlay neu laden".
    pub(crate) overlay: Mutex<overlay::Overlay>,
}

fn truncate(text: &str, max_chars: usize) -> String {
    match text.char_indices().nth(max_chars) {
        Some((idx, _)) => format!("{}…", &text[..idx]),
        None => text.to_string(),
    }
}

/// Called by the injected notification shim. Only reachable from the Teams
/// origins listed in `capabilities/teams.json`.
#[tauri::command]
fn notify<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    state: State<'_, AppState>,
    title: String,
    body: String,
) {
    if !state.config.native_notifications {
        return;
    }
    let title = truncate(title.trim(), 120);
    let title = if title.is_empty() {
        APP_NAME.to_string()
    } else {
        title
    };
    notify::show(&app, title, truncate(body.trim(), 400));
    if !window.is_focused().unwrap_or(false) {
        let _ = window.request_user_attention(Some(UserAttentionType::Informational));
    }
}

/// Called by the Linux link shim for `target=_blank` links.
#[tauri::command]
fn open_link<R: Runtime>(app: AppHandle<R>, url: String) {
    let Ok(url) = url::Url::parse(&url) else {
        return;
    };
    match policy::route_link(&url) {
        Route::External => open_external(&app, &url),
        Route::Redirect(target) => {
            open_in_main(&app, target);
        }
        Route::InApp | Route::Block => {}
    }
}

/// Last deep-link redirect, so a link that keeps bouncing between the
/// launcher and `msteams:` is followed once and then left to the launcher's
/// own buttons instead of looping.
static LAST_REDIRECT: Mutex<Option<(String, Instant)>> = Mutex::new(None);
const REDIRECT_LOOP_WINDOW: Duration = Duration::from_secs(15);

/// A Teams link opened from outside the app before the window existed.
static PENDING_LINK: Mutex<Option<url::Url>> = Mutex::new(None);

/// Loads a Teams deep link (meeting join, chat link, `msteams:` hand-off)
/// in the main window and brings it to the front. Returns false when the
/// same link was just followed, i.e. it is looping.
fn open_in_main<R: Runtime>(app: &AppHandle<R>, target: url::Url) -> bool {
    {
        let mut last = LAST_REDIRECT.lock().unwrap();
        if let Some((prev, at)) = last.as_ref() {
            if prev == target.as_str() && at.elapsed() < REDIRECT_LOOP_WINDOW {
                return false;
            }
        }
        *last = Some((target.to_string(), Instant::now()));
    }
    let Some(window) = app.get_webview_window(MAIN) else {
        *PENDING_LINK.lock().unwrap() = Some(target);
        return true;
    };
    show_main(app);
    // Navigation callbacks run inside the webview's policy decision; start
    // the new load after it returns.
    std::thread::spawn(move || {
        if let Err(err) = window.navigate(target) {
            eprintln!("lean-teams: could not open deep link: {err}");
        }
    });
    true
}

fn set_low_memory<R: Runtime>(window: &WebviewWindow<R>, low: bool) {
    #[cfg(windows)]
    {
        let state = window.state::<AppState>();
        if state.config.low_memory_when_hidden {
            webview2::set_low_memory(window.as_ref(), low);
        }
    }
    #[cfg(not(windows))]
    let _ = (window, low);
}

pub(crate) fn show_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(MAIN) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        set_low_memory(&window, false);
    }
}

fn hide_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(MAIN) {
        let _ = window.hide();
        set_low_memory(&window, true);
    }
}

fn toggle_main<R: Runtime>(app: &AppHandle<R>) {
    match app.get_webview_window(MAIN) {
        Some(w) if w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false) => {
            hide_main(app)
        }
        _ => show_main(app),
    }
}

fn open_external<R: Runtime>(app: &AppHandle<R>, url: &url::Url) {
    if let Err(err) = app.opener().open_url(url.as_str(), None::<&str>) {
        eprintln!("lean-teams: could not open {url}: {err}");
    }
}

/// Small red dot used as the Windows taskbar overlay when there are unread items.
#[cfg(windows)]
fn unread_dot() -> tauri::image::Image<'static> {
    const SIZE: u32 = 16;
    let mut rgba = Vec::with_capacity((SIZE * SIZE * 4) as usize);
    let center = (SIZE as f32 - 1.0) / 2.0;
    for y in 0..SIZE {
        for x in 0..SIZE {
            let d = ((x as f32 - center).powi(2) + (y as f32 - center).powi(2)).sqrt();
            let alpha = (center + 0.5 - d).clamp(0.0, 1.0);
            rgba.extend_from_slice(&[0xE0, 0x24, 0x24, (alpha * 255.0) as u8]);
        }
    }
    tauri::image::Image::new_owned(rgba, SIZE, SIZE)
}

fn update_unread<R: Runtime>(window: &WebviewWindow<R>, page_title: &str) {
    let count = policy::unread_from_title(page_title);
    let state = window.state::<AppState>();
    {
        let mut unread = state.unread.lock().unwrap();
        if *unread == count {
            return;
        }
        *unread = count;
    }

    let label = if count > 0 {
        format!("({count}) {APP_NAME}")
    } else {
        APP_NAME.to_string()
    };
    let _ = window.set_title(&label);
    if let Some(tray) = window.app_handle().tray_by_id(TRAY) {
        let tooltip = if count > 0 {
            format!("{APP_NAME} – {count} ungelesen")
        } else {
            APP_NAME.to_string()
        };
        let _ = tray.set_tooltip(Some(tooltip));
    }

    #[cfg(windows)]
    let _ = window.set_overlay_icon((count > 0).then(unread_dot));
    #[cfg(not(windows))]
    let _ = window.set_badge_count((count > 0).then_some(i64::from(count)));
}

fn build_main_window<R: Runtime>(app: &AppHandle<R>, start_hidden: bool) -> tauri::Result<()> {
    let config = app.state::<AppState>().config.clone();
    let overlay::Overlay {
        settings: overlay_settings,
        css: overlay_css,
        ..
    } = app.state::<AppState>().overlay.lock().unwrap().clone();

    let nav_app = app.clone();
    let popup_app = app.clone();
    let mut builder =
        WebviewWindowBuilder::new(app, MAIN, WebviewUrl::External(config.start_url()))
            .title(APP_NAME)
            .inner_size(1280.0, 820.0)
            .min_inner_size(480.0, 400.0)
            .visible(!start_hidden)
            .on_navigation(move |url| match policy::route_navigation(url) {
                Route::InApp => true,
                Route::External => {
                    open_external(&nav_app, url);
                    false
                }
                // If the link is looping, let a web page through so the
                // launcher can show its own "Join on the web" button.
                Route::Redirect(target) => {
                    !open_in_main(&nav_app, target) && url.scheme() != "msteams"
                }
                Route::Block => false,
            })
            // Allowed popups are bare webviews without these handlers, so
            // meeting links must never end up in one: there the launcher's
            // `msteams:` hand-off would reach the OS.
            .on_new_window(move |url, _features| match policy::route_new_window(&url) {
                Route::InApp => NewWindowResponse::Allow,
                Route::Redirect(target) => {
                    open_in_main(&popup_app, target);
                    NewWindowResponse::Deny
                }
                Route::External => {
                    open_external(&popup_app, &url);
                    NewWindowResponse::Deny
                }
                Route::Block => NewWindowResponse::Deny,
            })
            .on_document_title_changed(|window, title| update_unread(&window, &title))
            // The initialization scripts carry the overlay from startup;
            // re-apply after each load so live changes survive navigation.
            .on_page_load(|window, payload| {
                if payload.event() == PageLoadEvent::Finished {
                    appearance::apply_on_load(&window);
                }
            })
            .zoom_hotkeys_enabled(true)
            .always_on_top(overlay_settings.always_on_top);

    if let Some(ua) = config.effective_user_agent() {
        builder = builder.user_agent(&ua);
    }
    if config.native_notifications {
        builder = builder.initialization_script(NOTIFICATION_SHIM);
    }
    if !overlay_css.is_empty() {
        builder = builder.initialization_script(overlay::apply_script(&overlay_css));
    }
    // Theme engine with the startup accent, so Teams never flashes purple.
    builder = builder.initialization_script(format!(
        "{}\n{}",
        include_str!("theme.js"),
        overlay::theme_script(&overlay_settings)
    ));
    #[cfg(target_os = "linux")]
    {
        builder = builder.initialization_script(include_str!("link-shim.js"));
    }
    #[cfg(windows)]
    {
        builder = builder.additional_browser_args(&config.browser_args());
    }

    let window = builder.build()?;
    #[cfg(windows)]
    {
        let link_app = app.clone();
        webview2::intercept_teams_links(window.as_ref(), move |target| {
            open_in_main(&link_app, target);
        });
    }
    let _ = window.set_zoom(overlay_settings.zoom());
    if start_hidden {
        set_low_memory(&window, true);
    }
    Ok(())
}

fn build_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let autostart_enabled = app.autolaunch().is_enabled().unwrap_or(false);

    let show = MenuItem::with_id(app, "show", "Anzeigen / Verstecken", true, None::<&str>)?;
    let home = MenuItem::with_id(app, "home", "Startseite", true, None::<&str>)?;
    let reload = MenuItem::with_id(app, "reload", "Neu laden", true, None::<&str>)?;
    let autostart = CheckMenuItem::with_id(
        app,
        "autostart",
        "Beim Login starten",
        true,
        autostart_enabled,
        None::<&str>,
    )?;
    let settings = MenuItem::with_id(
        app,
        "settings",
        "Einstellungsordner öffnen",
        true,
        None::<&str>,
    )?;
    let on_top = CheckMenuItem::with_id(
        app,
        "on-top",
        "Immer im Vordergrund",
        true,
        app.state::<AppState>()
            .overlay
            .lock()
            .unwrap()
            .settings
            .always_on_top,
        None::<&str>,
    )?;
    let reload_look =
        MenuItem::with_id(app, "reload-look", "Design neu laden", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Beenden", true, None::<&str>)?;
    let sep = || PredefinedMenuItem::separator(app);

    let menu = Menu::with_items(app, &[&show, &home, &reload, &sep()?])?;
    #[cfg(any(windows, target_os = "macos"))]
    {
        let clear = MenuItem::with_id(
            app,
            "clear-cache",
            "Cache leeren (bleibt eingeloggt)",
            true,
            None::<&str>,
        )?;
        menu.append(&clear)?;
    }
    menu.append_items(&[
        &on_top,
        &reload_look,
        &sep()?,
        &autostart,
        &settings,
        &sep()?,
        &quit,
    ])?;

    let mut tray = TrayIconBuilder::with_id(TRAY)
        .tooltip(APP_NAME)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "show" => toggle_main(app),
            "home" => {
                if let Some(w) = app.get_webview_window(MAIN) {
                    let url = app.state::<AppState>().config.start_url();
                    let _ = w.navigate(url);
                    show_main(app);
                }
            }
            "reload" => {
                if let Some(w) = app.get_webview_window(MAIN) {
                    let _ = w.reload();
                }
            }
            #[cfg(any(windows, target_os = "macos"))]
            "clear-cache" => {
                if let Some(w) = app.get_webview_window(MAIN) {
                    #[cfg(windows)]
                    webview2::clear_cache(w.as_ref());
                    #[cfg(target_os = "macos")]
                    macos::clear_cache(w.as_ref());
                }
            }
            "autostart" => {
                let manager = app.autolaunch();
                let enable = !manager.is_enabled().unwrap_or(false);
                let result = if enable {
                    manager.enable()
                } else {
                    manager.disable()
                };
                if let Err(err) = result {
                    eprintln!("lean-teams: autostart toggle failed: {err}");
                }
                let _ = autostart.set_checked(manager.is_enabled().unwrap_or(false));
            }
            "on-top" => {
                if let Some(w) = app.get_webview_window(MAIN) {
                    let on = !w.is_always_on_top().unwrap_or(false);
                    let _ = w.set_always_on_top(on);
                    let _ = on_top.set_checked(on);
                }
            }
            "reload-look" => appearance::reload(app),
            // The folder holds config.json, custom.css and mods/.
            "settings" => {
                if let Ok(dir) = app.path().app_config_dir() {
                    let _ = std::fs::create_dir_all(&dir);
                    let _ = app.opener().open_path(dir.to_string_lossy(), None::<&str>);
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main(tray.app_handle());
            }
        });
    // The menu bar expects a monochrome template image that macOS tints for
    // light/dark mode; the colored app icon looks out of place there.
    #[cfg(target_os = "macos")]
    {
        tray = tray
            .icon(tauri::image::Image::from_bytes(include_bytes!(
                "../icons/tray-template.png"
            ))?)
            .icon_as_template(true);
    }
    #[cfg(not(target_os = "macos"))]
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

fn main() {
    let start_hidden = std::env::args().any(|arg| arg == MINIMIZED_ARG);

    tauri::Builder::default()
        // Must be registered first so a second launch is caught before
        // anything else initialises.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main(app)
        }))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        & !tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .build(),
        )
        // The opener plugin's own `<a target=_blank>` click handler would call
        // a command the Teams origin is not allowed to use; links are routed
        // by on_new_window and the Linux link shim instead.
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![MINIMIZED_ARG]),
        ))
        .invoke_handler(tauri::generate_handler![notify, open_link,])
        .setup(move |app| {
            let dir = app.path().app_config_dir()?;
            let config = Config::load_or_init(&dir);
            app.manage(AppState {
                overlay: Mutex::new(overlay::Overlay::load(&dir, config.overlay.clone())),
                config,
                unread: Mutex::new(0),
            });
            build_tray(app.handle())?;
            let pending = PENDING_LINK.lock().unwrap().take();
            build_main_window(app.handle(), start_hidden && pending.is_none())?;
            let accent = app.state::<AppState>().config.overlay.accent();
            app_icon::apply(app.handle(), accent.as_deref());
            if let Some(target) = pending {
                *LAST_REDIRECT.lock().unwrap() = None;
                open_in_main(app.handle(), target);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != MAIN {
                return;
            }
            let Some(webview) = window.app_handle().get_webview_window(MAIN) else {
                return;
            };
            match event {
                WindowEvent::CloseRequested { api, .. }
                    if window.state::<AppState>().config.close_to_tray =>
                {
                    api.prevent_close();
                    hide_main(window.app_handle());
                }
                WindowEvent::Focused(focused) => {
                    if *focused {
                        set_low_memory(&webview, false);
                    }
                    let blur = window
                        .state::<AppState>()
                        .overlay
                        .lock()
                        .unwrap()
                        .settings
                        .privacy_blur;
                    if blur {
                        let _ = webview.eval(overlay::blur_script(!*focused));
                    }
                }
                WindowEvent::Resized(_) if window.is_minimized().unwrap_or(false) => {
                    set_low_memory(&webview, true)
                }
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to start Scheiss Teams")
        .run(|app, event| match event {
            // Keep running in the tray when the last window is hidden.
            tauri::RunEvent::ExitRequested {
                code: None, api, ..
            } if app.state::<AppState>().config.close_to_tray => api.prevent_exit(),
            // Clicking the Dock icon brings back a window closed to the tray.
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => show_main(app),
            // `msteams:` links from Safari, Mail, Calendar, … (Lean Teams is
            // registered for the scheme in Info.plist).
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Opened { urls } => {
                for url in urls {
                    if let Some(target) = policy::teams_web_link(&url) {
                        *LAST_REDIRECT.lock().unwrap() = None;
                        open_in_main(app, target);
                    }
                }
            }
            _ => {}
        });
}

#[cfg(test)]
mod tests {
    use super::truncate;

    #[test]
    fn truncate_respects_char_boundaries() {
        assert_eq!(truncate("hello", 10), "hello");
        assert_eq!(truncate("hello", 5), "hello");
        assert_eq!(truncate("hello", 3), "hel…");
        assert_eq!(truncate("äöüß", 2), "äö…");
    }
}

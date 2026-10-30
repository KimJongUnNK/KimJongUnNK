//! Native OS notifications, driven directly through notify-rust.
//!
//! tauri-plugin-notification is deliberately not used: it injects its own
//! `window.Notification` polyfill into every page, which calls plugin commands
//! the Teams origin is not allowed to use and would break web notifications
//! entirely when native forwarding is switched off.

use notify_rust::NotificationResponse;
use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::{AppHandle, Runtime};

/// Threads currently blocked waiting for a click. Waiting can take until the
/// notification is dismissed (on macOS possibly forever), so a busy chat must
/// not pile up threads; beyond this cap notifications are fire-and-forget.
const MAX_WAITING: usize = 4;
static WAITING: AtomicUsize = AtomicUsize::new(0);

struct WaitSlot;

impl WaitSlot {
    fn acquire() -> Option<Self> {
        if WAITING.fetch_add(1, Ordering::AcqRel) < MAX_WAITING {
            Some(Self)
        } else {
            WAITING.fetch_sub(1, Ordering::AcqRel);
            None
        }
    }
}

impl Drop for WaitSlot {
    fn drop(&mut self) {
        WAITING.fetch_sub(1, Ordering::AcqRel);
    }
}

pub fn show<R: Runtime>(app: &AppHandle<R>, title: String, body: String) {
    let identifier = app.config().identifier.clone();
    let app = app.clone();
    std::thread::spawn(move || {
        let mut notification = notify_rust::Notification::new();
        notification
            .summary(&title)
            .body(&body)
            .appname(crate::APP_NAME)
            .auto_icon();
        // Freedesktop servers (GNOME, KDE) only report body clicks when the
        // notification advertises the "default" action.
        #[cfg(not(any(windows, target_os = "macos")))]
        notification.action("default", "Öffnen");

        #[cfg(windows)]
        if is_installed() {
            // Toasts are attributed via the AppUserModelID the installer
            // registers on the Start menu shortcut.
            notification.app_id(&identifier);
        }
        #[cfg(target_os = "macos")]
        let _ = notify_rust::set_application(if tauri::is_dev() {
            "com.apple.Terminal"
        } else {
            &identifier
        });
        #[cfg(not(any(windows, target_os = "macos")))]
        let _ = &identifier;

        match notification.show() {
            // Dropping the handle without waiting still shows the notification.
            Ok(handle) => {
                let Some(_slot) = WaitSlot::acquire() else {
                    return;
                };
                let _ = handle.wait_for_response(|response: &NotificationResponse| {
                    if matches!(
                        response,
                        NotificationResponse::Default | NotificationResponse::Action(_)
                    ) {
                        crate::show_main(&app);
                    }
                });
            }
            Err(err) => eprintln!("lean-teams: notification failed: {err}"),
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wait_slots_are_capped_and_released() {
        let slots: Vec<_> = std::iter::from_fn(WaitSlot::acquire).take(10).collect();
        assert_eq!(slots.len(), MAX_WAITING);
        assert!(WaitSlot::acquire().is_none());
        drop(slots);
        assert!(WaitSlot::acquire().is_some());
    }
}

/// `cargo run` builds have no registered AppUserModelID; using the identifier
/// there would make Windows drop the toast silently.
#[cfg(windows)]
fn is_installed() -> bool {
    let Ok(exe) = tauri::utils::platform::current_exe() else {
        return false;
    };
    let Some(dir) = exe.parent() else {
        return false;
    };
    !(dir.ends_with("target\\debug") || dir.ends_with("target\\release"))
}

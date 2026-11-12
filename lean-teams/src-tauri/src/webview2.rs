//! WebView2-specific memory and disk controls. These go through the raw COM
//! interfaces because Tauri does not wrap them.

use tauri::{Runtime, Webview};
use webview2_com::{
    take_pwstr, ClearBrowsingDataCompletedHandler, LaunchingExternalUriSchemeEventHandler,
    Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Profile2, ICoreWebView2_13, ICoreWebView2_18, ICoreWebView2_19,
        COREWEBVIEW2_BROWSING_DATA_KINDS, COREWEBVIEW2_BROWSING_DATA_KINDS_CACHE_STORAGE,
        COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
    },
};
use windows_core::{Interface, PWSTR};

/// Asks WebView2 to trim its working set (`Low`) or go back to normal.
///
/// Low keeps the page running, so calls, notifications and the unread badge
/// keep working; WebView2 just pages out and drops caches more aggressively.
/// Needs WebView2 Runtime 114+, older runtimes silently ignore the request.
pub fn set_low_memory<R: Runtime>(webview: &Webview<R>, low: bool) {
    let _ = webview.with_webview(move |platform| unsafe {
        let Ok(core) = platform.controller().CoreWebView2() else {
            return;
        };
        if let Ok(core) = core.cast::<ICoreWebView2_19>() {
            let level = if low {
                COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
            } else {
                COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
            };
            let _ = core.SetMemoryUsageTargetLevel(level);
        }
    });
}

/// Deletes the HTTP disk cache and Cache Storage, keeping cookies and local
/// storage so the user stays signed in, then reloads the page.
pub fn clear_cache<R: Runtime>(webview: &Webview<R>) {
    let reload_target = webview.clone();
    let _ = webview.with_webview(move |platform| unsafe {
        let Ok(core) = platform.controller().CoreWebView2() else {
            return;
        };
        let Ok(profile) = core
            .cast::<ICoreWebView2_13>()
            .and_then(|core| core.Profile())
            .and_then(|profile| profile.cast::<ICoreWebView2Profile2>())
        else {
            return;
        };
        let kinds = COREWEBVIEW2_BROWSING_DATA_KINDS(
            COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE.0
                | COREWEBVIEW2_BROWSING_DATA_KINDS_CACHE_STORAGE.0,
        );
        let handler = ClearBrowsingDataCompletedHandler::create(Box::new(move |_| {
            let _ = reload_target.reload();
            Ok(())
        }));
        let _ = profile.ClearBrowsingData(kinds, &handler);
    });
}

/// Catches `msteams:` launches before WebView2 shows its "This site is trying
/// to open Microsoft Teams" prompt. The Teams launcher fires them from a
/// hidden iframe, which never reaches the navigation handler. Other external
/// schemes keep WebView2's own prompt. Needs WebView2 Runtime 109+.
pub fn intercept_teams_links<R: Runtime>(
    webview: &Webview<R>,
    on_link: impl Fn(url::Url) + Send + 'static,
) {
    let _ = webview.with_webview(move |platform| unsafe {
        let Ok(core) = platform
            .controller()
            .CoreWebView2()
            .and_then(|core| core.cast::<ICoreWebView2_18>())
        else {
            return;
        };
        let handler = LaunchingExternalUriSchemeEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else {
                return Ok(());
            };
            let mut uri = PWSTR::null();
            args.Uri(&mut uri)?;
            let uri = take_pwstr(uri);
            if let Some(target) = url::Url::parse(&uri)
                .ok()
                .and_then(|url| crate::policy::teams_web_link(&url))
            {
                args.SetCancel(true)?;
                on_link(target);
            }
            Ok(())
        }));
        let mut token = 0i64;
        let _ = core.add_LaunchingExternalUriScheme(&handler, &mut token);
    });
}

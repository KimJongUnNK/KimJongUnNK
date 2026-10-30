//! WebView2-specific memory and disk controls. These go through the raw COM
//! interfaces because Tauri does not wrap them.

use tauri::{Runtime, Webview};
use webview2_com::{
    ClearBrowsingDataCompletedHandler,
    Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Profile2, ICoreWebView2_13, ICoreWebView2_19,
        COREWEBVIEW2_BROWSING_DATA_KINDS, COREWEBVIEW2_BROWSING_DATA_KINDS_CACHE_STORAGE,
        COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
    },
};
use windows_core::Interface;

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
/// storage so the user stays signed in.
pub fn clear_cache<R: Runtime>(webview: &Webview<R>) {
    let _ = webview.with_webview(|platform| unsafe {
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
        let handler = ClearBrowsingDataCompletedHandler::create(Box::new(|_| Ok(())));
        let _ = profile.ClearBrowsingData(kinds, &handler);
    });
}

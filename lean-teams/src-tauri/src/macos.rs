//! WKWebView-specific controls that Tauri does not wrap.

use block2::RcBlock;
use objc2_foundation::{NSDate, NSSet, NSString};
use objc2_web_kit::{
    WKWebView, WKWebsiteDataTypeDiskCache, WKWebsiteDataTypeFetchCache,
    WKWebsiteDataTypeMemoryCache, WKWebsiteDataTypeOfflineWebApplicationCache,
};
use tauri::{Runtime, Webview};

/// Deletes the HTTP disk cache and the fetch/memory/app caches, keeping
/// cookies, local storage and IndexedDB so the user stays signed in, then
/// reloads the page.
pub fn clear_cache<R: Runtime>(webview: &Webview<R>) {
    let reload_target = webview.clone();
    let _ = webview.with_webview(move |platform| unsafe {
        let view = &*platform.inner().cast::<WKWebView>();
        let store = view.configuration().websiteDataStore();
        let kinds: [&NSString; 4] = [
            WKWebsiteDataTypeDiskCache,
            WKWebsiteDataTypeFetchCache,
            WKWebsiteDataTypeMemoryCache,
            WKWebsiteDataTypeOfflineWebApplicationCache,
        ];
        let kinds = NSSet::from_slice(&kinds);
        let done = RcBlock::new(move || {
            let _ = reload_target.reload();
        });
        store.removeDataOfTypes_modifiedSince_completionHandler(
            &kinds,
            &NSDate::distantPast(),
            &done,
        );
    });
}

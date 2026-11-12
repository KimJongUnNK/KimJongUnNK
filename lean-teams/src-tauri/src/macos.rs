//! WKWebView-specific controls that Tauri does not wrap.

use block2::RcBlock;
use objc2::AnyThread;
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

/// Sets the Dock icon of the running app. Must run on the main thread, so it
/// is queued there; the icon is handed over as PNG data.
pub fn set_dock_icon<R: Runtime>(app: &tauri::AppHandle<R>, icon: &tauri::image::Image<'_>) {
    let Some(png) = encode_png(icon) else {
        return;
    };
    let _ = app.run_on_main_thread(move || {
        let Some(mtm) = objc2::MainThreadMarker::new() else {
            return;
        };
        let data = objc2_foundation::NSData::with_bytes(&png);
        let Some(image) =
            objc2_app_kit::NSImage::initWithData(objc2_app_kit::NSImage::alloc(), &data)
        else {
            return;
        };
        let ns_app = objc2_app_kit::NSApplication::sharedApplication(mtm);
        unsafe { ns_app.setApplicationIconImage(Some(&image)) };
    });
}

fn encode_png(icon: &tauri::image::Image<'_>) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, icon.width(), icon.height());
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().ok()?;
        writer.write_image_data(icon.rgba()).ok()?;
    }
    Some(out)
}

/// Lets the embedded Teams apps (Assignments, OneNote, Forms, …) keep their
/// sign-in. They run in cross-site iframes, and WebKit's tracking prevention
/// (ITP, "Prevent cross-site tracking" in Safari) blocks their cookies, so
/// Assignments asks for its permissions again on every start. Microsoft's
/// advice for Teams in Safari is to turn that off; WKWebView only offers it
/// as SPI, so each call is guarded and simply skipped where unavailable.
pub fn allow_cross_site_sign_in<R: Runtime>(webview: &Webview<R>) {
    use objc2::{msg_send, sel};
    use objc2_foundation::NSObjectProtocol;
    let _ = webview.with_webview(|platform| unsafe {
        let view = &*platform.inner().cast::<WKWebView>();
        let store = view.configuration().websiteDataStore();
        if store.respondsToSelector(sel!(_setResourceLoadStatisticsEnabled:)) {
            let _: () = msg_send![&*store, _setResourceLoadStatisticsEnabled: false];
            eprintln!("lean-teams: tracking prevention off");
        }
        let block_mode =
            sel!(_setThirdPartyCookieBlockingMode:onlyOnSitesWithoutUserInteraction:completionHandler:);
        if store.respondsToSelector(block_mode) {
            let done = RcBlock::new(|| {});
            let _: () = msg_send![
                &*store,
                _setThirdPartyCookieBlockingMode: false,
                onlyOnSitesWithoutUserInteraction: false,
                completionHandler: &*done
            ];
            eprintln!("lean-teams: third-party cookie blocking off");
        }
    });
}

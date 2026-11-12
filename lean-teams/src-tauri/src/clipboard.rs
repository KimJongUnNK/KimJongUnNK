//! "KI-Kopie": puts the current assignment on the clipboard, as text or as a
//! screenshot of what the window shows, ready to paste into an AI chat.
//!
//! Screenshots come from the webview itself, so cross-origin frames such as
//! the Assignments app are included: WebView2 `CapturePreview` (Windows),
//! `WKWebView takeSnapshot` (macOS), `webkit_web_view_get_snapshot` (Linux).

use std::{sync::mpsc, time::Duration};
use tauri::{Runtime, Webview};

const CAPTURE_TIMEOUT: Duration = Duration::from_secs(10);

/// Copies plain text.
pub fn set_text(text: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::{NSPasteboard, NSPasteboardTypeString};
        use objc2_foundation::NSString;
        let board = NSPasteboard::generalPasteboard();
        board.clearContents();
        let ok =
            unsafe { board.setString_forType(&NSString::from_str(text), NSPasteboardTypeString) };
        if ok {
            Ok(())
        } else {
            Err("Zwischenablage nicht beschreibbar".into())
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        with_board(|board| board.set_text(text.to_owned()))
    }
}

/// One clipboard handle for the app's lifetime. On X11 the app itself
/// serves what it copied, and dropping the last handle would take the
/// contents with it.
#[cfg(not(target_os = "macos"))]
fn with_board(
    f: impl FnOnce(&mut arboard::Clipboard) -> Result<(), arboard::Error>,
) -> Result<(), String> {
    use std::sync::{Mutex, OnceLock};
    static BOARD: OnceLock<Mutex<Option<arboard::Clipboard>>> = OnceLock::new();
    let mut guard = BOARD
        .get_or_init(|| Mutex::new(None))
        .lock()
        .map_err(|_| "Zwischenablage blockiert".to_string())?;
    if guard.is_none() {
        *guard = Some(arboard::Clipboard::new().map_err(|e| e.to_string())?);
    }
    f(guard.as_mut().expect("set above")).map_err(|e| e.to_string())
}

/// Copies an RGBA image.
#[cfg(not(target_os = "macos"))]
fn set_image(width: usize, height: usize, rgba: Vec<u8>) -> Result<(), String> {
    with_board(|board| {
        board.set_image(arboard::ImageData {
            width,
            height,
            bytes: rgba.into(),
        })
    })
}

/// Screenshot of the visible page (all frames) onto the clipboard. Blocks
/// the calling thread until done; never call it on the main thread.
pub fn copy_screenshot<R: Runtime>(webview: &Webview<R>) -> Result<(), String> {
    let (tx, rx) = mpsc::channel::<Result<(), String>>();
    start_capture(webview, tx)?;
    rx.recv_timeout(CAPTURE_TIMEOUT)
        .map_err(|_| "Screenshot hat zu lange gedauert".to_string())?
}

#[cfg(windows)]
fn start_capture<R: Runtime>(
    webview: &Webview<R>,
    tx: mpsc::Sender<Result<(), String>>,
) -> Result<(), String> {
    use webview2_com::{
        CapturePreviewCompletedHandler,
        Microsoft::Web::WebView2::Win32::COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
    };
    use windows::Win32::{
        System::Com::{IStream, STATFLAG_NONAME, STATSTG, STREAM_SEEK_SET},
        UI::Shell::SHCreateMemStream,
    };

    fn read_all(stream: &IStream) -> windows_core::Result<Vec<u8>> {
        unsafe {
            let mut stat = STATSTG::default();
            stream.Stat(&mut stat, STATFLAG_NONAME)?;
            stream.Seek(0, STREAM_SEEK_SET, None)?;
            let mut buf = vec![0u8; stat.cbSize as usize];
            let mut read = 0u32;
            stream
                .Read(buf.as_mut_ptr().cast(), buf.len() as u32, Some(&mut read))
                .ok()?;
            buf.truncate(read as usize);
            Ok(buf)
        }
    }

    webview
        .with_webview(move |platform| unsafe {
            let fail = |tx: &mpsc::Sender<Result<(), String>>, e: String| {
                let _ = tx.send(Err(e));
            };
            let core = match platform.controller().CoreWebView2() {
                Ok(core) => core,
                Err(e) => return fail(&tx, e.to_string()),
            };
            let Some(stream) = SHCreateMemStream(None) else {
                return fail(&tx, "kein Speicher-Stream".into());
            };
            let result_stream = stream.clone();
            let done_tx = tx.clone();
            let handler = CapturePreviewCompletedHandler::create(Box::new(move |result| {
                let outcome = result
                    .and_then(|_| read_all(&result_stream))
                    .map_err(|e| e.to_string())
                    .and_then(|png| {
                        let image =
                            tauri::image::Image::from_bytes(&png).map_err(|e| e.to_string())?;
                        set_image(
                            image.width() as usize,
                            image.height() as usize,
                            image.rgba().to_vec(),
                        )
                    });
                let _ = done_tx.send(outcome);
                Ok(())
            }));
            if let Err(e) = core.CapturePreview(
                COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
                &stream,
                &handler,
            ) {
                fail(&tx, e.to_string());
            }
        })
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
fn start_capture<R: Runtime>(
    webview: &Webview<R>,
    tx: mpsc::Sender<Result<(), String>>,
) -> Result<(), String> {
    use block2::RcBlock;
    use objc2::runtime::ProtocolObject;
    use objc2_app_kit::{NSImage, NSPasteboard};
    use objc2_foundation::{NSArray, NSError};
    use objc2_web_kit::WKWebView;

    webview
        .with_webview(move |platform| unsafe {
            let view = &*platform.inner().cast::<WKWebView>();
            let done = RcBlock::new(move |image: *mut NSImage, _error: *mut NSError| {
                let outcome = match image.as_ref() {
                    Some(image) => {
                        let board = NSPasteboard::generalPasteboard();
                        board.clearContents();
                        let item = ProtocolObject::from_ref(image);
                        if board.writeObjects(&NSArray::from_slice(&[item])) {
                            Ok(())
                        } else {
                            Err("Zwischenablage nicht beschreibbar".to_string())
                        }
                    }
                    None => Err("Screenshot fehlgeschlagen".to_string()),
                };
                let _ = tx.send(outcome);
            });
            view.takeSnapshotWithConfiguration_completionHandler(None, &done);
        })
        .map_err(|e| e.to_string())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn start_capture<R: Runtime>(
    webview: &Webview<R>,
    tx: mpsc::Sender<Result<(), String>>,
) -> Result<(), String> {
    use webkit2gtk::{SnapshotOptions, SnapshotRegion, WebViewExt};

    webview
        .with_webview(move |platform| {
            platform.inner().snapshot(
                SnapshotRegion::Visible,
                SnapshotOptions::NONE,
                None::<&webkit2gtk::gio::Cancellable>,
                move |result| {
                    let outcome = result
                        .map_err(|e| e.to_string())
                        .and_then(|surface| {
                            let mut image = cairo::ImageSurface::try_from(surface)
                                .map_err(|_| "kein Bild".to_string())?;
                            let (w, h) = (image.width() as usize, image.height() as usize);
                            let stride = image.stride() as usize;
                            let data = image.data().map_err(|e| e.to_string())?;
                            Ok((w, h, cairo_to_rgba(&data, w, h, stride)))
                        })
                        .and_then(|(w, h, rgba)| set_image(w, h, rgba));
                    let _ = tx.send(outcome);
                },
            );
        })
        .map_err(|e| e.to_string())
}

/// Cairo ARGB32 (premultiplied, native-endian BGRA on little endian) to
/// straight RGBA.
#[cfg_attr(not(all(unix, not(target_os = "macos"))), allow(dead_code))]
fn cairo_to_rgba(data: &[u8], width: usize, height: usize, stride: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(width * height * 4);
    for y in 0..height {
        let row = &data[y * stride..y * stride + width * 4];
        for px in row.chunks_exact(4) {
            let (b, g, r, a) = (px[0], px[1], px[2], px[3]);
            let un = |c: u8| {
                if a == 0 {
                    0
                } else {
                    ((u16::from(c) * 255 + u16::from(a) / 2) / u16::from(a)).min(255) as u8
                }
            };
            out.extend_from_slice(&[un(r), un(g), un(b), a]);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::cairo_to_rgba;

    #[test]
    fn cairo_pixels_become_straight_rgba() {
        // stride 12 for a 2px wide image: 4 bytes of row padding.
        let data = [
            0, 0, 255, 255, /* red */ 128, 0, 0, 128, /* half blue */ 9, 9, 9, 9, //
            255, 255, 255, 255, /* white */ 0, 0, 0, 0, /* clear */ 9, 9, 9, 9,
        ];
        let rgba = cairo_to_rgba(&data, 2, 2, 12);
        assert_eq!(
            rgba,
            [255, 0, 0, 255, 0, 0, 255, 128, 255, 255, 255, 255, 0, 0, 0, 0]
        );
    }
}

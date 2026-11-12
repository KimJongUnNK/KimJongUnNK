//! The app icon's underline follows the accent color: window icon (title
//! bar, taskbar, Alt-Tab), tray icon on Windows/Linux and the Dock icon on
//! macOS. The installed icon (Start menu, Finder) keeps the default lime.

use crate::{overlay::Rgb, MAIN, TRAY};
use tauri::{image::Image, AppHandle, Manager, Runtime};

/// The icon without its underline, 512×512.
const BASE: &[u8] = include_bytes!("../icons/runtime-base.png");
/// Underline rectangle in the 512 px base: x0, y0, x1, y1 (exclusive).
const BAR: (u32, u32, u32, u32) = (96, 368, 416, 396);
/// The brand lime of the installed icon.
const DEFAULT_BAR: Rgb = Rgb(0xc4, 0xff, 0x00);

/// The icon with its underline in `color`.
pub fn render(color: Rgb) -> Option<Image<'static>> {
    let base = Image::from_bytes(BASE).ok()?;
    let (width, height) = (base.width(), base.height());
    if BAR.2 > width || BAR.3 > height {
        return None;
    }
    let mut rgba = base.rgba().to_vec();
    for y in BAR.1..BAR.3 {
        for x in BAR.0..BAR.2 {
            let i = ((y * width + x) * 4) as usize;
            rgba[i..i + 4].copy_from_slice(&[color.0, color.1, color.2, 255]);
        }
    }
    Some(Image::new_owned(rgba, width, height))
}

/// Recolors every running-app icon to `accent` (`None`: default lime).
pub fn apply<R: Runtime>(app: &AppHandle<R>, accent: Option<&str>) {
    let color = accent.and_then(Rgb::parse).unwrap_or(DEFAULT_BAR);
    let Some(icon) = render(color) else {
        return;
    };
    if let Some(window) = app.get_webview_window(MAIN) {
        let _ = window.set_icon(icon.clone());
    }
    // The macOS menu bar keeps its monochrome template icon.
    #[cfg(not(target_os = "macos"))]
    if let Some(tray) = app.tray_by_id(TRAY) {
        let _ = tray.set_icon(Some(icon.clone()));
    }
    #[cfg(target_os = "macos")]
    {
        let _ = TRAY;
        crate::macos::set_dock_icon(app, &icon);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn underline_takes_the_accent_and_nothing_else_changes() {
        let base = Image::from_bytes(BASE).unwrap();
        let red = render(Rgb(255, 0, 0)).unwrap();
        assert_eq!((red.width(), red.height()), (512, 512));
        let px = |img: &Image, x: u32, y: u32| {
            let i = ((y * img.width() + x) * 4) as usize;
            img.rgba()[i..i + 4].to_vec()
        };
        assert_eq!(px(&red, 256, 380), [255, 0, 0, 255]);
        assert_eq!(px(&red, BAR.0, BAR.1), [255, 0, 0, 255]);
        assert_eq!(px(&red, BAR.2 - 1, BAR.3 - 1), [255, 0, 0, 255]);
        // Just outside the bar, the base is untouched (dark background).
        for (x, y) in [
            (BAR.0 - 1, 380),
            (BAR.2, 380),
            (256, BAR.1 - 1),
            (256, BAR.3),
        ] {
            assert_eq!(px(&red, x, y), px(&base, x, y));
            assert_eq!(px(&base, x, y)[3], 255);
        }
        // The base itself has no underline, the dark background is there.
        assert_eq!(px(&base, 256, 380), [14, 14, 16, 255]);
    }
}

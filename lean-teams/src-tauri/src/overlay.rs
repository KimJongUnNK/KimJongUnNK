//! Custom look and user mods on top of the Teams web app: accent color,
//! privacy blur, `custom.css` and a `mods/` folder of CSS and JS files.
//!
//! The built-in parts avoid Teams' generated class names, which change with
//! every Teams release: the accent color goes through Fluent UI's design
//! tokens (CSS custom properties Teams itself uses) and the blur through a
//! class on <html>. Anything more specific is up to the user's own files.

use serde::{Deserialize, Serialize};
use std::{fs, path::Path};

pub const CSS_FILE: &str = "custom.css";
pub const MODS_DIR: &str = "mods";

/// Mod files larger than this are skipped (a stray video renamed to .css
/// should not end up inside every page load).
const MAX_MOD_BYTES: u64 = 1024 * 1024;

/// Written on first run so the user has a starting point.
const CSS_TEMPLATE: &str = r#"/* Scheiss Teams - eigenes CSS
 *
 * Wird über Teams gelegt. Ändern, speichern, dann im Tray-Menü
 * "Design neu laden" - kein Neustart nötig.
 *
 * Selektoren finden: Teams im normalen Browser öffnen (teams.microsoft.com),
 * Rechtsklick > Untersuchen. Am stabilsten sind [data-tid="..."]-Attribute;
 * Teams' generierte Klassennamen ändern sich mit jedem Update.
 *
 * Beispiele (Kommentarzeichen entfernen, um sie zu nutzen):
 */

/* Schmalere Scrollbalken
::-webkit-scrollbar { width: 6px; height: 6px; }
*/

/* Andere Schrift überall
body, button, input, textarea { font-family: "Inter", system-ui, sans-serif !important; }
*/

/* Rundere Ecken an allen Fluent-Elementen
:root, .fui-FluentProvider { --borderRadiusMedium: 10px !important; --borderRadiusLarge: 14px !important; }
*/
"#;

/// Files written into a new mods folder. The underscore keeps the examples
/// switched off until the user renames them.
const MODS_README: &str = r#"Scheiss Teams - Mods
==================

Jede .css- und .js-Datei in diesem Ordner wird in Teams geladen,
in alphabetischer Reihenfolge.

  Ausschalten:  Dateinamen mit _ beginnen lassen  (_mein-mod.css)
  Neu laden:    Tray-Menü > "Design neu laden"
                CSS wirkt sofort, bei JS-Mods lädt Teams kurz neu.
  Selektoren:   Teams im Browser öffnen, Rechtsklick > Untersuchen

CSS-Mods sind reine Optik und können nichts kaputt machen.

JS-Mods laufen mit denselben Rechten wie Teams selbst: sie sehen deine
Chats und können in deinem Namen handeln. Nur eigenen oder geprüften Code
hier ablegen. Jeder Mod läuft einmal pro Seitenaufruf; ein Fehler in einem
Mod stoppt die anderen nicht.

Ganz ausschalten: in config.json  "overlay": { "mods": false }
"#;

const EXAMPLE_CSS: &str = r#"/* Beispiel-Mod: kompakter Modus.
 * Zum Aktivieren den Unterstrich vorne aus dem Dateinamen entfernen. */
:root, .fui-FluentProvider {
  --spacingVerticalM: 6px !important;
  --spacingVerticalL: 8px !important;
  --spacingHorizontalM: 8px !important;
  --fontSizeBase300: 13px !important;
}
"#;

const EXAMPLE_JS: &str = r#"// Beispiel-Mod: zeigt die Uhrzeit des letzten Ladens im Fenstertitel-Tooltip
// der Seite und loggt in die Konsole. Zum Aktivieren den Unterstrich vorne
// aus dem Dateinamen entfernen.
console.log("[Scheiss Teams] Beispiel-Mod geladen um", new Date().toLocaleTimeString());
document.documentElement.setAttribute("data-lean-mod-loaded", new Date().toISOString());
"#;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct OverlayConfig {
    /// Accent color as "#RRGGBB" or "#RGB"; replaces Teams' purple
    /// everywhere (see theme.js).
    pub accent_color: Option<String>,
    /// How much neutral backgrounds are tinted toward the accent, 0.0 to 0.4.
    pub tint: f64,
    /// How much neutral borders and dividers are tinted toward the accent,
    /// 0.0 (grey) to 1.0 (accent color).
    pub border_tint: f64,
    /// Also recolor purple icons (Teams logo, app icons such as Assignments)
    /// with the accent color.
    pub recolor_icons: bool,
    /// Two small buttons at the right window edge: copy the open assignment
    /// as text or as a screenshot (for pasting into an AI chat).
    pub copy_buttons: bool,
    /// Page zoom, 0.5 to 2.0. Ctrl/Cmd +/- works too.
    pub zoom: f64,
    /// Blur the whole window while it is not focused (screen sharing,
    /// people looking over your shoulder).
    pub privacy_blur: bool,
    /// Apply `custom.css` from the config folder.
    pub custom_css: bool,
    /// Load the CSS and JS files in the `mods` folder.
    pub mods: bool,
    /// Keep the window above all others.
    pub always_on_top: bool,
}

impl Default for OverlayConfig {
    fn default() -> Self {
        Self {
            accent_color: None,
            tint: 0.0,
            border_tint: 0.0,
            recolor_icons: true,
            copy_buttons: true,
            zoom: 1.0,
            privacy_blur: false,
            custom_css: true,
            mods: true,
            always_on_top: false,
        }
    }
}

impl OverlayConfig {
    pub fn tint(&self) -> f64 {
        if self.tint.is_finite() {
            self.tint.clamp(0.0, 0.4)
        } else {
            0.0
        }
    }

    pub fn border_tint(&self) -> f64 {
        if self.border_tint.is_finite() {
            self.border_tint.clamp(0.0, 1.0)
        } else {
            0.0
        }
    }

    /// The accent as "#rrggbb", if set and valid.
    pub fn accent(&self) -> Option<String> {
        self.accent_color
            .as_deref()
            .and_then(Rgb::parse)
            .map(Rgb::css)
    }

    pub fn zoom(&self) -> f64 {
        if self.zoom.is_finite() {
            self.zoom.clamp(0.5, 2.0)
        } else {
            1.0
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rgb(pub u8, pub u8, pub u8);

impl Rgb {
    pub fn parse(text: &str) -> Option<Self> {
        let hex = text.trim().strip_prefix('#')?;
        let digits: Vec<u8> = hex
            .chars()
            .map(|c| c.to_digit(16).map(|d| d as u8))
            .collect::<Option<_>>()?;
        match digits[..] {
            [r, g, b] => Some(Self(r * 17, g * 17, b * 17)),
            [r1, r2, g1, g2, b1, b2] => Some(Self(r1 * 16 + r2, g1 * 16 + g2, b1 * 16 + b2)),
            _ => None,
        }
    }

    /// Mixes towards black (`amount` < 0) or white (`amount` > 0).
    fn shade(self, amount: f64) -> Self {
        let target = if amount < 0.0 { 0.0 } else { 255.0 };
        let t = amount.abs().min(1.0);
        let mix = |c: u8| (f64::from(c) + (target - f64::from(c)) * t).round() as u8;
        Self(mix(self.0), mix(self.1), mix(self.2))
    }

    /// WCAG relative luminance, 0 (black) to 1 (white).
    fn luminance(self) -> f64 {
        let channel = |c: u8| {
            let c = f64::from(c) / 255.0;
            if c <= 0.03928 {
                c / 12.92
            } else {
                ((c + 0.055) / 1.055).powf(2.4)
            }
        };
        0.2126 * channel(self.0) + 0.7152 * channel(self.1) + 0.0722 * channel(self.2)
    }

    fn css(self) -> String {
        format!("#{:02x}{:02x}{:02x}", self.0, self.1, self.2)
    }
}

/// Fluent UI v9 brand tokens set to `accent`. Text on accent-colored
/// surfaces flips to black when the accent is too light for white text.
pub fn accent_css(accent: Rgb) -> String {
    let base = accent.css();
    let hover = accent.shade(-0.12).css();
    let pressed = accent.shade(-0.24).css();
    let subtle = accent.shade(0.85).css();
    let on_brand = if accent.luminance() > 0.45 {
        "#000000"
    } else {
        "#ffffff"
    };
    let tokens = [
        ("colorBrandBackground", base.as_str()),
        ("colorBrandBackgroundHover", hover.as_str()),
        ("colorBrandBackgroundPressed", pressed.as_str()),
        ("colorBrandBackgroundSelected", hover.as_str()),
        ("colorCompoundBrandBackground", base.as_str()),
        ("colorCompoundBrandBackgroundHover", hover.as_str()),
        ("colorCompoundBrandBackgroundPressed", pressed.as_str()),
        ("colorBrandBackground2", subtle.as_str()),
        ("colorBrandForeground1", base.as_str()),
        ("colorBrandForeground2", hover.as_str()),
        ("colorBrandForegroundLink", base.as_str()),
        ("colorBrandForegroundLinkHover", hover.as_str()),
        ("colorBrandForegroundLinkPressed", pressed.as_str()),
        ("colorCompoundBrandForeground1", base.as_str()),
        ("colorCompoundBrandForeground1Hover", hover.as_str()),
        ("colorCompoundBrandStroke", base.as_str()),
        ("colorCompoundBrandStrokeHover", hover.as_str()),
        ("colorBrandStroke1", base.as_str()),
        ("colorNeutralForegroundOnBrand", on_brand),
    ];
    let mut css = String::from(":root, .fui-FluentProvider, [class*=\"fui-FluentProvider\"] {\n");
    for (name, value) in tokens {
        css.push_str(&format!("  --{name}: {value} !important;\n"));
    }
    css.push_str("}\n");
    css
}

/// Applied while the window is unfocused and privacy blur is on.
const BLUR_CSS: &str = "html.lean-blur body { filter: blur(16px) saturate(0.6) !important; }\n\
html body { transition: filter 120ms ease-out; }\n";

/// The full stylesheet for the current settings: built-in parts first, then
/// `custom.css`, then the CSS mods.
pub fn build_css(config: &OverlayConfig, user_css: &str, mods: &[Mod]) -> String {
    let mut css = String::new();
    if let Some(accent) = config.accent_color.as_deref().and_then(Rgb::parse) {
        css.push_str(&accent_css(accent));
    }
    if config.privacy_blur {
        css.push_str(BLUR_CSS);
    }
    if config.custom_css && !user_css.trim().is_empty() {
        css.push_str("/* custom.css */\n");
        css.push_str(user_css);
        css.push('\n');
    }
    if config.mods {
        for m in mods.iter().filter(|m| m.kind == ModKind::Css) {
            css.push_str(&format!("/* mods/{} */\n", m.name));
            css.push_str(&m.code);
            css.push('\n');
        }
    }
    css
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModKind {
    Css,
    Js,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Mod {
    pub name: String,
    pub kind: ModKind,
    pub code: String,
}

/// Enabled mods in `dir/mods`, sorted by file name. Creates the folder with
/// a README and switched-off examples on first run.
pub fn load_mods(dir: &Path) -> Vec<Mod> {
    let mods_dir = dir.join(MODS_DIR);
    if !mods_dir.exists() && fs::create_dir_all(&mods_dir).is_ok() {
        let _ = fs::write(mods_dir.join("LIESMICH.txt"), MODS_README);
        let _ = fs::write(mods_dir.join("_beispiel-kompakt.css"), EXAMPLE_CSS);
        let _ = fs::write(mods_dir.join("_beispiel-konsole.js"), EXAMPLE_JS);
    }
    let Ok(entries) = fs::read_dir(&mods_dir) else {
        return Vec::new();
    };
    let mut mods: Vec<Mod> = entries
        .filter_map(Result::ok)
        .filter(|e| {
            e.metadata()
                .map(|m| m.is_file() && m.len() <= MAX_MOD_BYTES)
                .unwrap_or(false)
        })
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with('_') || name.starts_with('.') {
                return None;
            }
            let kind = match Path::new(&name)
                .extension()?
                .to_str()?
                .to_ascii_lowercase()
                .as_str()
            {
                "css" => ModKind::Css,
                "js" => ModKind::Js,
                _ => return None,
            };
            let code = fs::read_to_string(e.path()).ok()?;
            Some(Mod { name, kind, code })
        })
        .collect();
    mods.sort_by(|a, b| a.name.cmp(&b.name));
    mods
}

/// One script per JS mod, each run at most once per page. Evaluated through
/// the webview (not eval/new Function inside the page), so a strict
/// Content-Security-Policy cannot block it, and a syntax error only affects
/// its own mod.
pub fn mod_scripts(config: &OverlayConfig, mods: &[Mod]) -> Vec<String> {
    if !config.mods {
        return Vec::new();
    }
    mods.iter()
        .filter(|m| m.kind == ModKind::Js)
        .map(|m| {
            let name = serde_json::to_string(&m.name).expect("strings always serialize");
            format!(
                "if (window.top === window) {{ var __lm = window.__leanMods || (window.__leanMods = {{}}); if (!__lm[{name}]) {{ __lm[{name}] = true; try {{ (function () {{\n{code}\n}})(); }} catch (e) {{ console.error(\"[Scheiss Teams] Mod \" + {name} + \" failed:\", e); }} }} }}",
                code = m.code
            )
        })
        .collect()
}

/// Everything the window needs to apply the current overlay.
#[derive(Debug, Clone, Default)]
pub struct Overlay {
    pub settings: OverlayConfig,
    pub css: String,
    pub js: Vec<String>,
}

impl Overlay {
    pub fn load(dir: &Path, settings: OverlayConfig) -> Self {
        let mods = load_mods(dir);
        Self {
            css: build_css(&settings, &load_user_css(dir), &mods),
            js: mod_scripts(&settings, &mods),
            settings,
        }
    }
}

/// JavaScript that installs (or replaces) the overlay stylesheet.
///
/// Uses a constructable stylesheet because CSSOM changes are not subject to
/// a page's Content-Security-Policy, unlike an injected <style> element;
/// falls back to <style> on engines without adoptedStyleSheets.
pub fn apply_script(css: &str) -> String {
    let css = serde_json::to_string(css).expect("strings always serialize");
    format!(
        r#"(function (css) {{
  if (window.top !== window) return;
  try {{
    var sheet = window.__leanOverlaySheet;
    if (!sheet) {{ sheet = new CSSStyleSheet(); window.__leanOverlaySheet = sheet; }}
    sheet.replaceSync(css);
    if (document.adoptedStyleSheets.indexOf(sheet) < 0) {{
      document.adoptedStyleSheets = document.adoptedStyleSheets.concat([sheet]);
    }}
    return;
  }} catch (e) {{}}
  var el = document.getElementById("lean-overlay");
  if (!el) {{
    el = document.createElement("style");
    el.id = "lean-overlay";
    (document.head || document.documentElement).appendChild(el);
  }}
  el.textContent = css;
}})({css});"#
    )
}

/// JavaScript that hands accent and tint to the theme engine (theme.js).
pub fn theme_script(config: &OverlayConfig) -> String {
    let args = serde_json::json!({
        "accent": config.accent(),
        "tint": config.tint(),
        "borderTint": config.border_tint(),
        "icons": config.recolor_icons,
    });
    format!("window.__leanTheme && window.__leanTheme.set({args});")
}

/// Shows or hides the copy buttons (copy-shim.js).
pub fn copy_script(config: &OverlayConfig) -> String {
    format!(
        "window.__leanCopy && window.__leanCopy.configure({{\"buttons\":{}}});",
        config.copy_buttons
    )
}

/// JavaScript that turns the privacy blur on or off.
pub fn blur_script(on: bool) -> String {
    format!(
        "document.documentElement && document.documentElement.classList.toggle('lean-blur', {on});"
    )
}

/// Reads `custom.css`, writing the commented template on first run.
pub fn load_user_css(dir: &Path) -> String {
    let path = dir.join(CSS_FILE);
    match fs::read_to_string(&path) {
        Ok(css) => css,
        Err(_) => {
            if fs::create_dir_all(dir).is_ok() {
                let _ = fs::write(&path, CSS_TEMPLATE);
            }
            CSS_TEMPLATE.to_string()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_short_and_long_hex() {
        assert_eq!(Rgb::parse("#C4FF00"), Some(Rgb(0xc4, 0xff, 0x00)));
        assert_eq!(Rgb::parse(" #0af "), Some(Rgb(0x00, 0xaa, 0xff)));
        assert_eq!(Rgb::parse("C4FF00"), None);
        assert_eq!(Rgb::parse("#C4FF0"), None);
        assert_eq!(Rgb::parse("#zzzzzz"), None);
        assert_eq!(Rgb::parse("#fff;}body{display:none"), None);
    }

    #[test]
    fn text_on_light_accents_turns_black() {
        assert!(
            accent_css(Rgb(0xc4, 0xff, 0x00)).contains("--colorNeutralForegroundOnBrand: #000000")
        );
        assert!(
            accent_css(Rgb(0x46, 0x47, 0x75)).contains("--colorNeutralForegroundOnBrand: #ffffff")
        );
    }

    #[test]
    fn accent_sets_brand_tokens_with_darker_states() {
        let css = accent_css(Rgb(0x80, 0x80, 0x80));
        assert!(css.contains("--colorBrandBackground: #808080 !important;"));
        assert!(css.contains("--colorBrandBackgroundHover: #717171 !important;"));
        assert!(css.contains("--colorBrandBackgroundPressed: #616161 !important;"));
        assert!(css.starts_with(":root, .fui-FluentProvider"));
    }

    #[test]
    fn css_only_contains_enabled_parts() {
        let mut config = OverlayConfig::default();
        assert_eq!(build_css(&config, "  \n", &[]), "");
        assert!(build_css(&config, ".x{}", &[]).contains(".x{}"));

        config.custom_css = false;
        config.privacy_blur = true;
        config.accent_color = Some("not a color".into());
        let css = build_css(&config, ".x{}", &[]);
        assert!(css.contains("lean-blur"));
        assert!(!css.contains(".x{}"));
        assert!(!css.contains("colorBrand"));
    }

    #[test]
    fn script_embeds_css_as_a_safe_string_literal() {
        let script = apply_script("a::after{content:\"</script>\\\"'\"}\n");
        assert!(script.contains(r#""a::after{content:\"</script>\\\"'\"}\n""#));
        assert!(script.contains("adoptedStyleSheets"));
    }

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("lean-teams-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn mods_folder_is_created_with_disabled_examples() {
        let dir = temp_dir("mods-init");
        assert!(load_mods(&dir).is_empty());
        let mods_dir = dir.join(MODS_DIR);
        assert!(mods_dir.join("LIESMICH.txt").exists());
        assert!(mods_dir.join("_beispiel-kompakt.css").exists());
        assert!(mods_dir.join("_beispiel-konsole.js").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn mods_are_sorted_filtered_and_split_by_kind() {
        let dir = temp_dir("mods-load");
        let mods_dir = dir.join(MODS_DIR);
        fs::create_dir_all(&mods_dir).unwrap();
        fs::write(mods_dir.join("b.css"), ".b{}").unwrap();
        fs::write(mods_dir.join("a.CSS"), ".a{}").unwrap();
        fs::write(mods_dir.join("c.js"), "window.c = 1;").unwrap();
        fs::write(mods_dir.join("_off.css"), ".off{}").unwrap();
        fs::write(mods_dir.join(".hidden.js"), "x").unwrap();
        fs::write(mods_dir.join("notes.txt"), "x").unwrap();
        fs::create_dir_all(mods_dir.join("folder.css")).unwrap();

        let mods = load_mods(&dir);
        let names: Vec<_> = mods.iter().map(|m| m.name.as_str()).collect();
        assert_eq!(names, ["a.CSS", "b.css", "c.js"]);

        let config = OverlayConfig::default();
        let css = build_css(&config, "", &mods);
        assert!(css.find(".a{}").unwrap() < css.find(".b{}").unwrap());
        assert!(!css.contains(".off{}"));
        let js = mod_scripts(&config, &mods);
        assert_eq!(js.len(), 1);
        assert!(js[0].contains("window.c = 1;"));
        assert!(js[0].contains(r#"__lm["c.js"]"#));

        let off = OverlayConfig {
            mods: false,
            ..OverlayConfig::default()
        };
        assert!(!build_css(&off, "", &mods).contains(".a{}"));
        assert!(mod_scripts(&off, &mods).is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn theme_script_passes_normalized_accent_and_tint() {
        let config = OverlayConfig {
            accent_color: Some(" #ABC ".into()),
            tint: 0.9,
            border_tint: 3.0,
            ..OverlayConfig::default()
        };
        assert_eq!(
            theme_script(&config),
            r##"window.__leanTheme && window.__leanTheme.set({"accent":"#aabbcc","borderTint":1.0,"icons":true,"tint":0.4});"##
        );
        let off = OverlayConfig {
            accent_color: Some("red".into()),
            ..OverlayConfig::default()
        };
        assert!(theme_script(&off).contains(r#""accent":null"#));
    }

    #[test]
    fn copy_script_toggles_buttons() {
        assert_eq!(
            copy_script(&OverlayConfig::default()),
            r#"window.__leanCopy && window.__leanCopy.configure({"buttons":true});"#
        );
        let off = OverlayConfig {
            copy_buttons: false,
            ..OverlayConfig::default()
        };
        assert!(copy_script(&off).ends_with(r#"configure({"buttons":false});"#));
    }

    #[test]
    fn zoom_is_clamped() {
        let zoom = |z| {
            OverlayConfig {
                zoom: z,
                ..OverlayConfig::default()
            }
            .zoom()
        };
        assert_eq!(zoom(1.25), 1.25);
        assert_eq!(zoom(9.0), 2.0);
        assert_eq!(zoom(0.1), 0.5);
        assert_eq!(zoom(f64::NAN), 1.0);
    }

    #[test]
    fn first_run_writes_template() {
        let dir = std::env::temp_dir().join(format!("lean-teams-css-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        assert_eq!(load_user_css(&dir), CSS_TEMPLATE);
        assert_eq!(
            fs::read_to_string(dir.join(CSS_FILE)).unwrap(),
            CSS_TEMPLATE
        );
        fs::write(dir.join(CSS_FILE), ".mine{}").unwrap();
        assert_eq!(load_user_css(&dir), ".mine{}");
        let _ = fs::remove_dir_all(&dir);
    }
}

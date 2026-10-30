//! User-editable settings, stored as `config.json` in the app config directory.
//!
//! Every field has a default, so a missing or partial file is fine. Unknown
//! fields are ignored and a broken file falls back to defaults instead of
//! preventing the app from starting.

use serde::{Deserialize, Serialize};
use std::{fs, path::Path};

pub const FILE_NAME: &str = "config.json";

/// Teams for work/school. Personal accounts use `https://teams.live.com/v2/`.
pub const DEFAULT_URL: &str = "https://teams.microsoft.com/v2/";

/// A current desktop Chrome user agent. Teams refuses or degrades on browsers it
/// does not recognise, which is what WebKitGTK reports itself as on Linux.
pub const CHROME_UA: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Config {
    /// Page loaded on start and by "Home" in the tray menu.
    pub url: String,
    /// Overrides the webview user agent. `None` keeps the platform default,
    /// except on Linux where a Chrome UA is used (see [`CHROME_UA`]).
    pub user_agent: Option<String>,
    /// Windows only: tell WebView2 to trim memory while the window is hidden or
    /// minimized (`ICoreWebView2_19::MemoryUsageTargetLevel = Low`).
    pub low_memory_when_hidden: bool,
    /// Windows only: upper bound for the HTTP disk cache, in megabytes.
    /// `0` leaves the Chromium default.
    pub disk_cache_mb: u32,
    /// Windows only: cap the number of renderer processes. `0` leaves the
    /// Chromium default. Low values save RAM but can make heavy meetings
    /// stutter, because tabs/iframes then share a process.
    pub renderer_process_limit: u32,
    /// Windows only: extra Chromium switches appended verbatim.
    pub extra_browser_args: String,
    /// Forward web notifications to native OS notifications.
    pub native_notifications: bool,
    /// Closing the window hides it to the tray instead of quitting.
    pub close_to_tray: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            url: DEFAULT_URL.into(),
            user_agent: None,
            low_memory_when_hidden: true,
            disk_cache_mb: 256,
            renderer_process_limit: 0,
            extra_browser_args: String::new(),
            native_notifications: true,
            close_to_tray: true,
        }
    }
}

impl Config {
    /// Loads the config from `dir`, writing a default file on first run so the
    /// user has something to edit.
    pub fn load_or_init(dir: &Path) -> Self {
        let path = dir.join(FILE_NAME);
        match fs::read_to_string(&path) {
            Ok(text) => Self::parse(&text),
            Err(_) => {
                let config = Self::default();
                if fs::create_dir_all(dir).is_ok() {
                    if let Ok(json) = serde_json::to_string_pretty(&config) {
                        let _ = fs::write(&path, json);
                    }
                }
                config
            }
        }
    }

    pub fn parse(text: &str) -> Self {
        match serde_json::from_str(text) {
            Ok(config) => config,
            Err(err) => {
                eprintln!("lean-teams: ignoring invalid {FILE_NAME}: {err}");
                Self::default()
            }
        }
    }

    /// The URL to load, falling back to the default if the configured one is
    /// not an http(s) URL.
    pub fn start_url(&self) -> url::Url {
        match url::Url::parse(&self.url) {
            Ok(url) if matches!(url.scheme(), "https" | "http") => url,
            _ => url::Url::parse(DEFAULT_URL).expect("default url is valid"),
        }
    }

    pub fn effective_user_agent(&self) -> Option<String> {
        match &self.user_agent {
            Some(ua) if !ua.trim().is_empty() => Some(ua.clone()),
            _ if cfg!(target_os = "linux") => Some(CHROME_UA.into()),
            _ => None,
        }
    }

    /// Chromium switches passed to WebView2. Replaces wry's defaults, so those
    /// are repeated here.
    #[cfg_attr(not(windows), allow(dead_code))]
    pub fn browser_args(&self) -> String {
        let mut args =
            vec!["--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection".to_string()];
        if self.disk_cache_mb > 0 {
            args.push(format!(
                "--disk-cache-size={}",
                u64::from(self.disk_cache_mb) * 1024 * 1024
            ));
        }
        if self.renderer_process_limit > 0 {
            args.push(format!(
                "--renderer-process-limit={}",
                self.renderer_process_limit
            ));
        }
        let extra = self.extra_browser_args.trim();
        if !extra.is_empty() {
            args.push(extra.to_string());
        }
        args.join(" ")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn partial_file_keeps_other_defaults() {
        let c = Config::parse(r#"{ "disk_cache_mb": 64, "unknown": 1 }"#);
        assert_eq!(c.disk_cache_mb, 64);
        assert_eq!(c.url, DEFAULT_URL);
        assert!(c.close_to_tray);
    }

    #[test]
    fn broken_file_falls_back_to_defaults() {
        assert_eq!(Config::parse("{ not json"), Config::default());
    }

    #[test]
    fn non_http_start_url_is_rejected() {
        let c = Config {
            url: "file:///etc/passwd".into(),
            ..Config::default()
        };
        assert_eq!(c.start_url().as_str(), DEFAULT_URL);
        let c = Config {
            url: "https://teams.live.com/v2/".into(),
            ..Config::default()
        };
        assert_eq!(c.start_url().as_str(), "https://teams.live.com/v2/");
    }

    #[test]
    fn browser_args_keep_wry_defaults_and_add_limits() {
        let c = Config {
            disk_cache_mb: 100,
            renderer_process_limit: 2,
            extra_browser_args: " --foo ".into(),
            ..Config::default()
        };
        assert_eq!(
            c.browser_args(),
            "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection \
             --disk-cache-size=104857600 --renderer-process-limit=2 --foo"
        );
        let c = Config {
            disk_cache_mb: 0,
            ..Config::default()
        };
        assert_eq!(
            c.browser_args(),
            "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection"
        );
    }

    #[test]
    fn blank_user_agent_counts_as_unset() {
        let c = Config {
            user_agent: Some("  ".into()),
            ..Config::default()
        };
        assert_eq!(
            c.effective_user_agent().is_some(),
            cfg!(target_os = "linux")
        );
    }

    #[test]
    fn first_run_writes_default_file() {
        let dir = std::env::temp_dir().join(format!("lean-teams-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let c = Config::load_or_init(&dir);
        assert_eq!(c, Config::default());
        let written = fs::read_to_string(dir.join(FILE_NAME)).unwrap();
        assert_eq!(Config::parse(&written), Config::default());
        let _ = fs::remove_dir_all(&dir);
    }
}

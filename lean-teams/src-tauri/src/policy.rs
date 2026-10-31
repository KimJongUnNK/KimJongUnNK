//! Pure decision logic: which URLs stay inside the app, and how many unread
//! items the window title reports. Kept free of Tauri types so it is testable.

use url::Url;

/// Hosts that make up Teams and the Microsoft sign-in flow. Popups to these
/// stay inside the app (needed for SSO and some meeting dialogs); everything
/// else that Teams opens in a new window goes to the system browser.
const MICROSOFT_SUFFIXES: &[&str] = &[
    "microsoft.com",
    "microsoftonline.com",
    "cloud.microsoft",
    "live.com",
    "office.com",
    "office.net",
    "office365.com",
    "microsoft365.com",
    "skype.com",
    "msauth.net",
    "msftauth.net",
    "msauthimages.net",
    "msftauthimages.net",
    "sharepoint.com",
];

fn host_matches(host: &str, suffix: &str) -> bool {
    host == suffix
        || (host.len() > suffix.len()
            && host.ends_with(suffix)
            && host.as_bytes()[host.len() - suffix.len() - 1] == b'.')
}

pub fn is_microsoft_host(url: &Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    MICROSOFT_SUFFIXES.iter().any(|s| host_matches(&host, s))
}

#[derive(Debug, PartialEq, Eq)]
pub enum Route {
    /// Load inside the app.
    InApp,
    /// Hand to the OS (default browser, mail client, ...).
    External,
    /// Drop silently.
    Block,
}

/// Main-frame navigations. Anything http(s) stays in the app: corporate SSO
/// redirects through arbitrary identity providers (Okta, ADFS, ...), so an
/// allow-list here would break sign-in for many tenants.
pub fn route_navigation(url: &Url) -> Route {
    match url.scheme() {
        "https" | "http" | "about" | "blob" | "data" | "tauri" => Route::InApp,
        "mailto" | "tel" | "sip" | "sips" | "callto" => Route::External,
        _ => Route::Block,
    }
}

/// `window.open` / `target=_blank`. This is how Teams opens links from
/// chats, so non-Microsoft destinations go to the default browser.
pub fn route_new_window(url: &Url) -> Route {
    match url.scheme() {
        "about" | "blob" => Route::InApp,
        "https" | "http" if is_microsoft_host(url) => Route::InApp,
        "https" | "http" | "mailto" | "tel" | "sip" | "sips" | "callto" => Route::External,
        _ => Route::Block,
    }
}

/// Links handed over by the Linux link shim. They always leave the app, so
/// only schemes the OS can sensibly open are accepted.
pub fn route_link(url: &Url) -> Route {
    match url.scheme() {
        "https" | "http" | "mailto" | "tel" | "sip" | "sips" | "callto" => Route::External,
        _ => Route::Block,
    }
}

/// Teams prefixes the document title with the unread count, e.g.
/// `(3) Chat | Microsoft Teams`. Returns 0 when there is no such prefix.
pub fn unread_from_title(title: &str) -> u32 {
    let title = title.trim_start();
    let Some(rest) = title.strip_prefix('(') else {
        return 0;
    };
    let Some(end) = rest.find(')') else {
        return 0;
    };
    let digits: String = rest[..end].chars().filter(|c| c.is_ascii_digit()).collect();
    digits.parse().unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn microsoft_hosts_need_a_label_boundary() {
        assert!(is_microsoft_host(&u("https://login.microsoftonline.com/x")));
        assert!(is_microsoft_host(&u("https://teams.cloud.microsoft/")));
        assert!(is_microsoft_host(&u(
            "https://contoso.sharepoint.com/sites/a"
        )));
        assert!(is_microsoft_host(&u("https://MICROSOFT.COM./")));
        assert!(!is_microsoft_host(&u("https://evilmicrosoft.com/")));
        assert!(!is_microsoft_host(&u("https://microsoft.com.evil.io/")));
        assert!(!is_microsoft_host(&u("mailto:a@microsoft.com")));
    }

    #[test]
    fn navigation_keeps_web_and_externalises_protocols() {
        assert_eq!(
            route_navigation(&u("https://contoso.okta.com/sso")),
            Route::InApp
        );
        assert_eq!(route_navigation(&u("mailto:a@b.c")), Route::External);
        assert_eq!(route_navigation(&u("tel:+43123")), Route::External);
        assert_eq!(route_navigation(&u("file:///C:/x")), Route::Block);
        assert_eq!(route_navigation(&u("ms-settings:privacy")), Route::Block);
    }

    #[test]
    fn new_windows_leave_the_app_unless_microsoft() {
        assert_eq!(
            route_new_window(&u("https://login.microsoftonline.com/common/oauth2")),
            Route::InApp
        );
        assert_eq!(route_new_window(&u("https://github.com/")), Route::External);
        assert_eq!(route_new_window(&u("about:blank")), Route::InApp);
        assert_eq!(route_new_window(&u("javascript:alert(1)")), Route::Block);
        assert_eq!(route_new_window(&u("file:///etc/passwd")), Route::Block);
    }

    #[test]
    fn shim_links_only_open_safe_schemes() {
        assert_eq!(
            route_link(&u("https://contoso.sharepoint.com/x")),
            Route::External
        );
        assert_eq!(route_link(&u("mailto:a@b.c")), Route::External);
        assert_eq!(route_link(&u("about:blank")), Route::Block);
        assert_eq!(route_link(&u("file:///etc/passwd")), Route::Block);
        assert_eq!(route_link(&u("javascript:alert(1)")), Route::Block);
    }

    #[test]
    fn unread_count_parsing() {
        assert_eq!(unread_from_title("(3) Chat | Microsoft Teams"), 3);
        assert_eq!(
            unread_from_title("(1.234) Activity | Microsoft Teams"),
            1234
        );
        assert_eq!(unread_from_title("  (12) x"), 12);
        assert_eq!(unread_from_title("Chat | Microsoft Teams"), 0);
        assert_eq!(unread_from_title("(Meeting) Weekly"), 0);
        assert_eq!(unread_from_title("(5"), 0);
        assert_eq!(unread_from_title(""), 0);
    }
}

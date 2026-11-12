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

/// Hosts that serve the Teams web app itself.
const TEAMS_HOSTS: &[&str] = &[
    "teams.microsoft.com",
    "teams.cloud.microsoft",
    "teams.live.com",
];

pub fn is_teams_host(url: &Url) -> bool {
    url.host_str().is_some_and(|host| {
        let host = host.trim_end_matches('.').to_ascii_lowercase();
        TEAMS_HOSTS.contains(&host.as_str())
    })
}

/// Query parameters that only tell the launcher page how to start a desktop
/// client. They mean nothing to the web app, so they are dropped.
const LAUNCHER_PARAMS: &[&str] = &[
    "type",
    "directdl",
    "mslaunch",
    "enablemobilepage",
    "suppressprompt",
    "fqdn",
    "launchagent",
    "laexpid",
];

/// Teams links that go through the "open in the Teams app?" launcher:
/// meeting joins (`/l/meetup-join/…`, `/meet/<id>?p=…`), chat/channel/file
/// links (`/l/…`) and the launcher itself.
fn is_launcher_path(path: &str) -> bool {
    ["/l/", "/meet/", "/dl/launcher/"]
        .iter()
        .any(|prefix| path.starts_with(prefix))
}

/// The Teams web app's own route for deep links. The launcher's "Join on the
/// web instead" button opens `origin + "/_#" + <link path>`.
const WEB_ROUTE: &str = "/_#";

/// Where a Teams deep link should open inside the main window, if `url` is
/// one. Lean Teams is the "desktop app" these links want to start, so they
/// go straight to the route the launcher's "Join on the web" button opens:
///
/// * `https://teams.microsoft.com/meet/<id>?p=…` and `/l/meetup-join/…`
///   → `https://teams.microsoft.com/_#/meet/<id>?p=…&anon=true`
/// * the launcher page itself (`/dl/launcher/launcher.html?url=/_#/…`)
///   → `https://teams.microsoft.com/_#/…`
/// * `msteams:/meet/…?…&fqdn=teams.microsoft.com`, which the launcher hands
///   to the OS to start the desktop client → `https://<fqdn>/_#/meet/…?…`
/// * other `/l/…` links (chats, channels, files) load in the main window and
///   take Teams' own route from there.
pub fn teams_web_link(url: &Url) -> Option<Url> {
    match url.scheme() {
        "https" if is_teams_host(url) && is_launcher_path(url.path()) => {
            Some(launcher_to_web(url).unwrap_or_else(|| url.clone()))
        }
        "msteams" => msteams_to_web(url),
        _ => None,
    }
}

fn launcher_to_web(url: &Url) -> Option<Url> {
    let origin = url.origin().ascii_serialization();
    let path = url.path();
    if path.starts_with("/dl/launcher/") {
        let (_, target) = url.query_pairs().find(|(k, _)| k == "url")?;
        if !target.starts_with("/_#/") {
            return None;
        }
        return Url::parse(&format!("{origin}{target}")).ok();
    }
    if !(path.starts_with("/meet/") || path.starts_with("/l/meetup-join/")) {
        return None;
    }
    let mut web = format!("{origin}{WEB_ROUTE}{path}");
    let query = url.query().unwrap_or("");
    let has_anon = query
        .split('&')
        .any(|pair| pair.split('=').next() == Some("anon"));
    let sep = if query.is_empty() { "?" } else { "&" };
    if !query.is_empty() {
        web.push('?');
        web.push_str(query);
    }
    if !has_anon {
        web.push_str(sep);
        web.push_str("anon=true");
    }
    Url::parse(&web).ok()
}

fn msteams_to_web(url: &Url) -> Option<Url> {
    let path = url.path();
    if !path.starts_with('/') || path.len() < 2 || path.starts_with("//") {
        return None;
    }
    // The launcher names the Teams host in `fqdn`; never trust it beyond the
    // Teams hosts, or a crafted link could load any site in the app window.
    let fqdn = url
        .query_pairs()
        .filter(|(k, _)| k.eq_ignore_ascii_case("fqdn"))
        .map(|(_, v)| v.into_owned())
        .chain(url.host_str().map(str::to_string))
        .filter_map(|host| Url::parse(&format!("https://{host}/")).ok())
        .find(is_teams_host)
        .and_then(|probe| probe.host_str().map(str::to_string))
        .unwrap_or_else(|| "teams.microsoft.com".to_string());
    let query: Vec<&str> = url
        .query()
        .unwrap_or("")
        .split('&')
        .filter(|pair| {
            let key = pair.split('=').next().unwrap_or("");
            !key.is_empty() && !LAUNCHER_PARAMS.contains(&key.to_ascii_lowercase().as_str())
        })
        .collect();
    let mut web = format!("https://{fqdn}{WEB_ROUTE}{path}");
    if !query.is_empty() {
        web.push('?');
        web.push_str(&query.join("&"));
    }
    Url::parse(&web).ok()
}

#[derive(Debug, PartialEq, Eq)]
pub enum Route {
    /// Load inside the app.
    InApp,
    /// Teams deep link: load this URL in the main window instead.
    Redirect(Url),
    /// Hand to the OS (default browser, mail client, ...).
    External,
    /// Drop silently.
    Block,
}

/// Main-frame navigations. Anything http(s) stays in the app: corporate SSO
/// redirects through arbitrary identity providers (Okta, ADFS, ...), so an
/// allow-list here would break sign-in for many tenants.
pub fn route_navigation(url: &Url) -> Route {
    if let Some(target) = teams_web_link(url) {
        if &target != url {
            return Route::Redirect(target);
        }
    }
    match url.scheme() {
        "https" | "http" | "about" | "blob" | "data" | "tauri" => Route::InApp,
        "mailto" | "tel" | "sip" | "sips" | "callto" => Route::External,
        _ => Route::Block,
    }
}

/// `window.open` / `target=_blank`. This is how Teams opens links from
/// chats, so non-Microsoft destinations go to the default browser.
pub fn route_new_window(url: &Url) -> Route {
    if let Some(target) = teams_web_link(url) {
        return Route::Redirect(target);
    }
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
    if let Some(target) = teams_web_link(url) {
        return Route::Redirect(target);
    }
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

    fn web(s: &str) -> Option<String> {
        teams_web_link(&u(s)).map(|url| url.to_string())
    }

    #[test]
    fn msteams_meeting_link_becomes_web_join() {
        // The exact hand-off from the macOS "no app for this URL" dialog.
        assert_eq!(
            web(
                "msteams:/meet/3795496914773113?p=ngGOcid8TG90DUrDmZ&anon=true\
                 &deeplinkId=c0ffee&type=meet&directDl=true&msLaunch=true\
                 &enableMobilePage=true&suppressPrompt=true&fqdn=teams.microsoft.com"
            )
            .as_deref(),
            Some(
                "https://teams.microsoft.com/_#/meet/3795496914773113\
                 ?p=ngGOcid8TG90DUrDmZ&anon=true&deeplinkId=c0ffee"
            )
        );
        assert_eq!(
            web("msteams:/l/meetup-join/19%3ameeting_abc%40thread.v2/0\
                 ?context=%7b%22Tid%22%3a%22t%22%7d&launchAgent=join_launcher")
            .as_deref(),
            Some(
                "https://teams.microsoft.com/_#/l/meetup-join/19%3ameeting_abc%40thread.v2/0\
                 ?context=%7b%22Tid%22%3a%22t%22%7d"
            )
        );
    }

    #[test]
    fn msteams_host_is_limited_to_teams() {
        assert_eq!(
            web("msteams:/meet/1?p=x&fqdn=teams.live.com").as_deref(),
            Some("https://teams.live.com/_#/meet/1?p=x")
        );
        assert_eq!(
            web("msteams://teams.cloud.microsoft/l/chat/0/0?users=a").as_deref(),
            Some("https://teams.cloud.microsoft/_#/l/chat/0/0?users=a")
        );
        // A crafted fqdn must not load another site in the app window.
        assert_eq!(
            web("msteams:/meet/1?fqdn=evil.example%2Fx%3F").as_deref(),
            Some("https://teams.microsoft.com/_#/meet/1")
        );
        assert_eq!(
            web("msteams://evil.example/meet/1").as_deref(),
            Some("https://teams.microsoft.com/_#/meet/1")
        );
        assert_eq!(web("msteams:/"), None);
        assert_eq!(web("msteams:x"), None);
    }

    #[test]
    fn https_meeting_links_skip_the_launcher() {
        assert_eq!(
            web("https://teams.microsoft.com/meet/123?p=abc").as_deref(),
            Some("https://teams.microsoft.com/_#/meet/123?p=abc&anon=true")
        );
        assert_eq!(
            web("https://teams.microsoft.com/meet/123").as_deref(),
            Some("https://teams.microsoft.com/_#/meet/123?anon=true")
        );
        assert_eq!(
            web("https://teams.microsoft.com/l/meetup-join/19%3ameeting_x%40thread.v2/0?context=c&anon=true")
                .as_deref(),
            Some("https://teams.microsoft.com/_#/l/meetup-join/19%3ameeting_x%40thread.v2/0?context=c&anon=true")
        );
        // The redirect Teams itself answers /meet/<id> with (seen live).
        assert_eq!(
            web("https://teams.microsoft.com/dl/launcher/launcher.html\
                 ?url=%2F_%23%2Fmeet%2F123456789%3Fp%3Dabc%26anon%3Dtrue&type=meet\
                 &deeplinkId=d&directDl=true&msLaunch=true&enableMobilePage=true")
            .as_deref(),
            Some("https://teams.microsoft.com/_#/meet/123456789?p=abc&anon=true")
        );
        // The launcher never sends the app to another site.
        assert_eq!(
            web("https://teams.microsoft.com/dl/launcher/launcher.html?url=%2F%2Fevil.example%2F")
                .as_deref(),
            Some("https://teams.microsoft.com/dl/launcher/launcher.html?url=%2F%2Fevil.example%2F")
        );
        // Chat links keep Teams' own routing, in the main window.
        assert_eq!(
            web("https://teams.microsoft.com/l/chat/0/0?users=a").as_deref(),
            Some("https://teams.microsoft.com/l/chat/0/0?users=a")
        );
        assert_eq!(web("https://teams.microsoft.com/v2/"), None);
        assert_eq!(web("https://evil.example/meet/1"), None);
    }

    #[test]
    fn meeting_links_never_open_in_a_bare_popup() {
        let join = "https://teams.microsoft.com/meet/123?p=abc";
        let web_join = u("https://teams.microsoft.com/_#/meet/123?p=abc&anon=true");
        assert_eq!(
            route_new_window(&u(join)),
            Route::Redirect(web_join.clone())
        );
        assert_eq!(route_link(&u(join)), Route::Redirect(web_join));
        assert!(matches!(
            route_new_window(&u("msteams:/meet/1?p=x")),
            Route::Redirect(_)
        ));
        assert!(matches!(
            route_navigation(&u("msteams:/meet/1?p=x")),
            Route::Redirect(_)
        ));
        assert_eq!(route_navigation(&u("msteams:")), Route::Block);
        assert_eq!(
            route_navigation(&u(join)),
            Route::Redirect(u("https://teams.microsoft.com/_#/meet/123?p=abc&anon=true"))
        );
        let chat = "https://teams.microsoft.com/l/chat/0/0?users=a";
        assert_eq!(route_navigation(&u(chat)), Route::InApp);
        // Ordinary Teams pages and sign-in popups are unaffected.
        assert_eq!(
            route_navigation(&u("https://teams.microsoft.com/v2/")),
            Route::InApp
        );
        assert_eq!(
            route_new_window(&u("https://teams.microsoft.com/v2/")),
            Route::InApp
        );
        assert_eq!(
            route_new_window(&u("https://evil.example/meet/1")),
            Route::External
        );
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

// Small "LT" button in the Teams page that opens the overlay menu window.
// Shadow DOM + constructable stylesheet + no innerHTML, so Teams' CSS, CSP
// and Trusted Types leave it alone. Only shown where the overlay commands are
// allowed (the Teams origins), never on sign-in pages.
(function () {
  "use strict";
  if (window.top !== window || window.__leanButton) return;

  var STYLE =
    ":host { all: initial; }" +
    "button { position: fixed; left: 10px; bottom: 10px; z-index: 2147483646; width: 28px; height: 28px;" +
    "  border-radius: 8px; border: 0; padding: 0; cursor: pointer; background: #0e0e10; color: #fff;" +
    "  font: 800 11px/28px system-ui, -apple-system, 'Segoe UI', sans-serif; letter-spacing: -0.5px;" +
    "  box-shadow: 0 0 0 2px #c4ff00 inset; opacity: .35; transform: scale(1);" +
    "  transition: opacity .18s ease, transform .18s ease; }" +
    "button:hover { opacity: 1; transform: scale(1.08); }" +
    "button:active { transform: scale(.94); }";

  var host = null, button = null, visible = false;

  function ipc() {
    var t = window.__TAURI_INTERNALS__;
    return t && typeof t.invoke === "function" ? t : null;
  }

  function mount() {
    if (host && host.isConnected) return;
    host = document.createElement("lean-teams-button");
    var root = host.attachShadow({ mode: "open" });
    try {
      var sheet = new CSSStyleSheet();
      sheet.replaceSync(STYLE);
      root.adoptedStyleSheets = [sheet];
    } catch (e) {
      var style = document.createElement("style");
      style.textContent = STYLE;
      root.appendChild(style);
    }
    button = document.createElement("button");
    button.textContent = "LT";
    button.title = "Lean Teams Overlay (Strg/⌘+Shift+L)";
    button.addEventListener("click", function () {
      var t = ipc();
      if (t) t.invoke("overlay_menu_toggle").catch(function () {});
    });
    root.appendChild(button);
    (document.body || document.documentElement).appendChild(host);
  }

  function render() {
    if (visible) mount();
    if (button) button.style.display = visible ? "block" : "none";
  }

  function boot() {
    var t = ipc();
    if (!t) return;
    t.invoke("overlay_button_visible").then(function (show) {
      visible = !!show;
      render();
    }, function () {});
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.__leanButton = { set: function (show) { visible = !!show; render(); } };
})();

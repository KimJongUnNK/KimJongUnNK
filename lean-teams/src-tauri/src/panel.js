// Lean Teams overlay menu: a settings panel inside the Teams page.
// Open with Ctrl/Cmd+Shift+L, the small "LT" button or the tray menu.
//
// Built for a hostile page: everything lives in a shadow root so Teams' CSS
// cannot reach it, the DOM is created with createElement/textContent only
// (Teams may enforce Trusted Types, which rejects innerHTML) and styles use
// constructable stylesheets (not blocked by a strict style-src CSP).
(function () {
  "use strict";
  if (window.top !== window || window.__leanPanel) return;

  var STYLE = [
    ":host { all: initial; }",
    "* { box-sizing: border-box; font-family: -apple-system, 'Segoe UI', system-ui, sans-serif; }",
    ".fab { position: fixed; left: 10px; bottom: 10px; z-index: 2147483646; width: 28px; height: 28px;",
    "  border-radius: 8px; border: 0; background: #0e0e10; color: #fff; font: 800 11px/28px system-ui, sans-serif;",
    "  letter-spacing: -0.5px; cursor: pointer; opacity: 0.35; box-shadow: 0 0 0 2px #c4ff00 inset; padding: 0; }",
    ".fab:hover { opacity: 1; }",
    ".panel { position: fixed; top: 56px; right: 16px; z-index: 2147483647; width: 360px; max-height: calc(100vh - 80px);",
    "  overflow: auto; background: #0e0e10; color: #f2f2f2; border-radius: 14px; padding: 18px;",
    "  box-shadow: 0 18px 50px rgba(0,0,0,.45), 0 0 0 1px #2a2a2e; font-size: 13px; }",
    ".title { font-weight: 900; font-size: 18px; letter-spacing: -0.3px; margin: 0 0 2px; }",
    ".title span { color: #c4ff00; }",
    ".sub { color: #8a8a90; font-size: 11px; margin-bottom: 14px; }",
    "h3 { font-size: 10px; text-transform: uppercase; letter-spacing: 1.2px; color: #8a8a90; margin: 16px 0 8px; font-weight: 700; }",
    ".row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 7px 0;",
    "  border-bottom: 1px solid #1d1d21; }",
    ".row label { flex: 1; cursor: pointer; }",
    ".hint { color: #8a8a90; font-size: 11px; }",
    "input[type=checkbox] { appearance: none; width: 34px; height: 20px; border-radius: 10px; background: #2a2a2e;",
    "  position: relative; cursor: pointer; flex: none; margin: 0; transition: background .15s; }",
    "input[type=checkbox]::after { content: ''; position: absolute; top: 3px; left: 3px; width: 14px; height: 14px;",
    "  border-radius: 50%; background: #8a8a90; transition: all .15s; }",
    "input[type=checkbox]:checked { background: #c4ff00; }",
    "input[type=checkbox]:checked::after { left: 17px; background: #0e0e10; }",
    "input[type=color] { width: 34px; height: 24px; border: 0; padding: 0; background: none; cursor: pointer; }",
    "input[type=range] { width: 140px; accent-color: #c4ff00; }",
    ".badge { font-size: 9px; font-weight: 800; padding: 2px 5px; border-radius: 4px; background: #2a2a2e; color: #c4ff00; margin-left: 6px; }",
    "textarea { width: 100%; min-height: 140px; resize: vertical; background: #17171a; color: #e8e8e8; border: 1px solid #2a2a2e;",
    "  border-radius: 8px; padding: 8px; font: 12px/1.45 ui-monospace, Menlo, Consolas, monospace; }",
    ".actions { display: flex; gap: 8px; margin-top: 16px; flex-wrap: wrap; }",
    "button.btn { border: 0; border-radius: 8px; padding: 8px 12px; font-weight: 700; font-size: 12px; cursor: pointer;",
    "  background: #2a2a2e; color: #f2f2f2; }",
    "button.btn:hover { background: #36363b; }",
    "button.primary { background: #c4ff00; color: #0e0e10; margin-left: auto; }",
    "button.primary:hover { background: #d4ff40; }",
    ".status { margin-top: 10px; font-size: 11px; min-height: 14px; color: #8a8a90; }",
    ".status.err { color: #ff6b6b; }",
    ".empty { color: #8a8a90; font-size: 12px; padding: 6px 0; }"
  ].join("\n");

  var host, root, panel, fab, statusEl, state = null, controls = {};

  function ipc() {
    var t = window.__TAURI_INTERNALS__;
    return t && typeof t.invoke === "function" ? t : null;
  }

  function call(cmd, args) {
    var t = ipc();
    if (!t) return Promise.reject(new Error("Lean Teams IPC not available on this page"));
    return t.invoke(cmd, args || {});
  }

  function el(tag, props, children) {
    var node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        if (k === "text") node.textContent = props[k];
        else if (k === "className") node.className = props[k];
        else if (k.indexOf("on") === 0) node.addEventListener(k.slice(2), props[k]);
        else node.setAttribute(k, props[k]);
      });
    }
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  function adoptStyle(shadow) {
    try {
      var sheet = new CSSStyleSheet();
      sheet.replaceSync(STYLE);
      shadow.adoptedStyleSheets = [sheet];
    } catch (e) {
      shadow.appendChild(el("style", { text: STYLE }));
    }
  }

  function ensureHost() {
    if (host && host.isConnected) return;
    host = document.createElement("lean-teams-overlay");
    root = host.attachShadow({ mode: "open" });
    adoptStyle(root);
    (document.body || document.documentElement).appendChild(host);
    fab = el("button", { className: "fab", title: "Lean Teams Overlay (Strg/⌘+Shift+L)", text: "LT", onclick: toggle });
    root.appendChild(fab);
    setButton(window.__leanPanelButton !== false);
  }

  function setButton(visible) {
    if (fab) fab.style.display = visible ? "block" : "none";
  }

  function setStatus(text, isError) {
    if (!statusEl) return;
    statusEl.textContent = text || "";
    statusEl.className = "status" + (isError ? " err" : "");
  }

  function toggleRow(id, label, checked, hint) {
    var input = el("input", { type: "checkbox", id: id });
    input.checked = !!checked;
    controls[id] = input;
    var text = el("label", { for: id }, [
      document.createTextNode(label),
      hint ? el("div", { className: "hint", text: hint }) : null
    ]);
    return el("div", { className: "row" }, [text, input]);
  }

  function render() {
    var s = state.settings;
    controls = {};
    if (panel) panel.remove();

    var accentOn = el("input", { type: "checkbox", id: "accentOn" });
    accentOn.checked = !!s.accent_color;
    var accent = el("input", { type: "color", id: "accent" });
    accent.value = /^#[0-9a-fA-F]{6}$/.test(s.accent_color || "") ? s.accent_color : "#c4ff00";
    controls.accentOn = accentOn;
    controls.accent = accent;

    var zoomValue = el("span", { className: "hint", text: Math.round(s.zoom * 100) + " %" });
    var zoom = el("input", { type: "range", min: "50", max: "200", step: "5", id: "zoom" });
    zoom.value = String(Math.round(s.zoom * 100));
    zoom.addEventListener("input", function () { zoomValue.textContent = zoom.value + " %"; });
    controls.zoom = zoom;

    var css = el("textarea", { spellcheck: "false" });
    css.value = state.custom_css;
    controls.css = css;

    var modRows = state.mods.length ? state.mods.map(function (m) {
      var input = el("input", { type: "checkbox" });
      input.checked = m.enabled;
      input.addEventListener("change", function () {
        setStatus(m.kind === "js" ? "Mod wird umgeschaltet – Teams lädt kurz neu…" : "Mod wird umgeschaltet…");
        call("overlay_toggle_mod", { file: m.file, enabled: input.checked })
          .then(load)
          .catch(function (e) { input.checked = !input.checked; setStatus(String(e), true); });
      });
      return el("div", { className: "row" }, [
        el("label", {}, [document.createTextNode(m.name), el("span", { className: "badge", text: m.kind.toUpperCase() })]),
        input
      ]);
    }) : [el("div", { className: "empty", text: "Noch keine Mods. Lege .css- oder .js-Dateien in den Ordner." })];

    statusEl = el("div", { className: "status" });

    panel = el("div", { className: "panel", role: "dialog", "aria-label": "Lean Teams Overlay" }, [
      el("div", { className: "title" }, [document.createTextNode("Lean Teams "), el("span", { text: "Overlay" })]),
      el("div", { className: "sub", text: "Strg/⌘+Shift+L · Esc schließt" }),

      el("h3", { text: "Look" }),
      el("div", { className: "row" }, [el("label", { for: "accentOn", text: "Eigene Akzentfarbe" }), accent, accentOn]),
      el("div", { className: "row" }, [el("label", { for: "zoom", text: "Zoom" }), zoomValue, zoom]),
      toggleRow("privacy_blur", "Privacy-Blur", s.privacy_blur, "Fenster unscharf, wenn es nicht im Fokus ist"),
      toggleRow("always_on_top", "Immer im Vordergrund", s.always_on_top),
      toggleRow("panel_button", "LT-Knopf anzeigen", s.panel_button, "Kürzel und Tray-Menü gehen immer"),

      el("h3", { text: "Mods" }),
      toggleRow("mods", "Mods laden", s.mods, "Alle .css/.js-Dateien im mods-Ordner"),
    ].concat(modRows).concat([
      el("div", { className: "actions" }, [
        el("button", { className: "btn", text: "Ordner öffnen", onclick: function () {
          call("overlay_open_folder").catch(function (e) { setStatus(String(e), true); });
        } })
      ]),

      el("h3", { text: "Eigenes CSS" }),
      toggleRow("custom_css", "custom.css anwenden", s.custom_css),
      css,

      el("div", { className: "actions" }, [
        el("button", { className: "btn", text: "Entwicklertools", onclick: function () {
          call("overlay_devtools").catch(function (e) { setStatus(String(e), true); });
        } }),
        el("button", { className: "btn", text: "Schließen", onclick: close }),
        el("button", { className: "btn primary", text: "Speichern & anwenden", onclick: save })
      ]),
      statusEl
    ]));
    root.appendChild(panel);
  }

  function collect() {
    return {
      accent_color: controls.accentOn.checked ? controls.accent.value : null,
      zoom: Number(controls.zoom.value) / 100,
      privacy_blur: controls.privacy_blur.checked,
      custom_css: controls.custom_css.checked,
      mods: controls.mods.checked,
      always_on_top: controls.always_on_top.checked,
      panel_button: controls.panel_button.checked
    };
  }

  function save() {
    var settings = collect();
    setStatus("Speichere…");
    call("overlay_save", { settings: settings, customCss: controls.css.value })
      .then(function () {
        setButton(settings.panel_button);
        state.settings = settings;
        state.custom_css = controls.css.value;
        setStatus("Gespeichert und angewendet.");
      })
      .catch(function (e) { setStatus(String(e), true); });
  }

  function load() {
    return call("overlay_state").then(function (s) {
      state = s;
      render();
    });
  }

  function open() {
    if (!allowed) return;
    ensureHost();
    load().catch(function (e) {
      state = { settings: {}, custom_css: "", mods: [] };
      console.error("[Lean Teams] overlay menu:", e);
    });
  }

  function close() {
    if (panel) { panel.remove(); panel = null; }
  }

  function toggle() {
    if (panel && panel.isConnected) close(); else open();
  }

  window.addEventListener("keydown", function (e) {
    var key = (e.key || "").toLowerCase();
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && key === "l") {
      e.preventDefault();
      e.stopPropagation();
      toggle();
    } else if (key === "escape" && panel && panel.isConnected) {
      close();
    }
  }, true);

  // Only pages that are allowed to use the overlay commands (the Teams
  // origins in capabilities/teams.json) get the button; sign-in pages and
  // anything else stay untouched.
  var allowed = false;
  function boot() {
    if (!ipc()) return;
    call("overlay_state").then(function (s) {
      allowed = true;
      ensureHost();
      setButton(s.settings.panel_button !== false);
    }, function () {});
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.__leanPanel = { open: open, close: close, toggle: toggle };
})();

// Overlay menu window logic (loaded from panel.html).
//
// Everything lives in a function scope: on Linux the webview defines a
// global `ipc`, and a top-level const/let with a clashing name makes the
// whole script fail to load without any visible error.
(function () {
"use strict";
window.addEventListener("error", (e) => status(e.message, "err"));
window.addEventListener("unhandledrejection", (e) => status(String(e.reason), "err"));
const PRESETS = ["#c4ff00", "#0a84ff", "#30d158", "#ff9f0a", "#ff375f", "#bf5af2", "#64d2ff", "#ffd60a", "#ffffff"];
const tauri = window.__TAURI_INTERNALS__;
const $ = (id) => document.getElementById(id);
let state = null, frame = 0, saveTimer = 0;

function el(tag, props = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "text") n.textContent = v;
    else if (k === "className") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  children.forEach((c) => c && n.appendChild(c));
  return n;
}

function status(text, kind) {
  $("status").textContent = text;
  $("dot").className = "dot" + (kind ? " " + kind : "");
}

// Live preview on every change (one IPC call per frame), save to disk once
// the user stops for a moment.
function changed() {
  document.documentElement.style.setProperty("--accent", state.settings.accent_color || "#c4ff00");
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => push(false));
  clearTimeout(saveTimer);
  status("…");
  saveTimer = setTimeout(() => push(true), 450);
}

function push(persist) {
  tauri.invoke("overlay_update", { settings: state.settings, customCss: state.custom_css, persist })
    .then(() => { if (persist) status("Gespeichert", "saved"); })
    .catch((e) => status(String(e), "err"));
}

function toggle(key, label, hint) {
  const input = el("input", { type: "checkbox", id: key });
  input.checked = !!state.settings[key];
  input.addEventListener("change", () => { state.settings[key] = input.checked; changed(); });
  return el("div", { className: "row" }, [
    el("label", { for: key }, [document.createTextNode(label), hint ? el("div", { className: "hint", text: hint }) : null]),
    input,
  ]);
}

function slider(key, label, min, max, step, format) {
  const val = el("span", { className: "val" });
  const input = el("input", { type: "range", min, max, step });
  const show = () => { val.textContent = format(state.settings[key]); };
  input.value = String(state.settings[key]);
  show();
  input.addEventListener("input", () => { state.settings[key] = Number(input.value); show(); changed(); });
  return el("div", { className: "row" }, [el("label", { text: label }), val, input]);
}

function swatches() {
  const box = el("div", { className: "swatches" });
  const current = (state.settings.accent_color || "").toLowerCase();
  const pick = (color) => { state.settings.accent_color = color; changed(); render(); };
  box.appendChild(el("button", { className: "sw off" + (current ? "" : " on"), title: "Teams-Standard", onclick: () => pick(null) }));
  PRESETS.forEach((c) => {
    const b = el("button", { className: "sw" + (current === c ? " on" : ""), title: c, onclick: () => pick(c) });
    b.style.background = c;
    box.appendChild(b);
  });
  const custom = el("input", { type: "color" });
  custom.value = /^#[0-9a-f]{6}$/.test(current) ? current : "#c4ff00";
  custom.addEventListener("input", () => { state.settings.accent_color = custom.value; changed(); });
  custom.addEventListener("change", render);
  const isCustom = current && !PRESETS.includes(current);
  const wrap = el("label", { className: "sw custom" + (isCustom ? " on" : ""), title: "Eigene Farbe" }, [custom]);
  if (isCustom) wrap.style.background = current;
  box.appendChild(wrap);
  return box;
}

function mods() {
  if (!state.mods.length) return [el("div", { className: "empty", text: "Keine Mods. Lege .css- oder .js-Dateien in den mods-Ordner." })];
  return state.mods.map((m) => {
    const input = el("input", { type: "checkbox" });
    input.checked = m.enabled;
    input.addEventListener("change", () => {
      status(m.kind === "js" ? "JS-Mod umgeschaltet – Teams lädt kurz neu" : "Mod umgeschaltet");
      tauri.invoke("overlay_toggle_mod", { file: m.file, enabled: input.checked })
        .then(load)
        .catch((e) => { input.checked = !input.checked; status(String(e), "err"); });
    });
    return el("div", { className: "row" }, [
      el("label", {}, [document.createTextNode(m.name), el("span", { className: "badge", text: m.kind.toUpperCase() })]),
      input,
    ]);
  });
}

function render() {
  const main = $("main");
  const scroll = main.scrollTop;
  main.replaceChildren();
  const css = el("textarea", { spellcheck: "false", placeholder: "/* eigenes CSS – wirkt sofort */" });
  css.value = state.custom_css;
  css.addEventListener("input", () => { state.custom_css = css.value; changed(); });

  [
    el("h3", { text: "Akzentfarbe" }),
    swatches(),
    slider("border_tint", "Ränder & Linien", 0, 1, 0.05, (v) => Math.round(v * 100) + " %"),
    slider("tint", "Hintergründe", 0, 0.4, 0.02, (v) => Math.round(v * 100) + " %"),
    el("h3", { text: "Fenster" }),
    slider("zoom", "Zoom", 0.5, 2, 0.05, (v) => Math.round(v * 100) + " %"),
    toggle("privacy_blur", "Privacy-Blur", "Teams unscharf, wenn das Fenster nicht im Fokus ist"),
    toggle("always_on_top", "Immer im Vordergrund"),
    toggle("panel_button", "LT-Knopf in Teams", "Strg/⌘+Shift+L und Tray gehen immer"),
    el("h3", { text: "Mods" }),
    toggle("mods", "Mods laden", "Alle .css/.js-Dateien im mods-Ordner"),
    ...mods(),
    el("h3", { text: "Eigenes CSS" }),
    toggle("custom_css", "custom.css anwenden"),
    css,
    el("div", { className: "actions" }, [
      el("button", { className: "btn", text: "Ordner öffnen", onclick: () => tauri.invoke("overlay_open_folder").catch((e) => status(String(e), "err")) }),
      el("button", { className: "btn", text: "Entwicklertools", onclick: () => tauri.invoke("overlay_devtools").catch((e) => status(String(e), "err")) }),
    ]),
  ].forEach((n) => main.appendChild(n));
  main.scrollTop = scroll;
  document.documentElement.style.setProperty("--accent", state.settings.accent_color || "#c4ff00");
}

function load() {
  return tauri.invoke("overlay_state").then((s) => { state = s; render(); });
}

function hide() { tauri.invoke("overlay_menu_toggle").catch(() => {}); }
$("close").addEventListener("click", hide);
window.addEventListener("keydown", (e) => {
  const key = (e.key || "").toLowerCase();
  if (key === "escape" || ((e.ctrlKey || e.metaKey) && e.shiftKey && key === "l")) { e.preventDefault(); hide(); }
});
load().catch((e) => status(String(e), "err"));
window.leanPanel = { load };
})();

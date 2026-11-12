// "KI-Kopie": copy the open assignment as text, or a screenshot of it, to
// the clipboard with one click, ready to paste into an AI chat.
//
// Runs in every frame. Teams shows assignments in a cross-origin iframe
// (the Assignments app), which the top page cannot read. So the top page asks
// the biggest visible frame for its text via postMessage, that frame asks its
// own biggest frame, and every frame on the way answers with its text and
// depth. The deepest non-empty answer wins; a text selection beats
// everything.
//
// The top frame adds two small buttons at the right window edge (unless
// disabled in config.json) and window.__leanCopy for the tray menu.
(function () {
  "use strict";
  if (window.__leanCopyFrame) return;
  window.__leanCopyFrame = true;

  var REQ = "__leanCopyReq", RES = "__leanCopyRes";
  var BIG_FRAME_SHARE = 0.25, WAIT_MS = 700, MAX_DEPTH = 6;

  function visibleArea(el) {
    var r = el.getBoundingClientRect();
    var w = Math.max(0, Math.min(r.right, window.innerWidth) - Math.max(r.left, 0));
    var h = Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0));
    return w * h;
  }

  function biggestFrame() {
    var frames = document.querySelectorAll("iframe, frame"), best = null, bestArea = 0;
    var min = window.innerWidth * window.innerHeight * BIG_FRAME_SHARE;
    for (var i = 0; i < frames.length; i++) {
      var area = visibleArea(frames[i]);
      if (area > bestArea && area >= min) { best = frames[i]; bestArea = area; }
    }
    return best;
  }

  function cleanText(text) {
    return String(text || "")
      .replace(/ /g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function ownText() {
    var selection = window.getSelection ? cleanText(window.getSelection()) : "";
    if (selection) return { text: selection, selection: true };
    var root = document.querySelector('main, [role="main"]') || document.body;
    return { text: cleanText(root && root.innerText), selection: false };
  }

  // Answer the top frame, then pass the question on to our biggest frame.
  function answer(id, depth) {
    var own = ownText();
    try {
      window.top.postMessage({ __leanCopyRes: { id: id, depth: depth, text: own.text, selection: own.selection } }, "*");
    } catch (e) {}
    var frame = depth < MAX_DEPTH && biggestFrame();
    if (frame && frame.contentWindow) {
      try { frame.contentWindow.postMessage({ __leanCopyReq: { id: id, depth: depth + 1 } }, "*"); } catch (e) {}
    }
  }

  window.addEventListener("message", function (event) {
    var req = event.data && event.data[REQ];
    if (!req || event.source !== window.parent || window.top === window) return;
    answer(String(req.id), Number(req.depth) || 1);
  });

  if (window.top !== window) return;

  // ---- top frame ----------------------------------------------------------
  var pending = {};

  window.addEventListener("message", function (event) {
    var res = event.data && event.data[RES];
    if (!res || !pending[res.id]) return;
    pending[res.id].push(res);
  });

  // Picks the text to copy from all answers.
  function pick(answers) {
    var best = null;
    for (var i = 0; i < answers.length; i++) {
      var a = answers[i];
      if (!a.text) continue;
      if (a.selection) return a.text;
      if (!best || a.depth > best.depth) best = a;
    }
    return best ? best.text : "";
  }

  function collectText(done) {
    var id = Math.random().toString(36).slice(2);
    pending[id] = [];
    answer(id, 0);
    setTimeout(function () {
      var text = pick(pending[id]);
      delete pending[id];
      done(text);
    }, WAIT_MS);
  }

  function invoke(cmd, args) {
    var ipc = window.__TAURI_INTERNALS__;
    if (!ipc || typeof ipc.invoke !== "function") return Promise.reject(new Error("IPC fehlt"));
    return ipc.invoke(cmd, args || {});
  }

  // ---- toast & buttons (shadow DOM, so Teams' CSS cannot touch them) -------
  var host = null, root = null, toastTimer = 0;

  var CSS =
    ":host{all:initial}" +
    ".dock{position:fixed;right:0;top:42%;z-index:2147483646;display:flex;flex-direction:column;gap:2px;" +
    "padding:4px 3px;border-radius:10px 0 0 10px;background:rgba(20,20,22,.72);opacity:.45;transition:opacity .15s}" +
    ".dock:hover{opacity:1}" +
    "button{all:unset;width:26px;height:26px;display:grid;place-items:center;border-radius:7px;cursor:pointer;color:#fff}" +
    "button:hover{background:rgba(255,255,255,.16)}" +
    "svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}" +
    ".toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483647;max-width:70vw;" +
    "padding:9px 14px;border-radius:10px;background:rgba(20,20,22,.92);color:#fff;font:13px/1.35 system-ui,sans-serif;" +
    "box-shadow:0 6px 24px rgba(0,0,0,.35);opacity:0;transition:opacity .2s;pointer-events:none}" +
    ".toast.on{opacity:1}" +
    ".hidden{display:none}";

  var ICON_TEXT = '<svg viewBox="0 0 24 24"><rect x="8" y="3" width="8" height="4" rx="1"/>' +
    '<path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2"/><path d="M8 12h8M8 16h5"/></svg>';
  var ICON_SHOT = '<svg viewBox="0 0 24 24"><path d="M4 8a2 2 0 0 1 2-2h2l1.5-2h5L16 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/>' +
    '<circle cx="12" cy="12.5" r="3.5"/></svg>';

  function ensureRoot() {
    if (host && host.isConnected) return root;
    if (!document.documentElement) return null;
    host = document.createElement("lean-copy");
    root = host.attachShadow ? host.attachShadow({ mode: "closed" }) : host;
    var style = document.createElement("style");
    style.textContent = CSS;
    root.appendChild(style);
    var toast = document.createElement("div");
    toast.className = "toast";
    root.appendChild(toast);
    document.documentElement.appendChild(host);
    if (config.buttons) addButtons();
    return root;
  }

  function addButtons() {
    if (root.querySelector(".dock")) return;
    var dock = document.createElement("div");
    dock.className = "dock";
    dock.innerHTML =
      '<button data-act="text" title="Aufgabe als Text kopieren (für KI)" aria-label="Aufgabe als Text kopieren">' + ICON_TEXT + "</button>" +
      '<button data-act="shot" title="Screenshot in die Zwischenablage" aria-label="Screenshot kopieren">' + ICON_SHOT + "</button>";
    dock.addEventListener("click", function (event) {
      var btn = event.target.closest ? event.target.closest("button") : null;
      if (!btn) return;
      event.preventDefault();
      event.stopPropagation();
      if (btn.getAttribute("data-act") === "text") api.text();
      else api.shot();
    });
    root.appendChild(dock);
  }

  function toast(message) {
    var r = ensureRoot();
    if (!r) return;
    var el = r.querySelector(".toast");
    el.textContent = message;
    el.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("on"); }, 2600);
  }

  function setDockHidden(hidden) {
    var r = ensureRoot();
    var dock = r && r.querySelector(".dock");
    var t = r && r.querySelector(".toast");
    if (dock) dock.classList.toggle("hidden", hidden);
    if (t) t.classList.toggle("hidden", hidden);
  }

  function afterPaint(fn) {
    if (typeof requestAnimationFrame !== "function") return setTimeout(fn, 50);
    requestAnimationFrame(function () { requestAnimationFrame(fn); });
  }

  var config = { buttons: true };

  var api = {
    text: function () {
      collectText(function (text) {
        if (!text) return toast("Kein Text gefunden. Öffne die Aufgabe und versuch es nochmal.");
        invoke("copy_text", { text: text }).then(function () {
          var n = text.length.toLocaleString("de-DE");
          toast("Aufgabe kopiert (" + n + " Zeichen) – jetzt in die KI einfügen (Strg/⌘+V)");
        }, function (e) { toast("Kopieren fehlgeschlagen: " + (e && e.message || e)); });
      });
    },
    shot: function () {
      // Our own buttons should not end up in the screenshot.
      setDockHidden(true);
      afterPaint(function () {
        invoke("copy_screenshot").then(function () {
          setDockHidden(false);
          toast("Screenshot kopiert – jetzt in die KI einfügen (Strg/⌘+V)");
        }, function (e) {
          setDockHidden(false);
          toast("Screenshot fehlgeschlagen: " + (e && e.message || e));
        });
      });
    },
    configure: function (next) {
      config.buttons = !!(next && next.buttons);
      var r = ensureRoot();
      if (!r) return;
      var dock = r.querySelector(".dock");
      if (config.buttons && !dock) addButtons();
      if (!config.buttons && dock) dock.parentNode.removeChild(dock);
    },
    _pick: pick,
    _clean: cleanText
  };
  window.__leanCopy = api;

  function mount() { ensureRoot(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
  // Keep the buttons if the page replaces <html> children.
  setInterval(function () { if (!host || !host.isConnected) ensureRoot(); }, 3000);
})();

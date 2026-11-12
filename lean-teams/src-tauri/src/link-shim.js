// Linux only. WebKitGTK does not raise a new-window request for plain
// `<a target="_blank">` clicks, and ignores window.open() called from an
// injected script, so links in chats would do nothing. Hand them to the app,
// which opens them in the default browser.
(function () {
  "use strict";
  if (window.top !== window) return;

  function anchorFrom(event) {
    var path = typeof event.composedPath === "function" ? event.composedPath() : [event.target];
    for (var i = 0; i < path.length; i++) {
      var node = path[i];
      if (node && node.tagName === "A" && node.href) return node;
    }
    return null;
  }

  function onActivate(event) {
    if (event.defaultPrevented) return;
    if (event.type === "click" && event.button !== 0) return;
    if (event.type === "auxclick" && event.button !== 1) return;
    var ipc = window.__TAURI_INTERNALS__;
    if (!ipc || typeof ipc.invoke !== "function") return;
    var anchor = anchorFrom(event);
    if (!anchor || !/^(https?|mailto|tel):/i.test(anchor.href)) return;
    var target = (anchor.getAttribute("target") || "").toLowerCase();
    if (target !== "_blank" && event.type !== "auxclick") return;
    event.preventDefault();
    ipc.invoke("open_link", { url: anchor.href }).catch(function () {});
  }

  // Bubble phase on window: the page's own handlers run first, and anything
  // they already handled (defaultPrevented) is left alone.
  window.addEventListener("click", onActivate);
  window.addEventListener("auxclick", onActivate);
})();

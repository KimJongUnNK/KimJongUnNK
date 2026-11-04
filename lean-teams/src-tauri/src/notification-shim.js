// Injected into the Teams page. Replaces the Web Notification API with a thin
// bridge to native OS notifications, because system webviews either drop web
// notifications (WebKitGTK) or show them without app attribution (WebView2).
(function () {
  "use strict";
  if (window.top !== window || window.__leanTeamsShim) return;
  window.__leanTeamsShim = true;

  function send(title, options) {
    var ipc = window.__TAURI_INTERNALS__;
    if (!ipc || typeof ipc.invoke !== "function") return;
    var body = options && options.body != null ? String(options.body) : "";
    ipc.invoke("notify", { title: String(title || ""), body: body }).catch(function () {});
  }

  function LeanNotification(title, options) {
    if (!(this instanceof LeanNotification)) {
      throw new TypeError("Failed to construct 'Notification': Please use the 'new' operator.");
    }
    var target = document.createDocumentFragment();
    this.addEventListener = target.addEventListener.bind(target);
    this.removeEventListener = target.removeEventListener.bind(target);
    this.dispatchEvent = target.dispatchEvent.bind(target);
    options = options || {};
    this.title = String(title || "");
    this.body = options.body != null ? String(options.body) : "";
    this.tag = options.tag || "";
    this.icon = options.icon || "";
    this.data = options.data;
    this.silent = !!options.silent;
    this.onclick = this.onclose = this.onerror = this.onshow = null;
    send(this.title, options);
    var self = this;
    setTimeout(function () {
      var ev = new Event("show");
      self.dispatchEvent(ev);
      if (typeof self.onshow === "function") self.onshow(ev);
    }, 0);
  }
  LeanNotification.prototype.close = function () {
    var ev = new Event("close");
    this.dispatchEvent(ev);
    if (typeof this.onclose === "function") this.onclose(ev);
  };
  Object.defineProperty(LeanNotification, "permission", {
    get: function () { return "granted"; },
  });
  LeanNotification.maxActions = 0;
  LeanNotification.requestPermission = function (cb) {
    if (typeof cb === "function") cb("granted");
    return Promise.resolve("granted");
  };

  Object.defineProperty(window, "Notification", {
    value: LeanNotification,
    writable: true,
    configurable: true,
  });

  if (window.ServiceWorkerRegistration) {
    window.ServiceWorkerRegistration.prototype.showNotification = function (title, options) {
      send(title, options);
      return Promise.resolve();
    };
  }

  if (navigator.permissions && typeof navigator.permissions.query === "function") {
    var query = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = function (descriptor) {
      if (descriptor && descriptor.name === "notifications") {
        return Promise.resolve({
          name: "notifications",
          state: "granted",
          onchange: null,
          addEventListener: function () {},
          removeEventListener: function () {},
          dispatchEvent: function () { return false; },
        });
      }
      return query(descriptor);
    };
  }
})();

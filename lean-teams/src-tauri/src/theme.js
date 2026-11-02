// Lean Teams theme engine. Recolors Teams to the user's accent color without
// knowing Teams' class names or token names:
//
//  - scans every readable stylesheet (including the ones Teams' CSS-in-JS
//    fills at runtime via insertRule) for CSS variables and color
//    declarations,
//  - recolors the ones in Teams' purple brand hue with the accent hue and
//    saturation at the original lightness and alpha, so light and dark
//    ramps stay intact,
//  - optionally tints neutral greys toward the accent, separately for
//    borders/lines and for backgrounds; text colors are never tinted,
//  - rescans only when Teams adds styles.
//
// Speed matters because the overlay menu calls set() on every frame while
// a slider is dragged: the expensive scan is cached and only redone when the
// stylesheets change; set() merely recomputes colors from the cache, once
// per animation frame. Color changes cross-fade, but not while dragging.
//
// Controlled from Rust via window.__leanTheme.set({ accent, tint, borderTint }).
(function () {
  "use strict";
  if (window.top !== window || window.__leanTheme) return;

  // Teams' purple sits around hue 235-240 in both light and dark themes.
  var BRAND_HUE_MIN = 222, BRAND_HUE_MAX = 258, BRAND_MIN_SAT = 0.16;
  var NEUTRAL_MAX_SAT = 0.08;
  // What a plain color property paints. Variables are classified by name.
  var PROP_ROLES = {
    "color": "text", "fill": "text", "stroke": "border", "caret-color": "text", "text-decoration-color": "text",
    "background-color": "bg",
    "border-color": "border", "border-top-color": "border", "border-right-color": "border",
    "border-bottom-color": "border", "border-left-color": "border", "outline-color": "border",
    "column-rule-color": "border"
  };
  var FADE_CSS = "html.lean-theme-fade, html.lean-theme-fade * { transition: background-color .3s ease, color .3s ease," +
    " border-color .3s ease, fill .3s ease, stroke .3s ease !important; }\n";
  var DRAG_GAP_MS = 250;

  var config = { accent: null, tint: 0, borderTint: 0 };
  var sheet = null, fallback = null, signature = null, entries = [], frame = 0;
  var fadeTimer = 0, lastSet = 0, stats = { rules: 0, values: 0, scans: 0 };

  // ---- colors -------------------------------------------------------------
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

  function parseColor(text) {
    var v = String(text).trim().toLowerCase(), m;
    if ((m = /^#([0-9a-f]{3,8})$/.exec(v))) {
      var h = m[1];
      if (h.length === 3 || h.length === 4) h = h.replace(/./g, "$&$&");
      if (h.length !== 6 && h.length !== 8) return null;
      return {
        r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16),
        a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
      };
    }
    if ((m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+%?))?\s*\)$/.exec(v))) {
      var a = m[4] === undefined ? 1 : m[4].slice(-1) === "%" ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
      return { r: +m[1], g: +m[2], b: +m[3], a: a };
    }
    return null;
  }

  function toHsl(c) {
    var r = c.r / 255, g = c.g / 255, b = c.b / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, h = 0, s = 0;
    if (max !== min) {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60;
    }
    return { h: h, s: s, l: l };
  }

  function fromHsl(h, s, l, a) {
    function f(n) {
      var k = (n + h / 30) % 12, x = s * Math.min(l, 1 - l);
      return Math.round(255 * (l - x * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
    }
    return { r: f(0), g: f(8), b: f(4), a: a };
  }

  function css(c) {
    return c.a >= 1 ? "rgb(" + c.r + "," + c.g + "," + c.b + ")"
      : "rgba(" + c.r + "," + c.g + "," + c.b + "," + Math.round(c.a * 1000) / 1000 + ")";
  }

  function mix(c, to, t) {
    return {
      r: Math.round(c.r + (to.r - c.r) * t), g: Math.round(c.g + (to.g - c.g) * t),
      b: Math.round(c.b + (to.b - c.b) * t), a: c.a
    };
  }

  function roleOf(name) {
    if (name.indexOf("--") !== 0) return PROP_ROLES[name] || null;
    var n = name.toLowerCase();
    if (/stroke|border|divider|outline|separator|ring/.test(n)) return "border";
    if (/foreground|text|icon|font/.test(n)) return "text";
    if (/background|surface|canvas|layer/.test(n)) return "bg";
    return null;
  }

  // "brand" for Teams purple, the role for a neutral grey, else null.
  function kindOf(color, role) {
    var hsl = toHsl(color);
    if (hsl.s >= BRAND_MIN_SAT && hsl.h >= BRAND_HUE_MIN && hsl.h <= BRAND_HUE_MAX) return "brand";
    if (hsl.s <= NEUTRAL_MAX_SAT && (role === "bg" || role === "border")) return role;
    return null;
  }

  function recolor(entry, accent, tint, borderTint) {
    var c = entry.color;
    if (entry.kind === "brand") {
      // Keep how light/dark the shade was; take hue and saturation from the
      // accent, scaled so pale tints stay pale.
      var sat = clamp01(accent.s * Math.min(1.25, entry.s / 0.55));
      return fromHsl(accent.h, sat, entry.l, c.a);
    }
    if (entry.kind === "border" && borderTint > 0) return mix(c, accent.rgb, borderTint);
    if (entry.kind === "bg" && tint > 0) return mix(c, accent.rgb, tint);
    return null;
  }

  // ---- scanning (expensive, cached) ----------------------------------------
  function sheets() {
    var list = Array.prototype.slice.call(document.styleSheets);
    var adopted = document.adoptedStyleSheets || [];
    for (var i = 0; i < adopted.length; i++) list.push(adopted[i]);
    return list.filter(function (s) { return s !== sheet && !(fallback && s.ownerNode === fallback); });
  }

  function rulesOf(s) {
    try { return s.cssRules || null; } catch (e) { return null; } // cross-origin
  }

  function currentSignature() {
    var parts = [];
    sheets().forEach(function (s) { var r = rulesOf(s); parts.push(r ? r.length : -1); });
    return parts.join(",");
  }

  function walk(rules, visit) {
    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i];
      if (rule.selectorText && rule.style) visit(rule);
      else if (rule.cssRules) walk(rule.cssRules, visit);
    }
  }

  function scan() {
    var found = [];
    sheets().forEach(function (s) {
      var rules = rulesOf(s);
      if (!rules) return;
      walk(rules, function (rule) {
        var style = rule.style, decls = null;
        for (var i = 0; i < style.length; i++) {
          var name = style[i];
          if (name.indexOf("--") !== 0 && !PROP_ROLES[name]) continue;
          var color = parseColor(style.getPropertyValue(name));
          if (!color) continue;
          var kind = kindOf(color, roleOf(name));
          if (!kind) continue;
          var hsl = toHsl(color);
          (decls || (decls = [])).push({ name: name, color: color, kind: kind, s: hsl.s, l: hsl.l });
        }
        if (decls) found.push({ selector: rule.selectorText, decls: decls });
      });
    });
    entries = found;
    stats.scans += 1;
  }

  // ---- building (cheap, from the cache) ------------------------------------
  function build() {
    stats.rules = 0;
    stats.values = 0;
    var base = config.accent && parseColor(config.accent);
    if (!base) return FADE_CSS;
    var accent = toHsl(base);
    accent.rgb = base;
    var tint = clamp01(config.tint), borderTint = clamp01(config.borderTint);
    var out = [FADE_CSS];
    for (var i = 0; i < entries.length; i++) {
      var decls = entries[i].decls, parts = [];
      for (var j = 0; j < decls.length; j++) {
        var next = recolor(decls[j], accent, tint, borderTint);
        if (next) parts.push(decls[j].name + ":" + css(next) + " !important");
      }
      if (parts.length) {
        stats.rules += 1;
        stats.values += parts.length;
        out.push(entries[i].selector + "{" + parts.join(";") + "}");
      }
    }
    return out.join("\n");
  }

  function apply(text) {
    try {
      if (!sheet) sheet = new CSSStyleSheet();
      sheet.replaceSync(text);
      if ((document.adoptedStyleSheets || []).indexOf(sheet) < 0) {
        document.adoptedStyleSheets = (document.adoptedStyleSheets || []).concat([sheet]);
      }
      return;
    } catch (e) {}
    if (!fallback) {
      fallback = document.createElement("style");
      fallback.id = "lean-theme";
    }
    if (!fallback.isConnected) (document.head || document.documentElement).appendChild(fallback);
    fallback.textContent = text;
  }

  // Rescan only if Teams' stylesheets changed; rebuild if anything changed.
  function refresh(configChanged) {
    var sig = currentSignature();
    var rescanned = sig !== signature;
    if (rescanned) {
      signature = sig;
      scan();
    }
    if (rescanned || configChanged) apply(build());
  }

  function fade() {
    var root = document.documentElement;
    if (!root) return;
    root.classList.add("lean-theme-fade");
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(function () { root.classList.remove("lean-theme-fade"); }, 400);
  }

  setInterval(function () { if (config.accent) refresh(false); }, 1500);
  document.addEventListener("DOMContentLoaded", function () { refresh(true); });
  window.addEventListener("load", function () { refresh(true); });

  window.__leanTheme = {
    set: function (next) {
      var cfg = {
        accent: next.accent || null,
        tint: Number(next.tint) || 0,
        borderTint: Number(next.borderTint) || 0
      };
      if (cfg.accent === config.accent && cfg.tint === config.tint && cfg.borderTint === config.borderTint) return;
      var now = Date.now();
      // A single click cross-fades; a slider drag updates instantly.
      if (now - lastSet > DRAG_GAP_MS) fade();
      lastSet = now;
      config = cfg;
      if (typeof requestAnimationFrame !== "function") return refresh(true);
      if (frame) return;
      frame = requestAnimationFrame(function () { frame = 0; refresh(true); });
    },
    stats: function () {
      return { rules: stats.rules, values: stats.values, scans: stats.scans, accent: config.accent };
    },
    _parse: parseColor,
    _role: roleOf,
    _recolor: function (text, accent, tint, borderTint, name) {
      var color = parseColor(text), a = parseColor(accent), hsl = toHsl(a);
      hsl.rgb = a;
      var kind = kindOf(color, roleOf(name || "background-color"));
      if (!kind) return null;
      var own = toHsl(color);
      var c = recolor({ color: color, kind: kind, s: own.s, l: own.l }, hsl, tint || 0, borderTint || 0);
      return c && css(c);
    }
  };
})();

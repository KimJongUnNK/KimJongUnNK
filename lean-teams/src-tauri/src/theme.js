// Lean Teams theme engine. Recolors Teams to the user's accent color without
// knowing Teams' class names or token names:
//
//  - scans every readable stylesheet (including the ones Teams' CSS-in-JS
//    fills at runtime via insertRule) for CSS variables and color
//    declarations whose value is Teams' purple brand hue,
//  - re-emits them for the same selectors with the accent hue/saturation and
//    the original lightness and alpha, so light and dark ramps stay intact,
//  - optionally tints neutral greys (backgrounds, borders) toward the accent,
//  - rescans when Teams adds styles, and cross-fades color changes.
//
// Controlled from Rust via window.__leanTheme.set({ accent, tint }).
(function () {
  "use strict";
  if (window.top !== window || window.__leanTheme) return;

  // Teams' purple sits around hue 235-240 in both light and dark themes.
  var BRAND_HUE_MIN = 222, BRAND_HUE_MAX = 258, BRAND_MIN_SAT = 0.16;
  var NEUTRAL_MAX_SAT = 0.08;
  var COLOR_PROPS = {
    "color": 1, "background-color": 1, "border-color": 1, "border-top-color": 1, "border-right-color": 1,
    "border-bottom-color": 1, "border-left-color": 1, "outline-color": 1, "fill": 1, "stroke": 1,
    "text-decoration-color": 1, "caret-color": 1, "column-rule-color": 1
  };
  var FADE_CSS = "html.lean-theme-fade, html.lean-theme-fade * { transition: background-color .35s ease, color .35s ease," +
    " border-color .35s ease, fill .35s ease, stroke .35s ease, box-shadow .35s ease !important; }\n";

  var config = { accent: null, tint: 0 };
  var sheet = null, fallback = null, signature = "", fadeTimer = 0, stats = { rules: 0, values: 0 };

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

  function recolor(c, accent, tint) {
    var hsl = toHsl(c);
    if (hsl.s >= BRAND_MIN_SAT && hsl.h >= BRAND_HUE_MIN && hsl.h <= BRAND_HUE_MAX) {
      // Keep how light/dark the shade was; take hue and saturation from the
      // accent, scaled so pale tints stay pale.
      var sat = clamp01(accent.s * Math.min(1.25, hsl.s / 0.55));
      return fromHsl(accent.h, sat, hsl.l, c.a);
    }
    if (tint > 0 && hsl.s <= NEUTRAL_MAX_SAT) {
      var rgb = accent.rgb;
      return {
        r: Math.round(c.r + (rgb.r - c.r) * tint), g: Math.round(c.g + (rgb.g - c.g) * tint),
        b: Math.round(c.b + (rgb.b - c.b) * tint), a: c.a
      };
    }
    return null;
  }

  // ---- scanning -----------------------------------------------------------
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

  function build() {
    stats = { rules: 0, values: 0 };
    if (!config.accent) return FADE_CSS;
    var base = parseColor(config.accent);
    if (!base) return FADE_CSS;
    var accent = toHsl(base);
    accent.rgb = base;
    var tint = clamp01(config.tint || 0);
    var out = [FADE_CSS];

    sheets().forEach(function (s) {
      var rules = rulesOf(s);
      if (!rules) return;
      walk(rules, function (rule) {
        var decls = [];
        var style = rule.style;
        for (var i = 0; i < style.length; i++) {
          var name = style[i];
          if (name.indexOf("--") !== 0 && !COLOR_PROPS[name]) continue;
          var color = parseColor(style.getPropertyValue(name));
          if (!color) continue;
          var next = recolor(color, accent, tint);
          if (next) decls.push(name + ":" + css(next) + " !important");
        }
        if (decls.length) {
          stats.rules += 1;
          stats.values += decls.length;
          out.push(rule.selectorText + "{" + decls.join(";") + "}");
        }
      });
    });
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

  function refresh(force) {
    var sig = currentSignature();
    if (!force && sig === signature) return;
    signature = sig;
    apply(build());
  }

  function fade() {
    var root = document.documentElement;
    if (!root) return;
    root.classList.add("lean-theme-fade");
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(function () { root.classList.remove("lean-theme-fade"); }, 450);
  }

  // Teams keeps inserting rules while it renders; cheap signature check,
  // full rebuild only when something changed.
  setInterval(function () { if (config.accent) refresh(false); }, 1500);
  document.addEventListener("DOMContentLoaded", function () { refresh(true); });
  window.addEventListener("load", function () { refresh(true); });

  window.__leanTheme = {
    set: function (next) {
      var changed = next.accent !== config.accent || next.tint !== config.tint;
      config = { accent: next.accent || null, tint: Number(next.tint) || 0 };
      if (changed) fade();
      refresh(true);
    },
    stats: function () { return { rules: stats.rules, values: stats.values, accent: config.accent }; },
    _parse: parseColor,
    _recolor: function (text, accent, tint) {
      var a = parseColor(accent), hsl = toHsl(a);
      hsl.rgb = a;
      var c = recolor(parseColor(text), hsl, tint || 0);
      return c && css(c);
    }
  };
})();

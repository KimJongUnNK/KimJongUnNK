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
//  - rescans only when Teams adds styles,
//  - recolors purple icons too: inline SVG paints exactly, and <img> icons
//    (Teams logo, app icons such as Assignments) whose pixels are mostly
//    Teams purple through an SVG duotone filter. Photos, emoji and large
//    images are left alone.
//
// Speed matters because the overlay menu calls set() on every frame while
// a slider is dragged: the expensive scan is cached and only redone when the
// stylesheets change; set() merely recomputes colors from the cache, once
// per animation frame. Color changes cross-fade, but not while dragging.
//
// Controlled from Rust via
// window.__leanTheme.set({ accent, tint, borderTint, icons }).
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

  // Icons: the Teams logo also uses blue-violet and magenta, so the hue range
  // is wider than for CSS colors. An image counts as a purple icon when most
  // of its opaque pixels are in that range and few have another color.
  var ICON_HUE_MIN = 212, ICON_HUE_MAX = 300, ICON_MIN_SAT = 0.2;
  var ICON_BRAND_SHARE = 0.3, ICON_OTHER_SHARE = 0.12, ICON_MAX_PX = 160, SAMPLE_PX = 32;
  var ICON_SKIP_SRC = /emoticon|emoji|personal-expressions|giphy|sticker/i;
  var PAINTS = ["fill", "stroke", "stop-color"];
  var SVG_NS = "http://www.w3.org/2000/svg";

  var config = { accent: null, tint: 0, borderTint: 0, icons: true };
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


  // ---- icons ----------------------------------------------------------------
  var iconColors = {};       // img src -> average purple {r,g,b}, or false
  var tintedImgs = [];       // <img> elements carrying one of our filters
  var svgPaints = [];        // inline SVG paints we recolored
  var svgOriginal = typeof WeakMap === "function" ? new WeakMap() : null;
  var filterHost = null, filterIds = {}, filterCount = 0;
  var iconObserver = null, iconTimer = 0;

  function luminance(c) { return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255; }

  function isIconPurple(hsl) {
    return hsl.s >= ICON_MIN_SAT && hsl.h >= ICON_HUE_MIN && hsl.h <= ICON_HUE_MAX && hsl.l > 0.08 && hsl.l < 0.95;
  }

  // RGBA bytes -> average purple of an icon, or null if it is not one.
  function classifyPixels(data) {
    var opaque = 0, brand = 0, other = 0, r = 0, g = 0, b = 0;
    for (var i = 0; i + 3 < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      opaque += 1;
      var px = { r: data[i], g: data[i + 1], b: data[i + 2] }, hsl = toHsl(px);
      if (isIconPurple(hsl)) {
        brand += 1; r += px.r; g += px.g; b += px.b;
      } else if (hsl.s >= 0.25 && hsl.l > 0.1 && hsl.l < 0.9) {
        other += 1;
      }
    }
    if (!opaque || brand / opaque < ICON_BRAND_SHARE || other / opaque > ICON_OTHER_SHARE) return null;
    return { r: Math.round(r / brand), g: Math.round(g / brand), b: Math.round(b / brand), a: 1 };
  }

  // Duotone through the icon's own purple: black stays black, white stays
  // white, and the average purple lands exactly on its recolored shade.
  function tableValues(from, to) {
    var out = [];
    for (var i = 0; i <= 16; i++) {
      var t = i / 16;
      var v = t <= from ? to * t / from : to + (1 - to) * (t - from) / (1 - from);
      out.push(Math.round(clamp01(v) * 1000) / 1000);
    }
    return out.join(" ");
  }

  function filterFor(purple, target) {
    var key = [purple.r, purple.g, purple.b, target.r, target.g, target.b].join(",");
    if (filterIds[key]) return filterIds[key];
    if (!filterHost || !filterHost.isConnected) {
      filterHost = document.createElementNS(SVG_NS, "svg");
      filterHost.setAttribute("aria-hidden", "true");
      filterHost.setAttribute("style", "position:absolute;width:0;height:0;overflow:hidden");
      (document.body || document.documentElement).appendChild(filterHost);
      filterIds = {};
    }
    var id = "lean-icon-" + (++filterCount);
    var from = Math.min(0.95, Math.max(0.05, luminance(purple)));
    var filter = document.createElementNS(SVG_NS, "filter");
    filter.setAttribute("id", id);
    filter.setAttribute("color-interpolation-filters", "sRGB");
    var gray = document.createElementNS(SVG_NS, "feColorMatrix");
    gray.setAttribute("type", "matrix");
    gray.setAttribute("values", "0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0 0 0 1 0");
    var transfer = document.createElementNS(SVG_NS, "feComponentTransfer");
    [["feFuncR", target.r], ["feFuncG", target.g], ["feFuncB", target.b]].forEach(function (f) {
      var fn = document.createElementNS(SVG_NS, f[0]);
      fn.setAttribute("type", "table");
      fn.setAttribute("tableValues", tableValues(from, f[1] / 255));
      transfer.appendChild(fn);
    });
    filter.appendChild(gray);
    filter.appendChild(transfer);
    filterHost.appendChild(filter);
    filterIds[key] = id;
    return id;
  }

  function accentHsl() {
    var base = config.accent && parseColor(config.accent);
    if (!base) return null;
    var accent = toHsl(base);
    accent.rgb = base;
    return accent;
  }

  function brandTarget(color, accent) {
    var hsl = toHsl(color);
    return recolor({ color: color, kind: "brand", s: hsl.s, l: hsl.l }, accent, 0, 0);
  }

  function sampleIcon(src) {
    iconColors[src] = "pending";
    var probe = new Image();
    if (!/^(data|blob):/i.test(src)) probe.crossOrigin = "anonymous";
    probe.onload = function () {
      var result = false;
      try {
        var canvas = document.createElement("canvas");
        canvas.width = canvas.height = SAMPLE_PX;
        var ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(probe, 0, 0, SAMPLE_PX, SAMPLE_PX);
        result = classifyPixels(ctx.getImageData(0, 0, SAMPLE_PX, SAMPLE_PX).data) || false;
      } catch (e) {} // no CORS: leave the image alone
      iconColors[src] = result;
      if (result) scheduleIcons();
    };
    probe.onerror = function () { iconColors[src] = false; };
    probe.src = src;
  }

  function tintImage(img, accent) {
    var src = img.currentSrc || img.src;
    if (!src || ICON_SKIP_SRC.test(src)) return;
    var w = img.clientWidth, h = img.clientHeight;
    if (!w || !h || w > ICON_MAX_PX || h > ICON_MAX_PX) return;
    var purple = iconColors[src];
    if (purple === undefined) return sampleIcon(src);
    if (!purple || purple === "pending") return;
    var target = brandTarget(purple, accent);
    var id = filterFor(purple, target);
    if (img.__leanIconId === id && img.style.getPropertyValue("filter") === img.__leanIcon) return;
    img.style.setProperty("filter", "url(#" + id + ")", "important");
    if (!img.__leanIconId) tintedImgs.push(img);
    img.__leanIconId = id;
    // Read back: browsers normalize the value (url("#id")).
    img.__leanIcon = img.style.getPropertyValue("filter");
  }

  function tintSvgPaint(el, accent) {
    var originals = svgOriginal && svgOriginal.get(el);
    for (var i = 0; i < PAINTS.length; i++) {
      var prop = PAINTS[i];
      var original = originals && originals[prop] !== undefined ? originals[prop] : el.getAttribute(prop);
      var color = original && parseColor(original);
      if (!color || !isIconPurple(toHsl(color))) continue;
      if (!originals) {
        originals = {};
        if (svgOriginal) svgOriginal.set(el, originals);
      }
      if (originals[prop] === undefined) {
        originals[prop] = original;
        svgPaints.push({ el: el, prop: prop });
      }
      el.style.setProperty(prop, css(brandTarget(color, accent)), "important");
    }
  }

  function clearIcons() {
    tintedImgs.forEach(function (img) {
      if (img.style.getPropertyValue("filter") === img.__leanIcon) img.style.removeProperty("filter");
      img.__leanIcon = img.__leanIconId = null;
    });
    tintedImgs = [];
    svgPaints.forEach(function (p) { p.el.style.removeProperty(p.prop); });
    svgPaints = [];
    if (svgOriginal) svgOriginal = new WeakMap();
    if (filterHost && filterHost.parentNode) filterHost.parentNode.removeChild(filterHost);
    filterHost = null;
    filterIds = {};
  }

  function applyIcons() {
    iconTimer = 0;
    var accent = config.icons ? accentHsl() : null;
    if (!accent || !document.querySelectorAll) return;
    tintedImgs = tintedImgs.filter(function (img) {
      if (img.isConnected) return true;
      img.__leanIcon = img.__leanIconId = null;
      return false;
    });
    svgPaints = svgPaints.filter(function (p) { return p.el.isConnected; });
    var imgs = document.querySelectorAll("img");
    for (var i = 0; i < imgs.length; i++) tintImage(imgs[i], accent);
    var paints = document.querySelectorAll("svg [fill], svg [stroke], svg [stop-color], svg[fill]");
    for (var j = 0; j < paints.length; j++) tintSvgPaint(paints[j], accent);
  }

  function scheduleIcons() {
    if (!iconTimer) iconTimer = setTimeout(applyIcons, 250);
  }

  // Called whenever the config changes: start, stop or redo the icon pass.
  function updateIcons() {
    clearIcons();
    var on = config.icons && !!accentHsl();
    if (on && !iconObserver && typeof MutationObserver === "function" && document.documentElement) {
      iconObserver = new MutationObserver(scheduleIcons);
      iconObserver.observe(document.documentElement, {
        childList: true, subtree: true, attributes: true, attributeFilter: ["src", "fill", "stroke", "stop-color"]
      });
    } else if (!on && iconObserver) {
      iconObserver.disconnect();
      iconObserver = null;
    }
    if (on) scheduleIcons();
  }

  setInterval(function () { if (config.accent) refresh(false); }, 1500);
  document.addEventListener("DOMContentLoaded", function () { refresh(true); updateIcons(); });
  window.addEventListener("load", function () { refresh(true); });

  window.__leanTheme = {
    set: function (next) {
      var cfg = {
        accent: next.accent || null,
        tint: Number(next.tint) || 0,
        borderTint: Number(next.borderTint) || 0,
        icons: next.icons !== false
      };
      if (cfg.accent === config.accent && cfg.tint === config.tint && cfg.borderTint === config.borderTint &&
          cfg.icons === config.icons) return;
      var now = Date.now();
      // A single click cross-fades; a slider drag updates instantly.
      if (now - lastSet > DRAG_GAP_MS) fade();
      lastSet = now;
      var iconsChanged = cfg.accent !== config.accent || cfg.icons !== config.icons;
      config = cfg;
      if (iconsChanged) updateIcons();
      if (typeof requestAnimationFrame !== "function") return refresh(true);
      if (frame) return;
      frame = requestAnimationFrame(function () { frame = 0; refresh(true); });
    },
    stats: function () {
      return {
        rules: stats.rules, values: stats.values, scans: stats.scans, accent: config.accent,
        icons: tintedImgs.length, svgPaints: svgPaints.length
      };
    },
    _classify: classifyPixels,
    _table: tableValues,
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

/* MathPad II — gemeinsames Grafikfenster fuer Sequence, Conics, DiffEqGraph (Raster, Achsen, Pan/Zoom) */
(function (MP) {
  'use strict';
  const App = MP.App;

  const Plot = {
    // Canvas auf Geraete-Pixeldichte bringen; liefert Zeichenkontext und Groesse in CSS-Pixeln
    setup(canvas) {
      const W = canvas.clientWidth, H = canvas.clientHeight;
      if (!W || !H) return null;
      const r = (window.devicePixelRatio || 1) * (App.scale || 1);
      canvas.width = Math.round(W * r);
      canvas.height = Math.round(H * r);
      const g = canvas.getContext('2d');
      g.setTransform(r, 0, 0, r, 0, 0);
      g.fillStyle = App.pal().bg;
      g.fillRect(0, 0, W, H);
      return { g, W, H };
    },
    // Raster, Achsen, Beschriftung wie im Graph-Fenster; liefert Umrechnungen
    axes(g, W, H, V) {
      const S = App.settings;
      const X = x => (x - V.xmin) / (V.xmax - V.xmin) * W, Y = y => H - (y - V.ymin) / (V.ymax - V.ymin) * H;
      const xs = V.xscl > 0 ? V.xscl : 1, ys = V.yscl > 0 ? V.yscl : 1;
      const nx = (V.xmax - V.xmin) / xs, ny = (V.ymax - V.ymin) / ys;
      if (S.grid && nx < 150 && ny < 150) {
        g.strokeStyle = App.pal().grid; g.lineWidth = 1;
        g.beginPath();
        for (let k = Math.ceil(V.xmin / xs); k * xs <= V.xmax; k++) { const px = Math.round(X(k * xs)) + 0.5; g.moveTo(px, 0); g.lineTo(px, H); }
        for (let k = Math.ceil(V.ymin / ys); k * ys <= V.ymax; k++) { const py = Math.round(Y(k * ys)) + 0.5; g.moveTo(0, py); g.lineTo(W, py); }
        g.stroke();
      }
      const ax = Math.round(Y(0)) + 0.5, ay = Math.round(X(0)) + 0.5;
      if (S.axes) {
        g.strokeStyle = App.pal().axis; g.lineWidth = 1;
        g.beginPath();
        if (V.ymin <= 0 && V.ymax >= 0) { g.moveTo(0, ax); g.lineTo(W, ax); }
        if (V.xmin <= 0 && V.xmax >= 0) { g.moveTo(ay, 0); g.lineTo(ay, H); }
        g.stroke();
      }
      if (S.labels) {
        g.fillStyle = App.pal().label; g.font = '9px -apple-system, Helvetica, Arial, sans-serif';
        const stepX = xs * Math.max(1, Math.ceil(26 / (W / nx || 1))), stepY = ys * Math.max(1, Math.ceil(18 / (H / ny || 1)));
        const lx = Math.min(Math.max(ax, 2), H - 11), ly = Math.min(Math.max(ay, 2), W - 2);
        g.textAlign = 'center'; g.textBaseline = 'top';
        for (let k = Math.ceil(V.xmin / stepX); k * stepX <= V.xmax; k++) if (k) g.fillText(String(+(k * stepX).toPrecision(6)).replace('-', '−'), X(k * stepX), lx + 3);
        g.textAlign = ly > W - 30 ? 'right' : 'left'; g.textBaseline = 'middle';
        for (let k = Math.ceil(V.ymin / stepY); k * stepY <= V.ymax; k++) if (k) g.fillText(String(+(k * stepY).toPrecision(6)).replace('-', '−'), g.textAlign === 'left' ? ly + 4 : ly - 4, Y(k * stepY));
      }
      return { X, Y, ix: px => V.xmin + px / W * (V.xmax - V.xmin), iy: py => V.ymax - py / H * (V.ymax - V.ymin) };
    },
    niceScale(V) {
      const nice = span => { const raw = span / 10; const p = Math.pow(10, Math.floor(Math.log10(raw))); const m = raw / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p; };
      V.xscl = +nice(V.xmax - V.xmin).toPrecision(6);
      V.yscl = +nice(V.ymax - V.ymin).toPrecision(6);
    },
    // Ziehen verschiebt, Mausrad/Trackpad zoomt; onTap(x,y) fuer Klicks ohne Bewegung
    bind(wrap, canvas, getView, redraw, onTap) {
      let drag = null;
      const pos = e => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / (App.scale || 1), y: (e.clientY - r.top) / (App.scale || 1) }; };
      wrap.addEventListener('pointerdown', e => {
        e.preventDefault();
        wrap.setPointerCapture(e.pointerId);
        drag = { p: pos(e), v: Object.assign({}, getView()), moved: false };
      });
      wrap.addEventListener('pointermove', e => {
        if (!drag) return;
        const p = pos(e), V = getView(), W = canvas.clientWidth, H = canvas.clientHeight;
        if (Math.abs(p.x - drag.p.x) + Math.abs(p.y - drag.p.y) > 3) drag.moved = true;
        if (!drag.moved) return;
        const dx = (p.x - drag.p.x) / W * (drag.v.xmax - drag.v.xmin), dy = (p.y - drag.p.y) / H * (drag.v.ymax - drag.v.ymin);
        Object.assign(V, { xmin: drag.v.xmin - dx, xmax: drag.v.xmax - dx, ymin: drag.v.ymin + dy, ymax: drag.v.ymax + dy });
        redraw();
      });
      const end = e => {
        if (!drag) return;
        if (!drag.moved && onTap) {
          const V = getView(), W = canvas.clientWidth, H = canvas.clientHeight, p = drag.p;
          onTap(V.xmin + p.x / W * (V.xmax - V.xmin), V.ymax - p.y / H * (V.ymax - V.ymin));
        }
        drag = null;
        App.save();
      };
      wrap.addEventListener('pointerup', end);
      wrap.addEventListener('pointercancel', () => { drag = null; });
      wrap.addEventListener('wheel', e => {
        e.preventDefault();
        const p = pos(e), V = getView(), W = canvas.clientWidth, H = canvas.clientHeight;
        const cx = V.xmin + p.x / W * (V.xmax - V.xmin), cy = V.ymax - p.y / H * (V.ymax - V.ymin);
        const k = Math.exp((e.ctrlKey ? e.deltaY * 2.5 : e.deltaY) * 0.0018);
        Object.assign(V, { xmin: cx - (cx - V.xmin) * k, xmax: cx + (V.xmax - cx) * k, ymin: cy - (cy - V.ymin) * k, ymax: cy + (V.ymax - cy) * k });
        Plot.niceScale(V);
        redraw();
      }, { passive: false });
    },
    zoom(V, k) {
      const cx = (V.xmin + V.xmax) / 2, cy = (V.ymin + V.ymax) / 2;
      Object.assign(V, { xmin: cx - (cx - V.xmin) * k, xmax: cx + (V.xmax - cx) * k, ymin: cy - (cy - V.ymin) * k, ymax: cy + (V.ymax - cy) * k });
      Plot.niceScale(V);
    },
    // View-Window-Dialog fuer beliebige Felder
    viewDialog(title, V, fields, onOk) {
      const h = App.h;
      const f = (id, l, v) => h('div', { class: 'row' }, h('label', { for: id, text: l }), h('input', { type: 'text', id, value: String(+(+v).toPrecision(10)), spellcheck: 'false', autocomplete: 'off' }));
      App.dialog({
        title,
        body: fields.map(([k, l]) => f('pv-' + k, l, V[k])),
        ok: d => {
          const n = {};
          for (const [k] of fields) {
            const v = MP.evalNum(d.querySelector('#pv-' + k).value);
            if (!isFinite(v)) { App.error('Syntax ERROR'); return false; }
            n[k] = v;
          }
          if ((n.xmin !== undefined && n.xmin >= n.xmax) || (n.ymin !== undefined && n.ymin >= n.ymax)) { App.error('Range ERROR'); return false; }
          Object.assign(V, n);
          if (onOk) onOk();
        }
      });
    },
    // Wiederverwendbare Bausteine fuer Apps mit Editor oben und Grafik unten
    graphWin(win) {
      const h = App.h;
      const wrap = h('div', { class: 'gwrap pan' });
      const canvas = h('canvas', { 'aria-label': 'Grafikfenster' });
      const info = h('div', { class: 'ginfo' }), tag = h('div', { class: 'gtag' });
      wrap.append(canvas, tag, info);
      win.appendChild(wrap);
      return { wrap, canvas, info, tag };
    }
  };
  MP.Plot = Plot;
})(window.MP = window.MP || {});

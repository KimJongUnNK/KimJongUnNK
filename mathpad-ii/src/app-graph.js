/* MathPad II — Graph & Table */
(function (MP) {
  'use strict';
  const App = MP.App, B = MP.B, C = MP.core, NUM = MP.num, h = App.h, svg = App.svg;

  const COLORS = ['#1a4fd8', '#e0201b', '#15a01a', '#c21fb0', '#111111', '#0b9db0', '#e07b00', '#6b4bd8'];
  const NROWS = 20;
  const DEFAULT_VIEW = () => ({ xmin: -7.7, xmax: 7.7, xscl: 1, ymin: -3.8, ymax: 3.8, yscl: 1, tmin: 0, tmax: 2 * Math.PI, tstep: Math.PI / 120 });
  const fmt = (v, d) => {
    if (!isFinite(v)) return isNaN(v) ? 'Undefined' : (v > 0 ? '∞' : '−∞');
    if (Math.abs(v) < 1e-12) return '0';
    const s = C.fmtFloat(v, { mode: 'norm2' });
    if (d) { const t = Number(v.toPrecision(d)); return Math.abs(t) >= 1e10 || (Math.abs(t) < 1e-4 && t !== 0) ? t.toExponential(d - 1).replace('e', 'ᴇ') : String(t); }
    return s;
  };
  MP.fmtShort = fmt;

  // Zahl aus Text (Dialoge): erlaubt π, Brueche, sqrt(2), 2π
  function evalNum(s) {
    s = String(s).trim();
    if (!s) return NaN;
    try {
      const ast = C.parseString(s.replace(/π/g, 'pi'), { split: true, userFns: App.env.userFns });
      const f = NUM.compile(ast, [], { angle: App.settings.angle, values: numericVars(), fns: App.env.fns });
      return f();
    } catch (e) { return NaN; }
  }
  MP.evalNum = evalNum;
  function numericVars() {
    const out = {};
    for (const k in App.env.vars) {
      try {
        const v = NUM.compile(App.env.vars[k], [], { angle: 'rad', values: {} })();
        if (isFinite(v)) out[k] = v;
      } catch (e) { /* symbolisch: nicht numerisch */ }
    }
    return out;
  }
  MP.numericVars = numericVars;

  // Funktionsterm kompilieren; Befehle (diff, ∫, solve…) vorher per CAS aufloesen
  function compileItems(items, v) {
    const ast = B.parse(B.row(B.clone(items)), App.env.userFns);
    let hasCmd = false;
    C.walk(ast, n => { if (n.type === 'call' && MP.cas.CMD[n.name]) hasCmd = true; });
    let use = ast;
    if (hasCmd) {
      const S = Object.assign({}, App.settings, { decimal: false, complex: 'real' });
      use = MP.cas.evaluate(ast, Object.assign({}, App.env, { settings: S })).exact;
    }
    if (use.type === 'rel' && use.op === '=') use = use.b;
    return NUM.compile(use, [v], { angle: App.settings.angle, values: numericVars(), fns: App.env.fns });
  }
  MP.compileItems = compileItems;

  const G = {
    title: 'Graph & Table',
    statusKinds: ['angle', 'complex'],
    init(saved) {
      this.sheets = [];
      for (let s = 0; s < 5; s++) {
        const fns = [];
        for (let i = 0; i < NROWS; i++) fns.push({ items: [], on: false, type: 'y' });
        this.sheets.push({ name: 'Sheet' + (s + 1), fns });
      }
      this.sheet = 0; this.sel = 0;
      this.view = DEFAULT_VIEW();
      this.table = { start: -5, end: 5, step: 1 };
      this.bottom = 'graph'; this.active = 'edit'; this.full = null; this.swapped = false;
      this.mode = 'pan'; this.trace = null; this.gs = null; this.prev = []; this.shade = null;
      if (saved) {
        try {
          saved.sheets.forEach((sh, s) => {
            if (!this.sheets[s]) return;
            this.sheets[s].name = sh.name || this.sheets[s].name;
            sh.fns.forEach((f, i) => { if (this.sheets[s].fns[i]) Object.assign(this.sheets[s].fns[i], { items: f.items || [], on: !!f.on, type: f.type || 'y' }); });
          });
          Object.assign(this.view, saved.view || {});
          Object.assign(this.table, saved.table || {});
          this.sheet = saved.sheet || 0;
        } catch (e) { /* Standard */ }
      } else {
        // Beispiel wie auf dem Geraet: drei Funktionen auf Sheet1
        const ex = ['sin(x)', 'cos(2x)', 'sin(x+cos(2x))'];
        ex.forEach((t, i) => { this.sheets[0].fns[i] = { items: B.toJSON(MP.textToItems(t)), on: true, type: 'y' }; });
      }
      this.ed = new MP.Editor({ onChange: () => this.renderRow(this.sel) });
      this.loadSel();
    },
    save() {
      this.commitSel();
      return { sheets: this.sheets.map(s => ({ name: s.name, fns: s.fns.map(f => ({ items: f.items, on: f.on, type: f.type })) })), view: this.view, table: this.table, sheet: this.sheet };
    },
    fns() { return this.sheets[this.sheet].fns; },
    loadSel() { this.ed.setItems(B.fromJSON(this.fns()[this.sel].items)); },
    commitSel() {
      const f = this.fns()[this.sel];
      if (!f) return;
      const items = B.toJSON(this.ed.root.items);
      if (JSON.stringify(items) !== JSON.stringify(f.items)) {
        f.items = items;
        f.err = null;
      }
    },
    editor() { return this.active === 'edit' ? this.ed : null; },

    /* ---------- Aufbau ---------- */
    mount(work) {
      this.split = h('div', { class: 'split' });
      work.appendChild(this.split);
      this.wEdit = h('div', { class: 'win' });
      this.wBot = h('div', { class: 'win' });
      this.split.append(this.wEdit, this.wBot);
      this.buildEdit();
      this.buildBottom();
      this.layout();
    },
    hide() { this.commitSel(); },
    layout() {
      if (!this.split) return;
      this.split.textContent = '';
      const order = this.swapped ? [this.wBot, this.wEdit] : [this.wEdit, this.wBot];
      order.forEach(w => this.split.appendChild(w));
      this.wEdit.classList.toggle('active', this.active === 'edit');
      this.wBot.classList.toggle('active', this.active === 'graph');
      this.wEdit.classList.toggle('hide', this.full === 'graph');
      this.wBot.classList.toggle('hide', this.full === 'edit');
      this.wEdit.style.flex = this.full ? '1 1 100%' : '0.82 1 0';
      this.wBot.style.flex = this.full ? '1 1 100%' : '1 1 0';
      requestAnimationFrame(() => this.draw());
    },
    refresh() { this.renderRows(); this.buildBottom(); this.layout(); },
    onScale() { this.draw(); },
    setActive(w) {
      if (this.active === w) return;
      if (w !== 'edit') this.commitSel();
      this.active = w;
      this.layout();
      this.renderRows();
      App.refreshChrome();
    },
    swapFocus() { this.setActive(this.active === 'edit' ? 'graph' : 'edit'); },
    resize() { this.full = this.full ? null : this.active; this.layout(); },
    swap() { this.swapped = !this.swapped; this.layout(); },

    buildEdit() {
      const w = this.wEdit;
      w.textContent = '';
      const tabs = h('div', { class: 'sheets' });
      this.sheets.forEach((s, i) => {
        const b = h('button', { type: 'button', class: i === this.sheet ? 'on' : null, text: s.name });
        b.addEventListener('click', e => { e.stopPropagation(); this.commitSel(); this.sheet = i; this.sel = 0; this.loadSel(); this.trace = null; this.gs = null; this.buildEdit(); this.draw(); App.save(); });
        tabs.appendChild(b);
      });
      this.rowsEl = h('div', { class: 'frows' });
      w.append(tabs, this.rowsEl);
      w.addEventListener('pointerdown', () => this.setActive('edit'));
      this.renderRows();
    },
    label(f, i) { return (f.type === 'r' ? 'r' : f.type === 'x' ? 'x' : 'y') + (i + 1) + ':'; },
    renderRows() {
      if (!this.rowsEl) return;
      this.rowsEl.textContent = '';
      this.rowEls = [];
      this.fns().forEach((f, i) => {
        const cb = h('input', { type: 'checkbox', 'aria-label': 'Graph ' + this.label(f, i) + ' zeichnen' });
        cb.checked = f.on;
        cb.addEventListener('click', e => { e.stopPropagation(); f.on = cb.checked; this.trace = null; this.gs = null; this.draw(); this.renderTableIfShown(); App.save(); });
        const fx = h('div', { class: 'fx m' });
        const row = h('div', { class: 'frow' + (i === this.sel ? ' sel' : '') },
          cb, h('span', { class: 'fl', text: this.label(f, i) }), fx,
          f.err ? h('span', { class: 'fe', text: 'ERR' }) : null,
          h('span', { class: 'fs', style: 'border-color:' + COLORS[i % COLORS.length] }));
        row.addEventListener('pointerdown', e => {
          if (e.target === cb) return;
          e.preventDefault();
          this.setActive('edit');
          if (i !== this.sel) { this.commitSel(); this.sel = i; this.loadSel(); this.renderRows(); }
          this.ed.el = this.rowEls[i].fx;
          this.ed.placeFromEvent(e);
        });
        this.rowsEl.appendChild(row);
        this.rowEls[i] = { row, fx };
        this.renderRow(i);
      });
    },
    renderRow(i) {
      if (!this.rowEls || !this.rowEls[i]) return;
      const fx = this.rowEls[i].fx;
      if (i === this.sel && this.active === 'edit') {
        this.ed.render(fx, true);
        const r = this.rowEls[i].row;
        const box = this.rowsEl.getBoundingClientRect(), rr = r.getBoundingClientRect();
        if (rr.bottom > box.bottom || rr.top < box.top) r.scrollIntoView({ block: 'nearest' });
      } else {
        fx.textContent = '';
        const items = i === this.sel ? this.ed.root.items : B.fromJSON(this.fns()[i].items);
        fx.appendChild(B.render(B.row(i === this.sel ? B.clone(items) : items), {}));
      }
    },

    buildBottom() {
      const w = this.wBot;
      w.textContent = '';
      if (this.bottom === 'table') {
        this.tEl = h('div', { class: 'tview' });
        w.appendChild(this.tEl);
        this.renderTable();
        w.onpointerdown = () => this.setActive('graph');
        return;
      }
      this.gwrap = h('div', { class: 'gwrap ' + this.mode });
      this.canvas = h('canvas', { 'aria-label': 'Graphfenster' });
      this.info = h('div', { class: 'ginfo' });
      this.tag = h('div', { class: 'gtag' });
      this.gwrap.append(this.canvas, this.tag, this.info);
      w.appendChild(this.gwrap);
      w.onpointerdown = null;
      this.bindCanvas();
    },
    renderTableIfShown() { if (this.bottom === 'table') this.renderTable(); },

    /* ---------- Funktionen ---------- */
    visible() {
      this.commitSel();
      const out = [];
      this.cache = this.cache || {};
      const envKey = JSON.stringify([App.settings.angle, App.env.vars, App.env.fns]);
      this.fns().forEach((f, i) => {
        if (!f.on || !f.items.length) return;
        try {
          const v = f.type === 'r' ? 'θ' : f.type === 'x' ? 'y' : 'x';
          // Kompilierte Funktion merken: Verschieben und Zoomen zeichnen bis zu 60-mal pro Sekunde
          const key = this.sheet + ':' + i + ':' + f.type + ':' + JSON.stringify(f.items) + envKey;
          let fn = this.cache[key];
          if (!fn) {
            fn = compileItems(B.fromJSON(f.items), v);
            if (Object.keys(this.cache).length > 200) this.cache = {};
            this.cache[key] = fn;
          }
          f.err = null;
          out.push({ i, f, fn, type: f.type, color: COLORS[i % COLORS.length], name: this.label(f, i).slice(0, -1) });
        } catch (e) { f.err = 'ERR'; }
      });
      return out;
    },

    /* ---------- Zeichnen ---------- */
    draw() {
      if (this.bottom !== 'graph' || !this.canvas || !this.canvas.isConnected) return;
      const cv = this.canvas, W = cv.clientWidth, H = cv.clientHeight;
      if (!W || !H) return;
      const r = (window.devicePixelRatio || 1) * (App.scale || 1);
      cv.width = Math.round(W * r); cv.height = Math.round(H * r);
      const g = cv.getContext('2d');
      g.setTransform(r, 0, 0, r, 0, 0);
      const V = this.view, S = App.settings;
      const X = x => (x - V.xmin) / (V.xmax - V.xmin) * W, Y = y => H - (y - V.ymin) / (V.ymax - V.ymin) * H;
      this.X = X; this.Y = Y; this.W = W; this.H = H;
      g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
      // Raster
      const xs = V.xscl > 0 ? V.xscl : 1, ys = V.yscl > 0 ? V.yscl : 1;
      const nx = (V.xmax - V.xmin) / xs, ny = (V.ymax - V.ymin) / ys;
      if (S.grid && nx < 150 && ny < 150) {
        g.strokeStyle = '#cfe0f6'; g.lineWidth = 1;
        g.beginPath();
        for (let k = Math.ceil(V.xmin / xs); k * xs <= V.xmax; k++) { const px = Math.round(X(k * xs)) + 0.5; g.moveTo(px, 0); g.lineTo(px, H); }
        for (let k = Math.ceil(V.ymin / ys); k * ys <= V.ymax; k++) { const py = Math.round(Y(k * ys)) + 0.5; g.moveTo(0, py); g.lineTo(W, py); }
        g.stroke();
      }
      // Achsen
      const ax = Math.round(Y(0)) + 0.5, ay = Math.round(X(0)) + 0.5;
      if (S.axes) {
        g.strokeStyle = '#000'; g.lineWidth = 1;
        g.beginPath();
        if (V.ymin <= 0 && V.ymax >= 0) { g.moveTo(0, ax); g.lineTo(W, ax); }
        if (V.xmin <= 0 && V.xmax >= 0) { g.moveTo(ay, 0); g.lineTo(ay, H); }
        g.stroke();
        // Teilstriche
        g.beginPath();
        if (nx < 300 && V.ymin <= 0 && V.ymax >= 0) for (let k = Math.ceil(V.xmin / xs); k * xs <= V.xmax; k++) { const px = Math.round(X(k * xs)) + 0.5; g.moveTo(px, ax - 2); g.lineTo(px, ax + 2); }
        if (ny < 300 && V.xmin <= 0 && V.xmax >= 0) for (let k = Math.ceil(V.ymin / ys); k * ys <= V.ymax; k++) { const py = Math.round(Y(k * ys)) + 0.5; g.moveTo(ay - 2, py); g.lineTo(ay + 2, py); }
        g.stroke();
      }
      if (S.labels) {
        g.fillStyle = '#333'; g.font = '9px Helvetica, Arial, sans-serif';
        const stepX = xs * Math.max(1, Math.ceil(26 / (W / nx || 1))), stepY = ys * Math.max(1, Math.ceil(18 / (H / ny || 1)));
        const lx = Math.min(Math.max(ax, 2), H - 11), ly = Math.min(Math.max(ay, 2), W - 2);
        g.textAlign = 'center'; g.textBaseline = 'top';
        for (let k = Math.ceil(V.xmin / stepX); k * stepX <= V.xmax; k++) {
          if (k === 0) continue;
          const v = +(k * stepX).toPrecision(6);
          g.fillText(String(v).replace('-', '−'), X(k * stepX), lx + 3);
        }
        g.textAlign = ly > W - 30 ? 'right' : 'left'; g.textBaseline = 'middle';
        for (let k = Math.ceil(V.ymin / stepY); k * stepY <= V.ymax; k++) {
          if (k === 0) continue;
          const v = +(k * stepY).toPrecision(6);
          g.fillText(String(v).replace('-', '−'), g.textAlign === 'left' ? ly + 4 : ly - 4, Y(k * stepY));
        }
      }
      // Integral-Schattierung
      const vis = this.visible();
      this.vis = vis;
      if (this.shade) {
        const f = vis.find(v => v.i === this.shade.i);
        if (f) {
          g.fillStyle = 'rgba(26,79,216,.22)';
          g.beginPath();
          const a = this.shade.a, b = this.shade.b, n = 300;
          g.moveTo(X(a), Y(0));
          for (let k = 0; k <= n; k++) { const x = a + (b - a) * k / n, y = f.fn(x); g.lineTo(X(x), Y(isFinite(y) ? Math.max(V.ymin - 1e3, Math.min(V.ymax + 1e3, y)) : 0)); }
          g.lineTo(X(b), Y(0)); g.closePath(); g.fill();
        }
      }
      // Graphen
      vis.forEach(v => this.plot(g, v));
      this.renderOverlay(g);
    },
    plot(g, v) {
      const V = this.view, W = this.W, H = this.H, X = this.X, Y = this.Y;
      g.strokeStyle = v.color; g.lineWidth = 1.5; g.lineJoin = 'round';
      g.beginPath();
      let pen = false;
      const clampY = y => Math.max(-4 * H, Math.min(5 * H, y));
      if (v.type === 'y' || v.type === 'x') {
        const isY = v.type === 'y';
        const n = Math.ceil((isY ? W : H) * 2);
        let p0 = null;
        for (let k = 0; k <= n; k++) {
          const t = isY ? V.xmin + (V.xmax - V.xmin) * k / n : V.ymin + (V.ymax - V.ymin) * k / n;
          const val = v.fn(t);
          if (!isFinite(val)) { pen = false; p0 = null; continue; }
          const px = isY ? X(t) : X(val), py = isY ? Y(val) : Y(t);
          if (pen && p0) {
            const jump = isY ? Math.abs(py - p0[1]) : Math.abs(px - p0[0]);
            if (jump > (isY ? H : W)) {
              // Polstelle: Mittelwert pruefen
              const tm = t - (isY ? (V.xmax - V.xmin) : (V.ymax - V.ymin)) / n / 2;
              const vm = v.fn(tm);
              const lo = Math.min(p0[2], val), hi = Math.max(p0[2], val);
              if (!(vm >= lo && vm <= hi)) pen = false;
            }
          }
          if (pen) g.lineTo(isY ? px : clampY(px), isY ? clampY(py) : py);
          else g.moveTo(isY ? px : clampY(px), isY ? clampY(py) : py);
          pen = true;
          p0 = [px, py, val];
        }
      } else {
        const st = V.tstep > 0 ? V.tstep : Math.PI / 120;
        const n = Math.min(20000, Math.ceil((V.tmax - V.tmin) / st * 4));
        for (let k = 0; k <= n; k++) {
          const t = V.tmin + (V.tmax - V.tmin) * k / n;
          const rr = v.fn(App.settings.angle === 'deg' ? t * 180 / Math.PI : t);
          if (!isFinite(rr)) { pen = false; continue; }
          const px = X(rr * Math.cos(t)), py = Y(rr * Math.sin(t));
          if (pen) g.lineTo(px, py); else g.moveTo(px, py);
          pen = true;
        }
      }
      g.stroke();
    },
    renderOverlay(g) {
      const X = this.X, Y = this.Y;
      this.info.textContent = '';
      this.tag.textContent = '';
      const cross = (x, y, col) => {
        const px = X(x), py = Y(y);
        g.strokeStyle = col || '#000'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(px - 6, py); g.lineTo(px + 6, py); g.moveTo(px, py - 6); g.lineTo(px, py + 6); g.stroke();
        g.beginPath(); g.arc(px, py, 2.2, 0, 2 * Math.PI); g.fillStyle = col || '#000'; g.fill();
      };
      const inf = (...parts) => parts.forEach(p => this.info.appendChild(typeof p === 'string' ? h('span', { text: p }) : p));
      if (this.trace) {
        const v = (this.vis || []).find(q => q.i === this.trace.i);
        if (!v) { this.trace = null; return; }
        let x, y;
        if (v.type === 'y') { x = this.trace.t; y = v.fn(x); }
        else if (v.type === 'x') { y = this.trace.t; x = v.fn(y); }
        else { const r = v.fn(this.trace.t); x = r * Math.cos(this.trace.t); y = r * Math.sin(this.trace.t); }
        if (isFinite(x) && isFinite(y)) cross(x, y, v.color);
        this.tag.textContent = v.name + (v.type === 'r' ? '  θ=' + fmt(this.trace.t, 6) : '');
        if (App.settings.coords) inf(h('b', { text: 'x=' }), fmt(x, 7), h('b', { text: 'y=' }), fmt(y, 7));
      }
      if (this.gs) {
        const r = this.gs.list[this.gs.k];
        const v = (this.vis || []).find(q => q.i === this.gs.i);
        this.tag.textContent = (v ? v.name + '  ' : '') + this.gs.label;
        if (r) {
          cross(r.x, r.y, v ? v.color : '#000');
          if (r.val !== undefined) inf(h('b', { text: this.gs.label === '∫dx' ? '∫dx=' : this.gs.label + '=' }), fmt(r.val, 10));
          else inf(h('b', { text: 'x=' }), fmt(r.x, 10), h('b', { text: 'y=' }), fmt(r.y, 10));
          if (this.gs.list.length > 1) inf('(' + (this.gs.k + 1) + '/' + this.gs.list.length + ' ◀▶)');
        } else inf('Not Found');
      }
      if (this.boxRect) {
        const b = this.boxRect;
        g.strokeStyle = '#000'; g.setLineDash([3, 3]); g.lineWidth = 1;
        g.strokeRect(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1), Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
        g.setLineDash([]);
      }
    },

    /* ---------- Maus / Trackpad ---------- */
    bindCanvas() {
      const wrap = this.gwrap;
      let drag = null;
      const pos = e => {
        const r = this.canvas.getBoundingClientRect();
        return { x: (e.clientX - r.left) / (App.scale || 1), y: (e.clientY - r.top) / (App.scale || 1) };
      };
      const toX = px => this.view.xmin + px / this.W * (this.view.xmax - this.view.xmin);
      const toY = py => this.view.ymax - py / this.H * (this.view.ymax - this.view.ymin);
      wrap.addEventListener('pointerdown', e => {
        e.preventDefault();
        this.setActive('graph');
        const p = pos(e);
        if (this.mode === 'trace') { this.traceAt(toX(p.x)); return; }
        wrap.setPointerCapture(e.pointerId);
        drag = { p, v: Object.assign({}, this.view), moved: false };
        if (this.mode === 'box') this.boxRect = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
        else wrap.classList.add('drag');
      });
      wrap.addEventListener('pointermove', e => {
        if (!drag) return;
        const p = pos(e);
        if (this.mode === 'box') { this.boxRect.x1 = p.x; this.boxRect.y1 = p.y; this.draw(); return; }
        const dx = (p.x - drag.p.x) / this.W * (drag.v.xmax - drag.v.xmin), dy = (p.y - drag.p.y) / this.H * (drag.v.ymax - drag.v.ymin);
        if (Math.abs(p.x - drag.p.x) + Math.abs(p.y - drag.p.y) > 2) drag.moved = true;
        Object.assign(this.view, { xmin: drag.v.xmin - dx, xmax: drag.v.xmax - dx, ymin: drag.v.ymin + dy, ymax: drag.v.ymax + dy });
        this.draw();
      });
      const end = () => {
        if (!drag) return;
        wrap.classList.remove('drag');
        if (this.mode === 'box' && this.boxRect) {
          const b = this.boxRect;
          if (Math.abs(b.x1 - b.x0) > 4 && Math.abs(b.y1 - b.y0) > 4) {
            this.pushView();
            const x0 = toX(Math.min(b.x0, b.x1)), x1 = toX(Math.max(b.x0, b.x1)), y0 = toY(Math.max(b.y0, b.y1)), y1 = toY(Math.min(b.y0, b.y1));
            Object.assign(this.view, { xmin: x0, xmax: x1, ymin: y0, ymax: y1 });
            this.niceScale();
          }
          this.boxRect = null;
          this.mode = 'pan';
          wrap.className = 'gwrap pan';
          App.refreshChrome();
        } else if (drag.moved) this.prev.push(drag.v);
        drag = null;
        this.draw();
        App.save();
      };
      wrap.addEventListener('pointerup', end);
      wrap.addEventListener('pointercancel', end);
      wrap.addEventListener('wheel', e => {
        e.preventDefault();
        const p = pos(e);
        const k = Math.exp((e.ctrlKey ? e.deltaY * 2.5 : e.deltaY) * 0.0018);
        this.zoomAt(toX(p.x), toY(p.y), k);
      }, { passive: false });
    },
    zoomAt(cx, cy, k) {
      const V = this.view;
      Object.assign(V, { xmin: cx - (cx - V.xmin) * k, xmax: cx + (V.xmax - cx) * k, ymin: cy - (cy - V.ymin) * k, ymax: cy + (V.ymax - cy) * k });
      this.niceScale();
      this.draw();
      App.save();
    },
    niceScale() {
      const V = this.view;
      const nice = span => { const raw = span / 10; const p = Math.pow(10, Math.floor(Math.log10(raw))); const m = raw / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p; };
      V.xscl = +nice(V.xmax - V.xmin).toPrecision(6);
      V.yscl = +nice(V.ymax - V.ymin).toPrecision(6);
    },
    pushView() { this.prev.push(Object.assign({}, this.view)); if (this.prev.length > 30) this.prev.shift(); },

    /* ---------- Zoom-Befehle ---------- */
    zoom(kind) {
      const V = this.view;
      this.pushView();
      const aspect = (this.H || 230) / (this.W || 316);
      const cx = (V.xmin + V.xmax) / 2, cy = (V.ymin + V.ymax) / 2;
      switch (kind) {
        case 'in': this.prev.pop(); this.pushView(); return this.zoomAt(cx, cy, 0.5);
        case 'out': this.prev.pop(); this.pushView(); return this.zoomAt(cx, cy, 2);
        case 'init': Object.assign(V, { xmin: -7.7, xmax: 7.7, xscl: 1, ymin: -7.7 * aspect, ymax: 7.7 * aspect, yscl: 1 }); break;
        case 'std': Object.assign(V, { xmin: -10, xmax: 10, xscl: 1, ymin: -10, ymax: 10, yscl: 1 }); break;
        case 'trig': {
          const deg = App.settings.angle === 'deg';
          Object.assign(V, { xmin: deg ? -540 : -3 * Math.PI, xmax: deg ? 540 : 3 * Math.PI, xscl: deg ? 90 : Math.PI / 2, ymin: -1.6, ymax: 1.6, yscl: 0.5 });
          break;
        }
        case 'square': { const hy = (V.xmax - V.xmin) * aspect / 2; Object.assign(V, { ymin: cy - hy, ymax: cy + hy }); break; }
        case 'int': { const hw = (this.W || 316) / 2, hh = (this.H || 230) / 2; Object.assign(V, { xmin: Math.round(cx) - hw, xmax: Math.round(cx) + hw, ymin: Math.round(cy) - hh, ymax: Math.round(cy) + hh, xscl: 10, yscl: 10 }); break; }
        case 'auto': {
          let lo = Infinity, hi = -Infinity;
          (this.visible()).filter(v => v.type === 'y').forEach(v => {
            for (let k = 0; k <= 400; k++) {
              const y = v.fn(V.xmin + (V.xmax - V.xmin) * k / 400);
              if (isFinite(y) && Math.abs(y) < 1e12) { lo = Math.min(lo, y); hi = Math.max(hi, y); }
            }
          });
          if (isFinite(lo)) { const pad = (hi - lo || 1) * 0.08; Object.assign(V, { ymin: lo - pad, ymax: hi + pad }); }
          this.niceScale();
          V.xscl = this.prev[this.prev.length - 1].xscl;
          break;
        }
        case 'prev': this.prev.pop(); if (this.prev.length) Object.assign(V, this.prev.pop()); break;
        case 'box': this.prev.pop(); this.mode = 'box'; this.trace = null; this.gs = null; if (this.gwrap) this.gwrap.className = 'gwrap box'; App.refreshChrome(); return;
      }
      this.draw();
    },
    viewWindow() {
      const V = this.view;
      const f = (id, l, v) => h('div', { class: 'row' }, h('label', { for: id, text: l }), h('input', { type: 'text', id, value: String(+(+v).toPrecision(10)), spellcheck: 'false', autocomplete: 'off' }));
      App.dialog({
        title: 'View Window',
        body: [f('vw-xmin', 'xmin', V.xmin), f('vw-xmax', 'xmax', V.xmax), f('vw-xscl', 'xscale', V.xscl), f('vw-ymin', 'ymin', V.ymin), f('vw-ymax', 'ymax', V.ymax), f('vw-yscl', 'yscale', V.yscl),
          h('div', { style: 'margin:6px 0 2px;color:#555', text: 'r= Graphen (θ)' }), f('vw-tmin', 'tθmin', V.tmin), f('vw-tmax', 'tθmax', V.tmax), f('vw-tst', 'tθstep', V.tstep)],
        buttons: [{ label: 'Default', action: () => { Object.assign(this.view, DEFAULT_VIEW()); this.draw(); } }],
        ok: d => {
          const g = id => evalNum(d.querySelector('#' + id).value);
          const n = { xmin: g('vw-xmin'), xmax: g('vw-xmax'), xscl: g('vw-xscl'), ymin: g('vw-ymin'), ymax: g('vw-ymax'), yscl: g('vw-yscl'), tmin: g('vw-tmin'), tmax: g('vw-tmax'), tstep: g('vw-tst') };
          if (Object.values(n).some(v => !isFinite(v)) || n.xmin >= n.xmax || n.ymin >= n.ymax || n.tmin >= n.tmax || n.tstep <= 0) { App.error('Range ERROR'); return false; }
          this.pushView();
          Object.assign(this.view, n);
          this.draw();
        }
      });
    },

    /* ---------- Trace ---------- */
    startTrace() {
      const vis = this.visible();
      if (!vis.length) { App.error('No Graph Selected'); return; }
      if (this.bottom !== 'graph') { this.bottom = 'graph'; this.buildBottom(); }
      this.gs = null; this.shade = null;
      const v = vis[0];
      const mid = v.type === 'y' ? (this.view.xmin + this.view.xmax) / 2 : v.type === 'x' ? (this.view.ymin + this.view.ymax) / 2 : this.view.tmin;
      this.trace = { i: v.i, t: +mid.toPrecision(12) };
      this.mode = 'trace';
      this.setActive('graph');
      if (this.gwrap) this.gwrap.className = 'gwrap trace';
      this.draw();
      App.refreshChrome();
    },
    traceAt(x) {
      if (!this.trace) return;
      const v = (this.vis || []).find(q => q.i === this.trace.i);
      if (v && v.type === 'y') { this.trace.t = x; this.draw(); }
    },
    stepTrace(dir) {
      const v = (this.vis || []).find(q => q.i === this.trace.i);
      if (!v) return;
      const st = v.type === 'r' ? (this.view.tstep || Math.PI / 120) : v.type === 'x' ? (this.view.ymax - this.view.ymin) / this.H : (this.view.xmax - this.view.xmin) / this.W;
      this.trace.t += dir * st;
      if (v.type === 'y') {
        const V = this.view;
        if (this.trace.t > V.xmax || this.trace.t < V.xmin) { const d = (V.xmax - V.xmin) / 2 * dir; V.xmin += d; V.xmax += d; }
      }
      this.draw();
    },
    nextGraph(dir, which) {
      const vis = this.vis || [];
      if (vis.length < 2) return;
      const obj = which === 'gs' ? this.gs : this.trace;
      const k = vis.findIndex(v => v.i === obj.i);
      obj.i = vis[(k + dir + vis.length) % vis.length].i;
      if (which === 'gs') this.gsolve(this.gs.kind, true);
      else this.draw();
    },

    /* ---------- G-Solve ---------- */
    gsolve(kind, keep) {
      const vis = this.visible();
      this.vis = vis;
      const yfs = vis.filter(v => v.type === 'y');
      if (!yfs.length) { App.error('No Graph Selected'); return; }
      if (this.bottom !== 'graph') { this.bottom = 'graph'; this.buildBottom(); }
      let i = keep && this.gs ? this.gs.i : this.trace ? this.trace.i : yfs[0].i;
      let v = yfs.find(q => q.i === i) || yfs[0];
      i = v.i;
      const V = this.view, f = v.fn;
      const LBL = { root: 'Root', max: 'Max', min: 'Min', fmax: 'fMax', fmin: 'fMin', yint: 'y-Intercept', isect: 'Intersection', ycal: 'y-Cal', xcal: 'x-Cal', infl: 'Inflection', int: '∫dx' };
      const set = (list, extra) => {
        this.trace = null; this.mode = 'pan';
        if (this.gwrap) this.gwrap.className = 'gwrap pan';
        this.gs = Object.assign({ kind, label: LBL[kind], i, list, k: 0 }, extra || {});
        this.setActive('graph');
        this.draw();
        App.refreshChrome();
      };
      this.shade = null;
      switch (kind) {
        case 'root': return set(NUM.roots(f, V.xmin, V.xmax, 3000).map(x => ({ x, y: 0 })));
        case 'max': case 'min': return set(NUM.extrema(f, V.xmin, V.xmax, kind === 'max', 2000));
        case 'fmax': case 'fmin': {
          const c = NUM.extrema(f, V.xmin, V.xmax, kind === 'fmax', 2000);
          [V.xmin, V.xmax].forEach(x => { if (isFinite(f(x))) c.push({ x, y: f(x) }); });
          const best = c.reduce((m, p) => (!m || (kind === 'fmax' ? p.y > m.y : p.y < m.y) ? p : m), null);
          return set(best ? [best] : []);
        }
        case 'yint': return set(isFinite(f(0)) ? [{ x: 0, y: f(0) }] : []);
        case 'infl': {
          const d2 = x => NUM.derivative2(f, x);
          return set(NUM.roots(d2, V.xmin, V.xmax, 1200).filter(x => Math.abs(NUM.derivative2(f, x - 1e-3) - NUM.derivative2(f, x + 1e-3)) > 1e-9).map(x => ({ x, y: f(x) })));
        }
        case 'isect': {
          if (yfs.length < 2) { App.error('Select two graphs'); return; }
          const k = yfs.findIndex(q => q.i === i), w = yfs[(k + 1) % yfs.length];
          return set(NUM.roots(x => f(x) - w.fn(x), V.xmin, V.xmax, 3000).map(x => ({ x, y: f(x) })));
        }
        case 'ycal':
          App.dialog({
            title: 'y-Cal', body: [h('div', { class: 'row' }, h('label', { for: 'gc-x', text: 'x-Cal x =' }), h('input', { type: 'text', id: 'gc-x', value: '0' }))],
            ok: d => { const x = evalNum(d.querySelector('#gc-x').value); if (!isFinite(x)) { App.error('Syntax ERROR'); return false; } set([{ x, y: f(x) }]); }
          });
          return;
        case 'xcal':
          App.dialog({
            title: 'x-Cal', body: [h('div', { class: 'row' }, h('label', { for: 'gc-y', text: 'y =' }), h('input', { type: 'text', id: 'gc-y', value: '0' }))],
            ok: d => { const y = evalNum(d.querySelector('#gc-y').value); if (!isFinite(y)) { App.error('Syntax ERROR'); return false; } set(NUM.roots(x => f(x) - y, V.xmin, V.xmax, 3000).map(x => ({ x, y }))); }
          });
          return;
        case 'int':
          App.dialog({
            title: '∫dx', body: [
              h('div', { class: 'row' }, h('label', { for: 'gi-a', text: 'Lower' }), h('input', { type: 'text', id: 'gi-a', value: String(+(V.xmin + (V.xmax - V.xmin) * 0.25).toPrecision(3)) })),
              h('div', { class: 'row' }, h('label', { for: 'gi-b', text: 'Upper' }), h('input', { type: 'text', id: 'gi-b', value: String(+(V.xmin + (V.xmax - V.xmin) * 0.6).toPrecision(3)) }))],
            ok: d => {
              const a = evalNum(d.querySelector('#gi-a').value), b = evalNum(d.querySelector('#gi-b').value);
              if (!isFinite(a) || !isFinite(b)) { App.error('Syntax ERROR'); return false; }
              const val = NUM.integrate(f, Math.min(a, b), Math.max(a, b)) * (a <= b ? 1 : -1);
              set([{ x: b, y: f(b), val }]);
              this.shade = { i, a: Math.min(a, b), b: Math.max(a, b) };
              this.draw();
            }
          });
          return;
      }
    },
    cycle(dir) {
      if (!this.gs || !this.gs.list.length) return;
      this.gs.k = (this.gs.k + dir + this.gs.list.length) % this.gs.list.length;
      this.draw();
    },

    /* ---------- Tabelle ---------- */
    showTable() {
      this.commitSel();
      this.bottom = 'table'; this.trace = null; this.gs = null;
      this.buildBottom();
      this.setActive('graph');
      this.layout();
      App.refreshChrome();
    },
    showGraph() {
      this.commitSel();
      this.bottom = 'graph';
      this.buildBottom();
      this.setActive('graph');
      this.layout();
      App.refreshChrome();
    },
    renderTable() {
      if (!this.tEl) return;
      const vis = this.visible().filter(v => v.type === 'y');
      const T = this.table;
      const tb = h('table');
      const hr = h('tr', null, h('th', { text: 'x' }));
      vis.forEach(v => hr.appendChild(h('th', { text: v.name, style: 'color:' + v.color })));
      tb.appendChild(h('thead', null, hr));
      const body = h('tbody');
      const n = Math.min(999, Math.floor((T.end - T.start) / T.step + 1e-9) + 1);
      for (let k = 0; k < n; k++) {
        const x = +(T.start + k * T.step).toPrecision(12);
        const tr = h('tr', null, h('td', { text: fmt(x, 6) }));
        vis.forEach(v => tr.appendChild(h('td', { text: fmt(v.fn(x), 6) })));
        body.appendChild(tr);
      }
      tb.appendChild(body);
      this.tEl.textContent = '';
      this.tEl.appendChild(tb);
      if (!vis.length) this.tEl.appendChild(h('div', { style: 'padding:8px;color:#666', text: 'Keine y=-Funktion ausgewählt.' }));
    },
    tableInput() {
      const T = this.table;
      const f = (id, l, v) => h('div', { class: 'row' }, h('label', { for: id, text: l }), h('input', { type: 'text', id, value: String(v) }));
      App.dialog({
        title: 'Table Input', body: [f('ti-s', 'Start', T.start), f('ti-e', 'End', T.end), f('ti-st', 'Step', T.step)],
        ok: d => {
          const s = evalNum(d.querySelector('#ti-s').value), e = evalNum(d.querySelector('#ti-e').value), st = evalNum(d.querySelector('#ti-st').value);
          if (!isFinite(s) || !isFinite(e) || !(st > 0) || e < s) { App.error('Range ERROR'); return false; }
          Object.assign(this.table, { start: s, end: e, step: st });
          if (this.bottom === 'table') this.renderTable();
        }
      });
    },

    /* ---------- Tasten ---------- */
    key(k) {
      if (this.active === 'edit') {
        if (k === 'EXE') {
          this.commitSel();
          const f = this.fns()[this.sel];
          if (f.items.length) {
            try { compileItems(B.fromJSON(f.items), f.type === 'r' ? 'θ' : f.type === 'x' ? 'y' : 'x'); f.err = null; f.on = true; }
            catch (e) { f.err = 'ERR'; App.error(e instanceof C.MathError ? e.message : 'Syntax ERROR'); this.renderRows(); return true; }
          }
          this.sel = Math.min(NROWS - 1, this.sel + 1);
          this.loadSel();
          this.renderRows();
          this.draw();
          this.renderTableIfShown();
          return true;
        }
        if (k === 'UP' || k === 'DOWN') {
          if (k === 'UP' ? this.ed.up() : this.ed.down()) return true;
          this.commitSel();
          this.sel = Math.max(0, Math.min(NROWS - 1, this.sel + (k === 'UP' ? -1 : 1)));
          this.loadSel();
          this.renderRows();
          return true;
        }
        if (k === 'ESC') return true;
        return false;
      }
      // Graphfenster aktiv
      if (k === 'ESC' || k === 'CLEAR') {
        this.trace = null; this.gs = null; this.shade = null;
        if (this.mode !== 'pan') { this.mode = 'pan'; if (this.gwrap) this.gwrap.className = 'gwrap pan'; }
        this.draw();
        App.refreshChrome();
        return true;
      }
      if (this.bottom === 'table') {
        if (k === 'UP' || k === 'DOWN') { this.tEl.scrollTop += k === 'DOWN' ? 16 : -16; return true; }
        return true;
      }
      if (this.gs) {
        if (k === 'LEFT' || k === 'RIGHT') { this.cycle(k === 'RIGHT' ? 1 : -1); return true; }
        if (k === 'UP' || k === 'DOWN') { this.nextGraph(k === 'DOWN' ? 1 : -1, 'gs'); return true; }
        return true;
      }
      if (this.trace) {
        if (k === 'LEFT' || k === 'RIGHT') { this.stepTrace(k === 'RIGHT' ? 1 : -1); return true; }
        if (k === 'UP' || k === 'DOWN') { this.nextGraph(k === 'DOWN' ? 1 : -1, 'trace'); return true; }
        return true;
      }
      const V = this.view;
      const dx = (V.xmax - V.xmin) * 0.1, dy = (V.ymax - V.ymin) * 0.1;
      if (k === 'LEFT') { V.xmin -= dx; V.xmax -= dx; }
      else if (k === 'RIGHT') { V.xmin += dx; V.xmax += dx; }
      else if (k === 'UP') { V.ymin += dy; V.ymax += dy; }
      else if (k === 'DOWN') { V.ymin -= dy; V.ymax -= dy; }
      else if (k === '+') { this.zoom('in'); return true; }
      else if (k === '−') { this.zoom('out'); return true; }
      else return true;
      this.draw();
      return true;
    },
    copy() { App.copyText(this.ed.text()); },

    /* ---------- Menues & Toolbar ---------- */
    menus() {
      const gsItems = [['Root', 'root'], ['Max', 'max'], ['Min', 'min'], ['fMax', 'fmax'], ['fMin', 'fmin'], ['y-Intercept', 'yint'], ['Intersection', 'isect'], ['y-Cal', 'ycal'], ['x-Cal', 'xcal'], ['Inflection', 'infl'], ['∫dx', 'int']]
        .map(([l, k]) => ({ label: l, action: () => this.gsolve(k) }));
      const zoomItems = [['Box', 'box'], ['Zoom In', 'in'], ['Zoom Out', 'out'], ['Auto', 'auto'], ['Square', 'square'], ['Integer', 'int'], ['Previous', 'prev'], { sep: true }, ['Quick Initialize', 'init'], ['Quick Trig', 'trig'], ['Quick Standard', 'std']]
        .map(x => (x.sep ? x : { label: x[0], action: () => this.zoom(x[1]) }));
      const typeItems = [['y=', 'y'], ['r=', 'r'], ['x=', 'x']].map(([l, t]) => ({ label: l, check: this.fns()[this.sel].type === t, action: () => { this.fns()[this.sel].type = t; this.renderRows(); this.draw(); } }));
      const common = [
        { label: 'View Window…', action: () => this.viewWindow() },
        { label: 'Table Input…', action: () => this.tableInput() }
      ];
      if (this.active === 'edit') {
        return [
          {
            label: 'Edit', items: [
              { label: 'Delete', action: () => { this.ed.clear(); this.commitSel(); this.fns()[this.sel].on = false; this.renderRows(); this.draw(); } },
              { label: 'Clear Sheet', action: () => { this.fns().forEach(f => { f.items = []; f.on = false; f.err = null; }); this.loadSel(); this.renderRows(); this.draw(); } },
              { label: 'Select All', action: () => { this.fns().forEach(f => { if (f.items.length) f.on = true; }); this.renderRows(); this.draw(); } },
              { label: 'Clear Selection', action: () => { this.fns().forEach(f => { f.on = false; }); this.renderRows(); this.draw(); } }
            ]
          },
          { label: 'Type', items: typeItems },
          { label: 'Graph', items: [{ label: 'Draw Graph', action: () => this.showGraph() }, { label: 'Table', action: () => this.showTable() }].concat(common) }
        ];
      }
      return [
        { label: 'Zoom', items: zoomItems },
        { label: 'Analysis', items: [{ label: 'Trace', action: () => this.startTrace() }, { label: 'G-Solve', sub: gsItems }] },
        { label: 'Graph', items: [{ label: 'Table', action: () => this.showTable() }, { label: 'Graph', action: () => this.showGraph() }].concat(common) }
      ];
    },
    toolbar() {
      const I = {
        graph: svg('<path d="M2 17h16M3 2v16"/><path d="M3 13c3-9 5-9 7-4s4 5 7-4"/>'),
        table: svg('<rect x="2.5" y="3.5" width="15" height="13"/><path d="M2.5 7.5h15M8 3.5v13M12.5 3.5v13"/>'),
        view: svg('<rect x="2.5" y="3.5" width="15" height="13"/><path d="M6 7h8M6 10h8M6 13h5"/>'),
        pan: svg('<path d="M10 2v16M2 10h16M10 2l-2 2M10 2l2 2M10 18l-2-2M10 18l2-2M2 10l2-2M2 10l2 2M18 10l-2-2M18 10l-2 2"/>'),
        zin: svg('<circle cx="8.5" cy="8.5" r="5.5"/><path d="M13 13l4.5 4.5M6 8.5h5M8.5 6v5"/>'),
        zout: svg('<circle cx="8.5" cy="8.5" r="5.5"/><path d="M13 13l4.5 4.5M6 8.5h5"/>'),
        box: svg('<rect x="3" y="4" width="11" height="9" stroke-dasharray="2 1.6"/><path d="M12 11l5 5"/>'),
        trace: svg('<path d="M2 15c4-10 8-10 16-4"/><path d="M11 5v8M7 9h8"/>'),
        edit: svg('<path d="M3 5h10M3 9h10M3 13h6"/><path d="M14 12l3 3-3 3"/>')
      };
      if (this.active === 'edit') {
        return [
          { icon: I.graph, title: 'Graph zeichnen', action: () => this.showGraph() },
          { icon: I.table, title: 'Tabelle', action: () => this.showTable() },
          { icon: I.view, title: 'View Window', action: () => this.viewWindow() },
          { label: this.fns()[this.sel].type + '=', title: 'Typ', menu: () => [['y=', 'y'], ['r=', 'r'], ['x=', 'x']].map(([l, t]) => ({ label: l, action: () => { this.fns()[this.sel].type = t; this.renderRows(); this.draw(); App.refreshChrome(); } })) },
          { label: 'Trace', title: 'Trace', action: () => this.startTrace() },
          { label: 'G-Sol', title: 'G-Solve', menu: () => this.menus().length ? [['Root', 'root'], ['Max', 'max'], ['Min', 'min'], ['Intersection', 'isect'], ['y-Intercept', 'yint'], ['∫dx', 'int'], ['y-Cal', 'ycal'], ['x-Cal', 'xcal'], ['Inflection', 'infl']].map(([l, k]) => ({ label: l, action: () => this.gsolve(k) })) : [] }
        ];
      }
      return [
        { icon: I.edit, title: 'Funktionseditor', action: () => this.setActive('edit') },
        { icon: I.pan, title: 'Verschieben', on: this.mode === 'pan' && !this.trace && !this.gs, action: () => { this.mode = 'pan'; this.trace = null; this.gs = null; if (this.gwrap) this.gwrap.className = 'gwrap pan'; this.draw(); App.refreshChrome(); } },
        { icon: I.zin, title: 'Zoom In', action: () => this.zoom('in') },
        { icon: I.zout, title: 'Zoom Out', action: () => this.zoom('out') },
        { icon: I.box, title: 'Zoom Box', on: this.mode === 'box', action: () => this.zoom('box') },
        { icon: I.trace, title: 'Trace', on: !!this.trace, action: () => this.startTrace() },
        { label: 'G-Sol', title: 'G-Solve', menu: () => [['Root', 'root'], ['Max', 'max'], ['Min', 'min'], ['fMax', 'fmax'], ['fMin', 'fmin'], ['Intersection', 'isect'], ['y-Intercept', 'yint'], ['∫dx', 'int'], ['y-Cal', 'ycal'], ['x-Cal', 'xcal'], ['Inflection', 'infl']].map(([l, k]) => ({ label: l, action: () => this.gsolve(k) })) },
        { icon: this.bottom === 'table' ? I.graph : I.table, title: this.bottom === 'table' ? 'Graph' : 'Tabelle', action: () => (this.bottom === 'table' ? this.showGraph() : this.showTable()) }
      ];
    },
    // Regressionsformel aus der Statistik uebernehmen
    addFormula(text) {
      const fns = this.fns();
      let i = fns.findIndex(f => !f.items.length);
      if (i < 0) i = NROWS - 1;
      fns[i] = { items: B.toJSON(MP.textToItems(text)), on: true, type: 'y' };
      if (this.sel === i) this.loadSel();
      return 'y' + (i + 1);
    }
  };
  App.register('graph', G);
})(window.MP = window.MP || {});

/* MathPad II — 3D Graph: z = f(x, y) als schattierte Flaeche, Drehen mit der Maus */
(function (MP) {
  'use strict';
  const App = MP.App, B = MP.B, NUM = MP.num, h = App.h, svg = App.svg;
  const NZ = 3;

  const G3 = {
    title: '3D Graph',
    statusKinds: ['angle'],
    init(saved) {
      this.rows = [];
      for (let i = 0; i < NZ; i++) this.rows.push({ items: [], on: false });
      this.view = { xmin: -3, xmax: 3, ymin: -3, ymax: 3, zmin: -3, zmax: 3, zauto: 1, n: 26 };
      this.rot = { az: -0.75, el: 0.55, zoom: 1 };
      this.sel = 0;
      this.active = 'edit';
      if (saved) {
        (saved.rows || []).forEach((r, i) => { if (this.rows[i]) Object.assign(this.rows[i], r); });
        Object.assign(this.view, saved.view || {});
        Object.assign(this.rot, saved.rot || {});
      } else this.rows[0] = { items: B.toJSON(MP.textToItems('sin(x)*cos(y)')), on: true };
      this.ed = new MP.Editor({ onChange: () => this.renderRow(this.sel) });
      this.ed.setItems(B.fromJSON(this.rows[0].items));
    },
    save() { this.commit(); return { rows: this.rows, view: this.view, rot: this.rot }; },
    commit() { this.rows[this.sel].items = B.toJSON(this.ed.root.items); },
    editor() { return this.active === 'edit' ? this.ed : null; },
    mount(work) {
      this.split = h('div', { class: 'split' });
      this.wTop = h('div', { class: 'win', style: 'flex:0 0 auto' });
      this.wBot = h('div', { class: 'win' });
      this.rowsEl = h('div', { class: 'frows', style: 'flex:none' });
      this.wTop.append(h('div', { class: 'sheets' }, h('button', { type: 'button', class: 'on', text: '3D Graph Editor' })), this.rowsEl);
      this.wrap = h('div', { class: 'gwrap pan' });
      this.canvas = h('canvas', { 'aria-label': '3D-Grafik' });
      this.info = h('div', { class: 'ginfo' });
      this.wrap.append(this.canvas, this.info);
      this.wBot.appendChild(this.wrap);
      this.bind();
      this.wTop.addEventListener('pointerdown', () => this.setActive('edit'));
      this.wBot.addEventListener('pointerdown', () => this.setActive('graph'));
      this.split.append(this.wTop, this.wBot);
      work.appendChild(this.split);
      this.renderRows();
      this.layout();
    },
    hide() { this.commit(); },
    layout() {
      if (!this.split) return;
      this.wTop.classList.toggle('active', this.active === 'edit');
      this.wBot.classList.toggle('active', this.active === 'graph');
      this.wTop.classList.toggle('hide', this.full === 'graph');
      requestAnimationFrame(() => this.draw());
    },
    refresh() { this.renderRows(); this.layout(); },
    onScale() { this.draw(); },
    resize() { this.full = this.full ? null : 'graph'; this.layout(); },
    swapFocus() { this.setActive(this.active === 'edit' ? 'graph' : 'edit'); },
    setActive(a) { if (this.active === a) return; if (a !== 'edit') this.commit(); this.active = a; this.layout(); this.renderRows(); App.refreshChrome(); },
    renderRows() {
      if (!this.rowsEl) return;
      this.rowsEl.textContent = '';
      this.rowEls = [];
      this.rows.forEach((r, i) => {
        const cb = h('input', { type: 'checkbox', 'aria-label': 'z' + (i + 1) + ' zeichnen' });
        cb.checked = r.on;
        cb.addEventListener('click', e => { e.stopPropagation(); r.on = cb.checked; this.draw(); App.save(); });
        const col = App.pal().curves[i];
        const fx = h('div', { class: 'fx m', style: 'color:' + col });
        const row = h('div', { class: 'frow' + (i === this.sel ? ' sel' : '') }, cb, h('span', { class: 'fl', style: 'color:' + col, text: 'z' + (i + 1) + (r.items.length ? '=' : ':') }), fx);
        row.addEventListener('pointerdown', e => {
          if (e.target === cb) return;
          e.preventDefault();
          this.setActive('edit');
          if (i !== this.sel) { this.commit(); this.sel = i; this.ed.setItems(B.fromJSON(r.items)); this.renderRows(); }
        });
        this.rowsEl.appendChild(row);
        this.rowEls[i] = fx;
        this.renderRow(i);
      });
    },
    renderRow(i) {
      const fx = this.rowEls && this.rowEls[i];
      if (!fx) return;
      if (i === this.sel && this.active === 'edit') this.ed.render(fx, true);
      else { fx.textContent = ''; fx.appendChild(B.render(B.row(B.fromJSON(this.rows[i].items)), {})); }
    },
    bind() {
      let d = null;
      this.wrap.addEventListener('pointerdown', e => { e.preventDefault(); this.wrap.setPointerCapture(e.pointerId); d = { x: e.clientX, y: e.clientY, az: this.rot.az, el: this.rot.el }; this.wrap.classList.add('drag'); });
      this.wrap.addEventListener('pointermove', e => {
        if (!d) return;
        const s = App.scale || 1;
        this.rot.az = d.az - (e.clientX - d.x) / s * 0.01;
        this.rot.el = Math.max(-1.5, Math.min(1.5, d.el + (e.clientY - d.y) / s * 0.01));
        this.draw();
      });
      const end = () => { d = null; this.wrap.classList.remove('drag'); App.save(); };
      this.wrap.addEventListener('pointerup', end);
      this.wrap.addEventListener('pointercancel', end);
      this.wrap.addEventListener('wheel', e => { e.preventDefault(); this.rot.zoom = Math.max(0.3, Math.min(4, this.rot.zoom * Math.exp(-e.deltaY * 0.0015))); this.draw(); }, { passive: false });
    },
    draw() {
      if (!this.canvas) return;
      const s = MP.Plot.setup(this.canvas);
      if (!s) return;
      const { g, W, H } = s;
      const P = App.pal();
      this.commit();
      const V = this.view, n = Math.max(8, Math.min(60, Math.round(V.n)));
      const surfaces = [];
      this.rows.forEach((r, i) => {
        if (!r.on || !r.items.length) return;
        try {
          const f = NUM.compile(B.parse(B.row(B.fromJSON(r.items)), App.env.userFns), ['x', 'y'], { angle: App.settings.angle, values: MP.numericVars(), fns: App.env.fns });
          const zs = [];
          for (let a = 0; a <= n; a++) { zs.push([]); for (let b = 0; b <= n; b++) zs[a].push(f(V.xmin + (V.xmax - V.xmin) * a / n, V.ymin + (V.ymax - V.ymin) * b / n)); }
          surfaces.push({ i, zs });
        } catch (e) { /* Zeile fehlerhaft: ueberspringen */ }
      });
      let zmin = V.zmin, zmax = V.zmax;
      if (V.zauto) {
        let lo = Infinity, hi = -Infinity;
        surfaces.forEach(sf => sf.zs.forEach(col => col.forEach(z => { if (isFinite(z)) { lo = Math.min(lo, z); hi = Math.max(hi, z); } })));
        if (isFinite(lo)) { if (hi - lo < 1e-9) { lo -= 1; hi += 1; } zmin = lo; zmax = hi; }
      }
      // Normierte Koordinaten in [-1,1]^3, dann drehen und orthografisch projizieren
      const ca = Math.cos(this.rot.az), sa = Math.sin(this.rot.az), ce = Math.cos(this.rot.el), se = Math.sin(this.rot.el);
      const sc = Math.min(W, H) * 0.32 * this.rot.zoom;
      const proj = (u, v, w) => {
        const x1 = u * ca - v * sa, y1 = u * sa + v * ca;
        const yy = y1 * ce - w * se, zz = y1 * se + w * ce;
        return [W / 2 + x1 * sc, H / 2 - zz * sc + 4, yy];
      };
      const nu = x => (x - V.xmin) / (V.xmax - V.xmin) * 2 - 1, nv = y => (y - V.ymin) / (V.ymax - V.ymin) * 2 - 1, nw = z => (z - zmin) / (zmax - zmin) * 1.6 - 0.8;
      // Box und Achsen
      g.strokeStyle = P.grid; g.lineWidth = 1;
      const box = [[-1, -1, -.8], [1, -1, -.8], [1, 1, -.8], [-1, 1, -.8], [-1, -1, .8], [1, -1, .8], [1, 1, .8], [-1, 1, .8]].map(p => proj(...p));
      [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]].forEach(([a, b]) => { g.beginPath(); g.moveTo(box[a][0], box[a][1]); g.lineTo(box[b][0], box[b][1]); g.stroke(); });
      g.fillStyle = P.label; g.font = '10px -apple-system, Helvetica, Arial, sans-serif';
      const lx = proj(1.15, -1, -.8), ly = proj(-1, 1.15, -.8), lz = proj(-1, -1, .95);
      g.fillText('x', lx[0], lx[1]); g.fillText('y', ly[0], ly[1]); g.fillText('z', lz[0], lz[1]);
      // Flaechen als Vierecke, von hinten nach vorne
      const quads = [];
      surfaces.forEach(sf => {
        const base = P.curves[sf.i];
        for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
          const c = [[a, b], [a + 1, b], [a + 1, b + 1], [a, b + 1]];
          const zz = c.map(([p, q]) => sf.zs[p][q]);
          if (!zz.every(isFinite)) continue;
          const pts = c.map(([p, q], k) => proj(nu(V.xmin + (V.xmax - V.xmin) * p / n), nv(V.ymin + (V.ymax - V.ymin) * q / n), Math.max(-1.6, Math.min(1.6, nw(zz[k])))));
          const depth = pts.reduce((sum, p) => sum + p[2], 0) / 4;
          const avg = zz.reduce((x, y) => x + y, 0) / 4;
          quads.push({ pts, depth, t: (avg - zmin) / (zmax - zmin || 1), base });
        }
      });
      quads.sort((p, q) => q.depth - p.depth);
      quads.forEach(q => {
        // Farbe nach Hoehe: blau unten, rot oben (wie die Hoehenfaerbung am Geraet)
        const tt = Math.max(0, Math.min(1, q.t));
        const hue = 230 - 230 * tt;
        g.fillStyle = 'hsl(' + hue + ',75%,' + (App.theme === 'dark' ? 52 : 58) + '%)';
        g.strokeStyle = App.theme === 'dark' ? 'rgba(0,0,0,.35)' : 'rgba(0,0,0,.25)';
        g.beginPath();
        q.pts.forEach((p, k) => (k ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
        g.closePath();
        g.fill();
        g.stroke();
      });
      this.info.textContent = surfaces.length ? 'z: ' + MP.fmtShort(zmin, 4) + ' … ' + MP.fmtShort(zmax, 4) + '   Ziehen = drehen' : 'Keine Funktion ausgewählt';
    },
    viewWin() {
      MP.Plot.viewDialog('3D View Window', this.view, [['xmin', 'xmin'], ['xmax', 'xmax'], ['ymin', 'ymin'], ['ymax', 'ymax'], ['zmin', 'zmin'], ['zmax', 'zmax'], ['zauto', 'z automatisch (1/0)'], ['n', 'Gitter (8–60)']], () => this.draw());
    },
    key(k) {
      if (this.active === 'edit') {
        if (k === 'EXE') { this.commit(); if (this.rows[this.sel].items.length) this.rows[this.sel].on = true; this.setActive('graph'); this.draw(); return true; }
        if (k === 'UP' || k === 'DOWN') {
          if (k === 'UP' ? this.ed.up() : this.ed.down()) return true;
          this.commit();
          this.sel = Math.max(0, Math.min(NZ - 1, this.sel + (k === 'UP' ? -1 : 1)));
          this.ed.setItems(B.fromJSON(this.rows[this.sel].items));
          this.renderRows();
          return true;
        }
        return false;
      }
      const st = 0.12;
      if (k === 'LEFT') this.rot.az += st; else if (k === 'RIGHT') this.rot.az -= st;
      else if (k === 'UP') this.rot.el = Math.min(1.5, this.rot.el + st); else if (k === 'DOWN') this.rot.el = Math.max(-1.5, this.rot.el - st);
      else if (k === 'ESC') { this.setActive('edit'); return true; }
      else return true;
      this.draw();
      return true;
    },
    menus() {
      return [
        { label: 'Edit', items: [{ label: 'Clear', action: () => { this.ed.clear(); this.commit(); this.rows[this.sel].on = false; this.renderRows(); this.draw(); } }] },
        { label: 'View', items: [{ label: 'View Window…', action: () => this.viewWin() }, { label: 'Ansicht zurücksetzen', action: () => { Object.assign(this.rot, { az: -0.75, el: 0.55, zoom: 1 }); this.draw(); } }, { label: 'Von oben', action: () => { Object.assign(this.rot, { az: 0, el: 1.5 }); this.draw(); } }] }
      ];
    },
    toolbar() {
      return [
        { icon: svg('<path d="M3 13l7 4 7-4-7-4z"/><path d="M5 12c2-6 4-7 5-5s3 1 5-3"/>'), title: 'Zeichnen (EXE)', action: () => { this.setActive('graph'); this.draw(); } },
        { icon: svg('<rect x="2.5" y="3.5" width="15" height="13"/><path d="M6 7h8M6 10h8M6 13h5"/>'), title: '3D View Window', action: () => this.viewWin() },
        { icon: svg('<circle cx="8.5" cy="8.5" r="5.5"/><path d="M13 13l4.5 4.5M6 8.5h5M8.5 6v5"/>'), title: 'Zoom In', action: () => { this.rot.zoom = Math.min(4, this.rot.zoom * 1.25); this.draw(); } },
        { icon: svg('<circle cx="8.5" cy="8.5" r="5.5"/><path d="M13 13l4.5 4.5M6 8.5h5"/>'), title: 'Zoom Out', action: () => { this.rot.zoom = Math.max(0.3, this.rot.zoom / 1.25); this.draw(); } },
        { label: '⟲', title: 'Ansicht zurücksetzen', action: () => { Object.assign(this.rot, { az: -0.75, el: 0.55, zoom: 1 }); this.draw(); } }
      ];
    }
  };
  App.register('g3d', G3);
})(window.MP = window.MP || {});

/* MathPad II — DiffEqGraph: Richtungsfeld und Loesungskurven fuer dy/dx = f(x, y) */
(function (MP) {
  'use strict';
  const App = MP.App, B = MP.B, NUM = MP.num, h = App.h, Plot = MP.Plot, svg = App.svg;

  const DEQ = {
    title: 'DiffEqGraph',
    statusKinds: ['angle'],
    init(saved) {
      this.view = { xmin: -5, xmax: 5, xscl: 1, ymin: -4, ymax: 4, yscl: 1 };
      this.ics = [{ x: 0, y: 1 }, { x: 0, y: -1 }];
      this.field = true;
      this.active = 'edit';
      this.ed = new MP.Editor({ onChange: () => this.renderEq() });
      if (saved) {
        this.ed.setItems(B.fromJSON(saved.eq || []));
        Object.assign(this.view, saved.view || {});
        if (Array.isArray(saved.ics)) this.ics = saved.ics;
        this.field = saved.field !== false;
      } else this.ed.setItems(MP.textToItems('x-y'));
    },
    save() { return { eq: B.toJSON(this.ed.root.items), view: this.view, ics: this.ics, field: this.field }; },
    editor() { return this.active === 'edit' ? this.ed : null; },
    mount(work) {
      this.split = h('div', { class: 'split' });
      this.wTop = h('div', { class: 'win', style: 'flex:0 0 auto' });
      this.wBot = h('div', { class: 'win' });
      this.eqFx = h('div', { class: 'fx m' });
      const row = h('div', { class: 'frow sel', style: 'min-height:30px' }, h('span', { class: 'fl m', style: 'width:auto;padding-right:4px' }), this.eqFx);
      row.firstChild.appendChild(B.render(B.row([B.t('frac', [[B.ch('d'), B.ch('y')], [B.ch('d'), B.ch('x')]]), B.ch('=')]), {}));
      row.addEventListener('pointerdown', e => { e.preventDefault(); this.setActive('edit'); this.ed.placeFromEvent(e); });
      this.icEl = h('div', { style: 'padding:2px 6px 4px;font-size:11px;display:flex;flex-wrap:wrap;gap:4px 10px' });
      this.wTop.append(h('div', { class: 'sheets' }, h('button', { type: 'button', class: 'on', text: 'DiffEq Editor (1. Ordnung)' })), row, this.icEl);
      this.gv = Plot.graphWin(this.wBot);
      Plot.bind(this.gv.wrap, this.gv.canvas, () => this.view, () => this.draw(), (x, y) => {
        this.ics.push({ x: +x.toPrecision(4), y: +y.toPrecision(4) });
        this.renderIcs();
        this.draw();
      });
      this.wBot.addEventListener('pointerdown', () => this.setActive('graph'));
      this.split.append(this.wTop, this.wBot);
      work.appendChild(this.split);
      this.renderIcs();
      this.layout();
    },
    layout() {
      if (!this.split) return;
      this.wTop.classList.toggle('active', this.active === 'edit');
      this.wBot.classList.toggle('active', this.active === 'graph');
      this.wTop.classList.toggle('hide', this.full === 'graph');
      this.renderEq();
      requestAnimationFrame(() => this.draw());
    },
    refresh() { this.layout(); },
    onScale() { this.draw(); },
    resize() { this.full = this.full ? null : 'graph'; this.layout(); },
    swapFocus() { this.setActive(this.active === 'edit' ? 'graph' : 'edit'); },
    setActive(a) { if (this.active === a) return; this.active = a; this.layout(); App.refreshChrome(); },
    renderEq() { if (this.eqFx) this.ed.render(this.eqFx, this.active === 'edit'); },
    renderIcs() {
      if (!this.icEl) return;
      this.icEl.textContent = '';
      this.ics.forEach((p, i) => {
        const b = h('button', { type: 'button', class: 'chip', title: 'Anfangswert entfernen' }, 'IC' + (i + 1) + ': (' + p.x + ', ' + p.y + ') ×');
        b.addEventListener('click', e => { e.stopPropagation(); this.ics.splice(i, 1); this.renderIcs(); this.draw(); App.save(); });
        this.icEl.appendChild(b);
      });
      if (!this.ics.length) this.icEl.appendChild(h('span', { class: 'muted', text: 'Ins Feld klicken setzt einen Anfangswert.' }));
    },
    fn() { return NUM.compile(this.ed.ast(), ['x', 'y'], { angle: App.settings.angle, values: MP.numericVars(), fns: App.env.fns }); },
    // RK4 in beide Richtungen bis zum Rand des Fensters
    solve(f, x0, y0) {
      const V = this.view, hh = (V.xmax - V.xmin) / 600, span = V.ymax - V.ymin;
      const run = dir => {
        const pts = [];
        let x = x0, y = y0;
        for (let i = 0; i < 2000; i++) {
          pts.push([x, y]);
          const s = dir * hh;
          const k1 = f(x, y), k2 = f(x + s / 2, y + s / 2 * k1), k3 = f(x + s / 2, y + s / 2 * k2), k4 = f(x + s, y + s * k3);
          y += s / 6 * (k1 + 2 * k2 + 2 * k3 + k4);
          x += s;
          if (!isFinite(y) || x < V.xmin - hh || x > V.xmax + hh || y < V.ymin - 3 * span || y > V.ymax + 3 * span) break;
        }
        return pts;
      };
      return run(-1).reverse().concat(run(1).slice(1));
    },
    draw() {
      if (!this.gv) return;
      const s = Plot.setup(this.gv.canvas);
      if (!s) return;
      const { g, W, H } = s;
      const t = Plot.axes(g, W, H, this.view);
      const P = App.pal();
      let f;
      try { f = this.fn(); } catch (e) { this.gv.info.textContent = 'Syntax ERROR'; return; }
      const V = this.view;
      if (this.field) {
        g.strokeStyle = P.mute; g.lineWidth = 1;
        g.beginPath();
        const nx = 21, ny = Math.max(9, Math.round(21 * H / W));
        const L = Math.min(W / nx, H / ny) * 0.36;
        for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
          const x = V.xmin + (i + 0.5) * (V.xmax - V.xmin) / nx, y = V.ymin + (j + 0.5) * (V.ymax - V.ymin) / ny;
          const m = f(x, y);
          if (!isFinite(m)) continue;
          // Steigung in Pixel umrechnen, damit die Striche auch bei ungleichen Achsen stimmen
          const dx = W / (V.xmax - V.xmin), dy = -m * H / (V.ymax - V.ymin);
          const n = Math.hypot(dx, dy);
          const cx = t.X(x), cy = t.Y(y);
          g.moveTo(cx - dx / n * L, cy - dy / n * L);
          g.lineTo(cx + dx / n * L, cy + dy / n * L);
        }
        g.stroke();
      }
      this.ics.forEach((p, i) => {
        const pts = this.solve(f, p.x, p.y);
        g.strokeStyle = P.curves[(i + 1) % 8]; g.lineWidth = 1.8;
        g.beginPath();
        pts.forEach(([x, y], k) => (k ? g.lineTo(t.X(x), t.Y(y)) : g.moveTo(t.X(x), t.Y(y))));
        g.stroke();
        g.fillStyle = P.curves[(i + 1) % 8];
        g.beginPath(); g.arc(t.X(p.x), t.Y(p.y), 3, 0, 2 * Math.PI); g.fill();
      });
      this.gv.info.textContent = this.ics.length ? this.ics.length + ' Lösungskurve' + (this.ics.length > 1 ? 'n' : '') + ' (RK4)' : '';
    },
    addIcDialog() {
      const f = (id, l, v) => h('div', { class: 'row' }, h('label', { for: id, text: l }), h('input', { type: 'text', id, value: String(v) }));
      App.dialog({
        title: 'Initial Condition', body: [f('ic-x', 'x0', 0), f('ic-y', 'y0', 0)],
        ok: d => {
          const x = MP.evalNum(d.querySelector('#ic-x').value), y = MP.evalNum(d.querySelector('#ic-y').value);
          if (!isFinite(x) || !isFinite(y)) { App.error('Syntax ERROR'); return false; }
          this.ics.push({ x, y });
          this.renderIcs();
          this.draw();
        }
      });
    },
    key(k) {
      if (k === 'EXE') { this.setActive('graph'); this.draw(); return true; }
      if (this.active === 'graph') { if (k === 'ESC') this.setActive('edit'); return true; }
      return false;
    },
    menus() {
      return [
        { label: 'Edit', items: [{ label: 'Anfangswert hinzufügen…', action: () => this.addIcDialog() }, { label: 'Alle Anfangswerte löschen', action: () => { this.ics = []; this.renderIcs(); this.draw(); } }] },
        { label: 'View', items: [{ label: 'Richtungsfeld', check: this.field, action: () => { this.field = !this.field; this.draw(); } }, { label: 'View Window…', action: () => Plot.viewDialog('View Window', this.view, [['xmin', 'xmin'], ['xmax', 'xmax'], ['xscl', 'xscale'], ['ymin', 'ymin'], ['ymax', 'ymax'], ['yscl', 'yscale']], () => this.draw()) }] }
      ];
    },
    toolbar() {
      return [
        { icon: svg('<path d="M2 17h16M3 2v16"/><path d="M4 14c4-1 8-5 13-11"/>'), title: 'Zeichnen (EXE)', action: () => { this.setActive('graph'); this.draw(); } },
        { label: 'IC+', title: 'Anfangswert hinzufügen', action: () => this.addIcDialog() },
        { label: 'Feld', title: 'Richtungsfeld ein/aus', on: this.field, action: () => { this.field = !this.field; this.draw(); App.refreshChrome(); } },
        { icon: svg('<circle cx="8.5" cy="8.5" r="5.5"/><path d="M13 13l4.5 4.5M6 8.5h5M8.5 6v5"/>'), title: 'Zoom In', action: () => { Plot.zoom(this.view, 0.5); this.draw(); } },
        { icon: svg('<circle cx="8.5" cy="8.5" r="5.5"/><path d="M13 13l4.5 4.5M6 8.5h5"/>'), title: 'Zoom Out', action: () => { Plot.zoom(this.view, 2); this.draw(); } }
      ];
    }
  };
  App.register('deq', DEQ);
})(window.MP = window.MP || {});

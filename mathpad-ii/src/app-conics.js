/* MathPad II — Conics: Kegelschnitte zeichnen und analysieren */
(function (MP) {
  'use strict';
  const App = MP.App, B = MP.B, C = MP.core, NUM = MP.num, h = App.h, Plot = MP.Plot, svg = App.svg;
  const fmt = v => MP.fmtShort(Math.abs(v) < 1e-10 ? 0 : v, 8);

  // Vorlagen wie im Conics-Menue des ClassPad (mit Beispielwerten statt leerer Platzhalter)
  const FORMS = [
    ['Parabola  y=A(x−h)²+k', 'y=0.5(x-1)^2-2'],
    ['Parabola  x=A(y−k)²+h', 'x=0.25(y+1)^2-3'],
    ['Circle  (x−h)²+(y−k)²=r²', '(x-1)^2+(y+1)^2=9'],
    ['Ellipse  (x−h)²/a²+(y−k)²/b²=1', '(x-1)^2/16+(y-1)^2/4=1'],
    ['Hyperbola  (x−h)²/a²−(y−k)²/b²=1', 'x^2/4-y^2/9=1'],
    ['Hyperbola  (y−k)²/b²−(x−h)²/a²=1', 'y^2/4-x^2/9=1'],
    ['General  Ax²+Bxy+Cy²+Dx+Ey+F=0', 'x^2+x*y+y^2-6=0']
  ];

  const Con = {
    title: 'Conics',
    statusKinds: ['angle'],
    init(saved) {
      this.view = { xmin: -7.7, xmax: 7.7, xscl: 1, ymin: -6, ymax: 6, yscl: 1 };
      this.active = 'edit';
      this.marks = null;
      this.ed = new MP.Editor({ onChange: () => this.renderEq() });
      if (saved) {
        this.ed.setItems(B.fromJSON(saved.eq || []));
        Object.assign(this.view, saved.view || {});
      } else this.ed.setItems(MP.textToItems('(x-1)^2/16+(y-1)^2/4=1'));
    },
    save() { return { eq: B.toJSON(this.ed.root.items), view: this.view }; },
    editor() { return this.active === 'edit' ? this.ed : null; },
    mount(work) {
      this.split = h('div', { class: 'split' });
      this.wTop = h('div', { class: 'win', style: 'flex:0 0 auto' });
      this.wBot = h('div', { class: 'win' });
      this.eqFx = h('div', { class: 'fx m' });
      const row = h('div', { class: 'frow sel', style: 'min-height:34px' }, h('span', { class: 'fl', text: '' }), this.eqFx);
      row.addEventListener('pointerdown', e => { e.preventDefault(); this.setActive('edit'); this.ed.placeFromEvent(e); });
      this.wTop.append(h('div', { class: 'sheets' }, h('button', { type: 'button', class: 'on', text: 'Conics Editor' })), row);
      this.gv = Plot.graphWin(this.wBot);
      Plot.bind(this.gv.wrap, this.gv.canvas, () => this.view, () => this.draw());
      this.wBot.addEventListener('pointerdown', () => this.setActive('graph'));
      this.split.append(this.wTop, this.wBot);
      work.appendChild(this.split);
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
    setActive(a) {
      if (this.active === a) return;
      this.active = a;
      this.layout();
      App.refreshChrome();
    },
    renderEq() { if (this.eqFx) this.ed.render(this.eqFx, this.active === 'edit'); },

    /* ---------- Rechnen ---------- */
    fn() {
      const ast = this.ed.ast();
      const rel = ast.type === 'rel' ? ast : { type: 'rel', op: '=', a: ast, b: C.num(0) };
      return NUM.compile(rel, ['x', 'y'], { angle: App.settings.angle, values: MP.numericVars(), fns: App.env.fns });
    },
    // Koeffizienten A..F aus Stichproben; null wenn kein Polynom 2. Grades
    coeffs(f) {
      const F = f(0, 0);
      const A = (f(1, 0) + f(-1, 0) - 2 * F) / 2, D = (f(1, 0) - f(-1, 0)) / 2;
      const Cc = (f(0, 1) + f(0, -1) - 2 * F) / 2, E = (f(0, 1) - f(0, -1)) / 2;
      const Bc = f(1, 1) - A - Cc - D - E - F;
      const q = (x, y) => A * x * x + Bc * x * y + Cc * y * y + D * x + E * y + F;
      const pts = [[2.3, -1.7], [-3.1, 2.9], [0.7, 4.2], [5.5, 1.3]];
      const scale = Math.max(1, ...[A, Bc, Cc, D, E, F].map(Math.abs));
      if (pts.some(([x, y]) => Math.abs(q(x, y) - f(x, y)) > 1e-7 * scale * (1 + x * x + y * y))) return null;
      return { A, B: Bc, C: Cc, D, E, F };
    },
    analyse() {
      let f, k;
      try { f = this.fn(); k = this.coeffs(f); } catch (e) { return { err: 'Syntax ERROR' }; }
      if (!k) return { err: 'Keine Kegelschnitt-Gleichung (Grad ≤ 2 in x und y)' };
      const { A, B: Bc, C: Cc, D, E, F } = k;
      const eps = 1e-10;
      const disc = Bc * Bc - 4 * A * Cc;
      const rows = [], marks = [];
      const P = (lbl, x, y) => { rows.push([lbl, '(' + fmt(x) + ', ' + fmt(y) + ')']); marks.push({ x, y, lbl }); };
      if (Math.abs(Bc) > eps) {
        const type = Math.abs(disc) < eps ? 'Parabel' : disc < 0 ? 'Ellipse' : 'Hyperbel';
        rows.push(['Typ', type + ' (gedreht)']);
        const th = 0.5 * Math.atan2(Bc, A - Cc) * 180 / Math.PI;
        rows.push(['Drehwinkel', fmt(th) + '°']);
        if (Math.abs(disc) > eps) {
          const det = 4 * A * Cc - Bc * Bc;
          P('Mittelpunkt', (Bc * E - 2 * Cc * D) / det, (Bc * D - 2 * A * E) / det);
        }
        return { rows, marks, k };
      }
      if (Math.abs(A) < eps && Math.abs(Cc) < eps) return { err: 'Gerade, kein Kegelschnitt' };
      if (Math.abs(A) < eps || Math.abs(Cc) < eps) {
        // Parabel
        if (Math.abs(Cc) < eps) {
          // A x² + D x + E y + F = 0  ->  y = a(x-h)² + k
          if (Math.abs(E) < eps) return { err: 'Zwei Parallelen, keine Parabel' };
          const a = -A / E, hx = -D / (2 * A), ky = -(A * hx * hx + D * hx + F) / E;
          const p = 1 / (4 * a);
          rows.push(['Typ', 'Parabel'], ['Form', 'y=' + fmt(a) + '(x−' + fmt(hx) + ')²+' + fmt(ky)]);
          P('Scheitel', hx, ky); P('Brennpunkt', hx, ky + p);
          rows.push(['Leitlinie', 'y=' + fmt(ky - p)], ['Symmetrieachse', 'x=' + fmt(hx)], ['Exzentrizität', '1']);
        } else {
          if (Math.abs(D) < eps) return { err: 'Zwei Parallelen, keine Parabel' };
          const a = -Cc / D, ky = -E / (2 * Cc), hx = -(Cc * ky * ky + E * ky + F) / D;
          const p = 1 / (4 * a);
          rows.push(['Typ', 'Parabel'], ['Form', 'x=' + fmt(a) + '(y−' + fmt(ky) + ')²+' + fmt(hx)]);
          P('Scheitel', hx, ky); P('Brennpunkt', hx + p, ky);
          rows.push(['Leitlinie', 'x=' + fmt(hx - p)], ['Symmetrieachse', 'y=' + fmt(ky)], ['Exzentrizität', '1']);
        }
        return { rows, marks, k };
      }
      const hx = -D / (2 * A), ky = -E / (2 * Cc);
      const R = A * hx * hx + Cc * ky * ky - F;   // A(x-h)² + C(y-k)² = R
      if (Math.abs(R) < eps) return { err: 'Entartet (Punkt oder Geradenpaar)' };
      const a2 = R / A, b2 = R / Cc;
      if (a2 > 0 && b2 > 0) {
        if (Math.abs(a2 - b2) < 1e-9 * Math.max(a2, b2)) {
          const r = Math.sqrt(a2);
          rows.push(['Typ', 'Kreis'], ['Radius r', fmt(r)], ['Fläche', fmt(Math.PI * r * r)], ['Umfang', fmt(2 * Math.PI * r)]);
          P('Mittelpunkt', hx, ky);
        } else {
          const a = Math.sqrt(a2), b = Math.sqrt(b2);
          const c = Math.sqrt(Math.abs(a2 - b2)), horiz = a > b;
          rows.push(['Typ', 'Ellipse'], ['a', fmt(a)], ['b', fmt(b)], ['Exzentrizität', fmt(c / Math.max(a, b))], ['Fläche', fmt(Math.PI * a * b)]);
          P('Mittelpunkt', hx, ky);
          if (horiz) { P('Brennpunkt 1', hx - c, ky); P('Brennpunkt 2', hx + c, ky); P('Scheitel 1', hx - a, ky); P('Scheitel 2', hx + a, ky); }
          else { P('Brennpunkt 1', hx, ky - c); P('Brennpunkt 2', hx, ky + c); P('Scheitel 1', hx, ky - b); P('Scheitel 2', hx, ky + b); }
        }
      } else if (a2 < 0 && b2 < 0) return { err: 'Keine reellen Punkte' };
      else {
        const horiz = a2 > 0;
        const a = Math.sqrt(Math.abs(a2)), b = Math.sqrt(Math.abs(b2)), c = Math.sqrt(a * a + b * b);
        rows.push(['Typ', 'Hyperbel'], ['a', fmt(a)], ['b', fmt(b)], ['Exzentrizität', fmt(c / (horiz ? a : b))]);
        P('Mittelpunkt', hx, ky);
        if (horiz) { P('Brennpunkt 1', hx - c, ky); P('Brennpunkt 2', hx + c, ky); P('Scheitel 1', hx - a, ky); P('Scheitel 2', hx + a, ky); rows.push(['Asymptoten', 'y=±' + fmt(b / a) + '(x−' + fmt(hx) + ')+' + fmt(ky)]); }
        else { P('Brennpunkt 1', hx, ky - c); P('Brennpunkt 2', hx, ky + c); P('Scheitel 1', hx, ky - b); P('Scheitel 2', hx, ky + b); rows.push(['Asymptoten', 'y=±' + fmt(b / a) + '(x−' + fmt(hx) + ')+' + fmt(ky)]); }
      }
      return { rows, marks, k };
    },

    /* ---------- Zeichnen (implizit, Marching Squares) ---------- */
    draw() {
      if (!this.gv) return;
      const s = Plot.setup(this.gv.canvas);
      if (!s) return;
      const { g, W, H } = s;
      const t = Plot.axes(g, W, H, this.view);
      const P = App.pal();
      let f;
      try { f = this.fn(); } catch (e) { this.gv.info.textContent = 'Syntax ERROR'; return; }
      const nx = Math.ceil(W / 2), ny = Math.ceil(H / 2), V = this.view;
      const xs = i => V.xmin + (V.xmax - V.xmin) * i / nx, ys = j => V.ymax - (V.ymax - V.ymin) * j / ny;
      const vals = new Float64Array((nx + 1) * (ny + 1));
      for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) vals[j * (nx + 1) + i] = f(xs(i), ys(j));
      g.strokeStyle = P.curves[0]; g.lineWidth = 1.6; g.lineCap = 'round';
      g.beginPath();
      const px = i => i / nx * W, py = j => j / ny * H;
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const a = vals[j * (nx + 1) + i], b = vals[j * (nx + 1) + i + 1], c = vals[(j + 1) * (nx + 1) + i + 1], d = vals[(j + 1) * (nx + 1) + i];
          if (![a, b, c, d].every(isFinite)) continue;
          const pts = [];
          const edge = (v0, v1, x0, y0, x1, y1) => { if ((v0 < 0) !== (v1 < 0)) { const r = v0 / (v0 - v1); pts.push([x0 + (x1 - x0) * r, y0 + (y1 - y0) * r]); } };
          edge(a, b, px(i), py(j), px(i + 1), py(j));
          edge(b, c, px(i + 1), py(j), px(i + 1), py(j + 1));
          edge(c, d, px(i + 1), py(j + 1), px(i), py(j + 1));
          edge(d, a, px(i), py(j + 1), px(i), py(j));
          if (pts.length >= 2) { g.moveTo(pts[0][0], pts[0][1]); g.lineTo(pts[1][0], pts[1][1]); }
          if (pts.length === 4) { g.moveTo(pts[2][0], pts[2][1]); g.lineTo(pts[3][0], pts[3][1]); }
        }
      }
      g.stroke();
      this.gv.info.textContent = '';
      this.gv.tag.textContent = '';
      if (this.marks) {
        this.marks.forEach(m => {
          const x = t.X(m.x), y = t.Y(m.y);
          g.fillStyle = P.curves[1];
          g.beginPath(); g.arc(x, y, 3, 0, 2 * Math.PI); g.fill();
        });
        this.gv.tag.textContent = this.marks.map(m => m.lbl).join(' · ');
      }
    },
    analysisDialog() {
      const r = this.analyse();
      if (r.err) { App.error(r.err); return; }
      this.marks = r.marks;
      this.setActive('graph');
      this.draw();
      const tb = h('table', { class: 'res' });
      r.rows.forEach(([k, v]) => tb.appendChild(h('tr', null, h('td', { text: k }), h('td', { text: v }))));
      const k = r.k;
      tb.appendChild(h('tr', null, h('td', { text: 'Allg. Form' }), h('td', { text: [['x²', k.A], ['xy', k.B], ['y²', k.C], ['x', k.D], ['y', k.E], ['', k.F]].filter(([, v]) => Math.abs(v) > 1e-12).map(([n, v], i) => (v < 0 ? '−' : i ? '+' : '') + fmt(Math.abs(v)) + n).join('') + '=0' })));
      App.dialog({ title: 'Conics Analysis', body: [tb], cancel: false });
    },
    key(k) {
      if (k === 'EXE') { this.marks = null; this.setActive('graph'); this.draw(); return true; }
      if (this.active === 'graph') {
        if (k === 'ESC') { this.marks = null; this.setActive('edit'); this.draw(); return true; }
        const V = this.view, dx = (V.xmax - V.xmin) * 0.1, dy = (V.ymax - V.ymin) * 0.1;
        if (k === 'LEFT') { V.xmin -= dx; V.xmax -= dx; } else if (k === 'RIGHT') { V.xmin += dx; V.xmax += dx; }
        else if (k === 'UP') { V.ymin += dy; V.ymax += dy; } else if (k === 'DOWN') { V.ymin -= dy; V.ymax -= dy; }
        else return true;
        this.draw();
        return true;
      }
      return false;
    },
    menus() {
      return [
        { label: 'Form', items: FORMS.map(([l, t]) => ({ label: l, action: () => { this.ed.setItems(MP.textToItems(t)); this.marks = null; this.setActive('edit'); this.renderEq(); this.draw(); } })) },
        { label: 'Analysis', items: [{ label: 'G-Solve (alle Kennwerte)', action: () => this.analysisDialog() }] },
        {
          label: 'Zoom', items: [
            { label: 'Zoom In', action: () => { Plot.zoom(this.view, 0.5); this.draw(); } },
            { label: 'Zoom Out', action: () => { Plot.zoom(this.view, 2); this.draw(); } },
            { label: 'Square', action: () => { const V = this.view, a = (this.gv.canvas.clientHeight || 230) / (this.gv.canvas.clientWidth || 316), cy = (V.ymin + V.ymax) / 2, hy = (V.xmax - V.xmin) * a / 2; Object.assign(V, { ymin: cy - hy, ymax: cy + hy }); this.draw(); } },
            { label: 'View Window…', action: () => Plot.viewDialog('View Window', this.view, [['xmin', 'xmin'], ['xmax', 'xmax'], ['xscl', 'xscale'], ['ymin', 'ymin'], ['ymax', 'ymax'], ['yscl', 'yscale']], () => this.draw()) }
          ]
        }
      ];
    },
    toolbar() {
      return [
        { label: 'Form', title: 'Kegelschnitt-Vorlage', menu: () => FORMS.map(([l, t]) => ({ label: l, action: () => { this.ed.setItems(MP.textToItems(t)); this.marks = null; this.renderEq(); this.draw(); } })) },
        { icon: svg('<path d="M2 17h16M3 2v16"/><ellipse cx="11" cy="10" rx="6" ry="4"/>'), title: 'Zeichnen (EXE)', action: () => { this.marks = null; this.setActive('graph'); this.draw(); } },
        { label: 'G-Sol', title: 'Analyse', action: () => this.analysisDialog() },
        { icon: svg('<circle cx="8.5" cy="8.5" r="5.5"/><path d="M13 13l4.5 4.5M6 8.5h5M8.5 6v5"/>'), title: 'Zoom In', action: () => { Plot.zoom(this.view, 0.5); this.draw(); } },
        { icon: svg('<circle cx="8.5" cy="8.5" r="5.5"/><path d="M13 13l4.5 4.5M6 8.5h5"/>'), title: 'Zoom Out', action: () => { Plot.zoom(this.view, 2); this.draw(); } }
      ];
    }
  };
  App.register('conics', Con);
})(window.MP = window.MP || {});

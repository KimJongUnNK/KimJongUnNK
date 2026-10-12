/* MathPad II — Statistik: Listen, Kennzahlen, Regressionen, Diagramme */
(function (MP) {
  'use strict';
  const App = MP.App, B = MP.B, C = MP.core, NUM = MP.num, h = App.h, svg = App.svg;
  const NL = 6;
  const fmt = (v, d) => MP.fmtShort(v, d);

  const REG = [
    ['linear', 'Linear Reg', 'a·x+b', p => p.a + '*x+(' + p.b + ')'],
    ['quad', 'Quadratic Reg', 'a·x²+b·x+c', p => p.a + '*x^2+(' + p.b + ')*x+(' + p.c + ')'],
    ['cubic', 'Cubic Reg', 'a·x³+b·x²+c·x+d', p => p.a + '*x^3+(' + p.b + ')*x^2+(' + p.c + ')*x+(' + p.d + ')'],
    ['quart', 'Quartic Reg', 'a·x⁴+…+e', p => p.a + '*x^4+(' + p.b + ')*x^3+(' + p.c + ')*x^2+(' + p.d + ')*x+(' + p.e + ')'],
    ['log', 'Logarithmic Reg', 'a+b·ln(x)', p => p.a + '+(' + p.b + ')*ln(x)'],
    ['exp', 'Exponential Reg', 'a·e^(b·x)', p => p.a + '*e^((' + p.b + ')*x)'],
    ['abexp', 'abExponential Reg', 'a·b^x', p => p.a + '*(' + p.b + ')^x'],
    ['power', 'Power Reg', 'a·x^b', p => p.a + '*x^(' + p.b + ')']
  ];

  const S = {
    title: 'Statistics',
    statusKinds: ['angle', 'complex'],
    init(saved) {
      this.lists = [];
      for (let i = 0; i < NL; i++) this.lists.push([]);
      this.sel = { c: 0, r: 0 };
      this.sg = { type: 'scatter', x: 0, y: 1, f: -1 };
      this.reg = null;
      this.showGraph = false;
      this.active = 'list';
      this.full = null;
      if (saved && Array.isArray(saved.lists)) {
        saved.lists.forEach((l, i) => { if (i < NL && Array.isArray(l)) this.lists[i] = l.map(Number).filter(v => isFinite(v)); });
        if (saved.sg) Object.assign(this.sg, saved.sg);
      }
      this.ed = new MP.Editor({ onChange: () => this.renderInput() });
      this.loadCell();
    },
    save() { return { lists: this.lists, sg: this.sg }; },
    editor() { return this.active === 'list' ? this.ed : null; },
    cellVal(c, r) { const v = this.lists[c][r]; return v === undefined ? '' : fmt(v, 10); },
    loadCell() {
      const v = this.lists[this.sel.c][this.sel.r];
      this.ed.setItems(v === undefined ? [] : MP.textToItems(String(+v.toPrecision(12)).replace('e', 'ᴇ').replace('+', '')));
      this.dirty = false;
      this.ed.onChange = () => { this.dirty = true; this.renderInput(); };
    },

    mount(work) {
      this.split = h('div', { class: 'split' });
      this.wList = h('div', { class: 'win' });
      this.wGraph = h('div', { class: 'win' });
      work.appendChild(this.split);
      this.buildList();
      this.buildGraph();
      this.layout();
    },
    layout() {
      if (!this.split) return;
      this.split.textContent = '';
      const order = this.swapped ? [this.wGraph, this.wList] : [this.wList, this.wGraph];
      order.forEach(w => { if (w !== this.wGraph || this.showGraph) this.split.appendChild(w); });
      this.wList.classList.toggle('active', this.active === 'list');
      this.wGraph.classList.toggle('active', this.active === 'graph');
      this.wList.classList.toggle('hide', this.full === 'graph');
      this.wGraph.classList.toggle('hide', this.full === 'list');
      requestAnimationFrame(() => this.draw());
    },
    refresh() { this.renderTable(); this.layout(); },
    onScale() { this.draw(); },
    resize() { if (this.showGraph) { this.full = this.full ? null : this.active; this.layout(); } },
    swap() { if (this.showGraph) { this.swapped = !this.swapped; this.layout(); } },
    swapFocus() { if (this.showGraph) { this.active = this.active === 'list' ? 'graph' : 'list'; this.layout(); App.refreshChrome(); } },

    buildList() {
      const w = this.wList;
      w.textContent = '';
      this.tWrap = h('div', { class: 'lwrap' });
      this.inLbl = h('span', { class: 'lbl' });
      this.inFx = h('div', { class: 'fx m' });
      this.inFx.addEventListener('pointerdown', e => { e.preventDefault(); this.setActive('list'); this.ed.placeFromEvent(e); });
      w.append(this.tWrap, h('div', { class: 'lin' }, this.inLbl, this.inFx));
      w.addEventListener('pointerdown', () => this.setActive('list'));
      this.renderTable();
    },
    setActive(a) {
      if (this.active === a) return;
      this.active = a;
      this.layout();
      App.refreshChrome();
    },
    renderTable() {
      if (!this.tWrap) return;
      const rows = Math.max(12, Math.max(...this.lists.map(l => l.length)) + 2);
      const t = h('table', { class: 'ltab' });
      const hr = h('tr', null, h('th', { class: 'rn' }));
      for (let c = 0; c < NL; c++) hr.appendChild(h('th', { text: 'list' + (c + 1) }));
      t.appendChild(h('thead', null, hr));
      const tb = h('tbody');
      for (let r = 0; r < rows; r++) {
        const tr = h('tr', null, h('td', { class: 'rn', text: String(r + 1) }));
        for (let c = 0; c < NL; c++) {
          const td = h('td', { text: this.cellVal(c, r), class: this.sel.c === c && this.sel.r === r ? 'sel' : null });
          td.addEventListener('pointerdown', e => { e.preventDefault(); this.setActive('list'); this.select(c, r); });
          tr.appendChild(td);
        }
        tb.appendChild(tr);
      }
      t.appendChild(tb);
      this.tWrap.textContent = '';
      this.tWrap.appendChild(t);
      const sel = t.querySelector('td.sel');
      if (sel) {
        const br = this.tWrap.getBoundingClientRect(), sr = sel.getBoundingClientRect();
        if (sr.bottom > br.bottom || sr.top < br.top + 16) sel.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
      this.renderInput();
    },
    renderInput() {
      if (!this.inLbl) return;
      this.inLbl.textContent = 'list' + (this.sel.c + 1) + '[' + (this.sel.r + 1) + ']';
      this.ed.render(this.inFx, this.active === 'list');
    },
    commit() {
      if (!this.dirty) return true;
      const L = this.lists[this.sel.c];
      if (this.ed.isEmpty()) { this.dirty = false; return true; }
      let v;
      try {
        const ast = this.ed.ast();
        v = NUM.compile(ast, [], { angle: App.settings.angle, values: MP.numericVars(), fns: App.env.fns })();
      } catch (e) { v = NaN; }
      if (!isFinite(v)) { App.error('Syntax ERROR'); return false; }
      while (L.length < this.sel.r) L.push(0);
      L[this.sel.r] = v;
      this.dirty = false;
      return true;
    },
    select(c, r) {
      if (!this.commit()) return;
      this.sel = { c: Math.max(0, Math.min(NL - 1, c)), r: Math.max(0, Math.min(this.lists[c] ? this.lists[c].length : 0, r, 998)) };
      this.loadCell();
      this.renderTable();
      if (this.showGraph) this.draw();
    },
    key(k) {
      if (this.active === 'graph') {
        if (k === 'ESC') { this.setActive('list'); return true; }
        return true;
      }
      const { c, r } = this.sel;
      switch (k) {
        case 'EXE': if (this.commit()) this.select(c, r + 1); return true;
        case 'UP': this.select(c, r - 1); return true;
        case 'DOWN': this.select(c, r + 1); return true;
        case 'LEFT': if (this.ed.isEmpty() || !this.dirty) { this.select(c - 1, r); return true; } return false;
        case 'RIGHT': if (this.ed.isEmpty() || !this.dirty) { this.select(c + 1, r); return true; } return false;
        case 'DEL': {
          const L = this.lists[c];
          if (r < L.length) L.splice(r, 1);
          this.loadCell(); this.renderTable(); this.draw();
          return true;
        }
        case 'ESC': this.loadCell(); this.renderInput(); return true;
      }
      return false;
    },

    /* ---------- Rechnen ---------- */
    listOpts(sel, withOne) {
      const o = [];
      if (withOne) o.push(h('option', { value: '-1', text: '1', selected: sel === -1 ? true : null }));
      for (let i = 0; i < NL; i++) o.push(h('option', { value: String(i), text: 'list' + (i + 1), selected: sel === i ? true : null }));
      return o;
    },
    calcDialog(kind) {
      this.commit();
      const two = kind !== 'one';
      const row = (id, l, sel, one) => h('div', { class: 'row' }, h('label', { for: id, text: l }), h('select', { id }, this.listOpts(sel, one)));
      const body = [row('sc-x', 'XList', this.sg.x)];
      if (two) body.push(row('sc-y', 'YList', this.sg.y));
      body.push(row('sc-f', 'Freq', this.sg.f, true));
      const title = kind === 'one' ? 'One-Variable' : kind === 'two' ? 'Two-Variable' : REG.find(r => r[0] === kind)[1];
      App.dialog({
        title, body,
        ok: d => {
          const x = +d.querySelector('#sc-x').value, y = two ? +d.querySelector('#sc-y').value : this.sg.y, f = +d.querySelector('#sc-f').value;
          Object.assign(this.sg, { x, y, f });
          setTimeout(() => this.calc(kind), 0);
        }
      });
    },
    data(two) {
      const xs = this.lists[this.sg.x].slice();
      const ys = two ? this.lists[this.sg.y].slice() : null;
      const fr = this.sg.f >= 0 ? this.lists[this.sg.f].slice() : xs.map(() => 1);
      if (!xs.length) throw new C.MathError('Dimension ERROR');
      if (two && ys.length !== xs.length) throw new C.MathError('Dimension ERROR');
      if (fr.length !== xs.length || fr.some(v => v < 0 || !Number.isInteger(v))) throw new C.MathError('Dimension ERROR');
      return { xs, ys, fr };
    },
    calc(kind) {
      let rows, extra = [];
      try {
        if (kind === 'one') {
          const { xs, fr } = this.data(false);
          const s = NUM.oneVar(xs, fr);
          rows = [['x̄', s.mean], ['Σx', s.sum], ['Σx²', s.sum2], ['σx', s.popSD], ['sx', s.sampSD], ['n', s.n], ['minX', s.min], ['Q₁', s.q1], ['Med', s.med], ['Q₃', s.q3], ['maxX', s.max], ['Mode', s.mode.slice(0, 3).map(v => fmt(v, 8)).join(', ') + (s.mode.length > 3 ? ', …' : '')], ['ModeN', s.modeN], ['ModeFreq', s.modeF]];
        } else if (kind === 'two') {
          const { xs, ys, fr } = this.data(true);
          const X = [], Y = [];
          xs.forEach((x, i) => { for (let k = 0; k < fr[i]; k++) { X.push(x); Y.push(ys[i]); } });
          const sx = NUM.oneVar(X), sy = NUM.oneVar(Y);
          const sxy = X.reduce((s, x, i) => s + x * Y[i], 0);
          rows = [['x̄', sx.mean], ['Σx', sx.sum], ['Σx²', sx.sum2], ['σx', sx.popSD], ['sx', sx.sampSD], ['n', sx.n], ['ȳ', sy.mean], ['Σy', sy.sum], ['Σy²', sy.sum2], ['σy', sy.popSD], ['sy', sy.sampSD], ['Σxy', sxy], ['minX', sx.min], ['maxX', sx.max], ['minY', sy.min], ['maxY', sy.max]];
        } else {
          const { xs, ys, fr } = this.data(true);
          const X = [], Y = [];
          xs.forEach((x, i) => { for (let k = 0; k < fr[i]; k++) { X.push(x); Y.push(ys[i]); } });
          const r = NUM.regression(kind, X, Y);
          const def = REG.find(q => q[0] === kind);
          const p = {};
          r.params.forEach(([k, v]) => { p[k] = v; });
          this.reg = { kind, f: r.f, formula: def[3](Object.fromEntries(Object.entries(p).map(([k, v]) => [k, +v.toPrecision(10)]))), label: def[1] };
          rows = [['Form', def[2]]].concat(r.params);
          extra = [
            { label: '→ Graph', action: () => { const name = App.apps.graph.addFormula(this.reg.formula); App.message('Copy Formula', 'Formel nach ' + name + ' (Graph & Table) kopiert'); return true; } },
            { label: 'Draw', action: () => { this.sg.type = 'scatter'; this.drawGraph(); } }
          ];
        }
      } catch (e) {
        App.error(e instanceof C.MathError ? e.message : 'Calc ERROR');
        return;
      }
      const tb = h('table', { class: 'res' });
      rows.forEach(([k, v]) => tb.appendChild(h('tr', null, h('td', { text: k }), h('td', { text: typeof v === 'number' ? fmt(v, 10) : String(v) }))));
      App.dialog({ title: kind === 'one' ? 'One-Variable' : kind === 'two' ? 'Two-Variable' : this.reg.label, body: [tb], buttons: extra, cancel: false });
    },

    /* ---------- Diagramm ---------- */
    setGraphDialog() {
      const types = [['scatter', 'Scatter'], ['xyline', 'xyLine'], ['hist', 'Histogram'], ['box', 'MedBox']];
      const sel = (id, list, v) => h('select', { id }, list.map(([val, l]) => h('option', { value: val, text: l, selected: val === v ? true : null })));
      App.dialog({
        title: 'StatGraph1',
        body: [
          h('div', { class: 'row' }, h('label', { for: 'sg-t', text: 'Type' }), sel('sg-t', types, this.sg.type)),
          h('div', { class: 'row' }, h('label', { for: 'sg-x', text: 'XList' }), h('select', { id: 'sg-x' }, this.listOpts(this.sg.x))),
          h('div', { class: 'row' }, h('label', { for: 'sg-y', text: 'YList' }), h('select', { id: 'sg-y' }, this.listOpts(this.sg.y))),
          h('div', { class: 'row' }, h('label', { for: 'sg-f', text: 'Freq' }), h('select', { id: 'sg-f' }, this.listOpts(this.sg.f, true)))
        ],
        okLabel: 'Draw',
        ok: d => {
          Object.assign(this.sg, { type: d.querySelector('#sg-t').value, x: +d.querySelector('#sg-x').value, y: +d.querySelector('#sg-y').value, f: +d.querySelector('#sg-f').value });
          setTimeout(() => this.drawGraph(), 0);
        }
      });
    },
    drawGraph() {
      this.commit();
      this.showGraph = true;
      this.active = 'graph';
      this.layout();
      App.refreshChrome();
    },
    buildGraph() {
      this.wGraph.textContent = '';
      this.gwrap = h('div', { class: 'gwrap' });
      this.canvas = h('canvas', { 'aria-label': 'Statistik-Grafik' });
      this.info = h('div', { class: 'ginfo' });
      this.gwrap.append(this.canvas, this.info);
      this.wGraph.appendChild(this.gwrap);
      this.wGraph.addEventListener('pointerdown', () => this.setActive('graph'));
    },
    draw() {
      if (!this.showGraph || !this.canvas || !this.canvas.isConnected) return;
      const cv = this.canvas, W = cv.clientWidth, H = cv.clientHeight;
      if (!W || !H) return;
      const r = (window.devicePixelRatio || 1) * (App.scale || 1);
      cv.width = Math.round(W * r); cv.height = Math.round(H * r);
      const g = cv.getContext('2d');
      g.setTransform(r, 0, 0, r, 0, 0);
      g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
      this.info.textContent = '';
      const t = this.sg.type;
      const xs = this.lists[this.sg.x], ys = this.lists[this.sg.y];
      const fr = this.sg.f >= 0 ? this.lists[this.sg.f] : null;
      if (!xs.length || ((t === 'scatter' || t === 'xyline') && ys.length !== xs.length)) {
        g.fillStyle = '#666'; g.font = '11px Helvetica, Arial, sans-serif';
        g.fillText('Keine passenden Daten in list' + (this.sg.x + 1) + (t === 'scatter' || t === 'xyline' ? '/list' + (this.sg.y + 1) : ''), 8, 18);
        return;
      }
      const data = [];
      xs.forEach((x, i) => { const n = fr ? fr[i] : 1; for (let k = 0; k < n; k++) data.push(x); });
      let xmin = Math.min(...xs), xmax = Math.max(...xs), ymin, ymax;
      let bins = null;
      if (t === 'hist') {
        const n = data.length, k = Math.max(1, Math.ceil(Math.log2(n) + 1));
        const lo = xmin, wdt = ((xmax - xmin) || 1) / k;
        bins = new Array(k).fill(0);
        data.forEach(v => { bins[Math.min(k - 1, Math.floor((v - lo) / wdt))]++; });
        bins = { lo, wdt, c: bins };
        xmax = lo + wdt * k; ymin = 0; ymax = Math.max(...bins.c) * 1.15;
      } else if (t === 'box') { ymin = 0; ymax = 1; }
      else { ymin = Math.min(...ys); ymax = Math.max(...ys); }
      const px = (xmax - xmin) * 0.08 || 1, py = (ymax - ymin) * 0.1 || 1;
      if (t !== 'hist') { xmin -= px; xmax += px; }
      if (t === 'scatter' || t === 'xyline') { ymin -= py; ymax += py; }
      const X = x => (x - xmin) / (xmax - xmin) * W, Y = y => H - (y - ymin) / (ymax - ymin) * H;
      g.strokeStyle = '#000'; g.lineWidth = 1;
      g.beginPath();
      if (ymin <= 0 && ymax >= 0) { g.moveTo(0, Math.round(Y(0)) + 0.5); g.lineTo(W, Math.round(Y(0)) + 0.5); }
      if (xmin <= 0 && xmax >= 0 && t !== 'box') { g.moveTo(Math.round(X(0)) + 0.5, 0); g.lineTo(Math.round(X(0)) + 0.5, H); }
      g.stroke();
      g.fillStyle = '#555'; g.font = '9px Helvetica, Arial, sans-serif';
      g.fillText(fmt(xmin, 4) + ' … ' + fmt(xmax, 4), 4, H - 4);
      const col = '#1a4fd8';
      if (t === 'scatter' || t === 'xyline') {
        g.fillStyle = col; g.strokeStyle = col;
        if (t === 'xyline') {
          const idx = xs.map((x, i) => i).sort((a, b) => xs[a] - xs[b]);
          g.beginPath(); idx.forEach((i, k) => (k ? g.lineTo(X(xs[i]), Y(ys[i])) : g.moveTo(X(xs[i]), Y(ys[i])))); g.stroke();
        }
        xs.forEach((x, i) => { g.fillRect(Math.round(X(x)) - 2, Math.round(Y(ys[i])) - 2, 4, 4); });
        if (this.reg) {
          g.strokeStyle = '#e0201b'; g.lineWidth = 1.5; g.beginPath();
          let pen = false;
          for (let k = 0; k <= W * 2; k++) {
            const x = xmin + (xmax - xmin) * k / (W * 2), y = this.reg.f(x);
            if (!isFinite(y)) { pen = false; continue; }
            const yy = Math.max(-H, Math.min(2 * H, Y(y)));
            if (pen) g.lineTo(X(x), yy); else g.moveTo(X(x), yy);
            pen = true;
          }
          g.stroke();
          this.info.appendChild(h('span', { text: this.reg.label + ': y=' + this.reg.formula.replace(/\*/g, '·').replace(/\+\(-/g, '−(').slice(0, 60) }));
        }
      } else if (t === 'hist') {
        g.fillStyle = 'rgba(26,79,216,.25)'; g.strokeStyle = col;
        bins.c.forEach((c, i) => {
          const x0 = X(bins.lo + i * bins.wdt), x1 = X(bins.lo + (i + 1) * bins.wdt);
          g.fillRect(x0, Y(c), x1 - x0, Y(0) - Y(c));
          g.strokeRect(Math.round(x0) + 0.5, Math.round(Y(c)) + 0.5, Math.round(x1 - x0), Math.round(Y(0) - Y(c)));
        });
        this.info.appendChild(h('span', { text: 'Klassenbreite ' + fmt(bins.wdt, 6) + ' · n=' + data.length }));
      } else if (t === 'box') {
        const s = NUM.oneVar(xs, fr || undefined);
        const yc = H / 2, bh = H * 0.28;
        g.strokeStyle = col; g.lineWidth = 1.5;
        g.strokeRect(X(s.q1), yc - bh / 2, X(s.q3) - X(s.q1), bh);
        g.beginPath();
        g.moveTo(X(s.med), yc - bh / 2); g.lineTo(X(s.med), yc + bh / 2);
        g.moveTo(X(s.min), yc); g.lineTo(X(s.q1), yc);
        g.moveTo(X(s.q3), yc); g.lineTo(X(s.max), yc);
        g.moveTo(X(s.min), yc - 6); g.lineTo(X(s.min), yc + 6);
        g.moveTo(X(s.max), yc - 6); g.lineTo(X(s.max), yc + 6);
        g.stroke();
        this.info.appendChild(h('span', { text: 'min ' + fmt(s.min, 5) + '  Q₁ ' + fmt(s.q1, 5) + '  Med ' + fmt(s.med, 5) + '  Q₃ ' + fmt(s.q3, 5) + '  max ' + fmt(s.max, 5) }));
      }
    },

    menus() {
      return [
        {
          label: 'Edit', items: [
            { label: 'Delete Cell', action: () => this.key('DEL') },
            { label: 'Insert Cell', action: () => { const L = this.lists[this.sel.c]; if (this.sel.r <= L.length) L.splice(this.sel.r, 0, 0); this.loadCell(); this.renderTable(); } },
            { label: 'Clear List', action: () => { this.lists[this.sel.c] = []; this.sel.r = 0; this.loadCell(); this.renderTable(); this.draw(); } },
            { label: 'Clear All Lists', action: () => App.dialog({ title: 'Clear All', body: [h('div', { class: 'msg', text: 'Clear list1–list6?' })], ok: () => { this.lists = this.lists.map(() => []); this.sel = { c: 0, r: 0 }; this.reg = null; this.loadCell(); this.renderTable(); this.draw(); } }) },
            { sep: true },
            { label: 'Beispieldaten laden', action: () => { this.lists[0] = [1, 2, 3, 4, 5, 6, 7, 8]; this.lists[1] = [2.1, 3.9, 6.2, 7.8, 10.1, 12.2, 13.8, 16.1]; this.sel = { c: 0, r: 0 }; this.loadCell(); this.renderTable(); this.draw(); } }
          ]
        },
        { label: 'Calc', items: [{ label: 'One-Variable', action: () => this.calcDialog('one') }, { label: 'Two-Variable', action: () => this.calcDialog('two') }, { sep: true }].concat(REG.map(([k, l]) => ({ label: l, action: () => this.calcDialog(k) }))) },
        { label: 'SetGraph', items: [{ label: 'Setting…', action: () => this.setGraphDialog() }, { label: 'Draw', action: () => this.drawGraph() }, { label: 'Hide Graph', action: () => { this.showGraph = false; this.active = 'list'; this.layout(); App.refreshChrome(); } }] }
      ];
    },
    toolbar() {
      return [
        { label: '1-Var', title: 'One-Variable', action: () => this.calcDialog('one') },
        { label: '2-Var', title: 'Two-Variable', action: () => this.calcDialog('two') },
        { label: 'Reg', title: 'Regression', menu: () => REG.map(([k, l]) => ({ label: l, action: () => this.calcDialog(k) })) },
        { icon: svg('<path d="M3 17h14M3 3v14"/><rect x="5" y="11" width="2" height="2"/><rect x="9" y="8" width="2" height="2"/><rect x="13" y="5" width="2" height="2"/>'), title: 'StatGraph Setting', action: () => this.setGraphDialog() },
        { icon: svg('<path d="M2 17h16M3 2v16"/><path d="M3 13c3-9 5-9 7-4s4 5 7-4"/>'), title: 'Graph zeichnen', action: () => this.drawGraph() },
        { label: 'Del', title: 'Zelle löschen', action: () => this.key('DEL') }
      ];
    }
  };
  App.register('stat', S);
})(window.MP = window.MP || {});

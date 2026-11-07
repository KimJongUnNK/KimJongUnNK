/* MathPad II — Sequence: explizite und rekursive Folgen, Tabelle, Graph */
(function (MP) {
  'use strict';
  const App = MP.App, B = MP.B, C = MP.core, NUM = MP.num, h = App.h, Plot = MP.Plot, svg = App.svg;
  const NAMES = ['a', 'b', 'c'];
  const fmt = (v, d) => MP.fmtShort(v, d || 6);

  const Seq = {
    title: 'Sequence',
    statusKinds: ['angle', 'complex'],
    init(saved) {
      this.mode = 'rec';
      this.rows = {
        exp: NAMES.map(() => ({ items: [], on: false })),
        rec: NAMES.map(() => ({ items: [], on: false, init: '1' }))
      };
      this.range = { start: 0, end: 10 };
      this.bottom = 'table';
      this.sel = 0;
      this.active = 'edit';
      this.view = { xmin: -1, xmax: 11, xscl: 1, ymin: -5, ymax: 50, yscl: 5 };
      if (saved) {
        try {
          this.mode = saved.mode || this.mode;
          ['exp', 'rec'].forEach(m => (saved.rows[m] || []).forEach((r, i) => { if (this.rows[m][i]) Object.assign(this.rows[m][i], r); }));
          Object.assign(this.range, saved.range || {});
          this.bottom = saved.bottom || this.bottom;
        } catch (e) { /* Standard */ }
      } else {
        // Beispiel: Fibonacci-artig wachsende Folge und eine explizite Folge
        this.rows.rec[0] = { items: B.toJSON([B.nm('an'), B.ch('+'), B.ch('2')]), on: true, init: '1' };
        this.rows.rec[1] = { items: B.toJSON([B.ch('2'), B.ch('×'), B.nm('bn')]), on: true, init: '1' };
        this.rows.exp[0] = { items: B.toJSON(MP.textToItems('n^2')), on: true };
      }
      this.ed = new MP.Editor({ onChange: () => this.renderRow(this.sel) });
      this.load();
    },
    save() { this.commit(); return { mode: this.mode, rows: this.rows, range: this.range, bottom: this.bottom }; },
    cur() { return this.rows[this.mode]; },
    load() { this.ed.setItems(B.fromJSON(this.cur()[this.sel].items)); },
    commit() { const r = this.cur()[this.sel]; if (r) r.items = B.toJSON(this.ed.root.items); },
    editor() { return this.active === 'edit' ? this.ed : null; },

    mount(work) {
      this.split = h('div', { class: 'split' });
      this.wTop = h('div', { class: 'win' });
      this.wBot = h('div', { class: 'win' });
      this.split.append(this.wTop, this.wBot);
      work.appendChild(this.split);
      this.wTop.addEventListener('pointerdown', () => this.setActive('edit'));
      this.wBot.addEventListener('pointerdown', () => this.setActive('view'));
      this.buildTop();
      this.buildBottom();
      this.layout();
    },
    hide() { this.commit(); },
    layout() {
      if (!this.split) return;
      this.wTop.classList.toggle('active', this.active === 'edit');
      this.wBot.classList.toggle('active', this.active === 'view');
      this.wTop.classList.toggle('hide', this.full === 'view');
      this.wBot.classList.toggle('hide', this.full === 'edit');
      this.split.textContent = '';
      (this.swapped ? [this.wBot, this.wTop] : [this.wTop, this.wBot]).forEach(w => this.split.appendChild(w));
      requestAnimationFrame(() => this.refreshBottom());
    },
    refresh() { this.buildTop(); this.refreshBottom(); },
    onScale() { this.refreshBottom(); },
    resize() { this.full = this.full ? null : this.active; this.layout(); },
    swap() { this.swapped = !this.swapped; this.layout(); },
    swapFocus() { this.setActive(this.active === 'edit' ? 'view' : 'edit'); },
    setActive(a) {
      if (this.active === a) return;
      if (a !== 'edit') this.commit();
      this.active = a;
      this.layout();
      this.renderRows();
      App.refreshChrome();
    },

    buildTop() {
      const w = this.wTop;
      w.textContent = '';
      const tabs = h('div', { class: 'sheets' });
      [['rec', 'Recursive'], ['exp', 'Explicit']].forEach(([m, l]) => {
        const b = h('button', { type: 'button', class: m === this.mode ? 'on' : null, text: l });
        b.addEventListener('click', e => { e.stopPropagation(); this.commit(); this.mode = m; this.sel = 0; this.load(); this.buildTop(); this.refreshBottom(); App.save(); });
        tabs.appendChild(b);
      });
      this.rowsEl = h('div', { class: 'frows' });
      w.append(tabs, this.rowsEl);
      this.renderRows();
    },
    label(i) { return this.mode === 'rec' ? NAMES[i] + 'ₙ₊₁' : NAMES[i] + 'ₙE'; },
    renderRows() {
      if (!this.rowsEl) return;
      this.rowsEl.textContent = '';
      this.rowEls = [];
      this.cur().forEach((r, i) => {
        const cb = h('input', { type: 'checkbox', 'aria-label': this.label(i) + ' verwenden' });
        cb.checked = r.on;
        cb.addEventListener('click', e => { e.stopPropagation(); r.on = cb.checked; this.refreshBottom(); App.save(); });
        const fx = h('div', { class: 'fx m', style: 'color:' + App.pal().curves[i] });
        const row = h('div', { class: 'frow' + (i === this.sel ? ' sel' : '') }, cb, h('span', { class: 'fl', style: 'width:38px;color:' + App.pal().curves[i], text: this.label(i) + ':' }), fx);
        row.addEventListener('pointerdown', e => {
          if (e.target === cb) return;
          e.preventDefault();
          this.setActive('edit');
          if (i !== this.sel) { this.commit(); this.sel = i; this.load(); this.renderRows(); }
        });
        this.rowsEl.appendChild(row);
        if (this.mode === 'rec') {
          const inp = h('input', { type: 'text', value: r.init, 'aria-label': NAMES[i] + '0', class: 'sfield', style: 'width:70px', spellcheck: 'false' });
          inp.addEventListener('change', () => { r.init = inp.value; this.refreshBottom(); App.save(); });
          this.rowsEl.appendChild(h('div', { class: 'frow', style: 'padding-left:16px;min-height:18px' }, h('span', { class: 'fl', style: 'width:38px;color:' + App.pal().curves[i], text: NAMES[i] + (this.range.start >= 1 ? '₁' : '₀') + ':' }), inp));
        }
        this.rowEls[i] = { row, fx };
        this.renderRow(i);
      });
      this.rowsEl.appendChild(h('div', { class: 'hint', style: 'padding:4px 6px', text: this.mode === 'rec' ? 'aₙ, bₙ, cₙ und n über die Toolbar einfügen. Startwert darunter.' : 'Term in n, z. B. n^2 oder 3·2^n.' }));
    },
    renderRow(i) {
      if (!this.rowEls || !this.rowEls[i]) return;
      const fx = this.rowEls[i].fx;
      if (i === this.sel && this.active === 'edit') this.ed.render(fx, true);
      else { fx.textContent = ''; fx.appendChild(B.render(B.row(B.fromJSON(this.cur()[i].items)), {})); }
    },

    /* ---------- Rechnen ---------- */
    compute() {
      this.commit();
      const n0 = Math.round(this.range.start), n1 = Math.round(this.range.end);
      if (!(n1 >= n0) || n1 - n0 > 2000) throw new C.MathError('Range ERROR');
      const out = [];
      const vars = ['n', 'an', 'bn', 'cn'];
      const opts = { angle: App.settings.angle, values: MP.numericVars(), fns: App.env.fns };
      const rows = this.cur();
      const fns = rows.map(r => {
        if (!r.on || !r.items.length) return null;
        return NUM.compile(B.parse(B.row(B.fromJSON(r.items)), App.env.userFns), vars, opts);
      });
      if (this.mode === 'exp') {
        fns.forEach((f, i) => { if (f) { const vals = []; for (let n = n0; n <= n1; n++) vals.push([n, f(n, NaN, NaN, NaN)]); out.push({ i, vals }); } });
        return out;
      }
      // Rekursiv: alle Folgen gemeinsam fortschreiben (aₙ₊₁ darf bₙ benutzen)
      const cur = rows.map(r => MP.evalNum(r.init));
      const series = rows.map(() => []);
      for (let n = n0; n <= n1; n++) {
        rows.forEach((r, i) => { if (fns[i]) series[i].push([n, cur[i]]); });
        const next = cur.slice();
        rows.forEach((r, i) => { if (fns[i]) next[i] = fns[i](n, cur[0], cur[1], cur[2]); });
        for (let i = 0; i < 3; i++) cur[i] = next[i];
      }
      fns.forEach((f, i) => { if (f) out.push({ i, vals: series[i] }); });
      return out;
    },

    /* ---------- Unteres Fenster ---------- */
    buildBottom() {
      this.wBot.textContent = '';
      if (this.bottom === 'table') { this.tEl = h('div', { class: 'tview' }); this.wBot.appendChild(this.tEl); return; }
      this.gv = Plot.graphWin(this.wBot);
      Plot.bind(this.gv.wrap, this.gv.canvas, () => this.view, () => this.draw());
    },
    refreshBottom() {
      if (!this.wBot) return;
      if (this.bottom === 'table') this.renderTable(); else this.draw();
    },
    renderTable() {
      if (!this.tEl) return;
      let data;
      try { data = this.compute(); } catch (e) { this.tEl.textContent = e.message || 'ERROR'; return; }
      const tb = h('table');
      const hr = h('tr', null, h('th', { text: 'n' }));
      data.forEach(d => hr.appendChild(h('th', { text: NAMES[d.i] + 'ₙ', style: 'color:' + App.pal().curves[d.i] })));
      tb.appendChild(h('thead', null, hr));
      const body = h('tbody');
      const len = data.length ? data[0].vals.length : 0;
      for (let k = 0; k < len; k++) {
        const tr = h('tr', null, h('td', { text: String(data[0].vals[k][0]) }));
        data.forEach(d => tr.appendChild(h('td', { text: fmt(d.vals[k][1], 8) })));
        body.appendChild(tr);
      }
      tb.appendChild(body);
      this.tEl.textContent = '';
      this.tEl.appendChild(tb);
      if (!data.length) this.tEl.appendChild(h('div', { class: 'empty', text: 'Keine Folge ausgewählt.' }));
    },
    autoView() {
      let data;
      try { data = this.compute(); } catch (e) { return; }
      let lo = Infinity, hi = -Infinity;
      data.forEach(d => d.vals.forEach(([, v]) => { if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }));
      if (!isFinite(lo)) return;
      const pad = (hi - lo || 1) * 0.1;
      Object.assign(this.view, { xmin: this.range.start - 1, xmax: this.range.end + 1, ymin: Math.min(0, lo) - pad, ymax: hi + pad });
      Plot.niceScale(this.view);
    },
    draw() {
      if (this.bottom !== 'graph' || !this.gv) return;
      const s = Plot.setup(this.gv.canvas);
      if (!s) return;
      const { g, W, H } = s;
      const t = Plot.axes(g, W, H, this.view);
      let data;
      try { data = this.compute(); } catch (e) { this.gv.info.textContent = e.message; return; }
      data.forEach(d => {
        g.fillStyle = App.pal().curves[d.i];
        g.strokeStyle = App.pal().curves[d.i];
        d.vals.forEach(([n, v]) => {
          if (!isFinite(v)) return;
          const x = t.X(n), y = t.Y(v);
          g.beginPath(); g.arc(x, y, 2.4, 0, 2 * Math.PI); g.fill();
        });
      });
      this.gv.info.textContent = data.length ? 'n = ' + this.range.start + ' … ' + this.range.end : '';
    },
    rangeDialog() {
      const f = (id, l, v) => h('div', { class: 'row' }, h('label', { for: id, text: l }), h('input', { type: 'text', id, value: String(v) }));
      App.dialog({
        title: 'Sequence Table Input', body: [f('sq-s', 'Start n', this.range.start), f('sq-e', 'End n', this.range.end)],
        ok: d => {
          const s = Math.round(MP.evalNum(d.querySelector('#sq-s').value)), e = Math.round(MP.evalNum(d.querySelector('#sq-e').value));
          if (!isFinite(s) || !isFinite(e) || e < s || e - s > 2000) { App.error('Range ERROR'); return false; }
          Object.assign(this.range, { start: s, end: e });
          this.buildTop();
          this.refreshBottom();
        }
      });
    },

    key(k) {
      if (this.active === 'edit') {
        if (k === 'EXE') {
          this.commit();
          const r = this.cur()[this.sel];
          if (r.items.length) r.on = true;
          this.sel = Math.min(2, this.sel + 1);
          this.load();
          this.renderRows();
          this.refreshBottom();
          return true;
        }
        if (k === 'UP' || k === 'DOWN') {
          if (k === 'UP' ? this.ed.up() : this.ed.down()) return true;
          this.commit();
          this.sel = Math.max(0, Math.min(2, this.sel + (k === 'UP' ? -1 : 1)));
          this.load();
          this.renderRows();
          return true;
        }
        return false;
      }
      if (k === 'ESC') { this.setActive('edit'); return true; }
      return true;
    },
    menus() {
      return [
        { label: 'Edit', items: [{ label: 'Clear Row', action: () => { this.ed.clear(); this.commit(); this.cur()[this.sel].on = false; this.renderRows(); this.refreshBottom(); } }, { label: 'Clear All', action: () => { this.rows[this.mode].forEach(r => { r.items = []; r.on = false; }); this.load(); this.renderRows(); this.refreshBottom(); } }] },
        { label: 'Type', items: [{ label: 'Recursive (aₙ₊₁)', check: this.mode === 'rec', action: () => { this.commit(); this.mode = 'rec'; this.sel = 0; this.load(); this.buildTop(); this.refreshBottom(); } }, { label: 'Explicit (aₙE)', check: this.mode === 'exp', action: () => { this.commit(); this.mode = 'exp'; this.sel = 0; this.load(); this.buildTop(); this.refreshBottom(); } }] },
        { label: 'n,aₙ', items: [['n', B.ch('n')], ['aₙ', B.nm('an')], ['bₙ', B.nm('bn')], ['cₙ', B.nm('cn')]].map(([l, it]) => ({ label: l, action: () => App.insert(it.k === 'nm' ? App.A.nm(it.v) : App.A.ch(it.v)) })) }
      ];
    },
    toolbar() {
      return [
        { label: 'n', title: 'n einfügen', action: () => App.insert(App.A.ch('n')) },
        { label: 'aₙ', title: 'aₙ einfügen', action: () => App.insert(App.A.nm('an')) },
        { label: 'bₙ', title: 'bₙ einfügen', action: () => App.insert(App.A.nm('bn')) },
        { label: 'cₙ', title: 'cₙ einfügen', action: () => App.insert(App.A.nm('cn')) },
        { icon: svg('<rect x="2.5" y="3.5" width="15" height="13"/><path d="M2.5 7.5h15M8 3.5v13M12.5 3.5v13"/>'), title: 'Tabelle', on: this.bottom === 'table', action: () => { this.bottom = 'table'; this.buildBottom(); this.refreshBottom(); App.refreshChrome(); } },
        { icon: svg('<path d="M2 17h16M3 2v16"/><circle cx="6" cy="14" r="1.2"/><circle cx="10" cy="11" r="1.2"/><circle cx="14" cy="6" r="1.2"/>'), title: 'Graph', on: this.bottom === 'graph', action: () => { this.bottom = 'graph'; this.buildBottom(); this.autoView(); this.layout(); App.refreshChrome(); } },
        { icon: svg('<rect x="2.5" y="3.5" width="15" height="13"/><path d="M6 7h8M6 10h8M6 13h5"/>'), title: 'Bereich für n', action: () => this.rangeDialog() }
      ];
    }
  };
  App.register('seq', Seq);
})(window.MP = window.MP || {});

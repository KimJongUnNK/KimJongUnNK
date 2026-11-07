/* MathPad II — Spreadsheet: Zellen, Formeln mit Bezuegen und Bereichen, Ausfuellen */
(function (MP) {
  'use strict';
  const App = MP.App, B = MP.B, C = MP.core, h = App.h;
  const COLS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', MAXR = 999;
  const ref = (c, r) => COLS[c] + (r + 1);
  const parseRef = s => { const m = /^\$?([A-Z])\$?(\d+)$/.exec(s); return m ? { c: COLS.indexOf(m[1]), r: +m[2] - 1 } : null; };

  const Sheet = {
    title: 'Spreadsheet',
    statusKinds: ['dec', 'angle'],
    init(saved) {
      this.cells = {};
      this.sel = { c: 0, r: 0 };
      this.clip = null;
      if (saved && saved.cells) this.cells = saved.cells;
      else {
        // kleines Beispiel: Einkaufsliste mit Summe
        Object.assign(this.cells, { A1: 'Menge', B1: 'Preis', C1: 'Summe', A2: '3', B2: '2.5', C2: '=A2*B2', A3: '2', B3: '4.2', C3: '=A3*B3', A4: '5', B4: '0.8', C4: '=A4*B4', B5: 'Total', C5: '=sum(C2:C4)' });
      }
      this.ed = new MP.Editor({ onChange: () => { this.dirty = true; this.renderInput(); } });
      this.load();
    },
    save() { return { cells: this.cells }; },
    editor() { return this.ed; },
    load() {
      const raw = this.cells[ref(this.sel.c, this.sel.r)] || '';
      const cb = this.ed.onChange;
      this.ed.onChange = () => {};
      // Formeln als Mathe-Eingabe, Text Zeichen fuer Zeichen (ohne π-/Funktions-Ersetzung)
      this.ed.setItems(!raw ? [] : raw[0] === '=' ? MP.textToItems(raw) : B.chars(raw));
      this.ed.onChange = cb;
      this.dirty = false;
    },

    /* ---------- Rechnen ---------- */
    recalc() {
      this.cache = {};
      this.stack = new Set();
    },
    value(key) {
      if (key in this.cache) return this.cache[key];
      const raw = (this.cells[key] || '').trim();
      let v;
      if (!raw) v = { t: 'empty' };
      else if (raw[0] === '=') {
        if (this.stack.has(key)) return { t: 'err', s: 'Zirkelbezug' };
        this.stack.add(key);
        try { v = this.evalFormula(raw.slice(1)); } catch (e) { v = { t: 'err', s: e.message || 'ERROR' }; }
        this.stack.delete(key);
      } else {
        const n = /^[-−+]?[\d.]+([eEᴇ][-−+]?\d+)?$/.test(raw.replace(/\s/g, '')) ? MP.evalNum(raw.replace('ᴇ', 'E')) : NaN;
        v = isFinite(n) ? { t: 'num', v: n } : { t: 'text', s: raw };
      }
      this.cache[key] = v;
      return v;
    },
    evalFormula(f) {
      // Bereiche A1:B3 -> Liste, einzelne Bezuege -> Werte
      let s = f.replace(/(\$?[A-Z]\$?\d+):(\$?[A-Z]\$?\d+)/g, (m, a, b) => {
        const p = parseRef(a), q = parseRef(b);
        if (!p || !q) throw new Error('Bezug ungültig');
        const vals = [];
        for (let c = Math.min(p.c, q.c); c <= Math.max(p.c, q.c); c++) for (let r = Math.min(p.r, q.r); r <= Math.max(p.r, q.r); r++) {
          const v = this.value(ref(c, r));
          if (v.t === 'num') vals.push('(' + v.v + ')');
          else if (v.t === 'err') throw new Error(v.s);
        }
        return '{' + (vals.join(',') || '0') + '}';
      });
      s = s.replace(/count\(\{([^}]*)\}\)/g, (m, inner) => String(inner ? inner.split(',').length : 0));
      s = s.replace(/\$?([A-Z])\$?(\d+)/g, (m) => {
        const p = parseRef(m);
        if (!p || p.r >= MAXR) throw new Error('Bezug ungültig');
        const v = this.value(ref(p.c, p.r));
        if (v.t === 'num') return '(' + v.v + ')';
        if (v.t === 'empty') return '0';
        if (v.t === 'err') throw new Error(v.s);
        throw new Error('Text in Rechnung');
      });
      const ast = C.parseString(s, { split: true, userFns: App.env.userFns });
      const env = Object.assign({}, App.env, { settings: Object.assign({}, App.settings, { decimal: true }) });
      const r = MP.cas.evaluate(ast, env);
      const a = r.ast;
      const n = MP.num.compile(a, [], { angle: 'rad', values: {} });
      const v = n();
      if (isFinite(v)) return { t: 'num', v };
      if (a.type === 'text') return { t: 'err', s: a.v };
      return { t: 'text', s: B.text(MP.display.toRow(a, { fmt: App.settings.fmt })) };
    },
    show(v) {
      if (v.t === 'num') return MP.fmtShort(v.v, 9);
      if (v.t === 'err') return 'ERROR';
      if (v.t === 'text') return v.s;
      return '';
    },

    /* ---------- Darstellung ---------- */
    mount(work) {
      this.lbl = h('span', { class: 'lbl', style: 'min-width:30px;font-weight:700;color:inherit' });
      this.inFx = h('div', { class: 'fx m' });
      this.inFx.addEventListener('pointerdown', e => { e.preventDefault(); this.ed.placeFromEvent(e); });
      this.grid = h('div', { class: 'lwrap' });
      const top = h('div', { class: 'lin', style: 'border-top:0;border-bottom:1px solid var(--lcd-line)' }, this.lbl, this.inFx);
      work.appendChild(h('div', { class: 'win active' }, top, this.grid));
      this.renderGrid();
    },
    refresh() { this.renderGrid(); },
    renderInput() {
      if (!this.lbl) return;
      this.lbl.textContent = ref(this.sel.c, this.sel.r);
      this.ed.render(this.inFx, true);
    },
    renderGrid() {
      if (!this.grid) return;
      this.recalc();
      let maxR = 30, maxC = 6;
      Object.keys(this.cells).forEach(k => { const p = parseRef(k); if (p) { maxR = Math.max(maxR, p.r + 6); maxC = Math.max(maxC, p.c + 2); } });
      maxR = Math.min(MAXR, Math.max(maxR, this.sel.r + 6));
      maxC = Math.min(26, Math.max(maxC, this.sel.c + 2));
      const t = h('table', { class: 'ltab' });
      const hr = h('tr', null, h('th', { class: 'rn' }));
      for (let c = 0; c < maxC; c++) hr.appendChild(h('th', { text: COLS[c], class: c === this.sel.c ? 'on' : null }));
      t.appendChild(h('thead', null, hr));
      const body = h('tbody');
      for (let r = 0; r < maxR; r++) {
        const tr = h('tr', null, h('td', { class: 'rn', text: String(r + 1) }));
        for (let c = 0; c < maxC; c++) {
          const key = ref(c, r), v = this.value(key);
          const td = h('td', { text: this.show(v), class: (c === this.sel.c && r === this.sel.r ? 'sel' : '') + (v.t === 'text' ? ' txt' : '') + (v.t === 'err' ? ' er' : '') });
          td.addEventListener('pointerdown', e => { e.preventDefault(); this.select(c, r); });
          tr.appendChild(td);
        }
        body.appendChild(tr);
      }
      t.appendChild(body);
      this.grid.textContent = '';
      this.grid.appendChild(t);
      const sel = t.querySelector('td.sel');
      if (sel) {
        const br = this.grid.getBoundingClientRect(), sr = sel.getBoundingClientRect();
        if (sr.bottom > br.bottom || sr.top < br.top + 16 || sr.right > br.right || sr.left < br.left + 18) sel.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
      this.renderInput();
    },
    commit() {
      if (!this.dirty) return;
      const key = ref(this.sel.c, this.sel.r);
      const txt = this.ed.isEmpty() ? '' : this.ed.text();
      if (txt) this.cells[key] = txt; else delete this.cells[key];
      this.dirty = false;
    },
    select(c, r) {
      this.commit();
      this.sel = { c: Math.max(0, Math.min(25, c)), r: Math.max(0, Math.min(MAXR - 1, r)) };
      this.load();
      this.renderGrid();
    },
    shift(raw, dr, dc) {
      if (!raw || raw[0] !== '=') return raw;
      return '=' + raw.slice(1).replace(/(\$?)([A-Z])(\$?)(\d+)/g, (m, ac, col, ar, row) => {
        const c = ac ? COLS.indexOf(col) : COLS.indexOf(col) + dc, r = ar ? +row : +row + dr;
        if (c < 0 || c > 25 || r < 1) return '#REF';
        return ac + COLS[c] + ar + r;
      });
    },
    fillDialog() {
      this.commit();
      const src = ref(this.sel.c, this.sel.r);
      App.dialog({
        title: 'Fill Range', body: [h('div', { class: 'row' }, h('label', { for: 'fl-to', text: 'Von ' + src + ' bis Zeile' }), h('input', { type: 'text', id: 'fl-to', value: String(this.sel.r + 10) }))],
        ok: d => {
          const to = Math.round(MP.evalNum(d.querySelector('#fl-to').value));
          if (!(to > this.sel.r + 1 && to <= MAXR)) { App.error('Range ERROR'); return false; }
          const raw = this.cells[src];
          for (let r = this.sel.r + 1; r < to; r++) {
            const t = this.shift(raw, r - this.sel.r, 0);
            if (t) this.cells[ref(this.sel.c, r)] = t;
          }
          this.renderGrid();
        }
      });
    },
    key(k) {
      const { c, r } = this.sel;
      switch (k) {
        case 'EXE': this.commit(); this.select(c, r + 1); return true;
        case 'UP': this.select(c, r - 1); return true;
        case 'DOWN': this.select(c, r + 1); return true;
        case 'LEFT': if (!this.dirty) { this.select(c - 1, r); return true; } return false;
        case 'RIGHT': if (!this.dirty) { this.select(c + 1, r); return true; } return false;
        case 'DEL': delete this.cells[ref(c, r)]; this.load(); this.renderGrid(); return true;
        case 'ESC': this.load(); this.renderInput(); return true;
      }
      return false;
    },
    copy() { App.copyText(this.cells[ref(this.sel.c, this.sel.r)] || ''); },
    menus() {
      const key = () => ref(this.sel.c, this.sel.r);
      return [
        {
          label: 'Edit', items: [
            { label: 'Cut', action: () => { this.clip = { raw: this.cells[key()], from: Object.assign({}, this.sel) }; delete this.cells[key()]; this.load(); this.renderGrid(); } },
            { label: 'Copy', action: () => { this.commit(); this.clip = { raw: this.cells[key()], from: Object.assign({}, this.sel) }; this.copy(); } },
            { label: 'Paste', action: () => { if (!this.clip) return; const t = this.shift(this.clip.raw, this.sel.r - this.clip.from.r, this.sel.c - this.clip.from.c); if (t) this.cells[key()] = t; else delete this.cells[key()]; this.load(); this.renderGrid(); } },
            { label: 'Fill Range…', action: () => this.fillDialog() },
            { sep: true },
            { label: 'Clear Cell', action: () => this.key('DEL') },
            { label: 'Clear All', action: () => App.dialog({ title: 'Clear All', body: [h('div', { class: 'msg', text: 'Alle Zellen löschen?' })], ok: () => { this.cells = {}; this.sel = { c: 0, r: 0 }; this.load(); this.renderGrid(); } }) }
          ]
        },
        { label: 'Insert', items: [['sum', 'sum('], ['mean', 'mean('], ['median', 'median('], ['max', 'max('], ['min', 'min('], ['count', 'count(']].map(([n, l]) => ({ label: l, action: () => App.insert(App.A.fn(n)) })).concat([{ label: '=', action: () => App.insert(App.A.ch('=')) }, { label: ':', action: () => App.insert(App.A.ch(':')) }]) }
      ];
    },
    toolbar() {
      return [
        { label: '=', title: 'Formel beginnen', action: () => App.insert(App.A.ch('=')) },
        { label: 'sum', title: 'Summe', action: () => App.insert(App.A.fn('sum')) },
        { label: 'mean', title: 'Mittelwert', action: () => App.insert(App.A.fn('mean')) },
        { label: ':', title: 'Bereich', action: () => App.insert(App.A.ch(':')) },
        { label: 'Fill', title: 'Nach unten ausfüllen', action: () => this.fillDialog() },
        { label: 'Del', title: 'Zelle löschen', action: () => this.key('DEL') }
      ];
    }
  };
  App.register('sheet', Sheet);
})(window.MP = window.MP || {});

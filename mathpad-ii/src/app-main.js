/* MathPad II — Main-Anwendung (CAS) */
(function (MP) {
  'use strict';
  const App = MP.App, B = MP.B, C = MP.core, h = App.h, A = App.A;

  function errMsg(e) {
    if (e instanceof C.MathError) return e.message;
    if (window.console) console.error(e);
    return 'Syntax ERROR';
  }
  function textToItems(s) {
    const ed = new MP.Editor();
    ed.paste(String(s || ''));
    return ed.getItems();
  }
  MP.textToItems = textToItems;

  const Main = {
    title: 'Main',
    statusKinds: ['alg', 'dec', 'complex', 'angle'],
    entries: [],
    editIdx: 0,
    pending: [],
    init(saved) {
      this.ed = new MP.Editor({ onChange: () => this.renderEditor() });
      if (saved && Array.isArray(saved.entries)) this.entries = saved.entries;
      this.editIdx = this.entries.length;
      if (saved && saved.pending) this.ed.setItems(B.fromJSON(saved.pending));
    },
    save() {
      return { entries: this.entries.slice(-150), pending: this.editIdx === this.entries.length ? B.toJSON(this.ed.root.items) : B.toJSON(this.pending) };
    },
    editor() { return this.ed; },
    mount(work) {
      this.scroll = h('div', { class: 'mscroll', id: 'mscroll' });
      this.win = h('div', { class: 'win active' }, this.scroll);
      work.appendChild(this.win);
      this.renderAll(true);
    },
    refresh() { this.renderAll(false); },
    layout() { this.scrollToEdit(); },

    /* ---------- Darstellung ---------- */
    outRow(e) {
      if (e.err) return null;
      if (e.showAlt && e.exact) {
        try {
          const a = e.dec ? e.exact : MP.cas.toDecimal(e.exact);
          return MP.display.toRow(a, { fmt: App.settings.fmt });
        } catch (x) { /* Original zeigen */ }
      }
      return B.row(B.fromJSON(e.out));
    },
    mathEl(row) {
      const w = h('span', { class: 'm' });
      w.appendChild(B.render(row, {}));
      return w;
    },
    renderAll(scroll) {
      const sc = this.scroll;
      if (!sc) return;
      sc.textContent = '';
      this.entries.forEach((e, i) => sc.appendChild(this.entryEl(e, i)));
      if (this.editIdx >= this.entries.length) {
        const ne = h('div', { class: 'entry editing' });
        this.edEl = h('div', { class: 'in m' });
        ne.appendChild(this.edEl);
        this.bindEditor(this.edEl);
        sc.appendChild(ne);
      }
      this.renderEditor();
      B.stretchParens(sc);
      if (scroll !== false) this.scrollToEdit();
    },
    entryEl(e, i) {
      const el = h('div', { class: 'entry' + (i === this.editIdx ? ' editing' : '') });
      let inEl;
      if (i === this.editIdx) {
        inEl = h('div', { class: 'in m' });
        this.edEl = inEl;
        this.bindEditor(inEl);
      } else {
        inEl = h('div', { class: 'in m' });
        inEl.appendChild(B.render(B.row(B.fromJSON(e.in)), {}));
        inEl.addEventListener('pointerdown', ev => { ev.preventDefault(); this.startEdit(i); });
      }
      el.appendChild(inEl);
      const out = h('div', { class: 'out m' + (e.err ? ' err' : '') });
      if (e.err) out.textContent = e.err;
      else {
        out.appendChild(B.render(this.outRow(e), {}));
        out.title = 'Klicken: Ergebnis in die Eingabe übernehmen';
        out.addEventListener('pointerdown', ev => {
          ev.preventDefault();
          const row = this.outRow(e);
          this.ed.insertItems(row.items);
          out.classList.add('flash');
          setTimeout(() => out.classList.remove('flash'), 180);
        });
      }
      el.appendChild(out);
      return el;
    },
    bindEditor(el) {
      el.addEventListener('pointerdown', ev => { ev.preventDefault(); this.ed.placeFromEvent(ev); });
    },
    renderEditor() {
      if (!this.edEl || !this.edEl.isConnected) return;
      this.ed.render(this.edEl, true);
      this.scrollToEdit();
    },
    scrollToEdit() {
      if (!this.edEl || !this.scroll) return;
      const cur = this.edEl.querySelector('.m-cur') || this.edEl;
      const sr = this.scroll.getBoundingClientRect(), cr = cur.getBoundingClientRect();
      const s = App.scale || 1;
      if (cr.bottom > sr.bottom - 6) this.scroll.scrollTop += (cr.bottom - sr.bottom) / s + 30;
      else if (cr.top < sr.top) this.scroll.scrollTop -= (sr.top - cr.top) / s + 8;
    },

    /* ---------- Bearbeiten ---------- */
    startEdit(i) {
      if (i < 0) return;
      if (this.editIdx >= this.entries.length) this.pending = this.ed.getItems();
      if (i >= this.entries.length) {
        this.editIdx = this.entries.length;
        this.ed.setItems(this.pending || []);
      } else {
        this.editIdx = i;
        this.ed.setItems(B.fromJSON(this.entries[i].in));
      }
      this.renderAll(true);
    },
    exec(approx) {
      if (this.ed.isEmpty()) {
        if (this.editIdx < this.entries.length) this.startEdit(this.editIdx + 1);
        return;
      }
      const inItems = this.ed.getItems();
      let entry;
      try {
        let ast = this.ed.ast();
        if (approx) ast = C.call('approx', [ast]);
        const r = MP.cas.evaluate(ast, App.env);
        const row = MP.display.toRow(r.ast, { fmt: App.settings.fmt });
        entry = { in: B.toJSON(inItems), out: B.toJSON(row.items), exact: r.exact, dec: r.decimal };
        if (r.exact && r.exact.type !== 'text') App.env.ans = r.exact;
      } catch (e) {
        App.error(errMsg(e));
        return;
      }
      if (this.editIdx < this.entries.length) {
        this.entries[this.editIdx] = entry;
        this.editIdx++;
        if (this.editIdx < this.entries.length) this.ed.setItems(B.fromJSON(this.entries[this.editIdx].in));
        else this.ed.setItems(this.pending || []);
        this.pending = [];
      } else {
        this.entries.push(entry);
        this.editIdx = this.entries.length;
        this.ed.setItems([]);
      }
      this.renderAll(true);
      App.save();
    },
    toggleLast() {
      const i = Math.min(this.editIdx, this.entries.length) - 1;
      const e = this.entries[i >= 0 ? i : this.entries.length - 1];
      if (!e || !e.exact) return;
      e.showAlt = !e.showAlt;
      this.renderAll(false);
    },
    wrap(kind, extra) {
      const items = this.ed.isEmpty() ? [B.nm('ans')] : this.ed.getItems();
      let out;
      if (kind === 'int') out = [B.t('int', [items, [B.ch(extra || 'x')]])];
      else if (kind === 'diff') out = [B.t('diff', [[B.ch(extra || 'x')], items])];
      else out = [B.fn(kind)].concat(items, extra ? [B.ch(',')].concat(extra) : [], [B.ch(')')]);
      this.ed.setItems(B.clone(out));
      this.exec(false);
    },

    /* ---------- Interaktiv mit Dialog ---------- */
    interactive(kind) {
      const cur = this.ed.isEmpty() ? [B.nm('ans')] : this.ed.getItems();
      const field = (id, label, val) => h('div', { class: 'row' }, h('label', { for: id, text: label }), h('input', { type: 'text', id, value: val, spellcheck: 'false', autocomplete: 'off' }));
      const read = (d, id) => d.querySelector('#' + id).value.trim();
      const items = s => textToItems(s);
      const done = out => { this.ed.setItems(B.clone(out)); this.exec(false); };
      const prev = h('div', { class: 'm', style: 'margin-bottom:6px;padding:2px;border:1px dotted #aab' });
      prev.appendChild(B.render(B.row(B.clone(cur)), {}));
      switch (kind) {
        case 'solve':
          App.dialog({ title: 'solve', body: [prev, field('i-var', 'Variable', 'x')], ok: d => done([B.fn('solve')].concat(cur, [B.ch(',')], items(read(d, 'i-var') || 'x'), [B.ch(')')])) });
          break;
        case 'diff':
          App.dialog({
            title: 'diff', body: [prev, field('i-var', 'Variable', 'x'), field('i-ord', 'Order', '1')],
            ok: d => {
              const v = items(read(d, 'i-var') || 'x'), n = read(d, 'i-ord') || '1';
              done(n === '1' ? [B.t('diff', [v, cur])] : n === '2' ? [B.t('diff2', [v, cur])] : [B.fn('diff')].concat(cur, [B.ch(',')], v, [B.ch(',')], items(n), [B.ch(')')]));
            }
          });
          break;
        case 'int':
          App.dialog({
            title: '∫', body: [prev, field('i-var', 'Variable', 'x'), field('i-lo', 'Lower (leer: unbestimmt)', ''), field('i-hi', 'Upper', '')],
            ok: d => {
              const v = items(read(d, 'i-var') || 'x'), lo = read(d, 'i-lo'), hi = read(d, 'i-hi');
              done(lo && hi ? [B.t('dint', [items(lo), items(hi), cur, v])] : [B.t('int', [cur, v])]);
            }
          });
          break;
        case 'lim':
          App.dialog({
            title: 'lim', body: [prev, field('i-var', 'Variable', 'x'), field('i-pt', 'Point (∞ = inf)', '0')],
            ok: d => {
              let p = read(d, 'i-pt') || '0';
              if (/^-?inf/i.test(p)) p = p.replace(/inf(inity)?/i, '∞');
              done([B.t('lim', [items(read(d, 'i-var') || 'x'), items(p), cur])]);
            }
          });
          break;
        case 'sum': case 'prod':
          App.dialog({
            title: kind === 'sum' ? 'Σ' : 'Π', body: [prev, field('i-var', 'Variable', 'k'), field('i-lo', 'Lower', '1'), field('i-hi', 'Upper', '10')],
            ok: d => {
              let hi = read(d, 'i-hi');
              if (/^inf/i.test(hi)) hi = '∞';
              done([B.t(kind, [items(read(d, 'i-var') || 'k'), items(read(d, 'i-lo') || '1'), items(hi || '10'), cur])]);
            }
          });
          break;
        case 'fMax': case 'fMin':
          App.dialog({
            title: kind, body: [prev, field('i-var', 'Variable', 'x'), field('i-lo', 'Start', '-10'), field('i-hi', 'End', '10')],
            ok: d => done([B.fn(kind)].concat(cur, [B.ch(',')], items(read(d, 'i-var') || 'x'), [B.ch(',')], items(read(d, 'i-lo') || '-10'), [B.ch(',')], items(read(d, 'i-hi') || '10'), [B.ch(')')]))
          });
          break;
        default:
          this.wrap(kind);
      }
    },

    /* ---------- Tasten ---------- */
    key(k) {
      if (k === 'EXE') { this.exec(false); return true; }
      if (k === 'APPROX') { this.exec(true); return true; }
      if (k === 'UP') {
        if (!this.ed.up()) this.startEdit(Math.min(this.editIdx, this.entries.length) - 1);
        return true;
      }
      if (k === 'DOWN') {
        if (!this.ed.down() && this.editIdx < this.entries.length) this.startEdit(this.editIdx + 1);
        return true;
      }
      if (k === 'ESC') return true;
      return false;
    },
    copy() { App.copyText(this.ed.isEmpty() && this.entries.length ? B.text(this.outRow(this.entries[this.entries.length - 1])) : this.ed.text()); },

    /* ---------- Menues ---------- */
    menus() {
      const ins = a => () => App.insert(a);
      const fnItems = list => list.map(([l, n]) => ({ label: l, action: ins(A.fn(n)) }));
      return [
        {
          label: 'Edit', items: [
            { label: 'Copy', action: () => this.copy() },
            { label: 'Clear All', action: () => App.dialog({ title: 'Clear All', body: [h('div', { class: 'msg', text: 'Clear all expressions?' })], ok: () => { this.entries = []; this.editIdx = 0; this.ed.setItems([]); this.renderAll(true); } }) },
            { label: 'Delete Line', action: () => { if (this.editIdx < this.entries.length) { this.entries.splice(this.editIdx, 1); this.startEdit(Math.min(this.editIdx, this.entries.length)); } else this.ed.clear(); } },
            { sep: true },
            { label: 'Clear Variables', action: () => { App.env.vars = {}; App.env.fns = {}; App.env.userFns.clear(); App.env.ans = null; App.message('Variables', 'All variables cleared'); } }
          ]
        },
        {
          label: 'Action', items: [
            { label: 'Transformation', sub: fnItems([['approx', 'approx'], ['simplify', 'simplify'], ['expand', 'expand'], ['factor', 'factor'], ['combine', 'combine'], ['partfrac', 'partfrac'], ['propFrac', 'propFrac']]) },
            {
              label: 'Calculation', sub: [
                { label: 'diff', action: ins(A.tpl('diff')) }, { label: '∫', action: ins(A.tpl('int')) }, { label: '∫ (definite)', action: ins(A.tpl('dint')) },
                { label: 'lim', action: ins(A.tpl('lim')) }, { label: 'Σ', action: ins(A.tpl('sum')) }, { label: 'Π', action: ins(A.tpl('prod')) },
                { label: 'fMax', action: ins(A.fn('fMax')) }, { label: 'fMin', action: ins(A.fn('fMin')) }, { label: 'nCr', action: ins(A.fn('nCr')) }, { label: 'nPr', action: ins(A.fn('nPr')) }
              ]
            },
            { label: 'Advanced', sub: [{ label: 'solve', action: ins(A.fn('solve')) }, { label: 'Define', action: ins(A.nm('Define')) }, { label: 'gcd', action: ins(A.fn('gcd')) }, { label: 'lcm', action: ins(A.fn('lcm')) }, { label: 'mod', action: ins(A.fn('mod')) }] },
            { label: 'Complex', sub: fnItems([['re', 're'], ['im', 'im'], ['arg', 'arg'], ['conjg', 'conjg'], ['abs', 'abs']]) },
            { label: 'List', sub: fnItems([['mean', 'mean'], ['median', 'median'], ['sum', 'sum'], ['prod', 'product'], ['max', 'max'], ['min', 'min'], ['seq', 'seq'], ['sortA', 'sortA'], ['sortD', 'sortD'], ['dim', 'dim'], ['stdDev', 'stdDev'], ['variance', 'variance']]) },
            { label: 'Matrix', sub: [{ label: '2×2', action: ins(A.tpl('mat', { r: 2, cols: 2 })) }, { label: '3×3', action: ins(A.tpl('mat', { r: 3, cols: 3 })) }].concat(fnItems([['det', 'det'], ['trn', 'trn'], ['dim', 'dim']])) },
            { label: 'Equation/Inequality', sub: [{ label: 'solve', action: ins(A.fn('solve')) }].concat(['=', '≠', '<', '>', '≤', '≥'].map(c => ({ label: c, action: ins(A.ch(c)) }))) }
          ]
        },
        {
          label: 'Interactive', items: [
            { label: 'Transformation', sub: [['approx', 'approx'], ['simplify', 'simplify'], ['expand', 'expand'], ['factor', 'factor'], ['combine', 'combine']].map(([l, n]) => ({ label: l, action: () => this.wrap(n) })) },
            { label: 'Calculation', sub: [['diff', 'diff'], ['∫', 'int'], ['lim', 'lim'], ['Σ', 'sum'], ['Π', 'prod'], ['fMax', 'fMax'], ['fMin', 'fMin']].map(([l, n]) => ({ label: l, action: () => this.interactive(n) })) },
            { label: 'Equation/Inequality', sub: [{ label: 'solve', action: () => this.interactive('solve') }] },
            { label: 'Matrix', sub: [['det', 'det'], ['trn', 'trn']].map(([l, n]) => ({ label: l, action: () => this.wrap(n) })) }
          ]
        }
      ];
    },
    toolbar() {
      return [
        { label: '½⇔0.5', title: 'Letztes Ergebnis exakt/dezimal', action: () => this.toggleLast() },
        { label: 'Simp', title: 'simplify', action: () => this.wrap('simplify') },
        { label: 'solve', title: 'solve (Interactive)', action: () => this.interactive('solve') },
        { label: 'fact', title: 'factor', action: () => this.wrap('factor') },
        { label: 'expd', title: 'expand', action: () => this.wrap('expand') },
        { math: [B.ch('∫'), B.ch('d'), B.ch('x')], title: '∫ (Interactive)', action: () => this.interactive('int') },
        { math: [B.t('frac', [[B.ch('d')], B.chars('dx')])], title: 'd/dx (Interactive)', action: () => this.interactive('diff') },
        { label: '≈', title: 'Dezimal ausrechnen (Shift+EXE)', action: () => this.exec(true) }
      ];
    }
  };
  App.register('main', Main);
})(window.MP = window.MP || {});

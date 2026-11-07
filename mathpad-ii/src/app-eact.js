/* MathPad II — eActivity: Dokument aus Textzeilen und Rechenzeilen */
(function (MP) {
  'use strict';
  const App = MP.App, B = MP.B, C = MP.core, h = App.h, svg = App.svg;

  const EA = {
    title: 'eActivity',
    statusKinds: ['alg', 'dec', 'complex', 'angle'],
    init(saved) {
      this.rows = [];
      this.cur = 0;
      if (saved && Array.isArray(saved.rows) && saved.rows.length) { this.rows = saved.rows; this.pendingRun = !!saved.pending; }
      else {
        this.rows = [
          { t: 'text', s: 'Kurvendiskussion f(x) = x³ − 3x' },
          { t: 'calc', in: B.toJSON(MP.textToItems('define f(x)=x^3-3x')), out: null },
          { t: 'text', s: 'Extremstellen: f′(x) = 0' },
          { t: 'calc', in: B.toJSON(MP.textToItems('solve(diff(f(x),x)=0,x)')), out: null },
          { t: 'calc', in: B.toJSON(MP.textToItems('f(-1)')), out: null }
        ];
        this.pendingRun = true;
      }
      this.ed = new MP.Editor({ onChange: () => this.renderEditor() });
      this.loadCur();
    },
    save() { this.commit(); return { rows: this.rows, pending: !!this.pendingRun }; },
    row() { return this.rows[this.cur]; },
    loadCur() { const r = this.row(); if (r && r.t === 'calc') this.ed.setItems(B.fromJSON(r.in)); },
    commit() {
      const r = this.row();
      if (!r) return;
      if (r.t === 'calc') r.in = B.toJSON(this.ed.root.items);
      else if (this.ta) r.s = this.ta.value;
    },
    editor() { const r = this.row(); return r && r.t === 'calc' ? this.ed : null; },
    mount(work) {
      this.sc = h('div', { class: 'mscroll ea' });
      work.appendChild(h('div', { class: 'win active' }, this.sc));
      if (this.pendingRun) {
        // Beispiel einmal durchrechnen, damit das Dokument mit Ergebnissen startet
        this.pendingRun = false;
        this.rows.forEach(r => { if (r.t === 'calc') this.evalRow(r, true); });
      }
      this.render();
    },
    hide() { this.commit(); },
    refresh() { this.render(); },
    evalRow(r, silent) {
      try {
        const ast = B.parse(B.row(B.fromJSON(r.in)), App.env.userFns);
        const res = MP.cas.evaluate(ast, App.env);
        r.out = B.toJSON(MP.display.toRow(res.ast, { fmt: App.settings.fmt }).items);
        r.err = null;
        if (res.exact && res.exact.type !== 'text') App.env.ans = res.exact;
      } catch (e) {
        r.out = null;
        r.err = e instanceof C.MathError ? e.message : 'Syntax ERROR';
        if (!silent) App.error(r.err);
      }
    },
    render() {
      if (!this.sc) return;
      this.sc.textContent = '';
      this.ta = null;
      this.rows.forEach((r, i) => {
        const on = i === this.cur;
        const el = h('div', { class: 'entry ea-' + r.t + (on ? ' editing' : '') });
        if (r.t === 'text') {
          if (on) {
            const ta = h('textarea', { class: 'ea-ta', rows: '1', spellcheck: 'true', 'aria-label': 'Textzeile' });
            ta.value = r.s || '';
            const fit = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
            ta.addEventListener('input', () => { r.s = ta.value; fit(); App.save(); });
            el.appendChild(ta);
            this.ta = ta;
            requestAnimationFrame(() => { fit(); ta.focus(); });
          } else el.appendChild(h('div', { class: 'ea-txt', text: r.s || ' ' }));
        } else {
          const inEl = h('div', { class: 'in m' });
          if (on) { this.edEl = inEl; inEl.addEventListener('pointerdown', ev => { ev.preventDefault(); this.ed.placeFromEvent(ev); }); }
          else inEl.appendChild(B.render(B.row(B.fromJSON(r.in)), {}));
          el.appendChild(inEl);
          const out = h('div', { class: 'out m' + (r.err ? ' err' : '') });
          if (r.err) out.textContent = r.err;
          else if (r.out) out.appendChild(B.render(B.row(B.fromJSON(r.out)), {}));
          el.appendChild(out);
        }
        el.addEventListener('pointerdown', ev => {
          if (i === this.cur) return;
          if (ev.target.tagName !== 'TEXTAREA') ev.preventDefault();
          this.commit();
          this.cur = i;
          this.loadCur();
          this.render();
        });
        this.sc.appendChild(el);
      });
      this.renderEditor();
      B.stretchParens(this.sc);
    },
    renderEditor() {
      const r = this.row();
      if (!r || r.t !== 'calc' || !this.edEl || !this.edEl.isConnected) return;
      this.ed.render(this.edEl, true);
    },
    insertRow(t) {
      this.commit();
      const r = t === 'text' ? { t: 'text', s: '' } : { t: 'calc', in: [], out: null };
      this.rows.splice(this.cur + 1, 0, r);
      this.cur++;
      this.loadCur();
      this.render();
      App.save();
    },
    delRow() {
      if (this.rows.length <= 1) { this.rows = [{ t: 'calc', in: [], out: null }]; this.cur = 0; }
      else { this.rows.splice(this.cur, 1); this.cur = Math.min(this.cur, this.rows.length - 1); }
      this.loadCur();
      this.render();
      App.save();
    },
    move(d) {
      this.commit();
      const n = this.cur + d;
      if (n < 0) return;
      if (n >= this.rows.length) { if (this.row().t === 'calc' && !this.ed.isEmpty()) this.insertRow('calc'); return; }
      this.cur = n;
      this.loadCur();
      this.render();
    },
    fieldEnter() { return false; },
    insert(act) {
      const r = this.row();
      if (r && r.t === 'text' && this.ta) {
        const txt = act.t === 'ch' ? act.v : act.t === 'fn' ? act.v + '(' : act.t === 'nm' ? act.v : '';
        this.ta.setRangeText(txt, this.ta.selectionStart, this.ta.selectionEnd, 'end');
        r.s = this.ta.value;
        return true;
      }
      return false;
    },
    key(k, ins) {
      const r = this.row();
      if (r.t === 'text') {
        if (ins && this.insert(ins)) return true;
        if (k === 'EXE' || k === 'DOWN') { this.move(1); return true; }
        if (k === 'UP') { this.move(-1); return true; }
        if (k === 'ESC') { if (this.ta) this.ta.blur(); return true; }
        if (k === 'BS' && this.ta) { const s = this.ta.selectionStart, e = this.ta.selectionEnd; this.ta.setRangeText('', s === e ? Math.max(0, s - 1) : s, e, 'end'); r.s = this.ta.value; return true; }
        return true;
      }
      if (k === 'EXE') {
        this.commit();
        if (!r.in.length) { this.move(1); return true; }
        this.evalRow(r, false);
        if (r.err) { this.render(); return true; }
        if (this.cur === this.rows.length - 1) this.rows.push({ t: 'calc', in: [], out: null });
        this.cur++;
        this.loadCur();
        this.render();
        return true;
      }
      if (k === 'UP') { if (!this.ed.up()) this.move(-1); return true; }
      if (k === 'DOWN') { if (!this.ed.down()) this.move(1); return true; }
      return false;
    },
    menus() {
      return [
        { label: 'Edit', items: [{ label: 'Textzeile einfügen', action: () => this.insertRow('text') }, { label: 'Rechenzeile einfügen', action: () => this.insertRow('calc') }, { label: 'Zeile löschen', action: () => this.delRow() }, { sep: true }, { label: 'Alle neu berechnen', action: () => { this.commit(); this.rows.forEach(r => { if (r.t === 'calc' && r.in.length) this.evalRow(r, true); }); this.render(); } }, { label: 'Neues Dokument', action: () => App.dialog({ title: 'New', body: [h('div', { class: 'msg', text: 'Dokument leeren?' })], ok: () => { this.rows = [{ t: 'text', s: '' }, { t: 'calc', in: [], out: null }]; this.cur = 0; this.render(); } }) }] },
        { label: 'Insert', items: [{ label: 'Text', action: () => this.insertRow('text') }, { label: 'Calc', action: () => this.insertRow('calc') }] }
      ];
    },
    toolbar() {
      return [
        { label: 'Text', title: 'Textzeile einfügen', action: () => this.insertRow('text') },
        { icon: svg('<path d="M2.5 11l2-1 2.5 6 4-13h6.5"/>'), title: 'Rechenzeile einfügen', action: () => this.insertRow('calc') },
        { label: '▲', title: 'Zeile hoch', action: () => this.move(-1) },
        { label: '▼', title: 'Zeile runter', action: () => this.move(1) },
        { label: 'Del', title: 'Zeile löschen', action: () => this.delRow() },
        { label: '↻', title: 'Alle neu berechnen', action: () => { this.commit(); this.rows.forEach(r => { if (r.t === 'calc' && r.in.length) this.evalRow(r, true); }); this.render(); } }
      ];
    }
  };
  App.register('eact', EA);
})(window.MP = window.MP || {});

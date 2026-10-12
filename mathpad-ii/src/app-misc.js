/* MathPad II — Numeric Solver, App-Menue, System */
(function (MP) {
  'use strict';
  const App = MP.App, B = MP.B, C = MP.core, NUM = MP.num, h = App.h;

  function focusedInput(root) {
    const a = document.activeElement;
    return a && a.tagName === 'INPUT' && a.type === 'text' && root && root.contains(a) ? a : null;
  }
  function editInput(inp, k, ins) {
    const s = inp.selectionStart, e = inp.selectionEnd;
    if (k === 'BS') { inp.setRangeText('', s === e ? Math.max(0, s - 1) : s, e, 'end'); return true; }
    if (k === 'DEL') { inp.setRangeText('', s, s === e ? Math.min(inp.value.length, e + 1) : e, 'end'); return true; }
    if (k === 'CLEAR') { inp.value = ''; return true; }
    if (k === 'LEFT' || k === 'RIGHT') { const p = Math.max(0, Math.min(inp.value.length, s + (k === 'LEFT' ? -1 : 1))); inp.setSelectionRange(p, p); return true; }
    if (ins && ins.t === 'ch') { inp.setRangeText(ins.v === 'ᴇ' ? 'E' : ins.v === '−' ? '-' : ins.v === '×' ? '*' : ins.v === '÷' ? '/' : ins.v, s, e, 'end'); return true; }
    return false;
  }

  /* ---------- Numeric Solver ---------- */
  const Solver = {
    title: 'Num Solve',
    statusKinds: ['angle'],
    init(saved) {
      this.vals = {};
      this.unknown = null;
      this.lo = '-1ᴇ99'; this.hi = '1ᴇ99';
      this.active = 'eq';
      this.result = null;
      this.ed = new MP.Editor({ onChange: () => { this.renderEq(); this.syncVars(); } });
      if (saved) {
        this.ed.setItems(B.fromJSON(saved.eq || []));
        this.vals = saved.vals || {};
        this.unknown = saved.unknown || null;
        this.picked = !!saved.picked;
        this.lo = saved.lo || this.lo; this.hi = saved.hi || this.hi;
      } else this.ed.setItems(MP.textToItems('x^3-2x-5=0'));
    },
    save() { this.readInputs(); return { eq: B.toJSON(this.ed.root.items), vals: this.vals, unknown: this.unknown, picked: this.picked, lo: this.lo, hi: this.hi }; },
    editor() { return this.active === 'eq' ? this.ed : null; },
    mount(work) {
      this.box = h('div', { class: 'solv' });
      this.eqFx = h('div', { class: 'fx m' });
      this.eqRow = h('div', { class: 'eq active' }, h('span', { text: 'Eq:' }), this.eqFx);
      this.eqFx.addEventListener('pointerdown', e => { e.preventDefault(); this.setActive('eq'); this.ed.placeFromEvent(e); });
      this.varsEl = h('div');
      this.resEl = h('div', { class: 'res' });
      this.box.append(this.eqRow, this.varsEl, this.resEl, h('div', { class: 'hint', text: 'Gleichung eingeben, Unbekannte per Kreis wählen, EXE oder „Solve“. Der Startwert ist der aktuelle Wert der Unbekannten.' }));
      const w = h('div', { class: 'win active' }, this.box);
      work.appendChild(w);
      this.renderEq();
      this.syncVars(true);
      this.renderResult();
    },
    setActive(a) {
      this.active = a;
      this.eqRow.classList.toggle('active', a === 'eq');
      this.renderEq();
    },
    renderEq() { if (this.eqFx) this.ed.render(this.eqFx, this.active === 'eq'); },
    symbols() {
      try { return [...C.symbols(this.ed.ast())].filter(s => s !== 'constnone').sort((a, b) => (a === 'x' ? -1 : b === 'x' ? 1 : a < b ? -1 : 1)); }
      catch (e) { return null; }
    },
    readInputs() {
      if (!this.varsEl) return;
      this.varsEl.querySelectorAll('input[data-v]').forEach(i => { this.vals[i.dataset.v] = i.value; });
      const lo = this.varsEl.querySelector('#ns-lo'), hi = this.varsEl.querySelector('#ns-hi');
      if (lo) this.lo = lo.value;
      if (hi) this.hi = hi.value;
    },
    syncVars(force) {
      const syms = this.symbols();
      if (!syms) return;
      const key = syms.join(',');
      if (!force && key === this.lastKey) return;
      this.readInputs();
      this.lastKey = key;
      // Ohne eigene Wahl ist x (oder die erste Variable) die Unbekannte
      if (!this.picked || !syms.includes(this.unknown)) { this.unknown = syms[0] || null; this.picked = false; }
      this.varsEl.textContent = '';
      syms.forEach(s => {
        const r = h('input', { type: 'radio', name: 'ns-unk', 'aria-label': s + ' als Unbekannte' });
        r.checked = s === this.unknown;
        r.addEventListener('change', () => { this.unknown = s; this.picked = true; App.save(); });
        const inp = h('input', { type: 'text', 'data-v': s, value: this.vals[s] !== undefined ? this.vals[s] : '0', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Wert ' + s });
        inp.addEventListener('focus', () => this.setActive('vars'));
        this.varsEl.appendChild(h('div', { class: 'vrow' }, r, h('span', { text: s + '=' }), inp));
      });
      const lim = (id, l, v) => {
        const inp = h('input', { type: 'text', id, value: v.replace('ᴇ', 'E'), spellcheck: 'false', autocomplete: 'off' });
        inp.addEventListener('focus', () => this.setActive('vars'));
        return h('div', { class: 'vrow' }, h('span'), h('span', { text: l }), inp);
      };
      this.varsEl.append(lim('ns-lo', 'Lower', this.lo), lim('ns-hi', 'Upper', this.hi));
    },
    solve() {
      this.readInputs();
      let ast;
      try { ast = this.ed.ast(); } catch (e) { App.error('Syntax ERROR'); return; }
      const u = this.unknown;
      if (!u) { App.error('No Variable'); return; }
      const values = Object.assign({}, MP.numericVars());
      for (const k in this.vals) {
        if (k === u) continue;
        const v = MP.evalNum(this.vals[k]);
        if (!isFinite(v)) { App.error('Wert für ' + k + ' fehlt'); return; }
        values[k] = v;
      }
      const lo = MP.evalNum(String(this.lo).replace('ᴇ', 'E')), hi = MP.evalNum(String(this.hi).replace('ᴇ', 'E'));
      let f;
      try { f = NUM.compile(ast, [u], { angle: App.settings.angle, values, fns: App.env.fns }); }
      catch (e) { App.error(e instanceof C.MathError ? e.message : 'Syntax ERROR'); return; }
      const x0 = MP.evalNum(this.vals[u] || '0');
      const x = NUM.solveNear(f, isFinite(x0) ? x0 : 0, isFinite(lo) ? lo : -1e99, isFinite(hi) ? hi : 1e99);
      if (!isFinite(x)) { this.result = { err: 'Keine Lösung gefunden (anderen Startwert oder Bereich versuchen)' }; this.renderResult(); return; }
      this.vals[u] = String(+x.toPrecision(12));
      const inp = this.varsEl.querySelector('input[data-v="' + u + '"]');
      if (inp) inp.value = this.vals[u];
      this.result = { u, x, lr: f(x) };
      this.renderResult();
      App.save();
    },
    renderResult() {
      if (!this.resEl) return;
      this.resEl.textContent = '';
      const r = this.result;
      if (!r) return;
      if (r.err) { this.resEl.appendChild(h('div', { style: 'color:#c62828', text: r.err })); return; }
      this.resEl.append(h('div', null, h('b', { text: r.u + ' = ' }), C.fmtFloat(r.x, { mode: 'norm2' })), h('div', null, 'Left−Right = ', C.fmtFloat(r.lr === 0 ? 0 : r.lr, { mode: 'norm2' })));
    },
    fieldEnter() { this.solve(); return true; },
    key(k, ins) {
      const inp = focusedInput(this.box);
      if (inp) {
        if (k === 'EXE') { this.solve(); return true; }
        if (k === 'UP' || k === 'DOWN') {
          const all = Array.from(this.varsEl.querySelectorAll('input[type=text]'));
          const i = all.indexOf(inp) + (k === 'DOWN' ? 1 : -1);
          if (i < 0) { inp.blur(); this.setActive('eq'); } else if (all[i]) all[i].focus();
          return true;
        }
        if (k === 'ESC') { inp.blur(); this.setActive('eq'); return true; }
        return editInput(inp, k, ins) || true;
      }
      if (k === 'EXE') { this.solve(); return true; }
      if (k === 'DOWN' && !this.ed.down()) { const f = this.varsEl.querySelector('input[type=text]'); if (f) f.focus(); return true; }
      return false;
    },
    insert(act) {
      const inp = focusedInput(this.box);
      if (!inp) return false;
      return editInput(inp, null, act.t === 'ch' ? act : { t: 'ch', v: act.t === 'fn' ? act.v + '(' : act.v === 'sqrt' ? 'sqrt(' : act.v || '' });
    },
    menus() {
      return [{ label: 'Edit', items: [{ label: 'Clear Equation', action: () => { this.ed.clear(); this.result = null; this.renderResult(); } }, { label: 'Reset Values', action: () => { this.vals = {}; this.syncVars(true); } }] }];
    },
    toolbar() {
      return [{ label: 'Solve', title: 'Lösen (EXE)', action: () => this.solve() }, { label: 'Eq', title: 'Gleichung bearbeiten', action: () => { const a = document.activeElement; if (a && a.blur) a.blur(); this.setActive('eq'); } }];
    }
  };
  App.register('solver', Solver);

  /* ---------- App-Menue ---------- */
  const ICON = {
    main: '<svg viewBox="0 0 38 34"><path d="M4 19l3-1.5 4 9 6-21h8" fill="none" stroke="#1a4fd8" stroke-width="2.2" stroke-linejoin="round"/><text x="23" y="28" font-size="14" font-family="Arial" fill="#e0201b">α</text></svg>',
    graph: '<svg viewBox="0 0 38 34"><path d="M3 30h32M6 3v30" stroke="#333" stroke-width="1.4"/><path d="M6 24c6-20 10-20 14-9s8 11 15-6" fill="none" stroke="#1a4fd8" stroke-width="2.2"/><path d="M6 10c7 2 13 18 29 16" fill="none" stroke="#e0201b" stroke-width="2"/></svg>',
    stat: '<svg viewBox="0 0 38 34"><path d="M4 30h31" stroke="#333" stroke-width="1.4"/><rect x="7" y="18" width="5" height="12" fill="#1a4fd8"/><rect x="14" y="9" width="5" height="21" fill="#15a01a"/><rect x="21" y="13" width="5" height="17" fill="#e07b00"/><rect x="28" y="5" width="5" height="25" fill="#e0201b"/></svg>',
    solver: '<svg viewBox="0 0 38 34"><text x="3" y="15" font-size="11" font-family="Arial" fill="#111">f(x)=0</text><path d="M4 25h30" stroke="#333" stroke-width="1.2"/><circle cx="21" cy="25" r="3.2" fill="#e0201b"/><path d="M6 31c6-14 18-14 26-12" fill="none" stroke="#1a4fd8" stroke-width="2"/></svg>',
    system: '<svg viewBox="0 0 38 34"><rect x="8" y="3" width="22" height="28" rx="3" fill="#2a2e34"/><rect x="11" y="6" width="16" height="10" fill="#cfe0f6"/><g fill="#fff"><rect x="11" y="19" width="4" height="3"/><rect x="17" y="19" width="4" height="3"/><rect x="23" y="19" width="4" height="3"/><rect x="11" y="24" width="4" height="3"/><rect x="17" y="24" width="4" height="3"/><rect x="23" y="24" width="4" height="3" fill="#1f6fd8"/></g></svg>'
  };
  const APPS = [['main', 'Main'], ['graph', 'Graph&Table'], ['stat', 'Statistics'], ['solver', 'Num Solve'], ['system', 'System']];
  const Menu = {
    title: 'Menu',
    statusKinds: [],
    hl: 0,
    mount(work) {
      this.grid = h('div', { class: 'amenu', role: 'menu' });
      APPS.forEach(([k, l], i) => {
        const b = h('button', { type: 'button', role: 'menuitem', class: i === this.hl ? 'hl' : null }, h('span', { class: 'ico', html: ICON[k] }), h('span', { text: l }));
        b.addEventListener('click', () => App.open(k));
        this.grid.appendChild(b);
      });
      work.appendChild(h('div', { class: 'win active' }, this.grid));
    },
    paint() { Array.from(this.grid.children).forEach((b, i) => b.classList.toggle('hl', i === this.hl)); },
    key(k) {
      const n = APPS.length;
      if (k === 'LEFT') this.hl = (this.hl + n - 1) % n;
      else if (k === 'RIGHT') this.hl = (this.hl + 1) % n;
      else if (k === 'UP') this.hl = Math.max(0, this.hl - 3);
      else if (k === 'DOWN') this.hl = Math.min(n - 1, this.hl + 3);
      else if (k === 'EXE') { App.open(APPS[this.hl][0]); return true; }
      else if (/^[1-9]$/.test(k) && +k <= n) { App.open(APPS[+k - 1][0]); return true; }
      else return true;
      this.paint();
      return true;
    },
    menus() { return []; },
    toolbar() { return []; }
  };
  App.register('menu', Menu);

  /* ---------- System ---------- */
  const System = {
    title: 'System',
    statusKinds: [],
    mount(work) {
      const vars = Object.keys(App.env.vars), fns = Object.keys(App.env.fns);
      const box = h('div', { class: 'sysinfo' },
        h('h3', { text: 'MathPad II' }),
        h('div', { text: 'CAS-Grafikrechner im Browser. Läuft komplett offline, rechnet lokal, speichert in diesem Browser.' }),
        h('h3', { text: 'Speicher' }),
        h('table', null,
          h('tr', null, h('td', { text: 'Variablen' }), h('td', { text: vars.length ? vars.join(', ') : '–' })),
          h('tr', null, h('td', { text: 'Funktionen' }), h('td', { text: fns.length ? fns.map(f => f + '(' + App.env.fns[f].params.join(',') + ')').join(', ') : '–' })),
          h('tr', null, h('td', { text: 'Main-Zeilen' }), h('td', { text: String(App.apps.main.entries.length) }))),
        h('div', null,
          h('button', { type: 'button', text: 'Variablen löschen', onclick: () => { App.env.vars = {}; App.env.fns = {}; App.env.userFns.clear(); App.env.ans = null; App.save(); App.open('system'); } }),
          h('button', { type: 'button', text: 'Alles zurücksetzen', onclick: () => App.dialog({ title: 'Reset', body: [h('div', { class: 'msg', text: 'Alle Daten, Einstellungen und Verläufe löschen?' })], ok: () => App.resetAll() }) })),
        h('h3', { text: 'Rechenkern' }),
        h('div', { text: 'Symbolik: nerdamer (MIT-Lizenz), eingebettet. Numerik, Grafik und Statistik: eigener Code.' })
      );
      work.appendChild(h('div', { class: 'win active' }, box));
    },
    menus() { return []; },
    toolbar() { return [{ label: 'Menu', action: () => App.open('menu') }, { label: 'Main', action: () => App.open('main') }]; }
  };
  App.register('system', System);
})(window.MP = window.MP || {});

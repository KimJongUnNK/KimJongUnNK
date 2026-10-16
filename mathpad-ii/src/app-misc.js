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
      if (r.err) { this.resEl.appendChild(h('div', { class: 'err', text: r.err })); return; }
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
  // Glyphen in Weiss; Verlauf und Form kommen aus dem CSS (.ico.<app>)
  const I = inner => '<svg viewBox="0 0 30 30" aria-hidden="true">' + inner + '</svg>';
  const ICON = {
    main: I('<path d="M3 16l3-1.5 4.5 9L17 5h10"/><text class="t" x="18" y="25" font-size="11.5">α</text>'),
    eact: I('<rect x="7" y="3.5" width="16" height="23" rx="2.5"/><path class="o" d="M11 9h8M11 13h8"/><path d="M10.5 22c2-5 3.6-5 5-2s3 2.5 4.5-2.5"/>'),
    stat: I('<rect class="f" x="4.5" y="15" width="4.2" height="11" rx="1.2"/><rect class="f" x="10.5" y="8" width="4.2" height="18" rx="1.2"/><rect class="f" x="16.5" y="12" width="4.2" height="14" rx="1.2"/><rect class="f" x="22.5" y="4" width="4.2" height="22" rx="1.2" opacity=".72"/>'),
    sheet: I('<rect x="4" y="5" width="22" height="20" rx="2.8"/><path d="M4 11h22M4 18h22M11 5v20M18.5 5v20" stroke-width="1.5"/>'),
    graph: I('<path class="o" d="M4 25h23M6 3v23" stroke-width="1.6"/><path d="M6 21c4-14 7-14 10-6s6 8 11-5"/>'),
    geom: I('<path d="M4 25L15 5l11 20z"/><circle cx="15" cy="18.5" r="4.6" stroke-width="1.7"/>'),
    conics: I('<ellipse cx="15" cy="16" rx="11" ry="6.5"/><path class="o" d="M7 3c2.5 14 13.5 14 16 0"/>'),
    g3d: I('<path d="M15 3.5l10 5.5v12L15 26.5 5 21V9z"/><path d="M5 9l10 5.5L25 9M15 14.5v12" stroke-width="1.6"/>'),
    seq: I('<circle class="f" cx="5.5" cy="24" r="2.3"/><circle class="f" cx="10.5" cy="22" r="2.3"/><circle class="f" cx="15.5" cy="18.5" r="2.3"/><circle class="f" cx="20.5" cy="12.5" r="2.3"/><circle class="f" cx="25.5" cy="4.5" r="2.3"/>'),
    fin: I('<text class="t" x="15" y="23" font-size="20" text-anchor="middle">%</text>'),
    prog: I('<path d="M6 9l6 6-6 6"/><path d="M15.5 22H24"/>'),
    econ: I('<path d="M3 16h5l3-8 4 15 3-11 2 4h7"/>'),
    solver: I('<path class="o" d="M3 17h24" stroke-width="1.6"/><path d="M4 26C9 4 18 4 26 9"/><circle class="f" cx="6.7" cy="17" r="2.6"/>'),
    deq: I('<path class="o" d="M5 7l3-1.5M13 7l3-1M21 7h3M5 15l3-2M13 15l3-1.5M21 15l3-1M5 23l3-3M13 23l3-2M21 23l3-1.5" stroke-width="1.6"/><path d="M3 26C10 21 15 13 27 8"/>'),
    system: I('<circle cx="15" cy="15" r="4"/><path d="M15 3.5v4M15 22.5v4M3.5 15h4M22.5 15h4M6.9 6.9l2.8 2.8M20.3 20.3l2.8 2.8M6.9 23.1l2.8-2.8M20.3 9.7l2.8-2.8"/>')
  };
  // Reihenfolge wie im Menue des ClassPad II
  const APPS = [['main', 'Main'], ['eact', 'eActivity'], ['stat', 'Statistics'], ['sheet', 'Spreadsheet'], ['graph', 'Graph&Table'], ['geom', 'Geometry'],
    ['conics', 'Conics'], ['g3d', '3D Graph'], ['seq', 'Sequence'], ['fin', 'Financial'], ['prog', 'Program'], ['econ', 'E-CON EA-200'],
    ['solver', 'NumSolve'], ['deq', 'DiffEqGraph'], ['system', 'System']];
  const Menu = {
    title: 'Menu',
    statusKinds: [],
    hl: 0,
    mount(work) {
      this.grid = h('div', { class: 'amenu', role: 'menu' });
      APPS.filter(([k]) => App.apps[k]).forEach(([k, l], i) => {
        const b = h('button', { type: 'button', role: 'menuitem', class: i === this.hl ? 'hl' : null }, h('span', { class: 'ico ' + k, html: ICON[k] }), h('span', { text: l }));
        b.addEventListener('click', () => App.open(k));
        this.grid.appendChild(b);
      });
      work.appendChild(h('div', { class: 'win active' }, this.grid));
    },
    paint() { Array.from(this.grid.children).forEach((b, i) => b.classList.toggle('hl', i === this.hl)); },
    list() { return APPS.filter(([k]) => App.apps[k]); },
    key(k) {
      const n = this.list().length;
      if (k === 'LEFT') this.hl = (this.hl + n - 1) % n;
      else if (k === 'RIGHT') this.hl = (this.hl + 1) % n;
      else if (k === 'UP') this.hl = Math.max(0, this.hl - 4);
      else if (k === 'DOWN') this.hl = Math.min(n - 1, this.hl + 4);
      else if (k === 'EXE') { App.open(this.list()[this.hl][0]); return true; }
      else if (/^[1-9]$/.test(k) && +k <= n) { App.open(this.list()[+k - 1][0]); return true; }
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

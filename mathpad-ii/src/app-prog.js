/* MathPad II — Program: Editor und Interpreter fuer ClassPad-Basic */
(function (MP) {
  'use strict';
  const App = MP.App, B = MP.B, C = MP.core, h = App.h;

  const SAMPLES = {
    quadrat: [
      "' Quadratische Gleichung a·x²+b·x+c=0",
      'Local a,b,c,d',
      'Input a,"a="',
      'Input b,"b="',
      'Input c,"c="',
      'b^2-4a*c⇒d',
      'Print "Diskriminante"',
      'Print d',
      'If d<0',
      'Then',
      '  Print "keine reelle Lösung"',
      'Else',
      '  Print solve(a*x^2+b*x+c=0,x)',
      'IfEnd'
    ].join('\n'),
    fibo: [
      "' Die ersten 12 Fibonacci-Zahlen",
      'Local a,b,c,k',
      '1⇒a:1⇒b',
      'For 1⇒k To 12',
      '  Print a',
      '  a+b⇒c',
      '  b⇒a',
      '  c⇒b',
      'Next'
    ].join('\n')
  };
  const CMDS = ['If ', 'Then', 'Else', 'IfEnd', 'For 1⇒k To 10', 'Step ', 'Next', 'While ', 'WhileEnd', 'Do', 'LpWhile ', 'Print ', 'Input x,"x="', 'Locate 1,1,', 'Message "', 'ClrText', 'Local ', 'Break', 'Skip', 'Return', '⇒'];

  class Stop extends Error {}

  // Anweisungen trennen: Zeilen und ":" ausserhalb von Anfuehrungszeichen
  function splitStatements(code) {
    const out = [];
    code.split(/\r?\n/).forEach((line, ln) => {
      let cur = '', q = false;
      for (const ch of line) {
        if (ch === '"') q = !q;
        if (ch === ':' && !q) { out.push({ s: cur.trim(), ln }); cur = ''; continue; }
        cur += ch;
      }
      out.push({ s: cur.trim(), ln });
    });
    return out.filter(x => x.s && !x.s.startsWith("'") && !x.s.startsWith('//'));
  }
  function splitArgs(s) {
    const out = [];
    let cur = '', q = false, d = 0;
    for (const ch of s) {
      if (ch === '"') q = !q;
      if (!q && (ch === '(' || ch === '{' || ch === '[')) d++;
      if (!q && (ch === ')' || ch === '}' || ch === ']')) d--;
      if (ch === ',' && !q && d === 0) { out.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  const Prog = {
    title: 'Program',
    statusKinds: ['dec', 'angle'],
    init(saved) {
      this.progs = Object.assign({}, SAMPLES);
      this.name = 'quadrat';
      this.mode = 'edit';
      this.out = [];
      if (saved) {
        if (saved.progs && Object.keys(saved.progs).length) this.progs = saved.progs;
        if (saved.name && this.progs[saved.name] !== undefined) this.name = saved.name;
      }
    },
    save() { this.read(); return { progs: this.progs, name: this.name }; },
    editor() { return null; },
    read() { if (this.ta && this.mode === 'edit') this.progs[this.name] = this.ta.value; },
    mount(work) {
      this.win = h('div', { class: 'win active' });
      work.appendChild(this.win);
      this.render();
    },
    hide() { this.read(); this.running = false; },
    refresh() { this.render(); },
    render() {
      if (!this.win) return;
      this.win.textContent = '';
      if (this.mode === 'edit') {
        const sel = h('select', { 'aria-label': 'Programm', class: 'pg-sel' }, Object.keys(this.progs).sort().map(n => h('option', { value: n, text: n, selected: n === this.name ? true : null })));
        sel.addEventListener('change', () => { this.read(); this.name = sel.value; this.render(); App.save(); });
        this.ta = h('textarea', { class: 'pg-ta', spellcheck: 'false', autocapitalize: 'off', 'aria-label': 'Programmtext' });
        this.ta.value = this.progs[this.name] || '';
        this.ta.addEventListener('input', () => { this.progs[this.name] = this.ta.value; App.save(); });
        this.win.append(h('div', { class: 'pg-head' }, h('span', { text: 'Program Editor' }), sel), this.ta);
      } else {
        this.ta = null;
        this.outEl = h('div', { class: 'mscroll pg-out' });
        this.win.append(h('div', { class: 'pg-head' }, h('span', { text: 'Program Output · ' + this.name + (this.running ? ' (läuft …)' : '') })), this.outEl);
        this.renderOut();
      }
    },
    renderOut() {
      if (!this.outEl) return;
      this.outEl.textContent = '';
      this.out.forEach(o => {
        const el = h('div', { class: 'pg-line' + (o.err ? ' err' : '') });
        if (o.row) { const m = h('span', { class: 'm' }); m.appendChild(B.render(B.row(B.fromJSON(o.row)), {})); el.appendChild(m); }
        else el.textContent = o.text;
        this.outEl.appendChild(el);
      });
      B.stretchParens(this.outEl);
      this.outEl.scrollTop = this.outEl.scrollHeight;
    },
    print(o) { this.out.push(o); if (this.out.length > 500) this.out.shift(); this.renderOut(); },

    /* ---------- Interpreter ---------- */
    parse(s) { return C.parseString(s.replace(/=>/g, '⇒'), { split: true, userFns: App.env.userFns }); },
    evalAst(s) { return MP.cas.evaluate(this.parse(s), App.env); },
    num(s) {
      const r = this.evalAst(s);
      const v = MP.num.compile(r.exact, [], { angle: 'rad', values: {} })();
      if (!isFinite(v)) throw new C.MathError('Wrong Argument Type');
      return v;
    },
    cond(s) {
      const or = s.split(/\s+or\s+/i);
      if (or.length > 1) return or.some(x => this.cond(x));
      const and = s.split(/\s+and\s+/i);
      if (and.length > 1) return and.every(x => this.cond(x));
      const m = /^not\s+(.*)$/i.exec(s.trim());
      if (m) return !this.cond(m[1]);
      const ast = this.parse(s);
      if (ast.type === 'rel') {
        const v = n => MP.num.compile(MP.cas.evaluate(n, App.env).exact, [], { angle: 'rad', values: {} })();
        const a = v(ast.a), b = v(ast.b), eps = 1e-12 * Math.max(1, Math.abs(a), Math.abs(b));
        switch (ast.op) {
          case '=': return Math.abs(a - b) <= eps;
          case '≠': return Math.abs(a - b) > eps;
          case '<': return a < b - eps;
          case '>': return a > b + eps;
          case '≤': return a <= b + eps;
          case '≥': return a >= b - eps;
        }
      }
      return this.num(s) !== 0;
    },
    out1(arg) {
      const a = arg.trim();
      if (/^".*"$/.test(a)) return { text: a.slice(1, -1) };
      const r = this.evalAst(a);
      return { row: B.toJSON(MP.display.toRow(r.ast, { fmt: App.settings.fmt }).items) };
    },
    ask(prompt, varName) {
      return new Promise(resolve => {
        App.dialog({
          title: 'Input', body: [h('div', { class: 'row' }, h('label', { for: 'pg-in', text: prompt || varName + '?' }), h('input', { type: 'text', id: 'pg-in', value: '' }))],
          ok: d => { resolve(d.querySelector('#pg-in').value); },
          onClose: () => resolve(null)
        });
      });
    },
    async run() {
      this.read();
      const code = this.progs[this.name] || '';
      const st = splitStatements(code);
      const kw = s => { const m = /^([A-Za-z]+)\b\s*(.*)$/.exec(s); return m ? [m[1].toLowerCase(), m[2]] : ['', s]; };
      // Bloecke zuordnen
      const match = {};
      const stack = [];
      st.forEach((x, i) => {
        const [k] = kw(x.s);
        x.k = k;
        if (['if', 'for', 'while', 'do'].includes(k)) stack.push({ k, i, els: -1 });
        else if (k === 'else') { const t = stack[stack.length - 1]; if (!t || t.k !== 'if') throw new C.MathError('Else ohne If (Zeile ' + (x.ln + 1) + ')'); t.els = i; }
        else if (['ifend', 'next', 'whileend', 'lpwhile'].includes(k)) {
          const want = { ifend: 'if', next: 'for', whileend: 'while', lpwhile: 'do' }[k];
          const t = stack.pop();
          if (!t || t.k !== want) throw new C.MathError(x.s.split(' ')[0] + ' ohne passenden Anfang (Zeile ' + (x.ln + 1) + ')');
          match[t.i] = { end: i, els: t.els };
          match[i] = { start: t.i };
          if (t.els >= 0) match[t.els] = { end: i };
        }
      });
      if (stack.length) throw new C.MathError('Block nicht geschlossen: ' + stack[stack.length - 1].k);
      this.mode = 'run'; this.out = []; this.running = true; this.stopFlag = false;
      this.render();
      App.refreshChrome();
      const locals = {};
      const loops = [];
      let pc = 0, steps = 0;
      const loopEnd = () => { for (let j = loops.length - 1; j >= 0; j--) return loops[j]; return null; };
      try {
        while (pc < st.length) {
          if (this.stopFlag) throw new Stop('Break');
          if (++steps % 500 === 0) await new Promise(r => setTimeout(r, 0));
          if (steps > 200000) throw new C.MathError('Zu viele Schritte (Endlosschleife?)');
          const x = st[pc];
          const [k, rest] = kw(x.s);
          switch (k) {
            case 'print': splitArgs(rest).forEach(a => this.print(this.out1(a))); pc++; break;
            case 'locate': { const a = splitArgs(rest); if (a.length >= 3) this.print(this.out1(a.slice(2).join(','))); pc++; break; }
            case 'message': await new Promise(res => App.dialog({ title: 'Message', body: [h('div', { class: 'msg', text: rest.replace(/^"|"$/g, '') })], cancel: false, onClose: res })); pc++; break;
            case 'clrtext': this.out = []; this.renderOut(); pc++; break;
            case 'input': {
              const a = splitArgs(rest);
              const v = a[0], prompt = a[1] ? a[1].replace(/^"|"$/g, '') : v + '?';
              const ans = await this.ask(prompt, v);
              if (ans === null) throw new Stop('Break');
              this.evalAst('(' + ans + ')⇒' + v);
              pc++;
              break;
            }
            case 'local': splitArgs(rest).forEach(v => { if (!(v in locals)) locals[v] = App.env.vars[v]; delete App.env.vars[v]; }); pc++; break;
            case 'if': {
              const ok = this.cond(rest);
              const m = match[pc];
              // "Then" folgt direkt
              if (ok) pc = st[pc + 1] && st[pc + 1].k === 'then' ? pc + 2 : pc + 1;
              else pc = m.els >= 0 ? m.els + 1 : m.end + 1;
              break;
            }
            case 'then': pc++; break;
            case 'else': pc = match[pc].end + 1; break;
            case 'ifend': pc++; break;
            case 'for': {
              const m = /^(.+?)\s*(⇒|=>|->)\s*([A-Za-zθ]\w*)\s+to\s+(.+?)(?:\s+step\s+(.+))?$/i.exec(rest);
              if (!m) throw new C.MathError('For-Syntax: For 1⇒k To 10 [Step 1]');
              const start = this.num(m[1]), end = this.num(m[4]), step = m[5] ? this.num(m[5]) : 1;
              this.evalAst('(' + start + ')⇒' + m[3]);
              const lp = { k: 'for', start: pc, end: match[pc].end, v: m[3], to: end, step };
              if (step > 0 ? start > end : start < end) { pc = lp.end + 1; break; }
              loops.push(lp);
              pc++;
              break;
            }
            case 'next': {
              const lp = loops[loops.length - 1];
              const v = this.num(lp.v) + lp.step;
              this.evalAst('(' + v + ')⇒' + lp.v);
              if (lp.step > 0 ? v <= lp.to + 1e-12 : v >= lp.to - 1e-12) pc = lp.start + 1;
              else { loops.pop(); pc++; }
              break;
            }
            case 'while': {
              if (this.cond(rest)) { loops.push({ k: 'while', start: pc, end: match[pc].end }); pc++; }
              else pc = match[pc].end + 1;
              break;
            }
            case 'whileend': loops.pop(); pc = match[pc].start; break;
            case 'do': loops.push({ k: 'do', start: pc, end: match[pc].end }); pc++; break;
            case 'lpwhile': if (this.cond(rest)) pc = match[pc].start + 1; else { loops.pop(); pc++; } break;
            case 'break': { const lp = loopEnd(); if (!lp) throw new C.MathError('Break außerhalb einer Schleife'); loops.pop(); pc = lp.end + 1; break; }
            case 'skip': { const lp = loopEnd(); if (!lp) throw new C.MathError('Skip außerhalb einer Schleife'); pc = lp.end; break; }
            case 'return': case 'stop': pc = st.length; break;
            default:
              this.evalAst(x.s);
              pc++;
          }
        }
        this.print({ text: 'done' });
      } catch (e) {
        if (e instanceof Stop) this.print({ text: 'Break', err: true });
        else this.print({ text: (e instanceof C.MathError ? e.message : 'Syntax ERROR') + '  (Zeile ' + ((st[pc] ? st[pc].ln : 0) + 1) + ')', err: true });
      } finally {
        Object.keys(locals).forEach(v => { if (locals[v] === undefined) delete App.env.vars[v]; else App.env.vars[v] = locals[v]; });
        this.running = false;
        if (this.mode === 'run') this.render();
        App.refreshChrome();
        App.save();
      }
    },
    start() {
      this.run().catch(e => { this.mode = 'run'; this.render(); this.print({ text: e.message || 'Syntax ERROR', err: true }); this.running = false; App.refreshChrome(); });
    },
    newProg() {
      App.dialog({
        title: 'New File', body: [h('div', { class: 'row' }, h('label', { for: 'pg-nm', text: 'Name' }), h('input', { type: 'text', id: 'pg-nm', value: 'prog' + (Object.keys(this.progs).length + 1) }))],
        ok: d => {
          const n = d.querySelector('#pg-nm').value.trim().replace(/[^\w-]/g, '').slice(0, 16);
          if (!n) { App.error('Name fehlt'); return false; }
          this.read();
          if (this.progs[n] === undefined) this.progs[n] = '';
          this.name = n; this.mode = 'edit';
          this.render();
        }
      });
    },
    insertText(t) {
      if (this.mode !== 'edit' || !this.ta) return;
      this.ta.focus();
      this.ta.setRangeText(t, this.ta.selectionStart, this.ta.selectionEnd, 'end');
      this.progs[this.name] = this.ta.value;
    },
    fieldEnter() { return false; },
    insert(act) {
      if (this.mode !== 'edit' || !this.ta) return true;
      const t = act.t === 'ch' ? (act.v === '×' ? '*' : act.v === '÷' ? '/' : act.v === '−' ? '-' : act.v) : act.t === 'fn' ? act.v + '(' : act.t === 'nm' ? act.v : act.t === 'tpl' ? ({ sqrt: 'sqrt(', frac: '/', sup: '^' }[act.v] || '') : '';
      this.insertText(t);
      return true;
    },
    key(k, ins) {
      if (this.mode === 'run') {
        if (k === 'ESC' || k === 'CLEAR') { if (this.running) this.stopFlag = true; else { this.mode = 'edit'; this.render(); App.refreshChrome(); } return true; }
        if (k === 'EXE' && !this.running) { this.mode = 'edit'; this.render(); App.refreshChrome(); return true; }
        return true;
      }
      if (ins) return this.insert(ins);
      if (k === 'EXE') { this.insertText('\n'); return true; }
      if (k === 'BS' && this.ta) { const s = this.ta.selectionStart, e = this.ta.selectionEnd; this.ta.setRangeText('', s === e ? Math.max(0, s - 1) : s, e, 'end'); this.progs[this.name] = this.ta.value; return true; }
      return true;
    },
    menus() {
      return [
        { label: 'Edit', items: [{ label: 'New File…', action: () => this.newProg() }, { label: 'Delete File', action: () => App.dialog({ title: 'Delete', body: [h('div', { class: 'msg', text: '„' + this.name + '“ löschen?' })], ok: () => { delete this.progs[this.name]; if (!Object.keys(this.progs).length) this.progs = Object.assign({}, SAMPLES); this.name = Object.keys(this.progs)[0]; this.mode = 'edit'; this.render(); } }) }, { label: 'Beispiele wiederherstellen', action: () => { Object.assign(this.progs, SAMPLES); this.render(); } }] },
        { label: 'Cmd', items: CMDS.map(c => ({ label: c.trim() || c, action: () => this.insertText(c) })) },
        { label: 'Run', items: [{ label: 'Run ▶', action: () => this.start() }, { label: 'Editor', action: () => { this.mode = 'edit'; this.render(); App.refreshChrome(); } }] }
      ];
    },
    toolbar() {
      if (this.mode === 'run') {
        return [
          { label: this.running ? '■ Stop' : '✎ Edit', title: this.running ? 'Programm anhalten' : 'Zurück zum Editor', action: () => { if (this.running) this.stopFlag = true; else { this.mode = 'edit'; this.render(); App.refreshChrome(); } } },
          { label: '▶ Run', title: 'Noch einmal ausführen', action: () => { if (!this.running) this.start(); } }
        ];
      }
      return [
        { label: '▶ Run', title: 'Programm ausführen', action: () => this.start() },
        { label: 'Cmd ▾', title: 'Befehl einfügen', menu: () => CMDS.map(c => ({ label: c.trim() || c, action: () => this.insertText(c) })) },
        { label: '⇒', title: 'Zuweisung', action: () => this.insertText('⇒') },
        { label: 'New', title: 'Neues Programm', action: () => this.newProg() }
      ];
    }
  };
  App.register('prog', Prog);
})(window.MP = window.MP || {});

/* MathPad II — Natural-Input-Editor mit Cursor in 2D-Vorlagen */
(function (MP) {
  'use strict';
  const B = MP.B, C = MP.core;

  // Senkrechte Bewegung innerhalb von Vorlagen: Kindindex -> Kindindex
  const UP = {
    frac: k => (k === 1 ? 0 : -1),
    dint: k => (k === 0 ? 1 : -1),
    sum: k => (k === 0 || k === 1 ? 2 : -1),
    prod: k => (k === 0 || k === 1 ? 2 : -1),
    root: k => (k === 1 ? 0 : -1),
    mat: (k, t) => (k >= t.cols ? k - t.cols : -1)
  };
  const DOWN = {
    frac: k => (k === 0 ? 1 : -1),
    dint: k => (k === 1 ? 0 : -1),
    sum: k => (k === 2 ? 1 : -1),
    prod: k => (k === 2 ? 1 : -1),
    root: k => (k === 0 ? 1 : -1),
    mat: (k, t) => (k + t.cols < t.c.length ? k + t.cols : -1)
  };
  // Vorbelegte Variablenfelder
  const PREFILL = { int: [1, 'x'], dint: [3, 'x'], diff: [0, 'x'], diff2: [0, 'x'], lim: [0, 'x'], sum: [0, 'k'], prod: [0, 'k'] };
  const OPERAND_STOP = new Set(['+', '-', '−', '×', '*', '÷', '/', '=', '≠', '<', '>', '≤', '≥', ',', '⇒', '(', '·']);

  const SMART_EXIT = new Set(['+', '-', '−', '×', '÷', '=', '<', '>', '≤', '≥', '≠', ',', '⇒', ')', '/']);

  class Editor {
    constructor(opts) {
      opts = opts || {};
      this.root = B.row([]);
      this.cur = { row: this.root, idx: 0 };
      this.onChange = opts.onChange || (() => {});
      this.el = null;
      this.history = [];
    }
    setItems(items) {
      this.root = B.row(B.clone(items || []));
      this.cur = { row: this.root, idx: this.root.items.length };
    }
    getItems() { return B.clone(this.root.items); }
    clear() { this.root = B.row([]); this.cur = { row: this.root, idx: 0 }; this.changed(); }
    isEmpty() { return this.root.items.length === 0; }
    changed() { this.onChange(this); }

    /* ---------- Einfuegen ---------- */
    _insert(it) {
      const { row, idx } = this.cur;
      it.row = row;
      row.items.splice(idx, 0, it);
      this.cur = { row, idx: idx + 1 };
    }
    insertItems(items) {
      B.clone(items).forEach(it => this._insert(it));
      this.changed();
    }
    ch(c, smart) {
      // Tippen am Mac: Operator nach Exponent/Nenner verlaesst die Vorlage (x^2-3, 1/2+1/3)
      if (smart && SMART_EXIT.has(c)) this._smartExit();
      if (c === '/') return this.tpl('frac');
      if (c === '^') return this.tpl('sup');
      // ")" am Ende einer Wurzel/Betrag-Vorlage schliesst die Vorlage (sqrt(2) getippt)
      if (c === ')') {
        const { row, idx } = this.cur, t = row.up;
        if (t && (t.k === 'sqrt' || t.k === 'abs') && idx === row.items.length) {
          let d = 0;
          row.items.forEach(x => { if ((x.k === 'ch' && x.v === '(') || x.k === 'fn') d++; else if (x.k === 'ch' && x.v === ')') d--; });
          if (d <= 0) { this.cur = { row: t.row, idx: t.row.items.indexOf(t) + 1 }; this.changed(); return; }
        }
      }
      if (c === ' ') { this._mergeWord(true); this.changed(); return; }
      this._insert(B.ch(c));
      if (c === '(') this._mergeFn();
      else if (/[a-zA-Z]/.test(c)) this._mergeWord(false);
      this.changed();
    }
    _smartExit() {
      for (let guard = 0; guard < 8; guard++) {
        const { row, idx } = this.cur, t = row.up;
        if (!t || idx !== row.items.length || !row.items.length) return;
        const k = t.c.indexOf(row);
        const isExp = t.k === 'sup', isDen = t.k === 'frac' && k === 1;
        if (!isExp && !isDen) return;
        let d = 0;
        row.items.forEach(x => { if ((x.k === 'ch' && x.v === '(') || x.k === 'fn') d++; else if (x.k === 'ch' && x.v === ')') d--; });
        if (d > 0) return;
        this.cur = { row: t.row, idx: t.row.items.indexOf(t) + 1 };
      }
    }
    fn(name) { this._insert(B.fn(name)); this.changed(); }
    nm(v) { this._insert(B.nm(v)); this.changed(); }
    text(s) { Array.from(s).forEach(c => this.ch(c)); }
    // Buchstabenfolge direkt vor dem Cursor
    _letters(endIdx) {
      const items = this.cur.row.items;
      let i = endIdx;
      while (i > 0 && items[i - 1].k === 'ch' && /[a-zA-Z]/.test(items[i - 1].v)) i--;
      return { start: i, word: items.slice(i, endIdx).map(x => x.v).join('') };
    }
    _mergeFn() {
      const { row, idx } = this.cur;
      const { start, word } = this._letters(idx - 1);
      if (!word) return;
      const userFns = MP.userFns || new Set();
      let name = null;
      for (const f of ['sqrt'].concat(C.AUTO_FN, [...userFns])) {
        if (word.endsWith(f) && f.length <= word.length) { name = f; break; }
      }
      if (!name) return;
      const from = idx - 1 - name.length;
      row.items.splice(from, name.length + 1);
      this.cur = { row, idx: from };
      if (name === 'sqrt') { this.tpl('sqrt', { silent: true }); return; }
      if (userFns.has(name)) {
        Array.from(name).forEach(c => this._insert(B.ch(c)));
        this._insert(B.ch('('));
        return;
      }
      this._insert(B.fn(name));
    }
    _mergeWord(space) {
      const { row, idx } = this.cur;
      const { word } = this._letters(idx);
      const rep = (n, item) => {
        row.items.splice(idx - n, n);
        this.cur = { row, idx: idx - n };
        this._insert(item);
      };
      if (word.endsWith('pi')) return rep(2, B.ch('π'));
      if (word.endsWith('ans')) return rep(3, B.nm('ans'));
      if (word.endsWith('theta')) return rep(5, B.ch('θ'));
      if (word.endsWith('inf') && space) return rep(3, B.ch('∞'));
      if (space && /define$/i.test(word)) return rep(6, B.nm('Define'));
    }
    // Operand vor dem Cursor fuer den Zaehler eines Bruchs
    _grabOperand() {
      const { row, idx } = this.cur;
      const items = row.items;
      let i = idx;
      if (i > 0 && items[i - 1].k === 'ch' && items[i - 1].v === ')') {
        let depth = 0;
        for (let j = i - 1; j >= 0; j--) {
          const it = items[j];
          if (it.k === 'ch' && it.v === ')') depth++;
          else if ((it.k === 'ch' && it.v === '(') || it.k === 'fn') depth--;
          if (depth === 0) { i = j; break; }
        }
        // Buchstaben direkt vor der Klammer (benutzerdefinierte Funktion) mitnehmen
        while (i > 0 && items[i - 1].k === 'ch' && /[a-zA-Z]/.test(items[i - 1].v)) i--;
      } else {
        while (i > 0) {
          const it = items[i - 1];
          if (it.k === 'ch' && (OPERAND_STOP.has(it.v))) break;
          if (it.k === 'fn') break;
          i--;
        }
      }
      return items.splice(i, idx - i).map(x => x);
    }
    tpl(kind, opts) {
      opts = opts || {};
      let it;
      if (kind === 'mat') it = B.t('mat', null, { r: opts.r || 2, cols: opts.cols || 2 });
      else it = B.t(kind);
      if (kind === 'frac' && opts.grab !== false) {
        const num = this._grabOperand();
        this.cur.idx -= num.length;
        num.forEach(x => { x.row = it.c[0]; it.c[0].items.push(x); });
      }
      if (PREFILL[kind]) {
        const [k, v] = PREFILL[kind];
        const r = it.c[k];
        const x = B.ch(v);
        x.row = r;
        r.items.push(x);
      }
      if (opts.content) {
        opts.content.forEach(x => { const y = B.clone([x])[0]; y.row = it.c[0]; it.c[0].items.push(y); });
      }
      this._insert(it);
      if (opts.content) { if (!opts.silent) this.changed(); return; }
      // Cursor ins erste leere Feld
      const target = it.c.find(r => r.items.length === 0) || it.c[it.c.length - 1];
      this.cur = { row: target, idx: target.items.length };
      if (!opts.silent) this.changed();
    }

    /* ---------- Navigation ---------- */
    right() {
      const { row, idx } = this.cur;
      if (idx < row.items.length) {
        const it = row.items[idx];
        if (B.isT(it)) this.cur = { row: it.c[0], idx: 0 };
        else this.cur.idx++;
      } else if (row.up) {
        const t = row.up, k = t.c.indexOf(row);
        if (k < t.c.length - 1) this.cur = { row: t.c[k + 1], idx: 0 };
        else this.cur = { row: t.row, idx: t.row.items.indexOf(t) + 1 };
      } else return false;
      this.changed();
      return true;
    }
    left() {
      const { row, idx } = this.cur;
      if (idx > 0) {
        const it = row.items[idx - 1];
        if (B.isT(it)) { const r = it.c[it.c.length - 1]; this.cur = { row: r, idx: r.items.length }; }
        else this.cur.idx--;
      } else if (row.up) {
        const t = row.up, k = t.c.indexOf(row);
        if (k > 0) { const r = t.c[k - 1]; this.cur = { row: r, idx: r.items.length }; }
        else this.cur = { row: t.row, idx: t.row.items.indexOf(t) };
      } else return false;
      this.changed();
      return true;
    }
    _vert(map) {
      let r = this.cur.row;
      while (r.up) {
        const t = r.up, k = t.c.indexOf(r);
        const f = map[t.k];
        const j = f ? f(k, t) : -1;
        if (j >= 0) {
          const tr = t.c[j];
          this.cur = { row: tr, idx: Math.min(this.cur.idx, tr.items.length) };
          this.changed();
          return true;
        }
        if (map === DOWN && t.k === 'sup') {
          this.cur = { row: t.row, idx: t.row.items.indexOf(t) + 1 };
          this.changed();
          return true;
        }
        r = t.row;
      }
      return false;
    }
    up() { return this._vert(UP); }
    down() { return this._vert(DOWN); }
    home() { this.cur = { row: this.root, idx: 0 }; this.changed(); }
    end() { this.cur = { row: this.root, idx: this.root.items.length }; this.changed(); }
    atTop() { return this.cur.row === this.root; }

    /* ---------- Loeschen ---------- */
    backspace() {
      const { row, idx } = this.cur;
      if (idx > 0) {
        const it = row.items[idx - 1];
        if (B.isT(it) && !B.empty(it)) {
          const r = it.c[it.c.length - 1];
          this.cur = { row: r, idx: r.items.length };
        } else {
          row.items.splice(idx - 1, 1);
          this.cur.idx--;
        }
      } else if (row.up) {
        const t = row.up, k = t.c.indexOf(row);
        if (k > 0 && !(t.k in PREFILL)) {
          const r = t.c[k - 1];
          this.cur = { row: r, idx: r.items.length };
        } else {
          // Vorlage aufloesen, Inhalt bleibt stehen
          const pr = t.row, at = pr.items.indexOf(t);
          let content = [];
          if (t.k === 'frac' && t.c[1].items.length) content = t.c[0].items.concat([B.ch('÷')], t.c[1].items);
          else if (t.k in PREFILL) content = t.c.filter((r, j) => j !== PREFILL[t.k][0]).reduce((a, r) => a.concat(r.items), []);
          else content = t.c.reduce((a, r) => a.concat(r.items), []);
          content.forEach(x => { x.row = pr; });
          pr.items.splice(at, 1, ...content);
          this.cur = { row: pr, idx: at };
        }
      } else return false;
      this.changed();
      return true;
    }
    del() {
      const { row, idx } = this.cur;
      if (idx < row.items.length) {
        const it = row.items[idx];
        if (B.isT(it) && !B.empty(it)) this.cur = { row: it.c[0], idx: 0 };
        else row.items.splice(idx, 1);
        this.changed();
        return true;
      }
      return false;
    }

    /* ---------- Auswertung ---------- */
    ast() { return B.parse(this.root, MP.userFns); }
    text() { return B.text(this.root); }
    paste(s) {
      const cb = this.onChange;
      this.onChange = () => {};
      try { this._pasteStr(String(s).replace(/\r?\n/g, ' ').trim()); }
      finally { this.onChange = cb; }
      this.changed();
    }
    // Text einfuegen: ^ wird zur echten Hochzahl, / und * bleiben lineare Operatoren
    _pasteStr(s) {
      let i = 0;
      while (i < s.length) {
        const c = s[i];
        if (c === ' ') { this._mergeWord(true); i++; continue; }
        if (c === '/') { this._insert(B.ch('÷')); i++; continue; }
        if (c === '*') { this._insert(B.ch('×')); i++; continue; }
        if (c === '^') {
          let j = i + 1, inner = '';
          if (s[j] === '(') {
            let d = 0, k = j;
            for (; k < s.length; k++) { if (s[k] === '(') d++; else if (s[k] === ')') { d--; if (!d) break; } }
            inner = s.slice(j + 1, k);
            j = k + 1;
          } else {
            let k = j;
            if (s[k] === '-' || s[k] === '−') k++;
            if (/[0-9.]/.test(s[k] || '')) while (k < s.length && /[0-9.]/.test(s[k])) k++;
            else if (k < s.length) k++;
            inner = s.slice(j, k);
            j = k;
          }
          this.tpl('sup', { silent: true });
          const t = this.cur.row.up;
          this._pasteStr(inner);
          this.cur = { row: t.row, idx: t.row.items.indexOf(t) + 1 };
          i = j;
          continue;
        }
        this.ch(c);
        i++;
      }
    }

    /* ---------- Darstellung ---------- */
    render(container, focused) {
      this.el = container;
      container.textContent = '';
      container.appendChild(B.render(this.root, { cur: focused ? this.cur : null, edit: true }));
      B.stretchParens(container);
      const c = container.querySelector('.m-cur');
      if (c && c.scrollIntoView) {
        const box = container.closest('.scroll-x') || container;
        const cr = c.getBoundingClientRect(), br = box.getBoundingClientRect();
        if (cr.right > br.right - 4) box.scrollLeft += cr.right - br.right + 12;
        else if (cr.left < br.left + 4) box.scrollLeft -= br.left - cr.left + 12;
      }
    }
    placeFromEvent(e) {
      const t = e.target;
      const rowEl = t.closest && t.closest('.m-row');
      if (!rowEl || !this.el || !this.el.contains(rowEl)) { this.end(); return; }
      const row = rowEl.__row;
      const kids = Array.from(rowEl.children).filter(k => k.__it);
      let idx = row.items.length;
      for (let i = 0; i < kids.length; i++) {
        const r = kids[i].getBoundingClientRect();
        if (e.clientX < r.left + r.width / 2) { idx = kids[i].__idx; break; }
      }
      this.cur = { row, idx };
      this.changed();
    }
  }
  // Hinweis: '^' beim Einfuegen von Text bleibt als Zeichen; der Tokenizer versteht es als Potenz
  MP.Editor = Editor;
})(typeof window !== 'undefined' ? (window.MP = window.MP || {}) : (globalThis.MP = globalThis.MP || {}));

/* MathPad II — Kern: Tokenizer, Parser, AST-Werkzeuge, Ausgabe nach nerdamer */
(function (MP) {
  'use strict';

  class MathError extends Error {
    constructor(msg) { super(msg); this.name = 'MathError'; }
  }
  const syntax = () => new MathError('Syntax ERROR');

  // Funktionsnamen, die mit "(" als Aufruf gelesen werden
  const FUNCS = new Set([
    'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh',
    'sec', 'csc', 'cot', 'ln', 'log', 'log10', 'logb', 'sqrt', 'root', 'abs', 'exp', 'sign', 'signum',
    'floor', 'ceil', 'round', 'int', 'intg', 'frac', 'fPart', 'iPart', 'nCr', 'nPr', 'gcd', 'lcm', 'mod',
    'factorial', 'solve', 'approx', 'simplify', 'expand', 'factor', 'combine', 'diff', 'integrate', 'defint',
    'lim', 'limit', 'sum', 'sigma', 'product', 'pi_prod', 'prod', 'det', 'trn', 'transpose', 'inv', 'invert',
    'dotP', 'crossP', 'dot', 'cross', 'norm', 'mean', 'median', 'max', 'min', 'define', 're', 'im', 'arg',
    'conjg', 'realpart', 'imagpart', 'partfrac', 'propFrac', 'erf', 'Si', 'Ci', 'Ei', 'constn', 'identity',
    'dim', 'seq', 'sortA', 'sortD', 'numerator', 'denominator', 'matrix', 'determinant', 'tExpand', 'gamma',
    'rand', 'randint', 'fMax', 'fMin', 'variance', 'stdDev',
    'normPDf', 'normCDf', 'invNormCDf', 'binomialPDf', 'binomialCDf', 'poissonPDf', 'poissonCDf', 'geoPDf', 'geoCDf',
    'tPDf', 'tCDf', 'chiPDf', 'chiCDf', 'fPDf', 'fCDf', 'invTCDf', 'invChiCDf', 'invFCDf', 'invBinomialCDf', 'invPoissonCDf', 'invGeoCDf'
  ]);
  // Befehle, die wie ClassPad mit "(" eingetippt automatisch zu einem Funktions-Token werden
  const AUTO_FN = [
    'asinh', 'acosh', 'atanh', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'sin', 'cos', 'tan',
    'ln', 'log', 'abs', 'exp', 'solve', 'approx', 'simplify', 'expand', 'factor', 'combine', 'diff',
    'integrate', 'lim', 'limit', 'sum', 'prod', 'product', 'det', 'trn', 'mean', 'median', 'max', 'min',
    'define', 'nCr', 'nPr', 'gcd', 'lcm', 'mod', 'floor', 'ceil', 'round', 'int', 'frac', 'sign', 're',
    'im', 'arg', 'conjg', 'partfrac', 'propFrac', 'dotP', 'crossP', 'norm', 'seq', 'sortA', 'sortD', 'dim',
    'erf', 'fMax', 'fMin', 'variance', 'stdDev', 'iPart', 'fPart', 'gamma', 'rand', 'randint',
    'normPDf', 'normCDf', 'invNormCDf', 'binomialPDf', 'binomialCDf', 'poissonPDf', 'poissonCDf', 'geoPDf', 'geoCDf',
    'tPDf', 'tCDf', 'chiPDf', 'chiCDf', 'fPDf', 'fCDf', 'invTCDf', 'invChiCDf', 'invFCDf', 'invBinomialCDf', 'invPoissonCDf', 'invGeoCDf'
  ].sort((a, b) => b.length - a.length);

  const REL = new Set(['=', '≠', '<', '>', '≤', '≥']);
  const RESERVED = new Set(['pi', 'e', 'i', 'Infinity', 'ans', 'constnone']);

  // Anzeige-Namen von Funktionen
  const FN_SHOW = {
    asin: 'sin⁻¹', acos: 'cos⁻¹', atan: 'tan⁻¹', asinh: 'sinh⁻¹', acosh: 'cosh⁻¹', atanh: 'tanh⁻¹',
    log: 'ln', log10: 'log', conjugate: 'conjg', realpart: 're', imagpart: 'im', determinant: 'det', transpose: 'trn'
  };

  /* ---------------- Tokenizer für Text (Ausgabe von nerdamer, eingefügter Text) ---------------- */
  const CHAR_OPS = {
    '+': '+', '-': '-', '−': '-', '–': '-', '*': '*', '×': '*', '·': '*', '⋅': '*', '/': '/', '÷': '/',
    '^': '^', '=': '=', '≠': '≠', '<': '<', '>': '>', '≤': '≤', '≥': '≥', '!': '!', '°': '°', '⇒': '⇒'
  };
  const PUNCT = { '(': 'lp', ')': 'rp', '[': 'lb', ']': 'rb', '{': 'lc', '}': 'rc', ',': 'comma' };

  function isFunc(name, userFns) { return FUNCS.has(name) || (userFns && userFns.has(name)); }

  function pushWord(out, w, parenNext, split, userFns) {
    const lw = w.toLowerCase();
    if (w === 'pi' || w === 'π') return out.push({ t: 'id', v: 'pi' });
    if (lw === 'infinity' || lw === 'inf') return out.push({ t: 'id', v: 'Infinity' });
    if (lw === 'ans') return out.push({ t: 'id', v: 'ans' });
    if (w === 'theta') return out.push({ t: 'id', v: 'θ' });
    if (w === 'constnone') return out.push({ t: 'id', v: 'constnone' });
    if (lw === 'define') return out.push({ t: 'id', v: 'define' });
    if (parenNext && isFunc(w, userFns)) return out.push({ t: 'id', v: w });
    if (!split || w.length === 1) return out.push({ t: 'id', v: w });
    // Eingabemodus: unbekannte Wörter in einzelne Variablen zerlegen, Funktionsnamen am Ende erhalten
    if (parenNext) {
      for (let k = 1; k < w.length; k++) {
        const tail = w.slice(k);
        if (isFunc(tail, userFns)) {
          for (const ch of w.slice(0, k)) out.push({ t: 'id', v: ch });
          return out.push({ t: 'id', v: tail });
        }
      }
    }
    for (const ch of w) out.push({ t: 'id', v: ch });
  }

  function tokenizeString(s, opts) {
    opts = opts || {};
    const split = !!opts.split, userFns = opts.userFns;
    const out = [];
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      if (/[0-9.]/.test(c)) {
        let j = i;
        while (j < s.length && /[0-9]/.test(s[j])) j++;
        if (s[j] === '.') { j++; while (j < s.length && /[0-9]/.test(s[j])) j++; }
        let v = s.slice(i, j);
        if (v === '.') throw syntax();
        if (s[j] === 'e' || s[j] === 'E' || s[j] === 'ᴇ') {
          let k = j + 1;
          if (s[k] === '+' || s[k] === '-' || s[k] === '−') k++;
          if (/[0-9]/.test(s[k] || '')) {
            let m = k;
            while (m < s.length && /[0-9]/.test(s[m])) m++;
            v += 'e' + s.slice(j + 1, m).replace('−', '-').replace('+', '');
            j = m;
          } else if (s[j] === 'ᴇ') throw syntax();
        }
        out.push({ t: 'num', v });
        i = j;
        continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        let j = i;
        while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
        pushWord(out, s.slice(i, j), s[j] === '(', split, userFns);
        i = j;
        continue;
      }
      if (c === 'π') { out.push({ t: 'id', v: 'pi' }); i++; continue; }
      if (c === '∞') { out.push({ t: 'id', v: 'Infinity' }); i++; continue; }
      if (c === 'θ') { out.push({ t: 'id', v: 'θ' }); i++; continue; }
      const two = s.slice(i, i + 2);
      if (two === '<=') { out.push({ t: 'op', v: '≤' }); i += 2; continue; }
      if (two === '>=') { out.push({ t: 'op', v: '≥' }); i += 2; continue; }
      if (two === '!=' || two === '<>') { out.push({ t: 'op', v: '≠' }); i += 2; continue; }
      if (two === '=>' || two === '->') { out.push({ t: 'op', v: '⇒' }); i += 2; continue; }
      if (CHAR_OPS[c]) { out.push({ t: 'op', v: CHAR_OPS[c] }); i++; continue; }
      if (PUNCT[c]) { out.push({ t: PUNCT[c] }); i++; continue; }
      throw syntax();
    }
    return out;
  }

  /* ---------------- Parser ---------------- */
  class Parser {
    constructor(tokens, userFns, anyFn) { this.t = tokens; this.i = 0; this.userFns = userFns || new Set(); this.anyFn = !!anyFn; this.inDefine = false; }
    peek() { return this.t[this.i]; }
    next() { return this.t[this.i++]; }
    isOp(tok, list) { return tok && tok.t === 'op' && list.indexOf(tok.v) >= 0; }

    parse() {
      if (!this.t.length) throw syntax();
      const e = this.parseStore();
      if (this.i < this.t.length) throw syntax();
      return e;
    }
    parseStore() {
      let l = this.parseRel();
      while (this.isOp(this.peek(), ['⇒'])) {
        this.next();
        const t = this.next();
        if (!t || t.t !== 'id' || RESERVED.has(t.v)) throw syntax();
        l = { type: 'store', a: l, name: t.v };
      }
      return l;
    }
    parseRel() {
      let l = this.parseAdd();
      const t = this.peek();
      if (t && t.t === 'op' && REL.has(t.v)) {
        this.next();
        l = { type: 'rel', op: t.v, a: l, b: this.parseAdd() };
      }
      return l;
    }
    parseAdd() {
      let l = this.parseMul();
      for (;;) {
        const t = this.peek();
        if (this.isOp(t, ['+', '-'])) { this.next(); l = { type: 'bin', op: t.v, a: l, b: this.parseMul() }; }
        else return l;
      }
    }
    parseMul() {
      let l = this.parseImp();
      for (;;) {
        const t = this.peek();
        if (this.isOp(t, ['*', '/'])) { this.next(); l = { type: 'bin', op: t.v, a: l, b: this.parseImp() }; }
        else return l;
      }
    }
    // Weggelassenes Malzeichen bindet staerker als * und / (wie ClassPad)
    parseImp() {
      let l = this.parseUnary();
      while (this.startsPrimary(this.peek())) l = { type: 'bin', op: '*', a: l, b: this.parsePow(), imp: true };
      return l;
    }
    startsPrimary(t) { return !!t && ['num', 'id', 'fn', 'lp', 'lc', 'lb', 'atom'].indexOf(t.t) >= 0; }
    parseUnary() {
      const t = this.peek();
      if (this.isOp(t, ['-'])) { this.next(); return { type: 'neg', a: this.parseUnary() }; }
      if (this.isOp(t, ['+'])) { this.next(); return this.parseUnary(); }
      return this.parsePow();
    }
    parsePow() {
      const b = this.parsePostfix();
      if (this.isOp(this.peek(), ['^'])) {
        this.next();
        return { type: 'bin', op: '^', a: b, b: this.parseUnary() };
      }
      return b;
    }
    parsePostfix() {
      let p = this.parsePrimary();
      for (;;) {
        const t = this.peek();
        if (!t) return p;
        if (this.isOp(t, ['!'])) { this.next(); p = { type: 'fact', a: p }; }
        else if (this.isOp(t, ['°'])) { this.next(); p = { type: 'deg', a: p }; }
        else if (t.t === 'sup') { this.next(); p = { type: 'bin', op: '^', a: p, b: t.ast }; }
        else return p;
      }
    }
    parsePrimary() {
      const t = this.next();
      if (!t) throw syntax();
      switch (t.t) {
        case 'num': return { type: 'num', v: t.v };
        case 'atom': return t.ast;
        case 'id': {
          const nx = this.peek();
          if (t.v === 'define' && !(nx && nx.t === 'lp')) return this.finishDefine(false);
          if (nx && nx.t === 'lp' && (this.anyFn || this.inDefine || isFunc(t.v, this.userFns))) { this.next(); return this.finishCall(t.v); }
          return { type: 'sym', name: t.v };
        }
        case 'fn': return this.finishCall(t.v);
        case 'lp': {
          const e = this.parseStore();
          this.closeOpt('rp');
          return e;
        }
        case 'lc': return { type: 'list', items: this.parseItems('rc') };
        case 'lb': {
          const nx = this.peek();
          if (nx && nx.t === 'lb') {
            const rows = [];
            while (this.peek() && this.peek().t === 'lb') {
              this.next();
              rows.push(this.parseItems('rb'));
              if (this.peek() && this.peek().t === 'comma') this.next();
            }
            this.closeOpt('rb');
            return mkMatrix(rows);
          }
          return { type: 'vec', items: this.parseItems('rb') };
        }
        default: throw syntax();
      }
    }
    closeOpt(kind) {
      const t = this.peek();
      if (!t) return;
      if (t.t === kind) { this.next(); return; }
      throw syntax();
    }
    parseItems(close) {
      const items = [];
      if (this.peek() && this.peek().t === close) { this.next(); return items; }
      for (;;) {
        items.push(this.parseStore());
        const t = this.peek();
        if (!t) return items;
        if (t.t === 'comma') { this.next(); continue; }
        if (t.t === close) { this.next(); return items; }
        throw syntax();
      }
    }
    finishCall(name) {
      if (name !== 'define') return mkCall(name, this.parseItems('rp'));
      return this.finishDefine(true);
    }
    // Define f(x,y)=... : der Kopf wird als Aufruf gelesen, auch wenn f noch unbekannt ist
    finishDefine(paren) {
      this.inDefine = true;
      let head;
      try { head = this.parseAdd(); } finally { this.inDefine = false; }
      const t = this.peek();
      if (!this.isOp(t, ['='])) throw syntax();
      this.next();
      const body = this.parseAdd();
      if (paren) this.closeOpt('rp');
      return mkCall('define', [{ type: 'rel', op: '=', a: head, b: body }]);
    }
  }

  function mkMatrix(rows) {
    if (!rows.length) throw syntax();
    const w = rows[0].length;
    if (!w || rows.some(r => r.length !== w)) throw new MathError('Dimension ERROR');
    return { type: 'matrix', rows };
  }
  function mkCall(name, args) {
    if (name === 'matrix') {
      return mkMatrix(args.map(a => {
        if (a.type === 'vec') return a.items;
        throw syntax();
      }));
    }
    return { type: 'call', name, args };
  }

  function parseTokens(tokens, userFns, anyFn) { return new Parser(tokens, userFns, anyFn).parse(); }
  function parseString(s, opts) { return parseTokens(tokenizeString(s, opts), opts && opts.userFns, opts && opts.anyFn); }

  /* ---------------- AST-Helfer ---------------- */
  const num = v => ({ type: 'num', v: String(v) });
  const sym = name => ({ type: 'sym', name });
  const bin = (op, a, b) => ({ type: 'bin', op, a, b });
  const call = (name, args) => ({ type: 'call', name, args });

  function walk(n, f) {
    if (!n || typeof n !== 'object') return;
    f(n);
    switch (n.type) {
      case 'bin': case 'rel': walk(n.a, f); walk(n.b, f); break;
      case 'neg': case 'fact': case 'deg': case 'store': walk(n.a, f); break;
      case 'call': n.args.forEach(a => walk(a, f)); break;
      case 'list': case 'vec': n.items.forEach(a => walk(a, f)); break;
      case 'matrix': n.rows.forEach(r => r.forEach(a => walk(a, f))); break;
    }
  }
  function map(n, f) {
    // Kopie mit transformierten Kindern, dann f auf den Knoten
    let c;
    switch (n.type) {
      case 'bin': case 'rel': c = Object.assign({}, n, { a: map(n.a, f), b: map(n.b, f) }); break;
      case 'neg': case 'fact': case 'deg': case 'store': c = Object.assign({}, n, { a: map(n.a, f) }); break;
      case 'call': c = Object.assign({}, n, { args: n.args.map(a => map(a, f)) }); break;
      case 'list': case 'vec': c = Object.assign({}, n, { items: n.items.map(a => map(a, f)) }); break;
      case 'matrix': c = Object.assign({}, n, { rows: n.rows.map(r => r.map(a => map(a, f))) }); break;
      default: c = Object.assign({}, n);
    }
    return f(c) || c;
  }
  function symbols(n) {
    const s = new Set();
    walk(n, x => { if (x.type === 'sym' && !RESERVED.has(x.name)) s.add(x.name); });
    return s;
  }
  function hasDecimal(n) {
    let d = false;
    walk(n, x => { if (x.type === 'num' && /[.e]/.test(x.v)) d = true; });
    return d;
  }
  function hasSym(n, name) {
    let f = false;
    walk(n, x => { if (x.type === 'sym' && x.name === name) f = true; });
    return f;
  }
  function substitute(n, name, value) {
    return map(n, x => (x.type === 'sym' && x.name === name ? JSON.parse(JSON.stringify(value)) : null));
  }

  /* ---------------- AST -> nerdamer-Text ---------------- */
  function numToNerd(v) {
    const m = /^([0-9.]+)e([-+]?[0-9]+)$/.exec(v);
    if (m) return '(' + (m[1].startsWith('.') ? '0' + m[1] : m[1]) + '*10^(' + m[2] + '))';
    if (v.startsWith('.')) v = '0' + v;
    if (v.endsWith('.')) v = v.slice(0, -1);
    return v;
  }

  // ctx: { angle: 'rad'|'deg'|'gra', vars: {name: nerdText}, fns: {name:{params,body}}, ans: nerdText }
  function toNerd(n, ctx) {
    ctx = ctx || {};
    switch (n.type) {
      case 'num': return numToNerd(n.v);
      case 'sym': {
        const k = n.name;
        if (k === 'pi') return 'pi';
        if (k === 'e' || k === 'i') return k;
        if (k === 'Infinity') return 'Infinity';
        if (k === 'ans') {
          if (!ctx.ans) throw new MathError('Undefined Ans');
          return '(' + ctx.ans + ')';
        }
        if (k === 'θ') return 'theta';
        if (ctx.vars && Object.prototype.hasOwnProperty.call(ctx.vars, k) && !(ctx.bound && ctx.bound.has(k))) return '(' + ctx.vars[k] + ')';
        return k;
      }
      case 'bin': {
        if (n.op === '^' && isMatrixLike(n.a) && n.b.type === 'neg' && n.b.a.type === 'num' && n.b.a.v === '1') return 'invert(' + toNerd(n.a, ctx) + ')';
        return '(' + toNerd(n.a, ctx) + ')' + n.op + '(' + toNerd(n.b, ctx) + ')';
      }
      case 'neg': return '(-(' + toNerd(n.a, ctx) + '))';
      case 'fact': return 'factorial(' + toNerd(n.a, ctx) + ')';
      case 'deg': {
        const a = toNerd(n.a, ctx);
        if (ctx.angle === 'deg') return '(' + a + ')';
        if (ctx.angle === 'gra') return '((' + a + ')*200/180)';
        return '((' + a + ')*pi/180)';
      }
      case 'rel': {
        const op = { '=': '=', '<': '<', '>': '>', '≤': '<=', '≥': '>=', '≠': '!=' }[n.op];
        return toNerd(n.a, ctx) + op + toNerd(n.b, ctx);
      }
      case 'vec': return '[' + n.items.map(a => toNerd(a, ctx)).join(',') + ']';
      case 'matrix': return 'matrix(' + n.rows.map(r => '[' + r.map(a => toNerd(a, ctx)).join(',') + ']').join(',') + ')';
      case 'list': throw new MathError('Wrong Argument Type');
      case 'store': throw syntax();
      case 'call': return callToNerd(n, ctx);
    }
    throw syntax();
  }
  function isMatrixLike(n) { return n.type === 'matrix' || (n.type === 'sym' && /^[A-Z]$/.test(n.name)); }

  const ANG = { rad: '', deg: '*pi/180', gra: '*pi/200' };
  const ANG_INV = { rad: '', deg: '*180/pi', gra: '*200/pi' };

  function callToNerd(n, ctx) {
    const A = n.args.map(a => toNerd(a, ctx));
    const name = n.name;
    const ang = ctx.angle || 'rad';
    const need = k => { if (A.length !== k) throw new MathError('Argument ERROR'); };
    // Benutzerfunktionen
    if (ctx.fns && ctx.fns[name]) {
      const f = ctx.fns[name];
      if (f.params.length !== n.args.length) throw new MathError('Argument ERROR');
      let body = f.body;
      const tmp = f.params.map((p, k) => '__p' + k);
      f.params.forEach((p, k) => { body = substitute(body, p, sym(tmp[k])); });
      tmp.forEach((p, k) => { body = substitute(body, p, n.args[k]); });
      return '(' + toNerd(body, ctx) + ')';
    }
    switch (name) {
      case 'sin': case 'cos': case 'tan': case 'sec': case 'csc': case 'cot':
        need(1); return name + '((' + A[0] + ')' + ANG[ang] + ')';
      case 'asin': case 'acos': case 'atan':
        need(1); return '(' + name + '(' + A[0] + ')' + ANG_INV[ang] + ')';
      case 'sinh': case 'cosh': case 'tanh': case 'asinh': case 'acosh': case 'atanh':
        need(1); return name + '(' + A[0] + ')';
      case 'ln': need(1); return 'log(' + A[0] + ')';
      case 'log':
        if (A.length === 1) return 'log10(' + A[0] + ')';
        need(2); return '(log(' + A[1] + ')/log(' + A[0] + '))';   // ClassPad: log(Basis, Wert)
      case 'log10': need(1); return 'log10(' + A[0] + ')';
      case 'logb': need(2); return '(log(' + A[1] + ')/log(' + A[0] + '))';
      case 'sqrt': need(1); return 'sqrt(' + A[0] + ')';
      case 'root': {
        need(2);
        const deg = n.args[1];
        const odd = deg.type === 'num' && /^\d+$/.test(deg.v) && (+deg.v) % 2 === 1;
        if (odd) return 'nthroot(' + A[0] + ',' + A[1] + ')';
        return '((' + A[0] + ')^(1/(' + A[1] + ')))';
      }
      case 'exp': need(1); return 'e^(' + A[0] + ')';
      case 'abs': need(1); return 'abs(' + A[0] + ')';
      case 'conjg': need(1); return 'conjugate(' + A[0] + ')';
      case 're': need(1); return 'realpart(' + A[0] + ')';
      case 'im': need(1); return 'imagpart(' + A[0] + ')';
      case 'det': need(1); return 'determinant(' + A[0] + ')';
      case 'trn': need(1); return 'transpose(' + A[0] + ')';
      case 'inv': need(1); return 'invert(' + A[0] + ')';
      case 'dotP': need(2); return 'dot(' + A.join(',') + ')';
      case 'crossP': need(2); return 'cross(' + A.join(',') + ')';
      case 'constn': return 'constnone';
      default:
        return name + '(' + A.join(',') + ')';
    }
  }

  /* ---------------- Zahlen ---------------- */
  // Rationale Zahl aus "a", "a.b", "a/b" -> {p,q} als BigInt
  function gcdBig(a, b) { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) { [a, b] = [b, a % b]; } return a; }
  function rat(p, q) {
    if (q === undefined) q = 1n;
    if (q === 0n) throw new MathError('Division by zero');
    if (q < 0n) { p = -p; q = -q; }
    const g = gcdBig(p, q) || 1n;
    return { p: p / g, q: q / g };
  }
  function ratFromDec(s) {
    const m = /^(\d*)(?:\.(\d*))?(?:e([-+]?\d+))?$/.exec(s);
    if (!m) return null;
    const ip = m[1] || '0', fp = m[2] || '', ex = m[3] ? parseInt(m[3], 10) : 0;
    let p = BigInt(ip + fp), q = 10n ** BigInt(fp.length);
    if (ex > 0) p *= 10n ** BigInt(ex); else if (ex < 0) q *= 10n ** BigInt(-ex);
    return rat(p, q);
  }

  // Formatierung von Gleitkommazahlen (ClassPad Normal 1 / Normal 2 / Fix / Sci)
  function fmtFloat(x, fmt) {
    fmt = fmt || { mode: 'norm1' };
    if (!isFinite(x)) return isNaN(x) ? 'Undefined' : (x > 0 ? '∞' : '-∞');
    if (x === 0) return '0';
    const ax = Math.abs(x);
    const sci = (digits) => {
      let s = x.toExponential(digits - 1);
      let [mant, ex] = s.split('e');
      if (fmt.mode !== 'sci') mant = mant.replace(/\.?0+$/, '');
      return mant + 'ᴇ' + (+ex);
    };
    if (fmt.mode === 'fix') return x.toFixed(fmt.n);
    if (fmt.mode === 'sci') return sci(Math.max(1, fmt.n || 10));
    const lo = fmt.mode === 'norm2' ? 1e-9 : 1e-2;
    if (ax >= 1e10 || ax < lo) return sci(10);
    let s = x.toPrecision(10);
    if (s.indexOf('e') >= 0) return sci(10);
    if (s.indexOf('.') >= 0) s = s.replace(/\.?0+$/, '');
    return s;
  }

  MP.core = {
    MathError, FUNCS, AUTO_FN, REL, RESERVED, FN_SHOW, tokenizeString, parseTokens, parseString, Parser,
    num, sym, bin, call, walk, map, symbols, hasDecimal, hasSym, substitute, toNerd, rat, ratFromDec, gcdBig,
    fmtFloat, isFunc, mkMatrix
  };
})(typeof window !== 'undefined' ? (window.MP = window.MP || {}) : (globalThis.MP = globalThis.MP || {}));

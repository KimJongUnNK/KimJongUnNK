/* MathPad II — Ergebnis-AST -> 2D-Anzeige (Brueche, Wurzeln, ClassPad-Reihenfolge) */
(function (MP) {
  'use strict';
  const C = MP.core, B = MP.B;

  /* ---------- Normalform ---------- */
  // rat {k:'rat',p,q} | flt {k:'flt',v} | sym | sum {terms} | prod {c, f:[{b,e}]} | call | fact | rel | list | vec | mat
  const R = (p, q) => Object.assign({ k: 'rat' }, C.rat(BigInt(p), BigInt(q === undefined ? 1 : q)));
  const ONE = () => R(1);
  const isNum = n => n.k === 'rat' || n.k === 'flt';
  const numVal = n => (n.k === 'flt' ? n.v : Number(n.p) / Number(n.q));

  function mulNum(a, b) {
    if (a.k === 'flt' || b.k === 'flt') return { k: 'flt', v: numVal(a) * numVal(b) };
    return Object.assign({ k: 'rat' }, C.rat(a.p * b.p, a.q * b.q));
  }
  function addNum(a, b) {
    if (a.k === 'flt' || b.k === 'flt') return { k: 'flt', v: numVal(a) + numVal(b) };
    return Object.assign({ k: 'rat' }, C.rat(a.p * b.q + b.p * a.q, a.q * b.q));
  }
  function negNum(a) { return a.k === 'flt' ? { k: 'flt', v: -a.v } : { k: 'rat', p: -a.p, q: a.q }; }
  const isOne = n => n.k === 'rat' && n.p === 1n && n.q === 1n;
  const isNegNum = n => (n.k === 'flt' ? n.v < 0 : n.k === 'rat' && n.p < 0n);

  function norm(a) {
    switch (a.type) {
      case 'num':
        if (/[.e]/.test(a.v)) return { k: 'flt', v: parseFloat(a.v) };
        return R(a.v);
      case 'sym': return { k: 'sym', name: a.name };
      case 'bin':
        switch (a.op) {
          case '+': return sumOf([norm(a.a), norm(a.b)]);
          case '-': return sumOf([norm(a.a), neg(norm(a.b))]);
          case '*': return prodOf([norm(a.a), norm(a.b)]);
          case '/': return prodOf([norm(a.a), powN(norm(a.b), R(-1))]);
          case '^': return powN(norm(a.a), norm(a.b));
        }
        break;
      case 'neg': return neg(norm(a.a));
      case 'call': return { k: 'call', name: a.name, args: a.args.map(norm) };
      case 'fact': return { k: 'fact', a: norm(a.a) };
      case 'deg': return { k: 'deg', a: norm(a.a) };
      case 'rel': return { k: 'rel', op: a.op, a: norm(a.a), b: norm(a.b) };
      case 'list': return { k: 'list', items: a.items.map(norm) };
      case 'vec': return { k: 'vec', items: a.items.map(norm) };
      case 'matrix': return { k: 'mat', rows: a.rows.map(r => r.map(norm)) };
      case 'store': return norm(a.a);
      case 'text': return { k: 'text', v: a.v };
      case 'chain': return { k: 'chain', parts: a.parts.map(p => (typeof p === 'string' ? p : norm(p))) };
    }
    throw new C.MathError('Syntax ERROR');
  }
  function sumOf(items) {
    const terms = [];
    items.forEach(t => {
      if (t.k === 'sum') terms.push(...t.terms);
      else if (!(isNum(t) && numVal(t) === 0 && t.k === 'rat')) terms.push(t);
    });
    if (!terms.length) return R(0);
    if (terms.length === 1) return terms[0];
    return { k: 'sum', terms };
  }
  function prodOf(items) {
    let c = ONE();
    const f = [];
    for (const t of items) {
      if (isNum(t)) c = mulNum(c, t);
      else if (t.k === 'prod') { c = mulNum(c, t.c); f.push(...t.f); }
      else f.push({ b: t, e: ONE() });
    }
    // Zahl^(-1) als Nenner in den Koeffizienten ziehen
    const rest = [];
    for (const x of f) {
      if (x.b.k === 'rat' && x.e.k === 'rat' && x.e.q === 1n && x.b.p !== 0n) {
        const n = x.e.p;
        if (n < 0n && -n < 64n) { c = mulNum(c, Object.assign({ k: 'rat' }, C.rat(x.b.q ** -n, x.b.p ** -n))); continue; }
      }
      rest.push(x);
    }
    // √2·√3 -> √6, √6/√2 -> √3, 1/√2 -> √2/2 (nur positive rationale Radikanden)
    const roots = rest.filter(isSqrtRat);
    if (c.k === 'rat' && roots.length && (roots.length > 1 || roots.some(x => sqrtSign(x) < 0))) {
      let p = 1n, q = 1n;
      roots.forEach(x => { const a = sqrtArg(x); if (sqrtSign(x) > 0) { p *= a.p; q *= a.q; } else { p *= a.q; q *= a.p; } });
      // sqrt(p/q) = sqrt(p·q)/q
      let n = p * q, k = 1n;
      for (let d = 2n; d * d <= n && d < 100000n; d++) while (n % (d * d) === 0n) { n /= d * d; k *= d; }
      c = mulNum(c, Object.assign({ k: 'rat' }, C.rat(k, q)));
      const others = rest.filter(x => !isSqrtRat(x));
      rest.length = 0;
      rest.push(...others);
      if (n !== 1n) rest.push({ b: { k: 'call', name: 'sqrt', args: [R(n)] }, e: ONE() });
    }
    if (!rest.length) return c;
    if (c.k === 'rat' && c.p === 0n) return c;
    if (isOne(c) && rest.length === 1 && isOne(rest[0].e)) return rest[0].b;
    return { k: 'prod', c, f: rest };
  }
  // Faktor ist sqrt(r)^(±1) oder r^(±1/2) mit positiver rationaler Zahl r
  function isSqrtRat(x) {
    const posRat = n => n.k === 'rat' && n.p > 0n;
    if (x.b.k === 'call' && x.b.name === 'sqrt' && posRat(x.b.args[0])) return x.e.k === 'rat' && x.e.q === 1n && (x.e.p === 1n || x.e.p === -1n);
    return posRat(x.b) && x.e.k === 'rat' && x.e.q === 2n && (x.e.p === 1n || x.e.p === -1n);
  }
  const sqrtArg = x => (x.b.k === 'call' ? x.b.args[0] : x.b);
  const sqrtSign = x => (x.e.p < 0n ? -1 : 1);
  function powN(b, e) {
    if (b.k === 'rat' && e.k === 'rat' && e.q === 1n) {
      const n = e.p;
      if (n >= 0n && n < 512n) return Object.assign({ k: 'rat' }, C.rat(b.p ** n, b.q ** n));
      if (n < 0n && -n < 512n && b.p !== 0n) return Object.assign({ k: 'rat' }, C.rat(b.q ** -n, b.p ** -n));
    }
    if (b.k === 'flt' && isNum(e)) return { k: 'flt', v: Math.pow(b.v, numVal(e)) };
    if (b.k === 'prod' && b.f.length === 1 && isOne(b.c) && e.k === 'rat' && e.q === 1n && b.f[0].e.k === 'rat') {
      return { k: 'prod', c: ONE(), f: [{ b: b.f[0].b, e: mulNum(b.f[0].e, e) }] };
    }
    return prodOf([{ k: 'prod', c: ONE(), f: [{ b, e }] }]);
  }
  function neg(t) {
    if (isNum(t)) return negNum(t);
    if (t.k === 'prod') return Object.assign({}, t, { c: negNum(t.c) });
    if (t.k === 'sum') return { k: 'sum', terms: t.terms.map(neg) };
    return { k: 'prod', c: R(-1), f: [{ b: t, e: ONE() }] };
  }
  const isNeg = t => (isNum(t) ? isNegNum(t) : t.k === 'prod' ? isNegNum(t.c) : false);
  const absT = t => (isNeg(t) ? neg(t) : t);

  /* ---------- Sortierung (absteigender Grad wie ClassPad) ---------- */
  const CONSTS = new Set(['pi', 'e', 'i', 'Infinity']);
  function hasVar(n) {
    switch (n.k) {
      case 'sym': return !CONSTS.has(n.name);
      case 'sum': return n.terms.some(hasVar);
      case 'prod': return n.f.some(x => hasVar(x.b) || hasVar(x.e));
      case 'call': return n.args.some(hasVar);
      case 'fact': case 'deg': return hasVar(n.a);
      default: return false;
    }
  }
  function degree(n) {
    switch (n.k) {
      case 'sym': return CONSTS.has(n.name) ? 0 : 1;
      case 'prod': return n.f.reduce((s, x) => {
        if (x.e.k === 'rat') return s + degree(x.b) * numVal(x.e);
        return s + (hasVar(x.e) ? 0.5 : 0);
      }, 0);
      case 'sum': return Math.max(...n.terms.map(degree));
      case 'call': case 'fact': return hasVar(n) ? 0.5 : 0;
      default: return 0;
    }
  }
  const hasI = n => {
    if (n.k === 'sym') return n.name === 'i';
    if (n.k === 'prod') return n.f.some(x => hasI(x.b));
    return false;
  };
  // kleinster Variablenname im Term (x vor y), Konstanten zuletzt
  function leadVar(n) {
    let best = '\uffff';
    const visit = m => {
      if (m.k === 'sym' && !CONSTS.has(m.name) && m.name !== 'constnone') { if (m.name < best) best = m.name; }
      else if (m.k === 'prod') m.f.forEach(x => visit(x.b));
      else if (m.k === 'call') m.args.forEach(visit);
    };
    visit(n);
    return best;
  }
  function sortTerms(terms) {
    return terms.map((t, i) => ({ t, i, d: degree(t), im: hasI(t) ? 1 : 0, pure: isNum(t) ? 1 : 0, v: leadVar(t) }))
      .sort((a, b) => (b.d - a.d) || (a.im - b.im) || (a.pure - b.pure) || (a.v < b.v ? -1 : a.v > b.v ? 1 : 0) || (a.i - b.i))
      .map(x => x.t);
  }
  function factorRank(x) {
    const b = x.b;
    if (b.k === 'sym') {
      if (b.name === 'constnone') return 0;
      if (b.name === 'i') return 6;
      if (b.name === 'pi') return 1;
      if (b.name === 'e') return 3;
      return 2;
    }
    if (b.k === 'call' && (b.name === 'sqrt' || (b.name === 'abs'))) return 2.5;
    if (b.k === 'call' || b.k === 'fact') return 4;
    if (b.k === 'sum') return 5;
    return 3;
  }
  function sortFactors(f) {
    return f.map((x, i) => ({ x, i, r: factorRank(x), n: x.b.k === 'sym' ? x.b.name : '' }))
      .sort((a, b) => (a.r - b.r) || (a.r === 2 ? (a.n < b.n ? -1 : a.n > b.n ? 1 : 0) : 0) || (a.i - b.i))
      .map(o => o.x);
  }

  /* ---------- Anzeige ---------- */
  // Rueckgabe: {items, p} mit Praezedenz p: 1 Summe, 2 Produkt, 3 Bruch/Potenz-tauglich, 4 Atom
  function D(n, o) {
    switch (n.k) {
      case 'rat': {
        if (n.q === 1n) return { items: B.chars((n.p < 0n ? '−' : '') + (n.p < 0n ? -n.p : n.p).toString()), p: n.p < 0n ? 1 : 4 };
        const fr = B.t('frac', [B.chars((n.p < 0n ? -n.p : n.p).toString()), B.chars(n.q.toString())]);
        return n.p < 0n ? { items: [B.ch('−'), fr], p: 1 } : { items: [fr], p: 3 };
      }
      case 'flt': {
        const s = C.fmtFloat(n.v, o.fmt);
        const items = B.chars(s.replace('-', '−'));
        return { items, p: n.v < 0 ? 1 : (s.indexOf('ᴇ') >= 0 ? 2 : 4) };
      }
      case 'sym': {
        const m = { pi: 'π', Infinity: '∞', theta: 'θ' };
        if (n.name === 'constnone') return { items: [B.fn('constn'), B.ch('1'), B.ch(')')], p: 4 };
        if (n.name.startsWith('__')) return { items: B.chars('?'), p: 4 };
        return { items: B.chars(m[n.name] || n.name), p: 4 };
      }
      case 'sum': {
        const terms = sortTerms(n.terms);
        const items = [];
        terms.forEach((t, i) => {
          const ng = isNeg(t);
          const d = D(absT(t), o);
          if (i === 0) { if (ng) items.push(B.ch('−')); }
          else items.push(B.ch(ng ? '−' : '+'));
          items.push(...(d.p <= 1 ? paren(d.items) : d.items));
        });
        return { items, p: 1 };
      }
      case 'prod': return dispProd(n, o);
      case 'call': return dispCall(n, o);
      case 'fact': {
        const d = D(n.a, o);
        return { items: (d.p < 4 ? paren(d.items) : d.items).concat([B.ch('!')]), p: 4 };
      }
      case 'deg': {
        const d = D(n.a, o);
        return { items: (d.p < 4 ? paren(d.items) : d.items).concat([B.ch('°')]), p: 4 };
      }
      case 'rel': {
        const a = D(n.a, o), b = D(n.b, o);
        return { items: a.items.concat([B.ch(n.op)], b.items), p: 0 };
      }
      case 'text': return { items: B.chars(n.v), p: 4 };
      case 'chain': {
        const items = [];
        n.parts.forEach(p => { if (typeof p === 'string') items.push(B.ch(p)); else items.push(...D(p, o).items); });
        return { items, p: 0 };
      }
      case 'list': return { items: [B.ch('{')].concat(join(n.items.map(x => D(x, o).items)), [B.ch('}')]), p: 4 };
      case 'vec': return { items: [B.ch('[')].concat(join(n.items.map(x => D(x, o).items)), [B.ch(']')]), p: 4 };
      case 'mat': {
        const cells = [];
        n.rows.forEach(r => r.forEach(x => cells.push(D(x, o).items)));
        return { items: [B.t('mat', cells, { r: n.rows.length, cols: n.rows[0].length })], p: 4 };
      }
    }
    return { items: B.chars('?'), p: 4 };
  }
  const paren = items => [B.ch('(')].concat(items, [B.ch(')')]);
  function join(lists, sep) {
    const out = [];
    lists.forEach((l, i) => { if (i) out.push(B.ch(sep || ',')); out.push(...l); });
    return out;
  }

  function dispPow(b, e, o) {
    // b^e mit e != 1
    if (e.k === 'rat' && e.p === 1n && e.q === 2n) return { items: [B.t('sqrt', [D(b, o).items])], p: 4 };
    if (e.k === 'rat' && e.p === 1n && e.q > 2n) return { items: [B.t('root', [B.chars(e.q.toString()), D(b, o).items])], p: 4 };
    const bd = D(b, o);
    const needP = bd.p < 4 || (b.k === 'rat' && b.q !== 1n) || (b.k === 'prod');
    const ed = D(e, o);
    return { items: (needP ? paren(bd.items) : bd.items).concat([B.t('sup', [ed.items])]), p: 3 };
  }

  function dispFactor(x, o) {
    if (isOne(x.e)) {
      const d = D(x.b, o);
      return d.p <= 2 ? paren(d.items) : d.items;
    }
    return dispPow(x.b, x.e, o).items;
  }

  function dispProd(n, o) {
    let f = n.f.slice();
    // log(A)/log(B) -> log_B(A)
    const logs = f.filter(x => x.b.k === 'call' && x.b.name === 'log' && x.b.args.length === 1);
    const numL = logs.find(x => isOne(x.e));
    const denL = logs.find(x => x.e.k === 'rat' && x.e.p === -1n && x.e.q === 1n);
    let logbItem = null;
    if (numL && denL) {
      f = f.filter(x => x !== numL && x !== denL);
      const base = denL.b.args[0], arg = numL.b.args[0];
      if (base.k === 'rat' && base.p === 10n && base.q === 1n) logbItem = [B.fn('log10')].concat(D(arg, o).items, [B.ch(')')]);
      else logbItem = [B.t('logb', [D(base, o).items, D(arg, o).items])];
    }
    const top = [], bot = [];
    for (const x of sortFactors(f)) {
      if ((x.e.k === 'rat' && x.e.p < 0n) || (x.e.k === 'flt' && x.e.v < 0)) bot.push({ b: x.b, e: negNum(x.e) });
      else top.push(x);
    }
    const c = n.c;
    const topLists = [], botLists = [];
    let cNum, cDen = null;
    if (c.k === 'rat') { cNum = c.p < 0n ? -c.p : c.p; if (c.q !== 1n) cDen = c.q; }
    else cNum = Math.abs(c.v);
    const cIsOne = c.k === 'rat' ? cNum === 1n : cNum === 1;
    if (!cIsOne || (!top.length && !logbItem)) topLists.push(c.k === 'rat' ? B.chars(cNum.toString()) : D({ k: 'flt', v: cNum }, o).items);
    if (logbItem) topLists.push(logbItem);
    top.forEach(x => topLists.push(dispFactor(x, o)));
    if (cDen !== null) botLists.push(B.chars(cDen.toString()));
    bot.forEach(x => botLists.push(dispFactor(x, o)));
    let items;
    const sign = (c.k === 'rat' ? c.p < 0n : c.v < 0) ? [B.ch('−')] : [];
    if (botLists.length) {
      // Im Bruch braucht ein einzelner Faktor (auch eine Summe) keine Klammern
      const tl = (topLists.length === 1 && top.length === 1 && cIsOne && !logbItem && isOne(top[0].e)) ? D(top[0].b, o).items : join(topLists, '·');
      const bl = (botLists.length === 1 && bot.length === 1 && cDen === null && isOne(bot[0].e)) ? D(bot[0].b, o).items : join(botLists, '·');
      items = sign.concat([B.t('frac', [tl, bl])]);
      return { items, p: sign.length ? 1 : 3 };
    }
    items = sign.concat(join(topLists, '·'));
    return { items, p: sign.length ? 1 : (topLists.length > 1 ? 2 : 3) };
  }

  function argsItems(args, o) { return join(args.map(a => D(a, o).items)); }

  function dispCall(n, o) {
    const a = n.args;
    const T = (k, kids) => ({ items: [B.t(k, kids)], p: 4 });
    switch (n.name) {
      case 'sqrt': return T('sqrt', [D(a[0], o).items]);
      case 'abs': return T('abs', [D(a[0], o).items]);
      case 'nthroot': return T('root', [D(a[1], o).items, D(a[0], o).items]);
      case 'factorial': {
        const d = D(a[0], o);
        return { items: (d.p < 4 ? paren(d.items) : d.items).concat([B.ch('!')]), p: 4 };
      }
      case 'integrate':
        if (a.length === 2) return T('int', [D(a[0], o).items, D(a[1], o).items]);
        break;
      case 'defint':
        if (a.length === 4) return T('dint', [D(a[1], o).items, D(a[2], o).items, D(a[0], o).items, D(a[3], o).items]);
        break;
      case 'diff':
        if (a.length === 2) return T('diff', [D(a[1], o).items, D(a[0], o).items]);
        break;
      case 'limit':
        if (a.length === 3) return T('lim', [D(a[1], o).items, D(a[2], o).items, D(a[0], o).items]);
        break;
      case 'sum':
        if (a.length === 4) return T('sum', [D(a[1], o).items, D(a[2], o).items, D(a[3], o).items, D(a[0], o).items]);
        break;
      case 'product':
        if (a.length === 4) return T('prod', [D(a[1], o).items, D(a[2], o).items, D(a[3], o).items, D(a[0], o).items]);
        break;
    }
    return { items: [B.fn(n.name)].concat(argsItems(a, o), [B.ch(')')]), p: 4 };
  }

  // AST -> Box-Zeile
  function toRow(ast, opts) {
    opts = opts || {};
    const d = D(norm(ast), opts);
    return B.row(d.items);
  }

  MP.display = { toRow, norm, D };
})(typeof window !== 'undefined' ? (window.MP = window.MP || {}) : (globalThis.MP = globalThis.MP || {}));

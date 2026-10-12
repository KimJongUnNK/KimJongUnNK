/* MathPad II — CAS-Schicht ueber nerdamer: Befehle, Modi, Fallbacks */
(function (MP) {
  'use strict';
  const C = MP.core, NUM = MP.num;
  const ME = msg => new C.MathError(msg);
  const nerd = (s, sub) => (sub ? nerdamer(s, sub) : nerdamer(s));

  const TEXT = v => ({ type: 'text', v });
  const isText = (a, v) => a && a.type === 'text' && (v === undefined || a.v === v);

  /* ---------- Hilfen ---------- */
  function parseOut(str) {
    if (str === '' || str === undefined) throw ME('Syntax ERROR');
    return C.parseString(String(str), { anyFn: true });
  }
  function nerdToAst(r) { return parseOut(r.toString()); }
  function N(s, sub) {
    try { return nerd(s, sub); }
    catch (e) { throw mapErr(e); }
  }
  function mapErr(e) {
    if (e instanceof C.MathError) return e;
    const m = String(e && e.message || e);
    if (/division by zero|undefined|is not defined for|0\^0|infinity/i.test(m)) return ME('Undefined');
    if (/too complex|max(imum)? (call|iteration)|stack/i.test(m)) return ME('Too Complicated');
    return ME('Syntax ERROR');
  }
  function mkCtx(env, extraBound) {
    const vars = {};
    Object.keys(env.vars || {}).forEach(k => { vars[k] = C.toNerd(env.vars[k], { angle: 'rad' }); });
    const bound = new Set(extraBound || []);
    return {
      angle: env.settings.angle, vars, fns: env.fns, bound, env,
      ans: ansText(env.ans)
    };
  }
  function ansText(a) {
    if (!a) return null;
    try { return C.toNerd(a, { angle: 'rad' }); } catch (e) { return null; }
  }
  const bind = (ctx, names) => Object.assign({}, ctx, { bound: new Set([...ctx.bound, ...names]) });
  const T = (a, ctx) => C.toNerd(a, ctx);
  function symName(a) {
    if (!a || a.type !== 'sym' || C.RESERVED.has(a.name)) throw ME('Wrong Argument Type');
    return a.name === 'θ' ? 'theta' : a.name;
  }
  function numericValue(ast, ctx) {
    try {
      const f = NUM.compile(ast, [], { angle: ctx ? ctx.angle : 'rad', values: {} });
      return f();
    } catch (e) { return NaN; }
  }
  function safeCompile(ast, vars) {
    try { return NUM.compile(ast, vars, { angle: 'rad', values: {} }); } catch (e) { return null; }
  }
  const hasI = a => C.hasSym(a, 'i');
  function freeOf(a, names) { const s = C.symbols(a); return !names.some(n => s.has(n)); }

  // Exakte Zerlegung z = re + im·i (nerdamers realpart/imagpart sind unzuverlaessig)
  function complexParts(a) {
    const S = x => N(x).toString();
    const P = (re, im) => [re, im];
    const mul = (u, v) => P(S('(' + u[0] + ')*(' + v[0] + ')-(' + u[1] + ')*(' + v[1] + ')'), S('(' + u[0] + ')*(' + v[1] + ')+(' + u[1] + ')*(' + v[0] + ')'));
    function go(n) {
      if (!hasI(n)) return P(S(C.toNerd(n, { angle: 'rad' })), '0');
      switch (n.type) {
        case 'sym': return P('0', '1');
        case 'neg': { const u = go(n.a); return P(S('-(' + u[0] + ')'), S('-(' + u[1] + ')')); }
        case 'bin': {
          const u = go(n.a);
          if (n.op === '^') {
            if (n.a.type === 'sym' && n.a.name === 'e') {
              const w = go(n.b);
              return P(S('e^(' + w[0] + ')*cos(' + w[1] + ')'), S('e^(' + w[0] + ')*sin(' + w[1] + ')'));
            }
            if (hasI(n.b)) return null;
            const k = numericValue(n.b);
            if (!Number.isInteger(k) || Math.abs(k) > 64) return null;
            let r = P('1', '0');
            for (let j = 0; j < Math.abs(k); j++) r = mul(r, u);
            if (k < 0) {
              const d = S('(' + r[0] + ')^2+(' + r[1] + ')^2');
              r = P(S('(' + r[0] + ')/(' + d + ')'), S('-(' + r[1] + ')/(' + d + ')'));
            }
            return r;
          }
          const v = go(n.b);
          if (!u || !v) return null;
          if (n.op === '+') return P(S('(' + u[0] + ')+(' + v[0] + ')'), S('(' + u[1] + ')+(' + v[1] + ')'));
          if (n.op === '-') return P(S('(' + u[0] + ')-(' + v[0] + ')'), S('(' + u[1] + ')-(' + v[1] + ')'));
          if (n.op === '*') return mul(u, v);
          if (n.op === '/') {
            const d = S('(' + v[0] + ')^2+(' + v[1] + ')^2');
            return P(S('((' + u[0] + ')*(' + v[0] + ')+(' + u[1] + ')*(' + v[1] + '))/(' + d + ')'), S('((' + u[1] + ')*(' + v[0] + ')-(' + u[0] + ')*(' + v[1] + '))/(' + d + ')'));
          }
          return null;
        }
        case 'call': {
          if (n.name === 'abs') { const u = go(n.args[0]); return u && P(S('sqrt((' + u[0] + ')^2+(' + u[1] + ')^2)'), '0'); }
          if (n.name === 'conjugate') { const u = go(n.args[0]); return u && P(u[0], S('-(' + u[1] + ')')); }
          return null;
        }
      }
      return null;
    }
    try {
      const r = go(a);
      if (!r || r.some(x => /\bi\b/.test(x))) return null;
      return r;
    } catch (e) { return null; }
  }
  // Ergebnis von nerdamer: komplexe Zahlen auf a+b·i bringen
  function tidy(r) {
    let s = r.toString();
    if (/\bi\b/.test(s)) {
      try {
        const ast = parseOut(s);
        if (C.symbols(ast).size === 0) {
          const p = complexParts(ast);
          if (p) s = N('(' + p[0] + ')+(' + p[1] + ')*i').toString();
        }
      } catch (e) { /* so lassen */ }
    }
    return parseOut(s);
  }

  /* ---------- Zahlen wiedererkennen (fuer numerische Loesungen) ---------- */
  function ratClose(v, maxQ, tol) {
    for (let q = 1; q <= maxQ; q++) {
      const p = Math.round(v * q);
      if (Math.abs(v - p / q) <= tol * Math.max(1, Math.abs(v))) return [p, q];
    }
    return null;
  }
  const ratAst = (p, q) => {
    const n = C.num(Math.abs(p));
    let a = q === 1 ? n : C.bin('/', n, C.num(q));
    return p < 0 ? { type: 'neg', a } : a;
  };
  function recognize(v, tol) {
    tol = tol || 1e-11;
    if (!isFinite(v)) return null;
    let r = ratClose(v, 1000, tol);
    if (r) return ratAst(r[0], r[1]);
    const sg = v < 0 ? -1 : 1, av = Math.abs(v);
    r = ratClose(av * av, 100, tol);
    if (r && r[0] < 1e7) { const s = C.call('sqrt', [ratAst(r[0], r[1])]); return sg < 0 ? { type: 'neg', a: s } : s; }
    r = ratClose(v / Math.PI, 24, tol);
    if (r) return C.bin('*', ratAst(r[0], r[1]), C.sym('pi'));
    r = ratClose(v / (Math.PI * Math.PI), 1000, tol);
    if (r && Math.abs(r[0]) < 100) return C.bin('*', ratAst(r[0], r[1]), C.bin('^', C.sym('pi'), C.num(2)));
    r = ratClose(Math.exp(v), 100, tol);
    if (r && r[0] > 0 && r[0] < 1e6) return C.call('ln', [ratAst(r[0], r[1])]);
    if (v > 0) {
      r = ratClose(Math.log(v), 12, tol);
      if (r) return C.bin('^', C.sym('e'), ratAst(r[0], r[1]));
    }
    r = ratClose(v / Math.E, 24, tol);
    if (r) return C.bin('*', ratAst(r[0], r[1]), C.sym('e'));
    for (let b = 2; b <= 10; b++) {
      const c = Math.exp(v * Math.log(b));
      const cr = Math.round(c);
      if (cr >= 2 && cr <= 1000 && Math.abs(c - cr) < tol * c * 10) return C.call('logb', [C.num(b), C.num(cr)]);
    }
    return null;
  }
  // nerdamer liefert bei transzendenten Gleichungen Naeherungsbrueche wie 277935317/172690922
  function isUglyRational(a) {
    let x = a, neg = false;
    if (x.type === 'neg') { x = x.a; neg = true; }
    if (x.type === 'bin' && x.op === '/' && x.a.type === 'neg') x = { type: 'bin', op: '/', a: x.a.a, b: x.b };
    if (x.type === 'bin' && x.op === '/' && x.a.type === 'num' && x.b.type === 'num') {
      const q = BigInt(x.b.v);
      let t = q;
      while (t % 2n === 0n) t /= 2n;
      while (t % 5n === 0n) t /= 5n;
      return q > 100000n && (t !== 1n || q > 1000000000000n);
    }
    return false && neg;
  }
  // nerdamer rechnet manche Sonderfunktionen (erf, …) still als Naeherungsbruch aus: dann ehrlich dezimal zeigen
  function guard(a) {
    if (isUglyRational(a)) { const v = numericValue(a); return recognize(v, 1e-12) || floatAst(v); }
    return a;
  }
  const floatAst = v => C.num(Number.isInteger(v) && Math.abs(v) < 1e15 ? String(v) + '.0' : String(v));

  /* ---------- Reduktion: Befehle auswerten ---------- */
  const CMD = {};
  function red(n, ctx) {
    switch (n.type) {
      case 'call': {
        if (CMD[n.name]) return CMD[n.name](n.args, ctx, n);
        const out = Object.assign({}, n, { args: n.args.map(a => red(a, ctx)) });
        const exactArgs = out.args.every(a => C.symbols(a).size === 0 && !C.hasDecimal(a) && !hasI(a));
        if ((n.name === 'log' || n.name === 'logb' || n.name === 'log10') && exactArgs) return exactLog(out, ctx);
        if ((n.name === 'asin' || n.name === 'acos' || n.name === 'atan') && exactArgs && out.args.length === 1) return exactInvTrig(out, ctx);
        return out;
      }
      case 'bin': case 'rel': return Object.assign({}, n, { a: red(n.a, ctx), b: red(n.b, ctx) });
      case 'fact': return CMD.factorial([n.a], ctx);
      case 'neg': case 'deg': return Object.assign({}, n, { a: red(n.a, ctx) });
      case 'list': case 'vec': return Object.assign({}, n, { items: n.items.map(a => red(a, ctx)) });
      case 'matrix': return Object.assign({}, n, { rows: n.rows.map(r => r.map(a => red(a, ctx))) });
      case 'store': throw ME('Syntax ERROR');
      default: return n;
    }
  }

  // log(1000)=3, log(2,8)=3 exakt; sonst bleibt der Logarithmus stehen
  function exactLog(n, ctx) {
    const base = n.args.length === 2 ? n.args[0] : C.num(10);
    const arg = n.args.length === 2 ? n.args[1] : n.args[0];
    try {
      const v = Math.log(numericValue(arg)) / Math.log(numericValue(base));
      const k = Math.round(v * 12) / 12;
      if (isFinite(v) && Math.abs(v - k) < 1e-12) {
        // Gegenprobe exakt: base^k == arg
        const chk = N('simplify((' + T(base, ctx) + ')^(' + k * 12 + '/12)-(' + T(arg, ctx) + '))').toString();
        if (chk === '0') return parseOut(N(k * 12 + '/12').toString());
      }
    } catch (e) { /* stehen lassen */ }
    return n;
  }

  // sin⁻¹(1/2)=π/6 bzw. 30° exakt aus der Tabelle der Standardwinkel
  function exactInvTrig(n, ctx) {
    const v = numericValue(n.args[0]);
    if (!isFinite(v)) return n;
    let rad = null;
    if (n.name === 'atan') rad = piFrac(ATAN_TAB, v);
    else if (Math.abs(v) <= 1) {
      const a = piFrac(ASIN_TAB, v);
      if (a) rad = n.name === 'asin' ? a : '(pi/2-' + a + ')';
    }
    if (!rad) return n;
    const conv = { rad: '', deg: '*180/pi', gra: '*200/pi' }[ctx.angle];
    return tidy(N('(' + rad + ')' + conv));
  }

  // Listen elementweise verteilen: {1,2}·x -> {x, 2·x}
  function listLen(n) {
    let len = -1;
    C.walk(n, x => {
      if (x.type === 'list') {
        if (len >= 0 && len !== x.items.length) throw ME('Dimension ERROR');
        len = x.items.length;
      }
    });
    return len;
  }
  function pickList(n, i) {
    return C.map(n, x => (x.type === 'list' ? x.items[i] : null));
  }

  // Exakt vereinfachen (ohne Befehle)
  function simp(n, ctx) {
    if (isText(n)) return n;
    if (n.type === 'list') return { type: 'list', items: n.items.map(a => simp(a, ctx)) };
    if (n.type === 'rel') return { type: 'rel', op: n.op, a: simp(n.a, ctx), b: simp(n.b, ctx) };
    if (n.type === 'chain') return n;
    const L = listLen(n);
    if (L >= 0) {
      const items = [];
      for (let i = 0; i < L; i++) items.push(simp(pickList(n, i), ctx));
      return { type: 'list', items };
    }
    let undef = false;
    C.walk(n, x => { if (isText(x)) undef = true; });
    if (undef) return TEXT('Undefined');
    let r;
    try { r = N(T(n, ctx)); }
    catch (e) {
      if (e.message === 'Undefined') return TEXT('Undefined');
      throw e;
    }
    const out = tidy(r);
    // Dezimalzahl rein, Dezimalzahl raus (nerdamer rechnet intern mit Bruechen)
    return C.hasDecimal(n) ? toDecimal(out) : out;
  }

  function evalFull(n, ctx) { return simp(red(n, ctx), ctx); }

  /* ---------- Dezimal ---------- */
  function toDecimal(a) {
    if (isText(a)) return a;
    switch (a.type) {
      case 'list': return { type: 'list', items: a.items.map(toDecimal) };
      case 'vec': return { type: 'vec', items: a.items.map(toDecimal) };
      case 'rel': return { type: 'rel', op: a.op, a: toDecimal(a.a), b: toDecimal(a.b) };
      case 'chain': return { type: 'chain', parts: a.parts.map(p => (typeof p === 'string' ? p : toDecimal(p))) };
      case 'matrix': return { type: 'matrix', rows: a.rows.map(r => r.map(toDecimal)) };
    }
    // reine Zahl: direkt mit Gleitkomma
    if (C.symbols(a).size === 0 && !hasI(a)) {
      const v = numericValue(a, { angle: 'rad' });
      if (isFinite(v)) return floatAst(v);
    }
    let out;
    try { out = parseOut(N(C.toNerd(a, { angle: 'rad' })).evaluate().text('decimals')); }
    catch (e) { return a; }
    return C.map(out, x => {
      if (x.type === 'num') {
        const v = parseFloat(x.v);
        return floatAst(v);
      }
      return null;
    });
  }

  /* ---------- Befehle ---------- */
  function pickVar(expr, given) {
    if (given) return symName(given);
    const s = C.symbols(expr);
    if (s.has('x')) return 'x';
    const list = [...s].filter(k => k !== 'constnone').sort();
    if (!list.length) throw ME('Wrong Argument Type');
    return list[0] === 'θ' ? 'theta' : list[0];
  }
  const varSym = v => C.sym(v === 'theta' ? 'θ' : v);

  // allgemeine Loesung von sin/cos/tan(a·x+b)=c
  const ASIN_TAB = [[0, 0, 1], [0.5, 1, 6], [Math.SQRT1_2, 1, 4], [Math.sqrt(3) / 2, 1, 3], [1, 1, 2]];
  const ATAN_TAB = [[0, 0, 1], [1 / Math.sqrt(3), 1, 6], [1, 1, 4], [Math.sqrt(3), 1, 3]];
  function piFrac(table, v) {
    const s = v < 0 ? -1 : 1, av = Math.abs(v);
    for (const [val, p, q] of table) if (Math.abs(av - val) < 1e-12) return '(' + (s * p) + '*pi/' + q + ')';
    return null;
  }
  function trigGeneral(eq, x, ctx) {
    if (eq.type !== 'rel' || eq.op !== '=') return null;
    let L = eq.a, Rr = eq.b;
    const isTrig = n => n.type === 'call' && ['sin', 'cos', 'tan'].indexOf(n.name) >= 0 && n.args.length === 1 && C.hasSym(n.args[0], x);
    if (!isTrig(L) && isTrig(Rr)) [L, Rr] = [Rr, L];
    if (!isTrig(L) || C.hasSym(Rr, x)) return null;
    const u = T(L.args[0], ctx);
    const a = N('diff(' + u + ',' + x + ')').toString();
    if (/\b[a-z]/i.test(a.replace(/\bpi\b|\be\b|sqrt/g, '')) || a === '0') return null;
    const b = N(u).sub(x, '0').toString();
    const cS = T(Rr, ctx);
    const cv = numericValue(parseOut(N(cS).toString()), ctx);
    if (!isFinite(cv)) return null;
    let theta;
    if (L.name === 'tan') theta = piFrac(ATAN_TAB, cv) || 'atan(' + cS + ')';
    else {
      if (Math.abs(cv) > 1 + 1e-15) return { type: 'text', v: 'No Solution' };
      theta = piFrac(ASIN_TAB, cv) || 'asin(' + cS + ')';
    }
    const angF = { rad: '1', deg: '(pi/180)', gra: '(pi/200)' }[ctx.angle];
    let ws;
    if (L.name === 'sin') ws = Math.abs(Math.abs(cv) - 1) < 1e-15 ? [theta + '+2*pi*constnone'] : [theta + '+2*pi*constnone', 'pi-' + theta + '+2*pi*constnone'];
    else if (L.name === 'cos') {
      const th = Math.abs(cv) < 1 - 1e-15 ? '(pi/2-' + theta + ')' : (cv > 0 ? '0' : 'pi');
      ws = Math.abs(Math.abs(cv) - 1) < 1e-15 ? [th + '+2*pi*constnone'] : [th + '+2*pi*constnone', '-' + th + '+2*pi*constnone'];
    } else ws = [theta + '+pi*constnone'];
    const items = ws.map(w => {
      const sol = N('expand(((' + w + ')/' + angF + '-(' + b + '))/(' + a + '))');
      return { type: 'rel', op: '=', a: varSym(x), b: tidy(sol) };
    });
    return { type: 'list', items };
  }

  function solveSingle(eq, x, ctx) {
    const isRel = eq.type === 'rel';
    if (isRel && eq.op !== '=') return solveIneq(eq, x, ctx);
    const tg = trigGeneral(eq, x, ctx);
    if (tg) return tg;
    const lhs = isRel ? T(eq.a, ctx) : T(eq, ctx);
    const rhs = isRel ? T(eq.b, ctx) : '0';
    let sols = null;
    try {
      const r = nerdamer.solve(lhs + '=' + rhs, x);
      const v = parseOut(r.toString());
      sols = v.type === 'vec' ? v.items : [v];
    } catch (e) { sols = null; }
    const real = ctx.env.settings.complex === 'real';
    const fAst = parseOut(N('(' + lhs + ')-(' + rhs + ')').toString());
    const f = safeCompile(fAst, [x]);
    let out = [];
    let numericOnly = false;
    if (sols) {
      for (let s of sols) {
        if (isUglyRational(s)) {
          const v = numericValue(s);
          s = recognize(v) || floatAst(v);
          numericOnly = true;
        }
        out.push(s);
      }
    }
    // Unbrauchbar oder leer: numerisch nachsuchen (Gleichungen wie x·e^x=1)
    if (f && (!sols || (numericOnly && out.length > 6))) {
      const rs = NUM.roots(f, -100, 100, 40000).filter(z => Math.abs(z) <= 100);
      out = rs.map(z => recognize(z, 1e-10) || floatAst(z));
    }
    if (numericOnly) {
      // nur Loesungen nahe Null behalten, sortiert
      out = out.filter(s => Math.abs(numericValue(s)) <= 100);
      out.sort((p, q) => numericValue(p) - numericValue(q));
      if (out.length > 8) out = out.slice(0, 8);
    }
    if (real) out = out.filter(s => !hasI(s));
    // doppelte entfernen
    const seen = [];
    out = out.filter(s => {
      const key = C.symbols(s).size || hasI(s) ? JSON.stringify(s) : numericValue(s).toPrecision(12);
      if (seen.indexOf(key) >= 0) return false;
      seen.push(key);
      return true;
    });
    if (out.every(s => C.symbols(s).size === 0 && !hasI(s))) out.sort((p, q) => numericValue(p) - numericValue(q));
    if (!out.length) return TEXT('No Solution');
    return { type: 'list', items: out.map(s => ({ type: 'rel', op: '=', a: varSym(x), b: C.hasDecimal(s) ? s : tidy(N(T(s, { angle: 'rad' }))) })) };
  }

  function solveIneq(eq, x, ctx) {
    const op = eq.op;
    const fS = '(' + T(eq.a, ctx) + ')-(' + T(eq.b, ctx) + ')';
    const fAst = parseOut(N(fS).toString());
    const f = NUM.compile(fAst, [x], { angle: 'rad', values: {} });
    let crit = [];
    try {
      const r = parseOut(nerdamer.solve(fS + '=0', x).toString());
      (r.type === 'vec' ? r.items : [r]).forEach(s => {
        if (hasI(s) || C.symbols(s).size) return;
        const v = numericValue(s);
        if (isFinite(v)) crit.push({ v, ast: isUglyRational(s) ? (recognize(v) || floatAst(v)) : s, root: true });
      });
    } catch (e) { /* numerisch */ }
    // Polstellen und uebersehene Vorzeichenwechsel
    const N0 = 20000, A = -1000, Bv = 1000, h = (Bv - A) / N0;
    const addCrit = (z, isRoot) => {
      if (crit.some(c => Math.abs(c.v - z) < 1e-7)) return;
      crit.push({ v: z, ast: recognize(z, 1e-9) || floatAst(z), root: isRoot });
    };
    let prev = f(A), px = A;
    for (let i = 1; i <= N0; i++) {
      const xv = A + h * i, y = f(xv);
      if (!isFinite(y)) {
        // Definitionsluecke genau auf dem Raster (z. B. 1/x bei 0)
        if (isFinite(prev)) addCrit(Math.abs(xv) < 1e-9 ? 0 : xv, false);
      } else if (isFinite(prev) && prev * y < 0) {
        const z = NUM.bisect(f, px, xv, prev, y);
        addCrit(Math.abs(z) < 1e-12 ? 0 : z, Math.abs(f(z)) < 1e-7);
      }
      prev = y; px = xv;
    }
    crit.sort((p, q) => p.v - q.v);
    crit = crit.filter((c, i) => i === 0 || Math.abs(c.v - crit[i - 1].v) > 1e-9);
    const test = v => {
      const y = f(v);
      if (!isFinite(y)) return false;
      return op === '<' ? y < 0 : op === '>' ? y > 0 : op === '≤' ? y <= 1e-12 : op === '≥' ? y >= -1e-12 : Math.abs(y) > 1e-12;
    };
    const closed = op === '≤' || op === '≥';
    const pts = [-Infinity].concat(crit.map(c => c.v), [Infinity]);
    const segs = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const lo = pts[i], hi = pts[i + 1];
      const mid = !isFinite(lo) ? (isFinite(hi) ? hi - 1 : 0) : !isFinite(hi) ? lo + 1 : (lo + hi) / 2;
      if (test(mid)) segs.push([i, i + 1]);
    }
    // benachbarte Intervalle ueber geschlossene Wurzeln verbinden
    const merged = [];
    segs.forEach(s => {
      const last = merged[merged.length - 1];
      if (last && last[1] === s[0] && closed && crit[s[0] - 1] && crit[s[0] - 1].root) last[1] = s[1];
      else if (last && last[1] === s[0] && op === '≠') last[1] = s[1];
      else merged.push(s.slice());
    });
    const X = varSym(x);
    const items = [];
    merged.forEach(([i, j]) => {
      const lo = i > 0 ? crit[i - 1] : null, hi = j < pts.length - 1 ? crit[j - 1] : null;
      const lop = lo && closed && lo.root ? '≤' : '<', hip = hi && closed && hi.root ? '≤' : '<';
      if (!lo && !hi) items.push(TEXT('true'));
      else if (!lo) items.push({ type: 'rel', op: hip, a: X, b: tidy(N(T(hi.ast, { angle: 'rad' }))) });
      else if (!hi) items.push({ type: 'rel', op: lop, a: tidy(N(T(lo.ast, { angle: 'rad' }))), b: X });
      else items.push({ type: 'chain', parts: [tidy(N(T(lo.ast, { angle: 'rad' }))), lop, X, hip, tidy(N(T(hi.ast, { angle: 'rad' })))] });
    });
    // isolierte Punkte bei ≤/≥ (z. B. x²≤0)
    if (closed) crit.forEach((c, k) => {
      if (!c.root) return;
      const inside = merged.some(([i, j]) => k + 1 >= i && k + 1 <= j);
      if (!inside) items.push({ type: 'rel', op: '=', a: X, b: tidy(N(T(c.ast, { angle: 'rad' }))) });
    });
    if (!items.length) return TEXT('No Solution');
    return { type: 'list', items };
  }

  function isLinearIn(eS, vars) {
    for (const v of vars) {
      const d = N('diff(' + eS + ',' + v + ')').toString();
      for (const w of vars) if (N('diff(' + d + ',' + w + ')').toString() !== '0') return false;
    }
    return true;
  }
  function solveSystem(list, varsArg, ctx) {
    const eqs = list.items;
    let vars;
    if (varsArg) vars = (varsArg.type === 'list' ? varsArg.items : [varsArg]).map(symName);
    else {
      const s = new Set();
      eqs.forEach(e => C.symbols(e).forEach(k => s.add(k)));
      vars = [...s].filter(k => k !== 'constnone').sort((a, b) => {
        const o = ['x', 'y', 'z'];
        const ia = o.indexOf(a), ib = o.indexOf(b);
        return (ia < 0 ? 9 : ia) - (ib < 0 ? 9 : ib) || (a < b ? -1 : 1);
      }).slice(0, eqs.length);
    }
    const c2 = bind(ctx, vars);
    const es = eqs.map(e => (e.type === 'rel' ? '(' + T(e.a, c2) + ')-(' + T(e.b, c2) + ')' : T(e, c2)));
    if (es.length === vars.length && es.every(e => isLinearIn(e, vars))) {
      const A = es.map(e => vars.map(v => N('diff(' + e + ',' + v + ')').toString()));
      const zero = {};
      vars.forEach(v => { zero[v] = '0'; });
      const b = es.map(e => '-(' + N(e, zero).toString() + ')');
      const det = N('determinant(matrix(' + A.map(r => '[' + r.join(',') + ']').join(',') + '))').toString();
      if (det === '0') throw ME('No Solution / Infinitely many');
      const sol = N('invert(matrix(' + A.map(r => '[' + r.join(',') + ']').join(',') + '))*matrix(' + b.map(x => '[' + x + ']').join(',') + ')');
      const m = parseOut(sol.toString());
      const vals = m.type === 'matrix' ? m.rows.map(r => r[0]) : m.items;
      return { type: 'list', items: vars.map((v, i) => ({ type: 'rel', op: '=', a: varSym(v), b: tidy(N(T(vals[i], { angle: 'rad' }) + '')) })) };
    }
    const real = ctx.env.settings.complex === 'real';
    let sets = null;
    try { sets = eliminate(es, vars, real); } catch (e) { sets = null; }
    if (sets === null) {
      let r;
      try { r = nerdamer.solveEquations(es.map(e => e + '=0')); }
      catch (e) { throw ME('Too Complicated'); }
      if (!r || !r.length) return TEXT('No Solution');
      sets = [{}];
      r.forEach(pair => { sets[0][String(pair[0])] = String(pair[1]); });
    }
    if (!sets.length) return TEXT('No Solution');
    const toRels = st => ({
      type: 'list', items: vars.map(v => {
        const val = st[v];
        let b = parseOut(val);
        if (/\./.test(val)) { const fv = parseFloat(val); b = recognize(fv, 1e-10) || floatAst(fv); }
        return { type: 'rel', op: '=', a: varSym(v), b };
      })
    });
    if (sets.length === 1) return toRels(sets[0]);
    return { type: 'list', items: sets.map(toRels) };
  }

  // Einsetzungsverfahren: Gleichung suchen, die in einer Variablen linear (oder loesbar) ist
  function eliminate(es, vars, real) {
    if (vars.length === 1) {
      const v = vars[0];
      const r = parseOut(nerdamer.solve(es[0] + '=0', v).toString());
      let sols = (r.type === 'vec' ? r.items : [r]).map(a => N(T(a, { angle: 'rad' })).toString());
      if (real) sols = sols.filter(s => !/\bi\b/.test(s));
      // uebrige Gleichungen pruefen
      sols = sols.filter(sv => es.slice(1).every(e => {
        const chk = numericValue(parseOut(N(e, { [v]: '(' + sv + ')' }).toString()));
        return isNaN(chk) || Math.abs(chk) < 1e-9;
      }));
      const uniq = [];
      sols.forEach(sv => { if (uniq.indexOf(sv) < 0) uniq.push(sv); });
      return uniq.map(sv => ({ [v]: sv }));
    }
    let pick = null;
    outer: for (let i = 0; i < es.length; i++) {
      for (const v of vars) {
        if (!new RegExp('\\b' + v + '\\b').test(es[i])) continue;
        const d1 = N('diff(' + es[i] + ',' + v + ')').toString();
        if (d1 !== '0' && N('diff(' + d1 + ',' + v + ')').toString() === '0') { pick = { i, v }; break outer; }
      }
    }
    if (!pick) return null;
    const expr = N(nerdamer.solve(es[pick.i] + '=0', pick.v).toString()).toString().replace(/^\[|\]$/g, '').split(',')[0];
    const rest = es.filter((e, k) => k !== pick.i).map(e => N(e, { [pick.v]: '(' + expr + ')' }).toString());
    const others = vars.filter(v => v !== pick.v);
    const sub = eliminate(rest.length ? rest : ['0'], others, real);
    if (sub === null) return null;
    return sub.map(st => {
      const subs = {};
      others.forEach(v => { subs[v] = '(' + st[v] + ')'; });
      return Object.assign({}, st, { [pick.v]: N(expr, subs).toString() });
    }).sort((p, q) => numericValue(parseOut(p[vars[0]])) - numericValue(parseOut(q[vars[0]])));
  }

  CMD.solve = (args, ctx) => {
    if (!args.length) throw ME('Argument ERROR');
    const e = args[0];
    if (e.type === 'list') return solveSystem(red(e, ctx), args[1], ctx);
    const x = pickVar(e, args[1]);
    const c2 = bind(ctx, [x]);
    return solveSingle(red(e, c2), x, c2);
  };
  CMD.approx = (args, ctx) => ({ type: 'approx', a: evalFull(args[0], ctx) });

  function wrap1(name, needVar) {
    return (args, ctx) => {
      const a = red(args[0], ctx);
      const ap = x => {
        if (x.type === 'list') return { type: 'list', items: x.items.map(ap) };
        if (x.type === 'rel') return { type: 'rel', op: x.op, a: ap(x.a), b: ap(x.b) };
        let extra = '';
        if (needVar) extra = ',' + (args[1] ? symName(args[1]) : pickVar(x));
        return tidy(N(name + '(' + T(x, ctx) + extra + ')'));
      };
      return ap(a);
    };
  }
  CMD.simplify = wrap1('simplify');
  CMD.combine = wrap1('simplify');
  CMD.expand = wrap1('expand');
  CMD.tExpand = wrap1('expand');
  CMD.factor = wrap1('factor');
  CMD.partfrac = wrap1('partfrac', true);
  CMD.propFrac = wrap1('partfrac', true);

  CMD.diff = (args, ctx) => {
    const x = pickVar(args[0], args[1]);
    const c2 = bind(ctx, [x]);
    const f = red(args[0], c2);
    const n = args[2] ? numericValue(red(args[2], ctx)) : 1;
    if (!Number.isInteger(n) || n < 0) throw ME('Argument ERROR');
    // d/dx an einer Stelle: diff(f, x, n, a)
    let r = N('diff(' + T(f, c2) + ',' + x + ',' + n + ')');
    if (args[3]) r = N(r.toString(), { [x]: T(red(args[3], ctx), ctx) });
    return tidy(r);
  };

  function numIntegral(fAst, x, a, b, ctx) {
    const f = NUM.compile(fAst, [x], { angle: 'rad', values: {} });
    const v = NUM.integrate(f, a, b);
    if (!isFinite(v)) throw ME('Undefined');
    return v;
  }
  CMD.integrate = (args, ctx, node) => {
    const x = pickVar(args[0], args[1]);
    const c2 = bind(ctx, [x]);
    const f = red(args[0], c2);
    const fS = T(f, c2);
    let F = null;
    try {
      const r = N('integrate(' + fS + ',' + x + ')');
      if (!/integrate\(/.test(r.toString())) F = r.toString();
    } catch (e) { F = null; }
    if (args.length < 3) {
      if (!F) return { type: 'call', name: 'integrate', args: [parseOut(N(fS).toString()), varSym(x)] };
      return tidy(N(F));
    }
    const aA = simp(red(args[2], ctx), ctx), bA = simp(red(args[3], ctx), ctx);
    const av = numericValue(aA), bv = numericValue(bA);
    const fAst = parseOut(N(fS).toString());
    if (C.symbols(fAst).size > 1 || (C.symbols(fAst).size === 1 && !C.symbols(fAst).has(x)) || !isFinite(av + bv) && (isNaN(av) || isNaN(bv))) {
      // symbolische Grenzen oder Parameter
      if (!F) throw ME('Too Complicated');
      return tidy(N('(' + F + ')').sub(x, T(bA, { angle: 'rad' })).subtract(N('(' + F + ')').sub(x, T(aA, { angle: 'rad' }))));
    }
    const nv = numIntegral(fAst, x, av, bv, ctx);
    if (F && (!isFinite(av) || !isFinite(bv)) && !isNaN(av) && !isNaN(bv)) {
      try {
        const at = (A, v) => (isFinite(v) ? N('(' + F + ')').sub(x, T(A, { angle: 'rad' })).toString() : N('limit(' + F + ',' + x + ',' + (v > 0 ? 'Infinity' : '-Infinity') + ')').toString());
        const hi = at(bA, bv), lo = at(aA, av);
        if (!/limit|Infinity|integrate/.test(hi + lo)) {
          const val = N('simplify((' + hi + ')-(' + lo + '))');
          const va = numericValue(parseOut(val.toString()));
          if (isFinite(va) && Math.abs(va - nv) <= 1e-9 * Math.max(1, Math.abs(nv))) return guard(tidy(val));
        }
      } catch (e) { /* numerisch */ }
    }
    if (F && isFinite(av) && isFinite(bv)) {
      try {
        const ex = N('(' + F + ')').sub(x, T(aA, { angle: 'rad' }));
        const ey = N('(' + F + ')').sub(x, T(bA, { angle: 'rad' }));
        const val = N('simplify((' + ey.toString() + ')-(' + ex.toString() + '))');
        const s = val.toString();
        if (!/erf|Si\(|Ci\(|Ei\(|integrate|limit/.test(s)) {
          const va = numericValue(parseOut(s));
          // Gegenprobe: Stammfunktion ueber Unstetigkeitsstellen hinweg liefert falsche Werte
          if (isFinite(va) && Math.abs(va - nv) <= 1e-9 * Math.max(1, Math.abs(nv))) return guard(tidy(val));
        }
      } catch (e) { /* numerisch */ }
    }
    return floatAst(nv);
  };

  CMD.lim = (args, ctx) => {
    const x = pickVar(args[0], args[1]);
    const c2 = bind(ctx, [x]);
    const fS = T(red(args[0], c2), c2);
    const aA = simp(red(args[2] || C.num(0), ctx), ctx);
    const aS = T(aA, { angle: 'rad' });
    const f = safeCompile(parseOut(N(fS).toString()), [x]);
    const a = numericValue(aA);
    try {
      const r = N('limit(' + fS + ',' + x + ',' + aS + ')');
      const s = r.toString();
      if (!/limit\(/.test(s)) {
        // Bei unendlichem Ergebnis an einer endlichen Stelle beide Seiten pruefen (1/x bei 0)
        if (/Infinity/.test(s) && isFinite(a) && f) {
          const l = f(a - 1e-9), rr = f(a + 1e-9);
          if (Math.sign(l) !== Math.sign(rr)) return TEXT('Undefined');
        }
        return guard(tidy(r));
      }
    } catch (e) { /* numerisch */ }
    if (!f) throw ME('Too Complicated');
    const side = s => {
      const vals = [];
      for (let k = 2; k <= 9; k++) {
        const xv = isFinite(a) ? a + s * Math.pow(10, -k) : s * Math.pow(10, k + 1);
        vals.push(f(xv));
      }
      const tail = vals.slice(-4).filter(isFinite);
      if (tail.length < 3) return NaN;
      const d1 = Math.abs(tail[tail.length - 1] - tail[tail.length - 2]);
      if (d1 > 1e-4 * Math.max(1, Math.abs(tail[tail.length - 1]))) {
        const last = tail[tail.length - 1];
        return Math.abs(last) > 1e6 ? Math.sign(last) * Infinity : NaN;
      }
      return tail[tail.length - 1];
    };
    const l = isFinite(a) ? side(-1) : a < 0 ? side(-1) : side(1);
    const rr = isFinite(a) ? side(1) : l;
    if (isNaN(l) || isNaN(rr) || Math.abs(l - rr) > 1e-5 * Math.max(1, Math.abs(l))) return TEXT('Undefined');
    if (!isFinite(l)) return l > 0 ? C.sym('Infinity') : { type: 'neg', a: C.sym('Infinity') };
    return recognize(l, 1e-7) || floatAst(l);
  };
  CMD.limit = CMD.lim;

  function polyDegree(fS, k) {
    for (let d = 0; d <= 12; d++) if (N('diff(' + fS + ',' + k + ',' + (d + 1) + ')').toString() === '0') return d;
    return -1;
  }
  CMD.sigma = (args, ctx) => {
    const k = symName(args[1]);
    const c2 = bind(ctx, [k]);
    const fS = T(red(args[0], c2), c2);
    const aA = simp(red(args[2], ctx), ctx), bA = simp(red(args[3], ctx), ctx);
    const aS = T(aA, { angle: 'rad' }), bS = T(bA, { angle: 'rad' });
    const av = numericValue(aA), bv = numericValue(bA);
    const numericBounds = isFinite(av) && isFinite(bv);
    if (numericBounds && Number.isInteger(av) && Number.isInteger(bv) && bv - av <= 2000) {
      if (bv < av) return C.num(0);
      return tidy(N('sum(' + fS + ',' + k + ',' + av + ',' + bv + ')'));
    }
    // Polynom in k: geschlossene Form per Interpolation
    if (Number.isInteger(av) && !(bv === Infinity)) {
      const d = polyDegree(fS, k);
      if (d >= 0) {
        const pts = [];
        let acc = '0';
        for (let m = 0; m <= d + 1; m++) {
          acc = N('(' + acc + ')+(' + N(fS, { [k]: String(av + m) }).toString() + ')').toString();
          pts.push([av + m, acc]);
        }
        let S = '0';
        pts.forEach(([xj, yj], j) => {
          let term = '(' + yj + ')';
          pts.forEach(([xi], i) => { if (i !== j) term += '*((__N)-(' + xi + '))/(' + (xj - xi) + ')'; });
          S += '+' + term;
        });
        const poly = N('factor(expand(' + S + '))').toString().replace(/__N/g, '(' + bS + ')');
        return tidy(N('factor(' + poly + ')'));
      }
      // geometrisch: f(k+1)/f(k) konstant
      try {
        const q = N('simplify((' + N(fS, { [k]: '(' + k + '+1)' }).toString() + ')/(' + fS + '))').toString();
        if (!new RegExp('\\b' + k + '\\b').test(q)) {
          const f0 = N(fS, { [k]: String(av) }).toString();
          const qv = numericValue(parseOut(q));
          if (bv === Infinity) {
            if (Math.abs(qv) >= 1) return C.sym('Infinity');
            return tidy(N('(' + f0 + ')/(1-(' + q + '))'));
          }
          return tidy(N('simplify((' + f0 + ')*(1-(' + q + ')^((' + bS + ')-(' + av + ')+1))/(1-(' + q + ')))'));
        }
      } catch (e) { /* weiter */ }
    }
    if ((numericBounds || bv === Infinity) && isFinite(av)) {
      const f = safeCompile(parseOut(N(fS).toString()), [k]);
      if (!f) throw ME('Too Complicated');
      if (bv !== Infinity) {
        let s = 0;
        for (let i = av; i <= bv; i++) s += f(i);
        return floatAst(s);
      }
      // Partialsummen + Richardson-Extrapolation, alternierende Reihen per Mittelwert
      const M = 200000;
      const part = [];
      let s = 0;
      for (let i = av, n = 1; n <= M + 1; i++, n++) { s += f(i); if (n === M / 2 || n === M / 2 + 1 || n === M || n === M + 1) part.push(s); }
      if (!part.every(isFinite)) return C.sym('Infinity');
      const alt = Math.sign(f(av + M)) !== Math.sign(f(av + M + 1));
      let v;
      if (alt) v = (part[2] + part[3]) / 2;
      else {
        const s1 = part[0], s2 = part[2];
        if (Math.abs(s2 - s1) > 1e-2 * Math.max(1, Math.abs(s2))) return C.sym('Infinity');
        v = 2 * s2 - s1;
      }
      return recognize(v, 1e-9) || floatAst(v);
    }
    return { type: 'call', name: 'sum', args: [parseOut(N(fS).toString()), varSym(k), aA, bA] };
  };
  CMD.pi_prod = (args, ctx) => {
    const k = symName(args[1]);
    const c2 = bind(ctx, [k]);
    const fS = T(red(args[0], c2), c2);
    const aA = simp(red(args[2], ctx), ctx), bA = simp(red(args[3], ctx), ctx);
    const av = numericValue(aA), bv = numericValue(bA);
    if (Number.isInteger(av) && Number.isInteger(bv) && bv - av <= 2000) {
      if (bv < av) return C.num(1);
      return tidy(N('product(' + fS + ',' + k + ',' + av + ',' + bv + ')'));
    }
    return { type: 'call', name: 'product', args: [parseOut(N(fS).toString()), varSym(k), aA, bA] };
  };

  // Listen-Summe vs. Σ
  CMD.sum = (args, ctx, node) => {
    if (args.length >= 4) return CMD.sigma(args, ctx);
    const L = evalFull(args[0], ctx);
    if (L.type !== 'list') throw ME('Wrong Argument Type');
    return simp(L.items.reduce((s, x) => C.bin('+', s, x), C.num(0)), ctx);
  };
  CMD.product = (args, ctx) => {
    if (args.length >= 4) return CMD.pi_prod(args, ctx);
    const L = evalFull(args[0], ctx);
    if (L.type !== 'list') throw ME('Wrong Argument Type');
    return simp(L.items.reduce((s, x) => C.bin('*', s, x), C.num(1)), ctx);
  };
  CMD.prod = CMD.product;

  function listArg(args, ctx) {
    const L = args.length === 1 ? evalFull(args[0], ctx) : { type: 'list', items: args.map(a => evalFull(a, ctx)) };
    if (L.type !== 'list' || !L.items.length) throw ME('Wrong Argument Type');
    return L.items;
  }
  CMD.mean = (args, ctx) => {
    const it = listArg(args, ctx);
    return simp(C.bin('/', it.reduce((s, x) => C.bin('+', s, x), C.num(0)), C.num(it.length)), ctx);
  };
  CMD.median = (args, ctx) => {
    const it = listArg(args, ctx).map(a => ({ a, v: numericValue(a) })).sort((p, q) => p.v - q.v);
    const n = it.length;
    if (n % 2) return it[(n - 1) / 2].a;
    return simp(C.bin('/', C.bin('+', it[n / 2 - 1].a, it[n / 2].a), C.num(2)), ctx);
  };
  CMD.max = (args, ctx) => listArg(args, ctx).reduce((m, a) => (numericValue(a) > numericValue(m) ? a : m));
  CMD.min = (args, ctx) => listArg(args, ctx).reduce((m, a) => (numericValue(a) < numericValue(m) ? a : m));
  CMD.dim = (args, ctx) => {
    const L = evalFull(args[0], ctx);
    if (L.type === 'list') return C.num(L.items.length);
    if (L.type === 'matrix') return { type: 'list', items: [C.num(L.rows.length), C.num(L.rows[0].length)] };
    throw ME('Wrong Argument Type');
  };
  CMD.sortA = (args, ctx) => ({ type: 'list', items: listArg(args, ctx).slice().sort((p, q) => numericValue(p) - numericValue(q)) });
  CMD.sortD = (args, ctx) => ({ type: 'list', items: listArg(args, ctx).slice().sort((p, q) => numericValue(q) - numericValue(p)) });
  CMD.variance = (args, ctx) => {
    const it = listArg(args, ctx).map(a => numericValue(a));
    const n = it.length, m = it.reduce((s, v) => s + v, 0) / n;
    return floatAst(it.reduce((s, v) => s + (v - m) ** 2, 0) / (n - 1));
  };
  CMD.stdDev = (args, ctx) => {
    const v = numericValue(CMD.variance(args, ctx));
    return floatAst(Math.sqrt(v));
  };
  CMD.seq = (args, ctx) => {
    const k = symName(args[1]);
    const a = numericValue(simp(red(args[2], ctx), ctx)), b = numericValue(simp(red(args[3], ctx), ctx));
    const st = args[4] ? numericValue(simp(red(args[4], ctx), ctx)) : 1;
    if (!(st > 0) || (b - a) / st > 999) throw ME('Argument ERROR');
    const items = [];
    const c2 = bind(ctx, [k]);
    for (let v = a; v <= b + 1e-12; v += st) items.push(simp(C.substitute(red(args[0], c2), k, C.num(+v.toPrecision(12))), ctx));
    return { type: 'list', items };
  };

  // Ganzzahl-Funktionen exakt mit BigInt
  function intArg(a, ctx) {
    const s = simp(red(a, ctx), ctx);
    if (s.type === 'num' && /^\d+$/.test(s.v)) return BigInt(s.v);
    if (s.type === 'neg' && s.a.type === 'num' && /^\d+$/.test(s.a.v)) return -BigInt(s.a.v);
    return null;
  }
  const bigAst = v => (v < 0n ? { type: 'neg', a: C.num((-v).toString()) } : C.num(v.toString()));
  function numericFallback(name, args, ctx) {
    const vals = args.map(a => numericValue(simp(red(a, ctx), ctx)));
    if (vals.some(v => !isFinite(v))) return { type: 'call', name, args: args.map(a => simp(red(a, ctx), ctx)) };
    const f = NUM.compile(C.call(name, vals.map(v => C.num(String(v)))), [], { angle: ctx.angle });
    const v = f();
    if (!isFinite(v)) return TEXT('Undefined');
    return Number.isInteger(v) && Math.abs(v) < 1e15 ? C.num(String(v)) : floatAst(v);
  }
  CMD.factorial = (args, ctx) => {
    const n = intArg(args[0], ctx);
    if (n !== null) {
      if (n < 0n) throw ME('Math ERROR');
      if (n > 5000n) throw ME('Too Complicated');
      let r = 1n;
      for (let i = 2n; i <= n; i++) r *= i;
      return C.num(r.toString());
    }
    return numericFallback('factorial', args, ctx);
  };
  CMD.nCr = (args, ctx) => {
    const n = intArg(args[0], ctx), r = intArg(args[1], ctx);
    if (n !== null && r !== null) {
      if (r < 0n || r > n) return C.num('0');
      let x = 1n;
      for (let i = 1n; i <= r; i++) x = x * (n - r + i) / i;
      return C.num(x.toString());
    }
    return numericFallback('nCr', args, ctx);
  };
  CMD.nPr = (args, ctx) => {
    const n = intArg(args[0], ctx), r = intArg(args[1], ctx);
    if (n !== null && r !== null) {
      if (r < 0n || r > n) return C.num('0');
      let x = 1n;
      for (let i = 0n; i < r; i++) x *= n - i;
      return C.num(x.toString());
    }
    return numericFallback('nPr', args, ctx);
  };
  CMD.gcd = (args, ctx) => {
    const v = args.map(a => intArg(a, ctx));
    if (v.every(x => x !== null)) return bigAst(v.reduce((a, b) => C.gcdBig(a, b)));
    return tidy(N('gcd(' + args.map(a => T(red(a, ctx), ctx)).join(',') + ')'));
  };
  CMD.lcm = (args, ctx) => {
    const v = args.map(a => intArg(a, ctx));
    if (v.every(x => x !== null)) return bigAst(v.reduce((a, b) => (a * b < 0n ? -(a * b) : a * b) / C.gcdBig(a, b)));
    return tidy(N('lcm(' + args.map(a => T(red(a, ctx), ctx)).join(',') + ')'));
  };
  CMD.mod = (args, ctx) => {
    const a = intArg(args[0], ctx), b = intArg(args[1], ctx);
    if (a !== null && b !== null && b !== 0n) return bigAst(((a % b) + b) % b);
    return numericFallback('mod', args, ctx);
  };
  ['floor', 'ceil', 'int', 'iPart', 'intg', 'sign', 'signum'].forEach(nm => {
    CMD[nm] = (args, ctx) => {
      const s = simp(red(args[0], ctx), ctx);
      if (C.symbols(s).size) return { type: 'call', name: nm, args: [s] };
      return numericFallback(nm, [s], ctx);
    };
  });
  CMD.frac = CMD.fPart = (args, ctx) => {
    const s = simp(red(args[0], ctx), ctx);
    if (C.symbols(s).size) return { type: 'call', name: 'fPart', args: [s] };
    const v = numericValue(s);
    return simp(C.bin('-', s, C.num(String(Math.trunc(v)))), ctx);
  };
  CMD.round = (args, ctx) => numericFallback('round', args, ctx);
  CMD.rand = () => floatAst(Math.random());
  CMD.randint = (args, ctx) => {
    const a = numericValue(simp(red(args[0], ctx), ctx)), b = numericValue(simp(red(args[1], ctx), ctx));
    return C.num(String(Math.floor(a + Math.random() * (b - a + 1))));
  };
  CMD.arg = (args, ctx) => {
    const s = simp(red(args[0], ctx), ctx);
    const re = parseOut(N('realpart(' + T(s, ctx) + ')').toString()), im = parseOut(N('imagpart(' + T(s, ctx) + ')').toString());
    const rv = numericValue(re), iv = numericValue(im);
    if (!isFinite(rv) || !isFinite(iv)) return { type: 'call', name: 'arg', args: [s] };
    const ang = Math.atan2(iv, rv) / ({ rad: 1, deg: Math.PI / 180, gra: Math.PI / 200 }[ctx.angle]);
    return recognize(ang, 1e-12) || floatAst(ang);
  };
  function fExt(max) {
    return (args, ctx) => {
      const x = pickVar(args[0], args[1]);
      const c2 = bind(ctx, [x]);
      const fAst = parseOut(N(T(red(args[0], c2), c2)).toString());
      const f = NUM.compile(fAst, [x], { angle: 'rad', values: {} });
      const a = args[2] ? numericValue(simp(red(args[2], ctx), ctx)) : -1e3;
      const b = args[3] ? numericValue(simp(red(args[3], ctx), ctx)) : 1e3;
      const cand = NUM.extrema(f, a, b, max, 20000);
      [a, b].forEach(v => { if (isFinite(v) && isFinite(f(v))) cand.push({ x: v, y: f(v) }); });
      if (!cand.length) return TEXT('No Solution');
      const best = cand.reduce((m, p) => ((max ? p.y > m.y : p.y < m.y) ? p : m));
      const lab = max ? 'MaxValue' : 'MinValue';
      return { type: 'list', items: [{ type: 'rel', op: '=', a: TEXT(lab), b: recognize(best.y, 1e-9) || floatAst(best.y) }, { type: 'rel', op: '=', a: varSym(x), b: recognize(best.x, 1e-7) || floatAst(best.x) }] };
    };
  }
  CMD.fMax = fExt(true);
  CMD.fMin = fExt(false);

  CMD.define = (args, ctx) => {
    const r = args[0];
    if (!r || r.type !== 'rel' || r.op !== '=' || r.a.type !== 'call') throw ME('Syntax ERROR');
    const params = r.a.args.map(symName);
    const name = r.a.name;
    if (C.FUNCS.has(name)) throw ME('Invalid Name');
    ctx.env.fns[name] = { params: params.map(p => (p === 'theta' ? 'θ' : p)), body: r.b };
    ctx.env.userFns.add(name);
    return TEXT('done');
  };

  /* ---------- Einstieg ---------- */
  // env: { settings:{angle, decimal, complex, fmt}, vars:{}, fns:{}, userFns:Set, ans: AST|null }
  function evaluate(input, env) {
    if (input.type === 'store') {
      const r = evaluate(input.a, env);
      if (isText(r.ast)) throw ME('Wrong Argument Type');
      env.vars[input.name] = r.exact || r.ast;
      return r;
    }
    const ctx = mkCtx(env);
    let r = red(input, ctx);
    let forceDec = false;
    if (r.type === 'approx') { r = r.a; forceDec = true; }
    r = simp(r, ctx);
    // Real-Modus: komplexe Ergebnisse sind ein Fehler, wenn die Eingabe kein i enthielt
    if (env.settings.complex === 'real' && !hasI(input) && hasI(r) && r.type !== 'list') throw ME('Non-Real in Calc');
    const exact = r;
    const dec = forceDec || env.settings.decimal || C.hasDecimal(input);
    if (dec) r = toDecimal(r);
    return { ast: r, exact, decimal: dec };
  }

  MP.cas = { evaluate, toDecimal, recognize, parseOut, mkCtx, red, simp, evalFull, CMD };
})(typeof window !== 'undefined' ? (window.MP = window.MP || {}) : (globalThis.MP = globalThis.MP || {}));

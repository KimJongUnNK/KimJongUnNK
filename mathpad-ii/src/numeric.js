/* MathPad II — Numerik: AST kompilieren, Nullstellen, Extrema, Integrale, Statistik */
(function (MP) {
  'use strict';
  const C = MP.core;

  function gamma(x) {
    if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gamma(1 - x));
    x -= 1;
    const g = 7, p = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
      -176.61503916999185, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    let a = p[0];
    const t = x + g + 0.5;
    for (let i = 1; i < g + 2; i++) a += p[i] / (x + i);
    return Math.sqrt(2 * Math.PI) * Math.pow(t, x + 0.5) * Math.exp(-t) * a;
  }
  function factorial(n) {
    if (Number.isInteger(n) && n >= 0) { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; }
    return gamma(n + 1);
  }
  function erf(x) {
    // Abramowitz-Stegun 7.1.26 reicht fuer Grafiken nicht; Reihenentwicklung + Kettenbruch
    const s = Math.sign(x); x = Math.abs(x);
    if (x < 3) {
      let sum = x, term = x, n = 0;
      while (Math.abs(term) > 1e-17 * Math.abs(sum) && n < 200) { n++; term *= -x * x / n; sum += term / (2 * n + 1); }
      return s * 2 / Math.sqrt(Math.PI) * sum;
    }
    const t = 1 / (1 + 0.5 * x);
    const y = 1 - t * Math.exp(-x * x - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
    return s * y;
  }
  function nCr(n, r) { if (r < 0 || r > n) return 0; let x = 1; for (let i = 1; i <= r; i++) x = x * (n - r + i) / i; return Math.round(x); }
  function nPr(n, r) { if (r < 0 || r > n) return 0; let x = 1; for (let i = 0; i < r; i++) x *= n - i; return x; }
  function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; }

  const ANG = { rad: 1, deg: Math.PI / 180, gra: Math.PI / 200 };

  /* AST -> JS-Funktion (Closure-Baum, kein eval). vars: Namen der Parameter.
     env: { angle, values:{name:Number}, fns:{name:{params,body}} } */
  function compile(ast, vars, env) {
    env = env || {};
    const ang = ANG[env.angle || 'rad'];
    const idx = {};
    vars.forEach((v, i) => { idx[v] = i; });
    const values = env.values || {};
    function c(n) {
      switch (n.type) {
        case 'num': { const v = parseFloat(n.v.startsWith('.') ? '0' + n.v : n.v); return () => v; }
        case 'sym': {
          const k = n.name;
          if (k in idx) { const i = idx[k]; return a => a[i]; }
          if (k === 'pi') return () => Math.PI;
          if (k === 'e') return () => Math.E;
          if (k === 'Infinity') return () => Infinity;
          if (k === 'i') throw new C.MathError('Non-Real');
          if (k in values) { const v = values[k]; return () => v; }
          throw new C.MathError('Undefined variable ' + k);
        }
        case 'neg': { const a = c(n.a); return x => -a(x); }
        case 'fact': { const a = c(n.a); return x => factorial(a(x)); }
        case 'deg': { const a = c(n.a); const k = (Math.PI / 180) / ang; return x => a(x) * k; }
        case 'bin': {
          const a = c(n.a), b = c(n.b);
          switch (n.op) {
            case '+': return x => a(x) + b(x);
            case '-': return x => a(x) - b(x);
            case '*': return x => a(x) * b(x);
            case '/': return x => a(x) / b(x);
            case '^': return x => {
              const u = a(x), v = b(x);
              if (u < 0 && !Number.isInteger(v)) {
                // reelle ungerade Wurzeln negativer Zahlen: (-8)^(1/3) = -2
                const inv = 1 / v, r = Math.round(inv);
                if (Math.abs(inv - r) < 1e-9 && r % 2 !== 0) return -Math.pow(-u, v);
                return NaN;
              }
              return Math.pow(u, v);
            };
          }
          break;
        }
        case 'call': return callC(n);
        case 'rel': { const a = c(n.a), b = c(n.b); return x => a(x) - b(x); }
      }
      throw new C.MathError('Wrong Argument Type');
    }
    function callC(n) {
      const name = n.name;
      if (env.fns && env.fns[name]) {
        const f = env.fns[name];
        const sub = compile(f.body, f.params, env);
        const args = n.args.map(c);
        return x => sub(args.map(g => g(x)));
      }
      const A = n.args.map(c);
      const a = A[0], b = A[1];
      switch (name) {
        case 'sin': return x => Math.sin(a(x) * ang);
        case 'cos': return x => Math.cos(a(x) * ang);
        case 'tan': return x => { const v = a(x) * ang; const cs = Math.cos(v); return Math.abs(cs) < 1e-15 ? NaN : Math.sin(v) / cs; };
        case 'sec': return x => 1 / Math.cos(a(x) * ang);
        case 'csc': return x => 1 / Math.sin(a(x) * ang);
        case 'cot': return x => 1 / Math.tan(a(x) * ang);
        case 'asin': return x => Math.asin(a(x)) / ang;
        case 'acos': return x => Math.acos(a(x)) / ang;
        case 'atan': return x => Math.atan(a(x)) / ang;
        case 'sinh': return x => Math.sinh(a(x));
        case 'cosh': return x => Math.cosh(a(x));
        case 'tanh': return x => Math.tanh(a(x));
        case 'asinh': return x => Math.asinh(a(x));
        case 'acosh': return x => Math.acosh(a(x));
        case 'atanh': return x => Math.atanh(a(x));
        case 'ln': return x => Math.log(a(x));
        case 'log': return A.length === 2 ? x => Math.log(b(x)) / Math.log(a(x)) : x => Math.log10(a(x));
        case 'log10': return x => Math.log10(a(x));
        case 'logb': return x => Math.log(b(x)) / Math.log(a(x));
        case 'sqrt': return x => Math.sqrt(a(x));
        case 'root': return x => { const u = a(x), k = b(x); if (u < 0 && Math.round(k) % 2 === 1) return -Math.pow(-u, 1 / k); return Math.pow(u, 1 / k); };
        case 'exp': return x => Math.exp(a(x));
        case 'abs': return x => Math.abs(a(x));
        case 'sign': case 'signum': return x => Math.sign(a(x));
        case 'floor': return x => Math.floor(a(x));
        case 'ceil': return x => Math.ceil(a(x));
        case 'round': return A.length === 2 ? x => { const k = Math.pow(10, b(x)); return Math.round(a(x) * k) / k; } : x => Math.round(a(x));
        case 'int': case 'iPart': return x => Math.trunc(a(x));
        case 'intg': return x => Math.floor(a(x));
        case 'frac': case 'fPart': return x => { const v = a(x); return v - Math.trunc(v); };
        case 'factorial': return x => factorial(a(x));
        case 'gamma': return x => gamma(a(x));
        case 'nCr': return x => nCr(a(x), b(x));
        case 'nPr': return x => nPr(a(x), b(x));
        case 'mod': return x => { const u = a(x), v = b(x); return u - v * Math.floor(u / v); };
        case 'gcd': return x => gcd(a(x), b(x));
        case 'lcm': return x => { const u = a(x), v = b(x); return Math.abs(u * v) / gcd(u, v); };
        case 'erf': return x => erf(a(x));
        case 'max': return x => Math.max(...A.map(g => g(x)));
        case 'min': return x => Math.min(...A.map(g => g(x)));
        case 'constn': return () => 0;
      }
      throw new C.MathError('Wrong Argument Type');
    }
    const f = c(ast);
    return (...args) => { try { return f(args); } catch (e) { return NaN; } };
  }

  /* ---------- Nullstellen, Extrema, Integrale ---------- */
  function bisect(f, a, b, fa, fb) {
    for (let i = 0; i < 200; i++) {
      const m = (a + b) / 2, fm = f(m);
      if (fm === 0 || (b - a) / 2 < 1e-15 * Math.max(1, Math.abs(m))) return m;
      if (Math.sign(fm) === Math.sign(fa)) { a = m; fa = fm; } else { b = m; fb = fm; }
    }
    return (a + b) / 2;
  }
  function golden(f, a, b, max) {
    const g = (Math.sqrt(5) - 1) / 2;
    const s = max ? -1 : 1;
    let c = b - g * (b - a), d = a + g * (b - a);
    let fc = s * f(c), fd = s * f(d);
    for (let i = 0; i < 200 && Math.abs(b - a) > 1e-12 * Math.max(1, Math.abs(c)); i++) {
      if (fc < fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = s * f(c); }
      else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = s * f(d); }
    }
    return (a + b) / 2;
  }
  // Alle Nullstellen in [a,b], aufsteigend
  function roots(f, a, b, n) {
    n = n || 2000;
    const out = [];
    const h = (b - a) / n;
    let x0 = a, f0 = f(a);
    const push = r => {
      if (!isFinite(r)) return;
      if (out.some(z => Math.abs(z - r) < Math.max(1e-9, h * 1e-3))) return;
      out.push(r);
    };
    if (f0 === 0) push(a);
    for (let i = 1; i <= n; i++) {
      const x1 = a + i * h, f1 = f(x1);
      if (isFinite(f0) && isFinite(f1)) {
        if (f1 === 0) push(x1);
        else if (f0 * f1 < 0) {
          const r = bisect(f, x0, x1, f0, f1);
          // Polstellen (Vorzeichenwechsel ohne Nullstelle) aussortieren
          if (Math.abs(f(r)) < 1e-6 * Math.max(1, Math.abs(f0), Math.abs(f1))) push(r);
        }
      }
      // Beruehrstellen: |f| hat ein lokales Minimum nahe 0
      if (i >= 2) {
        const xm = x0, fm = f0, xl = x0 - h, fl = f(xl);
        if (isFinite(fl) && isFinite(fm) && isFinite(f1) && Math.abs(fm) < Math.abs(fl) && Math.abs(fm) < Math.abs(f1) && Math.sign(fl) === Math.sign(f1) && Math.sign(fm) === Math.sign(f1)) {
          const r = golden(x => Math.abs(f(x)), xl, x1, false);
          if (Math.abs(f(r)) < 1e-9) push(r);
        }
      }
      x0 = x1; f0 = f1;
    }
    return out.sort((p, q) => p - q);
  }
  // Lokale Extrema in [a,b]
  function extrema(f, a, b, max, n) {
    n = n || 1000;
    const out = [];
    const h = (b - a) / n;
    const s = max ? 1 : -1;
    let y0 = f(a), y1 = f(a + h);
    for (let i = 2; i <= n; i++) {
      const x2 = a + i * h, y2 = f(x2);
      if (isFinite(y0) && isFinite(y1) && isFinite(y2) && s * y1 >= s * y0 && s * y1 > s * y2) {
        const x = golden(f, x2 - 2 * h, x2, max);
        out.push({ x, y: f(x) });
      }
      y0 = y1; y1 = y2;
    }
    return out;
  }
  function simpson(f, a, b, eps, depth) {
    const c = (a + b) / 2, fa = f(a), fb = f(b), fc = f(c);
    const S = (b - a) / 6 * (fa + 4 * fc + fb);
    function rec(a, b, fa, fb, fc, S, eps, d) {
      const c = (a + b) / 2, l = (a + c) / 2, r = (c + b) / 2;
      const fl = f(l), fr = f(r);
      const L = (c - a) / 6 * (fa + 4 * fl + fc), Rr = (b - c) / 6 * (fc + 4 * fr + fb);
      if (d <= 0 || Math.abs(L + Rr - S) <= 15 * eps) return L + Rr + (L + Rr - S) / 15;
      return rec(a, c, fa, fc, fl, L, eps / 2, d - 1) + rec(c, b, fc, fb, fr, Rr, eps / 2, d - 1);
    }
    return rec(a, b, fa, fb, fc, S, eps || 1e-10, depth || 40);
  }
  // Gauss-Kronrod-freie, robuste Integration; unendliche Grenzen per Substitution
  function integrate(f, a, b) {
    if (a === b) return 0;
    if (a > b) return -integrate(f, b, a);
    if (!isFinite(a) || !isFinite(b)) {
      if (!isFinite(a) && !isFinite(b)) return integrate(f, -Infinity, 0) + integrate(f, 0, Infinity);
      if (!isFinite(b)) return simpson(t => { const x = a + t / (1 - t); const v = f(x) / ((1 - t) * (1 - t)); return isFinite(v) ? v : 0; }, 0, 1 - 1e-12, 1e-10, 50);
      return simpson(t => { const x = b - (1 - t) / t; const v = f(x) / (t * t); return isFinite(v) ? v : 0; }, 1e-12, 1, 1e-10, 50);
    }
    // Endpunkte mit Singularitaet minimal nach innen schieben
    const fa = f(a), fb = f(b);
    const e = (b - a) * 1e-12;
    const g = x => { const v = f(x); return isFinite(v) ? v : f(x + (x === a ? e : -e)); };
    if (!isFinite(fa) || !isFinite(fb)) return simpson(g, a + (isFinite(fa) ? 0 : e), b - (isFinite(fb) ? 0 : e), 1e-10, 50);
    return simpson(f, a, b, 1e-11, 45);
  }
  function derivative(f, x, h) {
    h = h || 1e-5 * Math.max(1, Math.abs(x));
    return (f(x - 2 * h) - 8 * f(x - h) + 8 * f(x + h) - f(x + 2 * h)) / (12 * h);
  }
  function derivative2(f, x) {
    const h = 1e-4 * Math.max(1, Math.abs(x));
    return (-f(x + 2 * h) + 16 * f(x + h) - 30 * f(x) + 16 * f(x - h) - f(x - 2 * h)) / (12 * h * h);
  }
  // Numerischer Gleichungsloeser fuer Num Solve: sucht in [lo,hi] beginnend bei x0
  function solveNear(f, x0, lo, hi) {
    if (!isFinite(lo)) lo = -1e10;
    if (!isFinite(hi)) hi = 1e10;
    let x = Math.min(hi, Math.max(lo, isFinite(x0) ? x0 : 0));
    for (let i = 0; i < 100; i++) {
      const fx = f(x);
      if (!isFinite(fx)) break;
      if (Math.abs(fx) < 1e-14) return x;
      const d = derivative(f, x);
      if (!isFinite(d) || d === 0) break;
      let nx = x - fx / d;
      if (nx < lo) nx = (x + lo) / 2;
      if (nx > hi) nx = (x + hi) / 2;
      if (Math.abs(nx - x) < 1e-15 * Math.max(1, Math.abs(x))) { x = nx; break; }
      x = nx;
    }
    if (Math.abs(f(x)) < 1e-9) return x;
    // Fallback: Nullstellensuche um x0 herum mit wachsendem Fenster
    for (let w = 1; w <= 1e10; w *= 10) {
      const a = Math.max(lo, x0 - w), b = Math.min(hi, x0 + w);
      const r = roots(f, a, b, 4000);
      if (r.length) return r.reduce((best, z) => (Math.abs(z - x0) < Math.abs(best - x0) ? z : best), r[0]);
      if (a === lo && b === hi) break;
    }
    return NaN;
  }

  /* ---------- Statistik ---------- */
  function quantile(sorted, p) {
    // ClassPad: Quartile als Median der unteren/oberen Haelfte
    const n = sorted.length;
    const med = a => { const m = a.length; return m % 2 ? a[(m - 1) / 2] : (a[m / 2 - 1] + a[m / 2]) / 2; };
    if (p === 0.5) return med(sorted);
    const half = Math.floor(n / 2);
    if (p === 0.25) return med(sorted.slice(0, half));
    return med(sorted.slice(n - half));
  }
  function oneVar(xs, fr) {
    fr = fr || xs.map(() => 1);
    const data = [];
    xs.forEach((x, i) => { for (let k = 0; k < fr[i]; k++) data.push(x); });
    const n = data.length;
    if (!n) throw new C.MathError('Dimension ERROR');
    const sx = data.reduce((s, v) => s + v, 0), sx2 = data.reduce((s, v) => s + v * v, 0);
    const mean = sx / n;
    const ss = data.reduce((s, v) => s + (v - mean) ** 2, 0);
    const sorted = data.slice().sort((a, b) => a - b);
    const counts = {};
    let best = 0;
    data.forEach(v => { counts[v] = (counts[v] || 0) + 1; best = Math.max(best, counts[v]); });
    const modes = Object.keys(counts).filter(k => counts[k] === best).map(Number).sort((a, b) => a - b);
    return {
      mean, sum: sx, sum2: sx2, popSD: Math.sqrt(ss / n), sampSD: n > 1 ? Math.sqrt(ss / (n - 1)) : NaN, n,
      min: sorted[0], q1: n > 1 ? quantile(sorted, 0.25) : sorted[0], med: quantile(sorted, 0.5),
      q3: n > 1 ? quantile(sorted, 0.75) : sorted[0], max: sorted[n - 1], mode: modes, modeN: modes.length, modeF: best
    };
  }
  function solveLinear(M, v) {
    const n = v.length;
    const A = M.map((r, i) => r.concat([v[i]]));
    for (let i = 0; i < n; i++) {
      let p = i;
      for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
      [A[i], A[p]] = [A[p], A[i]];
      if (Math.abs(A[i][i]) < 1e-300) throw new C.MathError('Math ERROR');
      for (let r = 0; r < n; r++) {
        if (r === i) continue;
        const k = A[r][i] / A[i][i];
        for (let c = i; c <= n; c++) A[r][c] -= k * A[i][c];
      }
    }
    return A.map((r, i) => r[n] / r[i]);
  }
  function polyFit(xs, ys, deg) {
    const m = deg + 1;
    const M = [], v = [];
    for (let i = 0; i < m; i++) {
      M.push([]);
      for (let j = 0; j < m; j++) M[i].push(xs.reduce((s, x) => s + Math.pow(x, i + j), 0));
      v.push(xs.reduce((s, x, k) => s + ys[k] * Math.pow(x, i), 0));
    }
    return solveLinear(M, v); // c0 + c1 x + ...
  }
  function corr(xs, ys) {
    const n = xs.length;
    const mx = xs.reduce((s, v) => s + v, 0) / n, my = ys.reduce((s, v) => s + v, 0) / n;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
    return sxy / Math.sqrt(sxx * syy);
  }
  function rsq(xs, ys, f) {
    const my = ys.reduce((s, v) => s + v, 0) / ys.length;
    let ssr = 0, sst = 0;
    ys.forEach((y, i) => { ssr += (y - f(xs[i])) ** 2; sst += (y - my) ** 2; });
    return { r2: 1 - ssr / sst, mse: ssr / Math.max(1, ys.length - 2) };
  }
  // Regressionen: liefert {name, formula, params:[[label,val]], f}
  function regression(type, xs, ys) {
    const n = xs.length;
    if (n < 2 || ys.length !== n) throw new C.MathError('Dimension ERROR');
    let f, params, formula, r, r2, mse;
    switch (type) {
      case 'linear': {
        const [b, a] = polyFit(xs, ys, 1);
        f = x => a * x + b; formula = 'y=a·x+b';
        r = corr(xs, ys); ({ r2, mse } = rsq(xs, ys, f));
        params = [['a', a], ['b', b], ['r', r], ['r²', r2], ['MSe', mse]];
        break;
      }
      case 'quad': case 'cubic': case 'quart': {
        const deg = { quad: 2, cubic: 3, quart: 4 }[type];
        if (n <= deg) throw new C.MathError('Dimension ERROR');
        const c = polyFit(xs, ys, deg).reverse();
        f = x => c.reduce((s, k) => s * x + k, 0);
        formula = { quad: 'y=a·x²+b·x+c', cubic: 'y=a·x³+b·x²+c·x+d', quart: 'y=a·x⁴+b·x³+c·x²+d·x+e' }[type];
        ({ r2, mse } = rsq(xs, ys, f));
        params = c.map((k, i) => ['abcde'[i], k]).concat([['r²', r2], ['MSe', mse]]);
        break;
      }
      case 'log': {
        if (xs.some(x => x <= 0)) throw new C.MathError('Math ERROR');
        const lx = xs.map(Math.log);
        const [a, b] = polyFit(lx, ys, 1);
        f = x => a + b * Math.log(x); formula = 'y=a+b·ln(x)';
        r = corr(lx, ys); ({ r2, mse } = rsq(xs, ys, f));
        params = [['a', a], ['b', b], ['r', r], ['r²', r * r], ['MSe', mse]];
        break;
      }
      case 'exp': case 'abexp': {
        if (ys.some(y => y <= 0)) throw new C.MathError('Math ERROR');
        const ly = ys.map(Math.log);
        const [c0, c1] = polyFit(xs, ly, 1);
        const a = Math.exp(c0);
        r = corr(xs, ly);
        if (type === 'exp') { f = x => a * Math.exp(c1 * x); formula = 'y=a·e^(b·x)'; params = [['a', a], ['b', c1]]; }
        else { const b = Math.exp(c1); f = x => a * Math.pow(b, x); formula = 'y=a·b^x'; params = [['a', a], ['b', b]]; }
        ({ mse } = rsq(xs, ys, f));
        params.push(['r', r], ['r²', r * r], ['MSe', mse]);
        break;
      }
      case 'power': {
        if (xs.some(x => x <= 0) || ys.some(y => y <= 0)) throw new C.MathError('Math ERROR');
        const lx = xs.map(Math.log), ly = ys.map(Math.log);
        const [c0, b] = polyFit(lx, ly, 1);
        const a = Math.exp(c0);
        f = x => a * Math.pow(x, b); formula = 'y=a·x^b';
        r = corr(lx, ly); ({ mse } = rsq(xs, ys, f));
        params = [['a', a], ['b', b], ['r', r], ['r²', r * r], ['MSe', mse]];
        break;
      }
      default: throw new C.MathError('Syntax ERROR');
    }
    return { type, formula, params, f };
  }

  MP.num = { compile, roots, extrema, integrate, derivative, derivative2, golden, bisect, solveNear, oneVar, regression, factorial, gamma, erf, nCr, nPr, polyFit, corr };
})(typeof window !== 'undefined' ? (window.MP = window.MP || {}) : (globalThis.MP = globalThis.MP || {}));

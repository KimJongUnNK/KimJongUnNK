/* MathPad II — Box-Modell fuer die 2D-Darstellung (Eingabe und Ausgabe teilen sich das Modell) */
(function (MP) {
  'use strict';
  const C = MP.core;

  // Anzahl Kindzeilen je Vorlage (in Lese-/Navigationsreihenfolge)
  const KIDS = { frac: 2, sqrt: 1, root: 2, sup: 1, abs: 1, logb: 2, int: 2, dint: 4, diff: 2, diff2: 2, lim: 3, sum: 4, prod: 4 };

  const B = {
    row(items, up) {
      const r = { items: [], up: up || null };
      (items || []).forEach(it => { it.row = r; r.items.push(it); });
      return r;
    },
    ch(v) { return { k: 'ch', v }; },
    fn(v) { return { k: 'fn', v }; },
    nm(v) { return { k: 'nm', v }; },
    // Vorlage mit Kindinhalten (Array von Item-Arrays)
    t(k, kids, extra) {
      const it = Object.assign({ k, c: [] }, extra || {});
      const n = k === 'mat' ? extra.r * extra.cols : KIDS[k];
      for (let i = 0; i < n; i++) it.c.push(B.row((kids && kids[i]) || [], it));
      return it;
    },
    chars(s) { return Array.from(s).map(c => B.ch(c)); },
    isT(it) { return it && it.k !== 'ch' && it.k !== 'fn' && it.k !== 'nm'; },
    empty(it) { return B.isT(it) && it.c.every(r => r.items.length === 0); },

    // Tiefe Kopie ohne Eltern-Zeiger, dann neu verlinken
    clone(items) { return B.fromJSON(B.toJSON(items)); },
    toJSON(items) {
      return items.map(it => {
        const o = { k: it.k };
        if (it.v !== undefined) o.v = it.v;
        if (it.r !== undefined) { o.r = it.r; o.cols = it.cols; }
        if (it.c) o.c = it.c.map(r => B.toJSON(r.items));
        return o;
      });
    },
    fromJSON(arr) {
      return arr.map(o => {
        if (!o.c) return { k: o.k, v: o.v };
        const it = { k: o.k, c: [] };
        if (o.r !== undefined) { it.r = o.r; it.cols = o.cols; }
        o.c.forEach(items => it.c.push(B.row(B.fromJSON(items), it)));
        return it;
      });
    },

    /* ---------- Zeile -> Tokens -> AST ---------- */
    tokens(row, userFns) {
      const out = [];
      const items = row.items;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.k === 'ch') {
          const c = it.v;
          if (/[0-9.]/.test(c)) {
            let s = c, j = i + 1;
            while (j < items.length && items[j].k === 'ch' && /[0-9.]/.test(items[j].v)) s += items[j++].v;
            // Exponent per EXP-Taste: 1.5ᴇ-3
            if (j < items.length && items[j].k === 'ch' && items[j].v === 'ᴇ') {
              let k = j + 1, e = '';
              if (items[k] && items[k].k === 'ch' && /[-−+]/.test(items[k].v)) { e = items[k].v === '+' ? '' : '-'; k++; }
              let d = '';
              while (k < items.length && items[k].k === 'ch' && /[0-9]/.test(items[k].v)) d += items[k++].v;
              if (!d) throw new C.MathError('Syntax ERROR');
              s += 'e' + e + d;
              j = k;
            }
            if ((s.match(/\./g) || []).length > 1 || s === '.') throw new C.MathError('Syntax ERROR');
            out.push({ t: 'num', v: s });
            i = j - 1;
            continue;
          }
          if (c === 'ᴇ') {
            // ᴇ ohne Mantisse: 1ᴇ3 wie bei ClassPad
            out.push({ t: 'num', v: '1' });
            let k = i + 1, e = '';
            if (items[k] && items[k].k === 'ch' && /[-−+]/.test(items[k].v)) { e = items[k].v === '+' ? '' : '-'; k++; }
            let d = '';
            while (k < items.length && items[k].k === 'ch' && /[0-9]/.test(items[k].v)) d += items[k++].v;
            if (!d) throw new C.MathError('Syntax ERROR');
            out[out.length - 1].v = '1e' + e + d;
            i = k - 1;
            continue;
          }
          if (/[A-Za-z]/.test(c)) { out.push({ t: 'id', v: c }); continue; }
          if (c === 'π') { out.push({ t: 'id', v: 'pi' }); continue; }
          if (c === '∞') { out.push({ t: 'id', v: 'Infinity' }); continue; }
          if (c === 'θ') { out.push({ t: 'id', v: 'θ' }); continue; }
          const tk = C.tokenizeString(c);
          out.push(...tk);
          continue;
        }
        if (it.k === 'fn') { out.push({ t: 'fn', v: it.v }); continue; }
        if (it.k === 'nm') { out.push({ t: 'id', v: it.v === 'Define' ? 'define' : it.v }); continue; }
        if (it.k === 'sup') { out.push({ t: 'sup', ast: B.parse(it.c[0], userFns) }); continue; }
        out.push({ t: 'atom', ast: B.tplAst(it, userFns) });
      }
      return out;
    },
    parse(row, userFns) { return C.parseTokens(B.tokens(row, userFns), userFns); },
    tplAst(it, userFns) {
      const P = r => B.parse(r, userFns);
      const V = r => {
        const a = P(r);
        if (a.type !== 'sym') throw new C.MathError('Syntax ERROR');
        return a;
      };
      const c = it.c;
      switch (it.k) {
        case 'frac': return { type: 'bin', op: '/', a: P(c[0]), b: P(c[1]), frac: true };
        case 'sqrt': return C.call('sqrt', [P(c[0])]);
        case 'root': return C.call('root', [P(c[1]), P(c[0])]);
        case 'abs': return C.call('abs', [P(c[0])]);
        case 'logb': return C.call('logb', [P(c[0]), P(c[1])]);
        case 'int': return C.call('integrate', [P(c[0]), V(c[1])]);
        case 'dint': return C.call('integrate', [P(c[2]), V(c[3]), P(c[0]), P(c[1])]);
        case 'diff': return C.call('diff', [P(c[1]), V(c[0])]);
        case 'diff2': return C.call('diff', [P(c[1]), V(c[0]), C.num(2)]);
        case 'lim': return C.call('lim', [P(c[2]), V(c[0]), P(c[1])]);
        case 'sum': return C.call('sigma', [P(c[3]), V(c[0]), P(c[1]), P(c[2])]);
        case 'prod': return C.call('pi_prod', [P(c[3]), V(c[0]), P(c[1]), P(c[2])]);
        case 'mat': {
          const rows = [];
          for (let i = 0; i < it.r; i++) rows.push(c.slice(i * it.cols, (i + 1) * it.cols).map(P));
          return C.mkMatrix(rows);
        }
      }
      throw new C.MathError('Syntax ERROR');
    },

    /* ---------- Zeile -> linearer Text (Kopieren) ---------- */
    text(row) {
      const T = r => B.text(r);
      return row.items.map(it => {
        if (it.k === 'ch') return it.v === '·' ? '*' : it.v === '×' ? '*' : it.v === '÷' ? '/' : it.v === '−' ? '-' : it.v;
        if (it.k === 'fn') return (it.v === 'log10' ? 'log' : it.v) + '(';
        if (it.k === 'nm') return it.v === 'Define' ? 'Define ' : it.v;
        const c = it.c;
        switch (it.k) {
          case 'frac': return '(' + T(c[0]) + ')/(' + T(c[1]) + ')';
          case 'sqrt': return 'sqrt(' + T(c[0]) + ')';
          case 'root': return 'root(' + T(c[1]) + ',' + T(c[0]) + ')';
          case 'sup': return '^(' + T(c[0]) + ')';
          case 'abs': return 'abs(' + T(c[0]) + ')';
          case 'logb': return 'log(' + T(c[0]) + ',' + T(c[1]) + ')';
          case 'int': return 'integrate(' + T(c[0]) + ',' + T(c[1]) + ')';
          case 'dint': return 'integrate(' + T(c[2]) + ',' + T(c[3]) + ',' + T(c[0]) + ',' + T(c[1]) + ')';
          case 'diff': return 'diff(' + T(c[1]) + ',' + T(c[0]) + ')';
          case 'diff2': return 'diff(' + T(c[1]) + ',' + T(c[0]) + ',2)';
          case 'lim': return 'lim(' + T(c[2]) + ',' + T(c[0]) + ',' + T(c[1]) + ')';
          case 'sum': return 'sum(' + T(c[3]) + ',' + T(c[0]) + ',' + T(c[1]) + ',' + T(c[2]) + ')';
          case 'prod': return 'product(' + T(c[3]) + ',' + T(c[0]) + ',' + T(c[1]) + ',' + T(c[2]) + ')';
          case 'mat': {
            let s = '[';
            for (let i = 0; i < it.r; i++) s += '[' + c.slice(i * it.cols, (i + 1) * it.cols).map(T).join(',') + ']';
            return s + ']';
          }
        }
        return '';
      }).join('');
    },

    /* ---------- Rendering ---------- */
    render(row, opts) {
      opts = opts || {};
      const el = document.createElement('span');
      el.className = 'm-row';
      el.__row = row;
      const cur = opts.cur;
      const items = row.items;
      if (!items.length && opts.edit) {
        if (cur && cur.row === row) el.appendChild(B.curEl());
        const ph = document.createElement('span');
        ph.className = 'm-ph';
        ph.__row = row;
        el.appendChild(ph);
        el.classList.add('m-empty');
        return el;
      }
      for (let i = 0; i < items.length; i++) {
        if (cur && cur.row === row && cur.idx === i) el.appendChild(B.curEl());
        const ie = B.renderItem(items[i], opts);
        ie.__it = items[i];
        ie.__idx = i;
        el.appendChild(ie);
      }
      if (cur && cur.row === row && cur.idx === items.length) el.appendChild(B.curEl());
      return el;
    },
    curEl() {
      const c = document.createElement('span');
      c.className = 'm-cur';
      return c;
    },
    span(cls, text) {
      const s = document.createElement('span');
      if (cls) s.className = cls;
      if (text !== undefined) s.textContent = text;
      return s;
    },
    renderItem(it, opts) {
      const S = B.span, R = r => B.render(r, opts);
      const c = it.c;
      switch (it.k) {
        case 'ch': {
          const v = it.v;
          if (v === 'ᴇ') return S('m-c m-expk', 'E');
          if ('+−-=<>≤≥≠⇒'.indexOf(v) >= 0) return S('m-c m-op', v === '-' ? '−' : v);
          if (v === '*' || v === '×') return S('m-c m-op', '×');
          if (v === '÷') return S('m-c m-op', '÷');
          if (v === '·') return S('m-c m-dot', '·');
          if (v === ',') return S('m-c m-comma', ',');
          if (/[A-Za-zθ]/.test(v)) return S('m-c m-var', v);
          return S('m-c', v);
        }
        case 'fn': {
          const e = S('m-c m-fn', C.FN_SHOW[it.v] || it.v);
          e.appendChild(S('m-lp', '('));
          return e;
        }
        case 'nm': return S('m-c m-fn' + (it.v === 'Define' ? ' m-kw' : ''), it.v);
        case 'frac': {
          const e = S('m-frac');
          const n = S('m-num'); n.appendChild(R(c[0]));
          const d = S('m-den'); d.appendChild(R(c[1]));
          e.append(n, d);
          return e;
        }
        case 'sqrt': return B.radical(R(c[0]), null);
        case 'root': return B.radical(R(c[1]), R(c[0]));
        case 'sup': {
          const e = S('m-sup');
          e.appendChild(R(c[0]));
          return e;
        }
        case 'abs': {
          const e = S('m-abs');
          e.appendChild(R(c[0]));
          return e;
        }
        case 'logb': {
          const e = S('m-logb');
          const sub = S('m-sub'); sub.appendChild(R(c[0]));
          e.append(S('m-fn', 'log'), sub, S('m-c', '('), R(c[1]), S('m-c', ')'));
          return e;
        }
        case 'int': case 'dint': {
          const e = S('m-int');
          const sym = S('m-bigop');
          const s = S('m-intsym', '∫');
          sym.appendChild(s);
          if (it.k === 'dint') {
            const lim = S('m-intlims');
            const hi = S('m-hi'); hi.appendChild(R(c[1]));
            const lo = S('m-lo'); lo.appendChild(R(c[0]));
            lim.append(hi, lo);
            sym.appendChild(lim);
          }
          const body = it.k === 'dint' ? c[2] : c[0], v = it.k === 'dint' ? c[3] : c[1];
          e.append(sym, R(body), S('m-c m-d', 'd'), R(v));
          return e;
        }
        case 'diff': case 'diff2': {
          const e = S('m-diffw');
          const f = S('m-frac');
          const n = S('m-num', it.k === 'diff2' ? 'd²' : 'd');
          const d = S('m-den');
          d.append(S('m-c', 'd'), R(c[0]));
          if (it.k === 'diff2') d.append(S('m-sup', '2'));
          f.append(n, d);
          e.append(f, S('m-c', '('), R(c[1]), S('m-c', ')'));
          return e;
        }
        case 'lim': {
          const e = S('m-limw');
          const b = S('m-lim');
          const bot = S('m-limbot');
          bot.append(R(c[0]), S('m-c', '→'), R(c[1]));
          b.append(S('m-limtop', 'lim'), bot);
          e.append(b, R(c[2]));
          return e;
        }
        case 'sum': case 'prod': {
          const e = S('m-sumw');
          const b = S('m-big');
          const top = S('m-bigtop'); top.appendChild(R(c[2]));
          const bot = S('m-bigbot'); bot.append(R(c[0]), S('m-c', '='), R(c[1]));
          b.append(top, S('m-bigsym', it.k === 'sum' ? 'Σ' : 'Π'), bot);
          e.append(b, R(c[3]));
          return e;
        }
        case 'mat': {
          const e = S('m-mat');
          e.style.gridTemplateColumns = 'repeat(' + it.cols + ', auto)';
          c.forEach(r => { const cell = S('m-cell'); cell.appendChild(R(r)); e.appendChild(cell); });
          return e;
        }
      }
      return S('m-c', '?');
    },
    radical(body, index) {
      const e = B.span('m-sqrt');
      if (index) {
        const ix = B.span('m-idx');
        ix.appendChild(index);
        e.appendChild(ix);
      }
      const svgNS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('class', 'm-radsign');
      svg.setAttribute('viewBox', '0 0 10 30');
      svg.setAttribute('preserveAspectRatio', 'none');
      const p = document.createElementNS(svgNS, 'path');
      p.setAttribute('d', 'M0.5 18 L3 16.5 L6 29 L9.6 0.6');
      svg.appendChild(p);
      e.appendChild(svg);
      const rad = B.span('m-rad');
      rad.appendChild(body);
      e.appendChild(rad);
      return e;
    },
    // Klammern an hohe Inhalte anpassen (nach dem Einfuegen ins DOM aufrufen)
    stretchParens(root) {
      root.querySelectorAll('.m-row').forEach(rowEl => {
        const kids = Array.from(rowEl.children);
        const stack = [];
        const openOf = k => (k.classList.contains('m-fn') ? k.querySelector('.m-lp') : (k.classList.contains('m-c') && k.textContent === '(' ? k : null));
        kids.forEach((k, i) => {
          const op = openOf(k);
          if (op) { stack.push([i, op]); return; }
          if (!(k.classList.contains('m-c') && k.textContent === ')') || !stack.length) return;
          const [s, open] = stack.pop();
          let top = Infinity, bot = -Infinity;
          for (let j = s + 1; j < i; j++) {
            const r = kids[j].getBoundingClientRect();
            if (!r.height) continue;
            top = Math.min(top, r.top); bot = Math.max(bot, r.bottom);
          }
          const ref = k.getBoundingClientRect();
          if (isFinite(top) && bot - top > ref.height * 1.25) {
            const st = 'display:inline-block;transform:scaleY(' + ((bot - top) / ref.height).toFixed(2) + ');vertical-align:middle;';
            k.style.cssText = st;
            open.style.cssText = st;
          }
        });
      });
    }
  };

  MP.B = B;
  MP.KIDS = KIDS;
})(typeof window !== 'undefined' ? (window.MP = window.MP || {}) : (globalThis.MP = globalThis.MP || {}));

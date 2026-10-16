/* MathPad II — Financial: TVM, einfache Zinsen, Cash Flow, Tilgung, Zinsumrechnung, Marge, Tage, Abschreibung */
(function (MP) {
  'use strict';
  const App = MP.App, h = App.h;
  const fmt = v => (isFinite(v) ? MP.fmtShort(Math.abs(v) < 1e-12 ? 0 : v, 10) : 'ERROR');

  // Zinseszins nach Casio-Konvention: Auszahlungen negativ, PV·(1+r)^n + PMT·(1+r·S)·((1+r)^n−1)/r + FV = 0
  function tvmRate(Ipct, PY, CY) { const i = Ipct / 100; return Math.pow(1 + i / CY, CY / PY) - 1; }
  function tvmF(n, r, pv, pmt, fv, S) {
    if (Math.abs(r) < 1e-14) return pv + pmt * n + fv;
    const g = Math.pow(1 + r, n);
    return pv * g + pmt * (1 + r * S) * (g - 1) / r + fv;
  }
  function solveTVM(key, v) {
    const S = v.S, PY = v.PY || 1, CY = v.CY || 1;
    const r = tvmRate(v.I, PY, CY);
    const g = n => Math.pow(1 + r, n);
    switch (key) {
      case 'n': {
        if (Math.abs(r) < 1e-14) return -(v.PV + v.FV) / v.PMT;
        const a = v.PMT * (1 + r * S);
        return Math.log((a - v.FV * r) / (a + v.PV * r)) / Math.log(1 + r);
      }
      case 'PV': return Math.abs(r) < 1e-14 ? -(v.PMT * v.n + v.FV) : -(v.PMT * (1 + r * S) * (g(v.n) - 1) / r + v.FV) / g(v.n);
      case 'PMT': return Math.abs(r) < 1e-14 ? -(v.PV + v.FV) / v.n : -(v.PV * g(v.n) + v.FV) * r / ((1 + r * S) * (g(v.n) - 1));
      case 'FV': return Math.abs(r) < 1e-14 ? -(v.PV + v.PMT * v.n) : -(v.PV * g(v.n) + v.PMT * (1 + r * S) * (g(v.n) - 1) / r);
      case 'I': {
        const f = Ip => tvmF(v.n, tvmRate(Ip, PY, CY), v.PV, v.PMT, v.FV, S);
        let lo = -99.999, hi = 1000, flo = f(lo), fhi = f(hi);
        if (!(flo * fhi < 0)) {
          // Nullstelle nahe 0 suchen
          const rs = MP.num.roots(f, -50, 200, 5000);
          return rs.length ? rs[0] : NaN;
        }
        for (let k = 0; k < 300; k++) { const m = (lo + hi) / 2, fm = f(m); if (flo * fm <= 0) { hi = m; fhi = fm; } else { lo = m; flo = fm; } }
        return (lo + hi) / 2;
      }
    }
    return NaN;
  }
  function npv(rate, cfs) { return cfs.reduce((s, c, k) => s + c / Math.pow(1 + rate, k), 0); }
  function irr(cfs) {
    const f = r => npv(r / 100, cfs);
    const rs = MP.num.roots(f, -99, 1000, 20000);
    return rs.length ? rs[0] : NaN;
  }
  function daysBetween(a, b) {
    const p = s => { const m = /^(\d{1,4})-(\d{1,2})-(\d{1,2})$/.exec(String(s).trim()); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; };
    return Math.round((p(b) - p(a)) / 86400000);
  }

  // Formulare: Felder [key, Beschriftung, Startwert, loesbar?]
  const CALCS = {
    cmpd: {
      title: 'Compound Interest', fields: [['n', 'n (Perioden)', '60', 1], ['I', 'I% (Zins p. a.)', '4', 1], ['PV', 'PV (Barwert)', '-10000', 1], ['PMT', 'PMT (Rate)', '0', 1], ['FV', 'FV (Endwert)', '', 1], ['PY', 'P/Y', '12', 0], ['CY', 'C/Y', '12', 0], ['S', 'Zahlung (0 Ende, 1 Anfang)', '0', 0]],
      solve(key, v) { return { [key]: solveTVM(key, v) }; },
      hint: 'Ein Feld als Unbekannte wählen (Kreis) und „Solve“. Auszahlungen negativ, Einzahlungen positiv.'
    },
    simp: {
      title: 'Simple Interest', fields: [['n', 'Tage', '120', 0], ['I', 'I%', '7', 0], ['PV', 'PV (Kapital)', '-300', 0]],
      solve(key, v) { const si = -v.PV * v.I / 100 * v.n / 365; return { out: [['SI (Zinsen)', si], ['SFV (Endwert)', -(v.PV) + si]] }; },
      hint: 'Zinsbasis 365 Tage.'
    },
    conv: {
      title: 'Interest Conversion', fields: [['n', 'Zinsperioden/Jahr', '12', 0], ['APR', 'APR (nominal) %', '6', 1], ['EFF', 'EFF (effektiv) %', '', 1]],
      solve(key, v) {
        if (key === 'EFF') return { EFF: (Math.pow(1 + v.APR / 100 / v.n, v.n) - 1) * 100 };
        return { APR: v.n * (Math.pow(1 + v.EFF / 100, 1 / v.n) - 1) * 100 };
      }
    },
    margin: {
      title: 'Cost/Sell/Margin', fields: [['Cost', 'Cost (Einkauf)', '100', 1], ['Sell', 'Sell (Verkauf)', '', 1], ['Margin', 'Margin %', '20', 1]],
      solve(key, v) {
        if (key === 'Sell') return { Sell: v.Cost / (1 - v.Margin / 100) };
        if (key === 'Cost') return { Cost: v.Sell * (1 - v.Margin / 100) };
        return { Margin: (1 - v.Cost / v.Sell) * 100 };
      }
    },
    cash: {
      title: 'Cash Flow', fields: [['I', 'I% (Kalkulationszins)', '8', 0], ['CF', 'CF0, CF1, … (Komma)', '-1000, 300, 400, 500', 0]],
      text: { CF: 1 },
      solve(key, v) {
        const cfs = String(v.CF).split(/[;,]\s*/).map(x => MP.evalNum(x)).filter(x => isFinite(x));
        if (cfs.length < 2) throw new Error('Mindestens zwei Zahlungen');
        const r = v.I / 100;
        let acc = 0, pbp = NaN;
        for (let k = 0; k < cfs.length; k++) {
          const prev = acc;
          acc += cfs[k] / Math.pow(1 + r, k);
          if (prev < 0 && acc >= 0) { pbp = k - 1 + (-prev) / (acc - prev); break; }
        }
        const N = npv(r, cfs);
        return { out: [['NPV', N], ['IRR %', irr(cfs)], ['PBP (Amortisation)', pbp], ['NFV', N * Math.pow(1 + r, cfs.length - 1)]] };
      }
    },
    amort: {
      title: 'Amortization', fields: [['PM1', 'PM1 (von Rate)', '1', 0], ['PM2', 'PM2 (bis Rate)', '12', 0], ['n', 'n', '60', 0], ['I', 'I%', '4', 0], ['PV', 'PV', '-10000', 0], ['PMT', 'PMT (leer = berechnen)', '', 0], ['PY', 'P/Y', '12', 0], ['CY', 'C/Y', '12', 0]],
      solve(key, v) {
        const r = tvmRate(v.I, v.PY || 1, v.CY || 1);
        const pmt = isFinite(v.PMT) ? v.PMT : solveTVM('PMT', { n: v.n, I: v.I, PV: v.PV, FV: 0, PY: v.PY, CY: v.CY, S: 0 });
        let bal = v.PV, sInt = 0, sPrn = 0, int1 = NaN, prn1 = NaN;
        for (let k = 1; k <= v.PM2; k++) {
          const int = -bal * r, prn = pmt - int;
          bal = bal * (1 + r) + pmt;
          if (k === v.PM1) { int1 = int; prn1 = prn; }
          if (k >= v.PM1) { sInt += int; sPrn += prn; }
        }
        return { out: [['PMT', pmt], ['BAL nach PM2', bal], ['INT (Rate PM1)', int1], ['PRN (Rate PM1)', prn1], ['ΣINT PM1…PM2', sInt], ['ΣPRN PM1…PM2', sPrn]] };
      },
      hint: 'Vorzeichen wie Compound Interest: Kredit als negativer PV.'
    },
    days: {
      title: 'Day Count', fields: [['d1', 'Datum 1 (JJJJ-MM-TT)', '2026-01-15', 0], ['d2', 'Datum 2 (JJJJ-MM-TT)', '2026-10-12', 0]],
      text: { d1: 1, d2: 1 },
      solve(key, v) { const d = daysBetween(v.d1, v.d2); if (!isFinite(d)) throw new Error('Datum im Format JJJJ-MM-TT'); return { out: [['Tage', d], ['Wochen', d / 7]] }; }
    },
    depr: {
      title: 'Depreciation', fields: [['n', 'Nutzungsdauer (Jahre)', '6', 0], ['I', 'I% (für FP)', '25', 0], ['PV', 'Anschaffungswert', '150000', 0], ['FV', 'Restwert', '0', 0], ['j', 'Jahr j', '3', 0]],
      solve(key, v) {
        const sl = (v.PV - v.FV) / v.n;
        let fpBal = v.PV, fp = 0;
        for (let k = 1; k <= v.j; k++) { fp = fpBal * v.I / 100; fpBal -= fp; }
        const syd = (v.PV - v.FV) * (v.n - v.j + 1) / (v.n * (v.n + 1) / 2);
        return { out: [['SL (linear) Jahr j', sl], ['Restbuchwert SL', v.PV - sl * v.j], ['FP (degressiv) Jahr j', fp], ['Restbuchwert FP', fpBal], ['SYD (digital) Jahr j', syd]] };
      }
    }
  };
  const ORDER = [['simp', 'Simple Interest'], ['cmpd', 'Compound Interest'], ['cash', 'Cash Flow'], ['amort', 'Amortization'], ['conv', 'Interest Conversion'], ['margin', 'Cost/Sell/Margin'], ['days', 'Day Count'], ['depr', 'Depreciation']];

  const Fin = {
    title: 'Financial',
    statusKinds: [],
    init(saved) {
      this.calc = 'cmpd';
      this.vals = {};
      this.unknown = { cmpd: 'FV', conv: 'EFF', margin: 'Sell' };
      if (saved) {
        this.calc = CALCS[saved.calc] ? saved.calc : this.calc;
        this.vals = saved.vals || {};
        Object.assign(this.unknown, saved.unknown || {});
      }
    },
    save() { this.read(); return { calc: this.calc, vals: this.vals, unknown: this.unknown }; },
    editor() { return null; },
    mount(work) {
      this.box = h('div', { class: 'solv' });
      work.appendChild(h('div', { class: 'win active' }, this.box));
      this.render();
    },
    render() {
      const def = CALCS[this.calc];
      const V = this.vals[this.calc] = this.vals[this.calc] || {};
      this.box.textContent = '';
      this.box.appendChild(h('div', { class: 'eq', style: 'font-weight:700' }, def.title));
      def.fields.forEach(([k, l, init, solvable]) => {
        const r = h('input', { type: 'radio', name: 'fin-unk', 'aria-label': l + ' berechnen', disabled: solvable ? null : true });
        r.checked = this.unknown[this.calc] === k;
        if (!solvable) r.style.visibility = 'hidden';
        r.addEventListener('change', () => { this.unknown[this.calc] = k; App.save(); });
        const inp = h('input', { type: 'text', 'data-k': k, value: V[k] !== undefined ? V[k] : init, spellcheck: 'false', autocomplete: 'off', 'aria-label': l });
        this.box.appendChild(h('div', { class: 'vrow', style: 'grid-template-columns:18px 1fr 1.1fr' }, r, h('span', { text: l }), inp));
      });
      this.resEl = h('div', { class: 'res' });
      this.box.appendChild(this.resEl);
      if (def.hint) this.box.appendChild(h('div', { class: 'hint', text: def.hint }));
    },
    read() {
      if (!this.box) return;
      const V = this.vals[this.calc] = this.vals[this.calc] || {};
      this.box.querySelectorAll('input[data-k]').forEach(i => { V[i.dataset.k] = i.value; });
    },
    solve() {
      this.read();
      const def = CALCS[this.calc];
      const raw = this.vals[this.calc];
      const v = {};
      const key = this.unknown[this.calc];
      def.fields.forEach(([k]) => { v[k] = def.text && def.text[k] ? raw[k] : MP.evalNum(raw[k]); });
      for (const [k, l] of def.fields) {
        if (k === key || (def.text && def.text[k]) || (this.calc === 'amort' && k === 'PMT')) continue;
        if (!isFinite(v[k])) { App.error(l + ': Wert fehlt'); return; }
      }
      let res;
      try { res = def.solve(key, v); } catch (e) { App.error(e.message || 'Math ERROR'); return; }
      this.resEl.textContent = '';
      if (res.out) {
        res.out.forEach(([l, x]) => this.resEl.appendChild(h('div', null, h('b', { text: l + ' = ' }), typeof x === 'number' ? fmt(x) : String(x))));
      } else {
        Object.keys(res).forEach(k => {
          const x = res[k];
          const inp = this.box.querySelector('input[data-k="' + k + '"]');
          if (inp) inp.value = isFinite(x) ? String(+x.toPrecision(10)) : '';
          this.resEl.appendChild(h('div', null, h('b', { text: k + ' = ' }), fmt(x)));
        });
        this.read();
      }
      App.save();
    },
    fieldEnter() { this.solve(); return true; },
    key(k, ins) {
      const a = document.activeElement;
      const inp = a && a.tagName === 'INPUT' && a.type === 'text' && this.box && this.box.contains(a) ? a : null;
      if (k === 'EXE') { this.solve(); return true; }
      if (inp) {
        if (k === 'UP' || k === 'DOWN') {
          const all = Array.from(this.box.querySelectorAll('input[type=text]'));
          const n = all[all.indexOf(inp) + (k === 'DOWN' ? 1 : -1)];
          if (n) n.focus();
          return true;
        }
        const s = inp.selectionStart, e = inp.selectionEnd;
        if (k === 'BS') { inp.setRangeText('', s === e ? Math.max(0, s - 1) : s, e, 'end'); return true; }
        if (k === 'CLEAR') { inp.value = ''; return true; }
        if (ins && ins.t === 'ch') { inp.setRangeText(ins.v === '−' ? '-' : ins.v === 'ᴇ' ? 'E' : ins.v, s, e, 'end'); return true; }
        return true;
      }
      if (k === 'DOWN' || k === 'UP') { const f = this.box.querySelector('input[type=text]'); if (f) f.focus(); return true; }
      return true;
    },
    insert(act) {
      const a = document.activeElement;
      if (!(a && a.tagName === 'INPUT' && this.box.contains(a))) return true;
      if (act.t === 'ch') a.setRangeText(act.v === '−' ? '-' : act.v, a.selectionStart, a.selectionEnd, 'end');
      return true;
    },
    pick(id) { this.read(); this.calc = id; this.render(); App.refreshChrome(); App.save(); },
    menus() { return [{ label: 'Calc', items: ORDER.map(([id, l]) => ({ label: l, check: this.calc === id, action: () => this.pick(id) })) }]; },
    toolbar() {
      return [
        { label: 'Calc ▾', title: 'Berechnung wählen', menu: () => ORDER.map(([id, l]) => ({ label: l, check: this.calc === id, action: () => this.pick(id) })) },
        { label: 'Solve', title: 'Berechnen (EXE)', action: () => this.solve() },
        { label: 'Clear', title: 'Felder zurücksetzen', action: () => { this.vals[this.calc] = {}; this.render(); } }
      ];
    }
  };
  App.register('fin', Fin);
})(window.MP = window.MP || {});

/* MathPad II — E-CON EA-200: Messwerterfassung (Sensor-Setup, Live-Graph, Uebergabe an Statistics).
   Ohne angeschlossenen Datenlogger laeuft die Messung als physikalisch plausible Simulation. */
(function (MP) {
  'use strict';
  const App = MP.App, h = App.h, Plot = MP.Plot;
  const fmt = (v, d) => MP.fmtShort(v, d || 6);

  // Sensoren wie im Setup Wizard des EA-200; sim(t, r) liefert den Messwert zur Zeit t (r: Rauschen −1…1)
  const SENSORS = {
    motion: { name: 'Bewegung (Motion)', unit: 'm', dt: 0.05, n: 200, sim: (t, r) => 0.8 + 0.25 * Math.exp(-0.08 * t) * Math.cos(2 * Math.PI * 0.7 * t) + 0.003 * r, info: 'Federpendel vor dem Ultraschall-Sensor: gedämpfte Schwingung.' },
    temp: { name: 'Temperatur', unit: '°C', dt: 1, n: 120, sim: (t, r) => 22 + 63 * Math.exp(-0.035 * t) + 0.08 * r, info: 'Abkühlung von heißem Wasser (Newtonsches Abkühlungsgesetz).' },
    volt: { name: 'Spannung', unit: 'V', dt: 0.05, n: 160, sim: (t, r) => 5 * Math.exp(-t / 2.2) + 0.01 * r, info: 'Entladung eines Kondensators über einen Widerstand (τ = 2,2 s).' },
    light: { name: 'Licht', unit: 'lx', dt: 0.002, n: 150, sim: (t, r) => 380 + 140 * Math.abs(Math.sin(2 * Math.PI * 50 * t)) + 3 * r, info: 'Leuchtstofflampe am 50-Hz-Netz: Helligkeit flackert mit 100 Hz.' },
    sound: { name: 'Mikrofon (Schall)', unit: 'rel.', dt: 0.0001, n: 200, sim: (t, r) => Math.sin(2 * Math.PI * 440 * t) + 0.35 * Math.sin(2 * Math.PI * 880 * t + 0.6) + 0.02 * r, info: 'Stimmgabel a′ (440 Hz) mit Oberton.' }
  };
  const ORDER = ['motion', 'temp', 'volt', 'light', 'sound'];

  const E = {
    title: 'E-CON EA-200',
    statusKinds: [],
    init(saved) {
      this.sensor = 'motion';
      this.dt = SENSORS.motion.dt;
      this.n = SENSORS.motion.n;
      this.trig = 'exe';
      this.data = [];
      this.running = false;
      this.view = { xmin: 0, xmax: 10, xscl: 1, ymin: 0, ymax: 1.2, yscl: 0.2 };
      if (saved) {
        if (SENSORS[saved.sensor]) this.sensor = saved.sensor;
        if (saved.dt > 0) this.dt = saved.dt;
        if (saved.n > 0) this.n = saved.n;
        if (saved.trig) this.trig = saved.trig;
        if (Array.isArray(saved.data)) this.data = saved.data;
        if (saved.view) Object.assign(this.view, saved.view);
      }
    },
    save() { return { sensor: this.sensor, dt: this.dt, n: this.n, trig: this.trig, data: this.data.slice(0, 2000), view: this.view }; },
    editor() { return null; },
    mount(work) {
      this.split = h('div', { class: 'split' });
      this.wTop = h('div', { class: 'win active', style: 'flex:0 0 auto' });
      this.wBot = h('div', { class: 'win' });
      this.form = h('div', { class: 'solv econ' });
      this.wTop.append(h('div', { class: 'sheets' }, h('button', { type: 'button', class: 'on', text: 'Setup Wizard' })), this.form);
      this.gv = Plot.graphWin(this.wBot);
      Plot.bind(this.gv.wrap, this.gv.canvas, () => this.view, () => this.draw(), null);
      this.split.append(this.wTop, this.wBot);
      work.appendChild(this.split);
      this.renderForm();
      requestAnimationFrame(() => this.draw());
    },
    hide() { this.stop(); },
    layout() { requestAnimationFrame(() => this.draw()); },
    refresh() { this.renderForm(); this.draw(); },
    onScale() { this.draw(); },
    renderForm() {
      if (!this.form) return;
      const S = SENSORS[this.sensor];
      this.form.textContent = '';
      const sel = h('select', { id: 'ec-sensor', 'aria-label': 'Sensor' }, ORDER.map(k => h('option', { value: k, text: SENSORS[k].name, selected: k === this.sensor ? '' : null })));
      sel.value = this.sensor;
      sel.addEventListener('change', () => { this.sensor = sel.value; this.dt = SENSORS[this.sensor].dt; this.n = SENSORS[this.sensor].n; this.renderForm(); App.save(); });
      const num = (id, v, set) => {
        const i = h('input', { type: 'text', id, value: String(v), spellcheck: 'false', autocomplete: 'off' });
        i.addEventListener('change', () => { const x = MP.evalNum(i.value); if (isFinite(x) && x > 0) { set(x); App.save(); } else i.value = String(v); });
        return i;
      };
      const trig = h('select', { id: 'ec-trig', 'aria-label': 'Trigger' }, h('option', { value: 'exe', text: '[EXE]-Taste' }), h('option', { value: 'now', text: 'Sofort' }));
      trig.value = this.trig;
      trig.addEventListener('change', () => { this.trig = trig.value; App.save(); });
      const row = (l, el) => h('div', { class: 'erow' }, h('label', { for: el.id, text: l }), el);
      this.form.append(
        row('Sensor', sel),
        row('Intervall (s)', num('ec-dt', this.dt, x => { this.dt = x; })),
        row('Messwerte', num('ec-n', this.n, x => { this.n = Math.min(2000, Math.round(x)); })),
        row('Trigger', trig),
        h('div', { class: 'hint', text: S.info + ' Gesamtdauer ' + fmt(this.dt * this.n, 4) + ' s.' }),
        this.stEl = h('div', { class: 'estat' })
      );
      this.status();
    },
    status(txt) {
      if (!this.stEl) return;
      const S = SENSORS[this.sensor];
      this.stEl.textContent = txt || (this.running ? 'Messung läuft … ' + this.data.length + '/' + this.n
        : this.data.length ? this.data.length + ' Messwerte · ' + S.name + ' · Simulation (kein EA-200 angeschlossen)'
          : 'Bereit · Simulation (kein EA-200 angeschlossen)');
    },
    // Start: wartet bei Trigger [EXE] auf die Taste, sonst sofort
    arm() {
      if (this.running) return;
      if (this.trig === 'exe' && !this.armed) { this.armed = true; this.status('Zum Starten [EXE] drücken …'); return; }
      this.armed = false;
      this.start();
    },
    start() {
      const S = SENSORS[this.sensor], n = this.n, dt = this.dt;
      this.data = [];
      this.running = true;
      const tEnd = dt * (n - 1);
      Object.assign(this.view, { xmin: 0, xmax: tEnd || 1 });
      // y-Bereich vorab aus dem Verlauf schaetzen, damit der Live-Graph nicht springt
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < n; i++) { const v = S.sim(i * dt, 0); lo = Math.min(lo, v); hi = Math.max(hi, v); }
      const pad = (hi - lo) * 0.12 || 1;
      Object.assign(this.view, { ymin: lo - pad, ymax: hi + pad });
      Plot.niceScale(this.view);
      // Echtzeit ist bei langen Messungen zu langsam: hoechstens ca. 2,5 s Animation
      const perFrame = Math.max(1, Math.ceil(n / 150));
      let i = 0, seed = 12345;
      const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 1073741824 - 1; };
      const step = () => {
        if (!this.running) return;
        for (let k = 0; k < perFrame && i < n; k++, i++) { const t = +(i * dt).toPrecision(10); this.data.push([t, +S.sim(t, rnd()).toPrecision(8)]); }
        this.draw();
        this.status();
        if (i < n) this.raf = requestAnimationFrame(step);
        else { this.running = false; this.status(); App.save(); App.refreshChrome(); }
      };
      App.refreshChrome();
      this.raf = requestAnimationFrame(step);
    },
    stop() { if (this.running) { this.running = false; cancelAnimationFrame(this.raf); this.status(); App.refreshChrome(); } this.armed = false; },
    draw() {
      if (!this.gv) return;
      const s = Plot.setup(this.gv.canvas);
      if (!s) return;
      const { g, W, H } = s, P = App.pal();
      const t = Plot.axes(g, W, H, this.view);
      const S = SENSORS[this.sensor];
      if (this.data.length) {
        g.strokeStyle = P.curves[0]; g.lineWidth = 1.6; g.lineJoin = 'round';
        g.beginPath();
        this.data.forEach(([x, y], k) => (k ? g.lineTo(t.X(x), t.Y(y)) : g.moveTo(t.X(x), t.Y(y))));
        g.stroke();
        if (this.data.length < 120) { g.fillStyle = P.curves[0]; this.data.forEach(([x, y]) => { g.beginPath(); g.arc(t.X(x), t.Y(y), 1.8, 0, 2 * Math.PI); g.fill(); }); }
        const last = this.data[this.data.length - 1];
        this.gv.info.textContent = 't=' + fmt(last[0]) + ' s   ' + fmt(last[1]) + ' ' + S.unit;
      } else this.gv.info.textContent = '';
      this.gv.tag.textContent = S.name + ' [' + S.unit + '] über t [s]';
    },
    // Messreihe nach list1 (Zeit) und list2 (Messwert) der Statistics-App
    toLists(open) {
      if (!this.data.length) { App.message('E-CON', 'Noch keine Messwerte. Erst „Start“.'); return; }
      const st = App.apps.stat;
      st.lists[0] = this.data.map(d => d[0]);
      st.lists[1] = this.data.map(d => d[1]);
      Object.assign(st.sg, { type: 'scatter', x: 0, y: 1, f: -1 });
      App.save();
      if (open) App.open('stat');
      else App.message('E-CON', this.data.length + ' Messwerte nach list1 (t) und list2 (' + SENSORS[this.sensor].unit + ') übertragen.');
    },
    key(k) {
      if (k === 'EXE') { if (this.armed) this.arm(); else if (!this.running) this.arm(); return true; }
      if (k === 'ESC' || k === 'CLEAR') { this.stop(); this.status(); return true; }
      return false;
    },
    fieldEnter(t) { t.dispatchEvent(new Event('change')); t.blur(); return true; },
    menus() {
      return [
        { label: 'Setup', items: ORDER.map(k => ({ label: SENSORS[k].name, check: this.sensor === k, action: () => { this.sensor = k; this.dt = SENSORS[k].dt; this.n = SENSORS[k].n; this.renderForm(); App.save(); } })) },
        { label: 'Sample', items: [{ label: 'Start', action: () => this.arm() }, { label: 'Stopp', action: () => this.stop() }, { sep: true }, { label: 'Nach list1/list2', action: () => this.toLists(false) }, { label: 'In Statistics öffnen', action: () => this.toLists(true) }, { label: 'Messwerte löschen', action: () => { this.stop(); this.data = []; this.draw(); this.status(); App.save(); } }] }
      ];
    },
    toolbar() {
      return [
        this.running ? { label: '■ Stopp', title: 'Messung abbrechen', action: () => this.stop() } : { label: '▶ Start', title: 'Messung starten', action: () => this.arm() },
        { label: '→ Listen', title: 'Messwerte nach list1/list2', action: () => this.toLists(false) },
        { label: 'Statistics', title: 'In Statistics öffnen (Regression)', action: () => this.toLists(true) },
        { label: 'Zoom', title: 'Ganze Messung zeigen', action: () => this.autoView() }
      ];
    },
    autoView() {
      if (!this.data.length) return;
      const xs = this.data.map(d => d[0]), ys = this.data.map(d => d[1]);
      const lo = Math.min(...ys), hi = Math.max(...ys), pad = (hi - lo) * 0.12 || 1;
      Object.assign(this.view, { xmin: Math.min(...xs), xmax: Math.max(...xs) || 1, ymin: lo - pad, ymax: hi + pad });
      Plot.niceScale(this.view);
      this.draw();
    }
  };
  App.register('econ', E);
})(window.MP = window.MP || {});

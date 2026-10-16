/* MathPad II — Geometry: Konstruktionen mit Punkten, Strecken, Geraden, Kreisen, Polygonen und Messwerten */
(function (MP) {
  'use strict';
  const App = MP.App, h = App.h, Plot = MP.Plot, svg = App.svg;
  const fmt = v => MP.fmtShort(Math.abs(v) < 1e-10 ? 0 : v, 6);

  const TOOLS = [
    ['sel', 'Auswahl/Ziehen', svg('<path d="M5 3l10 6-4.5 1.5L13 16l-2 1-2.5-5.5L5 15z"/>')],
    ['pt', 'Punkt', svg('<circle cx="10" cy="10" r="2.5" fill="currentColor"/>')],
    ['seg', 'Strecke', svg('<path d="M4 15L16 5"/><circle cx="4" cy="15" r="1.6" fill="currentColor"/><circle cx="16" cy="5" r="1.6" fill="currentColor"/>')],
    ['line', 'Gerade', svg('<path d="M2 17L18 3"/><circle cx="7" cy="12.6" r="1.6" fill="currentColor"/><circle cx="13" cy="7.4" r="1.6" fill="currentColor"/>')],
    ['circ', 'Kreis', svg('<circle cx="10" cy="10" r="6.5"/><circle cx="10" cy="10" r="1.3" fill="currentColor"/>')],
    ['poly', 'Polygon/Dreieck', svg('<path d="M3 16L10 4l7 12z"/>')],
    ['mid', 'Mittelpunkt', svg('<path d="M3 15L17 5"/><circle cx="10" cy="10" r="2" fill="currentColor"/>')],
    ['isect', 'Schnittpunkt', svg('<path d="M3 4l14 12M3 16L17 4"/><circle cx="10" cy="10" r="1.8" fill="currentColor"/>')],
    ['del', 'Löschen', svg('<path d="M5 5l10 10M15 5L5 15"/>')]
  ];
  const NAMES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  // y = m·x + b lesbar: y=9, y=x−2, y=−0.5x+1
  const lineEq = (m, b) => {
    m = Math.abs(m) < 1e-10 ? 0 : m; b = Math.abs(b) < 1e-10 ? 0 : b;
    const mx = m === 0 ? '' : Math.abs(m - 1) < 1e-12 ? 'x' : Math.abs(m + 1) < 1e-12 ? '−x' : fmt(m).replace('-', '−') + 'x';
    const bs = b === 0 ? (mx ? '' : '0') : (mx ? (b < 0 ? '−' : '+') + fmt(Math.abs(b)) : fmt(b).replace('-', '−'));
    return 'y=' + mx + bs;
  };

  const Geo = {
    title: 'Geometry',
    statusKinds: ['angle'],
    init(saved) {
      this.objs = [];
      this.nextId = 1;
      this.tool = 'sel';
      this.pick = [];
      this.selIds = [];
      this.view = { xmin: -8, xmax: 8, xscl: 1, ymin: -8, ymax: 8, yscl: 1 };
      this.axes = false;
      if (saved && Array.isArray(saved.objs)) {
        this.objs = saved.objs;
        this.nextId = saved.nextId || this.objs.length + 1;
        Object.assign(this.view, saved.view || {});
        this.axes = !!saved.axes;
      } else {
        // Beispiel: Dreieck mit Umkreis-Mittelsenkrechten-Startpunkt
        const A = this.addPt(-4, -2), B2 = this.addPt(3, -3), C2 = this.addPt(1, 4);
        this.add({ t: 'poly', pts: [A, B2, C2] });
        this.add({ t: 'circ', c: this.add({ t: 'mid', a: A, b: B2, name: 'M' }), p: A });
      }
    },
    save() { return { objs: this.objs, nextId: this.nextId, view: this.view, axes: this.axes }; },
    editor() { return null; },
    add(o) { o.id = this.nextId++; this.objs.push(o); if ((o.t === 'pt' || o.t === 'mid' || o.t === 'isect') && !o.name) o.name = this.freeName(); return o.id; },
    addPt(x, y) { return this.add({ t: 'pt', x, y }); },
    freeName() { const used = new Set(this.objs.map(o => o.name)); for (const n of NAMES) if (!used.has(n)) return n; return 'P' + this.nextId; },
    get(id) { return this.objs.find(o => o.id === id); },
    // Lage eines Punktes (frei, Mittelpunkt, Schnittpunkt)
    pos(id) {
      const o = this.get(id);
      if (!o) return null;
      if (o.t === 'pt') return { x: o.x, y: o.y };
      if (o.t === 'mid') { const a = this.pos(o.a), b = this.pos(o.b); return a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null; }
      if (o.t === 'isect') { const r = this.intersect(this.get(o.a), this.get(o.b)); return r[o.k || 0] || null; }
      return null;
    },
    isPoint(o) { return o && (o.t === 'pt' || o.t === 'mid' || o.t === 'isect'); },
    // Schnittpunkte zweier Linien/Kreise
    lineOf(o) {
      const a = this.pos(o.a), b = this.pos(o.b);
      return a && b ? { a, b, seg: o.t === 'seg' } : null;
    },
    circOf(o) { const c = this.pos(o.c), p = this.pos(o.p); return c && p ? { c, r: Math.hypot(p.x - c.x, p.y - c.y) } : null; },
    intersect(o1, o2) {
      if (!o1 || !o2) return [];
      const isL = o => o.t === 'seg' || o.t === 'line';
      if (isL(o1) && isL(o2)) {
        const L1 = this.lineOf(o1), L2 = this.lineOf(o2);
        if (!L1 || !L2) return [];
        const d1x = L1.b.x - L1.a.x, d1y = L1.b.y - L1.a.y, d2x = L2.b.x - L2.a.x, d2y = L2.b.y - L2.a.y;
        const den = d1x * d2y - d1y * d2x;
        if (Math.abs(den) < 1e-12) return [];
        const t = ((L2.a.x - L1.a.x) * d2y - (L2.a.y - L1.a.y) * d2x) / den, u = ((L2.a.x - L1.a.x) * d1y - (L2.a.y - L1.a.y) * d1x) / den;
        if ((L1.seg && (t < -1e-9 || t > 1 + 1e-9)) || (L2.seg && (u < -1e-9 || u > 1 + 1e-9))) return [];
        return [{ x: L1.a.x + t * d1x, y: L1.a.y + t * d1y }];
      }
      if (o1.t === 'circ' && o2.t === 'circ') {
        const A = this.circOf(o1), Bc = this.circOf(o2);
        if (!A || !Bc) return [];
        const d = Math.hypot(Bc.c.x - A.c.x, Bc.c.y - A.c.y);
        if (d > A.r + Bc.r || d < Math.abs(A.r - Bc.r) || d === 0) return [];
        const a = (A.r * A.r - Bc.r * Bc.r + d * d) / (2 * d), hh = Math.sqrt(Math.max(0, A.r * A.r - a * a));
        const mx = A.c.x + a * (Bc.c.x - A.c.x) / d, my = A.c.y + a * (Bc.c.y - A.c.y) / d;
        return [{ x: mx + hh * (Bc.c.y - A.c.y) / d, y: my - hh * (Bc.c.x - A.c.x) / d }, { x: mx - hh * (Bc.c.y - A.c.y) / d, y: my + hh * (Bc.c.x - A.c.x) / d }];
      }
      const [L, Ci] = isL(o1) ? [o1, o2] : [o2, o1];
      if (!isL(L) || Ci.t !== 'circ') return [];
      const l = this.lineOf(L), c = this.circOf(Ci);
      if (!l || !c) return [];
      const dx = l.b.x - l.a.x, dy = l.b.y - l.a.y, fx = l.a.x - c.c.x, fy = l.a.y - c.c.y;
      const a = dx * dx + dy * dy, b = 2 * (fx * dx + fy * dy), cc = fx * fx + fy * fy - c.r * c.r;
      const disc = b * b - 4 * a * cc;
      if (disc < 0) return [];
      return [(-b - Math.sqrt(disc)) / (2 * a), (-b + Math.sqrt(disc)) / (2 * a)].filter(t => !l.seg || (t >= -1e-9 && t <= 1 + 1e-9)).map(t => ({ x: l.a.x + t * dx, y: l.a.y + t * dy }));
    },

    /* ---------- Darstellung ---------- */
    mount(work) {
      this.win = h('div', { class: 'win active' });
      this.wrap = h('div', { class: 'gwrap' });
      this.canvas = h('canvas', { 'aria-label': 'Geometrie-Zeichenfläche' });
      this.info = h('div', { class: 'ginfo' });
      this.tag = h('div', { class: 'gtag' });
      this.wrap.append(this.canvas, this.tag, this.info);
      this.win.appendChild(this.wrap);
      work.appendChild(this.win);
      this.bind();
      requestAnimationFrame(() => this.draw());
    },
    layout() { requestAnimationFrame(() => this.draw()); },
    refresh() { this.draw(); },
    onScale() { this.draw(); },
    square() {
      const W = this.canvas.clientWidth || 316, H = this.canvas.clientHeight || 400, V = this.view;
      const cx = (V.xmin + V.xmax) / 2, cy = (V.ymin + V.ymax) / 2, hx = (V.xmax - V.xmin) / 2, hy = hx * H / W;
      Object.assign(V, { ymin: cy - hy, ymax: cy + hy });
    },
    draw() {
      if (!this.canvas) return;
      this.square();
      const s = Plot.setup(this.canvas);
      if (!s) return;
      const { g, W, H } = s;
      const P = App.pal(), V = this.view;
      let t;
      if (this.axes) t = Plot.axes(g, W, H, V);
      else t = { X: x => (x - V.xmin) / (V.xmax - V.xmin) * W, Y: y => H - (y - V.ymin) / (V.ymax - V.ymin) * H };
      this.T = t; this.W = W; this.H = H;
      const sel = id => this.selIds.includes(id) || this.pick.includes(id);
      const stroke = (id, base) => { g.strokeStyle = sel(id) ? P.curves[1] : base; g.lineWidth = sel(id) ? 2.4 : 1.6; };
      this.objs.forEach(o => {
        if (o.t === 'seg' || o.t === 'line') {
          const l = this.lineOf(o);
          if (!l) return;
          stroke(o.id, P.ink);
          g.beginPath();
          if (o.t === 'seg') { g.moveTo(t.X(l.a.x), t.Y(l.a.y)); g.lineTo(t.X(l.b.x), t.Y(l.b.y)); }
          else {
            const dx = l.b.x - l.a.x, dy = l.b.y - l.a.y, k = 1e3;
            g.moveTo(t.X(l.a.x - k * dx), t.Y(l.a.y - k * dy)); g.lineTo(t.X(l.a.x + k * dx), t.Y(l.a.y + k * dy));
          }
          g.stroke();
        } else if (o.t === 'circ') {
          const c = this.circOf(o);
          if (!c) return;
          stroke(o.id, P.curves[0]);
          g.beginPath(); g.arc(t.X(c.c.x), t.Y(c.c.y), c.r / (V.xmax - V.xmin) * W, 0, 2 * Math.PI); g.stroke();
        } else if (o.t === 'poly') {
          const pts = o.pts.map(id => this.pos(id));
          if (pts.some(p => !p)) return;
          g.fillStyle = P.shade;
          g.beginPath(); pts.forEach((p, k) => (k ? g.lineTo(t.X(p.x), t.Y(p.y)) : g.moveTo(t.X(p.x), t.Y(p.y)))); g.closePath();
          g.fill();
          stroke(o.id, P.ink);
          g.stroke();
        }
      });
      // Punkte zuletzt, mit Namen
      this.objs.filter(o => this.isPoint(o)).forEach(o => {
        const p = this.pos(o.id);
        if (!p) return;
        const x = t.X(p.x), y = t.Y(p.y);
        g.fillStyle = sel(o.id) ? P.curves[1] : o.t === 'pt' ? P.curves[0] : P.curves[2];
        g.beginPath(); g.arc(x, y, sel(o.id) ? 4.2 : 3.4, 0, 2 * Math.PI); g.fill();
        g.fillStyle = P.ink; g.font = '11px -apple-system, Helvetica, Arial, sans-serif';
        g.fillText(o.name, x + 5, y - 5);
      });
      this.tag.textContent = TOOLS.find(x => x[0] === this.tool)[1] + (this.pick.length ? ' · ' + this.pick.length + ' gewählt' : '');
      this.measure();
    },
    // Messwerte zur aktuellen Auswahl (wie die Measurement-Leiste)
    measure() {
      const ids = this.selIds, o = ids.map(id => this.get(id)).filter(Boolean);
      const parts = [];
      const deg = App.settings.angle === 'deg';
      if (o.length === 1) {
        const a = o[0];
        if (this.isPoint(a)) { const p = this.pos(a.id); parts.push(a.name + '(' + fmt(p.x) + ', ' + fmt(p.y) + ')'); }
        else if (a.t === 'seg' || a.t === 'line') {
          const l = this.lineOf(a);
          if (a.t === 'seg') parts.push('Länge ' + fmt(Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y)));
          const dx = l.b.x - l.a.x, dy = l.b.y - l.a.y;
          if (Math.abs(dx) < 1e-12) parts.push('x=' + fmt(l.a.x));
          else parts.push(lineEq(dy / dx, l.a.y - dy / dx * l.a.x));
          parts.push('Steigungswinkel ' + fmt(Math.atan2(dy, dx) * (deg ? 180 / Math.PI : 1)) + (deg ? '°' : ''));
        } else if (a.t === 'circ') {
          const c = this.circOf(a);
          parts.push('r=' + fmt(c.r), 'A=' + fmt(Math.PI * c.r * c.r), 'U=' + fmt(2 * Math.PI * c.r));
          parts.push('(x' + (c.c.x < 0 ? '+' : '−') + fmt(Math.abs(c.c.x)) + ')²+(y' + (c.c.y < 0 ? '+' : '−') + fmt(Math.abs(c.c.y)) + ')²=' + fmt(c.r * c.r));
        } else if (a.t === 'poly') {
          const pts = a.pts.map(id => this.pos(id));
          let A = 0, U = 0;
          pts.forEach((p, k) => { const q = pts[(k + 1) % pts.length]; A += p.x * q.y - q.x * p.y; U += Math.hypot(q.x - p.x, q.y - p.y); });
          parts.push('Fläche ' + fmt(Math.abs(A) / 2), 'Umfang ' + fmt(U));
        }
      } else if (o.length === 2 && o.every(x => this.isPoint(x))) {
        const p = this.pos(o[0].id), q = this.pos(o[1].id);
        parts.push(o[0].name + o[1].name + ' = ' + fmt(Math.hypot(q.x - p.x, q.y - p.y)));
      } else if (o.length === 3 && o.every(x => this.isPoint(x))) {
        const [p, q, r] = o.map(x => this.pos(x.id));
        const a1 = Math.atan2(p.y - q.y, p.x - q.x), a2 = Math.atan2(r.y - q.y, r.x - q.x);
        let ang = Math.abs(a1 - a2);
        if (ang > Math.PI) ang = 2 * Math.PI - ang;
        parts.push('∠' + o[0].name + o[1].name + o[2].name + ' = ' + fmt(deg ? ang * 180 / Math.PI : ang) + (deg ? '°' : ' rad'));
      }
      this.info.textContent = parts.join('   ');
    },

    /* ---------- Eingabe ---------- */
    hit(px, py) {
      const t = this.T, tol = 8;
      // Punkte zuerst
      let best = null, bd = tol;
      this.objs.filter(o => this.isPoint(o)).forEach(o => { const p = this.pos(o.id); if (!p) return; const d = Math.hypot(t.X(p.x) - px, t.Y(p.y) - py); if (d < bd) { bd = d; best = o; } });
      if (best) return best;
      bd = tol;
      this.objs.forEach(o => {
        let d = Infinity;
        if (o.t === 'seg' || o.t === 'line') {
          const l = this.lineOf(o); if (!l) return;
          const ax = t.X(l.a.x), ay = t.Y(l.a.y), bx = t.X(l.b.x), by = t.Y(l.b.y);
          const vx = bx - ax, vy = by - ay, len2 = vx * vx + vy * vy || 1;
          let u = ((px - ax) * vx + (py - ay) * vy) / len2;
          if (o.t === 'seg') u = Math.max(0, Math.min(1, u));
          d = Math.hypot(px - (ax + u * vx), py - (ay + u * vy));
        } else if (o.t === 'circ') {
          const c = this.circOf(o); if (!c) return;
          d = Math.abs(Math.hypot(px - t.X(c.c.x), py - t.Y(c.c.y)) - c.r / (this.view.xmax - this.view.xmin) * this.W);
        } else if (o.t === 'poly') {
          const pts = o.pts.map(id => this.pos(id));
          let inside = false;
          const x = this.view.xmin + px / this.W * (this.view.xmax - this.view.xmin), y = this.view.ymax - py / this.H * (this.view.ymax - this.view.ymin);
          for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            if ((pts[i].y > y) !== (pts[j].y > y) && x < (pts[j].x - pts[i].x) * (y - pts[i].y) / (pts[j].y - pts[i].y) + pts[i].x) inside = !inside;
          }
          d = inside ? tol - 0.5 : Infinity;
        }
        if (d < bd) { bd = d; best = o; }
      });
      return best;
    },
    pointAt(px, py) {
      const o = this.hit(px, py);
      if (o && this.isPoint(o)) return o.id;
      const V = this.view;
      let x = V.xmin + px / this.W * (V.xmax - V.xmin), y = V.ymax - py / this.H * (V.ymax - V.ymin);
      // leichtes Einrasten auf 0.1
      x = Math.round(x * 10) / 10; y = Math.round(y * 10) / 10;
      return this.addPt(x, y);
    },
    bind() {
      let drag = null;
      const pos = e => { const r = this.canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / (App.scale || 1), y: (e.clientY - r.top) / (App.scale || 1) }; };
      this.wrap.addEventListener('pointerdown', e => {
        e.preventDefault();
        const p = pos(e);
        this.wrap.setPointerCapture(e.pointerId);
        const tl = this.tool;
        if (tl === 'sel') {
          const o = this.hit(p.x, p.y);
          if (o && o.t === 'pt') drag = { id: o.id };
          else if (!o) drag = { pan: p, v: Object.assign({}, this.view) };
          if (o) {
            if (e.shiftKey || e.metaKey) this.selIds = this.selIds.includes(o.id) ? this.selIds.filter(x => x !== o.id) : this.selIds.concat([o.id]);
            else if (!this.selIds.includes(o.id)) this.selIds = [o.id];
          } else if (!e.shiftKey) this.selIds = [];
          this.draw();
          return;
        }
        if (tl === 'del') {
          const o = this.hit(p.x, p.y);
          if (o) this.remove(o.id);
          this.draw();
          return;
        }
        if (tl === 'pt') { const id = this.pointAt(p.x, p.y); this.selIds = [id]; this.draw(); App.save(); return; }
        if (tl === 'isect') {
          const o = this.hit(p.x, p.y);
          if (!o || this.isPoint(o) || o.t === 'poly') return;
          this.pick.push(o.id);
          if (this.pick.length === 2) {
            const [a, b] = this.pick;
            const pts = this.intersect(this.get(a), this.get(b));
            if (!pts.length) App.message('Schnittpunkt', 'Die Objekte schneiden sich nicht.');
            pts.forEach((q, k) => this.add({ t: 'isect', a, b, k }));
            this.pick = [];
            App.save();
          }
          this.draw();
          return;
        }
        if (tl === 'mid') {
          const o = this.hit(p.x, p.y);
          if (o && o.t === 'seg') { this.add({ t: 'mid', a: o.a, b: o.b }); this.draw(); App.save(); return; }
          if (o && this.isPoint(o)) {
            this.pick.push(o.id);
            if (this.pick.length === 2) { this.add({ t: 'mid', a: this.pick[0], b: this.pick[1] }); this.pick = []; App.save(); }
          }
          this.draw();
          return;
        }
        // Strecke, Gerade, Kreis: zwei Punkte; Polygon: Punkte bis zum Klick auf den ersten
        const id = this.pointAt(p.x, p.y);
        if (tl === 'poly') {
          if (this.pick.length >= 3 && id === this.pick[0]) { this.add({ t: 'poly', pts: this.pick.slice() }); this.pick = []; App.save(); }
          else if (!this.pick.includes(id)) this.pick.push(id);
          if (this.pick.length === 3 && e.detail === 2) { this.add({ t: 'poly', pts: this.pick.slice() }); this.pick = []; }
          this.draw();
          return;
        }
        this.pick.push(id);
        if (this.pick.length === 2) {
          const [a, b] = this.pick;
          if (a !== b) {
            if (tl === 'seg') this.add({ t: 'seg', a, b });
            if (tl === 'line') this.add({ t: 'line', a, b });
            if (tl === 'circ') this.add({ t: 'circ', c: a, p: b });
          }
          this.pick = [];
          App.save();
        }
        this.draw();
      });
      this.wrap.addEventListener('pointermove', e => {
        if (!drag) return;
        const p = pos(e), V = this.view;
        if (drag.id) {
          const o = this.get(drag.id);
          o.x = Math.round((V.xmin + p.x / this.W * (V.xmax - V.xmin)) * 100) / 100;
          o.y = Math.round((V.ymax - p.y / this.H * (V.ymax - V.ymin)) * 100) / 100;
        } else {
          const dx = (p.x - drag.pan.x) / this.W * (drag.v.xmax - drag.v.xmin), dy = (p.y - drag.pan.y) / this.H * (drag.v.ymax - drag.v.ymin);
          Object.assign(V, { xmin: drag.v.xmin - dx, xmax: drag.v.xmax - dx, ymin: drag.v.ymin + dy, ymax: drag.v.ymax + dy });
        }
        this.draw();
      });
      const end = () => { if (drag) App.save(); drag = null; };
      this.wrap.addEventListener('pointerup', end);
      this.wrap.addEventListener('pointercancel', end);
      this.wrap.addEventListener('wheel', e => {
        e.preventDefault();
        Plot.zoom(this.view, Math.exp((e.ctrlKey ? e.deltaY * 2.5 : e.deltaY) * 0.0018));
        this.draw();
      }, { passive: false });
    },
    // Objekt und alles, was davon abhaengt, entfernen
    remove(id) {
      const dead = new Set([id]);
      let grow = true;
      while (grow) {
        grow = false;
        this.objs.forEach(o => {
          if (dead.has(o.id)) return;
          const refs = [o.a, o.b, o.c, o.p].concat(o.pts || []);
          if (refs.some(r => dead.has(r))) { dead.add(o.id); grow = true; }
        });
      }
      this.objs = this.objs.filter(o => !dead.has(o.id));
      this.selIds = this.selIds.filter(x => !dead.has(x));
      App.save();
    },
    setTool(t) { this.tool = t; this.pick = []; this.draw(); App.refreshChrome(); },
    key(k) {
      if (k === 'ESC' || k === 'CLEAR') { this.pick = []; this.selIds = []; this.setTool('sel'); return true; }
      if (k === 'DEL' || k === 'BS') { this.selIds.slice().forEach(id => this.remove(id)); this.draw(); return true; }
      const V = this.view, dx = (V.xmax - V.xmin) * 0.1;
      if (k === 'LEFT') { V.xmin -= dx; V.xmax -= dx; } else if (k === 'RIGHT') { V.xmin += dx; V.xmax += dx; }
      else if (k === 'UP') { V.ymin += dx; V.ymax += dx; } else if (k === 'DOWN') { V.ymin -= dx; V.ymax -= dx; }
      else return true;
      this.draw();
      return true;
    },
    menus() {
      return [
        { label: 'Edit', items: [{ label: 'Auswahl löschen', action: () => this.key('DEL') }, { label: 'Alles löschen', action: () => App.dialog({ title: 'Clear All', body: [h('div', { class: 'msg', text: 'Alle Objekte löschen?' })], ok: () => { this.objs = []; this.selIds = []; this.pick = []; this.draw(); } }) }, { label: 'Alles auswählen', action: () => { this.selIds = this.objs.map(o => o.id); this.draw(); } }] },
        { label: 'Draw', items: TOOLS.map(([id, l]) => ({ label: l, check: this.tool === id, action: () => this.setTool(id) })) },
        { label: 'View', items: [{ label: 'Achsen und Raster', check: this.axes, action: () => { this.axes = !this.axes; this.draw(); } }, { label: 'Zoom In', action: () => { Plot.zoom(this.view, 0.5); this.draw(); } }, { label: 'Zoom Out', action: () => { Plot.zoom(this.view, 2); this.draw(); } }, { label: 'Zoom zurücksetzen', action: () => { Object.assign(this.view, { xmin: -8, xmax: 8, ymin: -8, ymax: 8 }); this.draw(); } }] }
      ];
    },
    toolbar() {
      return TOOLS.map(([id, l, ic]) => ({ icon: ic, title: l, on: this.tool === id, action: () => this.setTool(id) }));
    }
  };
  App.register('geom', Geo);
})(window.MP = window.MP || {});

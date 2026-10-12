/* MathPad II — Geraet, Tasten, Menues, Dialoge, Soft-Keyboard, Speichern */
(function (MP) {
  'use strict';
  const B = MP.B, C = MP.core;
  const STORE_KEY = 'mathpad2.v1';

  /* ---------- DOM-Helfer ---------- */
  function h(tag, attrs) {
    const el = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'style') el.style.cssText = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (let i = 2; i < arguments.length; i++) {
      const c = arguments[i];
      if (c === null || c === undefined || c === false) continue;
      if (Array.isArray(c)) c.forEach(x => x && el.appendChild(typeof x === 'string' ? document.createTextNode(x) : x));
      else el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
  }
  const svg = (inner, vb) => '<svg viewBox="' + (vb || '0 0 20 20') + '" aria-hidden="true">' + inner + '</svg>';

  // Einfuege-Aktionen
  const A = {
    ch: v => ({ t: 'ch', v }), fn: v => ({ t: 'fn', v }), nm: v => ({ t: 'nm', v }),
    tpl: (v, o) => ({ t: 'tpl', v, o }), seq: (...list) => ({ t: 'seq', list })
  };
  function applyInsert(ed, a) {
    switch (a.t) {
      case 'ch': ed.ch(a.v); break;
      case 'fn': ed.fn(a.v); break;
      case 'nm': ed.nm(a.v); break;
      case 'tpl': ed.tpl(a.v, a.o); break;
      case 'seq': a.list.forEach(x => applyInsert(ed, x)); break;
      case 'text': ed.text(a.v); break;
    }
  }
  // Mini-Darstellung eines Vorlagen-Symbols fuer Tasten
  function mathLabel(items) {
    const w = h('span', { class: 'm' });
    w.appendChild(B.render(B.row(items), { edit: true }));
    return w;
  }

  /* ---------- Zustand ---------- */
  const App = MP.App = {
    settings: { angle: 'rad', decimal: false, complex: 'real', fmt: { mode: 'norm1', n: 2 }, grid: true, axes: true, labels: true, coords: true },
    state: {},
    apps: {},
    cur: null,
    curName: 'main',
    shift: false,
    kb: false,
    kbTab: 'Math1',
    power: true,
    land: false,
    scale: 1,
    h, svg, A, applyInsert, mathLabel
  };
  App.env = { settings: App.settings, vars: {}, fns: {}, userFns: new Set(), ans: null };

  /* ---------- Farbschema: Dunkel (Standard), Hell, Auto — Apple-Systemfarben ---------- */
  App.theme = 'dark';
  App.themePref = 'dark';
  const PAL = {
    light: { bg: '#ffffff', ink: '#1d1d1f', grid: '#e5e5ea', axis: '#3a3a3c', label: '#6e6e73', mute: '#8e8e93', sel: '#007aff', shade: 'rgba(0,122,255,.17)', hist: 'rgba(0,122,255,.24)',
      curves: ['#007aff', '#ff3b30', '#34c759', '#af52de', '#1d1d1f', '#32ade6', '#ff9500', '#5856d6'] },
    dark: { bg: '#000000', ink: '#f5f5f7', grid: '#1f1f22', axis: '#8e8e93', label: '#98989d', mute: '#8e8e93', sel: '#0a84ff', shade: 'rgba(10,132,255,.28)', hist: 'rgba(10,132,255,.36)',
      curves: ['#0a84ff', '#ff453a', '#30d158', '#bf5af2', '#f5f5f7', '#64d2ff', '#ff9f0a', '#7d7aff'] }
  };
  App.pal = () => PAL[App.theme] || PAL.dark;
  MP.userFns = App.env.userFns;

  /* ---------- Speichern ---------- */
  let saveT = 0;
  App.save = function () {
    clearTimeout(saveT);
    saveT = setTimeout(saveNow, 300);
  };
  function saveNow() {
    clearTimeout(saveT);
    {
      try {
        const data = {
          v: 1, settings: App.settings, cur: App.curName, land: App.land, zoom: App.zoom, kbTab: App.kbTab, theme: App.themePref,
          vars: App.env.vars, fns: App.env.fns, ans: App.env.ans,
          apps: {}
        };
        for (const k in App.apps) if (App.apps[k].save) data.apps[k] = App.apps[k].save();
        localStorage.setItem(STORE_KEY, JSON.stringify(data));
      } catch (e) { /* privat/blockiert: ohne Speichern weiter */ }
    }
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      if (!d || d.v !== 1) return null;
      return d;
    } catch (e) { return null; }
  }
  App.resetAll = function () {
    try { localStorage.removeItem(STORE_KEY); localStorage.removeItem(THEME_KEY); } catch (e) { /* egal */ }
    location.reload();
  };

  /* ---------- Geraet aufbauen ---------- */
  const ICONS = {
    settings: svg('<circle cx="10" cy="10" r="2.6"/><path d="M10 2.5v2.2M10 15.3v2.2M2.5 10h2.2M15.3 10h2.2M4.7 4.7l1.6 1.6M13.7 13.7l1.6 1.6M4.7 15.3l1.6-1.6M13.7 6.3l1.6-1.6"/>'),
    menu: svg('<rect x="3" y="3" width="5" height="5"/><rect x="12" y="3" width="5" height="5"/><rect x="3" y="12" width="5" height="5"/><rect x="12" y="12" width="5" height="5"/>'),
    main: svg('<path d="M2.5 11l2-1 2.5 6 4-13h6.5"/><text x="12.5" y="16.5" font-size="8" stroke="none" fill="#dfe4ea" font-family="Arial">α</text>'),
    resize: svg('<rect x="3" y="4" width="14" height="12"/><path d="M3 10h14M8 7l2-2 2 2M8 13l2 2 2-2"/>'),
    swap: svg('<rect x="3" y="3" width="14" height="6"/><rect x="3" y="11" width="14" height="6"/><path d="M15 6h-4M6 14h4"/>'),
    rotate: svg('<rect x="6" y="3" width="8" height="14" rx="1"/><path d="M2.5 8.5a6 6 0 0 1 3-4M2 4.5l1 2.6 2.4-1.2"/>'),
    esc: svg('<path d="M14.5 6.5H7l2.5-2.5M7 6.5l2.5 2.5"/><path d="M5 10v2.5a3 3 0 0 0 3 3h7"/>')
  };

  function buildDevice() {
    const dev = document.getElementById('device');
    dev.className = 'device';
    const screen = h('div', { class: 'screen', id: 'screen' },
      h('div', { class: 'menubar', id: 'menubar' }),
      h('div', { class: 'toolbar', id: 'toolbar' }),
      h('div', { class: 'work', id: 'work' }),
      h('div', { class: 'softkb', id: 'softkb', hidden: true }),
      h('div', { class: 'statusbar', id: 'status' }),
      h('div', { class: 'overlay', id: 'overlay' })
    );
    const ip = h('div', { class: 'ipanel' });
    [['settings', 'Settings'], ['menu', 'Menu'], ['main', 'Main'], ['resize', 'Resize'], ['swap', 'Swap'], ['rotate', 'Rotate'], ['esc', 'Esc']].forEach(([k, l]) => {
      const b = h('button', { type: 'button', title: l, 'aria-label': l, 'data-icon': k }, h('span', { text: l }), h('span', { html: ICONS[k] }));
      b.addEventListener('click', () => iconPress(k));
      ip.appendChild(b);
    });
    dev.append(h('div', { class: 'dev-logo', text: 'MATHPAD' }), h('div', { class: 'glass' }), h('div', { class: 'screen-wrap' }, screen), ip, buildKeys());
  }

  /* ---------- Hardware-Tasten ---------- */
  const SHIFT_MAP = {
    '(': A.ch('{'), ')': A.ch('}'), ',': A.ch('⇒'), '=': A.ch('≠'), 'x': A.ch('θ'), 'y': A.ch('t'), 'z': A.ch('r'),
    '^': A.tpl('sqrt'), '÷': A.tpl('frac'), '(−)': A.nm('ans'), '0': A.ch('π'), '.': A.ch('i'), 'EXP': A.ch('e')
  };
  const KEYDEF = {
    '=': A.ch('='), 'x': A.ch('x'), 'y': A.ch('y'), 'z': A.ch('z'), '^': A.tpl('sup'), '÷': A.ch('÷'),
    '(': A.ch('('), ')': A.ch(')'), ',': A.ch(','), '(−)': A.ch('−'), '×': A.ch('×'), '−': A.ch('-'), '+': A.ch('+'),
    '.': A.ch('.'), 'EXP': A.ch('ᴇ')
  };
  '0123456789'.split('').forEach(d => { KEYDEF[d] = A.ch(d); });
  const keyEls = {};

  function mkKey(id, label, cls, title) {
    const b = h('button', { type: 'button', class: 'key ' + (cls || ''), 'data-k': id, title: title || null, 'aria-label': title || label });
    if (typeof label === 'string') b.innerHTML = label; else b.appendChild(label);
    bindPress(b, () => press(id));
    keyEls[id] = b;
    return b;
  }
  function bindPress(el, fn) {
    let rep = 0, t0 = 0;
    const stop = () => { clearTimeout(t0); clearInterval(rep); el.classList.remove('down'); };
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      el.classList.add('down');
      fn();
      const k = el.getAttribute('data-k');
      if (['BS', 'LEFT', 'RIGHT', 'UP', 'DOWN'].indexOf(k) >= 0) {
        t0 = setTimeout(() => { rep = setInterval(fn, 70); }, 420);
      }
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => el.addEventListener(ev, stop));
    // Aktivierung ohne Zeiger (Screenreader, Tastatur-Klick) ausloesen
    el.addEventListener('click', e => { if (e.detail === 0) fn(); });
  }
  function buildKeys() {
    const dp = h('div', { class: 'dpad' });
    // Im Querformat steht das Tastenfeld aufrecht neben dem Display, die Pfeile gelten unveraendert
    [['up', 'UP', '▲'], ['dn', 'DOWN', '▼'], ['lf', 'LEFT', '◀'], ['rt', 'RIGHT', '▶']].forEach(([c, k, t]) => {
      const b = h('button', { type: 'button', class: c, 'data-k': k, 'aria-label': k.toLowerCase(), text: t });
      bindPress(b, () => press(k));
      keyEls[k] = b;
      dp.appendChild(b);
    });
    dp.appendChild(h('span', { class: 'mid' }));
    const nav = h('div', { class: 'navblock' },
      h('div', { class: 'navcol' }, mkKey('KEYBOARD', 'Keyboard', 'sm', 'Keyboard (Soft-Tastatur ein/aus)'), mkKey('SHIFT', 'Shift', 'sm shift', 'Shift')),
      dp,
      h('div', { class: 'navcol' }, mkKey('BS', '&larr;', 'sm', 'Löschen (Shift: Entf)'), mkKey('CLEAR', '<span class="pw"></span>Clear', 'sm', 'Clear (Shift: Aus)'))
    );
    const r6 = h('div', { class: 'kgrid r6' });
    [['=', '='], ['x', 'x'], ['y', 'y'], ['z', 'z'], ['^', '^'], ['÷', '÷']].forEach(([id, l]) => r6.appendChild(mkKey(id, l, '', shiftTitle(id))));
    const r5 = h('div', { class: 'kgrid r5' });
    [
      ['(', '(', ''], ['7', '7', 'light'], ['8', '8', 'light'], ['9', '9', 'light'], ['×', '×', ''],
      [')', ')', ''], ['4', '4', 'light'], ['5', '5', 'light'], ['6', '6', 'light'], ['−', '−', ''],
      [',', ',', ''], ['1', '1', 'light'], ['2', '2', 'light'], ['3', '3', 'light'], ['+', '+', ''],
      ['(−)', '(−)', ''], ['0', '0', 'light'], ['.', '.', 'light'], ['EXP', 'EXP', 'light'], ['EXE', 'EXE', 'exe']
    ].forEach(([id, l, c]) => r5.appendChild(mkKey(id, l, c, shiftTitle(id) || (id === 'EXE' ? 'EXE (Shift: ≈ Dezimal)' : null))));
    return h('div', { class: 'keys' }, nav, r6, r5);
  }
  function shiftTitle(id) {
    const s = SHIFT_MAP[id];
    if (!s) return null;
    const show = s.t === 'ch' ? s.v : s.t === 'nm' ? s.v : s.v === 'sqrt' ? '√' : s.v === 'frac' ? 'Bruch' : s.v;
    return id + '  (Shift: ' + show + ')';
  }
  function flashKey(id) {
    const el = keyEls[id];
    if (!el) return;
    el.classList.add('down');
    setTimeout(() => el.classList.remove('down'), 110);
  }

  /* ---------- Tastendispatch ---------- */
  function setShift(v) {
    App.shift = v;
    if (keyEls.SHIFT) keyEls.SHIFT.classList.toggle('on', v);
    renderStatus();
  }
  function press(k) {
    if (!App.power) {
      if (k === 'CLEAR') powerOn();
      return;
    }
    if (k === 'SHIFT') { setShift(!App.shift); return; }
    const sh = App.shift;
    if (sh) setShift(false);
    if (k === 'KEYBOARD') { toggleKb(); return; }
    if (sh && k === 'CLEAR') { powerOff(); return; }
    // offener Dialog bekommt die Tasten
    if (dialogKey(k, sh)) return;
    if (menuOpen()) { if (k === 'ESC' || k === 'CLEAR') closeMenus(); return; }
    const app = App.cur;
    if (sh && k === 'BS') k = 'DEL';
    if (sh && k === 'EXE') k = 'APPROX';
    let ins = null;
    if (sh && SHIFT_MAP[k]) ins = SHIFT_MAP[k];
    else if (KEYDEF[k]) ins = KEYDEF[k];
    if (app.key && app.key(k, ins)) { App.save(); return; }
    const ed = app.editor && app.editor();
    if (!ed) return;
    if (ins) applyInsert(ed, ins);
    else switch (k) {
      case 'LEFT': ed.left(); break;
      case 'RIGHT': ed.right(); break;
      case 'UP': ed.up(); break;
      case 'DOWN': ed.down(); break;
      case 'BS': ed.backspace(); break;
      case 'DEL': ed.del(); break;
      case 'CLEAR': ed.clear(); break;
      case 'HOME': ed.home(); break;
      case 'END': ed.end(); break;
    }
    App.save();
  }
  App.press = press;
  App.insert = function (act) {
    if (!App.power) return;
    if (dialogInsert(act)) return;
    const ed = App.cur.editor && App.cur.editor();
    if (App.cur.insert && App.cur.insert(act)) return;
    if (ed) { applyInsert(ed, act); App.save(); }
  };

  function powerOff() {
    App.power = false;
    closeMenus();
    document.getElementById('screen').classList.add('off');
  }
  function powerOn() {
    App.power = true;
    document.getElementById('screen').classList.remove('off');
    if (App.cur && App.cur.refresh) App.cur.refresh();
  }

  function iconPress(k) {
    if (!App.power) return;
    closeMenus();
    switch (k) {
      case 'settings': settingsMenu(); break;
      case 'menu': App.open('menu'); break;
      case 'main': App.open('main'); break;
      case 'resize': if (App.cur.resize) App.cur.resize(); break;
      case 'swap': if (App.cur.swap) App.cur.swap(); break;
      case 'rotate': App.rotate(true); break;
      case 'esc': if (!closeDialog()) press('ESC'); break;
    }
  }
  function settingsMenu() {
    const el = document.querySelector('.ipanel [data-icon="settings"]');
    const r = el.getBoundingClientRect(), sr = document.getElementById('screen').getBoundingClientRect();
    openMenu(App.setupItems(), { x: (r.left - sr.left) / App.scale, y: (App.land ? 320 : 528) - 4, up: true });
  }

  /* ---------- Menues ---------- */
  function overlay() { return document.getElementById('overlay'); }
  function menuOpen() { return !!overlay().querySelector('.ddmenu'); }
  function closeMenus() {
    overlay().querySelectorAll('.ddmenu').forEach(m => m.remove());
    document.querySelectorAll('.menubar button.open').forEach(b => b.classList.remove('open'));
  }
  App.closeMenus = closeMenus;
  // items: [{label, action, check, sub:[...], sep}]
  function openMenu(items, pos, level) {
    level = level || 0;
    overlay().querySelectorAll('.ddmenu').forEach(m => { if (+m.dataset.level >= level) m.remove(); });
    const m = h('div', { class: 'ddmenu', role: 'menu', 'data-level': level });
    items.forEach(it => {
      if (it.sep) { m.appendChild(h('hr')); return; }
      const b = h('button', { type: 'button', role: 'menuitem' },
        h('span', { class: 'ck', text: it.check ? '✓' : '' }), h('span', { text: it.label }), it.sub ? h('span', { class: 'ar', text: '▶' }) : null);
      b.addEventListener('click', e => {
        e.stopPropagation();
        if (it.sub) {
          const r = b.getBoundingClientRect(), sr = document.getElementById('screen').getBoundingClientRect();
          let x = (r.right - sr.left) / App.scale - 6, y = (r.top - sr.top) / App.scale;
          openMenu(typeof it.sub === 'function' ? it.sub() : it.sub, { x, y, flip: true }, level + 1);
          return;
        }
        closeMenus();
        if (it.action) { it.action(); App.save(); }
      });
      m.appendChild(b);
    });
    overlay().appendChild(m);
    const W = App.land ? 528 : 320, H = App.land ? 320 : 528;
    const mw = m.offsetWidth, mh = m.offsetHeight;
    let x = pos.x, y = pos.y;
    if (pos.up) y = pos.y - mh;
    if (x + mw > W) x = pos.flip ? Math.max(0, W - mw) : Math.max(0, W - mw);
    if (y + mh > H) y = Math.max(0, H - mh);
    m.style.left = x + 'px';
    m.style.top = y + 'px';
    return m;
  }
  App.openMenu = openMenu;

  function renderMenubar() {
    const bar = document.getElementById('menubar');
    bar.textContent = '';
    const defs = App.cur.menus ? App.cur.menus() : [];
    const gear = h('button', { type: 'button', class: 'gear', 'aria-label': 'Einstellungen', html: svg('<circle cx="10" cy="10" r="3"/><path d="M10 1.5v3M10 15.5v3M1.5 10h3M15.5 10h3M4 4l2.1 2.1M13.9 13.9L16 16M4 16l2.1-2.1M13.9 6.1L16 4"/>') + '<span class="tri">▼</span>' });
    gear.addEventListener('click', e => { e.stopPropagation(); toggleBarMenu(gear, App.setupItems()); });
    bar.appendChild(gear);
    defs.forEach(d => {
      const b = h('button', { type: 'button', text: d.label });
      b.addEventListener('click', e => { e.stopPropagation(); if (d.action) { closeMenus(); d.action(); return; } toggleBarMenu(b, typeof d.items === 'function' ? d.items() : d.items); });
      bar.appendChild(b);
    });
    bar.appendChild(h('span', { class: 'mtitle', text: App.cur.title || '' }));
  }
  function toggleBarMenu(btn, items) {
    const was = btn.classList.contains('open');
    closeMenus();
    if (was) return;
    btn.classList.add('open');
    const r = btn.getBoundingClientRect(), sr = document.getElementById('screen').getBoundingClientRect();
    openMenu(items, { x: (r.left - sr.left) / App.scale, y: (r.bottom - sr.top) / App.scale });
  }

  let tbPage = 0, tbFor = null;
  function renderToolbar() {
    const tb = document.getElementById('toolbar');
    tb.textContent = '';
    let defs = App.cur.toolbar ? App.cur.toolbar() : [];
    if (tbFor !== App.curName) { tbPage = 0; tbFor = App.curName; }
    // Platz: 320 px (quer 528 px) abzueglich Pfeil; Knoepfe sind 30-44 px breit
    const W = App.land ? 520 : 312;
    const width = d => (d.label && !d.icon && !d.math ? Math.max(30, d.label.length * 6.4 + 8) : 30) + 1;
    const pages = [];
    let cur = [], used = 0;
    defs.forEach(d => {
      const w = width(d);
      if (cur.length && used + w > W - 18) { pages.push(cur); cur = []; used = 0; }
      cur.push(d); used += w;
    });
    if (cur.length) pages.push(cur);
    if (tbPage >= pages.length) tbPage = 0;
    defs = pages[tbPage] || [];
    defs.forEach(d => {
      const b = h('button', { type: 'button', title: d.title || d.label || '', 'aria-label': d.title || d.label, class: d.on ? 'on' : null });
      if (d.icon) b.innerHTML = d.icon; else if (d.math) b.appendChild(mathLabel(d.math)); else b.textContent = d.label;
      b.addEventListener('click', e => {
        e.stopPropagation();
        closeMenus();
        if (d.menu) {
          const r = b.getBoundingClientRect(), sr = document.getElementById('screen').getBoundingClientRect();
          openMenu(typeof d.menu === 'function' ? d.menu() : d.menu, { x: (r.left - sr.left) / App.scale, y: (r.bottom - sr.top) / App.scale });
          return;
        }
        d.action();
        App.save();
      });
      tb.appendChild(b);
    });
    if (pages.length > 1) {
      const more = h('button', { type: 'button', class: 'tb-more', title: 'Weitere Symbole', 'aria-label': 'Weitere Symbole', text: '▶' });
      more.addEventListener('click', e => { e.stopPropagation(); tbPage = (tbPage + 1) % pages.length; renderToolbar(); });
      tb.appendChild(more);
    }
  }

  const ANG_LBL = { rad: 'Rad', deg: 'Deg', gra: 'Gra' };
  function renderStatus() {
    const st = document.getElementById('status');
    if (!st) return;
    st.textContent = '';
    const S = App.settings;
    const seg = (label, title, fn) => {
      const b = h('button', { type: 'button', text: label, title });
      b.addEventListener('click', e => { e.stopPropagation(); fn(); App.refreshAll(); App.save(); });
      st.appendChild(b);
    };
    const kinds = App.cur && App.cur.statusKinds ? App.cur.statusKinds : ['angle', 'complex'];
    kinds.forEach(kind => {
      if (kind === 'alg') st.appendChild(h('button', { type: 'button', text: 'Alg', title: 'Algebra-Modus' }));
      if (kind === 'dec') seg(S.decimal ? 'Decimal' : 'Standard', 'Standard/Decimal umschalten', () => { S.decimal = !S.decimal; });
      if (kind === 'complex') seg(S.complex === 'real' ? 'Real' : 'Cplx', 'Real/Complex umschalten', () => { S.complex = S.complex === 'real' ? 'cplx' : 'real'; });
      if (kind === 'angle') seg(ANG_LBL[S.angle], 'Winkelmodus umschalten', () => { S.angle = S.angle === 'rad' ? 'deg' : S.angle === 'deg' ? 'gra' : 'rad'; });
    });
    if (App.cur && App.cur.statusExtra) App.cur.statusExtra().forEach(t => st.appendChild(h('span', { class: 'xt', text: t })));
    if (App.shift) st.appendChild(h('span', { class: 'st-shift', text: 'Shift' }));
    st.appendChild(h('span', { class: 'bat', title: 'Batterie' }, h('i')));
  }
  App.renderStatus = renderStatus;

  /* ---------- Einstellungen ---------- */
  App.setupItems = function () {
    return [
      { label: 'Basic Format…', action: () => App.basicFormat() },
      { label: 'Graph Format…', action: () => App.graphFormat() },
      { sep: true },
      { label: 'Keyboard', check: App.kb, action: () => toggleKb() },
      { label: 'Default Setup', action: () => { Object.assign(App.settings, { angle: 'rad', decimal: false, complex: 'real', fmt: { mode: 'norm1', n: 2 }, grid: true, axes: true, labels: true, coords: true }); App.refreshAll(); } }
    ];
  };
  App.basicFormat = function () {
    const S = App.settings;
    const fmtVal = S.fmt.mode === 'fix' || S.fmt.mode === 'sci' ? S.fmt.mode + S.fmt.n : S.fmt.mode;
    const opts = [['norm1', 'Normal 1'], ['norm2', 'Normal 2']];
    for (let i = 0; i <= 9; i++) opts.push(['fix' + i, 'Fix ' + i]);
    for (let i = 0; i <= 9; i++) opts.push(['sci' + i, 'Sci ' + i]);
    const sel = (id, list, val) => h('select', { id }, list.map(([v, l]) => h('option', { value: v, selected: v === val ? true : null, text: l })));
    App.dialog({
      title: 'Basic Format',
      body: [
        h('div', { class: 'row' }, h('label', { for: 'bf-num', text: 'Number Format' }), sel('bf-num', opts, fmtVal)),
        h('div', { class: 'row' }, h('label', { for: 'bf-ang', text: 'Angle' }), sel('bf-ang', [['rad', 'Radian'], ['deg', 'Degree'], ['gra', 'Grad']], S.angle)),
        h('div', { class: 'row' }, h('label', { for: 'bf-cx', text: 'Complex Format' }), sel('bf-cx', [['real', 'Real'], ['cplx', 'a+bi']], S.complex)),
        h('div', { class: 'row' }, h('label', { for: 'bf-dec', text: 'Decimal Calculation' }), h('input', { type: 'checkbox', id: 'bf-dec', checked: S.decimal ? true : null }))
      ],
      ok: d => {
        const nv = d.querySelector('#bf-num').value;
        S.fmt = /^(fix|sci)/.test(nv) ? { mode: nv.slice(0, 3), n: +nv.slice(3) } : { mode: nv, n: 2 };
        S.angle = d.querySelector('#bf-ang').value;
        S.complex = d.querySelector('#bf-cx').value;
        S.decimal = d.querySelector('#bf-dec').checked;
        App.refreshAll();
      }
    });
  };
  App.graphFormat = function () {
    const S = App.settings;
    const cb = (id, l, v) => h('div', { class: 'row' }, h('label', { for: id, text: l }), h('input', { type: 'checkbox', id, checked: v ? true : null }));
    App.dialog({
      title: 'Graph Format',
      body: [cb('gf-grid', 'Grid', S.grid), cb('gf-axes', 'Axes', S.axes), cb('gf-lab', 'Labels', S.labels), cb('gf-co', 'Coordinates', S.coords)],
      ok: d => {
        S.grid = d.querySelector('#gf-grid').checked;
        S.axes = d.querySelector('#gf-axes').checked;
        S.labels = d.querySelector('#gf-lab').checked;
        S.coords = d.querySelector('#gf-co').checked;
        App.refreshAll();
      }
    });
  };

  /* ---------- Dialoge ---------- */
  let dlgStack = [];
  // opts: {title, body: Node[] | (div)=>void, ok:(div)=>bool|void, cancel:bool, buttons:[{label, action}], okLabel}
  App.dialog = function (opts) {
    closeMenus();
    const back = h('div', { class: 'dlg-back' });
    const db = h('div', { class: 'db' });
    if (typeof opts.body === 'function') opts.body(db); else if (opts.body) [].concat(opts.body).forEach(n => db.appendChild(n));
    const df = h('div', { class: 'df' });
    const box = h('div', { class: 'dlg', role: 'dialog', 'aria-label': opts.title }, h('div', { class: 'dt', text: opts.title }), db, df);
    back.appendChild(box);
    const close = () => {
      back.remove();
      dlgStack = dlgStack.filter(d => d !== rec);
      if (opts.onClose) opts.onClose();
    };
    const rec = {
      el: back, close,
      ok: () => { if (opts.ok) { const r = opts.ok(box); if (r === false) return; } close(); App.save(); },
      cancel: () => close()
    };
    (opts.buttons || []).forEach(b => {
      const bt = h('button', { type: 'button', text: b.label });
      bt.addEventListener('click', () => { if (b.action(box) !== false) close(); App.save(); });
      df.appendChild(bt);
    });
    const okB = h('button', { type: 'button', class: 'def', text: opts.okLabel || 'OK' });
    okB.addEventListener('click', rec.ok);
    df.appendChild(okB);
    if (opts.cancel !== false && opts.ok) {
      const cb = h('button', { type: 'button', text: 'Cancel' });
      cb.addEventListener('click', rec.cancel);
      df.appendChild(cb);
    }
    overlay().appendChild(back);
    dlgStack.push(rec);
    const first = box.querySelector('input[type=text], select');
    if (first) { first.focus(); if (first.select) first.select(); } else okB.focus();
    return rec;
  };
  App.error = function (msg) {
    App.dialog({ title: 'Error', body: [h('div', { class: 'msg err', text: msg })], cancel: false });
  };
  App.message = function (title, msg) {
    App.dialog({ title, body: [h('div', { class: 'msg', text: msg })], cancel: false });
  };
  function topDialog() { return dlgStack[dlgStack.length - 1]; }
  function closeDialog() {
    const d = topDialog();
    if (!d) return false;
    d.cancel();
    return true;
  }
  function dialogKey(k, sh) {
    const d = topDialog();
    if (!d) return false;
    const act = document.activeElement;
    const inp = act && d.el.contains(act) && act.tagName === 'INPUT' && act.type === 'text' ? act : null;
    if (k === 'EXE') { d.ok(); return true; }
    if (k === 'ESC') { d.cancel(); return true; }
    const fields = Array.from(d.el.querySelectorAll('input[type=text], select, input[type=checkbox]'));
    if (k === 'UP' || k === 'DOWN') {
      const i = fields.indexOf(act);
      const n = fields[(i + (k === 'DOWN' ? 1 : -1) + fields.length) % fields.length];
      if (n) { n.focus(); if (n.select) n.select(); }
      return true;
    }
    if (!inp) return true;
    if (k === 'BS') { delText(inp, -1); return true; }
    if (k === 'DEL') { delText(inp, 1); return true; }
    if (k === 'CLEAR') { inp.value = ''; return true; }
    if (k === 'LEFT' || k === 'RIGHT') {
      const p = Math.max(0, Math.min(inp.value.length, inp.selectionStart + (k === 'LEFT' ? -1 : 1)));
      inp.setSelectionRange(p, p);
      return true;
    }
    const ins = sh && SHIFT_MAP[k] ? SHIFT_MAP[k] : KEYDEF[k];
    if (ins) dialogInsert(ins);
    return true;
  }
  function delText(inp, dir) {
    let s = inp.selectionStart, e = inp.selectionEnd;
    if (s === e) { if (dir < 0) s = Math.max(0, s - 1); else e = Math.min(inp.value.length, e + 1); }
    inp.setRangeText('', s, e, 'end');
  }
  function insText(inp, t) { inp.setRangeText(t, inp.selectionStart, inp.selectionEnd, 'end'); }
  function dialogInsert(act) {
    const d = topDialog();
    const actEl = document.activeElement;
    const inp = actEl && actEl.tagName === 'INPUT' && actEl.type === 'text' && (d ? d.el.contains(actEl) : actEl.closest('.screen')) ? actEl : null;
    if (!inp) return !!d;
    const txt = a => {
      if (a.t === 'ch') return a.v === 'ᴇ' ? 'E' : a.v === '−' ? '-' : a.v === '×' ? '*' : a.v === '÷' ? '/' : a.v;
      if (a.t === 'fn') return (C.FN_SHOW[a.v] ? a.v : a.v) + '(';
      if (a.t === 'nm') return a.v;
      if (a.t === 'tpl') return { sqrt: 'sqrt(', frac: '/', sup: '^', abs: 'abs(' }[a.v] || '';
      if (a.t === 'seq') return a.list.map(txt).join('');
      return '';
    };
    insText(inp, txt(act));
    return true;
  }
  App.dialogOpen = () => !!topDialog();

  /* ---------- Soft-Keyboard ---------- */
  const T = (k, o) => A.tpl(k, o);
  const lbl = {
    sqrt: () => mathLabel([B.t('sqrt')]), root: () => mathLabel([B.t('root')]), frac: () => mathLabel([B.t('frac')]),
    sq: () => mathLabel([B.ch('x'), B.t('sup', [[B.ch('2')]])]), pow: () => mathLabel([B.ch('x'), B.t('sup')]),
    inv: () => mathLabel([B.ch('x'), B.t('sup', [B.chars('−1')])]), ex: () => mathLabel([B.ch('e'), B.t('sup')]),
    tenx: () => mathLabel([B.chars('10'), B.t('sup')]), logb: () => mathLabel([B.t('logb')]), abs: () => mathLabel([B.t('abs')]),
    int: () => mathLabel([B.t('int', [[], [B.ch('x')]])]), dint: () => mathLabel([B.t('dint', [[], [], [], [B.ch('x')]])]),
    diff: () => mathLabel([B.t('diff', [[B.ch('x')], []])]), diff2: () => mathLabel([B.t('diff2', [[B.ch('x')], []])]),
    lim: () => mathLabel([B.t('lim', [[B.ch('x')], [], []])]), sum: () => mathLabel([B.t('sum', [[B.ch('k')], [], [], []])]),
    prod: () => mathLabel([B.t('prod', [[B.ch('k')], [], [], []])]),
    m22: () => mathLabel([B.t('mat', null, { r: 2, cols: 2 })]), m12: () => mathLabel([B.t('mat', null, { r: 1, cols: 2 })]),
    m21: () => mathLabel([B.t('mat', null, { r: 2, cols: 1 })]), m33: () => mathLabel([B.t('mat', null, { r: 3, cols: 3 })])
  };
  const K = (label, act, cls) => ({ label, act, cls });
  const F = (name, show) => K(show || (C.FN_SHOW[name] || name) + '(', A.fn(name), 'cmd');
  const KB = {
    Math1: [
      [K(lbl.sqrt, T('sqrt')), K(lbl.root, T('root')), K(lbl.frac, T('frac')), K(lbl.sq, T('sup', { content: [B.ch('2')] })), K(lbl.pow, T('sup')), K(lbl.inv, T('sup', { content: B.chars('−1') })), K('π', A.ch('π'))],
      [K(lbl.ex, A.seq(A.ch('e'), T('sup'))), K('ln', A.fn('ln')), K(lbl.logb, T('logb')), K('log', A.fn('log')), K(lbl.tenx, A.seq(A.ch('1'), A.ch('0'), T('sup'))), K(lbl.abs, T('abs')), K('i', A.ch('i'))],
      [K('θ', A.ch('θ')), K('∞', A.ch('∞')), K('°', A.ch('°')), K('!', A.ch('!')), K('⇒', A.ch('⇒')), K('ans', A.nm('ans')), K('E', A.ch('ᴇ'))],
      [K('<', A.ch('<')), K('>', A.ch('>')), K('≤', A.ch('≤')), K('≥', A.ch('≥')), K('≠', A.ch('≠')), K('{', A.ch('{')), K('}', A.ch('}'))],
      [F('solve'), F('approx'), F('simplify'), F('factor'), F('expand'), K('Define', A.nm('Define'), 'cmd'), K('[', A.ch('['))]
    ],
    Math2: [
      [K(lbl.int, T('int')), K(lbl.dint, T('dint')), K(lbl.diff, T('diff')), K(lbl.diff2, T('diff2')), K(lbl.lim, T('lim')), K(lbl.sum, T('sum')), K(lbl.prod, T('prod'))],
      [K(lbl.m22, T('mat', { r: 2, cols: 2 })), K(lbl.m12, T('mat', { r: 1, cols: 2 })), K(lbl.m21, T('mat', { r: 2, cols: 1 })), K(lbl.m33, T('mat', { r: 3, cols: 3 })), F('det'), F('trn'), K(lbl.inv, T('sup', { content: B.chars('−1') }))],
      [F('diff', 'diff('), F('integrate', '∫('), F('lim'), F('partfrac'), F('combine'), F('propFrac'), F('fMax')],
      [F('mean'), F('median'), F('sum'), F('max'), F('min'), F('seq'), F('fMin')],
      [F('nCr'), F('nPr'), F('gcd'), F('lcm'), F('mod'), F('floor'), F('round')]
    ],
    Trig: [
      [F('sin', 'sin'), F('cos', 'cos'), F('tan', 'tan'), F('asin', 'sin⁻¹'), F('acos', 'cos⁻¹'), F('atan', 'tan⁻¹')],
      [F('sinh', 'sinh'), F('cosh', 'cosh'), F('tanh', 'tanh'), F('asinh', 'sinh⁻¹'), F('acosh', 'cosh⁻¹'), F('atanh', 'tanh⁻¹')],
      [K('π', A.ch('π')), K('°', A.ch('°')), K('θ', A.ch('θ')), K('r', A.ch('r')), K('t', A.ch('t')), K('x', A.ch('x'))],
      [F('re'), F('im'), F('arg'), F('conjg'), F('abs'), F('sign')]
    ],
    Var: [
      [K('x', A.ch('x')), K('y', A.ch('y')), K('z', A.ch('z')), K('t', A.ch('t')), K('θ', A.ch('θ')), K('n', A.ch('n')), K('k', A.ch('k'))],
      [K('a', A.ch('a')), K('b', A.ch('b')), K('c', A.ch('c')), K('d', A.ch('d')), K('f', A.ch('f')), K('g', A.ch('g')), K('h', A.ch('h'))],
      [K('m', A.ch('m')), K('p', A.ch('p')), K('q', A.ch('q')), K('r', A.ch('r')), K('s', A.ch('s')), K('u', A.ch('u')), K('v', A.ch('v'))],
      [K('A', A.ch('A')), K('B', A.ch('B')), K('C', A.ch('C')), K('M', A.ch('M')), K('ans', A.nm('ans')), K('⇒', A.ch('⇒')), K('Define', A.nm('Define'), 'cmd')]
    ],
    abc: [
      'qwertyuiop'.split('').map(c => K(c, A.ch(c))),
      'asdfghjkl'.split('').map(c => K(c, A.ch(c))).concat([K('(', A.ch('('))]),
      'zxcvbnm'.split('').map(c => K(c, A.ch(c))).concat([K(')', A.ch(')')), K(',', A.ch(',')), K('"', A.ch('"'))]),
      ['A', 'B', 'C', 'D', 'M', 'X', 'Y'].map(c => K(c, A.ch(c))).concat([K('[', A.ch('[')), K(']', A.ch(']')), K('_', A.ch('_'))])
    ]
  };
  function renderKb() {
    const kb = document.getElementById('softkb');
    kb.hidden = !App.kb;
    if (!App.kb) return;
    kb.textContent = '';
    const tabs = h('div', { class: 'tabs', role: 'tablist' });
    Object.keys(KB).forEach(name => {
      const b = h('button', { type: 'button', role: 'tab', class: name === App.kbTab ? 'on' : null, 'aria-selected': String(name === App.kbTab), text: name });
      b.addEventListener('click', e => { e.stopPropagation(); App.kbTab = name; renderKb(); App.save(); });
      tabs.appendChild(b);
    });
    const rows = KB[App.kbTab];
    const cols = Math.max(...rows.map(r => r.length));
    const pad = h('div', { class: 'pad', style: 'grid-template-columns:repeat(' + cols + ',1fr)' });
    rows.forEach(r => {
      r.forEach(k => {
        const b = h('button', { type: 'button', class: k.cls || null });
        const l = typeof k.label === 'function' ? k.label() : k.label;
        if (typeof l === 'string') b.textContent = l; else b.appendChild(l);
        b.setAttribute('aria-label', typeof k.label === 'string' ? k.label : (k.act.v || 'Vorlage'));
        b.addEventListener('pointerdown', e => { e.preventDefault(); App.insert(k.act); });
        pad.appendChild(b);
      });
      for (let i = r.length; i < cols; i++) pad.appendChild(h('span'));
    });
    kb.append(tabs, pad);
  }
  function toggleKb() {
    App.kb = !App.kb;
    renderKb();
    if (App.cur && App.cur.layout) App.cur.layout();
    App.save();
  }
  App.toggleKb = toggleKb;

  /* ---------- App-Wechsel ---------- */
  App.register = function (name, app) { App.apps[name] = app; app.name = name; };
  App.open = function (name) {
    closeMenus();
    while (dlgStack.length) dlgStack[dlgStack.length - 1].cancel();
    if (App.cur && App.cur.hide) App.cur.hide();
    App.curName = name;
    App.cur = App.apps[name];
    const work = document.getElementById('work');
    work.textContent = '';
    App.cur.mount(work);
    App.refreshChrome();
    App.save();
  };
  App.refreshChrome = function () {
    renderMenubar();
    renderToolbar();
    renderStatus();
    renderKb();
  };
  App.refreshAll = function () {
    App.refreshChrome();
    if (App.cur && App.cur.refresh) App.cur.refresh();
  };
  // Rotate: eigenes Querformat-Gehaeuse (Display links, Tastenfeld rechts), alles aufrecht
  App.rotate = function (animate) {
    const flip = () => {
      App.land = !App.land;
      applyRotation();
      App.fit();
      if (App.cur && App.cur.layout) App.cur.layout();
      App.refreshChrome();
    };
    const calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (animate !== false && !calm && document.startViewTransition) document.startViewTransition(flip);
    else flip();
    App.save();
  };
  function applyRotation() {
    document.getElementById('device').classList.toggle('land', App.land);
  }
  // iPhone und iPad: das Geraet folgt dem Drehen in der Hand (am Mac bleibt es beim Rotate-Knopf)
  const mqTouch = window.matchMedia ? window.matchMedia('(pointer: coarse)') : null;
  const mqLand = window.matchMedia ? window.matchMedia('(orientation: landscape)') : null;
  function followOrientation(animate) {
    if (!mqTouch || !mqTouch.matches || !mqLand) return;
    if (mqLand.matches !== App.land) App.rotate(animate);
  }

  /* ---------- Erscheinungsbild umschalten ---------- */
  const THEME_KEY = 'mathpad2.theme';
  const mqLight = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
  const resolveTheme = p => (p === 'auto' ? (mqLight && mqLight.matches ? 'light' : 'dark') : p === 'light' ? 'light' : 'dark');
  function paintTheme() {
    const t = resolveTheme(App.themePref), root = document.documentElement;
    root.setAttribute('data-theme', t);
    root.setAttribute('data-pref', App.themePref);
    App.theme = t;
    const meta = document.getElementById('theme-color');
    if (meta) meta.setAttribute('content', t === 'dark' ? '#1c1c1e' : '#f6f6f6');
    const seg = document.getElementById('theme-seg');
    if (seg) seg.querySelectorAll('button').forEach((b, i) => {
      const on = b.dataset.pref === App.themePref;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on) { seg.style.setProperty('--i', i); seg.dataset.i = i; }
    });
    // Grafiken (Canvas) zeichnen ihre Farben selbst und muessen neu gezeichnet werden
    if (App.cur) App.refreshAll();
  }
  App.setTheme = function (pref, animate) {
    if (pref !== 'light' && pref !== 'auto') pref = 'dark';
    const changes = resolveTheme(pref) !== resolveTheme(App.themePref);
    App.themePref = pref;
    try { localStorage.setItem(THEME_KEY, pref); } catch (e) { /* privat: nur fuer diese Sitzung */ }
    const calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (animate && changes && !calm && document.startViewTransition) document.startViewTransition(paintTheme);
    else if (animate && changes && !calm) {
      const root = document.documentElement;
      root.classList.add('theme-anim');
      paintTheme();
      setTimeout(() => root.classList.remove('theme-anim'), 420);
    } else paintTheme();
    App.save();
  };
  function bindChrome() {
    const seg = document.getElementById('theme-seg');
    if (seg) {
      const btns = Array.from(seg.querySelectorAll('button'));
      btns.forEach(b => b.addEventListener('click', () => App.setTheme(b.dataset.pref, true)));
      // Radiogruppe: Pfeiltasten wechseln wie bei macOS
      seg.addEventListener('keydown', e => {
        const i = btns.findIndex(b => b.dataset.pref === App.themePref);
        let n = -1;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % btns.length;
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (i + btns.length - 1) % btns.length;
        if (n < 0) return;
        e.preventDefault();
        e.stopPropagation();
        App.setTheme(btns[n].dataset.pref, true);
        btns[n].focus();
      });
    }
    if (mqLight) {
      const onSys = () => { if (App.themePref === 'auto') { const r = document.documentElement; r.classList.add('theme-anim'); paintTheme(); setTimeout(() => r.classList.remove('theme-anim'), 420); } };
      if (mqLight.addEventListener) mqLight.addEventListener('change', onSys); else if (mqLight.addListener) mqLight.addListener(onSys);
    }
    [['zoom-out', -1], ['zoom-fit', 0], ['zoom-in', 1]].forEach(([id, d]) => { const b = document.getElementById(id); if (b) b.addEventListener('click', () => setZoom(d)); });
    const hb = document.getElementById('btn-help'), hp = document.getElementById('help');
    if (hb && hp) {
      hb.addEventListener('click', () => App.toggleHelp());
      document.addEventListener('pointerdown', e => { if (!hp.hidden && !hp.contains(e.target) && !hb.contains(e.target)) App.toggleHelp(false); });
    }
  }
  App.toggleHelp = function (show) {
    const hb = document.getElementById('btn-help'), hp = document.getElementById('help');
    if (!hb || !hp) return false;
    const on = show === undefined ? hp.hidden : show;
    if (on === !hp.hidden) return false;
    hp.hidden = !on;
    hb.setAttribute('aria-expanded', String(on));
    return true;
  };

  /* ---------- Skalierung ---------- */
  // Groesse: "Fit" passt das Geraet in das Fenster, +/- vergroessert schrittweise (dann scrollt die Seite)
  App.zoom = 0;
  App.fit = function () {
    const stage = document.getElementById('stage'), fit = document.getElementById('fit'), dev = document.getElementById('device');
    const W = dev.offsetWidth, H = dev.offsetHeight;
    // verfuegbare Flaeche: Buehne unter der Titelleiste, abzueglich Rand
    const aw = (stage.clientWidth || window.innerWidth) - 32, ah = (stage.clientHeight || window.innerHeight) - 32;
    const fitS = Math.max(0.3, Math.min(aw / W, ah / H, 2));
    const s = App.zoom ? App.zoom : fitS;
    App.scale = s;
    dev.style.transform = 'scale(' + s + ')';
    fit.style.width = W * s + 'px';
    fit.style.height = H * s + 'px';
    const zv = document.getElementById('zoom-val');
    if (zv) zv.textContent = App.zoom ? Math.round(s * 100) + ' %' : 'Fit';
    if (App.cur && App.cur.onScale) App.cur.onScale();
  };
  function setZoom(dir) {
    const steps = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6, 1.8, 2];
    const cur = App.scale;
    if (dir === 0) App.zoom = 0;
    else if (dir > 0) App.zoom = steps.find(v => v > cur + 0.01) || 2;
    else App.zoom = steps.slice().reverse().find(v => v < cur - 0.01) || 0.5;
    App.fit();
    App.save();
  }

  /* ---------- Mac-Tastatur ---------- */
  const KEYMAP = {
    Enter: 'EXE', Backspace: 'BS', Delete: 'DEL', Escape: 'ESC', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT', ArrowUp: 'UP', ArrowDown: 'DOWN',
    Home: 'HOME', End: 'END'
  };
  const FLASH = { '*': '×', '-': '−', '+': '+', '(': '(', ')': ')', ',': ',', '.': '.', '=': '=', '^': '^', x: 'x', y: 'y', z: 'z' };
  function onKeyDown(e) {
    const t = e.target;
    const inField = t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
    if (e.key === 'Escape') { e.preventDefault(); if (App.toggleHelp(false)) return; if (menuOpen()) closeMenus(); else iconPress('esc'); return; }
    if (t && t.closest && t.closest('.titlebar, .help') && (e.key === 'Enter' || e.key === ' ' || e.key === 'Tab' || e.key.startsWith('Arrow'))) return;
    if (inField) {
      if (e.key === 'Enter') {
        const d = topDialog();
        if (d && d.el.contains(t)) { e.preventDefault(); d.ok(); return; }
        if (App.cur && App.cur.fieldEnter && App.cur.fieldEnter(t)) { e.preventDefault(); return; }
      }
      return;
    }
    if (e.metaKey || e.ctrlKey) {
      if ((e.key === 'c' || e.key === 'C') && App.cur && App.cur.copy) { e.preventDefault(); App.cur.copy(); }
      if (e.key === 'Enter') { e.preventDefault(); press('SHIFT'); press('EXE'); }
      return;
    }
    if (topDialog() && (e.key === 'Tab')) return;
    let k = KEYMAP[e.key];
    if (k) {
      e.preventDefault();
      if (k === 'EXE' && e.shiftKey) { press('SHIFT'); press('EXE'); flashKey('EXE'); return; }
      if (k === 'BS' && e.altKey) { if (App.cur.editor && App.cur.editor()) App.cur.editor().clear(); return; }
      press(k);
      flashKey(k === 'BS' ? 'BS' : k);
      return;
    }
    if (e.key === 'Tab') { e.preventDefault(); if (App.cur.swapFocus) App.cur.swapFocus(); return; }
    if (e.key.length !== 1) return;
    e.preventDefault();
    const c = e.key;
    if (topDialog()) { dialogInsert(A.ch(c === '*' ? '×' : c)); return; }
    if (menuOpen()) closeMenus();
    const ed = App.cur.editor && App.cur.editor();
    if (ed && !(App.cur.insert && App.cur.insert(A.ch(c)))) {
      // direkt in den Editor, mit "smart" Verlassen von Exponent und Nenner
      ed.ch(c === '*' ? '×' : c, true);
      App.save();
    } else if (!ed) App.insert(A.ch(c === '*' ? '×' : c));
    if (/[0-9]/.test(c)) flashKey(c);
    else if (FLASH[c]) flashKey(FLASH[c]);
  }
  function onPaste(e) {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    const txt = (e.clipboardData || window.clipboardData).getData('text');
    if (!txt) return;
    e.preventDefault();
    const ed = App.cur.editor && App.cur.editor();
    if (ed) { ed.paste(txt); App.save(); }
  }
  App.copyText = function (txt) {
    try { navigator.clipboard.writeText(txt).catch(() => {}); } catch (e) { /* egal */ }
  };

  /* ---------- Start ---------- */
  App.init = function () {
    buildDevice();
    const saved = load();
    if (saved) {
      Object.assign(App.settings, saved.settings || {});
      App.env.vars = saved.vars || {};
      App.env.fns = saved.fns || {};
      App.env.ans = saved.ans || null;
      Object.keys(App.env.fns).forEach(k => App.env.userFns.add(k));
      App.kbTab = KB[saved.kbTab] ? saved.kbTab : 'Math1';
      App.land = !!saved.land;
      App.zoom = +saved.zoom || 0;
    }
    let pref = saved && saved.theme;
    try { pref = localStorage.getItem(THEME_KEY) || pref; } catch (e) { /* egal */ }
    App.themePref = pref === 'light' || pref === 'auto' ? pref : 'dark';
    paintTheme();
    App.env.settings = App.settings;
    // Klicks auf Tasten nehmen Eingabefeldern nicht den Fokus weg
    document.getElementById('device').addEventListener('mousedown', e => { if (!e.target.closest('input, select')) e.preventDefault(); });
    for (const k in App.apps) if (App.apps[k].init) App.apps[k].init(saved && saved.apps ? saved.apps[k] : null);
    applyRotation();
    bindChrome();
    App.open(saved && App.apps[saved.cur] ? saved.cur : 'main');
    followOrientation(false);
    App.fit();
    window.addEventListener('resize', App.fit);
    if (mqLand) { const onTurn = () => followOrientation(true); if (mqLand.addEventListener) mqLand.addEventListener('change', onTurn); else if (mqLand.addListener) mqLand.addListener(onTurn); }
    // Tab schliessen oder Seite neu laden: sofort speichern
    window.addEventListener('pagehide', saveNow);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('paste', onPaste);
    document.addEventListener('pointerdown', e => {
      if (!e.target.closest('.ddmenu') && !e.target.closest('.menubar') && !e.target.closest('.toolbar')) closeMenus();
    });
  };
})(window.MP = window.MP || {});

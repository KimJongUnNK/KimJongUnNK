// Zentrale — Frontend. Vanilla JS, kein Build.

import { ICONS, categoryIcon } from './icons.js';

const $ = (sel, root = document) => root.querySelector(sel);

const CATEGORY_LABELS = {
  bot: 'Bot',
  plug: 'Steckdose',
  switch: 'Schalter',
  light: 'Licht',
  curtain: 'Vorhang',
  lock: 'Schloss',
  security: 'Sicherheit',
  climate: 'Klima',
  vacuum: 'Saugroboter',
  sensor: 'Sensor',
  hub: 'Hub',
  camera: 'Kamera',
  tv: 'Medien',
  remote: 'Fernbedienung',
  other: 'Sonstiges',
};
const FILTER_GROUPS = [
  ['light', 'Licht'],
  ['bot', 'Bots'],
  ['plug', 'Steckdosen'],
  ['switch', 'Schalter'],
  ['curtain', 'Vorhänge'],
  ['lock', 'Schlösser'],
  ['security', 'Sicherheit'],
  ['climate', 'Klima'],
  ['vacuum', 'Saugen'],
  ['tv', 'Medien'],
  ['remote', 'Fernbedienungen'],
  ['sensor', 'Sensoren'],
  ['hub', 'Hubs'],
  ['camera', 'Kameras'],
  ['other', 'Sonstiges'],
];

const REFRESH_MS = 120_000;
const STORE_KEY = 'zentrale:v1';

// ---------------------------------------------------------------- state

const state = {
  mock: false,
  devices: [],
  statuses: new Map(), // id → { status } | { error }
  scenes: [],
  filter: 'all',
  sheetId: null,
  lastRefresh: 0,
  busy: new Set(),
};

const prefs = loadPrefs();

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}');
    return { favorites: p.favorites ?? [], filter: p.filter ?? 'all', custom: p.custom ?? {} };
  } catch {
    return { favorites: [], filter: 'all', custom: {} };
  }
}
function savePrefs() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(prefs));
  } catch {
    /* privater Modus o. ä. – egal */
  }
}
const isFav = (id) => prefs.favorites.includes(id);

// ---------------------------------------------------------------- helpers

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const icon = (name) => h('span', { class: 'i', 'aria-hidden': 'true', html: ICONS[name] ?? '' });

const haptic = (ms = 8) => {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* noop */
  }
};

function toast(msg, { error = false, ms = 2400 } = {}) {
  const el = h('div', { class: `toast${error ? ' err' : ''}` }, msg);
  $('#toasts').append(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 260);
  }, error ? ms + 1800 : ms);
}

function confirmDialog(text, okLabel = 'Ja') {
  const dlg = $('#confirm');
  $('#confirm-text').textContent = text;
  $('#confirm-ok').textContent = okLabel;
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
    dlg.returnValue = '';
    dlg.showModal();
  });
}

const isOnValue = (v) => v === true || v === 1 || v === '1' || (typeof v === 'string' && v.toLowerCase() === 'on');

const hexToRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}:${(n >> 8) & 255}:${n & 255}`;
};
const rgbToHex = (rgb) => {
  const parts = String(rgb ?? '').split(':').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return '#ffffff';
  return `#${parts.map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')).join('')}`;
};

// ---------------------------------------------------------------- api

class AuthError extends Error {}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body !== undefined || method !== 'GET' ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : method !== 'GET' ? '{}' : undefined,
    credentials: 'same-origin',
    cache: 'no-store',
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* leer */
  }
  if (res.status === 401 && path !== '/api/login') throw new AuthError(data.error ?? 'Nicht eingeloggt.');
  if (!res.ok) throw Object.assign(new Error(data.error ?? `Fehler ${res.status}`), { status: res.status });
  return data;
}

function handleError(err) {
  if (err instanceof AuthError) {
    showLogin();
    return;
  }
  toast(err.message || 'Etwas ist schiefgelaufen.', { error: true });
}

// ---------------------------------------------------------------- screens

function show(id) {
  for (const s of ['boot', 'login', 'main']) $(`#${s}`).hidden = s !== id;
}

function showLogin() {
  stopAutoRefresh();
  if ($('#sheet').open) $('#sheet').close();
  show('login');
  $('#demo-hint').hidden = !state.mock;
  setTimeout(() => $('#password').focus(), 50);
}

async function boot() {
  hydrateIcons(document);
  try {
    const s = await api('/api/session');
    state.mock = s.mock;
    if (s.authenticated) await enterMain();
    else showLogin();
  } catch (err) {
    show('login');
    $('#login-error').textContent = err.message;
  }
}

function hydrateIcons(root) {
  for (const el of root.querySelectorAll('[data-icon]')) el.innerHTML = ICONS[el.dataset.icon] ?? '';
}

// ---------------------------------------------------------------- login

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#login-btn');
  const err = $('#login-error');
  err.textContent = '';
  btn.classList.add('is-busy');
  try {
    await api('/api/login', { method: 'POST', body: { password: $('#password').value } });
    $('#password').value = '';
    await enterMain();
  } catch (ex) {
    err.textContent = ex.message;
    const form = $('#login-form');
    form.classList.remove('shake');
    void form.offsetWidth;
    form.classList.add('shake');
    haptic([20, 40, 20]);
    $('#password').select();
  } finally {
    btn.classList.remove('is-busy');
  }
});

$('#logout-btn').addEventListener('click', async () => {
  if (!(await confirmDialog('Ausloggen?', 'Raus'))) return;
  try {
    await api('/api/logout', { method: 'POST' });
  } catch {
    /* egal */
  }
  state.devices = [];
  state.statuses.clear();
  showLogin();
});

// ---------------------------------------------------------------- main

async function enterMain() {
  show('main');
  $('#demo-badge').hidden = !state.mock;
  state.filter = prefs.filter;
  renderGreeting();
  renderSkeleton();
  await loadAll();
  startAutoRefresh();
}

function renderGreeting() {
  const hr = new Date().getHours();
  const text = hr < 5 ? 'Gute Nacht.' : hr < 11 ? 'Guten Morgen.' : hr < 17 ? 'Servus.' : hr < 22 ? 'Guten Abend.' : 'Gute Nacht.';
  $('#greeting').textContent = text;
}

function renderSkeleton() {
  const grid = $('#grid');
  grid.replaceChildren(
    ...Array.from({ length: 6 }, () =>
      h(
        'article',
        { class: 'card', 'aria-hidden': 'true' },
        h('div', { class: 'card-head' }, h('span', { class: 'dev-icon skeleton' })),
        h('div', { class: 'card-titles' }, h('h3', { class: 'skeleton' }, 'Lädt …'), h('p', { class: 'skeleton' }, '…')),
        h('div', { class: 'quick' }, h('span', { class: 'btn skeleton' }, '…')),
      ),
    ),
  );
}

async function loadAll({ fresh = false } = {}) {
  const q = fresh ? '?fresh=1' : '';
  $('#error-banner').hidden = true;
  const refreshBtn = $('#refresh-btn');
  refreshBtn.classList.add('spin');
  try {
    const [d, s] = await Promise.allSettled([api(`/api/devices${q}`), api(`/api/scenes${q}`)]);
    if (d.status === 'rejected') throw d.reason;
    state.devices = d.value.devices;
    state.scenes = s.status === 'fulfilled' ? s.value.scenes : [];
    renderScenes();
    renderFilters();
    renderGrid();
    await loadStatuses({ fresh });
    state.lastRefresh = Date.now();
    renderUpdated();
  } catch (err) {
    if (err instanceof AuthError) return showLogin();
    $('#grid').replaceChildren();
    const banner = $('#error-banner');
    banner.textContent = err.message;
    banner.hidden = false;
  } finally {
    refreshBtn.classList.remove('spin');
  }
}

async function loadStatuses({ fresh = false, ids } = {}) {
  const targets = state.devices.filter((d) => d.hasStatus && (!ids || ids.includes(d.id)));
  let i = 0;
  const worker = async () => {
    while (i < targets.length) {
      const d = targets[i++];
      await loadStatus(d.id, { fresh });
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, targets.length) }, worker));
  renderSummary();
}

async function loadStatus(id, { fresh = false } = {}) {
  try {
    const { status } = await api(`/api/devices/${encodeURIComponent(id)}/status${fresh ? '?fresh=1' : ''}`);
    state.statuses.set(id, { status });
  } catch (err) {
    if (err instanceof AuthError) throw err;
    state.statuses.set(id, { error: err.message });
  }
  updateDevice(id);
}

let refreshTimer = null;
function startAutoRefresh() {
  stopAutoRefresh();
  refreshTimer = setInterval(() => {
    if (document.visibilityState === 'visible') refreshStatuses();
  }, REFRESH_MS);
}
function stopAutoRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = null;
}
async function refreshStatuses() {
  try {
    await loadStatuses();
    state.lastRefresh = Date.now();
    renderUpdated();
  } catch (err) {
    handleError(err);
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !$('#main').hidden && Date.now() - state.lastRefresh > 60_000) {
    renderGreeting();
    refreshStatuses();
  }
});

$('#refresh-btn').addEventListener('click', () => {
  haptic();
  loadAll({ fresh: true });
});

function renderUpdated() {
  const t = new Date(state.lastRefresh).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
  $('#updated').textContent = `Stand ${t} · ${state.devices.length} Geräte`;
}

function renderSummary() {
  const parts = [];
  const on = state.devices.filter((d) => statusOf(d.id)?.power === true).length;
  if (on) parts.push(`<b>${on}</b> ${on === 1 ? 'Gerät' : 'Geräte'} an`);
  const temp = state.devices
    .filter((d) => d.category === 'hub' || d.category === 'sensor')
    .map((d) => statusOf(d.id)?.readings?.find((r) => r.key === 'temperature'))
    .find(Boolean);
  if (temp) parts.push(`<b>${temp.value}</b> drinnen`);
  for (const d of state.devices.filter((x) => x.category === 'lock')) {
    const lock = statusOf(d.id)?.readings?.find((r) => r.key === 'lockState');
    if (lock) parts.push(`${escapeHtml(d.name)} <b>${escapeHtml(lock.value.toLowerCase())}</b>`);
  }
  const open = state.devices.filter((d) => statusOf(d.id)?.raw?.openState === 'open' || statusOf(d.id)?.raw?.openState === 'timeOutNotClose');
  if (open.length) parts.push(`<b>${open.map((d) => escapeHtml(d.name)).join(', ')}</b> offen`);
  const alerts = state.devices.filter((d) => statusOf(d.id)?.readings?.some((r) => r.alert));
  if (alerts.length) parts.push(`⚠ ${alerts.map((d) => escapeHtml(d.name)).join(', ')}`);
  $('#summary').innerHTML = parts.join(' · ') || (state.devices.length ? 'Alles ruhig.' : '');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const statusOf = (id) => state.statuses.get(id)?.status ?? null;

// ---------------------------------------------------------------- scenes

function renderScenes() {
  const wrap = $('#scenes-wrap');
  wrap.hidden = state.scenes.length === 0;
  $('#scenes').replaceChildren(
    ...state.scenes.map((s) =>
      h(
        'button',
        {
          class: 'btn scene',
          type: 'button',
          onclick: async (e) => {
            const b = e.currentTarget;
            haptic();
            b.classList.add('is-busy');
            try {
              await api(`/api/scenes/${encodeURIComponent(s.id)}/execute`, { method: 'POST' });
              toast(`▶ ${s.name}`);
              setTimeout(refreshStatuses, 2500);
            } catch (err) {
              handleError(err);
            } finally {
              b.classList.remove('is-busy');
            }
          },
        },
        icon('play'),
        s.name,
      ),
    ),
  );
}

// ---------------------------------------------------------------- filters

function renderFilters() {
  const counts = new Map();
  for (const d of state.devices) counts.set(d.category, (counts.get(d.category) ?? 0) + 1);
  const chips = [['all', 'Alle', state.devices.length]];
  if (prefs.favorites.some((id) => state.devices.some((d) => d.id === id))) {
    chips.push(['fav', '★ Favoriten', prefs.favorites.filter((id) => state.devices.some((d) => d.id === id)).length]);
  }
  for (const [cat, label] of FILTER_GROUPS) if (counts.get(cat)) chips.push([cat, label, counts.get(cat)]);
  if (!chips.some(([k]) => k === state.filter)) state.filter = 'all';
  $('#filters').hidden = chips.length <= 2;
  $('#filters').replaceChildren(
    ...chips.map(([key, label, n]) =>
      h(
        'button',
        {
          class: `chip${state.filter === key ? ' is-active' : ''}`,
          type: 'button',
          'aria-pressed': String(state.filter === key),
          onclick: () => {
            state.filter = key;
            prefs.filter = key;
            savePrefs();
            renderFilters();
            renderGrid();
          },
        },
        label,
        h('span', { class: 'count' }, n),
      ),
    ),
  );
}

// ---------------------------------------------------------------- grid

const CATEGORY_ORDER = FILTER_GROUPS.map(([c]) => c);

function visibleDevices() {
  let list = state.devices;
  if (state.filter === 'fav') list = list.filter((d) => isFav(d.id));
  else if (state.filter !== 'all') list = list.filter((d) => d.category === state.filter);
  return [...list].sort(
    (a, b) =>
      Number(isFav(b.id)) - Number(isFav(a.id)) ||
      CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
      a.name.localeCompare(b.name, 'de'),
  );
}

function renderGrid() {
  const list = visibleDevices();
  $('#empty').hidden = state.devices.length > 0;
  const nodes = [];
  const favs = list.filter((d) => isFav(d.id));
  if (favs.length && state.filter === 'all') {
    nodes.push(h('h2', { class: 'label section-title' }, 'Favoriten'));
    nodes.push(...favs.map(renderCard));
    nodes.push(h('h2', { class: 'label section-title' }, 'Alle Geräte'));
    nodes.push(...list.filter((d) => !isFav(d.id)).map(renderCard));
  } else {
    nodes.push(...list.map(renderCard));
  }
  $('#grid').replaceChildren(...nodes);
  renderSummary();
}

function updateDevice(id) {
  const device = state.devices.find((d) => d.id === id);
  if (!device) return;
  const old = document.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
  if (old) old.replaceWith(renderCard(device));
  if (state.sheetId === id) renderSheet(device);
}

function deviceIsOn(device, status) {
  if (!status) return false;
  if (status.power === true) return true;
  return device.controls.some((c) => c.type === 'power' && c.statusKey && isOnValue(status.raw?.[c.statusKey]));
}

function subtitle(device) {
  const cat = CATEGORY_LABELS[device.category] ?? 'Gerät';
  if (device.remote) return `IR · ${device.type}`;
  return device.type && device.type !== cat ? `${cat} · ${device.type}` : cat;
}

function renderCard(device) {
  const entry = state.statuses.get(device.id);
  const status = entry?.status ?? null;
  const on = deviceIsOn(device, status);
  const quick = device.controls.filter((c) => c.quick && passesShowWhen(c, status));
  const readings = (status?.readings ?? []).filter((r) => !['deviceMode', 'calibrate'].includes(r.key)).slice(0, 3);
  const wide = quick.some((c) => c.type === 'buttons' && c.items.length > 2) || readings.length > 2;

  const card = h(
    'article',
    {
      class: `card${on ? ' is-on' : ''}${status?.online === false ? ' is-offline' : ''}${wide ? ' wide' : ''}`,
      'data-id': device.id,
      tabindex: '0',
      role: 'button',
      'aria-label': `${device.name} öffnen`,
      onclick: (e) => {
        if (e.target.closest('button, input, select, a, label')) return;
        openSheet(device.id);
      },
      onkeydown: (e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          openSheet(device.id);
        }
      },
    },
    h(
      'div',
      { class: 'card-head' },
      h('span', { class: 'dev-icon', html: categoryIcon(device) }),
      quick.find((c) => c.type === 'power') ? renderPower(device, quick.find((c) => c.type === 'power'), status, true) : null,
    ),
    h('div', { class: 'card-titles' }, h('h3', { lang: 'de' }, isFav(device.id) ? h('span', { class: 'card-fav', 'aria-label': 'Favorit' }, '★ ') : null, device.name), h('p', {}, subtitle(device))),
    readings.length
      ? h(
          'div',
          { class: `readings${readings.length > 2 ? ' small' : ''}` },
          readings.map((r) =>
            h('div', { class: `reading${r.alert ? ' alert' : ''}` }, h('span', { class: 'r-value' }, r.value), h('span', { class: 'r-label' }, r.label)),
          ),
        )
      : null,
    h(
      'div',
      { class: 'quick' },
      quick.filter((c) => c.type !== 'power').map((c) => renderControl(device, c, status, { compact: true })),
    ),
    renderMeta(device, entry),
  );
  return card;
}

function renderMeta(device, entry) {
  const pills = [];
  const status = entry?.status;
  if (entry?.error) pills.push(h('span', { class: 'pill err', title: entry.error }, 'Status-Fehler'));
  if (status?.online === false) pills.push(h('span', { class: 'pill err' }, 'Offline'));
  if (typeof status?.battery === 'number') {
    const low = status.battery <= 20;
    pills.push(h('span', { class: `pill${low ? ' warn' : ''}` }, icon('battery'), `${status.battery} %`));
  }
  if (!device.cloud) pills.push(h('span', { class: 'pill warn' }, 'Cloud aus'));
  return pills.length ? h('div', { class: 'card-meta' }, pills) : null;
}

function passesShowWhen(control, status) {
  const w = control.showWhen;
  if (!w || !status?.raw || status.raw[w.key] === undefined) return true;
  if ('equals' in w) return status.raw[w.key] === w.equals;
  if ('notEquals' in w) return status.raw[w.key] !== w.notEquals;
  return true;
}

// ---------------------------------------------------------------- commands

async function send(device, cmd, { label, optimistic, button } = {}) {
  if (cmd.confirm && !(await confirmDialog(cmd.confirm, label ?? 'Ja'))) return false;
  const key = `${device.id}:${cmd.command}`;
  if (state.busy.has(key)) return false;
  state.busy.add(key);
  button?.classList.add('is-busy');
  haptic();
  let revert;
  if (optimistic) revert = optimistic();
  try {
    await api(`/api/devices/${encodeURIComponent(device.id)}/command`, {
      method: 'POST',
      body: { command: cmd.command, parameter: cmd.parameter ?? 'default', commandType: cmd.commandType ?? 'command' },
    });
    toast(`✓ ${device.name}${label ? ` · ${label}` : ''}`);
    if (device.hasStatus) {
      const slow = device.category === 'curtain' || device.category === 'lock' || device.category === 'bot';
      setTimeout(() => loadStatus(device.id, { fresh: true }).then(renderSummary).catch(handleError), slow ? 2500 : 1200);
      if (device.category === 'curtain') setTimeout(() => loadStatus(device.id, { fresh: true }).catch(() => {}), 12_000);
    }
    return true;
  } catch (err) {
    revert?.();
    handleError(err);
    return false;
  } finally {
    state.busy.delete(key);
    button?.classList.remove('is-busy');
  }
}

/** Setzt einen Status-Wert lokal (optimistisch) und gibt eine Undo-Funktion zurück. */
function patchStatus(device, patch) {
  const entry = state.statuses.get(device.id);
  const prev = entry?.status ? structuredClone(entry.status) : null;
  const next = prev ? structuredClone(prev) : { power: null, battery: null, online: null, readings: [], raw: {} };
  patch(next);
  state.statuses.set(device.id, { status: next });
  updateDevice(device.id);
  renderSummary();
  return () => {
    state.statuses.set(device.id, prev ? { status: prev } : {});
    updateDevice(device.id);
    renderSummary();
  };
}

// ---------------------------------------------------------------- controls

function renderControl(device, control, status, opts = {}) {
  switch (control.type) {
    case 'power':
      return renderPower(device, control, status, opts.compact);
    case 'button':
      return renderPress(device, control, opts);
    case 'buttons':
      return renderButtons(device, control, opts);
    case 'slider':
      return renderSlider(device, control, status);
    case 'select':
      return renderSelect(device, control, status);
    case 'color':
      return renderColor(device, control, status);
    case 'ac':
      return renderAc(device, control);
    case 'number':
      return renderNumber(device, control);
    case 'custom':
      return renderCustom(device, control);
    case 'raw':
      return renderRaw(device, control);
    default:
      return null;
  }
}

function powerState(control, status) {
  if (!status) return null;
  if (control.statusKey) {
    const v = status.raw?.[control.statusKey];
    return v === undefined ? null : isOnValue(v);
  }
  return status.power;
}

function renderPower(device, control, status, compact) {
  const on = powerState(control, status);
  const toggle = h('button', {
    class: 'toggle',
    type: 'button',
    role: 'switch',
    'aria-checked': on === null ? 'mixed' : String(on),
    'aria-label': `${device.name} ${control.label}`,
    onclick: (e) => {
      const target = on !== true;
      const cmd = target ? control.on : control.off;
      send(device, cmd, {
        label: target ? 'An' : 'Aus',
        button: e.currentTarget,
        optimistic: () =>
          patchStatus(device, (s) => {
            if (control.statusKey) s.raw[control.statusKey] = target ? 1 : 0;
            else s.power = target;
          }),
      });
    },
  });
  if (compact) return toggle;
  return h(
    'div',
    { class: 'ctl' },
    h(
      'div',
      { class: 'power-row' },
      h('div', {}, h('div', { class: 'p-label' }, control.label), h('div', { class: 'p-state' }, on === null ? 'Unbekannt' : on ? 'An' : 'Aus')),
      toggle,
    ),
  );
}

function renderPress(device, control, { compact } = {}) {
  return h(
    'button',
    {
      class: `btn ${control.tone === 'primary' ? 'btn-accent' : ''} big-press`,
      type: 'button',
      onclick: (e) => send(device, control, { label: control.label, button: e.currentTarget }),
    },
    control.label,
  );
}

function renderButtons(device, control, { compact } = {}) {
  const row = h(
    'div',
    { class: 'row' },
    control.items.map((item) =>
      h(
        'button',
        {
          class: `btn${item.tone === 'primary' ? ' btn-accent' : item.tone === 'danger' ? ' btn-danger' : ''}`,
          type: 'button',
          onclick: (e) =>
            send(device, item, {
              label: compact || control.items.length > 1 ? item.label : `${control.label} ${item.label}`,
              button: e.currentTarget,
              optimistic: optimisticFor(device, item),
            }),
        },
        item.label,
      ),
    ),
  );
  if (compact) return row;
  return h('div', { class: 'ctl' }, h('p', { class: 'label' }, control.label), row);
}

function optimisticFor(device, item) {
  if (device.category === 'lock' && (item.command === 'lock' || item.command === 'unlock')) {
    return () =>
      patchStatus(device, (s) => {
        s.raw.lockState = item.command === 'lock' ? 'locked' : 'unlocked';
        const r = s.readings.find((x) => x.key === 'lockState');
        if (r) r.value = item.command === 'lock' ? 'Zu' : 'Offen';
      });
  }
  return undefined;
}

function renderSlider(device, control, status) {
  const current = control.statusKey ? Number(status?.raw?.[control.statusKey]) : NaN;
  const initial = Number.isFinite(current) ? current : Math.round((control.min + control.max) / 2 / control.step) * control.step;
  const valueEl = h('span', { class: 'ctl-value' }, Number.isFinite(current) ? `${initial}${control.unit ? ` ${control.unit}` : ''}` : '–');
  const input = h('input', {
    type: 'range',
    min: control.min,
    max: control.max,
    step: control.step,
    value: initial,
    class: control.unit === 'K' ? 'range-temp' : undefined,
    'aria-label': control.label,
  });
  const setFill = () => input.style.setProperty('--fill', `${((input.value - control.min) / (control.max - control.min)) * 100}%`);
  setFill();
  input.addEventListener('input', () => {
    valueEl.textContent = `${input.value}${control.unit ? ` ${control.unit}` : ''}`;
    setFill();
  });
  input.addEventListener('change', () => {
    const v = Number(input.value);
    send(device, { command: control.command, parameter: control.template.replace('{v}', String(v)), commandType: control.commandType }, {
      label: `${control.label} ${v}${control.unit ? ` ${control.unit}` : ''}`,
      optimistic: control.statusKey
        ? () =>
            patchStatus(device, (s) => {
              s.raw[control.statusKey] = v;
            })
        : undefined,
    });
  });
  return h(
    'div',
    { class: 'ctl' },
    h('div', { class: 'ctl-head' }, h('p', { class: 'label' }, control.label), valueEl),
    input,
    control.hint ? h('p', { class: 'ctl-hint' }, control.hint) : null,
  );
}

function renderSelect(device, control, status) {
  const current = control.statusKey ? status?.raw?.[control.statusKey] : undefined;
  return h(
    'div',
    { class: 'ctl' },
    h('p', { class: 'label' }, control.label),
    h(
      'div',
      { class: 'row' },
      control.options.map((o) =>
        h(
          'button',
          {
            class: `btn${current !== undefined && String(current) === String(o.value) ? ' is-active' : ''}`,
            type: 'button',
            'aria-pressed': String(current !== undefined && String(current) === String(o.value)),
            onclick: (e) =>
              send(device, { command: control.command, parameter: o.parameter, commandType: control.commandType }, {
                label: `${control.label}: ${o.label}`,
                button: e.currentTarget,
                optimistic: control.statusKey
                  ? () =>
                      patchStatus(device, (s) => {
                        s.raw[control.statusKey] = o.value;
                      })
                  : undefined,
              }),
          },
          o.label,
        ),
      ),
    ),
  );
}

const SWATCHES = [
  ['Warmweiß', '255:190:120'],
  ['Weiß', '255:255:255'],
  ['Rot', '255:0:0'],
  ['Orange', '255:110:0'],
  ['Pink', '255:0:140'],
  ['Lila', '140:0:255'],
  ['Blau', '0:80:255'],
  ['Grün', '0:255:90'],
];

function renderColor(device, control, status) {
  const current = control.statusKey ? status?.raw?.[control.statusKey] : undefined;
  const sendColor = (rgb, label) =>
    send(device, { command: control.command, parameter: rgb, commandType: control.commandType }, {
      label: `Farbe ${label}`,
      optimistic: control.statusKey
        ? () =>
            patchStatus(device, (s) => {
              s.raw[control.statusKey] = rgb;
            })
        : undefined,
    });
  const picker = h('input', { type: 'color', class: 'color-input', value: rgbToHex(current), 'aria-label': 'Eigene Farbe' });
  picker.addEventListener('change', () => sendColor(hexToRgb(picker.value), picker.value.toUpperCase()));
  return h(
    'div',
    { class: 'ctl' },
    h('p', { class: 'label' }, control.label),
    h(
      'div',
      { class: 'swatches' },
      SWATCHES.map(([name, rgb]) =>
        h('button', {
          class: `swatch${current === rgb ? ' is-active' : ''}`,
          type: 'button',
          title: name,
          'aria-label': name,
          style: { background: rgbToHex(rgb) },
          onclick: () => sendColor(rgb, name),
        }),
      ),
      picker,
    ),
  );
}

const AC_MODES = [
  ['Auto', 1],
  ['Kühlen', 2],
  ['Trocknen', 3],
  ['Lüften', 4],
  ['Heizen', 5],
];
const AC_FAN = [
  ['Auto', 1],
  ['Leise', 2],
  ['Mittel', 3],
  ['Stark', 4],
];

function renderAc(device, control) {
  const key = `ac:${device.id}`;
  const s = prefs.custom[key] ?? { temp: 24, mode: 2, fan: 1 };
  const save = () => {
    prefs.custom[key] = s;
    savePrefs();
  };
  const tempEl = h('span', { class: 's-value' }, `${s.temp}°`);
  const step = (d) => {
    s.temp = Math.max(16, Math.min(30, s.temp + d));
    tempEl.textContent = `${s.temp}°`;
    save();
  };
  const pills = (items, field) => {
    const row = h('div', { class: 'row' });
    const draw = () =>
      row.replaceChildren(
        ...items.map(([label, v]) =>
          h(
            'button',
            {
              class: `btn${s[field] === v ? ' is-active' : ''}`,
              type: 'button',
              onclick: () => {
                s[field] = v;
                save();
                draw();
              },
            },
            label,
          ),
        ),
      );
    draw();
    return row;
  };
  const go = (power) => (e) =>
    send(device, { command: control.command, parameter: `${s.temp},${s.mode},${s.fan},${power}`, commandType: control.commandType }, {
      label: power === 'on' ? `${s.temp}° ${AC_MODES.find(([, v]) => v === s.mode)?.[0]}` : 'Aus',
      button: e.currentTarget,
    });
  return h(
    'div',
    { class: 'ctl' },
    h('p', { class: 'label' }, control.label),
    h(
      'div',
      { class: 'stepper' },
      h('button', { class: 'btn', type: 'button', 'aria-label': 'Kälter', onclick: () => step(-1) }, '−'),
      tempEl,
      h('button', { class: 'btn', type: 'button', 'aria-label': 'Wärmer', onclick: () => step(1) }, '+'),
    ),
    h('p', { class: 'label' }, 'Modus'),
    pills(AC_MODES, 'mode'),
    h('p', { class: 'label' }, 'Lüfter'),
    pills(AC_FAN, 'fan'),
    h(
      'div',
      { class: 'row' },
      h('button', { class: 'btn btn-accent', type: 'button', onclick: go('on') }, 'Senden'),
      h('button', { class: 'btn', type: 'button', onclick: go('off') }, 'Ausschalten'),
    ),
  );
}

function renderNumber(device, control) {
  const input = h('input', { class: 'input', type: 'number', inputmode: 'numeric', min: control.min, max: control.max, placeholder: `${control.min}–${control.max}` });
  const submit = (e) => {
    e.preventDefault();
    const v = Number(input.value);
    if (!Number.isInteger(v) || v < control.min || v > control.max) return toast('Ungültige Zahl.', { error: true });
    send(device, { command: control.command, parameter: String(v), commandType: control.commandType }, { label: `${control.label} ${v}` });
  };
  return h(
    'form',
    { class: 'ctl', onsubmit: submit },
    h('p', { class: 'label' }, control.label),
    h('div', { class: 'row-tight' }, input, h('button', { class: 'btn btn-accent', type: 'submit' }, 'Los')),
  );
}

function renderCustom(device, control) {
  const key = `btn:${device.id}`;
  const saved = (prefs.custom[key] ??= []);
  const list = h('div', { class: 'saved' });
  const draw = () =>
    list.replaceChildren(
      ...saved.map((name) =>
        h(
          'span',
          { class: 'saved-item' },
          h('button', { class: 'btn', type: 'button', onclick: (e) => send(device, { command: name, parameter: 'default', commandType: 'customize' }, { label: name, button: e.currentTarget }) }, name),
          h(
            'button',
            {
              class: 'btn',
              type: 'button',
              'aria-label': `${name} entfernen`,
              onclick: () => {
                saved.splice(saved.indexOf(name), 1);
                savePrefs();
                draw();
              },
            },
            '×',
          ),
        ),
      ),
    );
  draw();
  const input = h('input', { class: 'input', type: 'text', maxlength: '64', placeholder: 'Tastenname aus der SwitchBot-App', autocomplete: 'off' });
  const submit = async (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) return;
    const ok = await send(device, { command: name, parameter: 'default', commandType: 'customize' }, { label: name });
    if (ok && !saved.includes(name)) {
      saved.push(name);
      savePrefs();
      draw();
      input.value = '';
    }
  };
  return h(
    'form',
    { class: 'ctl', onsubmit: submit },
    h('p', { class: 'label' }, control.label),
    list,
    h('div', { class: 'row-tight' }, input, h('button', { class: 'btn btn-accent', type: 'submit' }, 'Senden')),
    h('p', { class: 'ctl-hint' }, 'Exakt so schreiben wie in der App. Funktioniert eine Taste, wird sie hier gespeichert.'),
  );
}

function renderRaw(device, control) {
  const cmd = h('input', { class: 'input', type: 'text', placeholder: 'Befehl, z. B. turnOn', autocomplete: 'off' });
  const param = h('input', { class: 'input', type: 'text', placeholder: 'Parameter (default)', autocomplete: 'off' });
  const submit = (e) => {
    e.preventDefault();
    let parameter = param.value.trim() || 'default';
    if (/^[{[]/.test(parameter)) {
      try {
        parameter = JSON.parse(parameter);
      } catch {
        return toast('Parameter ist kein gültiges JSON.', { error: true });
      }
    }
    send(device, { command: cmd.value.trim(), parameter, commandType: 'command' }, { label: cmd.value.trim() });
  };
  return h(
    'form',
    { class: 'ctl', onsubmit: submit },
    h('p', { class: 'label' }, control.label),
    h('p', { class: 'note' }, `„${device.type}“ kennt die Zentrale noch nicht. Befehle findest du in der SwitchBot-API-Doku.`),
    cmd,
    h('div', { class: 'row-tight' }, param, h('button', { class: 'btn btn-accent', type: 'submit' }, 'Senden')),
  );
}

// ---------------------------------------------------------------- sheet

function openSheet(id) {
  const device = state.devices.find((d) => d.id === id);
  if (!device) return;
  state.sheetId = id;
  renderSheet(device, { force: true });
  const dlg = $('#sheet');
  if (!dlg.open) dlg.showModal();
  if (device.hasStatus) loadStatus(id).catch(handleError);
}

function renderSheet(device, { force = false } = {}) {
  const body = $('#sheet-body');
  // Nicht neu zeichnen, während jemand gerade tippt oder schiebt.
  if (!force && body.contains(document.activeElement) && document.activeElement.matches('input')) return;
  const entry = state.statuses.get(device.id);
  const status = entry?.status ?? null;
  const on = deviceIsOn(device, status);

  $('#sheet-title').textContent = device.name;
  $('#sheet-sub').textContent = subtitle(device);
  const ic = $('#sheet-icon');
  ic.innerHTML = categoryIcon(device);
  ic.classList.toggle('is-on', on);
  const fav = $('#fav-btn');
  fav.classList.toggle('is-fav', isFav(device.id));
  fav.setAttribute('aria-pressed', String(isFav(device.id)));

  const parts = [];
  if (!device.cloud) parts.push(h('p', { class: 'note' }, 'Cloud Service ist für dieses Gerät aus. In der SwitchBot-App aktivieren, sonst geht nichts.'));
  if (entry?.error) parts.push(h('p', { class: 'note err' }, entry.error));
  if (status?.readings?.length || typeof status?.battery === 'number') {
    const rs = [...(status.readings ?? [])];
    if (typeof status.battery === 'number') rs.push({ key: 'battery', label: 'Batterie', value: `${status.battery} %`, alert: status.battery <= 20 });
    parts.push(
      h(
        'div',
        { class: 'readings' },
        rs.map((r) => h('div', { class: `reading${r.alert ? ' alert' : ''}` }, h('span', { class: 'r-value' }, r.value), h('span', { class: 'r-label' }, r.label))),
      ),
    );
  }
  for (const c of device.controls) {
    if (!passesShowWhen(c, status)) continue;
    const el = renderControl(device, c, status, { compact: false });
    if (el) parts.push(el);
  }
  if (!device.controls.length && !status?.readings?.length) {
    parts.push(h('p', { class: 'note' }, device.hasStatus ? 'Lädt Status …' : 'Dieses Gerät hat keine Steuerung über die API.'));
  }
  if (status?.raw && Object.keys(status.raw).length) {
    parts.push(h('details', { class: 'raw' }, h('summary', {}, 'Rohdaten'), h('pre', {}, JSON.stringify(status.raw, null, 2))));
  }
  body.replaceChildren(...parts);
}

$('#sheet-close').addEventListener('click', () => $('#sheet').close());
$('#sheet').addEventListener('close', () => {
  state.sheetId = null;
});
$('#sheet').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) e.currentTarget.close(); // Klick auf Backdrop
});
$('#fav-btn').addEventListener('click', () => {
  const id = state.sheetId;
  if (!id) return;
  prefs.favorites = isFav(id) ? prefs.favorites.filter((x) => x !== id) : [...prefs.favorites, id];
  savePrefs();
  haptic();
  renderSheet(state.devices.find((d) => d.id === id), { force: true });
  renderFilters();
  renderGrid();
});

// ---------------------------------------------------------------- PWA

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

boot();

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createMockFetch, MOCK_SECRET, MOCK_TOKEN } from '../src/mock.js';

const BASE = 'https://zentrale.example';

function setup(envExtra = {}, { fetch = createMockFetch() } = {}) {
  let t = 1_800_000_000_000;
  const app = createApp({
    env: { SWITCHBOT_TOKEN: MOCK_TOKEN, SWITCHBOT_SECRET: MOCK_SECRET, APP_PASSWORD: 'richtig', ...envExtra },
    fetch,
    now: () => t,
    loginDelayMs: 0,
  });
  let cookie = '';
  const call = async (method, path, body, headers = {}) => {
    const res = await app(
      new Request(BASE + path, {
        method,
        headers: {
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(cookie ? { cookie } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      }),
      { ip: headers['x-test-ip'] ?? '1.2.3.4' },
    );
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, headers: res.headers, data: await res.json() };
  };
  return { call, fetch, tick: (ms) => (t += ms), clearCookie: () => (cookie = '') };
}

test('Health ohne Login, fehlende Config wird gemeldet', async () => {
  const { call } = setup();
  assert.deepEqual((await call('GET', '/api/health')).data, { ok: true, mock: false, missing: [] });
  const broken = createApp({ env: {} });
  const res = await broken(new Request(BASE + '/api/health'));
  assert.deepEqual((await res.json()).missing, ['APP_PASSWORD', 'SWITCHBOT_TOKEN', 'SWITCHBOT_SECRET']);
  const dev = await broken(new Request(BASE + '/api/devices'));
  assert.equal(dev.status, 500);
});

test('Ohne Login: alles 401', async () => {
  const { call } = setup();
  assert.equal((await call('GET', '/api/session')).data.authenticated, false);
  for (const [m, p, b] of [['GET', '/api/devices'], ['GET', '/api/scenes'], ['GET', '/api/devices/BOT001/status'], ['POST', '/api/devices/BOT001/command', { command: 'press' }]]) {
    assert.equal((await call(m, p, b)).status, 401, `${m} ${p}`);
  }
});

test('Login-Flow, Cookie-Flags, Logout', async () => {
  const { call } = setup();
  assert.equal((await call('POST', '/api/login', { password: 'falsch' })).status, 401);
  const res = await call('POST', '/api/login', { password: 'richtig' });
  assert.equal(res.status, 200);
  const cookie = res.headers.get('set-cookie');
  for (const flag of ['HttpOnly', 'SameSite=Strict', 'Secure', 'Max-Age=2592000']) assert.ok(cookie.includes(flag), flag);
  assert.equal((await call('GET', '/api/session')).data.authenticated, true);
  assert.equal((await call('POST', '/api/logout', {})).status, 200);
  assert.equal((await call('GET', '/api/session')).data.authenticated, false);
});

test('Session läuft nach SESSION_DAYS ab', async () => {
  const { call, tick } = setup({ SESSION_DAYS: '1' });
  await call('POST', '/api/login', { password: 'richtig' });
  tick(86_400_000 - 1000);
  assert.equal((await call('GET', '/api/session')).data.authenticated, true);
  tick(2000);
  assert.equal((await call('GET', '/api/devices')).status, 401);
});

test('Brute-Force-Sperre nach 5 Fehlversuchen (pro IP)', async () => {
  const { call } = setup();
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/api/login', { password: 'x' + i })).status, 401);
  const blocked = await call('POST', '/api/login', { password: 'richtig' });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  assert.equal((await call('POST', '/api/login', { password: 'richtig' }, { 'x-test-ip': '9.9.9.9' })).status, 200);
});

test('CSRF: fremder Origin & Nicht-JSON werden abgelehnt', async () => {
  const { call } = setup();
  assert.equal((await call('POST', '/api/login', { password: 'richtig' }, { origin: 'https://boese.example' })).status, 403);
  assert.equal((await call('POST', '/api/login', 'password=richtig', { 'content-type': 'application/x-www-form-urlencoded' })).status, 415);
  assert.equal((await call('POST', '/api/login', { password: 'richtig' }, { origin: BASE })).status, 200);
  assert.equal((await call('POST', '/api/devices/BOT001/command', { command: 'press' }, { origin: 'null' })).status, 403);
  assert.equal((await call('POST', '/api/login', '{kaputt')).status, 400);
  assert.equal((await call('POST', '/api/login', 'x'.repeat(9000))).status, 413);
});

test('Geräte, Status, Befehle, Szenen', async () => {
  const { call, fetch } = setup();
  await call('POST', '/api/login', { password: 'richtig' });

  const { devices } = (await call('GET', '/api/devices')).data;
  assert.equal(devices.length, 12);
  assert.ok(devices.every((d) => Array.isArray(d.controls)));

  const st = (await call('GET', '/api/devices/BULB01/status')).data.status;
  assert.equal(st.power, true);
  assert.equal(st.raw.brightness, 70);

  assert.equal((await call('GET', '/api/devices/02-TV-01/status')).data.status, null);

  assert.deepEqual((await call('POST', '/api/devices/BULB01/command', { command: 'setBrightness', parameter: '30' })).data, { ok: true });
  assert.equal((await call('GET', '/api/devices/BULB01/status')).data.status.raw.brightness, 30);

  const denied = await call('POST', '/api/devices/BULB01/command', { command: 'setBrightness', parameter: '300' });
  assert.equal(denied.status, 400);
  assert.match(denied.data.error, /nicht erlaubt/);

  assert.equal((await call('POST', '/api/devices/NOPE/command', { command: 'press' })).status, 404);
  assert.equal((await call('POST', '/api/devices/02-AC-01/command', { command: 'setAll', parameter: '22,5,1,on' })).status, 200);
  assert.deepEqual(fetch.state.log.at(-1).body, { command: 'setAll', parameter: '22,5,1,on', commandType: 'command' });

  const scenes = (await call('GET', '/api/scenes')).data.scenes;
  assert.deepEqual(scenes[0], { id: 'S-MORNING', name: 'Guten Morgen' });
  assert.equal((await call('POST', '/api/scenes/S-MORNING/execute', {})).status, 200);
  assert.equal((await call('POST', '/api/scenes/NOPE/execute', {})).status, 502);
  assert.equal((await call('GET', '/api/nope')).status, 404);
});

test('Cache: Geräteliste & Status sparen API-Calls, ?fresh umgeht', async () => {
  const { call, fetch, tick } = setup();
  await call('POST', '/api/login', { password: 'richtig' });
  const count = (p) => fetch.state.log.filter((l) => l.path === p).length;
  await call('GET', '/api/devices');
  await call('GET', '/api/devices');
  assert.equal(count('/devices'), 1);
  await call('GET', '/api/devices?fresh=1');
  assert.equal(count('/devices'), 2);
  tick(61_000);
  await call('GET', '/api/devices');
  assert.equal(count('/devices'), 3);

  await call('GET', '/api/devices/HUB001/status');
  await call('GET', '/api/devices/HUB001/status');
  assert.equal(count('/devices/HUB001/status'), 1);
  tick(11_000);
  await call('GET', '/api/devices/HUB001/status');
  assert.equal(count('/devices/HUB001/status'), 2);
});

test('SwitchBot-Fehler kommen verständlich an', async () => {
  const { call } = setup({}, { fetch: createMockFetch({ failOn: { BOT001: 161, BOT002: 190 } }) });
  await call('POST', '/api/login', { password: 'richtig' });
  const off = await call('GET', '/api/devices/BOT001/status');
  assert.equal(off.status, 502);
  assert.match(off.data.error, /offline/);
  assert.equal(off.data.code, 161);
  const sync = await call('POST', '/api/devices/BOT002/command', { command: 'press' });
  assert.match(sync.data.error, /Cloud Service/);
});

test('Falsche SwitchBot-Credentials → 502 mit Klartext', async () => {
  const { call } = setup({ SWITCHBOT_SECRET: 'falsch' });
  await call('POST', '/api/login', { password: 'richtig' });
  const res = await call('GET', '/api/devices');
  assert.equal(res.status, 502);
  assert.match(res.data.error, /Token\/Secret/);
});

test('Demo-Modus: Standardpasswort demo', async () => {
  const app = createApp({ env: { SWITCHBOT_MOCK: '1' }, loginDelayMs: 0 });
  const res = await app(new Request(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"password":"demo"}' }));
  assert.equal(res.status, 200);
});

test('Antworten haben Security-Header und no-store', async () => {
  const { call } = setup();
  const res = await call('GET', '/api/health');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
});

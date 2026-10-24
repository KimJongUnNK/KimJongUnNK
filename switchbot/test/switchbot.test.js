import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { authHeaders, createClient, sign, SwitchBotError } from '../src/switchbot.js';
import { createMockFetch, MOCK_SECRET, MOCK_TOKEN } from '../src/mock.js';

test('sign() entspricht dem offiziellen Node-Beispiel (HMAC-SHA256 → Base64)', async () => {
  const expected = createHmac('sha256', 'geheim').update('tok' + '1700000000000' + 'nonce-1').digest('base64');
  assert.equal(await sign('tok', 'geheim', '1700000000000', 'nonce-1'), expected);
});

test('authHeaders() liefert alle Pflicht-Header', async () => {
  const h = await authHeaders('tok', 'sec', { now: () => 1700000000000, uuid: () => 'u-1' });
  assert.equal(h.Authorization, 'tok');
  assert.equal(h.t, '1700000000000');
  assert.equal(h.nonce, 'u-1');
  assert.equal(h.sign, await sign('tok', 'sec', '1700000000000', 'u-1'));
  assert.match(h['Content-Type'], /application\/json/);
});

test('Client spricht mit Mock-Cloud (Signatur wird dort geprüft)', async () => {
  const fetch = createMockFetch();
  const c = createClient({ token: MOCK_TOKEN, secret: MOCK_SECRET, fetch });
  const body = await c.listDevices();
  assert.ok(body.deviceList.length > 0);
  assert.ok(body.infraredRemoteList.length > 0);
  await c.sendCommand('BOT002', { command: 'turnOff' });
  assert.equal((await c.getStatus('BOT002')).power, 'off');
  const last = fetch.state.log.at(-2);
  assert.deepEqual(last.body, { command: 'turnOff', parameter: 'default', commandType: 'command' });
});

test('Falsches Secret → verständlicher Fehler', async () => {
  const c = createClient({ token: MOCK_TOKEN, secret: 'falsch', fetch: createMockFetch() });
  await assert.rejects(c.listDevices(), (e) => e instanceof SwitchBotError && /abgelehnt/.test(e.message));
});

test('SwitchBot-Statuscodes werden übersetzt', async () => {
  const c = createClient({ token: MOCK_TOKEN, secret: MOCK_SECRET, fetch: createMockFetch({ failOn: { BOT001: 161 } }) });
  await assert.rejects(c.getStatus('BOT001'), (e) => e.code === 161 && /offline/.test(e.message));
  await assert.rejects(c.getStatus('NOPE'), (e) => e.code === 152 && e.status === 404);
});

test('Netzwerkfehler und HTTP-Fehler', async () => {
  const boom = createClient({ token: 't', secret: 's', fetch: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(boom.listDevices(), (e) => e.status === 504);
  const limited = createClient({ token: 't', secret: 's', fetch: async () => new Response('', { status: 429 }) });
  await assert.rejects(limited.listDevices(), (e) => e.status === 429);
  const bad = createClient({ token: 't', secret: 's', fetch: async () => new Response('kein json') });
  await assert.rejects(bad.listDevices(), /ungültiges JSON/);
});

test('Geräte-IDs werden URL-encodiert', async () => {
  let seen;
  const c = createClient({ token: 't', secret: 's', fetch: async (url) => { seen = url; return Response.json({ statusCode: 100, body: {} }); } });
  await c.getStatus('02-202008110034-13/../x');
  assert.ok(seen.endsWith('/devices/02-202008110034-13%2F..%2Fx/status'));
});

test('ohne Token/Secret wirft createClient', () => {
  assert.throws(() => createClient({ token: '', secret: '' }));
});

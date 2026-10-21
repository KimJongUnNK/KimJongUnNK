import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkPassword, createRateLimiter, createSession, deriveSessionKey, readCookie, sessionCookie, verifySession,
} from '../src/auth.js';

test('Passwortprüfung', async () => {
  assert.equal(await checkPassword('hunter2', 'hunter2', 'k'), true);
  assert.equal(await checkPassword('hunter3', 'hunter2', 'k'), false);
  assert.equal(await checkPassword('', 'hunter2', 'k'), false);
  assert.equal(await checkPassword(undefined, 'hunter2', 'k'), false);
  assert.equal(await checkPassword({}, 'hunter2', 'k'), false);
  assert.equal(await checkPassword('x', '', 'k'), false);
});

test('Session: gültig, abgelaufen, manipuliert, falscher Key', async () => {
  const now = 1_700_000_000_000;
  const tok = await createSession('key', { days: 1, now });
  assert.equal(await verifySession('key', tok, { now: now + 1000 }), true);
  assert.equal(await verifySession('key', tok, { now: now + 2 * 86_400_000 }), false);
  assert.equal(await verifySession('anderer', tok, { now }), false);
  const [p, s] = tok.split('.');
  const forged = Buffer.from(JSON.stringify({ v: 1, iat: now, exp: now * 2 })).toString('base64url');
  assert.equal(await verifySession('key', `${forged}.${s}`, { now }), false);
  assert.equal(await verifySession('key', `${p}.${s.slice(0, -2)}AA`, { now }), false);
  for (const junk of [null, '', 'abc', '.', 'a.', '.b', '!!!.???']) assert.equal(await verifySession('key', junk, { now }), false);
});

test('Session-Key: Passwortwechsel macht Sessions ungültig', async () => {
  const a = await deriveSessionKey({ password: 'eins', switchbotSecret: 's' });
  const b = await deriveSessionKey({ password: 'zwei', switchbotSecret: 's' });
  assert.notEqual(a, b);
  assert.equal(await deriveSessionKey({ sessionSecret: 'fix', password: 'eins' }), 'fix');
  const tok = await createSession(a);
  assert.equal(await verifySession(b, tok), false);
});

test('Cookies', () => {
  assert.equal(readCookie('a=1; zentrale_session=abc.def; b=2'), 'abc.def');
  assert.equal(readCookie('a=1'), null);
  assert.equal(readCookie(undefined), null);
  const c = sessionCookie('v', { secure: true, maxAge: 60 });
  for (const part of ['HttpOnly', 'SameSite=Strict', 'Secure', 'Max-Age=60', 'Path=/']) assert.ok(c.includes(part), part);
  assert.ok(!sessionCookie('v', { secure: false, maxAge: 1 }).includes('Secure'));
});

test('Rate-Limiter sperrt nach 5 Fehlversuchen und gibt nach Ablauf frei', () => {
  let t = 0;
  const rl = createRateLimiter({ limit: 5, windowMs: 1000, now: () => t });
  for (let i = 0; i < 4; i++) rl.fail('ip');
  assert.equal(rl.blocked('ip'), false);
  rl.fail('ip');
  assert.equal(rl.blocked('ip'), true);
  assert.equal(rl.blocked('andere-ip'), false);
  assert.equal(rl.retryAfter('ip'), 1);
  t = 1001;
  assert.equal(rl.blocked('ip'), false);
  rl.fail('ip');
  rl.reset('ip');
  assert.equal(rl.blocked('ip'), false);
});

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { createNodeServer, loadEnvFile } from '../server.js';

let server;
let base;

before(async () => {
  server = createNodeServer({ env: { SWITCHBOT_MOCK: '1', APP_PASSWORD: 'pw' } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const raw = (path) =>
  new Promise((ok, fail) => {
    const req = request(base + path, { method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body }));
    });
    req.path = path; // ohne Normalisierung senden
    req.on('error', fail);
    req.end();
  });

test('liefert die Oberfläche mit Security-Headern', async () => {
  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  assert.match(await res.text(), /Zentrale/);
  for (const f of ['app.js', 'style.css', 'icons.js', 'manifest.webmanifest', 'sw.js', 'icon-192.png', 'apple-touch-icon.png']) {
    assert.equal((await fetch(`${base}/${f}`)).status, 200, f);
  }
  assert.match((await fetch(base + '/app.js')).headers.get('content-type'), /javascript/);
});

test('kein Zugriff außerhalb von public/', async () => {
  for (const p of ['/../server.js', '/%2e%2e/server.js', '/..%2fserver.js', '/%2e%2e%2f.env', '/.env', '/_headers.txt', '/x/../../package.json']) {
    const res = await raw(p);
    assert.ok(!res.body.includes('createNodeServer') && !res.body.includes('"scripts"'), p);
  }
});

test('API läuft durch den Adapter inkl. Cookie', async () => {
  const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"password":"pw"}' });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const dev = await fetch(base + '/api/devices', { headers: { cookie } });
  assert.equal(dev.status, 200);
  assert.ok((await dev.json()).devices.length > 0);
});

test('SPA-Fallback und 404', async () => {
  assert.equal((await fetch(base + '/irgendwas')).status, 200);
  assert.equal((await fetch(base + '/fehlt.png')).status, 404);
});

test('.env-Loader', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zentrale-'));
  const file = join(dir, '.env');
  writeFileSync(file, '# Kommentar\nA=1\nB="mit leerzeichen"\nexport C=3 # inline\nD=schon-da\n\nkaputt\n');
  const env = { D: 'original' };
  loadEnvFile(file, env);
  assert.deepEqual(env, { A: '1', B: 'mit leerzeichen', C: '3', D: 'original' });
  loadEnvFile(join(dir, 'fehlt'), env);
});

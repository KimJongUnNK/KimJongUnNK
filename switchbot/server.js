// Node-Adapter: liefert public/ aus und reicht /api/* an src/app.js weiter.
// Start: `npm start` (liest .env automatisch). Keine Dependencies.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECURITY_HEADERS, createApp } from './src/app.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = resolve(ROOT, 'public');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/** Minimaler .env-Loader (KEY=VALUE, # Kommentare, optionale Quotes). Echte Env gewinnt. */
export function loadEnvFile(path, target = process.env) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    let value = m[2];
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '');
    if (target[m[1]] === undefined) target[m[1]] = value;
  }
}

async function serveStatic(pathname, res, method) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = normalize(join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + sep)) return false;
  const name = file.slice(PUBLIC.length + 1);
  if (name.split(sep).some((p) => p.startsWith('.') || p.startsWith('_'))) return false;
  try {
    if (!(await stat(file)).isFile()) return false;
  } catch {
    return false;
  }
  const ext = extname(file);
  const noCache = ext === '.html' || name === 'sw.js' || ext === '.webmanifest';
  res.writeHead(200, {
    'Content-Type': TYPES[ext] ?? 'application/octet-stream',
    'Cache-Control': noCache ? 'no-cache' : 'public, max-age=3600',
    ...SECURITY_HEADERS,
  });
  res.end(method === 'HEAD' ? undefined : await readFile(file));
  return true;
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((ok, fail) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        fail(Object.assign(new Error('too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => ok(Buffer.concat(chunks)));
    req.on('error', fail);
  });
}

export function createNodeServer({ env = process.env, fetch: fetchImpl } = {}) {
  const handle = createApp({ env, fetch: fetchImpl });
  const trustProxy = /^(1|true|yes)$/i.test(env.TRUST_PROXY ?? '');

  return createServer(async (req, res) => {
    try {
      const proto = trustProxy && req.headers['x-forwarded-proto'] ? String(req.headers['x-forwarded-proto']).split(',')[0] : 'http';
      const url = new URL(req.url, `${proto}://${req.headers.host ?? 'localhost'}`);

      if (url.pathname.startsWith('/api/')) {
        const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req);
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) {
          if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
        }
        const ip =
          (trustProxy && String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim()) || req.socket.remoteAddress;
        const response = await handle(new Request(url, { method: req.method, headers, body }), { ip });
        const out = {};
        response.headers.forEach((v, k) => (out[k] = v));
        res.writeHead(response.status, out);
        res.end(Buffer.from(await response.arrayBuffer()));
        return;
      }

      if ((req.method === 'GET' || req.method === 'HEAD') && (await serveStatic(url.pathname, res, req.method))) return;
      // SPA-Fallback
      if (req.method === 'GET' && !extname(url.pathname) && (await serveStatic('/index.html', res, req.method))) return;
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
      res.end('Nicht gefunden');
    } catch (err) {
      if (!res.headersSent) res.writeHead(err.status ?? 500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(err.status === 413 ? 'Zu groß' : 'Fehler');
      if (!err.status) console.error('[zentrale]', err);
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--demo')) process.env.SWITCHBOT_MOCK = '1';
  loadEnvFile(join(ROOT, '.env'));
  const port = Number(process.env.PORT) || 8787;
  const host = process.env.HOST || '0.0.0.0';
  createNodeServer().listen(port, host, () => {
    const mock = /^(1|true|yes|on)$/i.test(process.env.SWITCHBOT_MOCK ?? '');
    console.log(`Zentrale läuft auf http://localhost:${port}${mock ? '  (Demo-Modus, Passwort: ' + (process.env.APP_PASSWORD || 'demo') + ')' : ''}`);
  });
}

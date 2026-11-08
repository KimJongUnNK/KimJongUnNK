// Plattformneutraler HTTP-Handler (Fetch-API: Request → Response).
// Adapter: ../server.js (Node) und ../worker.js (Cloudflare Workers).

import {
  COOKIE_NAME,
  checkPassword,
  createRateLimiter,
  createSession,
  deriveSessionKey,
  readCookie,
  sessionCookie,
  verifySession,
} from './auth.js';
import { CommandError, describeStatus, resolveDeviceList, validateCommand } from './catalog.js';
import { MOCK_SECRET, MOCK_TOKEN, createMockFetch } from './mock.js';
import { SwitchBotError, createClient } from './switchbot.js';

const TTL = { devices: 60_000, scenes: 60_000, status: 10_000 };
const MAX_BODY = 8 * 1024;

export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

class HttpError extends Error {
  constructor(status, message, headers = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

const truthy = (v) => /^(1|true|yes|on)$/i.test(String(v ?? '').trim());

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...SECURITY_HEADERS,
      ...headers,
    },
  });
}

/** Kleiner Cache mit TTL und Zusammenlegen paralleler Anfragen. */
function createCache(now) {
  const store = new Map();
  return {
    async get(key, ttl, load, { fresh = false } = {}) {
      const hit = store.get(key);
      if (!fresh && hit && (hit.pending || now() - hit.at < ttl)) return hit.pending ?? hit.value;
      const pending = load();
      store.set(key, { pending, at: now() });
      try {
        const value = await pending;
        store.set(key, { value, at: now() });
        return value;
      } catch (err) {
        store.delete(key);
        throw err;
      }
    },
    delete(key) {
      store.delete(key);
    },
  };
}

/**
 * @param {{ env: Record<string,string|undefined>, fetch?: typeof fetch, now?: () => number, loginDelayMs?: number }} opts
 */
export function createApp({ env = {}, fetch: fetchImpl = globalThis.fetch, now = () => Date.now(), loginDelayMs = 400 } = {}) {
  const mock = truthy(env.SWITCHBOT_MOCK);
  const password = env.APP_PASSWORD || (mock ? 'demo' : '');
  const token = mock ? MOCK_TOKEN : env.SWITCHBOT_TOKEN;
  const secret = mock ? MOCK_SECRET : env.SWITCHBOT_SECRET;
  const sessionDays = Number(env.SESSION_DAYS) > 0 ? Number(env.SESSION_DAYS) : 30;

  const configErrors = [];
  if (!password) configErrors.push('APP_PASSWORD');
  if (!token) configErrors.push('SWITCHBOT_TOKEN');
  if (!secret) configErrors.push('SWITCHBOT_SECRET');

  const client = configErrors.length
    ? null
    : createClient({ token, secret, fetch: mock ? createMockFetch({ latencyMs: 250 }) : fetchImpl });

  const limiter = createRateLimiter({ now });
  const cache = createCache(now);
  let keyPromise;
  const sessionKey = () =>
    (keyPromise ??= deriveSessionKey({ sessionSecret: env.SESSION_SECRET, password, switchbotSecret: secret }));

  const devices = async (fresh = false) =>
    cache.get('devices', TTL.devices, async () => resolveDeviceList(await client.listDevices()), { fresh });

  async function findDevice(id) {
    let device = (await devices()).find((d) => d.id === id);
    if (!device) device = (await devices(true)).find((d) => d.id === id);
    if (!device) throw new HttpError(404, 'Gerät nicht gefunden.');
    return device;
  }

  async function readJson(request) {
    const type = request.headers.get('content-type') ?? '';
    if (!type.toLowerCase().startsWith('application/json')) throw new HttpError(415, 'JSON erwartet.');
    const text = await request.text();
    if (text.length > MAX_BODY) throw new HttpError(413, 'Anfrage zu groß.');
    if (!text) return {};
    try {
      const data = JSON.parse(text);
      return data && typeof data === 'object' ? data : {};
    } catch {
      throw new HttpError(400, 'Ungültiges JSON.');
    }
  }

  function checkOrigin(request, url) {
    const origin = request.headers.get('origin');
    if (!origin) return;
    let host;
    try {
      host = new URL(origin).host;
    } catch {
      throw new HttpError(403, 'Ungültiger Origin.');
    }
    const expected = request.headers.get('x-forwarded-host') ?? url.host;
    if (host !== expected && host !== url.host) throw new HttpError(403, 'Fremder Origin.');
  }

  async function isAuthed(request) {
    return verifySession(await sessionKey(), readCookie(request.headers.get('cookie')), { now: now() });
  }

  const isSecure = (request, url) =>
    url.protocol === 'https:' || (request.headers.get('x-forwarded-proto') ?? '').split(',')[0].trim() === 'https';

  // -------------------------------------------------------------------------

  async function route(request, url, ctx) {
    const { pathname } = url;
    const method = request.method.toUpperCase();

    if (pathname === '/api/health' && method === 'GET') {
      return json({ ok: configErrors.length === 0, mock, missing: configErrors });
    }

    if (configErrors.length) {
      throw new HttpError(500, `Server nicht fertig eingerichtet. Fehlende Variablen: ${configErrors.join(', ')}`);
    }

    if (method !== 'GET' && method !== 'HEAD') checkOrigin(request, url);

    if (pathname === '/api/session' && method === 'GET') {
      return json({ authenticated: await isAuthed(request), mock });
    }

    if (pathname === '/api/login' && method === 'POST') {
      const ip = ctx.ip ?? 'unknown';
      if (limiter.blocked(ip)) {
        const retry = limiter.retryAfter(ip);
        throw new HttpError(429, `Zu viele Fehlversuche. Probier's in ${Math.ceil(retry / 60)} min nochmal.`, {
          'Retry-After': String(retry),
        });
      }
      const body = await readJson(request);
      if (!(await checkPassword(body.password, password, await sessionKey()))) {
        limiter.fail(ip);
        if (loginDelayMs) await new Promise((r) => setTimeout(r, loginDelayMs));
        throw new HttpError(401, 'Falsches Passwort.');
      }
      limiter.reset(ip);
      const value = await createSession(await sessionKey(), { days: sessionDays, now: now() });
      return json(
        { ok: true },
        200,
        { 'Set-Cookie': sessionCookie(value, { secure: isSecure(request, url), maxAge: sessionDays * 86_400 }) },
      );
    }

    if (pathname === '/api/logout' && method === 'POST') {
      return json({ ok: true }, 200, {
        'Set-Cookie': `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`,
      });
    }

    // ---- ab hier nur eingeloggt ---------------------------------------------
    if (!(await isAuthed(request))) throw new HttpError(401, 'Nicht eingeloggt.');

    const fresh = url.searchParams.has('fresh');

    if (pathname === '/api/devices' && method === 'GET') {
      return json({ devices: await devices(fresh) });
    }

    let m = /^\/api\/devices\/([^/]+)\/status$/.exec(pathname);
    if (m && method === 'GET') {
      const device = await findDevice(decodeURIComponent(m[1]));
      if (!device.hasStatus) return json({ status: null });
      const raw = await cache.get(`status:${device.id}`, TTL.status, () => client.getStatus(device.id), { fresh });
      return json({ status: describeStatus(device, raw), at: now() });
    }

    m = /^\/api\/devices\/([^/]+)\/command$/.exec(pathname);
    if (m && method === 'POST') {
      const device = await findDevice(decodeURIComponent(m[1]));
      const cmd = validateCommand(device, await readJson(request));
      await client.sendCommand(device.id, cmd);
      cache.delete(`status:${device.id}`);
      return json({ ok: true });
    }

    if (pathname === '/api/scenes' && method === 'GET') {
      const scenes = await cache.get('scenes', TTL.scenes, () => client.listScenes(), { fresh });
      return json({
        scenes: (Array.isArray(scenes) ? scenes : []).map((s) => ({ id: String(s.sceneId), name: String(s.sceneName) })),
      });
    }

    m = /^\/api\/scenes\/([^/]+)\/execute$/.exec(pathname);
    if (m && method === 'POST') {
      await readJson(request);
      await client.executeScene(decodeURIComponent(m[1]));
      return json({ ok: true });
    }

    throw new HttpError(404, 'Nicht gefunden.');
  }

  /**
   * @param {Request} request
   * @param {{ ip?: string }} [ctx]
   */
  return async function handle(request, ctx = {}) {
    const url = new URL(request.url);
    try {
      return await route(request, url, ctx);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status, err.headers);
      if (err instanceof CommandError) return json({ error: err.message }, 400);
      if (err instanceof SwitchBotError) return json({ error: err.message, code: err.code }, err.status);
      console.error('[zentrale]', err);
      return json({ error: 'Interner Fehler.' }, 500);
    }
  };
}

// Login: ein Passwort (APP_PASSWORD) → signiertes Session-Cookie.
// Zustandslos (kein DB nötig), funktioniert auf Node und Cloudflare Workers.

const encoder = new TextEncoder();

export const COOKIE_NAME = 'zentrale_session';

const b64url = {
  encode(bytes) {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(str) {
    const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  },
};

async function hmac(keyMaterial, data) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(keyMaterial), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(data)));
}

function equalBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Passwortvergleich in konstanter Zeit (beide Seiten durch HMAC → gleiche Länge).
 */
export async function checkPassword(given, expected, pepper) {
  if (typeof given !== 'string' || !expected) return false;
  const [a, b] = await Promise.all([hmac(pepper, `pw:${given}`), hmac(pepper, `pw:${expected}`)]);
  return equalBytes(a, b);
}

/**
 * Leitet den Session-Schlüssel ab. Passwort ändern ⇒ alle Sessions ungültig.
 */
export async function deriveSessionKey({ sessionSecret, password, switchbotSecret }) {
  if (sessionSecret) return sessionSecret;
  return b64url.encode(await hmac(`${switchbotSecret ?? ''}`, `session-key:${password}`));
}

export async function createSession(key, { days = 30, now = Date.now() } = {}) {
  const payload = b64url.encode(encoder.encode(JSON.stringify({ v: 1, iat: now, exp: now + days * 86_400_000 })));
  const sig = b64url.encode(await hmac(key, payload));
  return `${payload}.${sig}`;
}

export async function verifySession(key, token, { now = Date.now() } = {}) {
  if (typeof token !== 'string' || !token.includes('.')) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  let given;
  try {
    given = b64url.decode(sig);
  } catch {
    return false;
  }
  if (!equalBytes(given, await hmac(key, payload))) return false;
  try {
    const data = JSON.parse(new TextDecoder().decode(b64url.decode(payload)));
    return data.v === 1 && typeof data.exp === 'number' && data.exp > now;
  } catch {
    return false;
  }
}

export function readCookie(header, name = COOKIE_NAME) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return null;
}

export function sessionCookie(value, { secure, maxAge }) {
  return [
    `${COOKIE_NAME}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAge}`,
    secure ? 'Secure' : null,
  ]
    .filter(Boolean)
    .join('; ');
}

/**
 * Einfacher Brute-Force-Schutz: max. `limit` Fehlversuche pro IP im Zeitfenster.
 * In-Memory – auf Workers pro Isolate (best effort), auf Node global.
 */
export function createRateLimiter({ limit = 5, windowMs = 15 * 60_000, now = () => Date.now() } = {}) {
  const hits = new Map();
  const prune = () => {
    const t = now();
    for (const [k, v] of hits) if (v.reset <= t) hits.delete(k);
  };
  return {
    blocked(key) {
      prune();
      const e = hits.get(key);
      return e ? e.count >= limit : false;
    },
    retryAfter(key) {
      const e = hits.get(key);
      return e ? Math.max(1, Math.ceil((e.reset - now()) / 1000)) : 0;
    },
    fail(key) {
      prune();
      const e = hits.get(key) ?? { count: 0, reset: now() + windowMs };
      e.count += 1;
      hits.set(key, e);
    },
    reset(key) {
      hits.delete(key);
    },
  };
}

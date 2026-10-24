// Minimaler SwitchBot-API-v1.1-Client. Läuft überall mit WebCrypto + fetch
// (Node ≥ 20, Cloudflare Workers, Deno, Bun).

export const API_BASE = 'https://api.switch-bot.com/v1.1';

const ERROR_MESSAGES = {
  151: 'Gerätetyp unterstützt diesen Befehl nicht.',
  152: 'Gerät nicht gefunden.',
  160: 'Befehl wird von diesem Gerät nicht unterstützt.',
  161: 'Gerät ist offline.',
  171: 'Hub ist offline.',
  190: 'Gerät hat den Befehl abgelehnt (falscher Parameter oder nicht synchron). Ist Cloud Service in der SwitchBot-App aktiv?',
};

export class SwitchBotError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, code?: number }} [info]
   */
  constructor(message, { status = 502, code } = {}) {
    super(message);
    this.name = 'SwitchBotError';
    this.status = status;
    this.code = code;
  }
}

const encoder = new TextEncoder();

function toBase64(buffer) {
  let s = '';
  for (const b of new Uint8Array(buffer)) s += String.fromCharCode(b);
  return btoa(s);
}

/**
 * Signatur: Base64(HMAC-SHA256(secret, token + t + nonce)).
 * Wie in den offiziellen Node- und Python-Beispielen ohne Uppercase – der
 * Uppercase-Schritt im Doku-Fließtext stammt aus der alten Hex-Variante.
 */
export async function sign(token, secret, t, nonce) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(`${token}${t}${nonce}`));
  return toBase64(sig);
}

export async function authHeaders(token, secret, { now = Date.now, uuid = () => crypto.randomUUID() } = {}) {
  const t = String(now());
  const nonce = uuid();
  return {
    Authorization: token,
    sign: await sign(token, secret, t, nonce),
    nonce,
    t,
    'Content-Type': 'application/json; charset=utf8',
  };
}

/**
 * @param {{ token: string, secret: string, fetch?: typeof fetch, base?: string, timeoutMs?: number }} opts
 */
export function createClient({ token, secret, fetch: fetchImpl = globalThis.fetch, base = API_BASE, timeoutMs = 10_000 }) {
  if (!token || !secret) throw new Error('SWITCHBOT_TOKEN und SWITCHBOT_SECRET müssen gesetzt sein.');

  async function request(method, path, body) {
    const headers = await authHeaders(token, secret);
    let res;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      throw new SwitchBotError(timeout ? 'SwitchBot-Cloud antwortet nicht (Timeout).' : 'SwitchBot-Cloud nicht erreichbar.', {
        status: 504,
      });
    }

    if (res.status === 401 || res.status === 403) {
      throw new SwitchBotError('SwitchBot hat Token/Secret abgelehnt – oder das Tageslimit (10.000 Calls) ist erreicht.', {
        status: 502,
      });
    }
    if (res.status === 429) throw new SwitchBotError('Zu viele Anfragen an SwitchBot. Kurz warten.', { status: 429 });
    if (!res.ok) throw new SwitchBotError(`SwitchBot-Fehler (HTTP ${res.status}).`, { status: 502 });

    let json;
    try {
      json = await res.json();
    } catch {
      throw new SwitchBotError('SwitchBot hat ungültiges JSON geliefert.');
    }
    if (json.statusCode !== 100) {
      const msg = ERROR_MESSAGES[json.statusCode] ?? `SwitchBot-Fehler ${json.statusCode}: ${json.message ?? 'unbekannt'}`;
      const status = json.statusCode === 152 ? 404 : json.statusCode === 160 || json.statusCode === 151 ? 400 : 502;
      throw new SwitchBotError(msg, { status, code: json.statusCode });
    }
    return json.body ?? {};
  }

  const id = (deviceId) => encodeURIComponent(deviceId);

  return {
    listDevices: () => request('GET', '/devices'),
    getStatus: (deviceId) => request('GET', `/devices/${id(deviceId)}/status`),
    sendCommand: (deviceId, { command, parameter = 'default', commandType = 'command' }) =>
      request('POST', `/devices/${id(deviceId)}/commands`, { command, parameter, commandType }),
    listScenes: () => request('GET', '/scenes'),
    executeScene: (sceneId) => request('POST', `/scenes/${id(sceneId)}/execute`),
  };
}

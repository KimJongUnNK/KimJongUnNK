// Fake-SwitchBot-Cloud für Demo-Modus (SWITCHBOT_MOCK=1) und Tests.
// Implementiert `fetch` und prüft die Signatur wie die echte API.

import { API_BASE, sign } from './switchbot.js';

export const MOCK_TOKEN = 'mock-token';
export const MOCK_SECRET = 'mock-secret';

function initialState() {
  return {
    devices: [
      { deviceId: 'BOT001', deviceName: 'Kaffeemaschine', deviceType: 'Bot', enableCloudService: true, hubDeviceId: 'HUB001' },
      { deviceId: 'BOT002', deviceName: 'Lichtschalter Flur', deviceType: 'Bot', enableCloudService: true, hubDeviceId: 'HUB001' },
      { deviceId: 'PLUG01', deviceName: 'Siebträger', deviceType: 'Plug Mini (EU)', enableCloudService: true, hubDeviceId: '' },
      { deviceId: 'BULB01', deviceName: 'Stehlampe', deviceType: 'Color Bulb', enableCloudService: true, hubDeviceId: '' },
      { deviceId: 'CURT01', deviceName: 'Vorhang Wohnzimmer', deviceType: 'Curtain3', enableCloudService: true, hubDeviceId: 'HUB001' },
      { deviceId: 'LOCK01', deviceName: 'Haustür', deviceType: 'Smart Lock Pro', enableCloudService: true, hubDeviceId: 'HUB001' },
      { deviceId: 'HUB001', deviceName: 'Hub 2', deviceType: 'Hub 2', enableCloudService: true, hubDeviceId: '000000000000' },
      { deviceId: 'METR01', deviceName: 'Schlafzimmer', deviceType: 'MeterPro(CO2)', enableCloudService: true, hubDeviceId: 'HUB001' },
      { deviceId: 'CONT01', deviceName: 'Balkontür', deviceType: 'Contact Sensor', enableCloudService: true, hubDeviceId: 'HUB001' },
    ],
    remotes: [
      { deviceId: '02-TV-01', deviceName: 'Fernseher', remoteType: 'TV', hubDeviceId: 'HUB001' },
      { deviceId: '02-AC-01', deviceName: 'Klimaanlage', remoteType: 'Air Conditioner', hubDeviceId: 'HUB001' },
      { deviceId: '02-DIY-01', deviceName: 'Soundbar', remoteType: 'Others', hubDeviceId: 'HUB001' },
    ],
    status: {
      BOT001: { power: 'off', battery: 100, version: 'V6.6', deviceMode: 'pressMode' },
      BOT002: { power: 'on', battery: 59, version: 'V6.6', deviceMode: 'switchMode' },
      PLUG01: { switchStatus: 1, voltage: 229.8, power: 1180.4, electricCurrent: 5140, usedElectricity: 7320 },
      BULB01: { power: 'on', brightness: 70, color: '255:180:90', colorTemperature: 3000 },
      CURT01: { calibrate: true, group: false, moving: false, battery: 100, slidePosition: 0 },
      LOCK01: { battery: 100, lockState: 'locked', doorState: 'closed', calibrate: true },
      HUB001: { temperature: 21.4, humidity: 46, lightLevel: 12 },
      METR01: { battery: 100, temperature: 19.2, humidity: 52, CO2: 820 },
      CONT01: { battery: 100, moveDetected: false, openState: 'close', brightness: 'bright' },
    },
    scenes: [
      { sceneId: 'S-MORNING', sceneName: 'Guten Morgen' },
      { sceneId: 'S-ALLOFF', sceneName: 'Alles aus' },
      { sceneId: 'S-MOVIE', sceneName: 'Filmabend' },
    ],
    log: [],
  };
}

const json = (body, statusCode = 100, message = 'success') =>
  new Response(JSON.stringify({ statusCode, message, body }), { headers: { 'content-type': 'application/json' } });

function applyCommand(state, id, { command, parameter }) {
  const s = state.status[id];
  if (!s) return; // IR-Fernbedienungen haben keinen Status
  switch (command) {
    case 'turnOn':
      if ('switchStatus' in s) s.switchStatus = 1;
      else if ('slidePosition' in s) s.slidePosition = 0;
      else s.power = 'on';
      break;
    case 'turnOff':
      if ('switchStatus' in s) s.switchStatus = 0;
      else if ('slidePosition' in s) s.slidePosition = 100;
      else s.power = 'off';
      break;
    case 'toggle':
      s.power = s.power === 'on' ? 'off' : 'on';
      break;
    case 'press':
      break;
    case 'setBrightness':
      s.brightness = Number(parameter);
      break;
    case 'setColor':
      s.color = parameter;
      break;
    case 'setColorTemperature':
      s.colorTemperature = Number(parameter);
      break;
    case 'setPosition':
      s.slidePosition = Number(String(parameter).split(/[,;]/).pop());
      break;
    case 'lock':
      s.lockState = 'locked';
      break;
    case 'unlock':
      s.lockState = 'unlocked';
      break;
    default:
  }
}

/**
 * @param {{ latencyMs?: number, failOn?: Record<string, number> }} [opts]
 *   failOn: deviceId → SwitchBot-statusCode, um Fehler zu simulieren.
 */
export function createMockFetch({ latencyMs = 0, failOn = {} } = {}) {
  const state = initialState();

  async function mockFetch(url, init = {}) {
    if (latencyMs) await new Promise((r) => setTimeout(r, latencyMs));
    const headers = new Headers(init.headers);
    const t = headers.get('t');
    const nonce = headers.get('nonce');
    if (headers.get('Authorization') !== MOCK_TOKEN || !t || !nonce) {
      return new Response('{"message":"Unauthorized"}', { status: 401 });
    }
    if (headers.get('sign') !== (await sign(MOCK_TOKEN, MOCK_SECRET, t, nonce))) {
      return new Response('{"message":"Unauthorized"}', { status: 401 });
    }

    const path = String(url).replace(API_BASE, '');
    const method = (init.method ?? 'GET').toUpperCase();
    state.log.push({ method, path, body: init.body ? JSON.parse(init.body) : undefined });

    if (method === 'GET' && path === '/devices') {
      return json({ deviceList: state.devices, infraredRemoteList: state.remotes });
    }
    let m = /^\/devices\/([^/]+)\/status$/.exec(path);
    if (method === 'GET' && m) {
      const id = decodeURIComponent(m[1]);
      if (failOn[id]) return json({}, failOn[id], 'error');
      const dev = state.devices.find((d) => d.deviceId === id);
      if (!dev) return json({}, 152, 'device not found');
      return json({ deviceId: id, deviceType: dev.deviceType, hubDeviceId: dev.hubDeviceId, ...state.status[id] });
    }
    m = /^\/devices\/([^/]+)\/commands$/.exec(path);
    if (method === 'POST' && m) {
      const id = decodeURIComponent(m[1]);
      if (failOn[id]) return json({}, failOn[id], 'error');
      const exists = state.devices.some((d) => d.deviceId === id) || state.remotes.some((d) => d.deviceId === id);
      if (!exists) return json({}, 152, 'device not found');
      applyCommand(state, id, JSON.parse(init.body));
      return json({});
    }
    if (method === 'GET' && path === '/scenes') return json(state.scenes);
    m = /^\/scenes\/([^/]+)\/execute$/.exec(path);
    if (method === 'POST' && m) {
      const id = decodeURIComponent(m[1]);
      if (!state.scenes.some((s) => s.sceneId === id)) return json({}, 190, 'scene not found');
      return json({});
    }
    return new Response('not found', { status: 404 });
  }

  mockFetch.state = state;
  return mockFetch;
}

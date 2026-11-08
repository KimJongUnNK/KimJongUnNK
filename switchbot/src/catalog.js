// Gerätekatalog: Welcher SwitchBot-Typ bekommt welche Steuerelemente,
// wie werden Status-Werte angezeigt und welche Befehle sind erlaubt.
// Quelle: https://github.com/OpenWonderLabs/SwitchBotAPI (v1.1, devices/*.md)
//
// Der Server schickt die Controls an die Oberfläche UND prüft jeden
// eingehenden Befehl gegen genau diese Liste (Whitelist).

const D = 'default';

const btn = (label, command, extra = {}) => ({
  label,
  command,
  parameter: D,
  commandType: 'command',
  ...extra,
});

const power = (extra = {}) => ({
  type: 'power',
  label: 'Power',
  on: btn('An', 'turnOn'),
  off: btn('Aus', 'turnOff'),
  quick: true,
  ...extra,
});

const buttons = (label, items, extra = {}) => ({ type: 'buttons', label, items, ...extra });

const slider = (label, command, min, max, extra = {}) => ({
  type: 'slider',
  label,
  command,
  commandType: 'command',
  template: '{v}',
  min,
  max,
  step: 1,
  unit: '',
  ...extra,
});

const select = (label, command, options, extra = {}) => ({
  type: 'select',
  label,
  command,
  commandType: 'command',
  options,
  ...extra,
});

const opt = (label, parameter, value = parameter) => ({ label, parameter, value });

const brightness = (statusKey = 'brightness') =>
  slider('Helligkeit', 'setBrightness', 1, 100, { unit: '%', statusKey });
const colorTemp = (command = 'setColorTemperature', statusKey = 'colorTemperature') =>
  slider('Farbtemperatur', command, 2700, 6500, { step: 100, unit: 'K', statusKey });
const color = (command = 'setColor', statusKey = 'color') => ({
  type: 'color',
  label: 'Farbe',
  command,
  commandType: 'command',
  statusKey,
});

// ---------------------------------------------------------------------------
// Physische Geräte
// ---------------------------------------------------------------------------

const fanControls = (variant) => {
  const pro = variant === 'pro';
  return [
    power(),
    select(
      'Modus',
      'setWindMode',
      [
        opt('Direkt', 'direct'),
        opt('Natürlich', 'natural'),
        opt('Schlaf', 'sleep'),
        pro ? opt('Hurricane', 'hurricane') : opt('Flüster', 'baby'),
      ],
      { statusKey: 'mode' },
    ),
    slider('Stärke', 'setWindSpeed', 1, 100, { unit: '%', statusKey: 'fanSpeed' }),
    select(
      'Nachtlicht',
      'setNightLightMode',
      pro
        ? [opt('Aus', 'off'), opt('Hell', '0'), opt('Sanft', '1')]
        : [opt('Aus', 'off'), opt('Hell', '1'), opt('Dimm', '2')],
      { statusKey: 'nightStatus' },
    ),
  ];
};

const lockControls = ({ deadbolt = true, nightLatch = false } = {}) => {
  const items = [
    btn('Zusperren', 'lock', { tone: 'primary' }),
    btn('Aufsperren', 'unlock', { tone: 'danger', confirm: 'Wirklich aufsperren?' }),
  ];
  const extra = [];
  if (deadbolt) extra.push(btn('Falle ziehen', 'deadbolt', { confirm: 'Falle wirklich ziehen?' }));
  if (nightLatch) extra.push(btn('Nachtriegel öffnen', 'nightLatchUnlock', { confirm: 'Nachtriegel wirklich öffnen?' }));
  const controls = [buttons('Schloss', items, { quick: true })];
  if (extra.length) controls.push(buttons('Extra', extra));
  return controls;
};

const vacuumLegacy = () => [
  buttons(
    'Saugen',
    [btn('Start', 'start', { tone: 'primary' }), btn('Stopp', 'stop'), btn('Zur Station', 'dock')],
    { quick: true },
  ),
  select('Saugstärke', 'PowLevel', [
    opt('Leise', '0'),
    opt('Standard', '1'),
    opt('Stark', '2'),
    opt('Max', '3'),
  ]),
];

const vacuumModern = ({ mop = false, sweepMop = false } = {}) => {
  const items = [
    btn('Saugen', 'startClean', {
      tone: 'primary',
      parameter: { action: 'sweep', param: { fanLevel: 2, times: 1 } },
    }),
  ];
  if (sweepMop) {
    items.push(
      btn('Saugen + Wischen', 'startClean', {
        parameter: { action: 'sweep_mop', param: { fanLevel: 2, waterLevel: 1, times: 1 } },
      }),
    );
  }
  if (mop) {
    items.push(btn('Wischen', 'startClean', { parameter: { action: 'mop', param: { fanLevel: 2, times: 1 } } }));
  }
  items.push(btn('Pause', 'pause'), btn('Zur Station', 'dock'));
  return [buttons('Reinigung', items, { quick: true })];
};

const curtainControls = () => [
  buttons(
    'Vorhang',
    [btn('Auf', 'turnOn'), btn('Stopp', 'pause'), btn('Zu', 'turnOff')],
    { quick: true },
  ),
  slider('Position', 'setPosition', 0, 100, {
    template: '0,ff,{v}',
    unit: '%',
    statusKey: 'slidePosition',
    hint: '0 = offen · 100 = zu',
  }),
];

/**
 * Regeln für physische Geräte. Erste passende Regel gewinnt.
 * `match` wird gegen den deviceType getestet.
 */
const PHYSICAL_RULES = [
  // --- Bot -----------------------------------------------------------------
  {
    match: /^Bot$/,
    category: 'bot',
    hasStatus: true,
    controls: () => [
      {
        type: 'button',
        ...btn('Drücken', 'press', { tone: 'primary' }),
        quick: true,
        showWhen: { key: 'deviceMode', notEquals: 'switchMode' },
      },
      power({ showWhen: { key: 'deviceMode', equals: 'switchMode' } }),
    ],
  },

  // --- Steckdosen & Schalter ----------------------------------------------
  { match: /^Plug$/, category: 'plug', hasStatus: true, controls: () => [power()] },
  { match: /^Plug Mini/, category: 'plug', hasStatus: true, controls: () => [power()] },
  {
    match: /^Relay Switch 2PM$/,
    category: 'switch',
    hasStatus: true,
    controls: () => [
      power({
        label: 'Kanal 1',
        on: btn('An', 'turnOn', { parameter: '1' }),
        off: btn('Aus', 'turnOff', { parameter: '1' }),
        statusKey: 'switch1Status',
      }),
      power({
        label: 'Kanal 2',
        on: btn('An', 'turnOn', { parameter: '2' }),
        off: btn('Aus', 'turnOff', { parameter: '2' }),
        statusKey: 'switch2Status',
      }),
    ],
  },
  {
    match: /^Relay Switch/,
    category: 'switch',
    hasStatus: true,
    controls: () => [power({ statusKey: 'switchStatus' })],
  },
  {
    match: /^Garage Door Opener$/,
    category: 'security',
    hasStatus: true,
    controls: () => [
      buttons(
        'Tor',
        [
          btn('Öffnen', 'turnOn', { tone: 'primary', confirm: 'Garagentor wirklich öffnen?' }),
          btn('Schließen', 'turnOff'),
        ],
        { quick: true },
      ),
    ],
  },

  // --- Licht ----------------------------------------------------------------
  {
    match: /^RGBICWW Ceiling Light$/,
    category: 'light',
    hasStatus: true,
    controls: () => [
      power(),
      buttons('Hauptlicht', [btn('An', 'turnOnMainLight'), btn('Aus', 'turnOffMainLight')]),
      slider('Helligkeit Haupt', 'setMainLightBrightness', 1, 100, { unit: '%' }),
      colorTemp('setMainLightColorTemp', null),
      buttons('Farblicht', [btn('An', 'turnOnColorLight'), btn('Aus', 'turnOffColorLight')]),
      slider('Helligkeit Farbe', 'setColorLightBrightness', 1, 100, { unit: '%' }),
      color('setColorLightRGB', null),
    ],
  },
  {
    match: /^Ceiling Light( Pro)?$/,
    category: 'light',
    hasStatus: true,
    controls: () => [power(), brightness(), colorTemp()],
  },
  {
    match: /^Candle Warmer Lamp$/,
    category: 'light',
    hasStatus: true,
    controls: () => [power(), brightness()],
  },
  {
    match: /^(Strip Light|RGBIC Neon (Wire )?Rope Light)$/,
    category: 'light',
    hasStatus: true,
    controls: () => [power(), brightness(), color()],
  },
  {
    match: /^(Color Bulb|Strip Light 3|Floor Lamp|RGBICWW Floor Lamp|RGBICWW Strip Light|Permanent Outdoor Lights)$/,
    category: 'light',
    hasStatus: true,
    controls: () => [power(), brightness(), color(), colorTemp()],
  },

  // --- Vorhänge & Rollos ----------------------------------------------------
  { match: /^Curtain3?$/, category: 'curtain', hasStatus: true, controls: curtainControls },
  {
    match: /^Roller Shade$/,
    category: 'curtain',
    hasStatus: true,
    controls: () => [
      buttons(
        'Rollo',
        [btn('Auf', 'setPosition', { parameter: '0' }), btn('Zu', 'setPosition', { parameter: '100' })],
        { quick: true },
      ),
      slider('Position', 'setPosition', 0, 100, {
        unit: '%',
        statusKey: 'slidePosition',
        hint: '0 = offen · 100 = zu',
      }),
    ],
  },
  {
    match: /^Blind Tilt$/,
    category: 'curtain',
    hasStatus: true,
    controls: () => [
      buttons(
        'Jalousie',
        [btn('Öffnen', 'fullyOpen'), btn('Zu ↑', 'closeUp'), btn('Zu ↓', 'closeDown')],
        { quick: true },
      ),
      slider('Neigung', 'setPosition', 0, 100, {
        template: 'up;{v}',
        step: 2,
        unit: '%',
        statusKey: 'slidePosition',
        hint: '0 = zu · 100 = offen',
      }),
    ],
  },

  // --- Schlösser & Sicherheit -----------------------------------------------
  { match: /^Keypad/, category: 'security', hasStatus: false, controls: () => [] },
  {
    match: /^(Lock Vision|Lock Vision Pro)$/,
    category: 'lock',
    hasStatus: true,
    controls: () => lockControls({ deadbolt: false }),
  },
  {
    match: /^Smart Lock Pro Wifi$/,
    category: 'lock',
    hasStatus: true,
    controls: () => lockControls({ nightLatch: true }),
  },
  {
    match: /^(Smart Lock|Smart Lock Pro|Smart Lock Ultra|Lock|Lock Lite|Lock Pro|Lock Ultra)$/,
    category: 'lock',
    hasStatus: true,
    controls: () => lockControls(),
  },
  {
    match: /^Video Doorbell$/,
    category: 'camera',
    hasStatus: false,
    controls: () => [
      buttons('Bewegungserkennung', [btn('An', 'enableMotionDetection'), btn('Aus', 'disableMotionDetection')]),
    ],
  },
  { match: /Cam/, category: 'camera', hasStatus: false, controls: () => [] },

  // --- Klima ------------------------------------------------------------------
  {
    match: /^Humidifier$/,
    category: 'climate',
    hasStatus: true,
    controls: () => [
      power(),
      select('Modus', 'setMode', [opt('Auto', 'auto'), opt('34 %', '101'), opt('67 %', '102'), opt('100 %', '103')]),
    ],
  },
  {
    match: /^Humidifier2$/,
    category: 'climate',
    hasStatus: true,
    controls: () => [
      power(),
      select(
        'Modus',
        'setMode',
        [
          opt('Auto', { mode: 7, targetHumidify: 50 }, 7),
          opt('Schlaf', { mode: 6, targetHumidify: 50 }, 6),
          opt('Ziel 50 %', { mode: 5, targetHumidify: 50 }, 5),
          opt('Stufe 1', { mode: 4, targetHumidify: 50 }, 4),
          opt('Stufe 2', { mode: 3, targetHumidify: 50 }, 3),
          opt('Stufe 3', { mode: 2, targetHumidify: 50 }, 2),
          opt('Stufe 4', { mode: 1, targetHumidify: 50 }, 1),
          opt('Trocknen', { mode: 8, targetHumidify: 50 }, 8),
        ],
        { statusKey: 'mode' },
      ),
    ],
  },
  {
    match: /^Air Purifier/,
    category: 'climate',
    hasStatus: true,
    controls: () => [
      power(),
      select(
        'Modus',
        'setMode',
        [
          opt('Auto', { mode: 2 }, 2),
          opt('Schlaf', { mode: 3 }, 3),
          opt('Haustier', { mode: 4 }, 4),
          opt('Stufe 1', { mode: 1, fanGear: 1 }, 'fan1'),
          opt('Stufe 2', { mode: 1, fanGear: 2 }, 'fan2'),
          opt('Stufe 3', { mode: 1, fanGear: 3 }, 'fan3'),
        ],
        { statusKey: 'mode' },
      ),
    ],
  },
  { match: /^Battery Circulator Fan 2 Pro$/, category: 'climate', hasStatus: true, controls: () => fanControls('pro') },
  {
    match: /^(Circulator Fan|Battery Circulator Fan|Standing Fan)$/,
    category: 'climate',
    hasStatus: true,
    controls: () => fanControls(),
  },
  {
    match: /^Smart Radiator Thermostat$/,
    category: 'climate',
    hasStatus: true,
    controls: () => [
      power(),
      select(
        'Modus',
        'setMode',
        [
          opt('Zeitplan', '0', 0),
          opt('Manuell', '1', 1),
          opt('Aus', '2', 2),
          opt('Eco', '3', 3),
          opt('Komfort', '4', 4),
          opt('Schnellheizen', '5', 5),
        ],
        { statusKey: 'mode' },
      ),
      slider('Zieltemperatur', 'setManualModeTemperature', 4, 35, { unit: '°C' }),
    ],
  },
  { match: /^Home Climate Panel$/, category: 'climate', hasStatus: true, controls: () => [] },

  // --- Saugroboter ------------------------------------------------------------
  {
    match: /K10\+ Pro Combo/,
    category: 'vacuum',
    hasStatus: true,
    controls: () => vacuumModern(),
  },
  {
    match: /(K11\+?|K20( Plus Pro|\+ Pro)?)$/,
    category: 'vacuum',
    hasStatus: true,
    controls: () => vacuumModern({ mop: true }),
  },
  {
    match: /(S10|S20)$/,
    category: 'vacuum',
    hasStatus: true,
    controls: () => vacuumModern({ sweepMop: true }),
  },
  {
    match: /(Robot Vacuum Cleaner S1( Plus)?|^K10\+( Pro)?)$/,
    category: 'vacuum',
    hasStatus: true,
    controls: vacuumLegacy,
  },

  // --- Sensoren & Hubs -------------------------------------------------------
  {
    match: /^(Meter|MeterPlus|MeterPro|MeterPro\(CO2\)|WoIOSensor|WeatherStation|Motion Sensor|Contact Sensor|Presence Sensor|Water Detector)$/,
    category: 'sensor',
    hasStatus: true,
    controls: () => [],
  },
  { match: /^(Hub 2|Hub 3|AI Hub)$/, category: 'hub', hasStatus: true, controls: () => [] },
  { match: /^Hub/, category: 'hub', hasStatus: false, controls: () => [] },

  // --- Sonstiges --------------------------------------------------------------
  {
    match: /^AI Art Frame$/,
    category: 'other',
    hasStatus: true,
    controls: () => [buttons('Bild', [btn('◀ Zurück', 'previous'), btn('Weiter ▶', 'next')], { quick: true })],
  },
  { match: /^Remote$/, category: 'other', hasStatus: false, controls: () => [] },
];

// ---------------------------------------------------------------------------
// Virtuelle IR-Fernbedienungen (über Hub)
// ---------------------------------------------------------------------------

const irPower = () =>
  buttons('Power', [btn('An', 'turnOn', { tone: 'primary' }), btn('Aus', 'turnOff')], { quick: true });

const irCustom = () => ({ type: 'custom', label: 'Eigene Tasten' });

const IR_RULES = [
  {
    match: /^Air Conditioner$/,
    category: 'climate',
    controls: () => [irPower(), { type: 'ac', label: 'Klimaanlage', command: 'setAll', commandType: 'command' }],
  },
  {
    match: /^(TV|IPTV|Streamer|Set Top Box)$/,
    category: 'tv',
    controls: () => [
      irPower(),
      buttons('Lautstärke', [btn('Leiser', 'volumeSub'), btn('Lauter', 'volumeAdd')]),
      buttons('Kanal', [btn('Zurück', 'channelSub'), btn('Weiter', 'channelAdd')]),
      { type: 'number', label: 'Kanal wählen', command: 'SetChannel', commandType: 'command', min: 1, max: 9999 },
    ],
  },
  {
    match: /^(DVD|Speaker)$/,
    category: 'tv',
    controls: (remoteType) => {
      const list = [
        irPower(),
        buttons('Wiedergabe', [btn('Play', 'Play', { tone: 'primary' }), btn('Pause', 'Pause'), btn('Stopp', 'Stop')]),
        buttons('Navigation', [
          btn('⏮', 'Previous'),
          btn('⏪', 'Rewind'),
          btn('⏩', 'FastForward'),
          btn('⏭', 'Next'),
        ]),
        buttons('Ton', [btn('Stumm', 'setMute')]),
      ];
      if (remoteType === 'Speaker') {
        list.splice(1, 0, buttons('Lautstärke', [btn('Leiser', 'volumeSub'), btn('Lauter', 'volumeAdd')]));
      }
      return list;
    },
  },
  {
    match: /^Fan$/,
    category: 'climate',
    controls: () => [
      irPower(),
      buttons('Stufe', [btn('Niedrig', 'lowSpeed'), btn('Mittel', 'middleSpeed'), btn('Hoch', 'highSpeed')]),
      buttons('Extras', [btn('Schwenken', 'swing'), btn('Timer', 'timer')]),
    ],
  },
  {
    match: /^Light$/,
    category: 'light',
    controls: () => [irPower(), buttons('Helligkeit', [btn('Dunkler', 'brightnessDown'), btn('Heller', 'brightnessUp')])],
  },
  { match: /^Others$/, category: 'remote', controls: () => [] },
];

// ---------------------------------------------------------------------------
// Öffentliche API
// ---------------------------------------------------------------------------

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

export const categoryLabel = (category) => CATEGORY_LABELS[category] ?? CATEGORY_LABELS.other;

const withIds = (controls) => controls.map((c, i) => ({ id: `c${i}`, ...c }));

/** Physisches Gerät aus /v1.1/devices → normalisiertes Gerät mit Controls. */
export function resolvePhysical(raw) {
  const type = String(raw.deviceType ?? '');
  const rule = PHYSICAL_RULES.find((r) => r.match.test(type));
  const controls = rule
    ? rule.controls(type)
    : // Unbekannter Gerätetyp: Status versuchen + Expertenbefehl anbieten.
      [{ type: 'raw', label: 'Expertenbefehl' }];
  return {
    id: String(raw.deviceId),
    name: String(raw.deviceName ?? raw.deviceId),
    type,
    remote: false,
    category: rule?.category ?? 'other',
    hasStatus: rule ? rule.hasStatus : true,
    cloud: raw.enableCloudService !== false,
    hubId: raw.hubDeviceId ?? null,
    supported: Boolean(rule),
    controls: withIds(controls),
  };
}

/** IR-Fernbedienung aus /v1.1/devices → normalisiertes Gerät mit Controls. */
export function resolveRemote(raw) {
  const remoteType = String(raw.remoteType ?? 'Others');
  const diy = /^DIY\s+/i.test(remoteType);
  const base = remoteType.replace(/^DIY\s+/i, '');
  const rule = IR_RULES.find((r) => r.match.test(base));
  let controls;
  if (rule) controls = rule.controls(base);
  else controls = [irPower()]; // Projector, Camera, Water Heater, … können laut Doku mind. An/Aus
  controls.push(irCustom());
  return {
    id: String(raw.deviceId),
    name: String(raw.deviceName ?? raw.deviceId),
    type: remoteType,
    remote: true,
    diy,
    category: rule?.category ?? 'remote',
    hasStatus: false,
    cloud: true,
    hubId: raw.hubDeviceId ?? null,
    supported: true,
    controls: withIds(controls),
  };
}

export function resolveDeviceList(body) {
  const physical = (body?.deviceList ?? []).map(resolvePhysical);
  const remotes = (body?.infraredRemoteList ?? []).map(resolveRemote);
  return [...physical, ...remotes];
}

// ---------------------------------------------------------------------------
// Befehls-Validierung (Whitelist)
// ---------------------------------------------------------------------------

export class CommandError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CommandError';
  }
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function sliderValue(control, parameter) {
  if (typeof parameter !== 'string' && typeof parameter !== 'number') return null;
  const [pre, post] = control.template.split('{v}');
  const m = new RegExp(`^${escapeRe(pre)}(-?\\d+)${escapeRe(post)}$`).exec(String(parameter));
  if (!m) return null;
  const v = Number(m[1]);
  if (v < control.min || v > control.max) return null;
  if ((v - control.min) % control.step !== 0) return null;
  return v;
}

/** Baut den Slider-Parameter so, wie die API ihn erwartet. */
export function sliderParameter(control, value) {
  return control.template.replace('{v}', String(value));
}

const isRgb = (p) => {
  const m = /^(\d{1,3}):(\d{1,3}):(\d{1,3})$/.exec(String(p));
  return Boolean(m) && m.slice(1).every((n) => Number(n) <= 255);
};

const isAcSetting = (p) => {
  const m = /^(\d{2}),([0-5]),([1-4]),(on|off)$/.exec(String(p));
  return Boolean(m) && Number(m[1]) >= 16 && Number(m[1]) <= 30;
};

const buttonItems = (c) => {
  switch (c.type) {
    case 'button':
      return [c];
    case 'buttons':
      return c.items;
    case 'power':
      return [c.on, c.off];
    case 'select':
      return c.options.map((o) => ({ command: c.command, commandType: c.commandType, parameter: o.parameter }));
    default:
      return [];
  }
};

/**
 * Prüft einen Befehl gegen die Controls eines Geräts.
 * Gibt den normalisierten Befehl zurück oder wirft CommandError.
 */
export function validateCommand(device, input) {
  if (!input || typeof input !== 'object') throw new CommandError('Befehl fehlt.');
  const command = input.command;
  const commandType = input.commandType ?? 'command';
  const parameter = input.parameter ?? D;
  if (typeof command !== 'string' || !command) throw new CommandError('Befehl fehlt.');

  for (const c of device.controls) {
    for (const item of buttonItems(c)) {
      if (item.command === command && (item.commandType ?? 'command') === commandType && same(item.parameter, parameter)) {
        return { command, parameter, commandType };
      }
    }
    if (commandType !== 'command' && c.type !== 'custom') continue;
    if (c.type === 'slider' && c.command === command && sliderValue(c, parameter) !== null) {
      return { command, parameter: String(parameter), commandType };
    }
    if (c.type === 'color' && c.command === command && isRgb(parameter)) {
      return { command, parameter: String(parameter), commandType };
    }
    if (c.type === 'ac' && c.command === command && isAcSetting(parameter)) {
      return { command, parameter: String(parameter), commandType };
    }
    if (c.type === 'number' && c.command === command) {
      const n = Number(parameter);
      if (Number.isInteger(n) && n >= c.min && n <= c.max && /^\d+$/.test(String(parameter))) {
        return { command, parameter: String(n), commandType };
      }
    }
    if (c.type === 'custom' && commandType === 'customize' && parameter === D) {
      // Selbst angelernte IR-Tasten: Name frei, aber kurz und ohne Steuerzeichen.
      if (command.length <= 64 && !/[\u0000-\u001f\u007f]/.test(command) && command.trim() === command) {
        return { command, parameter: D, commandType };
      }
    }
    if (c.type === 'raw' && commandType === 'command' && /^[A-Za-z][A-Za-z0-9]{0,40}$/.test(command)) {
      const ok =
        (typeof parameter === 'string' && parameter.length <= 200) ||
        (parameter && typeof parameter === 'object' && JSON.stringify(parameter).length <= 500);
      if (ok) return { command, parameter, commandType };
    }
  }
  throw new CommandError(`Befehl „${command}“ ist für ${device.name} nicht erlaubt.`);
}

// ---------------------------------------------------------------------------
// Status → Anzeige
// ---------------------------------------------------------------------------

const ON_VALUES = new Set(['on', 'ON', 'On', true, 1, '1']);
const OFF_VALUES = new Set(['off', 'OFF', 'Off', false, 0, '0']);

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const fmt = (v, digits = 0) => v.toLocaleString('de-AT', { minimumFractionDigits: digits, maximumFractionDigits: digits });

const MAPS = {
  lockState: { locked: 'Zu', unlocked: 'Offen', jammed: 'Blockiert', unlock: 'Offen', lock: 'Zu' },
  doorState: { closed: 'Zu', opened: 'Offen', open: 'Offen', close: 'Zu' },
  openState: { open: 'Offen', close: 'Zu', timeOutNotClose: 'Zu lange offen' },
  deviceMode: { pressMode: 'Drück-Modus', switchMode: 'Schalter-Modus', customizeMode: 'Custom-Modus' },
  workingStatus: {
    StandBy: 'Bereit',
    Clearing: 'Saugt',
    Cleaning: 'Saugt',
    Paused: 'Pausiert',
    GotoChargeBase: 'Fährt zur Station',
    Charging: 'Lädt',
    ChargeDone: 'Geladen',
    Dormant: 'Ruhemodus',
    InTrouble: 'Problem',
    InRemoteControl: 'Ferngesteuert',
    InDustCollecting: 'Entleert',
  },
};

/**
 * Normalisiert einen Status-Body für die Oberfläche.
 * @returns {{ power: boolean|null, battery: number|null, online: boolean|null,
 *             readings: {key:string,label:string,value:string,alert?:boolean}[], raw: object }}
 */
export function describeStatus(device, raw = {}) {
  const readings = [];
  const add = (key, label, value, alert = false) => readings.push({ key, label, value, ...(alert ? { alert } : {}) });

  // Power: `power` ist bei Plug Mini EU / Relay die Leistung in Watt → dann switchStatus nehmen.
  let power = null;
  if (typeof raw.power === 'string' && (ON_VALUES.has(raw.power) || OFF_VALUES.has(raw.power))) {
    power = ON_VALUES.has(raw.power);
  } else if (raw.switchStatus !== undefined) {
    power = ON_VALUES.has(raw.switchStatus);
  }

  let online = null;
  if (raw.onlineStatus) online = raw.onlineStatus !== 'offline';
  if (typeof raw.online === 'boolean') online = raw.online;

  const t = num(raw.temperature);
  if (t !== null) add('temperature', 'Temperatur', `${fmt(t, 1)} °C`);
  const h = num(raw.humidity);
  if (h !== null) add('humidity', 'Luftfeuchte', `${fmt(h)} %`);
  const co2 = num(raw.CO2);
  if (co2 !== null) add('CO2', 'CO₂', `${fmt(co2)} ppm`, co2 >= 1500);
  const lux = num(raw.lightLevel);
  if (lux !== null) add('lightLevel', 'Licht', `${lux}/20`);

  if (typeof raw.power === 'number') add('power', 'Leistung', `${fmt(raw.power, 1)} W`);
  if (num(raw.weight) !== null) add('weight', 'Verbrauch heute', `${fmt(raw.weight)} W`);
  if (num(raw.voltage) !== null) add('voltage', 'Spannung', `${fmt(raw.voltage, 1)} V`);
  if (num(raw.electricCurrent) !== null) add('electricCurrent', 'Strom', `${fmt(raw.electricCurrent)} mA`);
  if (num(raw.usedElectricity) !== null) add('usedElectricity', 'Heute', `${fmt(raw.usedElectricity / 60)} Wh`);
  if (num(raw.electricityOfDay) !== null) add('electricityOfDay', 'Laufzeit heute', `${fmt(raw.electricityOfDay)} min`);
  for (const ch of [1, 2]) {
    const p = num(raw[`switch${ch}Power`]);
    if (p !== null) add(`switch${ch}Power`, `Kanal ${ch}`, `${fmt(p, 1)} W`);
  }

  if (raw.lockState) add('lockState', 'Schloss', MAPS.lockState[raw.lockState] ?? raw.lockState, raw.lockState === 'jammed');
  if (raw.doorState) add('doorState', 'Tür', MAPS.doorState[raw.doorState] ?? raw.doorState);
  if (raw.openState) add('openState', 'Kontakt', MAPS.openState[raw.openState] ?? raw.openState, raw.openState === 'timeOutNotClose');
  if (typeof raw.moveDetected === 'boolean') add('moveDetected', 'Bewegung', raw.moveDetected ? 'Erkannt' : 'Keine');
  if (typeof raw.detected === 'boolean') add('detected', 'Anwesenheit', raw.detected ? 'Ja' : 'Nein');
  if (typeof raw.brightness === 'string') add('brightness', 'Umgebung', raw.brightness === 'bright' ? 'Hell' : 'Dunkel');
  if (device.type === 'Water Detector' && raw.status !== undefined) {
    const leak = Number(raw.status) === 1;
    add('status', 'Wasser', leak ? 'LECK!' : 'Trocken', leak);
  }
  if (device.type === 'Garage Door Opener' && raw.doorStatus !== undefined) {
    add('doorStatus', 'Tor', Number(raw.doorStatus) === 0 ? 'Offen' : 'Zu');
  }
  if (raw.workingStatus) add('workingStatus', 'Status', MAPS.workingStatus[raw.workingStatus] ?? raw.workingStatus, raw.workingStatus === 'InTrouble');
  if (raw.deviceMode) add('deviceMode', 'Modus', MAPS.deviceMode[raw.deviceMode] ?? raw.deviceMode);
  if (num(raw.nebulizationEfficiency) !== null) add('nebulizationEfficiency', 'Zerstäubung', `${raw.nebulizationEfficiency} %`);
  if (raw.lackWater === true) add('lackWater', 'Wasser', 'Tank leer', true);
  if (raw.moving === true) add('moving', 'Bewegung', 'Fährt …');
  if (raw.calibrate === false) add('calibrate', 'Kalibrierung', 'Fehlt', true);

  // Batterie: Segmentwerte (9/19/59/100 …) direkt als Prozent-Näherung anzeigen.
  const battery = num(raw.battery);

  return { power, battery, online, readings, raw };
}

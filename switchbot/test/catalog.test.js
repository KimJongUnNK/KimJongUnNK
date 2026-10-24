import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CommandError, describeStatus, resolveDeviceList, resolvePhysical, resolveRemote, sliderParameter, validateCommand } from '../src/catalog.js';

// Alle deviceType-Werte aus OpenWonderLabs/SwitchBotAPI devices/*.md (Stand 2026).
const DOC_TYPES = {
  'AI Art Frame': 'other', 'AI Hub': 'hub', 'Air Purifier PM2.5': 'climate', 'Air Purifier Table PM2.5': 'climate',
  'Air Purifier Table VOC': 'climate', 'Air Purifier VOC': 'climate', 'Battery Circulator Fan 2 Pro': 'climate',
  'Battery Circulator Fan': 'climate', 'Blind Tilt': 'curtain', Bot: 'bot', 'Candle Warmer Lamp': 'light',
  'Ceiling Light Pro': 'light', 'Ceiling Light': 'light', 'Circulator Fan': 'climate', 'Color Bulb': 'light',
  'Contact Sensor': 'sensor', Curtain3: 'curtain', Curtain: 'curtain', 'Floor Lamp': 'light',
  'Garage Door Opener': 'security', 'Home Climate Panel': 'climate', 'Hub 2': 'hub', 'Hub 3': 'hub', Hub: 'hub',
  'Hub Mini': 'hub', 'Hub Plus': 'hub', Humidifier2: 'climate', Humidifier: 'climate', 'Indoor Cam': 'camera',
  'K10+ Pro': 'vacuum', 'K10+': 'vacuum', 'Keypad Touch': 'security', 'Keypad Vision Pro': 'security',
  'Keypad Vision': 'security', Keypad: 'security', 'Lock Lite': 'lock', 'Lock Ultra': 'lock', 'Lock Vision Pro': 'lock',
  'Lock Vision': 'lock', MeterPlus: 'sensor', 'MeterPro(CO2)': 'sensor', MeterPro: 'sensor', Meter: 'sensor',
  'Motion Sensor': 'sensor', 'Pan/Tilt Cam 2K': 'camera', 'Pan/Tilt Cam Plus 2K': 'camera',
  'Pan/Tilt Cam Plus 3K': 'camera', 'Pan/Tilt Cam': 'camera', 'Permanent Outdoor Lights': 'light',
  'Plug Mini (EU)': 'plug', 'Plug Mini (JP)': 'plug', 'Plug Mini (US)': 'plug', Plug: 'plug', 'Presence Sensor': 'sensor',
  'RGBIC Neon Rope Light': 'light', 'RGBIC Neon Wire Rope Light': 'light', 'RGBICWW Ceiling Light': 'light',
  'RGBICWW Floor Lamp': 'light', 'RGBICWW Strip Light': 'light', 'Relay Switch 1PM': 'switch',
  'Relay Switch 1': 'switch', 'Relay Switch 2PM': 'switch', Remote: 'other',
  'Robot Vacuum Cleaner K10+ Pro Combo': 'vacuum', 'Robot Vacuum Cleaner K11+': 'vacuum',
  'Robot Vacuum Cleaner K20 Plus Pro': 'vacuum', 'Robot Vacuum Cleaner S1 Plus': 'vacuum',
  'Robot Vacuum Cleaner S10': 'vacuum', 'Robot Vacuum Cleaner S1': 'vacuum', 'Robot Vacuum Cleaner S20': 'vacuum',
  'Roller Shade': 'curtain', 'Smart Lock Pro Wifi': 'lock', 'Smart Lock Pro': 'lock', 'Smart Lock Ultra': 'lock',
  'Smart Lock': 'lock', 'Smart Radiator Thermostat': 'climate', 'Standing Fan': 'climate', 'Strip Light 3': 'light',
  'Strip Light': 'light', 'Video Doorbell': 'camera', 'Water Detector': 'sensor', WeatherStation: 'sensor',
  WoIOSensor: 'sensor',
};

const dev = (deviceType, extra = {}) => resolvePhysical({ deviceId: 'X', deviceName: 'Test', deviceType, enableCloudService: true, ...extra });
const ok = (d, cmd) => validateCommand(d, cmd);
const bad = (d, cmd) => assert.throws(() => validateCommand(d, cmd), CommandError);

test('jeder dokumentierte Gerätetyp wird erkannt und richtig einsortiert', () => {
  for (const [type, category] of Object.entries(DOC_TYPES)) {
    const d = dev(type);
    assert.equal(d.supported, true, `${type} nicht unterstützt`);
    assert.equal(d.category, category, `${type}: ${d.category} ≠ ${category}`);
    const ids = d.controls.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length, `${type}: doppelte Control-IDs`);
  }
});

test('unbekannter Typ: Expertenbefehl, Status wird versucht', () => {
  const d = dev('Kata Friends');
  assert.equal(d.supported, false);
  assert.equal(d.hasStatus, true);
  assert.equal(d.controls[0].type, 'raw');
  assert.deepEqual(ok(d, { command: 'backHome' }), { command: 'backHome', parameter: 'default', commandType: 'command' });
  bad(d, { command: 'rm -rf /' });
  bad(d, { command: 'x', parameter: 'a'.repeat(201) });
  bad(d, { command: 'x', commandType: 'customize' });
});

test('Bot: press/turnOn/turnOff, sonst nix', () => {
  const d = dev('Bot');
  for (const command of ['press', 'turnOn', 'turnOff']) assert.equal(ok(d, { command }).command, command);
  bad(d, { command: 'toggle' });
  bad(d, { command: 'press', parameter: 'evil' });
  bad(d, { command: 'press', commandType: 'customize' });
  bad(d, {});
  bad(d, null);
  bad(d, { command: 42 });
});

test('Licht: Slider/Farbe/Temperatur mit Grenzen', () => {
  const d = dev('Color Bulb');
  assert.equal(ok(d, { command: 'setBrightness', parameter: '1' }).parameter, '1');
  assert.equal(ok(d, { command: 'setBrightness', parameter: 100 }).parameter, '100');
  bad(d, { command: 'setBrightness', parameter: '0' });
  bad(d, { command: 'setBrightness', parameter: '101' });
  bad(d, { command: 'setBrightness', parameter: '50.5' });
  bad(d, { command: 'setBrightness', parameter: '50; drop' });
  assert.equal(ok(d, { command: 'setColor', parameter: '255:0:128' }).parameter, '255:0:128');
  bad(d, { command: 'setColor', parameter: '256:0:0' });
  bad(d, { command: 'setColor', parameter: '#ff0000' });
  assert.ok(ok(d, { command: 'setColorTemperature', parameter: '2700' }));
  bad(d, { command: 'setColorTemperature', parameter: '2750' }); // step 100
  bad(d, { command: 'setColorTemperature', parameter: '7000' });
  bad(dev('Ceiling Light'), { command: 'setColor', parameter: '1:2:3' });
});

test('Vorhang: Template 0,ff,{v}', () => {
  const d = dev('Curtain3');
  const slider = d.controls.find((c) => c.type === 'slider');
  assert.equal(sliderParameter(slider, 80), '0,ff,80');
  assert.ok(ok(d, { command: 'setPosition', parameter: '0,ff,80' }));
  bad(d, { command: 'setPosition', parameter: '80' });
  bad(d, { command: 'setPosition', parameter: '0,ff,101' });
  assert.ok(ok(d, { command: 'pause' }));
});

test('Rollo & Jalousie', () => {
  const r = dev('Roller Shade');
  assert.ok(ok(r, { command: 'setPosition', parameter: '0' }));
  assert.ok(ok(r, { command: 'setPosition', parameter: '55' }));
  const b = dev('Blind Tilt');
  assert.ok(ok(b, { command: 'setPosition', parameter: 'up;48' }));
  bad(b, { command: 'setPosition', parameter: 'up;47' }); // muss gerade sein
  assert.ok(ok(b, { command: 'closeDown' }));
});

test('Schloss: Aufsperren braucht Bestätigung, Vision ohne deadbolt', () => {
  const d = dev('Smart Lock Pro');
  const unlock = d.controls[0].items.find((i) => i.command === 'unlock');
  assert.ok(unlock.confirm);
  assert.ok(ok(d, { command: 'deadbolt' }));
  bad(dev('Lock Vision'), { command: 'deadbolt' });
  assert.ok(ok(dev('Smart Lock Pro Wifi'), { command: 'nightLatchUnlock' }));
});

test('JSON-Parameter (Saugroboter, Luftreiniger) müssen exakt passen', () => {
  const v = dev('Robot Vacuum Cleaner S10');
  const sweep = { action: 'sweep', param: { fanLevel: 2, times: 1 } };
  assert.deepEqual(ok(v, { command: 'startClean', parameter: sweep }).parameter, sweep);
  bad(v, { command: 'startClean', parameter: { action: 'sweep', param: { fanLevel: 4, times: 99 } } });
  assert.ok(ok(dev('Robot Vacuum Cleaner S1'), { command: 'PowLevel', parameter: '3' }));
  bad(dev('Robot Vacuum Cleaner S1'), { command: 'PowLevel', parameter: '4' });
  assert.ok(ok(dev('Air Purifier VOC'), { command: 'setMode', parameter: { mode: 1, fanGear: 3 } }));
});

test('Relay Switch 2PM: Kanäle', () => {
  const d = dev('Relay Switch 2PM');
  assert.ok(ok(d, { command: 'turnOn', parameter: '2' }));
  bad(d, { command: 'turnOn', parameter: '3' });
  bad(d, { command: 'turnOn' });
});

test('IR: Power, Klima setAll, Kanal, eigene Tasten', () => {
  const ac = resolveRemote({ deviceId: 'A', deviceName: 'Klima', remoteType: 'Air Conditioner' });
  assert.equal(ac.remote, true);
  assert.ok(ok(ac, { command: 'turnOn' }));
  assert.ok(ok(ac, { command: 'setAll', parameter: '26,2,3,on' }));
  bad(ac, { command: 'setAll', parameter: '35,2,3,on' });
  bad(ac, { command: 'setAll', parameter: '26,9,3,on' });

  const tv = resolveRemote({ deviceId: 'T', deviceName: 'TV', remoteType: 'TV' });
  assert.equal(ok(tv, { command: 'SetChannel', parameter: '15' }).parameter, '15');
  bad(tv, { command: 'SetChannel', parameter: '-1' });
  bad(tv, { command: 'SetChannel', parameter: '1e3' });
  assert.ok(ok(tv, { command: 'volumeAdd' }));

  const diy = resolveRemote({ deviceId: 'D', deviceName: 'Soundbar', remoteType: 'DIY Speaker' });
  assert.equal(diy.diy, true);
  assert.ok(ok(diy, { command: 'Play' }));
  assert.ok(ok(diy, { command: 'Bass +', commandType: 'customize' }));
  bad(diy, { command: ' leading', commandType: 'customize' });
  bad(diy, { command: 'x'.repeat(65), commandType: 'customize' });
  bad(diy, { command: 'a\nb', commandType: 'customize' });
  bad(diy, { command: 'Bass', commandType: 'customize', parameter: 'x' });

  const others = resolveRemote({ deviceId: 'O', deviceName: 'X', remoteType: 'Others' });
  bad(others, { command: 'turnOn' });
  assert.ok(ok(others, { command: 'Licht', commandType: 'customize' }));

  const projector = resolveRemote({ deviceId: 'P', deviceName: 'Beamer', remoteType: 'Projector' });
  assert.ok(ok(projector, { command: 'turnOff' }));
});

test('resolveDeviceList kombiniert beide Listen', () => {
  const list = resolveDeviceList({
    deviceList: [{ deviceId: '1', deviceName: 'B', deviceType: 'Bot', enableCloudService: false }],
    infraredRemoteList: [{ deviceId: '2', deviceName: 'TV', remoteType: 'TV' }],
  });
  assert.equal(list.length, 2);
  assert.equal(list[0].cloud, false);
  assert.equal(list[1].remote, true);
  assert.deepEqual(resolveDeviceList({}), []);
  assert.deepEqual(resolveDeviceList(undefined), []);
});

test('describeStatus: Power, Watt vs. ON/OFF, Sensoren, Alarme', () => {
  const plug = describeStatus(dev('Plug Mini (EU)'), { switchStatus: 1, power: 12.5, voltage: 230, usedElectricity: 120 });
  assert.equal(plug.power, true);
  assert.ok(plug.readings.find((r) => r.key === 'power').value.includes('W'));
  assert.equal(plug.readings.find((r) => r.key === 'usedElectricity').value, '2 Wh');

  assert.equal(describeStatus(dev('Bot'), { power: 'off' }).power, false);
  assert.equal(describeStatus(dev('Color Bulb'), { power: 'ON' }).power, true);
  assert.equal(describeStatus(dev('Meter'), { temperature: 21.44 }).readings[0].value, '21,4 °C');

  const co2 = describeStatus(dev('MeterPro(CO2)'), { CO2: 1800 });
  assert.equal(co2.readings.find((r) => r.key === 'CO2').alert, true);

  const leak = describeStatus(dev('Water Detector'), { status: 1, battery: 80 });
  assert.equal(leak.readings[0].value, 'LECK!');
  assert.equal(leak.battery, 80);

  const lock = describeStatus(dev('Smart Lock'), { lockState: 'jammed', doorState: 'opened' });
  assert.deepEqual(lock.readings.map((r) => r.value), ['Blockiert', 'Offen']);

  assert.equal(describeStatus(dev('Robot Vacuum Cleaner S1'), { onlineStatus: 'offline' }).online, false);
  assert.equal(describeStatus(dev('Relay Switch 2PM'), { online: true }).online, true);
  assert.equal(describeStatus(dev('Bot'), {}).power, null);
  assert.deepEqual(describeStatus(dev('Bot')).readings, []);
});

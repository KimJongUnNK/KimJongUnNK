// Inline-SVG-Icons (24×24, currentColor). Bewusst simpel und kräftig.

const svg = (body, { fill = false } = {}) =>
  `<svg viewBox="0 0 24 24" width="24" height="24" fill="${fill ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  // UI
  refresh: svg('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>'),
  logout: svg('<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5"/><path d="M5 12h11"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  star: svg('<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>'),
  play: svg('<path d="M7 4.5v15l12-7.5z"/>', { fill: true }),
  battery: svg('<rect x="3" y="7" width="16" height="10" rx="2"/><path d="M22 11v2"/><path d="M6 10v4"/>'),

  // Kategorien
  bot: svg('<rect x="4" y="6" width="16" height="13" rx="3"/><circle cx="12" cy="12.5" r="2.6"/><path d="M12 2v4"/>'),
  plug: svg('<path d="M9 2v5M15 2v5"/><path d="M6 7h12v4a6 6 0 0 1-12 0z"/><path d="M12 17v5"/>'),
  switch: svg('<rect x="2" y="7" width="20" height="10" rx="5"/><circle cx="16" cy="12" r="2.6"/>'),
  light: svg('<path d="M9 18h6M10 21.5h4"/><path d="M12 2.5a6.5 6.5 0 0 0-4 11.6c.7.6 1 1.4 1 2.2V18h6v-1.7c0-.8.3-1.6 1-2.2A6.5 6.5 0 0 0 12 2.5z"/>'),
  curtain: svg('<path d="M3 3h18"/><path d="M5 3v18c2-1 3-4 3-9S7 4 5 3z"/><path d="M19 3v18c-2-1-3-4-3-9s1-8 3-9z"/>'),
  lock: svg('<rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/><path d="M12 15v2"/>'),
  security: svg('<path d="M12 2.5l8 3v6c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10v-6z"/>'),
  climate: svg('<path d="M14 14.8V4a2 2 0 0 0-4 0v10.8a4 4 0 1 0 4 0z"/><path d="M12 9v8"/>'),
  vacuum: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.2"/><path d="M12 3v3"/>'),
  sensor: svg('<circle cx="12" cy="12" r="2"/><path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7"/><path d="M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8"/>'),
  hub: svg('<path d="M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5z"/><circle cx="12" cy="12" r="2.4"/>'),
  camera: svg('<rect x="2.5" y="6.5" width="13" height="11" rx="2.5"/><path d="M15.5 10.5l6-3.5v10l-6-3.5"/>'),
  tv: svg('<rect x="2.5" y="4.5" width="19" height="13" rx="2.5"/><path d="M8 21h8"/>'),
  remote: svg('<rect x="7" y="2.5" width="10" height="19" rx="3"/><circle cx="12" cy="8" r="1.8"/><path d="M10 13h.01M14 13h.01M10 16.5h.01M14 16.5h.01"/>'),
  other: svg('<circle cx="6" cy="6" r="1.8"/><circle cx="18" cy="6" r="1.8"/><circle cx="6" cy="18" r="1.8"/><circle cx="18" cy="18" r="1.8"/>'),
  fan: svg('<circle cx="12" cy="12" r="1.8"/><path d="M12 10.2C11 6 12 3 14.5 3S18 6 13.8 10.8"/><path d="M13.8 12c4.2-1 7.2 0 7.2 2.5S18 18 13.2 13.8"/><path d="M12 13.8c1 4.2 0 7.2-2.5 7.2S6 18 10.2 13.2"/><path d="M10.2 12C6 13 3 12 3 9.5S6 6 10.8 10.2"/>'),
  ac: svg('<rect x="2.5" y="4.5" width="19" height="9" rx="2.5"/><path d="M6 10.5h12"/><path d="M8 17c0 1.5-1 2.5-1 4M12 17v4M16 17c0 1.5 1 2.5 1 4"/>'),
};

/** Passendes Icon für ein Gerät (feiner als nur die Kategorie). */
export function categoryIcon(device) {
  const t = String(device.type ?? '');
  if (device.remote && /Air Conditioner/.test(t)) return ICONS.ac;
  if (/Fan/.test(t)) return ICONS.fan;
  if (/Keypad|Garage/.test(t)) return ICONS.security;
  if (device.remote && device.category === 'remote') return ICONS.remote;
  return ICONS[device.category] ?? ICONS.other;
}

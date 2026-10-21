// Cloudflare-Workers-Adapter. Statische Dateien kommen aus public/ (Assets-Binding),
// /api/* läuft durch src/app.js. Secrets per `npx wrangler secret put …`.

import { createApp } from './src/app.js';

let app;
let appEnv;

export default {
  async fetch(request, env) {
    if (!app || appEnv !== env) {
      app = createApp({ env });
      appEnv = env;
    }
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      return app(request, { ip: request.headers.get('cf-connecting-ip') ?? undefined });
    }
    return env.ASSETS.fetch(request);
  },
};

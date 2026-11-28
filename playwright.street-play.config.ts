import { defineConfig } from '@playwright/test';
const webPort=Number(process.env.STREET_TEST_WEB_PORT||5196),apiPort=Number(process.env.STREET_TEST_API_PORT||2596);
const web=`http://127.0.0.1:${webPort}`,api=`http://127.0.0.1:${apiPort}`;

// Street play only: snowballs, snowmen, benches, kiosk, postcard and evening in the connected host.
export default defineConfig({
  testDir: './tests', testMatch: ['street-play.spec.ts','roof-play.spec.ts','toilet-play.spec.ts','floors-play.spec.ts'], timeout: 240000, workers: 1,
  use: { baseURL: web, channel: 'chrome', trace: 'off' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: [
    { command: `node node_modules/vite/bin/vite.js preview --config tests/street.vite.config.ts --host 127.0.0.1 --port ${webPort} --strictPort`, url: web, env: { ROYAL_DEV_API_URL: api }, reuseExistingServer: false },
    { command: 'node dist-server/index.js', url: api+'/healthz', env: { PORT: String(apiPort), PUBLIC_ORIGIN: web, CODEX_SALE_API_KEY: '', NOWPAYMENTS_ENABLED: 'false', NOWPAYMENTS_GAMES_ENABLED: 'false' }, reuseExistingServer: false },
  ],
});

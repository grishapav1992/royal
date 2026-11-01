import { defineConfig } from '@playwright/test';
const webPort=Number(process.env.STREET_TEST_WEB_PORT||5191),apiPort=Number(process.env.STREET_TEST_API_PORT||2591);
const web=`http://127.0.0.1:${webPort}`,api=`http://127.0.0.1:${apiPort}`;

export default defineConfig({
  testDir: './tests', testMatch: 'street.spec.ts', timeout: 120000, workers: 1,
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

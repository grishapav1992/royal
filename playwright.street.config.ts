import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests', testMatch: 'street.spec.ts', timeout: 120000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:5191', channel: 'chrome', trace: 'off' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: [
    { command: 'node node_modules/vite/bin/vite.js preview --config tests/street.vite.config.ts --host 127.0.0.1 --port 5191 --strictPort', url: 'http://127.0.0.1:5191', env: { ROYAL_DEV_API_URL: 'http://127.0.0.1:2591' }, reuseExistingServer: false },
    { command: 'node dist-server/index.js', url: 'http://127.0.0.1:2591/healthz', env: { PORT: '2591', PUBLIC_ORIGIN: 'http://127.0.0.1:5191', CODEX_SALE_API_KEY: '', NOWPAYMENTS_ENABLED: 'false', NOWPAYMENTS_GAMES_ENABLED: 'false' }, reuseExistingServer: false },
  ],
});

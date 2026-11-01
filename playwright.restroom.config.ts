import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests', testMatch: 'restroom.spec.ts', timeout: 120000, workers: 1,
  outputDir: 'artifacts/work/third-floor-restroom/test-results',
  use: { baseURL: 'http://127.0.0.1:5364', channel: 'chrome', viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure', actionTimeout: 15000 },
  webServer: [
    { command: 'node node_modules/vite/bin/vite.js preview --config vite.restroom.config.ts --host 127.0.0.1 --port 5364 --strictPort', url: 'http://127.0.0.1:5364', reuseExistingServer: false, env: { ROYAL_DEV_API_URL: 'http://127.0.0.1:2764' } },
    { command: 'node --import tsx scripts/database-test.ts --import tsx server/index.ts', url: 'http://127.0.0.1:2764/healthz', reuseExistingServer: false, env: { PORT: '2764', CODEX_SALE_API_KEY: '' } },
  ],
});

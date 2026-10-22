import { defineConfig } from '@playwright/test';

const api = 'http://127.0.0.1:2584';
const web = 'http://127.0.0.1:5184';
// Run under scripts/database-test.ts so the real backend only sees a temporary database.
export default defineConfig({
  testDir: './tests', testMatch: ['chat-real-transport.spec.ts', 'chat-layout.spec.ts'],
  timeout: 60000, workers: 1, reporter: 'list', outputDir: 'artifacts/chat-real-results',
  use: { baseURL: web, channel: 'chrome', viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' },
  webServer: [
    { command: 'node --import tsx server/index.ts', url: api + '/healthz', reuseExistingServer: false,
      env: { PORT: '2584', NODE_ENV: 'test', CODEX_SALE_API_KEY: '' }, timeout: 60000 },
    { command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5184 --strictPort', url: web,
      reuseExistingServer: false, env: { ROYAL_DEV_API_URL: api }, timeout: 60000 },
  ],
});

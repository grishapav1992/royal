import { defineConfig } from '@playwright/test';

const api = 'http://127.0.0.1:2584';
const web = 'http://127.0.0.1:5184';
const built = process.env.CHAT_REAL_BUILT === '1';
process.env.TEST_BASE_URL ??= api;
// Run under scripts/database-test.ts so the real backend only sees a temporary database.
export default defineConfig({
  testDir: './tests', testMatch: ['chat-real-transport.spec.ts', 'chat-real-hidden-entry.spec.ts', 'chat-layout.spec.ts'],
  timeout: 60000, workers: 1, reporter: 'list', outputDir: 'artifacts/chat-real-results',
  use: { baseURL: built ? api : web, channel: 'chrome', viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' },
  webServer: [
    { command: built ? 'node dist-server/index.js' : 'node --import tsx server/index.ts', url: api + '/healthz', reuseExistingServer: false,
      env: { PORT: '2584', NODE_ENV: 'test', AUTH_DB_PATH: 'test_chat_real', CODEX_SALE_API_KEY: '' }, timeout: 60000 },
    ...built ? [] : [{ command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5184 --strictPort', url: web,
      reuseExistingServer: false, env: { ROYAL_DEV_API_URL: api }, timeout: 60000 }],
  ],
});

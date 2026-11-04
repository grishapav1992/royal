import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: 'profile-walk.spec.ts', workers: 1, timeout: 60000,
  use: { baseURL: 'http://127.0.0.1:5198', channel: 'chrome', viewport: { width: 1440, height: 1000 } },
  webServer: { command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5198 --strictPort', url: 'http://127.0.0.1:5198', reuseExistingServer: true },
});

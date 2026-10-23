import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: ['skin-studio.spec.ts', 'atelier-room.spec.ts'], timeout: 60000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:5193', channel: 'chrome', viewport: { width: 1440, height: 1000 } },
  webServer: { command: 'npm run dev:web -- --host 127.0.0.1 --port 5193 --strictPort', url: 'http://127.0.0.1:5193', reuseExistingServer: false },
});

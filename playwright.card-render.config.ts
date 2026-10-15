import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: 'card-table-render.spec.ts', workers: 1, timeout: 30000,
  outputDir: 'artifacts/royal-card-floor-20261011/render-test-results',
  use: { baseURL: 'http://127.0.0.1:5295', channel: 'chrome', viewport: { width: 1100, height: 720 }, trace: 'retain-on-failure' },
  webServer: { command: 'node_modules/.bin/vite --host 127.0.0.1 --port 5295 --strictPort', url: 'http://127.0.0.1:5295', reuseExistingServer: false, timeout: 30000 },
});

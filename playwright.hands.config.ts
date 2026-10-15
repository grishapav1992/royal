import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests', testMatch: 'dealer-hands.spec.ts', workers: 1, timeout: 60000,
  outputDir: 'artifacts/dealer-hands-20261014/test-results',
  use: { baseURL: 'http://127.0.0.1:5224', channel: 'chrome', viewport: { width: 1366, height: 768 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'node_modules/.bin/vite --host 127.0.0.1 --port 5224 --strictPort', url: 'http://127.0.0.1:5224', reuseExistingServer: false, timeout: 30000 },
});

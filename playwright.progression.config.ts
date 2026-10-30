import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests', testMatch: 'progression-host.spec.ts', workers: 1, timeout: 90000,
  outputDir: 'artifacts/work/location-levels-mvp/browser-results',
  use: { baseURL: 'http://127.0.0.1:5392', channel: 'chrome', viewport: { width: 1440, height: 1000 }, headless: true },
  webServer: { command: 'node --import tsx scripts/progression-preview.ts', url: 'http://127.0.0.1:5392', timeout: 90000, reuseExistingServer: false },
});

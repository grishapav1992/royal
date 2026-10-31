import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests', testMatch: 'flag-tote-host.spec.ts', fullyParallel: false, workers: 1, timeout: 90000,
  use: { baseURL: 'http://127.0.0.1:5237', channel: 'chrome', viewport: { width: 1440, height: 1000 }, trace: 'off', screenshot: 'only-on-failure' },
  outputDir: 'artifacts/work/flag-tote/verification', reporter: [['list']],
  webServer: { command: 'node --import tsx scripts/flag-tote-preview.ts', url: 'http://127.0.0.1:5237', reuseExistingServer: true, timeout: 45000 } });

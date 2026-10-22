import { defineConfig } from '@playwright/test';

export default defineConfig({
 testDir: './tests',
 testMatch: 'startup-loading.spec.ts',
 workers: 1,
 timeout: 60000,
 outputDir: 'test-results/startup',
 webServer: process.env.TEST_BASE_URL ? undefined : {
  command: 'npm run preview -- --port 4177', url: 'http://127.0.0.1:4177', reuseExistingServer: true,
 },
 use: {
  baseURL: process.env.TEST_BASE_URL || 'http://127.0.0.1:4177',
  channel: 'chrome',
  screenshot: 'only-on-failure',
  trace: 'retain-on-failure',
 },
});

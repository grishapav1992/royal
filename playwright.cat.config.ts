import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: 'cat-idle.spec.ts',
  timeout: 45000,
  workers: 1,
  outputDir: 'artifacts/work/cat-idle-animation/test-results',
  use: { baseURL: 'http://127.0.0.1:5278', channel: 'chrome' },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5278 --strictPort',
    url: 'http://127.0.0.1:5278',
    reuseExistingServer: true,
  },
});

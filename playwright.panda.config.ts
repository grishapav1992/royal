import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests', testMatch: 'panda-dragon.spec.ts', workers: 1, timeout: 90_000,
  outputDir: 'artifacts/work/panda-integration/browser',
  use: { channel: 'chrome', baseURL: 'http://127.0.0.1:5298' },
  webServer: {
    command: 'node --import tsx scripts/entry-modes-local.ts',
    env: { ENTRY_WEB_PORT: '5298', ENTRY_API_PORT: '2798' },
    url: 'http://127.0.0.1:5298', timeout: 60_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
  },
});

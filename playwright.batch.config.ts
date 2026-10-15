import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

const source = process.env.ROYAL_BATCH_SOURCE_DIR ? resolve(process.env.ROYAL_BATCH_SOURCE_DIR) : undefined;
export default defineConfig({
  testDir: './tests', testMatch: 'casino-batch-variants.spec.ts', timeout: 240000, workers: 1,
  outputDir: (process.env.ROYAL_BATCH_ARTIFACTS_DIR || 'artifacts/casino-batch-20261011') + '/browser-results',
  use: { baseURL: process.env.ROYAL_BATCH_URL || 'http://127.0.0.1:5204', channel: 'chrome', viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure', trace: 'retain-on-failure', actionTimeout: 15000 },
  webServer: process.env.ROYAL_BATCH_URL ? undefined : [
    { command: 'ROYAL_DEV_API_URL=http://127.0.0.1:2604 npm run dev:web -- --port 5204 --strictPort', cwd: source, url: 'http://127.0.0.1:5204', reuseExistingServer: false },
    { command: 'PORT=2604 CODEX_SALE_API_KEY= node --import tsx server/index.ts', cwd: source, url: 'http://127.0.0.1:2604/healthz', reuseExistingServer: false },
  ],
});

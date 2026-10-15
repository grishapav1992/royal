import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

const sourceDirectory = process.env.ROYAL_VARIANTS_SOURCE_DIR ? resolve(process.env.ROYAL_VARIANTS_SOURCE_DIR) : undefined;

export default defineConfig({
  testDir: './tests', testMatch: 'casino-variants.spec.ts', timeout: 240000, workers: 1,
  outputDir: 'artifacts/casino-variants/test-results',
  use: {
    baseURL: process.env.ROYAL_VARIANTS_URL || 'http://127.0.0.1:5199', channel: 'chrome',
    viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure', trace: 'retain-on-failure', actionTimeout: 15000,
  },
  webServer: process.env.ROYAL_VARIANTS_URL ? undefined : [
    { command: 'ROYAL_DEV_API_URL=http://127.0.0.1:2599 npm run dev:web -- --port 5199 --strictPort', cwd: sourceDirectory, url: 'http://127.0.0.1:5199', reuseExistingServer: false },
    { command: 'PORT=2599 CODEX_SALE_API_KEY= node --import tsx server/index.ts', cwd: sourceDirectory, url: 'http://127.0.0.1:2599/healthz', reuseExistingServer: false },
  ],
});

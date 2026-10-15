import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

const sourceDirectory = process.env.ROYAL_NEXT_VARIANTS_SOURCE_DIR ? resolve(process.env.ROYAL_NEXT_VARIANTS_SOURCE_DIR) : undefined;

export default defineConfig({
  testDir: './tests', testMatch: 'casino-next-variants.spec.ts', timeout: 240000, workers: 1,
  outputDir: 'artifacts/casino-next-variants/test-results',
  use: {
    baseURL: process.env.ROYAL_NEXT_VARIANTS_URL || 'http://127.0.0.1:5200', channel: 'chrome',
    viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure', trace: 'retain-on-failure', actionTimeout: 15000,
  },
  webServer: process.env.ROYAL_NEXT_VARIANTS_URL ? undefined : [
    { command: 'ROYAL_DEV_API_URL=http://127.0.0.1:2600 npm run dev:web -- --port 5200 --strictPort', cwd: sourceDirectory, url: 'http://127.0.0.1:5200', reuseExistingServer: false },
    { command: 'PORT=2600 CODEX_SALE_API_KEY= node --import tsx server/index.ts', cwd: sourceDirectory, url: 'http://127.0.0.1:2600/healthz', reuseExistingServer: false },
  ],
});

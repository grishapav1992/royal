import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

const sourceDirectory = process.env.ROYAL_AUDIT_SOURCE_DIR ? resolve(process.env.ROYAL_AUDIT_SOURCE_DIR) : undefined;

export default defineConfig({
  testDir: './tests', testMatch: 'casino-variants-fault-audit.spec.ts', timeout: 240000, workers: 1,
  outputDir: 'artifacts/casino-audit-20261011/browser-test-results',
  use: {
    baseURL: process.env.ROYAL_AUDIT_URL || 'http://127.0.0.1:5202', channel: 'chrome', viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure', trace: 'retain-on-failure', actionTimeout: 15000,
  },
  webServer: process.env.ROYAL_AUDIT_URL ? undefined : [
    { command: 'ROYAL_DEV_API_URL=http://127.0.0.1:2602 npm run dev:web -- --port 5202 --strictPort', cwd: sourceDirectory, url: 'http://127.0.0.1:5202', reuseExistingServer: false },
    { command: 'PORT=2602 CODEX_SALE_API_KEY= node --import tsx server/index.ts', cwd: sourceDirectory, url: 'http://127.0.0.1:2602/healthz', reuseExistingServer: false },
  ],
});

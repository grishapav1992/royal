import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

const source = process.env.ROYAL_NEON_SOURCE_DIR ? resolve(process.env.ROYAL_NEON_SOURCE_DIR) : undefined;
export default defineConfig({
  testDir: './tests', testMatch: 'neon-presentation.spec.ts', workers: 1, fullyParallel: false, timeout: 45000,
  outputDir: 'artifacts/neon-slot-20261012/tests/browser-results',
  use: { baseURL: 'http://127.0.0.1:5183', channel: 'chrome', viewport: { width: 1440, height: 900 }, actionTimeout: 10000, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'node_modules/.bin/vite --host 127.0.0.1 --port 5183 --strictPort', cwd: source, url: 'http://127.0.0.1:5183', reuseExistingServer: false, timeout: 30000 },
});

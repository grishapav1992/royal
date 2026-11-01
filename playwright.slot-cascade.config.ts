import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: 'slot-cascade-geometry.spec.ts',
  workers: 1,
  timeout: 15000,
  outputDir: 'test-results/slot-cascade',
  use: { channel: 'chrome', viewport: { width: 1440, height: 1000 } },
});

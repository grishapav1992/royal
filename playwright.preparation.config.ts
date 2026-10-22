import { defineConfig } from '@playwright/test';
export default defineConfig({
 testDir: './tests', testMatch: 'game-module-preparation.spec.ts', workers: 1, timeout: 45000,
 outputDir: 'test-results/preparation',
 use: { channel: 'chrome', viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
});

import { defineConfig } from '@playwright/test';
export default defineConfig({
 testDir: './tests', testMatch: 'native-slot-assets.spec.ts', workers: 1, timeout: 45000,
 outputDir: 'test-results/native-assets',
 use: { channel: 'chrome', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure' },
});

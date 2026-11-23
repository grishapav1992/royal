import { defineConfig } from '@playwright/test';
const deployedURL = process.env.TEST_BASE_URL;
export default defineConfig({
  testDir: './tests', timeout: 45000, workers: 1,
  // These suites require disposable databases and dedicated real-host stands.
  testIgnore: ['**/caribbean-host.spec.ts', '**/roulette-host.spec.ts', '**/progression-host.spec.ts', '**/panda-dragon.spec.ts'],
  use: { baseURL: deployedURL || 'http://127.0.0.1:5173', channel: 'chrome', viewport: { width: 1440, height: 1000 } },
  webServer: deployedURL ? undefined : [
    { command: 'npm run dev:web -- --port 5173', url: 'http://127.0.0.1:5173', reuseExistingServer: true },
    { command: 'npm run dev:server', url: 'http://127.0.0.1:2567/healthz', reuseExistingServer: true },
  ],
});

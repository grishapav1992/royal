import { defineConfig } from '@playwright/test';
process.env.TEST_BASE_URL = 'http://127.0.0.1:2650';
const artifacts = process.env.ROYAL_GAME_WINDOW_ARTIFACTS || 'artifacts/game-window-redesign-20261014';
export default defineConfig({
  testDir: './tests', testMatch: 'game-window.spec.ts', workers: 1, timeout: 120000,
  outputDir: artifacts + '/browser-results',
  use: { baseURL: 'http://127.0.0.1:5220', channel: 'chrome', viewport: { width: 1366, height: 768 }, screenshot: 'only-on-failure', trace: 'retain-on-failure', actionTimeout: 15000 },
  webServer: [
    { command: 'ROYAL_DEV_API_URL=http://127.0.0.1:2650 npm run dev:web -- --port 5220 --strictPort', url: 'http://127.0.0.1:5220', reuseExistingServer: false },
    { command: 'PORT=2650 CODEX_SALE_API_KEY= node --import tsx server/index.ts', url: 'http://127.0.0.1:2650/healthz', reuseExistingServer: false }
  ]
});

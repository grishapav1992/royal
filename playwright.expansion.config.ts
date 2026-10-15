import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'./tests',testMatch:'casino-expansion.spec.ts',timeout:240000,workers:1,
  outputDir:'artifacts/casino-wave2/test-results',
  use:{baseURL:process.env.ROYAL_EXPANSION_URL||'http://127.0.0.1:5198',channel:'chrome',viewport:{width:1440,height:1000},screenshot:'only-on-failure'},
  webServer:process.env.ROYAL_EXPANSION_URL?undefined:[
    {command:'ROYAL_DEV_API_URL=http://127.0.0.1:2598 npm run dev:web -- --port 5198 --strictPort',url:'http://127.0.0.1:5198',reuseExistingServer:false},
    {command:'PORT=2598 CODEX_SALE_API_KEY= node --import tsx server/index.ts',url:'http://127.0.0.1:2598/healthz',reuseExistingServer:false},
  ],
});

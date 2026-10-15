import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
const source=process.env.ROYAL_CARD_SOURCE_DIR?resolve(process.env.ROYAL_CARD_SOURCE_DIR):undefined;
export default defineConfig({
  testDir:'./tests',testMatch:'card-floor.spec.ts',timeout:360000,workers:1,
  outputDir:'artifacts/card-floor-20261011/browser-results',
  use:{baseURL:process.env.ROYAL_CARD_URL||'http://127.0.0.1:5296',channel:'chrome',viewport:{width:1440,height:1000},screenshot:'only-on-failure',trace:'retain-on-failure',actionTimeout:15000},
  webServer:process.env.ROYAL_CARD_URL?undefined:[
    {command:'ROYAL_DEV_API_URL=http://127.0.0.1:2696 npm run dev:web -- --port 5296 --strictPort',cwd:source,url:'http://127.0.0.1:5296',reuseExistingServer:false},
    {command:'PORT=2696 CODEX_SALE_API_KEY= node --import tsx server/index.ts',cwd:source,url:'http://127.0.0.1:2696/healthz',reuseExistingServer:false},
  ],
});

import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
const source=process.env.ROYAL_STUDIO_SOURCE_DIR?resolve(process.env.ROYAL_STUDIO_SOURCE_DIR):undefined;
export default defineConfig({
  testDir:'./tests',testMatch:'studio-games.spec.ts',timeout:240000,workers:1,
  outputDir:'artifacts/royal-studio-20261011/browser-results',
  use:{baseURL:process.env.ROYAL_STUDIO_URL||'http://127.0.0.1:5292',channel:'chrome',viewport:{width:1440,height:1000},screenshot:'only-on-failure',trace:'retain-on-failure',actionTimeout:15000},
  webServer:process.env.ROYAL_STUDIO_URL?undefined:[
    {command:'ROYAL_DEV_API_URL=http://127.0.0.1:2692 npm run dev:web -- --port 5292 --strictPort',cwd:source,url:'http://127.0.0.1:5292',reuseExistingServer:false},
    {command:'PORT=2692 CODEX_SALE_API_KEY= node --import tsx server/index.ts',cwd:source,url:'http://127.0.0.1:2692/healthz',reuseExistingServer:false},
  ],
});

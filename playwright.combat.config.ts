import { defineConfig } from '@playwright/test';
process.env.TEST_BASE_URL='http://127.0.0.1:2688';
export default defineConfig({
 testDir:'./tests',testMatch:'combat.spec.ts',workers:1,timeout:180000,
 outputDir:'artifacts/work/mortal-kombat-duel/browser-results',
 use:{baseURL:'http://127.0.0.1:5288',channel:'chrome',viewport:{width:1366,height:900},screenshot:'only-on-failure',trace:'retain-on-failure'},
 webServer:[
  {command:'ROYAL_DEV_API_URL=http://127.0.0.1:2688 node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5288 --strictPort',url:'http://127.0.0.1:5288',reuseExistingServer:false},
  {command:'PORT=2688 CODEX_SALE_API_KEY= node --import tsx server/index.ts',url:'http://127.0.0.1:2688/healthz',reuseExistingServer:false},
 ],
});

import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'./tests',testMatch:'casino-sessions.spec.ts',timeout:240000,workers:1,
  outputDir:'artifacts/casino-expansion/test-results',
  use:{baseURL:'http://127.0.0.1:5192',channel:'chrome',viewport:{width:1440,height:1000},screenshot:'only-on-failure'},
  webServer:[
    {command:'ROYAL_DEV_API_URL=http://127.0.0.1:2592 npm run dev:web -- --port 5192 --strictPort',url:'http://127.0.0.1:5192',reuseExistingServer:false},
    {command:'ROYAL_CASINO_UI_FIXTURE=1 node --import tsx scripts/check-usdt-ui.ts',url:'http://127.0.0.1:2592/healthz',reuseExistingServer:false},
  ],
});

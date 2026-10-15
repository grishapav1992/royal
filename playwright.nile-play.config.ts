import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests',testMatch:'nile-play.spec.ts',timeout:60000,workers:1,
  use:{baseURL:process.env.TEST_BASE_URL||'http://127.0.0.1:5189',channel:'chrome',viewport:{width:1440,height:1000}},
  webServer:process.env.TEST_BASE_URL?undefined:[
    {command:'ROYAL_DEV_API_URL=http://127.0.0.1:2589 npm run dev:web -- --port 5189 --strictPort',cwd:process.env.NILE_PLAY_RELEASE_DIR,url:'http://127.0.0.1:5189',reuseExistingServer:false},
    {command:'node --import tsx scripts/check-nile-play-ui.ts',url:'http://127.0.0.1:2589/healthz',reuseExistingServer:false},
  ]});

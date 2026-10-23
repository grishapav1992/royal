import { defineConfig } from '@playwright/test';
process.env.TEST_BASE_URL='http://127.0.0.1:2693';
export default defineConfig({
 testDir:'./tests',testMatch:'royal-platform.spec.ts',workers:1,timeout:240000,
 outputDir:'artifacts/royal-platform/results',
 use:{baseURL:'http://127.0.0.1:2693',channel:'chrome',viewport:{width:1440,height:1000},trace:'retain-on-failure'},
 webServer:{command:'PORT=2693 CODEX_SALE_API_KEY= node --import tsx server/index.ts',url:'http://127.0.0.1:2693/healthz',reuseExistingServer:false},
});

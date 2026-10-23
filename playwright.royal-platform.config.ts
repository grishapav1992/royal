import { defineConfig } from '@playwright/test';
process.env.TEST_BASE_URL='http://127.0.0.1:2697';
export default defineConfig({
 testDir:'./tests',testMatch:'royal-platform.spec.ts',workers:1,timeout:180000,
 outputDir:'artifacts/work/cabinet-groups/browser-results',
 use:{actionTimeout:15000,baseURL:'http://127.0.0.1:2697',channel:'chrome',viewport:{width:1440,height:1000},trace:'retain-on-failure'},
 webServer:{command:'PORT=2697 CODEX_SALE_API_KEY= node --import tsx server/index.ts',url:'http://127.0.0.1:2697/healthz',reuseExistingServer:false},
});

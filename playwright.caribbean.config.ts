import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'./tests',testMatch:'caribbean-host.spec.ts',timeout:90000,workers:1,
 outputDir:(process.env.CARIBBEAN_ARTIFACTS_DIR||'artifacts/work/caribbean-empty-balance')+'/playwright-results',
 use:{baseURL:'http://127.0.0.1:'+(process.env.CARIBBEAN_WEB_PORT||'5234'),channel:'chrome',viewport:{width:1440,height:1000},headless:true},
});

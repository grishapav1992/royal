import {defineConfig} from '@playwright/test';

const api='http://127.0.0.1:2596',web='http://127.0.0.1:5196';
process.env.TEST_BASE_URL=api;
export default defineConfig({
  testDir:'./tests',testMatch:'piano-position.spec.ts',workers:1,
  outputDir:'artifacts/work/piano-position/browser-results',reporter:'list',
  use:{baseURL:web,channel:'chrome',viewport:{width:1440,height:1000},trace:'retain-on-failure'},
  webServer:[
    {command:'node --import tsx server/index.ts',url:api+'/healthz',reuseExistingServer:false,
      env:{PORT:'2596',NODE_ENV:'test',CODEX_SALE_API_KEY:''},timeout:60000},
    {command:'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5196 --strictPort',url:web,
      reuseExistingServer:false,env:{ROYAL_DEV_API_URL:api},timeout:60000},
  ],
});

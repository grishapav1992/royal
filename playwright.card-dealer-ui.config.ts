import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests',testMatch:'card-dealer-ui.spec.ts',fullyParallel:false,workers:1,timeout:30000,
  outputDir:'artifacts/cardfloor-20261011/ui-test-results',
  use:{baseURL:'http://127.0.0.1:5192',channel:'chrome',viewport:{width:960,height:1000},trace:'retain-on-failure'},
  webServer:{command:'node_modules/.bin/vite --host 127.0.0.1 --port 5192 --strictPort',url:'http://127.0.0.1:5192',reuseExistingServer:false,timeout:30000},
});

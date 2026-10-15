import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests',testMatch:'studio-ui.spec.ts',fullyParallel:false,workers:1,timeout:30000,
  outputDir:'artifacts/royal-studio-20261011/ui-test-results',
  use:{baseURL:'http://127.0.0.1:5191',channel:'chrome',viewport:{width:1000,height:1000},trace:'retain-on-failure'},
  webServer:{command:'node_modules/.bin/vite --host 127.0.0.1 --port 5191 --strictPort',url:'http://127.0.0.1:5191',reuseExistingServer:false,timeout:30000},
});

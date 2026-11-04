import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests', testMatch:'player-recovery.spec.ts', timeout:150000, workers:1,
  outputDir:'artifacts/work/player-unstuck/test-results', reporter:'list',
  use:{baseURL:'http://127.0.0.1:5184',channel:'chrome',viewport:{width:1440,height:1000}},
  webServer:{command:'node --import tsx scripts/recovery-host.ts',url:'http://127.0.0.1:5184',reuseExistingServer:false,timeout:120000},
});

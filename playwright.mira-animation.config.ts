import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./tests',testMatch:'mira-occlusion.spec.ts',timeout:90000,workers:1,
  outputDir:'artifacts/work/royal-bar-mira/animation-check-20261105/test-results',
  reporter:[['list'],['json',{outputFile:'artifacts/work/royal-bar-mira/animation-check-20261105/browser-results.json'}]],
  use:{baseURL:'http://127.0.0.1:5202',channel:'chrome',viewport:{width:1280,height:900}},
  webServer:{command:'node --import tsx scripts/mira-animation-review.mjs',url:'http://127.0.0.1:5202',reuseExistingServer:!process.env.CI,timeout:90000},
});

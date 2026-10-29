import {defineConfig} from '@playwright/test';
const webPort=process.env.TEMPLE_WEB_PORT??'5234',apiPort=process.env.TEMPLE_API_PORT??'2634';
const origin='http://localhost:'+webPort;
export default defineConfig({
  testDir:'./tests',testMatch:'temple-visual.spec.ts',workers:1,timeout:90000,maxFailures:1,
  outputDir:'artifacts/work/temple-visual-acceptance/browser',
  use:{baseURL:origin,channel:'chrome',viewport:{width:1440,height:1000},trace:'off',screenshot:'only-on-failure'},
  webServer:{command:'node --import tsx scripts/temple-preview.ts',env:{TEMPLE_TEST_RNG:'1',TEMPLE_WEB_PORT:webPort,TEMPLE_API_PORT:apiPort},url:origin+'/tests/fixtures/temple-preview.html',reuseExistingServer:false,timeout:120000},
});

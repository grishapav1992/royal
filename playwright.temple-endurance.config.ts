import {defineConfig} from '@playwright/test';
const webPort=process.env.TEMPLE_WEB_PORT??'5228',apiPort=process.env.TEMPLE_API_PORT??'2628';
const origin='http://localhost:'+webPort;
export default defineConfig({
  testDir:'./tests',testMatch:'temple-endurance.spec.ts',workers:2,fullyParallel:true,maxFailures:1,timeout:240000,
  outputDir:'artifacts/work/temple-endurance/browser',
  use:{baseURL:origin,channel:'chrome',viewport:{width:1440,height:1000},trace:'off',screenshot:'only-on-failure'},
  webServer:{command:'node --import tsx scripts/temple-preview.ts',env:{TEMPLE_TEST_RNG:'1',TEMPLE_WEB_PORT:webPort,TEMPLE_API_PORT:apiPort},url:origin+'/tests/fixtures/temple-preview.html',reuseExistingServer:false,timeout:120000},
});

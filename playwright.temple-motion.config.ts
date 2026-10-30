import {defineConfig} from '@playwright/test';
const webPort=process.env.TEMPLE_WEB_PORT??'5263',apiPort=process.env.TEMPLE_API_PORT??'2663';
const origin='http://localhost:'+webPort;
const scope=process.env.TEMPLE_MOTION_SCOPE??'artifacts/work/temple-motion-fix';
export default defineConfig({
  testDir:'./tests',testMatch:'temple-motion.spec.ts',workers:1,timeout:90000,maxFailures:1,
  outputDir:scope+'/browser',
  use:{baseURL:origin,channel:'chrome',viewport:{width:1280,height:720},trace:'off',screenshot:'only-on-failure'},
  webServer:{command:'node --import tsx scripts/temple-preview.ts',env:{TEMPLE_TEST_RNG:'1',TEMPLE_WEB_PORT:webPort,TEMPLE_API_PORT:apiPort},url:origin+'/tests/fixtures/temple-preview.html',reuseExistingServer:false,timeout:120000},
});

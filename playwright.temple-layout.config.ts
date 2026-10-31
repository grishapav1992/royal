import {defineConfig} from '@playwright/test';
const origin='http://localhost:5227';
export default defineConfig({
  testDir:'./tests',testMatch:'temple-layout.spec.ts',workers:1,timeout:90000,
  outputDir:'artifacts/work/temple-layout/browser',
  use:{baseURL:origin,channel:'chrome',viewport:{width:1440,height:1000},screenshot:'only-on-failure'},
  webServer:{command:'node --import tsx scripts/temple-preview.ts',env:{TEMPLE_TEST_RNG:'1',TEMPLE_WEB_PORT:'5227',TEMPLE_API_PORT:'2627'},url:origin+'/tests/fixtures/temple-preview.html',reuseExistingServer:!process.env.CI,timeout:120000},
});

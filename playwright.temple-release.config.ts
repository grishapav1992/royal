import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'./tests',testMatch:'temple-release.spec.ts',workers:1,timeout:120000,maxFailures:1,
 outputDir:'artifacts/work/temple-release-preparation/browser',
 use:{baseURL:'http://127.0.0.1:'+(process.env.TEMPLE_RELEASE_PORT??'2635'),channel:'chrome',viewport:{width:1440,height:1000},trace:'off',screenshot:'only-on-failure'},
});

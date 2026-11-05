import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./tests',testMatch:'toilet-hall-door.spec.ts',workers:1,
  outputDir:'artifacts/work/toilet-third-floor/browser',
  use:{baseURL:'http://127.0.0.1:5191',channel:'chrome',trace:'off'},
  projects:[
    {name:'desktop',use:{viewport:{width:1440,height:1000}}},
    {name:'mobile',use:{viewport:{width:390,height:844},isMobile:true,hasTouch:true}},
  ],
});

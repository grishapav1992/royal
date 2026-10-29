import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests',testMatch:['flag-battle-host.spec.ts','flag-audio.spec.ts'],timeout:90000,workers:1,outputDir:'artifacts/work/flag-battle/test-results',use:{baseURL:'http://127.0.0.1:5235',channel:'chrome',viewport:{width:1440,height:1000},headless:true}});

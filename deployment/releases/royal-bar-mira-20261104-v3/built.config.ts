import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'../../../tests',testMatch:['royal-bar.spec.ts','mira-life.spec.ts','player-recovery.spec.ts'],workers:1,timeout:180000,
 outputDir:'../../../artifacts/work/royal-bar-mira/production-browser-results',reporter:'list',
 use:{baseURL:'http://127.0.0.1:5200',channel:'chrome',viewport:{width:1440,height:1000},actionTimeout:20000,screenshot:'only-on-failure'},
});

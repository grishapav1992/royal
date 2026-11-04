import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'../../../tests',testMatch:['street.spec.ts','front-windows.spec.ts','rooftop.spec.ts','stair-held.spec.ts'],workers:1,timeout:240000,
 outputDir:'../../../../release/browser-results',reporter:'list',
 use:{baseURL:'http://127.0.0.1:5193',channel:'chrome',actionTimeout:15000,screenshot:'only-on-failure',trace:'retain-on-failure'},
 projects:[{name:'desktop',use:{viewport:{width:1440,height:1000}}},{name:'mobile',testIgnore:['stair-held.spec.ts'],use:{viewport:{width:390,height:844},isMobile:true,hasTouch:true}}],
});

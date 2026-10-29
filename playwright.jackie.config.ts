import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests',testMatch:['jackie.spec.ts','jackie-motion.spec.ts'],workers:1,timeout:120000,outputDir:'test-results/jackie',use:{channel:'chrome',viewport:{width:1440,height:1000},screenshot:'only-on-failure'}});

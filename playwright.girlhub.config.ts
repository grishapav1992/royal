import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests',testMatch:'girlhub-feedback.spec.ts',workers:1,timeout:120000,
 outputDir:'test-results/girlhub',use:{channel:'chrome',viewport:{width:1440,height:1000},actionTimeout:15000,navigationTimeout:30000,trace:'retain-on-failure'}});

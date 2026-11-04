import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'.',testMatch:'wallet.spec.ts',workers:1,timeout:150000,outputDir:'../../../../release/wallet-results',reporter:'list',use:{baseURL:'http://127.0.0.1:5193',channel:'chrome',actionTimeout:15000,screenshot:'only-on-failure',trace:'retain-on-failure'}});

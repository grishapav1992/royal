import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'.',testMatch:'wallet.spec.ts',workers:1,timeout:160000,outputDir:'../../../artifacts/work/skin-offers-release-20261105/browser-wallet',use:{baseURL:'http://127.0.0.1:5193',channel:'chrome',screenshot:'only-on-failure'}});

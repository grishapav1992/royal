import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'../../../tests',testMatch:'tsu-e-fa.spec.ts',workers:1,timeout:150000,
 outputDir:'../../../artifacts/work/pvp-invite-simplify/release-v2/browser-results',
 webServer:{cwd:process.cwd(),command:'node --import tsx --import ./deployment/releases/pvp-invites-20261104-v2/projection-loader.mjs deployment/releases/pvp-invites-20261104-v2/stand.mjs',url:'http://127.0.0.1:5193/healthz',timeout:120000},
 use:{baseURL:'http://127.0.0.1:5193',channel:'chrome',viewport:{width:1440,height:1000},actionTimeout:15000,screenshot:'only-on-failure',trace:'retain-on-failure'},
});

import {defineConfig} from '@playwright/test';
process.env.MIRA_AUDIT_COMPILED='1';
process.env.MIRA_AUDIT_WORK='artifacts/work/mira-counter-rest-20261105/';
export default defineConfig({
  testDir:'.',testMatch:['wallet.spec.ts','mira.spec.ts'],workers:1,timeout:160000,
  grep:/real shared routine|settings recover an occupied cabinet/,
  outputDir:'../../../artifacts/work/mira-counter-rest-20261105/browser-results',
  reporter:[['list'],['json',{outputFile:'artifacts/work/mira-counter-rest-20261105/browser-results.json'}]],
  use:{baseURL:'http://127.0.0.1:5204',channel:'chrome',viewport:{width:1440,height:1000},screenshot:'only-on-failure'},
});

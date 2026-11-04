import {defineConfig} from '@playwright/test';
const api='2984',web='5484',scope='artifacts/work/uniform-spin-response';
process.env.TEST_BASE_URL='http://127.0.0.1:'+api;
export default defineConfig({
 testDir:'./tests',testMatch:'operation-feedback.spec.ts',workers:1,timeout:180000,
 outputDir:scope+'/browser',reporter:[['list'],['json',{outputFile:scope+'/browser-results.json'}]],
 use:{baseURL:'http://127.0.0.1:'+web,channel:'chrome',viewport:{width:1440,height:1000},screenshot:'only-on-failure',trace:'off',actionTimeout:15000},
 webServer:{command:'node --import tsx scripts/game-layout-preview.ts',url:'http://127.0.0.1:'+web+'/healthz',reuseExistingServer:false,timeout:120000,
  env:{LAYOUT_API_PORT:api,LAYOUT_WEB_PORT:web,LAYOUT_TASK_ID:'uniform-spin-response',LAYOUT_ARTIFACTS_DIR:scope,LAYOUT_BUILT:process.env.LAYOUT_BUILT??'0',LAYOUT_BUILT_BACKEND:process.env.LAYOUT_BUILT_BACKEND??'0'}},
});

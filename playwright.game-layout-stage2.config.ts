import {defineConfig} from '@playwright/test';
process.env.TEST_BASE_URL='http://127.0.0.1:'+(process.env.LAYOUT_API_PORT||2968);
if(process.env.LAYOUT_HOST_REGRESSION==='1'){
 process.env.NEOPOLIS_API_PORT=process.env.LAYOUT_API_PORT||'2968';process.env.FLAG_API_PORT=process.env.NEOPOLIS_API_PORT;
 process.env.FLAG_TOPUP_PATH='/__test/layout/topup';process.env.LAYOUT_ARTIFACTS_DIR ||= 'artifacts/work/game-layout-stage2';
}
export default defineConfig({
 testDir:'./tests',testMatch:process.env.LAYOUT_HOST_REGRESSION==='1'?['neopolis-host.spec.ts','flag-battle-host.spec.ts']:'game-layout-stage2.spec.ts',workers:1,timeout:240000,
 outputDir:(process.env.LAYOUT_ARTIFACTS_DIR||'artifacts/work/game-layout-stage2')+'/results',
 reporter:[['list'],['json',{outputFile:(process.env.LAYOUT_ARTIFACTS_DIR||'artifacts/work/game-layout-stage2')+'/verification-'+(process.env.LAYOUT_HOST_REGRESSION==='1'?'host':process.env.LAYOUT_BROWSER||'chromium')+'.json'}]],
 use:{baseURL:'http://127.0.0.1:'+(process.env.LAYOUT_WEB_PORT||5468),browserName:process.env.LAYOUT_BROWSER==='webkit'?'webkit':'chromium',channel:process.env.LAYOUT_BROWSER==='webkit'?undefined:'chrome',viewport:{width:1440,height:900},hasTouch:process.env.LAYOUT_TOUCH==='1',isMobile:process.env.LAYOUT_TOUCH==='1',deviceScaleFactor:process.env.LAYOUT_TOUCH==='1'?3:1,actionTimeout:12000,screenshot:'only-on-failure'},
});

import {defineConfig} from '@playwright/test';
import base from './playwright.game-layout-stage2.config';
const out=process.env.LAYOUT_ARTIFACTS_DIR||'artifacts/work/game-layout-slots';
export default defineConfig({...base,testMatch:'game-layout-slots.spec.ts',
 outputDir:out+'/results',
 reporter:[['list'],['json',{outputFile:out+'/verification-'+(process.env.LAYOUT_BROWSER||'chromium')+'.json'}]],
});

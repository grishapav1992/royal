import {defineConfig} from '@playwright/test';
import base from './playwright.game-layout-stage2.config';
const endpoint=process.env.LAYOUT_PUBLIC_URL;
if(endpoint)process.env.TEST_BASE_URL=endpoint;
const out=process.env.LAYOUT_ARTIFACTS_DIR||'artifacts/work/layout-release-20261101/browser';
export default defineConfig({...base,testMatch:'game-layout-release.spec.ts',timeout:600000,outputDir:out+'/results',
 reporter:[['list'],['json',{outputFile:out+'/verification.json'}]],use:{...base.use,baseURL:endpoint||base.use?.baseURL},
});

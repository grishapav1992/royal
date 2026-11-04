import {defineConfig} from '@playwright/test';
import path from 'node:path';
import base from '../../../playwright.operation-feedback.config';
const scope=path.resolve('artifacts/work/uniform-spin-response');
export default defineConfig({...base,testDir:path.resolve('tests'),maxFailures:1,outputDir:scope+'/browser',
 reporter:[['list'],['json',{outputFile:scope+'/browser-results.json'}]],
 use:{...base.use,baseURL:'http://127.0.0.1:5485'},
 webServer:{...base.webServer,cwd:process.cwd(),command:'node --import tsx deployment/releases/uniform-spin-response-20261104-v1/stand-gateway.ts',url:'http://127.0.0.1:5485/healthz'},
});

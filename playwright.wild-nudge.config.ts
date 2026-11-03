import {defineConfig} from '@playwright/test';
const output=process.env.NUDGE_ARTIFACT_DIR||'artifacts/work/wild-nudge-v1-20261030';
export default defineConfig({testDir:'./tests',testMatch:'wild-nudge-host.spec.ts',fullyParallel:false,workers:1,timeout:90000,expect:{timeout:15000},reporter:[['line'],['json',{outputFile:output+'/browser-suite-final.json'}]],use:{baseURL:'http://127.0.0.1:5237',channel:'chrome',headless:true,viewport:{width:1440,height:1000},trace:'retain-on-failure',screenshot:'only-on-failure'},outputDir:output+'/playwright-results'});

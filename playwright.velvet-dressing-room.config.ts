import {defineConfig} from '@playwright/test';
import base from './playwright.game-layout-stage2.config';
const out=process.env.VELVET_ARTIFACTS_DIR||'artifacts/work/velvet-dressing-room';
export default defineConfig({...base,testMatch:'velvet-dressing-room.spec.ts',outputDir:out+'/results',reporter:[['list']]});

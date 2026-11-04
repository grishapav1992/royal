import {defineConfig} from '@playwright/test';
import live from './playwright.live-stairs.config';

export default defineConfig({...live,
  testMatch:'stair-held.spec.ts',
  outputDir:'../held-stair-results',
});

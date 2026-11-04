import {defineConfig} from '@playwright/test';
import street from './playwright.street.config';

// Check the existing local preview without starting servers or replacing its database.
export default defineConfig({...street,
  webServer:[],
  outputDir:'../live-stair-check-results',
  use:{...street.use,baseURL:'http://127.0.0.1:5191',video:'on'},
  projects:[{name:'desktop',use:{viewport:{width:1440,height:1000}}}],
});

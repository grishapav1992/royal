import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'./tests',testMatch:'finance-admin.spec.ts',timeout:60000,workers:1,
  use:{baseURL:'http://127.0.0.1:5194',channel:'chrome',viewport:{width:1440,height:1000}},
  webServer:[
    {command:'node --import tsx scripts/database-test.ts --import tsx scripts/finance-admin-fixture.ts',url:'http://127.0.0.1:2594/healthz',reuseExistingServer:false,timeout:120000},
    {command:'node scripts/finance-admin-web-fixture.mjs',url:'http://127.0.0.1:5194/admin.html',reuseExistingServer:false},
  ],
});

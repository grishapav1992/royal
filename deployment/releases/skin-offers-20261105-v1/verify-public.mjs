import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chromium} from '@playwright/test';
const [payload,out]=process.argv.slice(2);assert(payload&&out);
const manifest=JSON.parse(fs.readFileSync(payload+'/install-manifest.json'));
const published=JSON.parse(fs.readFileSync('artifacts/work/skin-offers-release-20261105/published-package.json'));
const origin='https://stealth-spark-gokmxooi.expresshost.cloud';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const report={sourceCommit:manifest.sourceCommit,origin,files:[],checks:[],guestBrowsers:[],productionAccountsCreated:false,productionBetsPlaced:false,productionMessagesSent:false};
async function get(name){const response=await fetch(origin+name,{headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(45000)});return {response,bytes:Buffer.from(await response.arrayBuffer())};}
const expected={...Object.fromEntries(Object.entries(manifest.delta).map(([name,digest])=>['/'+name,digest])),...published.files,'/assets/toilet/visitor-rig-v2-161e9417f4a0.png':manifest.before.program['dist/assets/toilet/visitor-rig-v2-161e9417f4a0.png']};
for(const [name,digest]of Object.entries(expected)){
 const {response,bytes}=await get(name+'?verify='+manifest.sourceCommit);assert.equal(response.status,200,name);assert.equal(hash(bytes),digest,name);report.files.push({path:name,sha256:digest,bytes:bytes.length});
}
for(const [name,status]of [['/healthz',200],['/api/auth/me',200],['/api/game-wallet',410],['/api/nile-play',410],['/api/demo-wallet',401],['/api/demo-wallet/expansion',401]]){
 const {response}=await get(name);assert.equal(response.status,status,name);report.checks.push({path:name,status});
}
const home=await get('/');assert.equal(hash(home.bytes),manifest.delta['index.html']);
const browser=await chromium.launch({channel:'chrome'});
try{
 for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
  const context=await browser.newContext({viewport}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',route=>new URL(route.request().url()).hostname===new URL(origin).hostname?route.continue():route.abort());
  await page.goto(origin+'/?verify='+manifest.sourceCommit,{waitUntil:'networkidle',timeout:60000});
  await page.locator('.brand').waitFor({state:'visible'});assert.deepEqual(errors,[]);
  report.guestBrowsers.push({viewport,pageErrors:errors,passed:true});await context.close();
 }
}finally{await browser.close();}
report.passed=true;fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:true,files:report.files.length,apiChecks:report.checks.length,guestBrowsers:report.guestBrowsers.length}));

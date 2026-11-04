import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chromium} from '@playwright/test';
const task='artifacts/work/flag-collision-audio-release',origin='https://stealth-spark-gokmxooi.expresshost.cloud';
const sha=b=>createHash('sha256').update(b).digest('hex');
const local=JSON.parse(fs.readFileSync('module-dist/flag-battle/active.json'));
const manifest=JSON.parse(fs.readFileSync(local.manifest.replace('/game-modules/','module-dist/')));
const report={version:manifest.version,sourceCommit:'88a99af8c49ac43530c2fb9ae93a8abb4576c60d',files:[],api:[],browser:[],productionAccountsCreated:0};
async function get(path){let error;for(let i=0;i<3;i++){try{return await fetch(origin+path,{signal:AbortSignal.timeout(20000),headers:{'Cache-Control':'no-cache'}});}catch(e){error=e;if(i<2)await new Promise(r=>setTimeout(r,1000));}}throw error;}
let browser;
try{
 const active=await get('/game-modules/flag-battle/active.json');assert(active.ok);const activeBytes=Buffer.from(await active.arrayBuffer());assert.equal(sha(activeBytes),sha(fs.readFileSync('module-dist/flag-battle/active.json')));report.activeCacheControl=active.headers.get('cache-control');
 const response=await get(local.manifest);assert(response.ok);assert.equal(sha(Buffer.from(await response.arrayBuffer())),local.sha256);report.manifestSha256=local.sha256;
 const names=Object.keys(manifest.files),prefix=local.manifest.slice(0,-'manifest.json'.length);
 for(let i=0;i<names.length;i+=4){const results=await Promise.allSettled(names.slice(i,i+4).map(async name=>{const r=await get(prefix+name);assert(r.ok,name);const bytes=Buffer.from(await r.arrayBuffer());assert.equal(sha(bytes),manifest.files[name],name);return{name,bytes:bytes.length,sha256:sha(bytes)};}));for(const result of results){if(result.status!=='fulfilled')throw result.reason;report.files.push(result.value);}}
 for(const [url,status]of [['/healthz',200],['/api/demo-wallet',401],['/api/demo-wallet/expansion',401],['/api/game-wallet',410],['/api/nile-play',410]]){const r=await get(url);assert.equal(r.status,status,url);report.api.push({url,status:r.status});await r.arrayBuffer();}
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-swiftshader']});
 for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
  const context=await browser.newContext({viewport}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://luelonplay.com/demo-api/**',r=>r.fulfill({json:{games:[]}}));
  await page.goto(origin,{waitUntil:'domcontentloaded',timeout:45000});await page.getByLabel('Почта',{exact:true}).waitFor({state:'visible',timeout:30000});await page.waitForTimeout(1000);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.deepEqual(errors,[]);report.browser.push({viewport,title:await page.title(),errors});await context.close();
 }
 report.passed=true;report.checkedAt=new Date().toISOString();
}catch(error){report.error=error.message;throw error;}
finally{await browser?.close();fs.writeFileSync(task+'/public-verification.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,version:report.version,files:report.files.length,api:report.api.length,browser:report.browser.length,error:report.error}));}

import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
const origin='https://stealth-spark-gokmxooi.expresshost.cloud',work='artifacts/work/temple-production-096',out=work+'/public';await mkdir(out,{recursive:true});
const operator=JSON.parse(await readFile(work+'/payload/install-manifest.json','utf8')),hash=b=>createHash('sha256').update(b).digest('hex');
const report={sourceCommit:operator.sourceCommit,at:new Date().toISOString(),passed:false,httpFiles:0,productionAccountsCreated:0,productionStakes:0,productionMessages:0,viewports:[],errors:[]};
async function get(path){const r=await fetch(origin+path,{cache:'no-store',signal:AbortSignal.timeout(45000)});assert.equal(r.status,200,path);return{bytes:Buffer.from(await r.arrayBuffer()),headers:Object.fromEntries(r.headers)};}
const active=await get('/game-modules/studio-flooded-temple/active.json');assert.match(active.headers['cache-control'],/no-store/);const pointer=JSON.parse(active.bytes),manifest=await get(pointer.manifest);assert.equal(hash(manifest.bytes),pointer.sha256);assert.equal(pointer.sha256,operator.modulePackage.manifestSha256);const meta=JSON.parse(manifest.bytes);assert.equal(meta.version,operator.modulePackage.version);
assert.deepEqual([meta.apiVersion,meta.rulesVersion,meta.progressVersion],[1,2,2]);
const jobs=Object.entries(operator.dist).map(([path,digest])=>({path:path==='index.html'?'/':'/'+path,digest}));
for(const[path,digest]of Object.entries(meta.files))jobs.push({path:pointer.manifest.replace(/manifest.json$/,'')+path,digest});
for(const[path,digest]of Object.entries(operator.before.modules))if(path.endsWith('/active.json'))jobs.push({path:path.replace('/opt/royal-game-modules/','/game-modules/'),digest});
async function worker(){for(;;){const job=jobs.shift();if(!job)return;assert.equal(hash((await get(job.path)).bytes),job.digest,job.path);report.httpFiles++;}}
await Promise.all(Array.from({length:3},worker));
assert.equal(JSON.parse((await get('/healthz')).bytes).ok,true);
report.protectedEndpoints={};
for(const[path,status]of [['/api/demo-wallet',401],['/api/demo-wallet/expansion',401],['/api/game-wallet',410],['/api/nile-play/wallet',410]]){const actual=(await fetch(origin+path,{signal:AbortSignal.timeout(30000)})).status;assert.equal(actual,status,path);report.protectedEndpoints[path]=actual;}
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'ru-RU',reducedMotion:'reduce'});
 await context.route('**/*',async route=>{const r=route.request(),u=new URL(r.url());if(!['http:','https:'].includes(u.protocol))return route.continue();if(u.origin!==origin||!['GET','HEAD'].includes(r.method()))return route.abort('blockedbyclient');if(u.pathname.startsWith('/api/'))return route.fulfill({status:401,json:{account:null,error:'Read-only guest verification'}});return route.continue();});
 await context.routeWebSocket('**/*',socket=>socket.close());const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(origin+'/?offline=1&temple-review='+Date.now(),{waitUntil:'domcontentloaded',timeout:90000});await expect(page.locator('#loading')).toHaveCount(0,{timeout:120000});
 await page.locator('#room-overview').click();await page.locator('#games-tab').click();await page.locator('[data-cabinet=studio-cosmic-escape]').click();await expect(page.locator('#mini-dialog')).toBeVisible({timeout:45000});
 await page.getByRole('searchbox',{name:'Найти игру'}).fill('Затопленный храм');const card=page.locator('[data-platform-game=studio-flooded-temple]');await expect(card).toBeVisible();await expect(card).toContainText('Каскады');await expect(card.locator('img')).toHaveAttribute('src','/assets/flooded-temple/cover.webp');await card.click();
 await expect(page.locator('#mini-game')).toHaveAttribute('data-game-module-version',meta.version,{timeout:60000});const frame=page.frameLocator('.temple-frame');await expect(frame.locator('.ft-cabinet')).toBeVisible({timeout:60000});
 await expect.poll(()=>frame.locator('.ft-character').evaluate(e=>Array.from(e.querySelectorAll('img')).every(i=>i.complete&&i.naturalWidth>0)),{timeout:60000}).toBe(true);await expect(frame.locator('canvas.ft-portrait')).toBeVisible();
 for(const viewport of [{width:1440,height:1000},{width:1280,height:720},{width:390,height:844},{width:667,height:375}]){
  await page.setViewportSize(viewport);await frame.locator('.ft-character').scrollIntoViewIfNeeded();await expect(frame.locator('.ft-character')).toBeInViewport();
  const geometry=await frame.locator('.ft').evaluate(root=>{const box=s=>root.querySelector(s).getBoundingClientRect().toJSON();return{width:root.clientWidth,scroll:root.scrollWidth,character:box('.ft-character'),board:box('.ft-cabinet'),portrait:box('canvas.ft-portrait'),primary:box('[data-ft=primary]')};});
  assert(geometry.scroll<=geometry.width+1,'Horizontal overflow');if(geometry.width>520)assert(geometry.character.right<=geometry.board.left-8);else assert(geometry.character.bottom<=geometry.board.top);
  await expect(frame.locator('[data-ft=primary]')).toBeDisabled();report.viewports.push({viewport,geometry});await page.screenshot({path:out+'/game-'+viewport.width+'x'+viewport.height+'.png'});
 }
 assert.deepEqual(report.errors,[]);report.passed=true;report.moduleVersion=meta.version;report.pointerNoStore=true;report.publicMode='Offline guest, all API writes and WebSockets blocked; connected chat and wallet recovery checked locally.';
}finally{await writeFile(out+'/verification.json',JSON.stringify(report,null,2)+'\n');await browser.close();}
console.log(JSON.stringify({passed:report.passed,version:meta.version,httpFiles:report.httpFiles,viewports:report.viewports.length,errors:report.errors}));

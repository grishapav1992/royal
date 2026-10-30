import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {chromium,expect} from '@playwright/test';

const origin='https://stealth-spark-gokmxooi.expresshost.cloud';
const task=resolve('artifacts/work/forest-heart-responsive/publication');
const payload=resolve(task,'payload'),out=resolve(task,'public');await mkdir(out,{recursive:true});
const operator=JSON.parse(await readFile(resolve(payload,'operator.json'),'utf8'));
const before=JSON.parse(await readFile(resolve(payload,'before.json'),'utf8'));
const digest=b=>createHash('sha256').update(b).digest('hex');
async function get(path){const r=await fetch(origin+path,{cache:'no-store',signal:AbortSignal.timeout(45000)});assert.equal(r.status,200,path);return{bytes:Buffer.from(await r.arrayBuffer()),headers:Object.fromEntries(r.headers)};}
const report={sourceCommit:operator.sourceCommit,at:new Date().toISOString(),productionAccountsCreated:0,productionStakes:0,productionMessages:0,errors:[],viewports:[],httpFiles:0,passed:false};
const jobs=Object.entries(operator.dist).map(([name,hash])=>({path:name==='index.html'?'/':'/'+name,hash}));
const active=await get('/game-modules/studio-forest-heart/active.json');assert.match(active.headers['cache-control'],/no-store/);assert.equal(digest(active.bytes),operator.pointerSha256);
const pointer=JSON.parse(active.bytes),manifest=await get(pointer.manifest);assert.equal(digest(manifest.bytes),pointer.sha256);
const meta=JSON.parse(manifest.bytes);assert.equal(meta.version,operator.moduleVersion);
for(const k of ['apiVersion','rulesVersion','progressVersion'])assert.equal(meta[k],1);
for(const [name,hash] of Object.entries(meta.files))jobs.push({path:pointer.manifest.replace(/manifest\.json$/,'')+name,hash});
for(const [name,hash] of Object.entries(before.moduleFiles))if(name.endsWith('/active.json')&&name!=='studio-forest-heart/active.json')jobs.push({path:'/game-modules/'+name,hash});
jobs.push({path:'/admin.html',hash:before.program['dist/admin.html']});
const health=JSON.parse((await get('/healthz')).bytes);assert.equal(health.ok,true);
for(const [path,status] of [['/api/demo-wallet',401],['/api/demo-wallet/expansion',401],['/api/game-wallet',410],['/api/nile-play/wallet',410]]){const r=await fetch(origin+path,{headers:{'X-Royal-Forest-Heart':'1'},signal:AbortSignal.timeout(45000)});assert.equal(r.status,status,path);}
async function worker(){for(;;){const job=jobs.shift();if(!job)return;assert.equal(digest((await get(job.path)).bytes),job.hash,job.path);report.httpFiles++;}}
await Promise.all(Array.from({length:3},worker));
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'ru-RU',reducedMotion:'reduce'});
 await context.route('**/*',async route=>{const r=route.request(),u=new URL(r.url());if(!['http:','https:'].includes(u.protocol))return route.continue();if(u.origin!==origin||!['GET','HEAD'].includes(r.method()))return route.abort('blockedbyclient');if(u.pathname.startsWith('/api/'))return route.fulfill({status:401,json:{account:null,error:'Read-only guest verification'}});return route.continue();});
 await context.routeWebSocket('**/*',socket=>socket.close());
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(origin+'/?offline=1&forest-review='+Date.now(),{waitUntil:'domcontentloaded',timeout:90000});
 await expect(page.locator('#loading')).toHaveCount(0,{timeout:120000});
 await page.locator('#room-overview').click();await page.locator('#games-tab').click();await page.locator('[data-cabinet="studio-cosmic-escape"]').click();
 await expect(page.locator('#mini-dialog')).toBeVisible({timeout:45000});
 await expect(page.locator('[data-platform-game="studio-forest-heart"]')).toBeVisible({timeout:30000});
 await page.getByRole('searchbox',{name:'Найти игру'}).fill('Сердце леса');
 const card=page.locator('[data-platform-game="studio-forest-heart"]'),portrait=card.locator('img');
 await expect(portrait).toHaveAttribute('src','/assets/forest-heart/v3/elf-idle.webp');
 await expect.poll(()=>portrait.evaluate(e=>e.complete&&e.naturalWidth>0)).toBe(true);
 await page.screenshot({path:resolve(out,'catalog-desktop.png')});
 await page.setViewportSize({width:390,height:844});await expect(card).toBeInViewport();await page.screenshot({path:resolve(out,'catalog-mobile.png')});
 await card.click();await expect(page.locator('#mini-game')).toHaveAttribute('data-game-module-id','studio-forest-heart',{timeout:60000});
 const frame=page.frameLocator('.forest-heart-frame');await expect(frame.locator('.fh-board')).toBeVisible({timeout:60000});
 await expect.poll(()=>frame.locator('.fh-title-logo').evaluate(e=>e.complete&&e.naturalWidth>0),{timeout:60000}).toBe(true);
 await expect.poll(()=>frame.locator('.fh-character').evaluate(e=>Array.from(e.querySelectorAll('img')).every(image=>image.complete&&image.naturalWidth>0)),{timeout:60000}).toBe(true);
 await frame.locator('.fh').evaluate(async(root,urls)=>{await Promise.all(urls.map(async url=>{const image=root.ownerDocument.createElement('img');image.src=url;await image.decode();}));},meta.preload.map(name=>origin+pointer.manifest.replace(/manifest\.json$/,'')+name));
 for(const viewport of [{width:1920,height:1080},{width:1280,height:720},{width:390,height:844},{width:667,height:375}]){
  await page.setViewportSize(viewport);
  // Outer host resizing and the inner ResizeObserver each schedule layout work.
  // Wait for matching modes and stable geometry, rather than sampling one frame.
  // ForestLayout declares a 128 px minimum. This disabled guest dialog is shorter
  // than the connected full host, whose 150 px minimum was checked locally.
  try{await expect.poll(()=>frame.locator('.fh').evaluate(root=>{const w=root.clientWidth,h=root.clientHeight,mode=h<440&&w>=360?'landscape':w<=620?'mobile':h>w*1.08?'poster':'wide';return root.dataset.layout===mode&&Math.abs(w-root.ownerDocument.defaultView.innerWidth)<=1&&root.querySelector('.fh-board').getBoundingClientRect().width>=128;}),{timeout:15000}).toBe(true);}catch(error){
   report.failure={viewport,geometry:await frame.locator('.fh').evaluate(root=>{const win=root.ownerDocument.defaultView,box=s=>root.querySelector(s).getBoundingClientRect().toJSON(),element=win.frameElement;return{width:root.clientWidth,height:root.clientHeight,innerWidth:win.innerWidth,innerHeight:win.innerHeight,layout:root.dataset.layout,board:box('.fh-board'),world:box('.fh-world'),header:box('.fh-top'),controls:box('.fh-controls'),spin:box('[data-fh=spin]'),outerFrame:element.getBoundingClientRect().toJSON(),stage:element.closest('.mini-stage').getBoundingClientRect().toJSON(),hostMode:element.closest('#mini-dialog').getAttribute('data-game-viewport')};})};
   await page.screenshot({path:resolve(out,'failed-'+viewport.width+'x'+viewport.height+'.png')});throw error;
  }
  await frame.locator('.fh').evaluate(root=>new Promise(resolve=>{let previous='',stable=0;const sample=()=>{const board=root.querySelector('.fh-board').getBoundingClientRect();const value=JSON.stringify([root.clientWidth,root.clientHeight,root.dataset.layout,board.x,board.y,board.width]);stable=value===previous?stable+1:0;previous=value;if(stable>=4)resolve();else root.ownerDocument.defaultView.requestAnimationFrame(sample);};root.ownerDocument.defaultView.requestAnimationFrame(sample);}));
  const boxes=await frame.locator('.fh').evaluate(root=>{const box=s=>root.querySelector(s).getBoundingClientRect().toJSON();const image=root.querySelector('.fh-title-logo');return{width:root.clientWidth,height:root.clientHeight,layout:root.dataset.layout,board:box('.fh-board'),header:box('.fh-top'),logo:box('.fh-title-logo'),controls:box('.fh-controls'),spin:box('[data-fh=spin]'),logoFit:getComputedStyle(image).objectFit,scrollWidth:root.ownerDocument.documentElement.scrollWidth,scrollHeight:root.ownerDocument.documentElement.scrollHeight};});
  assert(boxes.logo.top>=boxes.header.top-1&&boxes.logo.bottom<=boxes.header.bottom+1);assert.equal(boxes.logoFit,'contain');
  assert(boxes.scrollWidth<=boxes.width+1&&boxes.scrollHeight<=boxes.height+1);assert(boxes.board.width>=128);
  for(const box of [boxes.board,boxes.controls,boxes.spin])assert(box.x>=0&&box.y>=0&&box.right<=boxes.width+1&&box.bottom<=boxes.height+1);
  report.viewports.push({viewport,...boxes});await page.screenshot({path:resolve(out,'game-'+viewport.width+'x'+viewport.height+'.png')});
 }
 assert.deepEqual(report.errors,[]);report.passed=true;report.moduleVersion=meta.version;report.pointerNoStore=true;report.publicMode='Guest offline host; API writes and WebSockets blocked. Connected chat and financial recovery verified locally.';
}finally{await writeFile(resolve(out,'verification.json'),JSON.stringify(report,null,2)+'\n');await browser.close();}
console.log(JSON.stringify({passed:report.passed,moduleVersion:meta.version,httpFiles:report.httpFiles,viewports:report.viewports.length,errors:report.errors}));

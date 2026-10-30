import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile,rename,lstat} from 'node:fs/promises';
import {resolve,dirname,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {digest,regularPath} from '../../../scripts/module-build-cache.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const WORK=resolve(ROOT,'artifacts/work/location-rewards-v2');
const DEFAULT_ORIGIN='https://stealth-spark-gokmxooi.expresshost.cloud';
const HASH=/^[a-f0-9]{64}$/,COMMIT=/^[a-f0-9]{40}$/;
const clientName=name=>name==='index.html'||/^assets\/[a-zA-Z0-9_-]+\.(?:js|css)$/.test(name);
function httpsOrigin(value){
 const url=new URL(value);
 assert(url.protocol==='https:'&&!url.username&&!url.password&&url.pathname==='/'&&!url.search&&!url.hash,'Use a bare HTTPS origin');
 return url.origin;
}

/** Validate the scoped package before making any public request. */
export async function publicationFacts(folder){
 folder=resolve(folder);
 assert((await lstat(folder)).isDirectory()&&!(await lstat(folder)).isSymbolicLink(),'Publication directory symlink rejected');
 const bytes=await readFile(await regularPath(folder,'release-manifest.json'));
 const official=JSON.parse(bytes),operator=JSON.parse(await readFile(await regularPath(folder,'install-manifest.json'),'utf8'));
 assert.equal(operator.release,'location-rewards-20261031-v2');
 assert.match(operator.sourceCommit,COMMIT);assert.equal(operator.sourceCommit,official.sourceCommit);
 assert.match(operator.baseCommit,COMMIT);assert.equal(operator.baseCommit,official.baseCommit);
 assert.equal(official.format,1);assert.equal(official.clean,true);assert.equal(official.scope,'application');assert.equal(official.build?.passed,true);
 assert.equal(digest(bytes),operator.releaseManifestSha256,'Official manifest differs from the scoped package');
 assert.equal(operator.serverDelta?.['index.js'],official.files?.['dist-server/index.js'],'Backend identity differs');
 assert.equal(digest(await readFile(await regularPath(folder,'server-delta/index.js'))),operator.serverDelta['index.js'],'Scoped backend file changed');
 if(operator.receiptSha256){
  const receiptBytes=await readFile(await regularPath(folder,'release-github.json'));
  assert.equal(digest(receiptBytes),operator.receiptSha256,'GitHub receipt differs');
  assert.equal(JSON.parse(receiptBytes).sourceCommit,official.sourceCommit);
 }
 assert(operator.delta&&Object.keys(operator.delta).length,'Missing scoped client files');
 for(const[name,hash]of Object.entries(operator.delta)){
  assert(clientName(name),'Unexpected scoped client path');assert.match(hash,HASH);
  assert.equal(official.files['dist/'+name],hash,'Scoped client hash differs from the official manifest');
  assert.equal(digest(await readFile(await regularPath(folder,'dist-delta/'+name))),hash,'Scoped client file changed');
 }
 const files=[];
 for(const[name,hash]of Object.entries(official.files)){
  if(!name.startsWith('dist/')||!clientName(name.slice(5)))continue;
  const sub=name.slice(5);assert.match(hash,HASH);
  assert(operator.delta[sub]===hash||operator.before?.program?.[name]===hash,'Client file is neither scoped nor retained');
  files.push({path:sub==='index.html'?'/':'/'+sub,sha256:hash});
 }
 assert(files.some(row=>row.path==='/')&&files.some(row=>row.path.endsWith('.js')),'Incomplete client inventory');
 return{release:operator.release,sourceCommit:operator.sourceCommit,baseCommit:operator.baseCommit,
  manifestSha256:operator.releaseManifestSha256,files};
}

async function bodyBytes(response,limit=32*1024**2){
 const reader=response.body?.getReader();if(!reader)return Buffer.alloc(0);
 const chunks=[];let size=0;
 try{for(;;){const{done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw Error('Public response exceeds its verification limit');chunks.push(Buffer.from(value));}}
 catch(error){await reader.cancel().catch(()=>{});throw error;}
 return Buffer.concat(chunks);
}

/** A guest probe cannot authenticate or submit a game operation. The sole POST must be denied. */
export async function verifyHttp(facts,{origin=DEFAULT_ORIGIN,request=globalThis.fetch}={}){
 origin=httpsOrigin(origin);
 const report={release:facts.release,sourceCommit:facts.sourceCommit,baseCommit:facts.baseCommit,manifestSha256:facts.manifestSha256,
  origin,at:new Date().toISOString(),passed:false,httpFiles:0,endpoints:{},errors:[],
  productionAccountsCreated:0,productionStakes:0,productionMessages:0,deniedGuestPosts:0,viewports:[]};
 const fetchGuest=(path,method='GET')=>request(origin+path,{method,credentials:'omit',cache:'no-store',redirect:'manual',
  headers:method==='POST'?{'Content-Type':'application/json'}:undefined,body:method==='POST'?'{}':undefined,signal:AbortSignal.timeout(30000)});
 try{
  for(const file of facts.files){
   const response=await fetchGuest(file.path);assert.equal(response.status,200,'Client status: '+file.path);
   assert.equal(digest(await bodyBytes(response)),file.sha256,'Public client bytes differ: '+file.path);report.httpFiles++;
  }
  const checks=[['/healthz',200,'GET'],['/api/progression',401,'GET'],['/api/progression/spins',401,'POST'],
   ['/api/demo-wallet',401,'GET'],['/api/demo-wallet/expansion',401,'GET'],['/api/game-wallet',410,'GET'],
   ['/api/nile-play/wallet',410,'GET'],['/api/auth/me',200,'GET']];
  for(const[path,status,method]of checks){
   const response=await fetchGuest(path,method);report.endpoints[method+' '+path]=response.status;
   assert.equal(response.status,status,'Guest endpoint status: '+method+' '+path);
   if(method==='POST')report.deniedGuestPosts++;
   if(path==='/healthz')assert.equal(JSON.parse((await bodyBytes(response,65536)).toString()).ok,true,'Public health is not ready');
   else if(path==='/api/auth/me')assert.equal(JSON.parse((await bodyBytes(response,65536)).toString()).account,null,'Guest unexpectedly has an account');
   else await response.body?.cancel();
  }
  report.passed=true;
 }catch(error){report.errors.push(error instanceof Error?error.message:'Public verification failed');}
 return report;
}

async function verifyGuestBrowser(report,folder){
 const {chromium}=await import('@playwright/test');
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const context=await browser.newContext({locale:'ru-RU',reducedMotion:'reduce',storageState:{cookies:[],origins:[]}});
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(!['http:','https:'].includes(url.protocol))return route.continue();
   if(url.origin!==report.origin||!['GET','HEAD'].includes(request.method()))return route.abort('blockedbyclient');
   if(url.pathname.startsWith('/api/'))return route.fulfill({status:url.pathname==='/api/auth/me'?200:401,
    json:{account:null,error:'Read-only guest verification'}});
   return route.continue();
  });
  await context.routeWebSocket('**/*',socket=>socket.close());
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
   await page.setViewportSize(viewport);
   await page.goto(report.origin+'/?offline=1&levels-review='+Date.now(),{waitUntil:'domcontentloaded',timeout:90000});
   await page.locator('#loading').waitFor({state:'detached',timeout:120000});
   const geometry=await page.evaluate(()=>({documentWidth:document.documentElement.scrollWidth,viewportWidth:innerWidth,
    appWidth:document.getElementById('app')?.clientWidth,appScrollWidth:document.getElementById('app')?.scrollWidth}));
   assert(geometry.documentWidth<=viewport.width+1,'Guest host overflows the viewport');
   assert(geometry.appWidth!==undefined&&geometry.appScrollWidth<=geometry.appWidth+1,'Guest application overflows horizontally');
   assert.equal(errors.length,0,'Guest host raised JavaScript errors');
   const screenshot='guest-'+viewport.width+'x'+viewport.height+'-'+randomUUID()+'.png';
   await page.screenshot({path:resolve(folder,screenshot)});report.viewports.push({viewport,geometry,screenshot});
  }
  report.browserScope='Offline guest host only. API writes, WebSockets and external requests blocked. Authenticated levels and recovery are verified locally.';
 }finally{await browser.close();}
}

async function main(){
 let folder=resolve(WORK,'publication'),origin=DEFAULT_ORIGIN,out=resolve(WORK,'public-verification'),browser=false;
 const args=process.argv.slice(2);
 for(let i=0;i<args.length;i++){
  if(args[i]==='--help'){console.log('Usage: node verify-public.mjs [--package directory] [--origin https://host] [--out task-directory] [--browser]');return;}
  if(args[i]==='--package'&&args[i+1])folder=resolve(args[++i]);
  else if(args[i]==='--origin'&&args[i+1])origin=args[++i];
  else if(args[i]==='--out'&&args[i+1])out=resolve(args[++i]);
  else if(args[i]==='--browser')browser=true;else throw Error('Unknown public verification option');
 }
 assert(relative(WORK,out)&&!relative(WORK,out).startsWith('..'),'Reports must stay inside this task work directory');
 let parent=dirname(out);while(parent!==dirname(parent)){
  const info=await lstat(parent).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  assert(!info?.isSymbolicLink(),'Report parent symlink rejected');parent=dirname(parent);
 }
 await mkdir(out,{recursive:true});assert(!(await lstat(out)).isSymbolicLink(),'Report directory symlink rejected');
 const ownerFile=resolve(out,'owner.'+randomUUID()+'.json');
 await writeFile(ownerFile,JSON.stringify({owner:'location-levels public verification',purpose:'Compact verification report and two optional guest screenshots',cleanupCondition:'After review and a pushed deployment record, remove redundant captures and keep the compact final report'})+'\n',{flag:'wx'});
 await rename(ownerFile,resolve(out,'owner.json'));
 let report={passed:false,errors:[],productionAccountsCreated:0,productionStakes:0,productionMessages:0};
 try{report=await verifyHttp(await publicationFacts(folder),{origin});if(browser&&report.passed)await verifyGuestBrowser(report,out);}
 catch(error){report.passed=false;report.errors.push(error instanceof Error?error.message:'Public verification failed');}
 const temporary=resolve(out,'verification.'+randomUUID()+'.json');
 await writeFile(temporary,JSON.stringify(report,null,2)+'\n',{flag:'wx'});await rename(temporary,resolve(out,'verification.json'));
 console.log(JSON.stringify({passed:report.passed,sourceCommit:report.sourceCommit,httpFiles:report.httpFiles,viewports:report.viewports?.length??0,
  report:resolve(out,'verification.json'),errors:report.errors}));
 if(!report.passed)process.exitCode=1;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)await main();

import {chromium} from '@playwright/test';
import {preview} from 'vite';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
const publicOrigin=process.argv[2];
const output=resolve(process.argv[3]||'artifacts/velvet-proof');await mkdir(output,{recursive:true});
const pointer=JSON.parse(await readFile('module-dist/studio-velvet-reign/active.json','utf8'));
const expected=pointer.manifest.split('/')[4];
const mime={'.json':'application/json','.js':'text/javascript','.css':'text/css','.webp':'image/webp','.png':'image/png'};
let server;
if(!publicOrigin){
 const packages=resolve('module-dist');
 server=await preview({configFile:false,root:process.cwd(),preview:{host:'127.0.0.1',port:0},plugins:[{name:'velvet-package',configurePreviewServer(vite){vite.middlewares.use('/game-modules',async(req,res)=>{try{const path=resolve(packages,'.'+new URL(req.url,'http://local').pathname);if(!path.startsWith(packages+sep))throw Error('path');res.setHeader('Content-Type',mime[extname(path)]||'application/octet-stream');res.end(await readFile(path));}catch{res.statusCode=404;res.end('missing');}});}}]});
}
const origin=publicOrigin||`http://127.0.0.1:${server.httpServer.address().port}`;
const browser=await chromium.launch({channel:'chrome',headless:true});
const result={origin,expected,accountsCreated:0,serverWrites:0,scenarios:[],errors:[]};
try{
 const page=await browser.newPage({viewport:{width:1920,height:1080}});
 page.on('pageerror',e=>result.errors.push(e.message));
 await page.route('**/api/**',r=>{if(!['GET','HEAD','OPTIONS'].includes(r.request().method())){result.serverWrites++;return r.abort();}return r.continue();});
 await page.goto(origin+'/?offline=1&lang=ru',{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>{try{return window.royalDemo?.getState()?.hall==='arcade';}catch{return false;}},null,{timeout:120000});
 // Install the real host chat-layout controller in the actual offline hall.
 // This local display-only dock sends no chat messages or network commands.
 if(!publicOrigin){
 const controller=(await readFile('src/ui/GameChat.ts','utf8')).replace("import './game-chat.css';",'').replace('export function installGameChat','function installGameChat');
 // Transpile the exact controller with the repository compiler.
 const ts=await import('typescript');
 const script=ts.default.transpileModule(controller,{compilerOptions:{target:ts.default.ScriptTarget.ES2022}}).outputText;
 await page.evaluate(code=>{window.__velvetInstallGameChat=code+';installGameChat';},script);
 await page.evaluate(async()=>{
  const installGameChat=Function(window.__velvetInstallGameChat+';return installGameChat;')();
  const dock=document.createElement('aside');dock.className='chat-dock';
  dock.innerHTML='<section class="chat-panel"><div class="chat-heading"><strong>Общий чат</strong></div><div class="chat-log"><p>Проверка игровой области с чатом</p></div><form class="chat-form"><input placeholder="Сообщение" disabled><button disabled>↑</button></form></section>';
  document.body.append(dock);installGameChat(dock,document.querySelector('#mini-dialog'));
 });}
 for(const [width,height]of [[1920,1080],[1366,768],[390,844]]){
  await page.setViewportSize({width,height});
  const cabinet=page.locator('[data-cabinet="studio-velvet-reign"],[data-studio="studio-velvet-reign"]');
  if(!await cabinet.isVisible())await page.locator('#games-tab').click();
  await cabinet.click();
  if(await page.locator('#panel-close').isVisible())await page.locator('#panel-close').click();
  await page.locator('#mini-dialog[open]').waitFor({timeout:30000});
  await page.locator('[data-velvet-reign][data-asset-state=ready]').waitFor({timeout:60000});
  const enter=page.locator('[data-lg-dialog-action=enter]');if(await enter.isVisible())await enter.click();
  const version=await page.locator('#mini-game').getAttribute('data-game-module-version');if(version!==expected)throw Error('Wrong module version '+version);
  await page.locator('#mini-dialog .mini-stage').evaluate(e=>{e.scrollTop=0;});
  await page.waitForTimeout(250);
  const geometry=await page.evaluate(()=>{
   const rect=s=>document.querySelector(s)?.getBoundingClientRect().toJSON();
   const root=document.querySelector('[data-velvet-reign]');
   return{chat:rect('.game-chat-dock'),dialog:rect('#mini-dialog'),board:rect('[data-lg-board]'),host:rect('.vr-host'),hostArt:rect('.vr-host>.vr-portrait'),overflow:document.querySelector('.mini-stage').scrollWidth-document.querySelector('.mini-stage').clientWidth,portraits:[...root.querySelectorAll('[data-velvet-portrait]')].map(e=>e.getAttribute('href')),loaded:root.querySelector('progress').value,spinDisabled:root.querySelector('[data-lg-spin]').disabled};
  });
  if(geometry.overflow>1||geometry.loaded!==7||!geometry.spinDisabled)throw Error('Layout or guest guard failed');
  if(!publicOrigin&&!geometry.chat)throw Error('Host chat missing');
  if(geometry.portraits.some(url=>!url.includes('/game-modules/studio-velvet-reign/versions/'+expected+'/media/velvet-rebuild/v2/')))throw Error('Portrait escaped immutable module');
  if(!publicOrigin&&width>640&&geometry.board.right>geometry.chat.left)throw Error('Board overlaps chat');
  await page.screenshot({path:resolve(output,`${publicOrigin?'public':'local-chat'}-${width}.png`)});
  await page.locator('#mini-dialog .mini-top [data-close]').click({force:true});
  await page.locator('#mini-dialog').waitFor({state:'hidden'});
  if(await page.locator('link[data-royal-game-module="studio-velvet-reign"]').count())throw Error('Module stylesheet leaked on close');
  result.scenarios.push({width,height,version,geometry,closeReopen:true});
 }
 await page.close();
 if(result.errors.length||result.serverWrites)throw Error(JSON.stringify(result));
}finally{await browser.close();if(server)await new Promise(r=>server.httpServer.close(r));await writeFile(resolve(output,'browser.json'),JSON.stringify(result,null,2));}
console.log(JSON.stringify({origin,version:expected,scenarios:result.scenarios.length,errors:result.errors,serverWrites:result.serverWrites}));

import {test,expect,type Page} from '@playwright/test';
import {createServer,type ViteDevServer} from 'vite';
import {spawn,type ChildProcess} from 'node:child_process';
import {createServer as netServer} from 'node:net';
import {mkdir,writeFile} from 'node:fs/promises';
import {temporaryDatabase} from '../scripts/database-test';
import {startAfter} from '../server/games/afterglow';
import {validAfterSession} from '../src/shared/afterglow';
import {afterRoundTier} from '../src/ui/AfterglowFeedback';
import type {DemoWallet} from '../src/shared/demoWallet';

let vite:ViteDevServer,backend:ChildProcess,db:Awaited<ReturnType<typeof temporaryDatabase>>,baseURL:string;
let logs='';const proof='artifacts/girlhub-feedback';
const profile={version:3,revision:0,selectedGirl:0,selectedLook:0,albumUnits:0,pointsUnits:[0,0,0,0],unlocked:[false,false,false,false],active:false,activeGirl:null};
const wallet:DemoWallet={balance:1000,entries:[],asset:'USDT_NILE_TEST',balanceUnits:'1000000000',revision:90000,testOnly:true,scale:2};
const result=(seed:number)=>{let n=seed;return startAfter({afterglow:{mode:'normal'}},'100',0,max=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n%max;});};
function session(seed:number,id:string){const r=result(seed);return{gameId:'studio-afterglow',id,rulesVersion:2,stakeUnits:'100',spentUnits:'100',returnedUnits:r.ended?r.view.totalPayoutUnits:'0',state:r.ended?'settled':'active',view:{afterglow:r.view,player:[],dealer:[],community:[],actions:r.actions,phase:r.view.revision+1,ended:r.ended,message:r.message}};}
const diag=(page:Page)=>page.evaluate(()=>(window as any).royalDemo?.getMiniState()??(window as any).moduleHarness.currentState());

test.beforeAll(async()=>{
 test.setTimeout(120000);db=await temporaryDatabase();
 const socket=netServer();await new Promise<void>(yes=>socket.listen(0,'127.0.0.1',yes));const port=(socket.address() as {port:number}).port;await new Promise<void>(yes=>socket.close(()=>yes()));
 backend=spawn(process.execPath,['--import','tsx','server/index.ts'],{env:{...process.env,...db.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});
 backend.stdout?.on('data',b=>{logs=(logs+b.toString()).slice(-8000);});backend.stderr?.on('data',b=>{logs=(logs+b.toString()).slice(-8000);});
 const target=`http://127.0.0.1:${port}`;
 await expect.poll(async()=>{try{return(await fetch(target+'/healthz')).ok;}catch{return false;}},{timeout:60000,message:'Isolated backend startup: '+logs}).toBe(true);
 vite=await createServer({configFile:false,root:process.cwd(),cacheDir:'node_modules/.vite-girlhub-feedback',optimizeDeps:{entries:['index.html','tests/fixtures/independent-games.html']},server:{host:'127.0.0.1',port:0,proxy:{'/api':target,'/game-modules':target,'/multiplayer':{target,ws:true,rewrite:path=>path.replace(/^\/multiplayer/,'')}}}});
 await vite.listen();const address=vite.httpServer!.address() as {port:number};baseURL=`http://127.0.0.1:${address.port}`;await mkdir(proof,{recursive:true});
});
test.afterAll(async()=>{await vite?.close();if(backend&&backend.exitCode===null){backend.kill();await new Promise<void>(yes=>backend.once('exit',()=>yes()));}await db?.cleanup();});

async function open(page:Page,language='ru'){
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.route('https://luelonplay.com/**',route=>route.fulfill({json:{games:[]}}));
 await page.route('**/api/casinoapipro/status',route=>route.fulfill({json:{configured:false,walletConnected:false}}));
 await page.route('**/api/game-wallet/afterglow-wardrobe',route=>route.fulfill({json:profile}));
 await page.route('**/api/game-wallet',route=>route.fulfill({json:wallet}));
 await page.addInitScript(()=>{localStorage.setItem('royal-language','ru');localStorage.setItem('royal-afterglow-music','0');localStorage.setItem('royal-afterglow-voices','0');});
 await page.goto(baseURL+'/?lang='+language);
 const en=language==='en';
 await page.getByLabel(en?'Email':'Почта',{exact:true}).fill(`girlhub-${crypto.randomUUID()}@example.test`);
 await page.getByLabel(en?'Password':'Пароль',{exact:true}).fill('Girlhub-isolated-check-123!');
 await page.getByRole('button',{name:en?'Continue':'Продолжить',exact:true}).click();
 await page.getByRole('button',{name:en?'Enter the hall':'Войти в зал',exact:true}).click();
 await expect(page.locator('#join-dialog')).toBeHidden();await expect.poll(()=>page.evaluate(()=>(window as any).royalDemo.getState().online)).toBe(true);
 await expect.poll(()=>page.evaluate(()=>(window as any).royalDemo.getState().locked)).toBe(false);
 await page.evaluate(async()=>{const {demoWallet}=await import('/src/wallet/WalletClient.ts');await demoWallet.refresh();});
 if((await page.evaluate(()=>(window as any).royalDemo.getState().x))<1100){
  await page.locator('#game').focus();await page.keyboard.down('ArrowRight');
  try{await expect.poll(()=>page.evaluate(()=>(window as any).royalDemo.getState().x),{timeout:15000,intervals:[25]}).toBeGreaterThan(1100);}finally{await page.keyboard.up('ArrowRight');}
 }
 if((await page.evaluate(()=>(window as any).royalDemo.getState().y))<760){
  await page.locator('#game').focus();await page.keyboard.down('ArrowDown');
  try{await expect.poll(()=>page.evaluate(()=>(window as any).royalDemo.getState().y),{timeout:10000,intervals:[25]}).toBeGreaterThan(760);}finally{await page.keyboard.up('ArrowDown');}
 }
 await page.locator('#games-tab').click();await page.locator('[data-cabinet="studio-afterglow"]').click();
 await expect(page.locator('#mini-dialog')).toBeVisible({timeout:25000});await page.locator('[data-platform-game="studio-afterglow"]').click();
 await expect(page.locator('[data-afterglow-game]')).toHaveAttribute('data-asset-state','ready',{timeout:30000});
 await page.locator('[data-cc-action=enter]').click();await expect(page.locator('[data-cc-spin]')).toBeEnabled();
 await page.emulateMedia({reducedMotion:'no-preference'});
 await expect(page.locator('[data-afterglow-game]')).toHaveAttribute('data-reduced-motion','false');
}

async function openModule(page:Page){
 await page.route('**/api/game-wallet/afterglow-wardrobe',route=>route.fulfill({json:profile}));
 await page.route('**/api/game-wallet',route=>route.fulfill({json:wallet}));
 await page.addInitScript(()=>{localStorage.setItem('royal-afterglow-music','0');localStorage.setItem('royal-afterglow-voices','0');});
 await page.goto(baseURL+'/tests/fixtures/independent-games.html');
 await page.waitForFunction(()=>!!(window as any).moduleHarness);
 await page.evaluate(()=>{(window as any).moduleHarness.account('girlhub-lifecycle');(window as any).moduleHarness.open('studio-afterglow');});
 await expect(page.locator('[data-afterglow-game]')).toHaveAttribute('data-asset-state','ready');
 await page.locator('[data-cc-action=enter]').click();await expect(page.locator('[data-cc-spin]')).toBeEnabled();
}

test('confirmed outcomes animate once in the real host with connected desktop and mobile chat',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));let seed=1,posts=0,saved:ReturnType<typeof session>|undefined;
 await page.route('**/api/game-wallet/expansion',route=>{
  if(route.request().method()==='POST'){posts++;saved=session(seed,route.request().postDataJSON().id);expect(validAfterSession(saved)).toBe(true);return route.fulfill({json:{wallet,sessions:[saved],session:saved,replayed:false}});}
  return route.fulfill({json:{wallet,sessions:saved?[saved]:[]}});
 });
 await open(page);const game=page.locator('[data-afterglow-game]');
 const observations=[];
 for(const [selected,tier] of [[1,'win'],[143,'big'],[7085,'epic'],[3,'partial'],[2,'loss']] as const){
  seed=selected;await page.locator('[data-cc-spin]').click();
  if(['win','big','epic'].includes(tier)){
   await expect(page.locator('.ag-live-lines polyline')).not.toHaveCount(0);
   await expect(page.locator('.ag-award')).toBeVisible();
   await expect(page.locator('.ag-result')).toBeVisible();await expect(page.locator('.ag-result')).toHaveAttribute('data-tier',tier);
   await expect(page.locator('#chat-input')).toBeInViewport();
   if(tier==='big')await page.setViewportSize({width:390,height:844});
   await expect(page.locator('[data-ag-skip]')).toBeInViewport();
   await page.screenshot({path:`${proof}/${tier}-${tier==='win'?'desktop':'mobile'}.png`,animations:'disabled'});
   if(tier==='epic')await page.locator('[data-ag-skip]').click();
  }
  await expect(page.locator('[data-cc-spin]')).toBeEnabled();await expect(game).toHaveAttribute('data-ag-outcome',tier);
  await expect(page.locator('[data-cc-total]')).toHaveAttribute('data-units',saved!.returnedUnits);
  const state=await diag(page);observations.push({tier,state});
  if(tier==='loss'||tier==='partial'){expect(state.accents.counts[tier]).toBeUndefined();await expect(page.locator('.ag-result')).toBeHidden();}
 }
 expect(posts).toBe(5);
 await page.locator('#chat-input').fill('Проверка GirlHUB');await page.locator('#send-chat').click();await expect(page.locator('#chat-log')).toContainText('Проверка GirlHUB');
 // Wallet refresh and reopen consume saved state without a second presentation.
 saved=session(143,crypto.randomUUID());
 await page.locator('.slot-settings-button').click();
 await page.locator('[data-cc-refresh]').click();await expect(page.locator('.ag-result')).toBeHidden();expect(posts).toBe(5);
 await expect(page.locator('[data-cc-total]')).toHaveAttribute('data-units','1380');
 await page.locator('.slot-settings-dialog header button').click();
 await page.locator('#mini-dialog .mini-top [data-close]').click();
 if(!await page.locator('[data-cabinet="studio-afterglow"]').isVisible())await page.locator('#games-tab').click();
 await page.locator('[data-cabinet="studio-afterglow"]').click();await page.locator('[data-platform-game="studio-afterglow"]').click();await expect(game).toHaveAttribute('data-asset-state','ready');await page.locator('[data-cc-action=enter]').click();
 expect((await diag(page)).accents.counts).toEqual({});expect(posts).toBe(5);
 seed=5;await page.locator('[data-cc-spin]').click();await expect(page.locator('[data-cc-action=bonus]')).toBeVisible();
 const bonus=await diag(page);expect(bonus.accents.counts.bonus).toBe(1);expect(bonus.accents.counts.win).toBeUndefined();expect(bonus.feedback.outcome).toBeNull();await expect(page.locator('.ag-result')).toBeHidden();expect(posts).toBe(6);
 expect(errors).toEqual([]);await writeFile(`${proof}/outcomes.json`,JSON.stringify({observations,posts,errors},null,2));
});

test('mute, reduced motion, hidden page and close cancel owned effects without replay',async({page})=>{
 let posts=0;
 await page.route('**/api/game-wallet/expansion',route=>{
  if(route.request().method()==='POST'){posts++;const s=session(7085,route.request().postDataJSON().id);return route.fulfill({json:{wallet,sessions:[s],session:s,replayed:false}});}
  return route.fulfill({json:{wallet,sessions:[]}});
 });
 await openModule(page);await page.locator('[data-cc-spin]').click();await expect(page.locator('.ag-result')).toBeVisible();
 await page.locator('[data-cc-sound]').click();expect((await diag(page)).accents.activeSources).toBe(0);
 await page.locator('[data-ag-skip]').click();await expect(page.locator('[data-cc-spin]')).toBeEnabled();
 await page.emulateMedia({reducedMotion:'reduce'});await page.locator('[data-cc-spin]').click();
 await expect(page.locator('[data-cc-spin]')).toBeEnabled();await expect(page.locator('[data-cc-total]')).toHaveAttribute('data-units','3555');
 expect((await diag(page)).accents.activeSources).toBe(0);await expect(page.locator('.ag-spark')).toHaveCount(0);
 await page.emulateMedia({reducedMotion:'no-preference'});await page.locator('[data-cc-sound]').click();
 await page.locator('[data-cc-spin]').click();await expect(page.locator('.ag-award')).toBeVisible();
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
 expect((await diag(page)).accents.activeSources).toBe(0);
 await page.evaluate(()=>{delete (document as any).hidden;document.dispatchEvent(new Event('visibilitychange'));});
 await expect(page.locator('.ag-result')).toBeHidden();expect((await diag(page)).feedback.active).toBe(false);
 await page.locator('[data-cc-spin]').click();await expect(page.locator('.ag-result')).toBeVisible();
 await page.evaluate(()=>(window as any).moduleHarness.close());await expect(page.locator('[data-afterglow-game]')).toHaveCount(0);
 expect(posts).toBe(4);
});

test('round tiers use the accepted full stake, including free continuations',()=>{
 expect(['0','29','100','130','1000','2500'].map(n=>afterRoundTier('100',n))).toEqual(['loss','partial','even','win','big','epic']);
 expect(afterRoundTier('100','999')).toBe('win');expect(afterRoundTier('100','2499')).toBe('big');
});

test('the actual accent synth renders bounded audio and exports a review sample',async({page})=>{
 await page.goto(baseURL+'/tests/fixtures/independent-games.html');
 const rendered=await page.evaluate(async()=>{
  const {AfterglowAudio}=await import('/src/ui/AfterglowAudio.ts');
  const {gameAudio}=await import('/src/game/GameAudio.ts');
  const previous={context:gameAudio.context,output:gameAudio.output};
  const context=new OfflineAudioContext(1,48000*8,48000),output=context.createGain();output.connect(context.destination);
  // Offline rendering shares the production synthesis code, with a running-state port.
  Object.defineProperty(context,'state',{get:()=> 'running'});
  gameAudio.context=context as unknown as AudioContext;gameAudio.output=output;
  const audio=new AfterglowAudio();
  // Sequential samples: line, ordinary win, big win, epic win.
  for(const [kind,offset] of [['line',0],['win',1],['big',3],['epic',5]] as const){
   Object.defineProperty(context,'currentTime',{configurable:true,get:()=>offset});audio.accent(kind);
  }
  delete (context as any).currentTime;
  const buffer=await context.startRendering(),data=buffer.getChannelData(0);
  let peak=0,sum=0;for(const n of data){peak=Math.max(peak,Math.abs(n));sum+=n*n;}
  const samples=Array.from(data,n=>Math.round(Math.max(-1,Math.min(1,n))*32767));
  audio.destroy();gameAudio.context=previous.context;gameAudio.output=previous.output;
  return{peak,rms:Math.sqrt(sum/data.length),samples};
 });
 expect(rendered.peak).toBeLessThan(.5);expect(rendered.rms).toBeGreaterThan(.001);
 const wav=Buffer.alloc(44+rendered.samples.length*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(48000,24);wav.writeUInt32LE(96000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);rendered.samples.forEach((n,i)=>wav.writeInt16LE(n,44+i*2));
 await writeFile(`${proof}/accent-review.wav`,wav);await writeFile(`${proof}/audio.json`,JSON.stringify({peak:rendered.peak,rms:rendered.rms,sequence:['line','win','big','epic'],note:'Technical synthesis check. No listening-quality claim.'},null,2));
});

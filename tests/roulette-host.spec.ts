import {test as base,expect,type Page} from '@playwright/test';
import {Client} from '@colyseus/sdk';
const out='artifacts/work/roulette-motion';
const test=base.extend<{roomPath:string}>({roomPath:async({request},use)=>{
 const r=await request.post('/api/auth/login',{data:{email:`roulette-room-${crypto.randomUUID()}@example.test`,password:'Roulette-test-123!'}});expect(r.ok()).toBe(true);
 const cookie=r.headers()['set-cookie'].split(';')[0];await request.post('/api/auth/character',{data:{skin:0}});
 const client=new Client('http://127.0.0.1:2784',{headers:{Cookie:cookie},fetchFn:async(url,options)=>{
  const reply=await request.fetch(String(url),{method:options?.method,headers:Object.fromEntries(new Headers(options?.headers)),data:options?.body as string});
  return new Response(await reply.body(),{status:reply.status(),headers:reply.headers()});
 }});
 const room=await client.create<any>('lobby');
 for(const name of ['chat','activities','piano-note','notice','chat-check','security','ejected','pvp'])room.onMessage(name,()=>{});
 try{await use('/?room='+room.roomId);}finally{await Promise.race([room.leave(),new Promise(r=>setTimeout(r,1500))]);}
}});
const state=(page:Page)=>page.evaluate(()=>(window as any).royalDemo.getState());
async function enter(page:Page,path:string){
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto(path);
 await page.getByLabel('Почта',{exact:true}).fill(`roulette-player-${crypto.randomUUID()}@example.test`);
 await page.getByLabel('Пароль',{exact:true}).fill('Roulette-player-123!');await page.getByRole('button',{name:'Продолжить',exact:true}).click();
 await expect.poll(async()=>await page.locator('#character-step').isVisible()||!(await page.locator('#join-dialog').isVisible())).toBe(true);
 if(await page.locator('#character-step').isVisible())await page.getByRole('button',{name:'Войти в зал',exact:true}).click();
 await expect(page.locator('#join-dialog')).toBeHidden({timeout:25000});await expect.poll(async()=>(await state(page)).online).toBe(true);
 const r=await page.request.post('/__test/roulette/fund');expect(r.ok()).toBe(true);
 await page.evaluate(async()=>{const path='/src/wallet/WalletClient.ts';await(await import(/* @vite-ignore */path)).demoWallet.refresh();});
}
async function open(page:Page){
 if(await page.locator('#room-overview').getAttribute('aria-pressed')!=='true')await page.locator('#room-overview').click();
 await expect.poll(async()=>page.evaluate(()=>Math.abs((window as any).royalDemo.getState().view.width-document.getElementById('game')!.clientWidth))).toBeLessThanOrEqual(1);
 await page.locator('#games-tab').click();
 await expect.poll(async()=>{
  if(await page.locator('#mini-dialog').isVisible())return true;
  try{if(!await page.locator('[data-cabinet="studio-cosmic-escape"]').isVisible())await page.locator('#games-tab').click({timeout:1000});await page.locator('[data-cabinet="studio-cosmic-escape"]').click({timeout:1000});}catch{}
  return page.locator('#mini-dialog').isVisible();
 },{timeout:30000,intervals:[1000,3000]}).toBe(true);
 await expect(page.locator('[data-platform-game="royal-roulette"]')).toBeVisible();
 await page.locator('[data-platform-game="royal-roulette"]').click();
 await expect(page.locator('#mini-game')).toHaveAttribute('data-game-module-id','royal-roulette',{timeout:20000});
 await expect(page.locator('.rr-root')).toBeVisible();await expect(page.locator('#mini-dialog #club-chat-dock')).toBeVisible();
 await expect(page.locator('#chat-input')).toBeInViewport();
}
async function close(page:Page){await page.locator('#mini-dialog .mini-top [data-close]').click();await expect.poll(async()=>(await state(page)).cabinet).toBe('');}
async function layout(page:Page,name:string){
 await expect(page.locator('[data-rr-spin]')).toBeInViewport();await expect(page.locator('#chat-input')).toBeInViewport();
 expect(await page.locator('.rr-root').evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
 expect(await page.locator('.rr-footer').evaluate(e=>{const b=e.getBoundingClientRect(),p=e.closest('#mini-game')!.getBoundingClientRect();return b.bottom<=p.bottom+1&&b.top>=p.top;})).toBe(true);
 if(await page.locator('.rr-root').evaluate(e=>e.clientWidth)>650){
  for(const selector of ['.rr-wheel','.rr-numbers'])expect(await page.locator(selector).evaluate(e=>{const box=e.getBoundingClientRect(),area=e.closest('.rr-content')!.getBoundingClientRect();return box.top>=area.top-1&&box.bottom<=area.bottom+1;})).toBe(true);
 }
 await page.screenshot({path:out+'/'+name+'.png'});
}
async function play(page:Page){
 const response=page.waitForResponse(r=>r.url().endsWith('/api/demo-wallet/operations')&&r.request().method()==='POST');
 await page.locator('[data-rr-spin]').click();const r=await response;expect(r.ok()).toBe(true);const result=await r.json();
 await expect(page.locator('.rr-root')).toHaveAttribute('data-busy','false');
 await expect(page.locator('[data-rr-number]')).toHaveText(String(result.gameRound.outcome.number));return result;
}
test('roulette uses real wallet settlement, responsive host chat, history, and catalogue reopening',async({page,roomPath})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await enter(page,roomPath);await open(page);await layout(page,'desktop');
 await expect(page.locator('[data-rr-bet]')).toHaveCount(41);
 await page.locator('[data-rr-value="0"]').click();await expect(page.locator('[data-rr-selection]')).toContainText('Число 0 · ×36');
 await page.getByRole('button',{name:'50 USDT',exact:true}).click();const result=await play(page);
 expect(result.gameRound.stakeUnits).toBe('5000');expect(result.gameRound.input).toEqual({bet:'number',number:0});
 const n=result.gameRound.outcome.number;expect(result.gameRound.payoutUnits).toBe(n===0?'180000':'0');
 await expect(page.locator('.rr-history span')).toHaveText(String(n));
 await page.setViewportSize({width:1280,height:720});await layout(page,'laptop');
 await page.setViewportSize({width:390,height:844});await layout(page,'mobile');
 await page.locator('[data-rr-bet="even"]').click();await page.getByRole('button',{name:'10 USDT',exact:true}).click();await play(page);
 await page.locator('[data-rr-value="36"]').click();await expect(page.locator('[data-rr-selection]')).toContainText('Число 36 · ×36');await layout(page,'mobile-number-field');await play(page);
 await page.emulateMedia({reducedMotion:'no-preference'});await page.locator('[data-rr-bet="black"]').click();await play(page);
 await page.evaluate(async()=>{const path='/src/wallet/WalletClient.ts';const {demoWallet}=await import(/* @vite-ignore */path);(window as any).__rouletteAccount=demoWallet.accountId;demoWallet.setAccount(null);});
 await expect(page.locator('[data-rr-number]')).toHaveText('?');await expect(page.locator('.rr-landed')).toHaveCount(0);await expect(page.locator('[data-rr-net]')).toHaveText('0');
 await page.evaluate(async()=>{const path='/src/wallet/WalletClient.ts';const {demoWallet}=await import(/* @vite-ignore */path);demoWallet.setAccount((window as any).__rouletteAccount);await demoWallet.refresh();});
 await close(page);await page.setViewportSize({width:1440,height:1000});await open(page);
 await expect(page.locator('[data-rr-spin]')).toBeEnabled();await expect(page.locator('.rr-history span')).toHaveCount(0);
 await close(page);expect(errors).toEqual([]);
});
test('a lost accepted response survives close and reopening and retries the exact same wallet UUID',async({page,roomPath})=>{
 await enter(page,roomPath);await open(page);await page.emulateMedia({reducedMotion:'no-preference'});let original:any,accepted:any;
 await page.route('**/api/demo-wallet/operations',async route=>{
  original=route.request().postDataJSON();const response=await route.fetch();expect(response.ok()).toBe(true);accepted=await response.json();await route.abort('failed');
 },{times:1});
 await page.locator('[data-rr-bet="odd"]').click();await page.locator('[data-rr-spin]').click();
 await expect(page.locator('[data-rr-spin]')).toHaveAccessibleName('Проверить результат');
 expect((await motion(page)).scheduledFrames).toBe(0);expect((await motion(page)).effects).toBe(0);
 await close(page);await open(page);await expect(page.locator('[data-rr-spin]')).toHaveAccessibleName('Проверить результат');
 await expect(page.locator('[data-rr-bet="odd"]')).toHaveAttribute('aria-pressed','true');
 const response=page.waitForResponse(r=>r.url().endsWith('/api/demo-wallet/operations')&&r.request().method()==='POST');
 await page.locator('[data-rr-spin]').click();const r=await response;expect(r.request().postDataJSON()).toEqual(original);
 const retried=await r.json();expect(retried.gameRound).toEqual(accepted.gameRound);expect(retried.wallet.balance).toEqual(accepted.wallet.balance);
 await expect(page.locator('.rr-root')).toHaveAttribute('data-busy','false');
 await expect(page.locator('[data-rr-number]')).toHaveText(String(accepted.gameRound.outcome.number));
 const bets=retried.wallet.entries.filter((e:any)=>e.operationId===original.id&&e.kind==='bet');expect(bets).toHaveLength(1);
 await close(page);
});
test('closing during an accepted request shows its result on reopening without a second wager or recovery reaction',async({page,roomPath})=>{
 await enter(page,roomPath);await open(page);
 let release!:()=>void,accepted:any,posts=0;const held=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/demo-wallet/operations',async route=>{
  posts++;const response=await route.fetch();accepted=await response.json();await held;await route.fulfill({response});
 },{times:1});
 try{
  await page.locator('[data-rr-bet="red"]').click();await page.locator('[data-rr-spin]').click();await expect.poll(()=>!!accepted).toBe(true);
  await close(page);await open(page);await expect(page.locator('[data-rr-spin]')).toBeDisabled();
  await page.evaluate(()=>{(window as any).__rouletteRecoveryReactions=0;window.addEventListener('royal-game-reaction',()=>{(window as any).__rouletteRecoveryReactions++;});});
  release();await expect(page.locator('[data-rr-number]')).toHaveText(String(accepted.gameRound.outcome.number));await expect(page.locator('[data-rr-spin]')).toBeEnabled();
  expect(posts).toBe(1);expect(await page.evaluate(()=>(window as any).__rouletteRecoveryReactions)).toBe(0);
  await close(page);
 }finally{release();}
});

const motion=(page:Page)=>page.evaluate(()=>(window as any).royalDemo.getMiniState().motion);
const numberOrder=[0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
function angularError(value:number){const a=((value%360)+360)%360;return Math.min(a,360-a);}

test('wheel and ball share a continuous confirmed landing and release their frames',async({browser,roomPath})=>{
 const context=await browser.newContext({viewport:{width:1280,height:720},recordVideo:{dir:out+'/video',size:{width:1280,height:720}}});
 const page=await context.newPage(),video=page.video();let report:any;
 try{
  await enter(page,roomPath);await open(page);await page.emulateMedia({reducedMotion:'no-preference'});
  await page.getByRole('button',{name:'50 USDT',exact:true}).click();expect((await motion(page)).effects).toBeGreaterThan(0);
  const reply=page.waitForResponse(r=>r.url().endsWith('/api/demo-wallet/operations')&&r.request().method()==='POST');
  await page.locator('[data-rr-spin]').click();const receipt=await(await reply).json();
  await expect(page.locator('.rr-root')).toHaveAttribute('data-motion-phase','coast');const coast=await motion(page);
  expect(coast.pose.wheelVelocity).toBeGreaterThan(0);expect(coast.pose.ballVelocity).toBeLessThan(0);await expect(page.locator('[data-rr-number]')).toHaveText('?');
  await expect.poll(async()=>(await motion(page)).phase,{intervals:[30,50,80]}).toBe('drop');const drop=await motion(page);
  await expect.poll(async()=>(await motion(page)).phase,{intervals:[30,50,80]}).toBe('pocket');const pocket=await motion(page);
  const index=numberOrder.indexOf(receipt.gameRound.outcome.number);expect(angularError(pocket.pose.ball-pocket.pose.wheel-index*360/37)).toBeLessThanOrEqual(2.21);
  await expect(page.locator('.rr-root')).toHaveAttribute('data-busy','false');await expect(page.locator('[data-rr-number]')).toHaveText(String(receipt.gameRound.outcome.number));
  await expect.poll(async()=>(await motion(page)).effects).toBe(0);const end=await motion(page);
  expect(end.active).toBe(false);expect(end.scheduledFrames).toBe(0);expect(end.frames).toBeGreaterThan(10);expect(end.pose.radius).toBe(148);
  expect(angularError(end.pose.wheel+index*360/37)).toBeLessThan(.000001);expect(angularError(end.pose.ball)).toBeLessThan(.000001);
  report={coast,drop,pocket,end,number:receipt.gameRound.outcome.number,stakeUnits:receipt.gameRound.stakeUnits,payoutUnits:receipt.gameRound.payoutUnits};
  await page.screenshot({path:out+'/motion-result.png'});await page.waitForTimeout(650);
 }finally{
  await context.close();const {writeFile}=await import('node:fs/promises');await writeFile(out+'/motion-measurements.json',JSON.stringify({...report,video:await video?.path()},null,2));
 }
});

test('reduced motion, hidden pages and closing interrupt a spin without another wager or late reaction',async({page,roomPath})=>{
 await enter(page,roomPath);await open(page);await page.emulateMedia({reducedMotion:'no-preference'});
 await page.evaluate(()=>{(window as any).__motionReactions=0;window.addEventListener('royal-game-reaction',()=>{(window as any).__motionReactions++;});});
 let posts=0;page.on('request',r=>{if(r.url().endsWith('/api/demo-wallet/operations')&&r.method()==='POST')posts++;});
 const start=async()=>{const response=page.waitForResponse(r=>r.url().endsWith('/api/demo-wallet/operations')&&r.request().method()==='POST');await page.locator('[data-rr-spin]').click();const receipt=await(await response).json();await expect(page.locator('.rr-root')).toHaveAttribute('data-motion-phase','coast');return receipt;};
 const first=await start();await page.emulateMedia({reducedMotion:'reduce'});
 await expect(page.locator('.rr-root')).toHaveAttribute('data-busy','false');await expect(page.locator('[data-rr-number]')).toHaveText(String(first.gameRound.outcome.number));
 expect((await motion(page)).scheduledFrames).toBe(0);expect((await motion(page)).effects).toBe(0);expect(posts).toBe(1);
 expect(angularError((await motion(page)).pose.wheel+numberOrder.indexOf(first.gameRound.outcome.number)*360/37)).toBeLessThan(.000001);
 await page.emulateMedia({reducedMotion:'no-preference'});const frames=(await motion(page)).frames;await page.waitForTimeout(150);expect((await motion(page)).frames).toBe(frames);
 const second=await start();
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
 await expect(page.locator('.rr-root')).toHaveAttribute('data-busy','false');await expect(page.locator('[data-rr-number]')).toHaveText(String(second.gameRound.outcome.number));
 expect((await motion(page)).scheduledFrames).toBe(0);expect((await motion(page)).effects).toBe(0);
 await page.evaluate(()=>{Reflect.deleteProperty(document,'hidden');document.dispatchEvent(new Event('visibilitychange'));});
 const hiddenFrames=(await motion(page)).frames;await page.waitForTimeout(150);expect((await motion(page)).frames).toBe(hiddenFrames);
 await start();await page.evaluate(()=>{(window as any).__oldRouletteRoot=document.querySelector('.rr-root');});await close(page);
 expect(await page.evaluate(()=>(window as any).__oldRouletteRoot.getAnimations({subtree:true}).filter((a:Animation)=>a.playState==='running').length)).toBe(0);
 await open(page);expect((await motion(page)).frames).toBe(0);await expect(page.locator('[data-rr-number]')).toHaveText('?');
 expect(posts).toBe(3);expect(await page.evaluate(()=>(window as any).__motionReactions)).toBe(0);await close(page);
});

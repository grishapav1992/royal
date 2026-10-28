import {test as base,expect,type Page} from '@playwright/test';
import {Client} from '@colyseus/sdk';
const out='artifacts/work/roulette-visual';
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
 await enter(page,roomPath);await open(page);let original:any,accepted:any;
 await page.route('**/api/demo-wallet/operations',async route=>{
  original=route.request().postDataJSON();const response=await route.fetch();expect(response.ok()).toBe(true);accepted=await response.json();await route.abort('failed');
 },{times:1});
 await page.locator('[data-rr-bet="odd"]').click();await page.locator('[data-rr-spin]').click();
 await expect(page.locator('[data-rr-spin]')).toHaveAccessibleName('Проверить результат');
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

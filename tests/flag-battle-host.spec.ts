import {test as base,expect,type Page} from '@playwright/test';
import {Client} from '@colyseus/sdk';
const test=base.extend<{roomPath:string}>({roomPath:async({request},use)=>{
 const response=await request.post('/api/auth/login',{data:{email:`flags-room-${crypto.randomUUID()}@example.test`,password:'Royal-test-123!'}});expect(response.ok()).toBe(true);
 const cookie=response.headers()['set-cookie'].split(';')[0];await request.post('/api/auth/character',{data:{skin:0}});
 const client=new Client('http://127.0.0.1:2635',{headers:{Cookie:cookie},fetchFn:async(url,options)=>{const reply=await request.fetch(String(url),{method:options?.method,headers:Object.fromEntries(new Headers(options?.headers)),data:options?.body as string});return new Response(await reply.body(),{status:reply.status(),headers:reply.headers()});}});
 const room=await client.create<any>('lobby');for(const name of ['chat','activities','piano-note','notice','chat-check','security','ejected','pvp'])room.onMessage(name,()=>{});
 try{await use('/?room='+room.roomId);}finally{await Promise.race([room.leave(),new Promise(resolve=>setTimeout(resolve,1500))]);}
}});
const out='artifacts/work/flag-battle';
async function enter(page:Page,path:string){
  await page.route('https://luelonplay.com/demo-api/**',r=>r.fulfill({json:{games:[]}}));
  await page.goto(path);
  await page.getByLabel('Почта',{exact:true}).fill(`flags-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Пароль',{exact:true}).fill('Royal-flag-test-123!');
  await page.getByRole('button',{name:'Продолжить',exact:true}).click();
  await expect.poll(async()=>await page.locator('#character-step').isVisible()||!(await page.locator('#join-dialog').isVisible())).toBe(true);
  if(await page.locator('#character-step').isVisible())await page.getByRole('button',{name:'Войти в зал',exact:true}).click();
  await expect(page.locator('#join-dialog')).toBeHidden({timeout:20000});
  await expect.poll(()=>page.evaluate(()=>(window as any).royalDemo.getState().online)).toBe(true);
  const r=await page.request.post('/__test/flag-battle/topup');expect(r.ok()).toBe(true);
  await page.evaluate(async()=>{const path='/src/wallet/WalletClient.ts';await(await import(/* @vite-ignore */path)).demoWallet.refresh();});
}
async function open(page:Page){
  if(await page.locator('#room-overview').getAttribute('aria-pressed')!=='true')await page.locator('#room-overview').click();
  await page.locator('#games-tab').click();
  await page.locator('[data-cabinet="studio-cosmic-escape"]').click();
  await expect.poll(async()=>{
    if(await page.locator('#mini-dialog').isVisible())return true;
    try{await page.locator('[data-cabinet="studio-cosmic-escape"]').click({timeout:600});}catch{}
    return page.locator('#mini-dialog').isVisible();
  },{timeout:30000,intervals:[1000,2000]}).toBe(true);
  await page.locator('[data-platform-game="flag-battle"]').click();
  await expect(page.locator('#mini-game')).toHaveAttribute('data-game-module-id','flag-battle',{timeout:25000});
  await expect(page.locator('[data-fb="play"]')).toBeEnabled();
}
async function close(page:Page){await page.locator('#mini-dialog .mini-top [data-close]').click();await expect(page.locator('#mini-dialog')).toBeHidden();}
const mini=(page:Page)=>page.evaluate(()=>(window as any).royalDemo.getMiniState());
const wallet=async(page:Page)=>(await(await page.request.get('/api/demo-wallet')).json());

test('real host: countries, paid round, skips, reopen, mobile chat and reduced motion',async({page,roomPath})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await enter(page,roomPath);await open(page);
  await expect(page.locator('[data-country]')).toHaveCount(12);
  await expect(page.locator('#mini-dialog #club-chat-dock')).toBeVisible();
  await expect(page.locator('#chat-input')).toBeInViewport();
  await expect(page.locator('[data-fb="play"]')).toBeInViewport();
  await page.screenshot({path:out+'/desktop.png'});
  await page.locator('[data-country="JP"]').click();await page.locator('#fb-stake').selectOption('200');
  const response=page.waitForResponse(r=>r.url().endsWith('/api/demo-wallet/expansion')&&r.request().method()==='POST');
  await page.locator('[data-fb="play"]').click();const reply=await response;const payload=await reply.json();expect(reply.ok(),JSON.stringify(payload)).toBe(true);const accepted=payload.session;
  await expect.poll(async()=>(await mini(page))?.presenting).toBe(true);
  await expect(page.locator('[data-country="RU"]')).toBeDisabled();
  await page.locator('[data-fb="skip"]').click();await expect.poll(async()=>(await mini(page))?.presenting).toBe(false);
  const before=await wallet(page);expect(before.entries.filter((e:any)=>e.kind==='bet')).toHaveLength(1);
  await close(page);await open(page);expect((await mini(page)).sessionId).toBe(accepted.id);
  expect((await mini(page)).presenting).toBe(false);expect((await wallet(page)).entries).toEqual(before.entries);
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator('#chat-input')).toBeInViewport();
  await page.locator('[data-fb="play"]').scrollIntoViewIfNeeded();await expect(page.locator('[data-fb="play"]')).toBeInViewport();
  expect(await page.locator('.fb-root').evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
  await page.screenshot({path:out+'/mobile.png'});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.locator('[data-fb="play"]').click();
  await expect.poll(async()=>(await wallet(page)).entries.filter((e:any)=>e.kind==='bet').length).toBe(2);
  await expect.poll(async()=>(await mini(page))?.presenting).toBe(false);
  expect(errors).toEqual([]);
});
test('lost response retries the same paid request after close and reopen',async({page,roomPath})=>{
  await enter(page,roomPath);await open(page);let lost=false,paidId='';
  await page.route('**/api/demo-wallet/expansion',async route=>{
    if(!lost&&route.request().method()==='POST'){
      lost=true;paidId=route.request().postDataJSON().id;await route.fetch();await route.abort();
    }else await route.continue();
  });
  await page.locator('[data-fb="play"]').click();await expect(page.locator('[data-fb="retry"]')).toBeVisible();
  await close(page);await openRetry(page);
  await page.locator('[data-fb="retry"]').click();await expect(page.locator('[data-fb="retry"]')).toBeHidden();
  await expect.poll(async()=>(await mini(page))?.sessionId).toBe(paidId);
  expect((await wallet(page)).entries.filter((e:any)=>e.kind==='bet')).toHaveLength(1);
});
async function openRetry(page:Page){
  await page.locator('#games-tab').click();await page.locator('[data-cabinet="studio-cosmic-escape"]').click();
  await expect.poll(async()=>{
    if(await page.locator('#mini-dialog').isVisible())return true;
    try{await page.locator('[data-cabinet="studio-cosmic-escape"]').click({timeout:600});}catch{}
    return page.locator('#mini-dialog').isVisible();
  },{timeout:30000,intervals:[1000,2000]}).toBe(true);
  await page.locator('[data-platform-game="flag-battle"]').click();
  await expect(page.locator('[data-fb="retry"]')).toBeVisible({timeout:25000});
}

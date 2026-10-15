import { test,expect,type Page } from '@playwright/test';
import { BASE_EXPANSION_GAMES as EXPANSION_GAMES } from '../src/shared/casinoExpansion';
import { Client,type Room } from '@colyseus/sdk';
import { appendFileSync } from 'node:fs';
let host:Room,room='';
const record=(account:{id:string;email:string})=>{if(process.env.ROYAL_EXPANSION_URL)appendFileSync(process.env.ROYAL_EXPANSION_RECORDS||'artifacts/casino-wave2/public-test-accounts.jsonl',JSON.stringify(account)+'\n');};
test.beforeAll(async({request})=>{
  const auth=await request.post('/api/auth/login',{data:{email:`expansion2-host-${crypto.randomUUID()}@example.test`,password:'Expansion-test-wallet-password!'}});expect(auth.ok()).toBe(true);record((await auth.json()).account);
  await request.post('/api/auth/character',{data:{skin:0}});
  const cookie=auth.headers()['set-cookie'].split(';')[0];
  host=await new Client(process.env.ROYAL_EXPANSION_URL||'http://127.0.0.1:2598',{headers:{Cookie:cookie},fetchFn:async(url,options)=>{
    const response=await request.fetch(String(url),{method:options?.method,headers:Object.fromEntries(new Headers(options?.headers)),data:options?.body as string});
    return new Response(await response.body(),{status:response.status(),headers:response.headers()});
  }}).create('lobby');room=host.roomId;
  for(const type of ['chat','activities','piano-note','notice'])host.onMessage(type,()=>{});
});
test.afterAll(async()=>{await host?.leave();});
async function login(page:Page){
  await page.goto('/?room='+room);await page.getByLabel('Почта',{exact:true}).fill(`expansion2-${crypto.randomUUID()}@example.test`);await page.getByLabel('Пароль',{exact:true}).fill('Expansion-test-wallet-password!');const auth=page.waitForResponse(r=>r.url().endsWith('/api/auth/login')&&r.request().method()==='POST');await page.getByRole('button',{name:'Продолжить',exact:true}).click();record((await(await auth).json()).account);
  await expect(page.locator('#character-step')).toBeVisible();await page.getByRole('button',{name:'Войти в зал',exact:true}).click();await expect(page.locator('#join-dialog')).toBeHidden({timeout:15000});
  if(await page.locator('#room-overview').getAttribute('aria-pressed')!=='true')await page.locator('#room-overview').click();
  await page.getByRole('button',{name:'Открыть демокошелёк'}).click();await page.getByRole('button',{name:'Пополнить демобаланс',exact:true}).click();await expect(page.locator('#wallet-balance')).toHaveText(/1\s000/);await page.getByRole('button',{name:'Закрыть кошелёк'}).click();
}
async function open(page:Page,id:string){await expect.poll(()=>page.evaluate(()=>(window as any).royalDemo.getState().playing)).toBe(false);await page.locator('#games-tab').click();await expect(page.locator('[data-cabinet]:not([hidden])')).toHaveCount(41);await page.locator(`[data-cabinet="${id}"]`).click();await expect(page.locator('.casino-expansion'),id).toBeVisible({timeout:25000});await expect(page.locator('[data-start],[data-move]')).not.toHaveCount(0);}
const post=(page:Page)=>page.waitForResponse(r=>r.url().endsWith('/api/demo-wallet/expansion')&&r.request().method()==='POST');
test('all twenty-six cabinets play against the same demo wallet on desktop and mobile',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));expect((await page.request.get('/api/demo-wallet/expansion')).status()).toBe(401);await login(page);let balance=1000;
  const account=(await(await page.request.get('/api/auth/me')).json()).account,headers={'X-Royal-Account-Id':account.id};
  const forged={id:crypto.randomUUID(),gameId:'github-diamonds',action:'start',stakeUnits:'1000',settings:{},payoutUnits:'999999'};
  expect((await page.request.post('/api/demo-wallet/expansion',{headers,data:forged})).status()).toBe(400);
  expect((await page.request.get('/api/demo-wallet/expansion',{headers:{'X-Royal-Account-Id':crypto.randomUUID()}})).status()).toBe(401);
  expect((await page.request.post('/api/demo-wallet/expansion',{headers:{...headers,Origin:'https://evil.example'},data:forged})).status()).toBe(403);
  for(const id of EXPANSION_GAMES){
    await open(page,id);await expect(page.locator('[data-start]')).toBeEnabled();let wait=post(page);await page.locator('[data-start]').click();let response=await wait;expect(response.ok()).toBe(true);let r=await response.json();
    expect(r.session).not.toHaveProperty('engine');expect(r.session).not.toHaveProperty('crashPoint');expect(Math.round(r.wallet.balance*100)).toBe(Math.round(balance*100)-Number(r.session.spentUnits)+Number(r.session.returnedUnits));
    if(id==='github-crash'){
      expect(r.session).not.toHaveProperty('crashAt');await expect.poll(async()=>await page.locator('[data-move="cashout"]').isEnabled()||await page.locator('[data-start]').count()>0).toBe(true);
      if(await page.locator('[data-move="cashout"]').count()&&await page.locator('[data-move="cashout"]').isEnabled()){wait=post(page);await page.locator('[data-move="cashout"]').click();r=await(await wait).json();}
      else{r=await(await page.request.get('/api/demo-wallet/expansion',{headers})).json();r.session=r.sessions.find((s:any)=>s.gameId===id);}
    }else{
      for(let turn=0;turn<20&&r.session.state==='active';turn++){
        const move=id==='github-pai-gow'?'auto':id==='github-deuces'?'hold':id==='github-let-it-ride'?'pull':id==='github-ultimate'?r.session.view.actions.some((a:any)=>a.move==='check')?'check':'play1':['no-insurance','keep','stand','play1','play','check','decline','andar'].find(m=>r.session.view.actions.some((a:any)=>a.move===m))??r.session.view.actions[0].move;
        await expect(page.locator(`[data-move="${move}"]`)).toBeEnabled();wait=post(page);await page.locator(`[data-move="${move}"]`).click();response=await wait;expect(response.ok()).toBe(true);r=await response.json();
      }
    }
    expect(r.session.state).toBe('settled');balance=r.wallet.balance;await expect(page.locator('[data-expansion-balance]')).toHaveText(balance.toLocaleString('ru-RU')+' демомонет');
    await page.setViewportSize({width:390,height:844});expect(await page.locator('.casino-expansion').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await page.screenshot({path:`artifacts/casino-wave2/${id}-mobile.png`});
    await page.locator('#mini-dialog .mini-top [data-close]').click();await page.setViewportSize({width:1440,height:1000});
  }
  await page.getByRole('button',{name:'Открыть демокошелёк'}).click();await expect(page.locator('#wallet-balance')).toHaveText(balance.toLocaleString('ru-RU'));expect(errors).toEqual([]);
});
test('lost replies preserve the same action ID and a multi-step party survives reload',async({page})=>{
  await login(page);await open(page,'github-let-it-ride');let discarded=false,id='';await page.route('**/api/demo-wallet/expansion',async route=>{
    if(route.request().method()!=='POST')return route.continue();const op=route.request().postDataJSON();if(!discarded){discarded=true;id=op.id;const response=await route.fetch();expect(response.ok()).toBe(true);await route.abort('failed');}else{expect(op.id).toBe(id);await route.continue();}
  });
  await page.locator('[data-start]').click();await expect(page.locator('[data-retry]')).toBeEnabled();await page.reload();await expect(page.locator('#join-dialog')).toBeHidden({timeout:15000});if(await page.locator('#room-overview').getAttribute('aria-pressed')!=='true')await page.locator('#room-overview').click();
  await open(page,'github-let-it-ride');await expect(page.locator('[data-retry]')).toBeEnabled();let wait=post(page);await page.locator('[data-retry]').click();let r=await(await wait).json();expect(r.replayed).toBe(true);expect(r.wallet.balance).toBe(970);expect(r.session.view.community).toHaveLength(0);await page.unroute('**/api/demo-wallet/expansion');
  wait=post(page);await page.locator('[data-move="pull"]').click();r=await(await wait).json();expect(r.wallet.balance).toBe(980);expect(r.session.view.community).toHaveLength(1);
  await page.locator('#mini-dialog .mini-top [data-close]').click();await open(page,'github-let-it-ride');await expect(page.locator('[data-move="pull"]')).toBeEnabled();wait=post(page);await page.locator('[data-move="pull"]').click();r=await(await wait).json();expect(r.session.state).toBe('settled');expect(Number(r.session.returnedUnits)).toBeGreaterThanOrEqual(2000);
});
test('selected-card fees remain unchanged when an exchange reply is lost',async({page})=>{
  await login(page);await open(page,'github-oasis');let wait=post(page);await page.locator('[data-start]').click();let r=await(await wait).json();expect(r.wallet.balance).toBe(990);
  await page.locator('[data-card]:enabled').nth(0).click();await page.locator('[data-card]:enabled').nth(1).click();await expect(page.locator('[data-move="exchange"]')).toContainText('20 монет');
  let discarded=false,id='';await page.route('**/api/demo-wallet/expansion',async route=>{
    if(route.request().method()!=='POST')return route.continue();const op=route.request().postDataJSON();if(!discarded){discarded=true;id=op.id;expect(op.picks).toEqual([0,1]);const response=await route.fetch();expect(response.ok()).toBe(true);await route.abort('failed');}else{expect(op.id).toBe(id);expect(op.picks).toEqual([0,1]);await route.continue();}
  });await page.locator('[data-move="exchange"]').click();await expect(page.locator('[data-retry]')).toBeEnabled();await page.reload();await expect(page.locator('#join-dialog')).toBeHidden({timeout:15000});if(await page.locator('#room-overview').getAttribute('aria-pressed')!=='true')await page.locator('#room-overview').click();await open(page,'github-oasis');wait=post(page);await page.locator('[data-retry]').click();r=await(await wait).json();expect(r.replayed).toBe(true);expect(r.wallet.balance).toBe(970);expect(r.session.spentUnits).toBe('3000');await page.unroute('**/api/demo-wallet/expansion');wait=post(page);await page.locator('[data-move="fold"]').click();expect((await(await wait).json()).session.state).toBe('settled');
});
test('preflop fold settles Texas bonus without undealt community cards',async({page})=>{
  await login(page);await open(page,'github-holdem-bonus');let wait=post(page);await page.locator('[data-start]').click();let r=await(await wait).json();expect(r.wallet.balance).toBe(990);expect(r.session.view.community).toEqual([]);
  wait=post(page);await page.locator('[data-move="fold"]').click();r=await(await wait).json();expect(r.session.state).toBe('settled');expect(r.session.view.community).toEqual([]);expect(r.wallet.balance).toBe(990);await expect(page.locator('[data-start]')).toBeEnabled();
  await page.locator('#mini-dialog .mini-top [data-close]').click();await open(page,'github-holdem-bonus');await expect(page.locator('.casino-expansion [role="status"]')).toContainText('Партия завершена');await expect(page.locator('[data-start]')).toBeEnabled();
});

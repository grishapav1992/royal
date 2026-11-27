import { openPlayerMenu } from './entry-mode';
import { selectEntryMode } from './entry-mode';
import {test as base,expect,type Page} from '@playwright/test';
import {Client} from '@colyseus/sdk';
import {ROOM_CHAT_PROTOCOL,type ChatVisit} from '../src/shared/chat';

const game='studio-caribbean-treasures',out=process.env.CARIBBEAN_ARTIFACTS_DIR||'artifacts/work/caribbean-empty-balance';
const test=base.extend<{roomPath:string;roomSession:{path:string;send:(text:string)=>void}}>({
roomPath:async({roomSession},use)=>use(roomSession.path),
roomSession:async({request},use)=>{
 const response=await request.post('/api/auth/login',{data:{email:`ct-room-${crypto.randomUUID()}@example.test`,password:'Royal-test-123!'}});
 expect(response.ok()).toBe(true);
 const cookie=response.headers()['set-cookie'].split(';')[0];
 await request.post('/api/auth/character',{data:{skin:0}});
 const client=new Client('http://127.0.0.1:'+(process.env.CARIBBEAN_API_PORT||'2634'),{headers:{Cookie:cookie},fetchFn:async(url,options)=>{
  const reply=await request.fetch(String(url),{method:options?.method,headers:Object.fromEntries(new Headers(options?.headers)),data:options?.body as string});
  return new Response(await reply.body(),{status:reply.status(),headers:reply.headers()});
 }});
 const room=await client.create<any>('lobby');
 room.onMessage('*',()=>{});
 let visit:ChatVisit|null= null;
 room.onMessage('chat-visit',value=>{visit=value;});
 room.send('history',{version:ROOM_CHAT_PROTOCOL});
 try{
  await expect.poll(()=>visit?.hall).toBe('arcade');
  await use({path:'/?room='+room.roomId+'&mode=club',send:text=>room.send('chat',{id:crypto.randomUUID(),text,visitId:visit?.id})});
 }finally{await Promise.race([room.leave(),new Promise(resolve=>setTimeout(resolve,1500))]);}
}});
const state=(page:Page)=>page.evaluate(()=>{try{return(window as any).royalDemo?.getState()??{};}catch{return{};}});
async function enter(page:Page,path:string,email=`ct-player-${crypto.randomUUID()}@example.test`){
 await page.route('https://luelonplay.com/demo-api/**',route=>route.fulfill({json:{games:[]}}));
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto(path);await selectEntryMode(page);
 await page.getByLabel('Почта',{exact:true}).fill(email);await page.getByLabel('Пароль',{exact:true}).fill('Royal-ct-check-123!');
 await page.getByRole('button',{name:'Продолжить',exact:true}).click();
 await expect.poll(async()=>await page.locator('#character-step').isVisible()||(await state(page)).online,{timeout:30000}).toBe(true);
 if(await page.locator('#character-step').isVisible())await page.getByRole('button',{name:'Войти в зал',exact:true}).click();
 await expect(page.locator('#join-dialog')).toBeHidden({timeout:20000});
 await expect.poll(async()=>(await state(page)).online).toBe(true);
 return email;
}
async function openCatalog(page:Page){
 if(await page.locator('#room-overview').getAttribute('aria-pressed')!=='true')await page.locator('#room-overview').click();
 await expect.poll(async()=>page.evaluate(()=>Math.abs((window as any).royalDemo.getState().view.width-document.getElementById('game')!.clientWidth))).toBeLessThanOrEqual(1);
 await page.locator('#games-tab').click();await page.locator('[data-cabinet="studio-cosmic-escape"]').click();
 // Hall interactions can briefly own movement; reissue the free approach through its real control.
 try{await expect.poll(async()=>{
  if(await page.locator('#mini-dialog').isVisible())return true;
  const cabinet=page.locator('[data-cabinet="studio-cosmic-escape"]');
  try{if(!await cabinet.isVisible())await page.locator('#games-tab').click({timeout:500});if(!await page.locator('#mini-dialog').isVisible())await cabinet.click({timeout:500});}catch(error){if(!(error instanceof Error&&error.name==='TimeoutError'))throw error;}
  return page.locator('#mini-dialog').isVisible();
 },{timeout:30000,intervals:[1000,3000]}).toBe(true);}catch(error){
  const {writeFile}=await import('node:fs/promises');await writeFile(out+'/hall-failure.json',JSON.stringify(await page.evaluate(()=>({state:(window as any).royalDemo.getState(),dialogs:[...document.querySelectorAll('dialog')].map(d=>({id:d.id,open:d.open,hidden:d.hidden,display:getComputedStyle(d).display,html:d.outerHTML.slice(0,200)}))})),null,2));throw error;
 }
}
async function open(page:Page){
 await openCatalog(page);
 await page.locator(`[data-platform-game="${game}"]`).click();
 await expect(page.locator('#mini-game')).toHaveAttribute('data-game-module-id',game,{timeout:25000});
 await expect(page.locator('.ct-root')).toBeVisible();
 // The Windows WebKit stand can lack an audio context. These checks qualify layout, not audio playback.
 if(process.env.CARIBBEAN_BROWSER!=='webkit')await expect.poll(async()=>page.evaluate(()=>(window as any).royalDemo.getMiniState()?.audio?.ready),{timeout:20000}).toBe(true);
 await expect.poll(async()=>page.evaluate(()=>(window as any).royalDemo.getMiniState()?.captain?.ready),{timeout:20000}).toBe(true);
 await shellChat(page);
}
async function shellChat(page:Page){
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 const dialog=page.locator('#mini-dialog');
 if(await dialog.getAttribute('data-game-chat')==='column')await expect(page.locator('#chat-input')).toBeInViewport();
 else{await expect(dialog.locator('.game-chat-toggle')).toBeInViewport();await expect(dialog.locator('#club-chat-dock')).toBeHidden();}
}
async function close(page:Page){await page.locator('#mini-dialog .mini-top [data-close]').click();await expect.poll(async()=>(await state(page)).cabinet).toBe('');}
async function topup(page:Page){
 const r=await page.request.post('/__test/caribbean/topup',{data:{amount:1000}});expect(r.ok(),await r.text()).toBe(true);
 await page.evaluate(async()=>{const path='/src/wallet/WalletClient.ts';await(await import(/* @vite-ignore */path)).demoWallet.refresh();});
}
async function session(page:Page){const r=await page.request.get('/api/demo-wallet/expansion',{headers:{'X-Royal-Caribbean-Treasures':'1'}});expect(r.ok()).toBe(true);return(await r.json()).sessions.find((s:any)=>s.gameId===game);}
async function wallet(page:Page){return(await(await page.request.get('/api/demo-wallet')).json());}
const mini=(page:Page)=>page.evaluate(()=>(window as any).royalDemo.getMiniState());
const quiet=(page:Page)=>expect.poll(async()=>(await mini(page))?.presenting,{timeout:30000}).toBe(false);
async function action(page:Page,selector:string){
 const reply=page.waitForResponse(r=>r.url().endsWith('/api/demo-wallet/expansion')&&r.request().method()==='POST');
 await page.locator(selector).click();const r=await reply;expect(r.ok(),await r.text()).toBe(true);const body=await r.json();
 await expect(page.locator('[data-ct-action=retry]')).toBeHidden();await quiet(page);
 return body.session;
}
async function play(page:Page){return action(page,'[data-ct-action=play]');}
async function lines(page:Page,count:number){await page.locator('[data-ct-action=lines]').click();await page.locator(`[data-ct-modal="lines:${count}"]`).click();await page.keyboard.press('Escape');await expect(page.locator('[data-ct-action=lines]')).toContainText(String(count));}
async function stake(page:Page,cents:number){await page.locator('[data-ct-stake]').selectOption(String(cents));await expect(page.locator('[data-ct-action=play]')).toContainText((cents/100).toFixed(2).replace('.',','));}
async function buy(page:Page,mode:string){await page.locator('[data-ct-action=buy]').click();await page.locator(`[data-ct-modal="mode:${mode}"]`).click();return action(page,'[data-ct-modal=buy]');}
async function finish(page:Page){
 let s=await session(page);
 for(let moves=0;s.state==='active'&&moves<16;moves++)s=s.view.caribbean.phase==='choice'?await action(page,'[data-ct-action=choose-flagship]'):await play(page);
 expect(s.state).toBe('settled');return s;
}
/** Nothing leaves the window, touch targets stay 44 px and the field keeps its place. */
async function layout(page:Page,name:string){
 await page.waitForTimeout(150);await shellChat(page);
 expect(await page.evaluate(()=>{
  const root=document.querySelector<HTMLElement>('.ct-root')!,stage=root.closest<HTMLElement>('.mini-stage')!,g=root.getBoundingClientRect(),bad:string[]=[];
  if(Math.abs(g.height-stage.getBoundingClientRect().height)>2)bad.push('height');if(root.scrollTop||root.scrollLeft)bad.push('scrolled');
  const shown=(e:Element)=>{const r=e.getBoundingClientRect(),c=getComputedStyle(e);return r.width>0&&r.height>0&&c.visibility!=='hidden';};
  for(const e of root.querySelectorAll<HTMLElement>('button,.ct-result,.ct-board,.ct-console')){
   if(!shown(e)||e.closest('[hidden]'))continue;const r=e.getBoundingClientRect(),n=e.dataset.ctAction||e.className;
   if(r.left<g.left-1||r.right>g.right+1||r.top<g.top-1||r.bottom>g.bottom+1)bad.push('outside '+n);
   if(e instanceof HTMLButtonElement&&(r.width<43.5||r.height<43.5))bad.push('small '+n);
  }
  const hit=(a:string,b:string)=>{const x=root.querySelector(a),y=root.querySelector(b);if(!x||!y||!shown(x)||!shown(y))return;const p=x.getBoundingClientRect(),q=y.getBoundingClientRect();if(p.left<q.right-1&&q.left<p.right-1&&p.top<q.bottom-1&&q.top<p.bottom-1)bad.push(a+' over '+b);};
  for(const [a,b] of [['.ct-result','.ct-console'],['.ct-plate','.ct-result'],['.ct-plate','.ct-console'],['.ct-result','.ct-play'],['.ct-stake','.ct-play'],['.ct-wallet','[data-ct-action=stake-down]'],['.ct-auto','.ct-play'],['.ct-buy','.ct-play'],['.ct-plaque','.ct-tools'],['.ct-crewmini','.ct-tools'],['.ct-plate','.ct-tools']])hit(a,b);
  const b=root.querySelector('.ct-board')!.getBoundingClientRect();if(Math.abs(b.width/b.height-1.5)>.02||b.width<200)bad.push('field');
  return bad;
 })).toEqual([]);
 await page.screenshot({path:out+'/'+name+'.png'});
}

const SIZES:[number,number][]=[[1440,900],[1280,720],[1920,1080],[768,1024],[393,852],[852,393],[320,568],[568,320]];
test('the field, the controls and the result stay inside the window at every size, in both languages',async({page,roomPath})=>{
 test.setTimeout(240000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await enter(page,roomPath);await topup(page);
 for(const language of ['ru','en']){
  if(language==='en'){await close(page);await page.evaluate(()=>localStorage.setItem('royal-language','en'));await page.reload();await selectEntryMode(page);await expect.poll(async()=>(await state(page)).online,{timeout:30000}).toBe(true);}
  await page.setViewportSize({width:1440,height:900});await open(page);
  for(const [width,height] of SIZES){await page.setViewportSize({width,height});await layout(page,`${language}-ready-${width}`);}
  await page.setViewportSize({width:1440,height:900});const board=await page.locator('.ct-board').boundingBox();
  await page.request.post('/__test/caribbean/force-bonus');await play(page);await expect(page.locator('.ct-choice')).toBeVisible();expect(await page.locator('.ct-board').boundingBox()).toEqual(board);
  for(const [width,height] of SIZES){await page.setViewportSize({width,height});await layout(page,`${language}-choice-${width}`);await expect(page.locator('[data-ct-action=choose-raid]')).toBeInViewport({ratio:.9});}
  await page.setViewportSize({width:1440,height:900});await action(page,'[data-ct-action=choose-flagship]');await play(page);expect(await page.locator('.ct-board').boundingBox()).toEqual(board);
  for(const [width,height] of SIZES){await page.setViewportSize({width,height});await layout(page,`${language}-series-${width}`);}
  await finish(page);
 }
 expect(errors).toEqual([]);
});
test('a minimum start debits exactly ten cents, shows its price, payout and net, and the balance never tells the result first',async({page,roomPath})=>{
 await enter(page,roomPath);await topup(page);await page.emulateMedia({reducedMotion:'no-preference'});await open(page);
 for(const [name,kind] of [['partial','quiet'],['loss',''],['positive','win'],['return','quiet']] as const){
  const before=await wallet(page);await page.request.post('/__test/caribbean/force-scenario',{data:{name}});
  const reply=page.waitForResponse(r=>r.url().endsWith('/api/demo-wallet/expansion')&&r.request().method()==='POST');await page.locator('[data-ct-action=play]').click();const s=(await(await reply).json()).session;
  expect(s.spentUnits).toBe('10');await page.waitForTimeout(500);
  const early=Number((await page.locator('[data-ct-balance]').innerText()).replace(/[^\d,.]/g,'').replace(',','.'));expect(early).toBeCloseTo(before.balance-.1,2);
  if(s.view.caribbean.phase==='complete'){await expect.poll(async()=>page.locator('.ct-result').getAttribute('data-kind')).not.toBe('error');}
  await quiet(page);if(s.state==='active'){await finish(page);continue;}
  const paid=Number(s.returnedUnits),net=paid-10;expect(name+' '+await page.locator('.ct-result').getAttribute('data-kind')).toBe(name+' '+(paid>10?'win':paid>0?'quiet':''));
  await expect(page.locator('.ct-ledger')).toHaveText(`Цена раунда 0,10 · выплата ${(paid/100).toFixed(2).replace('.',',')} · чистый итог ${net>0?'+':net<0?'−':''}${(Math.abs(net)/100).toFixed(2).replace('.',',')}`);
  expect((await wallet(page)).balance).toBeCloseTo(before.balance+net/100,2);expect(kind).toBeDefined();
 }
 const accents=(await mini(page)).accents;expect(accents.length).toBeGreaterThan(6);for(const a of accents)expect(Math.abs(a.deviationMs),a.cue).toBeLessThanOrEqual(50);
});
test('an accepted start survives a lost response and reopening without duplicate debit',async({page,roomPath})=>{
 await enter(page,roomPath);await topup(page);await open(page);
 await page.request.post('/__test/caribbean/force-bonus');const initial=await wallet(page);
 let lost=false;await page.route('**/api/demo-wallet/expansion',async route=>{
  if(route.request().method()==='POST'&&!lost){lost=true;const accepted=await route.fetch();expect(accepted.ok(),await accepted.text()).toBe(true);await route.abort('failed');}else await route.continue();
 });
 await page.locator('[data-ct-action=play]').click();await expect(page.locator('[data-ct-action=retry]')).toBeVisible();await quiet(page);
 await expect(page.locator('.ct-say')).toHaveText('Ответ не получен');await expect(page.locator('.ct-ledger')).toHaveText('Повторной ставки не будет');
 const committed=await session(page),before=await wallet(page);expect(committed.state).toBe('active');expect(before.balance).toBeCloseTo(initial.balance-.1,2);
 await close(page);await open(page);await expect(page.locator('[data-ct-action=retry]')).toBeVisible();
 await action(page,'[data-ct-action=retry]');expect((await session(page)).id).toBe(committed.id);expect((await wallet(page)).balance).toBe(before.balance);
 await action(page,'[data-ct-action=choose-raid]');
 // The wheel itself checks a lost free spin.
 lost=false;await page.locator('[data-ct-action=play]').click();await expect(page.locator('[data-ct-action=retry]')).toBeVisible();await quiet(page);await expect(page.locator('[data-ct-action=play]')).toContainText('Проверить');
 await play(page);await expect(page.locator('.ct-status')).not.toContainText('Ответ не получен');await finish(page);
 expect((await wallet(page)).entries.filter((e:any)=>e.operationId===committed.id&&e.kind==='bet')).toHaveLength(1);
});
test('both purchased tactics show the accepted price and recover after a full reload',async({page,roomPath})=>{
 await enter(page,roomPath);await topup(page);await open(page);
 for(const [mode,spins] of [['buy-raid',14],['buy-flagship',6]] as const){
  const before=await wallet(page);await page.locator('[data-ct-action=buy]').click();await expect(page.locator('.ct-buy-price')).toBeVisible();expect((await wallet(page)).balance).toBe(before.balance);
  const price=Number((await page.locator('.ct-buy-price').innerText()).replace(/[^\d,.]/g,'').replace(',','.'));await page.keyboard.press('Escape');
  const started=await buy(page,mode);expect(started.view.caribbean.remaining).toBe(spins);expect(price).toBe(Number(started.spentUnits)/100);
  await expect(page.locator('.ct-held')).toHaveText((Number(started.spentUnits)/100).toFixed(2).replace('.',','));await expect(page.locator('[data-ct-label=stake]')).toHaveText('Цена раунда');
  await page.reload();await selectEntryMode(page);await expect(page.locator('#join-dialog')).toBeHidden({timeout:20000});await expect.poll(async()=>(await state(page)).online).toBe(true);await open(page);
  expect((await session(page)).id).toBe(started.id);await expect(page.locator('[data-ct-action=buy]')).toBeDisabled();expect((await mini(page)).stage.sea).toBe(mode==='buy-raid'?'raid':'storm');
  const done=await finish(page);expect(Math.round((await wallet(page)).balance*100)).toBe(Math.round(before.balance*100)-Number(done.spentUnits)+Number(done.returnedUnits));
 }
});
test('switching accounts hides the previous series and restores it only for its owner',async({page,roomPath})=>{
 const email=await enter(page,roomPath);await topup(page);await open(page);await lines(page,1);
 await page.request.post('/__test/caribbean/force-bonus');const original=await play(page);await close(page);
 await openPlayerMenu(page);await page.getByRole('button',{name:'Выйти',exact:true}).click();await selectEntryMode(page);await expect(page.getByLabel('Почта',{exact:true})).toBeVisible();
 await enter(page,roomPath);await open(page);expect(await session(page)).toBeUndefined();await expect(page.locator('.ct-choice')).toBeHidden();await expect(page.locator('[data-ct-action=lines]')).toContainText('20');await close(page);
 await openPlayerMenu(page);await page.getByRole('button',{name:'Выйти',exact:true}).click();await selectEntryMode(page);await expect(page.getByLabel('Почта',{exact:true})).toBeVisible();
 await enter(page,roomPath,email);await open(page);expect((await session(page)).id).toBe(original.id);await expect(page.locator('[data-ct-action=lines]')).toContainText('1');
 await action(page,'[data-ct-action=choose-flagship]');await finish(page);
});
test('stakes: presets, manual amount and an invalid draft that never becomes a bet',async({page,roomPath})=>{
 await enter(page,roomPath);await topup(page);await open(page);const field=page.locator('input[data-manual-stake]');
 await expect(page.locator('[data-ct-action=stake-down]')).toBeDisabled();await page.locator('[data-ct-action=stake-up]').click();await expect(page.locator('[data-ct-stake]')).toHaveValue('20');
 await stake(page,1000);await field.fill('12,34');await expect(page.locator('[data-ct-action=play]')).toContainText('12,34');
 const before=await wallet(page);await field.fill('0,05');await page.locator('[data-ct-action=play]').click();await page.waitForTimeout(400);expect((await wallet(page)).balance).toBe(before.balance);
 await field.fill('100');await expect(page.locator('[data-ct-action=play]')).toContainText('100,00');await expect(page.locator('[data-ct-action=stake-up]')).toBeDisabled();
 await field.fill('0,10');await field.blur();const s=await play(page);expect(s.spentUnits).toBe('10');if(s.state==='active')await finish(page);
});
test('empty balance explains the disabled spin and live funding enables it',async({page,roomPath})=>{
 await enter(page,roomPath);await open(page);await expect(page.locator('[data-ct-action=play]')).toHaveAttribute('aria-disabled','true');await expect(page.locator('[data-ct-action=buy]')).toBeDisabled();
 await expect(page.locator('.ct-say')).toHaveText('Не хватает средств');await expect(page.locator('.ct-ledger')).toContainText('0,10');
 await page.getByRole('button',{name:'Открыть тестовый кошелёк',exact:true}).click();await expect(page.locator('#wallet-dialog')).toBeVisible();await page.getByRole('button',{name:'Закрыть кошелёк',exact:true}).click();
 await topup(page);await expect(page.locator('[data-ct-action=play]')).toHaveAttribute('aria-disabled','false');
});
test('autoplay: a panel, the paid budget, a tactic, a confirmed result and Stop',async({page,roomPath})=>{
 test.setTimeout(180000);await enter(page,roomPath);await topup(page);await open(page);const bets=async()=>(await wallet(page)).entries.filter((e:any)=>e.kind==='bet').length;
 await page.locator('[data-ct-action=auto]').click();await page.locator('[data-ct-modal="count:25"]').click();await page.waitForTimeout(300);expect(await bets()).toBe(0);await page.keyboard.press('Escape');expect((await mini(page)).autoplay.running).toBe(false);
 await page.request.post('/__test/caribbean/force-bonus');await page.locator('[data-ct-action=auto]').click();await page.locator('[data-ct-modal="count:10"]').click();await page.locator('[data-ct-modal=auto-start]').click();
 await expect(page.locator('.ct-choice')).toBeVisible({timeout:15000});expect((await mini(page)).autoplay).toMatchObject({running:true,waitingForTactic:true,remaining:9});expect(await bets()).toBe(1);
 await page.locator('[data-ct-action=choose-flagship]').click();await expect.poll(async()=>(await mini(page)).autoplay.waitingForResult,{timeout:60000}).toBe(true);expect(await bets()).toBe(1);await page.waitForTimeout(1500);expect(await bets()).toBe(1);
 await page.locator('[data-ct-action=play]').click();await expect.poll(bets,{timeout:15000}).toBeGreaterThan(1);
 await page.locator('[data-ct-action=auto]').click();await quiet(page);const stopped=await bets();await page.waitForTimeout(1500);expect(await bets()).toBe(stopped);expect((await mini(page)).autoplay.running).toBe(false);
 if((await session(page))?.state==='active')await finish(page);
 // closing ends the series and reopening never resumes it
 await page.locator('[data-ct-action=auto]').click();await page.locator('[data-ct-modal=auto-start]').click();await page.waitForTimeout(200);await close(page);await page.waitForTimeout(800);await open(page);const reopened=await bets();await page.waitForTimeout(1500);expect(await bets()).toBe(reopened);
});
test('autoplay stops on a lost response and the replay uses the original UUID',async({page,roomPath})=>{
 await enter(page,roomPath);await topup(page);await open(page);const ids:string[]=[];let lost=false;
 await page.route('**/api/demo-wallet/expansion',async route=>{const r=route.request();if(r.method()==='POST'){ids.push(r.postDataJSON().id);if(!lost){lost=true;await route.fetch();await route.abort('failed');return;}}await route.continue();});
 await page.locator('[data-ct-action=auto]').click();await page.locator('[data-ct-modal=auto-start]').click();await expect(page.locator('[data-ct-action=retry]')).toBeVisible();expect((await mini(page)).autoplay.running).toBe(false);
 await quiet(page);await action(page,'[data-ct-action=retry]');expect(ids).toHaveLength(2);expect(ids[0]).toBe(ids[1]);expect((await wallet(page)).entries.filter((e:any)=>e.kind==='bet')).toHaveLength(1);
});
test('the wheel opens the confirmed result at once, keyboard focus stays and dialogs return it',async({page,roomPath})=>{
 await enter(page,roomPath);await topup(page);await page.emulateMedia({reducedMotion:'no-preference'});await open(page);const bets=async()=>(await wallet(page)).entries.filter((e:any)=>e.kind==='bet').length;
 await page.locator('[data-ct-action=play]').focus();await page.request.post('/__test/caribbean/force-scenario',{data:{name:'positive'}});await page.keyboard.press('Enter');
 await expect.poll(async()=>page.locator('[data-ct-action=play]').getAttribute('class'),{intervals:[30]}).toContain('ct-skip');await page.waitForTimeout(400);expect(await page.evaluate(()=>(document.activeElement as HTMLElement).dataset.ctAction)).toBe('play');
 const at=Date.now();await page.keyboard.press('Enter');await quiet(page);expect(Date.now()-at).toBeLessThan(1600);expect(await bets()).toBe(1);expect(await page.evaluate(()=>(document.activeElement as HTMLElement).dataset.ctAction)).toBe('play');
 if((await session(page))?.state==='active')await finish(page);
 for(const name of ['lines','history','info','auto','buy'])
 {await page.locator(`[data-ct-action=${name}]`).focus();await page.keyboard.press('Enter');await expect(page.locator('.ct-modal')).toBeVisible();for(let i=0;i<14;i++)await page.keyboard.press('Tab');expect(await page.evaluate(()=>!!document.activeElement?.closest('.ct-modal'))).toBe(true);await page.keyboard.press('Escape');await expect(page.locator('.ct-backdrop')).toBeHidden();await expect(page.locator('#mini-dialog')).toBeVisible();expect(await page.evaluate(()=>(document.activeElement as HTMLElement).dataset.ctAction)).toBe(name);}
 await page.locator('[data-ct-action=lines]').click();await page.locator('[data-ct-modal=tour]').click();await expect.poll(async()=>(await mini(page)).stage.tour,{timeout:5000}).toBeGreaterThan(0);await page.keyboard.press('Escape');expect((await mini(page)).stage.tour).toBe(null);expect(await bets()).toBe(1);
});
test('voyage: a real round earns points, a new pirate is met, chosen and kept',async({page,roomPath})=>{
 test.setTimeout(120000);await enter(page,roomPath);await topup(page);await open(page);expect((await mini(page)).voyage.points).toBe(0);
 const first=await play(page);if(first.state==='active')await finish(page);await expect.poll(async()=>(await mini(page)).voyage.points).toBe(1);
 await page.request.post('/__test/caribbean/points',{data:{points:99}});const second=await play(page);if(second.state==='active')await finish(page);await expect.poll(async()=>(await mini(page)).voyage.points).toBe(100);await expect(page.locator('.ct-plate')).toContainText('Новая пиратка ждёт');
 const forged=await page.request.post('/api/caribbean-voyage',{headers:{'X-Royal-Account-Id':(await mini(page)).voyage.accountId},data:{action:'select',characterId:'ines'}});expect(forged.status()).toBe(403);
 await page.emulateMedia({reducedMotion:'no-preference'});await page.locator('.ct-plate').click();await page.locator('.ct-rvskip').click();await expect(page.locator('[data-a=keep]')).toBeVisible();
 // a refused answer keeps the meeting open
 await page.route('**/api/caribbean-voyage',async route=>{if(route.request().method()==='POST')await route.fulfill({status:503,json:{error:'voyage-unavailable'}});else await route.continue();});
 await page.locator('[data-a=pick]').click();await expect(page.locator('.ct-reveal .ct-note')).toContainText('не сохранён');await page.unroute('**/api/caribbean-voyage');
 await page.locator('[data-a=pick]').click();await expect(page.locator('.ct-reveal')).toBeHidden();await page.screenshot({path:out+'/voyage.png'});await page.keyboard.press('Escape');await expect(page.locator('.ct-voyage')).toBeHidden();
 await expect.poll(async()=>(await mini(page)).captain.character).toBe('amara');await expect(page.locator('.ct-plate')).toContainText('Амара');await close(page);await open(page);await expect.poll(async()=>(await mini(page)).captain.character).toBe('amara');
});
test('a pirate cannot change during a series and an unavailable voyage keeps the game playable',async({page,roomPath})=>{
 await enter(page,roomPath);await topup(page);await open(page);await page.request.post('/__test/caribbean/points',{data:{points:300}});
 await page.route('**/api/caribbean-voyage',route=>route.fulfill({status:503,json:{error:'voyage-unavailable'}}));await close(page);await open(page);
 const s=await play(page);if(s.state==='active')await finish(page);expect((await mini(page)).captain.ready).toBe(true);await page.unroute('**/api/caribbean-voyage');
 await page.locator('.ct-plate').click();await expect(page.locator('.ct-reveal,.ct-chart').first()).toBeVisible();await page.keyboard.press('Escape');
 await page.request.post('/__test/caribbean/force-bonus');await play(page);await action(page,'[data-ct-action=choose-raid]');
 const refused=await page.request.post('/api/caribbean-voyage',{headers:{'X-Royal-Account-Id':(await mini(page)).voyage.accountId},data:{action:'select',characterId:'amara'}});expect(refused.status()).toBe(409);
 await finish(page);
});
test('closing, hiding and reopening release the scene and its audio',async({page,roomPath})=>{
 test.setTimeout(120000);await enter(page,roomPath);await topup(page);await page.emulateMedia({reducedMotion:'no-preference'});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 for(let i=0;i<4;i++){await open(page);await page.locator('[data-ct-action=play]').click();await page.waitForTimeout(250+i*500);await close(page);expect(await page.locator('.ct-root').count()).toBe(0);}
 await open(page);await page.waitForTimeout(300);if((await session(page))?.state==='active')await finish(page);const s=await mini(page);expect(s.presenting).toBe(false);expect(s.running).toBe(true);expect(s.loadFailed).toBe(false);expect(s.audio.ownedGraphs).toBeLessThanOrEqual(1);
 expect(errors).toEqual([]);
});

test('priority shell keeps phone chat behind a button and preserves messages, draft, focus and desktop preference',async({page,roomPath,roomSession})=>{
 test.setTimeout(120000);
 await page.setViewportSize({width:393,height:852});await enter(page,roomPath);await topup(page);await open(page);
 const dialog=page.locator('#mini-dialog'),toggle=dialog.locator('.game-chat-toggle'),dock=dialog.locator('#club-chat-dock');
 await expect(dialog.locator('.game-mode-badge')).toBeHidden();
 await expect(dialog.locator('.mini-bottom > span')).toBeHidden();
 await expect(dialog).toHaveAttribute('data-game-chat','closed');await layout(page,'shell-phone');
 const before=await page.locator('.ct-board').boundingBox(),balance=await wallet(page);
 roomSession.send('Привет из соседнего кресла');
 await expect(page.locator('#chat-log')).toContainText('Привет из соседнего кресла');
 await expect(toggle).toContainText('· 1');
 await toggle.click();await expect(dialog).toHaveAttribute('data-game-chat','overlay');
 await expect(dialog.locator('.game-chat-game')).toHaveAttribute('inert','');
 await expect(dock.locator('.game-chat-close')).toBeFocused();await expect(toggle).toHaveText('Чат');
 expect(await page.locator('.ct-board').boundingBox()).toEqual(before);
 await page.locator('#chat-input').fill('Сохраненный черновик');
 await page.evaluate(()=>document.documentElement.style.setProperty('--app-height','320px'));
 await expect(page.locator('#chat-input')).toBeInViewport();
 expect(await page.locator('#chat-input').evaluate(element=>element.getBoundingClientRect().bottom)).toBeLessThanOrEqual(320);
 await page.evaluate(()=>document.documentElement.style.removeProperty('--app-height'));
 await page.keyboard.press('Escape');await expect(dock).toBeHidden();await expect(toggle).toBeFocused();
 await expect(dialog).toBeVisible();await toggle.click();await expect(page.locator('#chat-input')).toHaveValue('Сохраненный черновик');
 await page.locator('#chat-input').fill('Сообщение из мобильной игры');await page.locator('#send-chat').click();
 await expect(page.locator('#chat-log')).toContainText('Сообщение из мобильной игры');
 await dock.locator('.game-chat-close').click();
 for(const viewport of [{width:852,height:393},{width:393,height:852}]){
  await page.setViewportSize(viewport);await expect(dock).toBeHidden();await layout(page,'shell-'+viewport.width);
 }
 await page.setViewportSize({width:1440,height:900});await expect(dialog).toHaveAttribute('data-game-chat','column');
 await expect(dialog.locator('.game-mode-badge')).toBeHidden();
 await toggle.click();await expect(dock).toBeHidden();
 await page.setViewportSize({width:852,height:393});await page.setViewportSize({width:1440,height:900});await expect(dock).toBeHidden();
 await toggle.click();await expect(dialog).toHaveAttribute('data-game-chat','column');
 expect((await wallet(page)).entries).toEqual(balance.entries);
});

test('recorded orchestral music and Foley render without clipping and end in silence',async({page})=>{
 await page.goto('/tests/fixtures/caribbean-audio.html');
 const rendered=await page.evaluate(async()=>{
  const offline=new OfflineAudioContext(1,44100*19,44100);let clock=0;const output=offline.createGain();output.connect(offline.destination);
  const context=new Proxy(offline,{get(target,key){if(key==='state')return'running';if(key==='currentTime')return clock;if(key==='getOutputTimestamp')return()=>({contextTime:0,performanceTime:0});const v=Reflect.get(target,key,target);return typeof v==='function'?v.bind(target):v;}});
  const prefs={muted:false,volume:1};(globalThis as any)[Symbol.for('royal.game-host.v1')]={apiVersion:1,gameAudio:{context,output,getPreferences:()=>prefs,onPreferences:()=>()=>{},unlock:async()=>{}}};
  const path='/games/caribbean-treasures/CaribbeanAudio.ts';const {CaribbeanAudio}=await import(/* @vite-ignore */path);const audio=new CaribbeanAudio();audio.setMusic(true);await audio.enter();
  const events:[number,string,number?][]=[[1,'click'],...[0,1,2,3,4,5].map(i=>[2+i*.15,'stop',i] as [number,string,number]),[4,'giant'],[5,'cannon'],[6,'line'],[7,'bonus'],[10,'partial'],[11,'return'],[13,'win'],[16,'bigwin']];
  for(const [time,cue,variant] of events){clock=time;audio.cue(cue,variant);}
  clock=14;audio.setMusic(false);
  const buffer=await offline.startRendering(),samples=buffer.getChannelData(0);let peak=0,step=0,sum=0,tail=0;
  const bytes=new Uint8Array(44+samples.length*2),view=new DataView(bytes.buffer),word=(at:number,text:string)=>{for(let i=0;i<text.length;i++)bytes[at+i]=text.charCodeAt(i);};
  word(0,'RIFF');view.setUint32(4,bytes.length-8,true);word(8,'WAVE');word(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,44100,true);view.setUint32(28,88200,true);view.setUint16(32,2,true);view.setUint16(34,16,true);word(36,'data');view.setUint32(40,samples.length*2,true);
  for(let i=0;i<samples.length;i++){peak=Math.max(peak,Math.abs(samples[i]));sum+=samples[i]*samples[i];if(i)step=Math.max(step,Math.abs(samples[i]-samples[i-1]));if(i>samples.length-4410)tail=Math.max(tail,Math.abs(samples[i]));view.setInt16(44+i*2,Math.round(Math.max(-1,Math.min(1,samples[i]))*32767),true);}
  let encoded='';for(let i=0;i<bytes.length;i+=8192)encoded+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return{peak,rms:Math.sqrt(sum/samples.length),maxSampleStep:step,tail,samples:audio.state().samples,ready:audio.state().ready,wav:btoa(encoded)};
 });
 const {writeFile}=await import('node:fs/promises');await writeFile(out+'/sound-preview.wav',Buffer.from(rendered.wav,'base64'));
 await writeFile(out+'/audio-measurements.json',JSON.stringify({...rendered,wav:undefined},null,2));
 expect(rendered.ready).toBe(true);expect(rendered.samples.music).toBe(1);expect(rendered.samples.cannon).toBe(1);
 // Two reel stops use each take; the neutral partial-return cue adds one wood settling sound.
 expect(rendered.samples['stop-a']).toBe(3);for(const id of ['stop-b','stop-c'])expect(rendered.samples[id]).toBe(2);
 expect(rendered.peak).toBeGreaterThan(.001);expect(rendered.peak).toBeLessThan(.9);expect(rendered.tail).toBeLessThan(.0001);
});

test('sample loading can fail and retry, and late decode after close cannot restart audio',async({page})=>{
 await page.goto('/tests/fixtures/caribbean-audio.html');
 await page.route('**/caribbean-treasures/audio/manifest.json',r=>r.fulfill({status:503,body:'unavailable'}));
 const failed=await page.evaluate(async()=>{
  const c=new OfflineAudioContext(1,44100,44100),out=c.createGain();out.connect(c.destination);
  const ctx=new Proxy(c,{get(target,key){if(key==='state')return'running';const v=Reflect.get(target,key,target);return typeof v==='function'?v.bind(target):v;}});
  (globalThis as any)[Symbol.for('royal.game-host.v1')]={apiVersion:1,gameAudio:{context:ctx,output:out,getPreferences:()=>({muted:false,volume:1}),onPreferences:()=>()=>{},unlock:async()=>{}}};
  const path='/games/caribbean-treasures/CaribbeanAudio.ts';const {CaribbeanAudio}=await import(/* @vite-ignore */path);const a=(window as any).__ctAudio=new CaribbeanAudio();await a.enter();a.cue('bigwin');return a.state();
 });
 expect(failed.ready).toBe(false);expect(failed.loadError).not.toBe('');expect(failed.counts).toEqual({});expect(failed.activeSources).toBe(0);
 await page.unroute('**/caribbean-treasures/audio/manifest.json');
 expect(await page.evaluate(async()=>{const a=(window as any).__ctAudio;await a.enter();const ready=a.state().ready;a.destroy();return ready;})).toBe(true);
 const closed=await page.evaluate(async()=>{
  let decoding=0;const c=new OfflineAudioContext(1,44100,44100),out=c.createGain();out.connect(c.destination);
  const ctx=new Proxy(c,{get(target,key){if(key==='state')return'running';if(key==='decodeAudioData')return async(bytes:ArrayBuffer)=>{decoding++;await new Promise(r=>setTimeout(r,200));return target.decodeAudioData(bytes);};const v=Reflect.get(target,key,target);return typeof v==='function'?v.bind(target):v;}});
  (globalThis as any)[Symbol.for('royal.game-host.v1')].gameAudio={context:ctx,output:out,getPreferences:()=>({muted:false,volume:1}),onPreferences:()=>()=>{},unlock:async()=>{}};
  const path='/games/caribbean-treasures/CaribbeanAudio.ts';const {CaribbeanAudio}=await import(/* @vite-ignore */path);const a=new CaribbeanAudio(),enter=a.enter();
  for(let i=0;i<200&&decoding===0;i++)await new Promise(r=>setTimeout(r,10));if(!decoding)throw Error('Decode did not start');a.destroy();await enter;await new Promise(r=>setTimeout(r,250));return a.state();
 });
 expect(closed.activeSources).toBe(0);expect(closed.ownedGraphs).toBe(0);expect(closed.music).toBe(false);expect(closed.counts).toEqual({});expect(closed.loadedClips).toBe(0);
});


for (const mobile of [false, true]) test.describe(mobile ? 'phone crew' : 'desktop crew', () => {
  test.use({viewport: mobile ? {width:393,height:852} : {width:1440,height:900}, isMobile:mobile, hasTouch:mobile});
  test('every selected pirate plays her own gesture in the connected host', async ({page,roomPath,roomSession}) => {
    test.setTimeout(240000);
    const {CREW_STYLE} = await import('../games/caribbean-treasures/scene/crewGestures');
    const {CARIBBEAN_CREW} = await import('../games/caribbean-treasures/CaribbeanCrew');
    await enter(page,roomPath);
    await topup(page);
    const points = await page.request.post('/__test/caribbean/points',{data:{points:3250}});
    expect(points.ok()).toBe(true);
    const account = (await (await page.request.get('/api/auth/me')).json()).account.id;
    for (const member of CARIBBEAN_CREW.slice(1)) {
      const met = await page.request.post('/api/caribbean-voyage',{headers:{'X-Royal-Account-Id':account},data:{action:'meet',characterId:member.id}});
      expect(met.ok(),await met.text()).toBe(true);
    }
    await open(page);
    await page.emulateMedia({reducedMotion:'no-preference'});
    roomSession.send('Команда на палубе');
    await expect(page.locator('#chat-log')).toContainText('Команда на палубе');
    for (const {id,ru} of CARIBBEAN_CREW) await test.step(ru, async () => {
      if (id !== 'isabella') {
        await page.locator('[data-ct-action=crew]:visible').first().click();
        await page.locator('.ct-isle[data-id="'+id+'"]').click();
        await page.locator('[data-pick]').click();
        await expect.poll(async () => (await mini(page)).captain.character).toBe(id);
        await page.locator('.ct-chart [data-close]').click();
      }
      const fixture = await page.request.post('/__test/caribbean/force-scenario',{data:{name:'positive'}});
      expect(fixture.ok()).toBe(true);
      await page.locator('[data-ct-action=play]').click();
      await expect.poll(async () => {
        const {captain} = await mini(page);
        return [captain.character,captain.reaction,captain.gesture];
      },{timeout:16000,intervals:[80,120,160]}).toEqual([id,'win',CREW_STYLE[id].signature]);
      await quiet(page);
    });
    if (mobile) {
      await page.setViewportSize({width:320,height:568});
      await expect(page.locator('.ct-crewmini .ct-face canvas')).toBeInViewport();
    }
    await page.emulateMedia({reducedMotion:'reduce'});
    await expect.poll(async () => (await mini(page)).captain.reaction).toBeUndefined();
    await expect.poll(async () => (await mini(page)).captain.pose).toBe('idle');
  });
});

import {test as base,expect,type Page} from '@playwright/test';
import {Client} from '@colyseus/sdk';

const game='studio-caribbean-treasures',out=process.env.CARIBBEAN_ARTIFACTS_DIR||'artifacts/work/caribbean-empty-balance';
const test=base.extend<{roomPath:string}>({roomPath:async({request},use)=>{
 const response=await request.post('/api/auth/login',{data:{email:`ct-room-${crypto.randomUUID()}@example.test`,password:'Royal-test-123!'}});
 expect(response.ok()).toBe(true);
 const cookie=response.headers()['set-cookie'].split(';')[0];
 await request.post('/api/auth/character',{data:{skin:0}});
 const client=new Client('http://127.0.0.1:'+(process.env.CARIBBEAN_API_PORT||'2634'),{headers:{Cookie:cookie},fetchFn:async(url,options)=>{
  const reply=await request.fetch(String(url),{method:options?.method,headers:Object.fromEntries(new Headers(options?.headers)),data:options?.body as string});
  return new Response(await reply.body(),{status:reply.status(),headers:reply.headers()});
 }});
 const room=await client.create<any>('lobby');
 for(const name of ['chat','activities','piano-note','notice','chat-check','security','ejected','pvp'])room.onMessage(name,()=>{});
 try{await use('/?room='+room.roomId);}finally{await Promise.race([room.leave(),new Promise(resolve=>setTimeout(resolve,1500))]);}
}});
const state=(page:Page)=>page.evaluate(()=>{try{return(window as any).royalDemo?.getState()??{};}catch{return{};}});
async function enter(page:Page,path:string,email=`ct-player-${crypto.randomUUID()}@example.test`){
 await page.route('https://luelonplay.com/demo-api/**',route=>route.fulfill({json:{games:[]}}));
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto(path);
 await page.getByLabel('Почта',{exact:true}).fill(email);await page.getByLabel('Пароль',{exact:true}).fill('Royal-ct-check-123!');
 await page.getByRole('button',{name:'Продолжить',exact:true}).click();
 await expect.poll(async()=>await page.locator('#character-step').isVisible()||!(await page.locator('#join-dialog').isVisible())).toBe(true);
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
 await expect.poll(async()=>page.evaluate(()=>(window as any).royalDemo.getMiniState()?.audio?.ready),{timeout:20000}).toBe(true);
 await expect.poll(async()=>page.evaluate(()=>(window as any).royalDemo.getMiniState()?.captain?.ready),{timeout:20000}).toBe(true);
 await expect(page.locator('#mini-dialog #club-chat-dock')).toBeVisible();
 await expect(page.locator('#chat-input')).toBeInViewport();
}
async function close(page:Page){await page.locator('#mini-dialog .mini-top [data-close]').click();await expect.poll(async()=>(await state(page)).cabinet).toBe('');}
async function topup(page:Page){
 const r=await page.request.post('/__test/caribbean/topup',{data:{amount:1000}});expect(r.ok()).toBe(true);
 await page.evaluate(async()=>{const path='/src/wallet/WalletClient.ts';await(await import(/* @vite-ignore */path)).demoWallet.refresh();});
}
async function session(page:Page){const r=await page.request.get('/api/demo-wallet/expansion',{headers:{'X-Royal-Caribbean-Treasures':'1'}});expect(r.ok()).toBe(true);return(await r.json()).sessions.find((s:any)=>s.gameId===game);}
async function wallet(page:Page){return(await(await page.request.get('/api/demo-wallet')).json());}
async function action(page:Page,selector:string){
 const reply=page.waitForResponse(r=>r.url().endsWith('/api/demo-wallet/expansion')&&r.request().method()==='POST');
 await page.locator(selector).click();const r=await reply;expect(r.ok()).toBe(true);const body=await r.json();
 await expect(page.locator('[data-ct-action=retry]')).toBeHidden();
 await expect.poll(async()=>page.locator('.ct-status').textContent()).not.toContain('Подтверждаем');
 await expect.poll(async()=>page.evaluate(()=>(window as any).royalDemo.getMiniState()?.presenting),{timeout:10000}).toBe(false);
 return body.session;
}
async function finish(page:Page){
 let s=await session(page);
 for(let moves=0;s.state==='active'&&moves<15;moves++)s=await action(page,'[data-ct-action=play]');
 expect(s.state).toBe('settled');return s;
}
async function layout(page:Page,name:string){
 await page.screenshot({path:out+'/'+name+'.png'});
 await expect(page.locator('[data-ct-action=play]')).toBeInViewport();await expect(page.locator('#chat-input')).toBeInViewport();
 await expect.poll(async()=>page.locator('.ct-root').evaluate(e=>Math.abs(e.getBoundingClientRect().height-e.closest('.mini-stage')!.getBoundingClientRect().height))).toBeLessThan(2);
 expect(await page.locator('.ct-root').evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
 await expect.poll(async()=>page.locator('.ct-symbol').evaluateAll(nodes=>nodes.every(n=>(n as HTMLImageElement).complete&&(n as HTMLImageElement).naturalWidth>=720))).toBe(true);
 const spin=await page.locator('.ct-play').boundingBox();expect(Math.abs(spin!.width-spin!.height)).toBeLessThan(1);
 const boxes=await page.locator('.ct-board,.ct-giant:not([hidden])').evaluateAll(nodes=>nodes.map(n=>{const b=n.getBoundingClientRect();return{x:b.x,y:b.y,right:b.right,bottom:b.bottom,width:b.width,height:b.height};}));
 if(boxes.length===2){expect(boxes[1].x).toBeGreaterThanOrEqual(boxes[0].x-1);expect(boxes[1].right).toBeLessThanOrEqual(boxes[0].right+1);expect(boxes[1].bottom).toBeLessThanOrEqual(boxes[0].bottom+1);expect(boxes[1].width).toBeGreaterThan(30);}
 await page.screenshot({path:out+'/'+name+'.png'});
}

async function crewState(page:Page){return page.evaluate(()=>(window as any).royalDemo.getMiniState()?.collection);}
async function crewLessons(page:Page){
 await page.locator('.ct-crew-tabs [data-ct-modal=tasks-tab]').click();
 for(const [id,answer] of [['lesson-lines','0'],['lesson-giant','1'],['lesson-cannon','0'],['lesson-settlement','2'],['lesson-cost','1']]){
  await page.locator(`[data-ct-modal="answer:${id}:${answer}"]`).click();await expect(page.locator(`[data-challenge-id=${id}]`)).toHaveAttribute('data-completed','true');
 }
}
test('crew collection earns free tokens, unlocks a chosen captain and persists beyond browser storage',async({page,roomPath})=>{
 test.setTimeout(180000);await enter(page,roomPath);await topup(page);await open(page);
 const mini=()=>page.evaluate(()=>(window as any).royalDemo.getMiniState()),before=await wallet(page);
 await expect.poll(()=>crewState(page)).toMatchObject({tokens:0,owned:['isabella'],selected:'isabella'});
 await page.locator('[data-ct-action=crew]').click();await expect(page.locator('.ct-crew-card')).toHaveCount(11);
 await expect(page.locator('[data-crew-id=amara]')).toHaveAttribute('data-owned','false');await page.screenshot({path:out+'/collection-locked-desktop.png'});
 await page.locator('[data-crew-id=amara]').click();await expect(page.locator('.ct-crew-challenge')).toHaveCount(7);
 await page.locator('[data-ct-modal="answer:lesson-giant:0"]').click();await expect(page.locator('[data-challenge-id=lesson-giant] .ct-crew-feedback')).toContainText('Попробуй другой ответ');await expect(page.locator('[data-challenge-id=lesson-giant] .ct-crew-feedback')).toBeInViewport();expect((await crewState(page)).tokens).toBe(0);
 await crewLessons(page);expect((await crewState(page)).tokens).toBe(100);await page.screenshot({path:out+'/collection-lessons-complete.png'});
 await page.locator('[data-ct-modal=crew-tab]').click();await expect(page.locator('[data-crew-id=amara]')).toContainText('Открыть');
 await page.locator('[data-crew-id=amara]').click();await expect(page.locator('[data-crew-id=amara]')).toHaveAttribute('data-owned','true');expect((await crewState(page)).tokens).toBe(0);
 await page.locator('[data-crew-id=amara]').click();await expect(page.locator('.ct-backdrop')).toBeHidden();await expect.poll(async()=>(await mini()).captain.character).toBe('amara');
 expect((await wallet(page)).entries).toEqual(before.entries);
 await close(page);await page.evaluate(()=>localStorage.clear());await page.reload();await expect.poll(async()=>(await state(page)).online).toBe(true);await open(page);
 await expect.poll(async()=>(await mini()).captain.character).toBe('amara');expect((await mini()).captain.history).toEqual([]);
 await page.setViewportSize({width:390,height:844});await page.locator('[data-ct-action=crew]').click();
 await expect(page.locator('#chat-input')).toBeInViewport();await page.screenshot({path:out+'/collection-unlocked-mobile.png'});
 await page.locator('[data-crew-id=ines]').scrollIntoViewIfNeeded();await expect(page.locator('.ct-crew-close')).toBeInViewport();await page.locator('.ct-crew-close').click();await expect(page.locator('[data-ct-action=crew]')).toBeFocused();
 const me=await(await page.request.get('/api/auth/me')).json(),headers={'X-Royal-Account-Id':me.account.id};
 const forged=await page.request.post('/api/caribbean-crew',{headers,data:{id:crypto.randomUUID(),action:'select',characterId:'ines'}});expect(forged.status()).toBe(403);
 expect((await wallet(page)).entries).toEqual(before.entries);
});

test('spin keeps the portrait frame and lower controls anchored throughout confirmation and reveal',async({page,roomPath})=>{
 test.setTimeout(120000);await enter(page,roomPath);await topup(page);await open(page);
 await page.emulateMedia({reducedMotion:'no-preference'});
 const measurements:any[]=[];
 await page.route('**/api/demo-wallet/expansion',async route=>{
  if(route.request().method()==='POST')await new Promise(resolve=>setTimeout(resolve,500));
  await route.continue();
 });
 for(const [width,height]of [[1440,1000],[1280,720],[390,844]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(150);
  await page.request.post('/__test/caribbean/force-scenario',{data:{name:'loss'}});
  await page.evaluate(()=>{
   const selectors=['.ct-captain','.ct-avatar','.ct-ledger','.ct-controls','.ct-status'];
   const state=(window as any).__ctAnchors={samples:[] as any[],running:true};
   const sample=()=>{state.samples.push(Object.fromEntries(selectors.map(selector=>{const r=document.querySelector(selector)!.getBoundingClientRect();return[selector,{x:r.x,y:r.y,width:r.width,height:r.height}];})));if(state.running)requestAnimationFrame(sample);};sample();
  });
  await action(page,'[data-ct-action=play]');
  const sample=await page.evaluate(()=>{const s=(window as any).__ctAnchors;s.running=false;return s.samples;});
  const drift=Object.fromEntries(Object.keys(sample[0]).map(selector=>[selector,Math.max(...sample.flatMap((s:any)=>['x','y','width','height'].map(key=>Math.abs(s[selector][key]-sample[0][selector][key]))))]));
  measurements.push({width,height,frames:sample.length,drift});
 }
 const{writeFile}=await import('node:fs/promises');await writeFile(out+'/spin-anchors.json',JSON.stringify(measurements,null,2));
 for(const m of measurements)for(const[selector,drift]of Object.entries(m.drift))expect(drift,`${m.width} ${selector}`).toBeLessThanOrEqual(.75);
});

test('finite autoplay runs the selected paid budget once and stops without another debit',async({page,roomPath})=>{
 test.setTimeout(90000);await enter(page,roomPath);await topup(page);await open(page);
 const requests:string[]=[];
 await page.route('**/api/demo-wallet/expansion',async route=>{
  if(route.request().method()==='POST'){
   const op=route.request().postDataJSON();expect(op.action).toBe('start');expect(op.settings.caribbean.mode).toBe('normal');requests.push(op.id);
   await page.request.post('/__test/caribbean/force-scenario',{data:{name:'loss'}});
  }
  await route.continue();
 });
 const before=(await wallet(page)).balance;
 await page.locator('[data-ct-auto-count]').selectOption('10');await page.locator('[data-ct-action=auto]').click();
 await expect(page.locator('[data-ct-lines]')).toBeDisabled();await expect(page.locator('[data-ct-stake]')).toBeDisabled();await expect(page.locator('[data-ct-action=buy]')).toBeDisabled();
 await expect.poll(()=>page.evaluate(()=>(window as any).royalDemo.getMiniState()?.autoplay.note),{timeout:45000}).toBe('complete');
 expect(requests).toHaveLength(10);expect(new Set(requests).size).toBe(10);
 expect((await wallet(page)).balance).toBe(before-200);expect((await wallet(page)).entries.filter((e:any)=>e.kind==='bet')).toHaveLength(10);
 expect(await page.evaluate(()=>(window as any).royalDemo.getMiniState().autoplay.timerPending)).toBe(false);
 await page.waitForTimeout(800);expect(requests).toHaveLength(10);
});

test('autoplay Stop during confirmation preserves the accepted request and prevents following starts',async({page,roomPath})=>{
 await enter(page,roomPath);await topup(page);await open(page);let starts=0;
 await page.route('**/api/demo-wallet/expansion',async route=>{
  if(route.request().method()==='POST'){starts++;await page.request.post('/__test/caribbean/force-scenario',{data:{name:'loss'}});await new Promise(resolve=>setTimeout(resolve,600));}
  await route.continue();
 });
 await page.locator('[data-ct-action=auto]').click();await expect.poll(()=>starts).toBe(1);
 await page.locator('[data-ct-action=auto]').click();await expect.poll(()=>page.evaluate(()=>(window as any).royalDemo.getMiniState().presenting)).toBe(false);
 await page.waitForTimeout(900);expect(starts).toBe(1);expect((await wallet(page)).entries.filter((e:any)=>e.kind==='bet')).toHaveLength(1);
 expect(await page.evaluate(()=>(window as any).royalDemo.getMiniState().autoplay)).toMatchObject({running:false,timerPending:false,note:'stopped'});
});

test('autoplay waits for the chosen tactic and free continuations do not spend its paid budget',async({page,roomPath})=>{
 test.setTimeout(90000);await enter(page,roomPath);await topup(page);await open(page);
 let starts=0,chosen=false,free=0;
 await page.route('**/api/demo-wallet/expansion',async route=>{
  if(route.request().method()==='POST'){
   const op=route.request().postDataJSON();
   if(op.action==='start'){starts++;if(starts===1)await page.request.post('/__test/caribbean/force-bonus');else await page.request.post('/__test/caribbean/force-scenario',{data:{name:'loss'}});}
   else if(op.move==='caribbean-spin'){expect(chosen).toBe(true);free++;}
  }
  await route.continue();
 });
 await page.locator('[data-ct-action=auto]').click();await expect(page.locator('[data-ct-action=choose-flagship]')).toBeVisible();
 await page.waitForTimeout(800);expect(starts).toBe(1);expect(free).toBe(0);
 expect(await page.evaluate(()=>(window as any).royalDemo.getMiniState().autoplay)).toMatchObject({running:true,remaining:9,waitingForTactic:true});
 chosen=true;await page.locator('[data-ct-action=choose-flagship]').click();
 await expect.poll(()=>page.evaluate(()=>(window as any).royalDemo.getMiniState().autoplay.note),{timeout:45000}).toBe('complete');
 expect(starts).toBe(10);expect(free).toBe(6);expect((await wallet(page)).entries.filter((e:any)=>e.kind==='bet')).toHaveLength(10);
});

test('autoplay stops on a lost response and a manual replay uses the original UUID',async({page,roomPath})=>{
 await enter(page,roomPath);await topup(page);await open(page);const ids:string[]=[];let dropped=false;
 await page.route('**/api/demo-wallet/expansion',async route=>{
  if(route.request().method()==='POST'){
   ids.push(route.request().postDataJSON().id);
   if(!dropped){dropped=true;await page.request.post('/__test/caribbean/force-scenario',{data:{name:'loss'}});await route.fetch();await route.abort('failed');return;}
  }
  await route.continue();
 });
 await page.locator('[data-ct-action=auto]').click();await expect(page.locator('[data-ct-action=retry]')).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>(window as any).royalDemo.getMiniState().autoplay.note)).toBe('error');
 await page.locator('[data-ct-action=retry]').click();await expect(page.locator('[data-ct-action=retry]')).toBeHidden();
 await page.waitForTimeout(900);expect(ids).toHaveLength(2);expect(ids[1]).toBe(ids[0]);expect((await wallet(page)).entries.filter((e:any)=>e.kind==='bet')).toHaveLength(1);
 expect(await page.evaluate(()=>(window as any).royalDemo.getMiniState().autoplay.running)).toBe(false);
});

test('autoplay stops for funds, blur, account change and closing and never resumes when reopened',async({page,roomPath})=>{
 await enter(page,roomPath);await topup(page);await open(page);
 await page.locator('[data-ct-lines]').selectOption('20');await page.locator('[data-ct-stake]').selectOption('1000');let starts=0;
 await page.route('**/api/demo-wallet/expansion',async route=>{
  if(route.request().method()==='POST'){starts++;await page.request.post('/__test/caribbean/force-scenario',{data:{name:'loss'}});}
  await route.continue();
 });
 await page.locator('[data-ct-action=auto]').click();await expect.poll(()=>page.evaluate(()=>(window as any).royalDemo.getMiniState().autoplay.note),{timeout:30000}).toBe('funds');
 expect(starts).toBe(5);await topup(page);await page.locator('[data-ct-action=auto]').click();await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
 expect(await page.evaluate(()=>(window as any).royalDemo.getMiniState().autoplay)).toMatchObject({running:false,timerPending:false,note:'paused'});
 await page.locator('[data-ct-action=auto]').click();await close(page);await page.waitForTimeout(800);expect(starts).toBe(5);await open(page);
 expect(await page.evaluate(()=>(window as any).royalDemo.getMiniState().autoplay)).toMatchObject({running:false,timerPending:false});
 await page.locator('[data-ct-action=auto]').click();
 await page.evaluate(async()=>{const path='/src/wallet/ExpansionClient.ts';(await import(/* @vite-ignore */path)).expansionClient.setAccount(null);});
 expect(await page.evaluate(()=>(window as any).royalDemo.getMiniState().autoplay)).toMatchObject({running:false,timerPending:false,note:'account'});
 await page.waitForTimeout(800);expect(starts).toBe(5);
});

test('interrupting a captain reaction preserves its current transform before easing into focus',async({page})=>{
 await page.goto('/?offline=1');await page.emulateMedia({reducedMotion:'no-preference'});
 const continuity=await page.evaluate(async()=>{
  const path='/games/caribbean-treasures/CaribbeanCaptain.ts',module=await import(/* @vite-ignore */path);
  const root=document.createElement('section');root.innerHTML='<span class="ct-portrait-gesture" style="display:block;width:200px;height:300px"><img class="ct-portrait-layer"><img class="ct-portrait-layer"></span><span class="ct-captain-caption" hidden></span>';document.body.append(root);
  const captain=new module.CaribbeanCaptain(root);await captain.select('isabella');captain.context(true,false,false);captain.react('bigwin','continuity');
  await new Promise(resolve=>setTimeout(resolve,250));
  const node=root.querySelector('.ct-portrait-gesture')!,before=new DOMMatrix(getComputedStyle(node).transform);
  captain.begin();const after=new DOMMatrix(getComputedStyle(node).transform);
  const displacement=Math.hypot(after.e-before.e,after.f-before.f);captain.destroy();root.remove();
  return{displacement,animations:captain.state().animations,timers:captain.state().timers};
 });
 expect(continuity.displacement).toBeLessThanOrEqual(.75);expect(continuity.animations).toBe(0);expect(continuity.timers).toBe(0);
});

test('a lost cosmetic unlock response preserves tokens, paid bonus and account ownership',async({page,roomPath})=>{
 await enter(page,roomPath);await topup(page);await open(page);await expect.poll(()=>crewState(page)).not.toBeNull();
 await page.request.post('/__test/caribbean/force-bonus');const paid=await action(page,'[data-ct-action=play]');expect(paid.view.caribbean.phase).toBe('choice');const before=await wallet(page);
 await page.locator('[data-ct-action=crew]').click();await crewLessons(page);await page.locator('[data-ct-modal=crew-tab]').click();
 let lost=false;await page.route('**/api/caribbean-crew',async route=>{const r=route.request(),body=r.method()==='POST'?r.postDataJSON():null;if(!lost&&body?.action==='unlock'){lost=true;await route.fetch();await route.abort();}else await route.continue();});
 await page.locator('[data-crew-id=mei]').click();await expect(page.locator('.ct-crew-status')).toContainText('Не удалось подтвердить');await page.locator('[data-ct-modal=crew-refresh]').click();
 await expect(page.locator('[data-crew-id=mei]')).toHaveAttribute('data-owned','true');expect((await crewState(page)).tokens).toBe(0);await page.locator('[data-crew-id=mei]').click();await expect(page.locator('.ct-backdrop')).toBeHidden();
 const restored=await session(page);expect(restored.id).toBe(paid.id);expect(restored.view.caribbean.phase).toBe('choice');expect(restored.spentUnits).toBe(paid.spentUnits);expect((await wallet(page)).entries).toEqual(before.entries);
 await close(page);await open(page);await expect.poll(async()=>page.evaluate(()=>(window as any).royalDemo.getMiniState().captain.character)).toBe('mei');
 await action(page,'[data-ct-action=choose-flagship]');await finish(page);expect((await wallet(page)).entries.filter((entry:any)=>entry.kind==='bet')).toHaveLength(1);
});

test('collection outage keeps the slot playable and recovers without resetting the account',async({page,roomPath})=>{
 await page.route('**/api/caribbean-crew',route=>route.fulfill({status:503,json:{error:'collection-unavailable'}}));
 await enter(page,roomPath);await topup(page);await open(page);await page.locator('[data-ct-action=crew]').click();
 await expect(page.locator('.ct-crew-status')).toContainText('Не удалось подтвердить');await page.locator('.ct-crew-close').click();
 await page.request.post('/__test/caribbean/force-scenario',{data:{name:'partial'}});const paid=await action(page,'[data-ct-action=play]');expect(paid.state).toBe('settled');
 await page.unroute('**/api/caribbean-crew');await page.locator('[data-ct-action=crew]').click();await expect(page.locator('[data-crew-id=isabella]')).toHaveAttribute('data-owned','true');expect((await crewState(page)).tokens).toBe(0);
 expect((await wallet(page)).entries.filter((entry:any)=>entry.kind==='bet')).toHaveLength(1);
});

test('closing a captain selection before a failed confirmation keeps the saved identity during a spin',async({page,roomPath})=>{
 await enter(page,roomPath);await topup(page);await open(page);
 await page.locator('[data-ct-action=crew]').click();await crewLessons(page);await page.locator('[data-ct-modal=crew-tab]').click();
 await page.locator('[data-crew-id=amara]').click();await expect(page.locator('[data-crew-id=amara]')).toHaveAttribute('data-owned','true');
 let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});let requested=false;
 await page.route('**/api/caribbean-crew',async route=>{
  if(route.request().method()==='POST'&&route.request().postDataJSON()?.action==='select'){requested=true;await held;await route.fulfill({status:503,json:{error:'collection-unavailable'}});}
  else await route.continue();
 });
 try{
  await page.locator('[data-crew-id=amara]').click();await expect.poll(()=>requested).toBe(true);
  await page.locator('.ct-crew-close').click();await page.request.post('/__test/caribbean/force-scenario',{data:{name:'partial'}});
  const round=await action(page,'[data-ct-action=play]');expect(round.state).toBe('settled');release();
  await expect.poll(async()=>page.evaluate(()=>(window as any).royalDemo.getMiniState().captain.character)).toBe('isabella');
  expect((await crewState(page)).selected).toBe('isabella');
  const me=(await(await page.request.get('/api/auth/me')).json()).account;
  const saved=await page.request.get('/api/caribbean-crew',{headers:{'X-Royal-Account-Id':me.id}});expect((await saved.json()).selected).toBe('isabella');
  expect((await wallet(page)).entries.filter((entry:any)=>entry.kind==='bet')).toHaveLength(1);
 }finally{release();}
});

test('a late accepted captain selection waits until paid presentation ends',async({page,roomPath})=>{
 await enter(page,roomPath);await topup(page);await open(page);
 await page.locator('[data-ct-action=crew]').click();await crewLessons(page);await page.locator('[data-ct-modal=crew-tab]').click();
 await page.locator('[data-crew-id=amara]').click();await expect(page.locator('[data-crew-id=amara]')).toHaveAttribute('data-owned','true');
 let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});let accepted=false;
 await page.route('**/api/caribbean-crew',async route=>{
  if(route.request().method()==='POST'&&route.request().postDataJSON()?.action==='select'){const response=await route.fetch();accepted=true;await held;await route.fulfill({response});}
  else await route.continue();
 });
 try{
  await page.locator('[data-crew-id=amara]').click();await expect.poll(()=>accepted).toBe(true);
  await expect(page.locator('[data-ct-modal=crew-refresh]')).toBeDisabled();
  await page.locator('.ct-crew-close').click();await page.emulateMedia({reducedMotion:'no-preference'});
  await page.request.post('/__test/caribbean/force-scenario',{data:{name:'partial'}});await page.locator('[data-ct-action=play]').click();
  await expect.poll(async()=>page.evaluate(()=>(window as any).royalDemo.getMiniState().visualPhase)).toBe('reels');release();
  await expect.poll(async()=>(await crewState(page)).selected).toBe('amara');
  expect(await page.evaluate(()=>(window as any).royalDemo.getMiniState().captain.character)).toBe('isabella');
  await expect.poll(async()=>page.evaluate(()=>(window as any).royalDemo.getMiniState().presenting)).toBe(false);
  await expect.poll(async()=>page.evaluate(()=>(window as any).royalDemo.getMiniState().captain.character)).toBe('amara');
  await close(page);await open(page);await expect.poll(async()=>page.evaluate(()=>(window as any).royalDemo.getMiniState().captain.character)).toBe('amara');
  expect((await wallet(page)).entries.filter((entry:any)=>entry.kind==='bet')).toHaveLength(1);
 }finally{release();}
});

test('crew loading failure, cancellation and every captain reaction retain a consistent identity',async({page})=>{
 await page.goto('/tests/fixtures/caribbean-audio.html');
 await page.evaluate(async()=>{
  const root=document.createElement('section');root.innerHTML='<span class="ct-portrait-gesture"><img class="ct-portrait-layer"><img class="ct-portrait-layer"></span><span class="ct-captain-caption" hidden></span>';document.body.append(root);
  const path='/games/caribbean-treasures/CaribbeanCaptain.ts';const {CaribbeanCaptain}=await import(/* @vite-ignore */path);(window as any).__crewCaptain=new CaribbeanCaptain(root);
 });
 const captain=()=>page.evaluate(()=>(window as any).__crewCaptain.state());
 await expect.poll(async()=>(await captain()).ready).toBe(true);
 await page.route('**/crew/mei-surprise.webp',route=>route.abort());
 expect(await page.evaluate(()=>(window as any).__crewCaptain.select('mei'))).toBe(false);expect((await captain()).character).toBe('isabella');expect((await captain()).loading).toBe(false);
 await page.unroute('**/crew/mei-surprise.webp');
 const results=await page.evaluate(async()=>{
  const c=(window as any).__crewCaptain,results=[];
  for(const id of ['amara','mei','priya','yasmin','zahara','catalina','moana','freya','rowan','ines']){
   if(!await c.select(id))throw Error('Captain did not decode: '+id);c.context(true,true,false);
   const poses=[];
   for(const [cue,expected] of [['cannon','surprise'],['bonus','bonus'],['partial','soft'],['loss','soft'],['win','win'],['bigwin','laugh']]){
    c.react(cue,id+cue);const current=document.querySelector<HTMLImageElement>('.ct-current')!;
    poses.push({cue,expected,pose:c.state().pose,src:current.src});
   }
   c.context(false,true,false);results.push({id,poses,state:c.state()});
  }
  return results;
 });
 for(const result of results){for(const reaction of result.poses){expect(reaction.pose).toBe(reaction.expected);expect(reaction.src).toContain('/crew/'+result.id+'-'+reaction.expected+'.webp');}expect(result.state.timers).toBe(0);expect(result.state.animations).toBe(0);}
 expect(await page.evaluate(async()=>{const c=(window as any).__crewCaptain,pending=c.select('amara');c.begin();return pending;})).toBe(false);expect((await captain()).character).toBe('ines');
 expect(await page.evaluate(async()=>{const c=(window as any).__crewCaptain,pending=c.select('amara');c.cancelSelection();return pending;})).toBe(false);expect((await captain()).character).toBe('ines');
 expect(await page.evaluate(async()=>{const c=(window as any).__crewCaptain,pending=c.select('mei');c.destroy();return pending;})).toBe(false);expect((await captain()).timers).toBe(0);
 const {writeFile}=await import('node:fs/promises');await writeFile(out+'/crew-reactions.json',JSON.stringify(results,null,2));
});

test('header controls paint above overlapping pirate art and every tool remains usable',async({page,roomPath})=>{
 await enter(page,roomPath);await topup(page);await open(page);
 const tools=page.locator('.ct-header-tools button'),regions:Buffer[]=[];
 await page.locator('.ct-root').evaluate((e:HTMLElement)=>{e.style.overflow='clip';});
 const capture=async(index:number)=>{const b=(await tools.nth(index).boundingBox())!;return page.screenshot({animations:'disabled',clip:{x:b.x+6,y:b.y+6,width:b.width-12,height:b.height-12}});};
 const {writeFile}=await import('node:fs/promises');
 for(let i=0;i<4;i++){const region=await capture(i);regions.push(region);await writeFile(out+'/toolbar-before-'+i+'.png',region);}
 // Reproduce the reported overhang without changing production geometry or game state.
 await page.evaluate(()=>{
  const pirate=document.querySelector<HTMLElement>('.ct-captain')!,img=pirate.querySelector<HTMLImageElement>('.ct-current')!,panel=document.querySelector('.ct-header-tools')!.getBoundingClientRect(),b=img.getBoundingClientRect();
  const scale=Math.min(img.clientWidth/img.naturalWidth,img.clientHeight/img.naturalHeight),w=img.naturalWidth*scale,h=img.naturalHeight*scale;
  const faceX=b.x+(img.clientWidth-w)/2+w*.6,faceY=b.y+img.clientHeight-h+h*.15;
  pirate.style.transform=`translate(${panel.x+panel.width/2-faceX}px,${panel.y+panel.height/2-faceY}px)`;
 });
 await page.screenshot({path:out+'/header-overlap.png',animations:'disabled'});
 for(let i=0;i<4;i++){const region=await capture(i);await writeFile(out+'/toolbar-after-'+i+'.png',region);expect(region.equals(regions[i]),'Pirate pixels cannot replace the opaque interior of toolbar button '+i).toBe(true);}
 await page.locator('.ct-captain').evaluate((e:HTMLElement)=>{e.style.removeProperty('transform');});await page.locator('.ct-root').evaluate((e:HTMLElement)=>{e.style.removeProperty('overflow');});
 for(const [width,height] of [[1440,1000],[1280,720],[390,844]]){
  await page.setViewportSize({width,height});await expect(tools).toHaveCount(4);
  for(let i=0;i<4;i++)await expect(tools.nth(i)).toBeInViewport();
  await page.locator('[data-ct-action=music]').click();await expect(page.locator('[data-ct-action=music]')).toHaveAttribute('aria-pressed','false');await page.locator('[data-ct-action=music]').click();
  await page.locator('[data-ct-action=sound]').click();await expect(page.locator('[data-ct-action=sound]')).toHaveAttribute('aria-pressed','false');await page.locator('[data-ct-action=sound]').click();
  for(const action of ['info','history']){
   await page.locator(`[data-ct-action=${action}]`).click();await expect(page.locator('.ct-modal')).toBeVisible();
   expect(await page.locator('.ct-header-tools').evaluate(e=>{const b=e.getBoundingClientRect();return !!document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)?.closest('.ct-backdrop');})).toBe(true);
   await page.locator('.ct-modal').press('Escape');await expect(page.locator('.ct-backdrop')).toBeHidden();
  }
  await page.screenshot({path:out+`/header-${width}x${height}.png`});
 }
 expect((await wallet(page)).entries.filter((e:any)=>e.kind==='bet')).toEqual([]);
});

test('catalogue pirate captain cover stays sharp on desktop and mobile and reopens the same round',async({page,roomPath})=>{
 await enter(page,roomPath);await topup(page);await openCatalog(page);
 const card=page.locator(`[data-platform-game="${game}"]`),art=card.locator('.rp-art img');
 await card.scrollIntoViewIfNeeded();
 await expect(art).toHaveAttribute('src',/\/assets\/royal-catalog\/studio-caribbean-treasures\.[a-f0-9]{12}\.webp$/);
 await expect.poll(async()=>art.evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth===512&&img.naturalHeight===320)).toBe(true);
 await page.screenshot({path:out+'/catalog-desktop.png'});
 await page.setViewportSize({width:390,height:844});await page.getByRole('searchbox',{name:'Найти игру',exact:true}).fill('Карибские');
 await expect(page.locator('.rp-card')).toHaveCount(1);await card.scrollIntoViewIfNeeded();await expect(art).toBeInViewport();await expect(page.locator('#chat-input')).toBeInViewport();
 await page.screenshot({path:out+'/catalog-mobile.png'});await card.click();
 await expect(page.locator('.ct-root')).toBeVisible();await expect.poll(async()=>page.evaluate(()=>(window as any).royalDemo.getMiniState()?.captain?.ready)).toBe(true);
 await expect(page.locator('[data-ct-lines]')).toBeEnabled();await page.locator('[data-ct-lines]').selectOption('1');await page.request.post('/__test/caribbean/force-bonus');const accepted=await action(page,'[data-ct-action=play]');
 await action(page,'[data-ct-action=choose-flagship]');const before=await wallet(page);
 await page.locator('#studio-game-list').click();await expect(art).toHaveAttribute('src',/studio-caribbean-treasures\.[a-f0-9]{12}\.webp$/);await card.scrollIntoViewIfNeeded();await card.click();
 await expect(page.locator('.ct-root')).toBeVisible();expect((await session(page)).id).toBe(accepted.id);expect((await wallet(page)).balance).toBe(before.balance);
 await finish(page);expect((await wallet(page)).entries.filter((e:any)=>e.operationId===accepted.id&&e.kind==='bet')).toHaveLength(1);
});

test('responsive framing keeps the title and full captain artwork inside the host',async({page,roomPath})=>{
 test.setTimeout(120000);await enter(page,roomPath);await topup(page);await open(page);
 const measurements:any[]=[];
 for(const [width,height] of [[1440,1000],[1280,720],[1024,768],[900,650],[800,600],[640,480],[500,760],[390,844],[342,700],[844,390],[342,245]]){
  await page.setViewportSize({width,height});
  await expect.poll(async()=>page.evaluate(()=>{const d=document.querySelector<HTMLElement>('#mini-dialog')!,s=d.querySelector<HTMLElement>('.mini-stage')!;return d.dataset.gameViewportReady===d.dataset.game+'|'+s.clientWidth+'x'+s.clientHeight+'|off';})).toBe(true);
  const measured=await page.evaluate(()=>{
   const root=document.querySelector<HTMLElement>('.ct-root')!,title=root.querySelector<HTMLElement>('.ct-title')!,heading=title.querySelector('h2')!,captain=root.querySelector<HTMLElement>('.ct-captain')!,image=captain.querySelector<HTMLImageElement>('.ct-current')!;
   const box=(e:Element)=>{const b=e.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height,right:b.right,bottom:b.bottom};};
   const text=document.createRange();text.selectNodeContents(heading);const b=text.getBoundingClientRect();
   const visible=getComputedStyle(captain).display!=='none',style=getComputedStyle(image),scale=style.objectFit==='contain'?Math.min(image.clientWidth/image.naturalWidth,image.clientHeight/image.naturalHeight):Math.max(image.clientWidth/image.naturalWidth,image.clientHeight/image.naturalHeight);
   return{root:box(root),rootOverflowX:root.scrollWidth-root.clientWidth,pageOverflowX:document.documentElement.scrollWidth-innerWidth,title:box(title),titleText:{x:b.x,right:b.right,y:b.y,bottom:b.bottom},captain:visible?{box:box(captain),objectFit:style.objectFit,clippedX:Math.max(0,image.naturalWidth*scale-image.clientWidth),clippedY:Math.max(0,image.naturalHeight*scale-image.clientHeight)}:null,stage:box(root.querySelector('.ct-stage')!),play:box(root.querySelector('[data-ct-action=play]')!),chat:box(document.querySelector('#chat-input')!)};
  });
  measurements.push({width,height,...measured});await page.screenshot({path:out+`/framing-${width}x${height}.png`});
  if(width<=640&&height<=540){
   await page.locator('[data-ct-action=play]').scrollIntoViewIfNeeded();await expect(page.locator('[data-ct-action=play]')).toBeInViewport();
   await page.locator('#chat-input').scrollIntoViewIfNeeded();await expect(page.locator('#chat-input')).toBeInViewport();
   await page.locator('.ct-heading h2').scrollIntoViewIfNeeded();
  }
 }
 const {writeFile}=await import('node:fs/promises');await writeFile(out+'/framing-measurements.json',JSON.stringify(measurements,null,2));
 expect(measurements.filter(m=>m.captain&&(m.captain.clippedX>1||m.captain.clippedY>1)), 'All source portrait pixels must fit, without cover cropping').toEqual([]);
 expect(measurements.filter(m=>m.pageOverflowX>1||m.rootOverflowX>1||m.titleText.x<m.root.x-1||m.titleText.right>m.root.right+1), 'Text and controls cannot spill horizontally').toEqual([]);
 await page.setViewportSize({width:1280,height:720});await page.request.post('/__test/caribbean/force-bonus');await action(page,'[data-ct-action=play]');
 await layout(page,'framing-bonus-1280x720');await action(page,'[data-ct-action=choose-flagship]');await finish(page);
});

test('empty balance explains disabled spins, live funding unlocks an exact-cost single line and free spins need no balance',async({page,roomPath})=>{
 await enter(page,roomPath);await open(page);await page.locator('[data-ct-lines]').selectOption('1');await page.locator('[data-ct-stake]').selectOption('1000');
 await expect(page.locator('[data-ct-balance]')).toHaveText('0');await expect(page.locator('[data-ct-action=play]')).toBeDisabled();await expect(page.locator('[data-ct-action=buy]')).toBeDisabled();
 await expect(page.locator('.ct-status')).toContainText('Недостаточно средств: нужно 10 USDT.');
 expect((await wallet(page)).entries.filter((e:any)=>e.kind==='bet')).toEqual([]);
 await layout(page,'empty-balance-desktop');await page.setViewportSize({width:390,height:844});await layout(page,'empty-balance-mobile');await page.setViewportSize({width:1440,height:1000});
 await page.getByRole('button',{name:'Открыть тестовый кошелёк',exact:true}).click();await expect(page.locator('#wallet-dialog')).toBeVisible();await page.getByRole('button',{name:'Закрыть кошелёк',exact:true}).click();
 const funded=await page.request.post('/__test/caribbean/topup',{data:{amount:1}});expect(funded.ok()).toBe(true);
 // A real shared-wallet refresh must update this already mounted game without reopening.
 await page.evaluate(async()=>{const path='/src/wallet/WalletClient.ts';await(await import(/* @vite-ignore */path)).demoWallet.refresh();});
 await expect(page.locator('[data-ct-balance]')).toHaveText('1');await expect(page.locator('[data-ct-action=play]')).toBeDisabled();
 await page.locator('[data-ct-stake]').selectOption('100');await expect(page.locator('[data-ct-action=play]')).toBeEnabled();
 await page.request.post('/__test/caribbean/force-bonus');const paid=await action(page,'[data-ct-action=play]');expect(paid.spentUnits).toBe('100');
 await expect(page.locator('[data-ct-balance]')).toHaveText('0');await expect(page.locator('[data-ct-action=choose-flagship]')).toBeEnabled();
 await action(page,'[data-ct-action=choose-flagship]');await expect(page.locator('[data-ct-action=play]')).toBeEnabled();await finish(page);
 expect((await wallet(page)).entries.filter((e:any)=>e.kind==='bet')).toHaveLength(1);
 await topup(page);
 let rejected=false;await page.route('**/api/demo-wallet/expansion',async route=>{
  if(route.request().method()==='POST'&&!rejected){rejected=true;await route.fulfill({status:409,json:{error:'Недостаточно демомонет для начальных ставок.'}});}else await route.continue();
 });
 const refreshed=page.waitForResponse(r=>r.url().endsWith('/api/demo-wallet/expansion')&&r.request().method()==='GET');await page.locator('[data-ct-action=play]').click();await refreshed;
 await expect(page.locator('.ct-status')).toHaveText('Недостаточно демомонет для начальных ставок.');
 await expect(page.locator('[data-ct-action=retry]')).toBeHidden();expect((await wallet(page)).entries.filter((e:any)=>e.kind==='bet')).toHaveLength(1);
 await page.locator('[data-ct-stake]').selectOption('200');await expect(page.locator('.ct-status')).not.toContainText('Недостаточно');
});

test('natural bonus, real host/chat, line presets and desktop/mobile layout',async({page,roomPath})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await enter(page,roomPath);await topup(page);await open(page);
 await layout(page,'reference-ready-desktop');
 await page.locator('[data-ct-action=lines-down]').click();await expect(page.locator('[data-ct-lines]')).toHaveValue('10');
 await page.locator('[data-ct-action=lines-up]').click();await expect(page.locator('[data-ct-lines]')).toHaveValue('20');await expect(page.locator('[data-ct-action=lines-up]')).toBeDisabled();
 await page.locator('[data-ct-action=stake-up]').click();await expect(page.locator('[data-ct-stake]')).toHaveValue('200');await page.locator('[data-ct-action=stake-down]').click();await expect(page.locator('[data-ct-stake]')).toHaveValue('100');await expect(page.locator('[data-ct-action=stake-down]')).toBeDisabled();
 await page.locator('[data-ct-lines]').selectOption('5');await page.locator('[data-ct-stake]').selectOption('200');
 await expect(page.locator('[data-ct-action=play]')).toContainText('10');
 await page.locator('[data-ct-action=info]').click();await expect(page.locator('.ct-modal')).toBeVisible();
 await expect(page.locator('.ct-audio-credits')).toContainText('Matthew Pablo');await expect(page.locator('.ct-audio-credits')).toContainText('CC BY 3.0');
 await page.locator('.ct-modal').press('Escape');await expect(page.locator('.ct-backdrop')).toBeHidden();await expect(page.locator('#mini-dialog')).toBeVisible();
 await page.locator('[data-ct-action=lines]').click();await expect(page.locator('.ct-paths polyline')).toHaveCount(5);
 const before=await wallet(page);await page.request.post('/__test/caribbean/force-bonus');const started=await action(page,'[data-ct-action=play]');
 expect(started.view.caribbean.phase).toBe('choice');expect(started.spentUnits).toBe('1000');
 expect((await(await page.request.get('/api/demo-wallet/expansion')).json()).sessions.some((s:any)=>s.gameId===game)).toBe(false);
 await expect(page.locator('[data-ct-lines]')).toBeDisabled();await expect(page.locator('[data-ct-stake]')).toBeDisabled();
 await action(page,'[data-ct-action=choose-flagship]');await action(page,'[data-ct-action=play]');
 await layout(page,'desktop');await page.setViewportSize({width:390,height:844});await layout(page,'mobile');
 const saved=await session(page);await close(page);await open(page);expect((await session(page)).id).toBe(saved.id);
 const done=await finish(page),after=await wallet(page);
 expect(after.balance).toBe(before.balance-10+Number(done.returnedUnits)/100);
 expect(after.entries.filter((e:any)=>e.operationId===done.id&&e.kind==='bet')).toHaveLength(1);
 expect(after.entries.filter((e:any)=>e.kind==='win')).toHaveLength(1);
 await page.locator('[data-ct-action=history]').click();await expect(page.locator('.ct-modal')).toContainText('Флагман');
 await page.locator('.ct-modal').press('Escape');expect(errors).toEqual([]);
});

test('an accepted start survives a lost response and reopening without duplicate debit',async({page,roomPath})=>{
 await enter(page,roomPath);await topup(page);await open(page);await page.locator('[data-ct-lines]').selectOption('1');
 await page.request.post('/__test/caribbean/force-bonus');
 let lost=false;await page.route('**/api/demo-wallet/expansion',async route=>{
  if(route.request().method()==='POST'&&!lost){lost=true;const accepted=await route.fetch();expect(accepted.ok(),await accepted.text()).toBe(true);await route.abort('failed');}else await route.continue();
 });
 await page.locator('[data-ct-action=play]').click();await expect(page.locator('[data-ct-action=retry]')).toBeVisible();
 await expect(page.locator('[data-ct-action=retry]')).toBeEnabled();
 const committed=await session(page),before=await wallet(page);expect(committed.state).toBe('active');
 await close(page);await open(page);await expect(page.locator('[data-ct-action=retry]')).toBeVisible();
 await action(page,'[data-ct-action=retry]');expect((await session(page)).id).toBe(committed.id);
 expect((await wallet(page)).balance).toBe(before.balance);
 await action(page,'[data-ct-action=choose-raid]');
 // A lost free-spin reply changes no balance: a successful retry must also clear its old message.
 lost=false;await page.locator('[data-ct-action=play]').click();await expect(page.locator('[data-ct-action=retry]')).toBeVisible();await expect(page.locator('[data-ct-action=retry]')).toBeEnabled();
 await action(page,'[data-ct-action=retry]');await expect(page.locator('.ct-status')).not.toContainText('Ответ не получен');
 await finish(page);
 expect((await wallet(page)).entries.filter((e:any)=>e.operationId===committed.id&&e.kind==='bet')).toHaveLength(1);
});

test('both purchased tactics show the accepted price and recover after a full reload',async({page,roomPath})=>{
 await enter(page,roomPath);await topup(page);await open(page);await page.locator('[data-ct-lines]').selectOption('1');
 for(const [mode,spins] of [['buy-raid',14],['buy-flagship',6]] as const){
  const before=await wallet(page);await page.locator('[data-ct-action=buy]').click();
  await expect(page.locator(`[data-ct-modal=${mode}]`)).toBeVisible();expect((await wallet(page)).balance).toBe(before.balance);
  const shownPrice=Number((await page.locator('.ct-buy-price').innerText()).replace(/[^\d,.]/g,'').replace(',','.'));
  const started=await action(page,`[data-ct-modal=${mode}]`);expect(started.view.caribbean.remaining).toBe(spins);
  expect(started.view.caribbean.settings.mode).toBe(mode);expect(shownPrice).toBe(Number(started.spentUnits)/100);expect(Math.round((await wallet(page)).balance*100)).toBe(Math.round(before.balance*100)-Number(started.spentUnits));
  await page.reload();await expect(page.locator('#join-dialog')).toBeHidden({timeout:20000});await expect.poll(async()=>(await state(page)).online).toBe(true);await open(page);
  expect((await session(page)).id).toBe(started.id);await expect(page.locator('[data-ct-lines]')).toHaveValue('1');await expect(page.locator('[data-ct-action=buy]')).toBeDisabled();
  const done=await finish(page);expect(Math.round((await wallet(page)).balance*100)).toBe(Math.round(before.balance*100)-Number(done.spentUnits)+Number(done.returnedUnits));
 }
});

test('switching accounts hides the previous series and restores it only for its owner',async({page,roomPath})=>{
 const email=await enter(page,roomPath);await topup(page);await open(page);await page.locator('[data-ct-lines]').selectOption('1');
 await page.request.post('/__test/caribbean/force-bonus');const original=await action(page,'[data-ct-action=play]');await close(page);
 await page.getByRole('button',{name:'Выйти',exact:true}).click();await expect(page.getByLabel('Почта',{exact:true})).toBeVisible();
 await enter(page,roomPath);await open(page);expect(await session(page)).toBeUndefined();await expect(page.locator('.ct-choice')).toBeHidden();
 await expect(page.locator('[data-ct-lines]')).toHaveValue('20');await expect(page.locator('[data-ct-lines]')).toBeEnabled();await close(page);
 await page.getByRole('button',{name:'Выйти',exact:true}).click();await expect(page.getByLabel('Почта',{exact:true})).toBeVisible();
 await enter(page,roomPath,email);await open(page);expect((await session(page)).id).toBe(original.id);
 await expect(page.locator('[data-ct-lines]')).toHaveValue('1');await action(page,'[data-ct-action=choose-flagship]');await finish(page);
});

test('confirmed animation, cannon, skip, mute, zero volume and close release owned audio',async({page,roomPath})=>{
 await enter(page,roomPath);await topup(page);await page.emulateMedia({reducedMotion:'no-preference'});await open(page);
 await page.evaluate(()=>{const c=(globalThis as any)[Symbol.for('royal.game-host.v1')].gameAudio.context;if(!c)throw Error('Shared context missing');const active=(window as any).__ctSources=new Set(),host=(window as any).__ctHostSources=new Map();(window as any).__ctOwnedCreated=0;for(const name of ['createOscillator','createBufferSource']){const create=c[name].bind(c);c[name]=()=>{const node=create(),stack=new Error().stack??'',owned=stack.includes('/game-modules/studio-caribbean-treasures/')||stack.includes('/games/caribbean-treasures/');if(owned){active.add(node);(window as any).__ctOwnedCreated++;}else host.set(node,stack);node.addEventListener('ended',()=>{active.delete(node);host.delete(node);});return node;};}});
 await page.locator('[data-ct-lines]').selectOption('1');await page.request.post('/__test/caribbean/force-bonus');await action(page,'[data-ct-action=play]');
 await action(page,'[data-ct-action=choose-raid]');await page.request.post('/__test/caribbean/force-cannon');await action(page,'[data-ct-action=play]');
 const playback=await page.evaluate(()=>(window as any).royalDemo.getMiniState());expect(playback.audio.counts.cannon).toBe(1);expect(playback.accents.filter((a:any)=>a.cue==='stop')).toHaveLength(12);
 expect(playback.captain.history.filter((e:any)=>e.cue==='cannon')).toHaveLength(1);
 expect(playback.captain.history.find((e:any)=>e.cue==='cannon').pose).toBe('surprise');
 expect(new Set(playback.captain.history.filter((e:any)=>e.cue==='stop').map((e:any)=>e.variant)).size).toBe(6);
 const maximumDeviationMs=Math.max(...playback.accents.map((a:any)=>Math.abs(a.deviationMs)));
 const {writeFile}=await import('node:fs/promises');await writeFile(out+'/playback-measurements.json',JSON.stringify({maximumDeviationMs,accents:playback.accents},null,2));expect(maximumDeviationMs).toBeLessThanOrEqual(50);
 await page.locator('[data-ct-action=music]').click();await expect.poll(async()=>page.evaluate(()=>(window as any).royalDemo.getMiniState().audio.music)).toBe(false);
 await page.locator('[data-ct-action=music]').click();await expect.poll(async()=>page.evaluate(()=>(window as any).royalDemo.getMiniState().audio.music)).toBe(true);
 await page.locator('[data-ct-action=play]').click();await expect.poll(async()=>page.evaluate(()=>(window as any).royalDemo.getMiniState().visualPhase)).toBe('reels');
 await expect(page.locator('.ct-strip:not([hidden])')).not.toHaveCount(0);await page.screenshot({path:out+'/reels.png'});
 await page.locator('[data-ct-action=skip]').click();await expect.poll(async()=>page.evaluate(()=>(window as any).royalDemo.getMiniState().presenting)).toBe(false);
 const saved=await session(page);expect(await page.locator('.ct-cell').evaluateAll(nodes=>nodes.map(n=>Number((n as HTMLElement).dataset.symbol)))).toEqual(saved.view.caribbean.spins.at(-1).frame.grid);
 await page.evaluate(()=>{const audio=(globalThis as any)[Symbol.for('royal.game-host.v1')].gameAudio;audio.setVolume(0);audio.setMuted(false);});
 const before=await page.evaluate(()=>(window as any).royalDemo.getMiniState().audio.counts);await action(page,'[data-ct-action=play]');
 expect(await page.evaluate(()=>(window as any).royalDemo.getMiniState().audio.counts)).toEqual(before);
 await page.evaluate(()=>{const audio=(globalThis as any)[Symbol.for('royal.game-host.v1')].gameAudio;audio.setVolume(.35);audio.setMuted(true);});
 await action(page,'[data-ct-action=play]');expect(await page.evaluate(()=>(window as any).royalDemo.getMiniState().audio.counts)).toEqual(before);
 await page.locator('[data-ct-action=sound]').click();await page.locator('[data-ct-action=play]').click();
 await expect.poll(async()=>page.evaluate(()=>(window as any).royalDemo.getMiniState().visualPhase)).toBe('reels');
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
 await expect.poll(async()=>page.evaluate(()=>(window as any).royalDemo.getMiniState().presenting)).toBe(false);
 const hidden=await page.evaluate(()=>(window as any).royalDemo.getMiniState());expect(hidden.captain.timers).toBe(0);expect(hidden.captain.animations).toBe(0);expect(hidden.visuals).toEqual({animations:0,particles:0});
 await page.evaluate(()=>{delete(document as any).hidden;document.dispatchEvent(new Event('visibilitychange'));});
 await page.locator('[data-ct-action=play]').click();await expect.poll(async()=>page.evaluate(()=>(window as any).royalDemo.getMiniState().visualPhase)).toBe('reels');
 await page.emulateMedia({reducedMotion:'reduce'});await expect.poll(async()=>page.evaluate(()=>(window as any).royalDemo.getMiniState().presenting)).toBe(false);await expect(page.locator('.ct-root')).toHaveAttribute('data-motion','reduced');
 const reduced=await session(page);expect(await page.locator('.ct-cell').evaluateAll(nodes=>nodes.map(n=>Number((n as HTMLElement).dataset.symbol)))).toEqual(reduced.view.caribbean.spins.at(-1).frame.grid);
 await close(page);await expect.poll(async()=>page.evaluate(()=>(window as any).__ctSources.size),{timeout:4000}).toBe(0);
 const cleanup=await page.evaluate(()=>({ownedCreated:(window as any).__ctOwnedCreated,ownedRemaining:(window as any).__ctSources.size,hostRemaining:[...(window as any).__ctHostSources.values()]}));expect(cleanup.ownedCreated).toBeGreaterThan(20);await writeFile(out+'/audio-ownership.json',JSON.stringify(cleanup,null,2));
 await open(page);expect(await page.evaluate(()=>(window as any).royalDemo.getMiniState().audio.counts)).toEqual({});
 expect(await page.evaluate(()=>(window as any).royalDemo.getMiniState().captain.history)).toEqual([]);
 await page.screenshot({path:out+'/desktop-final.png'});
});

test('extreme stakes, rapid double click, mobile purchase and English recovery keep one paid round',async({page,roomPath})=>{
 await enter(page,roomPath);const funded=await page.request.post('/__test/caribbean/topup',{data:{amount:10000}});expect(funded.ok()).toBe(true);await open(page);
 for(const count of ['1','5','10','20']){await page.locator('[data-ct-lines]').selectOption(count);await page.locator('[data-ct-action=lines]').click();if(await page.locator('[data-ct-action=lines]').getAttribute('aria-pressed')==='false')await page.locator('[data-ct-action=lines]').click();await expect(page.locator('.ct-paths polyline')).toHaveCount(Number(count));}
 for(const stake of ['100','200','500','1000'])await page.locator('[data-ct-stake]').selectOption(stake);
 await expect(page.locator('[data-ct-action=play]')).toContainText('200');const before=await wallet(page);
 await page.route('**/api/demo-wallet/expansion',async route=>{if(route.request().method()==='POST')await new Promise(resolve=>setTimeout(resolve,100));await route.continue();});
 const response=page.waitForResponse(r=>r.url().endsWith('/api/demo-wallet/expansion')&&r.request().method()==='POST');await page.locator('[data-ct-action=play]').dblclick({delay:10});const started=(await(await response).json()).session;
 await expect.poll(async()=>page.evaluate(()=>(window as any).royalDemo.getMiniState().presenting)).toBe(false);
 if(started.view.caribbean.phase==='choice'){await action(page,'[data-ct-action=choose-flagship]');await finish(page);}
 expect((await wallet(page)).entries.filter((e:any)=>e.kind==='bet').length-before.entries.filter((e:any)=>e.kind==='bet').length).toBe(1);
 await page.setViewportSize({width:390,height:844});await page.locator('[data-ct-action=buy]').click();const bought=await action(page,'[data-ct-modal=buy-flagship]');expect(bought.view.caribbean.settings.lines).toBe(20);expect(bought.stakeUnits).toBe('1000');
 await page.goto(roomPath+'&lang=en');
 // A full navigation can reach the hall before its previous presence lease expires.
 await expect.poll(async()=>{if((await state(page)).online)return true;const retry=page.locator('#retry-entry');if(await retry.isVisible()&&await retry.isEnabled())await retry.click();return false;},{timeout:35000,intervals:[1000,5000]}).toBe(true);
 await open(page);await expect(page.locator('.ct-heading h2')).toHaveText('Caribbean Treasures');
 expect((await session(page)).id).toBe(bought.id);await finish(page);await expect(page.locator('.ct-status')).toContainText(/round|Round/);
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

test('captain blinks and looks at the field, deduplicates reactions and releases her timer',async({page})=>{
 await page.goto('/tests/fixtures/caribbean-audio.html');await page.clock.install();
 await page.evaluate(async()=>{
  const root=document.createElement('section');root.className='ct-root';
  root.innerHTML='<span class="ct-portrait-gesture"><img class="ct-portrait-layer"><img class="ct-portrait-layer"></span><span class="ct-captain-caption" hidden></span>';
  document.body.append(root);const path='/games/caribbean-treasures/CaribbeanCaptain.ts';
  const {CaribbeanCaptain}=await import(/* @vite-ignore */path);(window as any).__ctCaptain=new CaribbeanCaptain(root);
 });
 const captain=()=>page.evaluate(()=>(window as any).__ctCaptain.state());
 await expect.poll(async()=>(await captain()).ready,{timeout:20000}).toBe(true);
 await page.evaluate(()=>(window as any).__ctCaptain.context(true,false,false));
 await page.clock.runFor(5200);expect((await captain()).pose).toBe('blink');
 await page.clock.runFor(125);expect((await captain()).pose).toBe('idle');
 await page.clock.runFor(5850);expect((await captain()).pose).toBe('blink');
 await page.clock.runFor(125+6500);expect((await captain()).pose).toBe('focus');
 await page.clock.runFor(1400);expect((await captain()).pose).toBe('idle');expect((await captain()).timers).toBe(1);
 await page.evaluate(()=>{const c=(window as any).__ctCaptain;c.begin();c.react('partial','round:1:partial');c.react('partial','round:1:partial');c.finish();});
 expect((await captain()).history).toHaveLength(1);expect((await captain()).pose).toBe('soft');await expect(page.locator('.ct-captain-caption')).toHaveText('Вернулась часть ставки.');
 await page.evaluate(()=>(window as any).__ctCaptain.context(true,true,true));
 expect((await captain()).animations).toBe(0);await expect(page.locator('.ct-captain-caption')).toHaveText('Part of the cost returned.');
 await page.clock.runFor(1200);expect((await captain()).pose).toBe('idle');expect((await captain()).timers).toBe(0);
 await page.evaluate(()=>{const c=(window as any).__ctCaptain;c.context(true,false,false);c.begin();c.react('bigwin','round:2:bigwin');c.finish();});
 expect((await captain()).pose).toBe('laugh');await page.clock.runFor(1300);expect((await captain()).pose).toBe('win');
 await page.evaluate(()=>(window as any).__ctCaptain.context(false,false,false));
 await page.clock.runFor(30000);expect((await captain()).pose).toBe('idle');expect((await captain()).timers).toBe(0);expect((await captain()).animations).toBe(0);
 await page.evaluate(()=>{const c=(window as any).__ctCaptain;c.context(true,false,false);c.destroy();c.react('win','after-close');});
 await page.clock.runFor(30000);expect((await captain()).history).toEqual([]);expect((await captain()).timers).toBe(0);expect((await captain()).animations).toBe(0);
});

test('saved complete rounds give distinct captain reactions in the real host',async({browser,roomPath})=>{
 test.setTimeout(180000);const context=await browser.newContext({viewport:{width:1440,height:1000},recordVideo:{dir:out+'/video',size:{width:1440,height:1000}}});
 const page=await context.newPage(),videoStartWall=Date.now(),cuts:{name:string;start:number;duration:number}[]=[],results:any[]=[];
 const mini=()=>page.evaluate(()=>(window as any).royalDemo.getMiniState());
 const cut=(name:string,from:any,to:any,tail=1.1)=>cuts.push({name,start:Math.max(0,(from.wallTimeMs-videoStartWall)/1000-.15),duration:(to.wallTimeMs-from.wallTimeMs)/1000+tail+.15});
 try{
  await enter(page,roomPath);await topup(page);await page.emulateMedia({reducedMotion:'no-preference'});await open(page);
  for(const [name,cue,pose] of [['partial','partial','soft'],['loss','loss','soft'],['return','return','idle'],['positive','win','win']] as const){
   const forced=await page.request.post('/__test/caribbean/force-scenario',{data:{name}});expect(forced.ok()).toBe(true);
   const done=await action(page,'[data-ct-action=play]'),view=await mini(),history=view.captain.history;
   expect(done.state).toBe('settled');expect(history.at(-1).cue).toBe(cue);expect(history.at(-1).pose).toBe(pose);
   expect(await page.locator('[data-ct-payout]').textContent()).not.toBe('...');
   const result=history.at(-1),giant=history.findLast((e:any)=>e.cue==='giant'&&e.key.startsWith(done.id));
   cut(name,giant??result,result);results.push({name,costUnits:done.spentUnits,payoutUnits:done.returnedUnits,captain:history.filter((e:any)=>e.key.startsWith(done.id))});
   await page.screenshot({path:out+'/reaction-'+name+'.png'});await page.waitForTimeout(1200);
  }
  await page.request.post('/__test/caribbean/force-scenario',{data:{name:'natural-flagship'}});
  const natural=await action(page,'[data-ct-action=play]');expect(natural.view.caribbean.phase).toBe('choice');
  let history=(await mini()).captain.history;const bonus=history.at(-1);expect(bonus.cue).toBe('bonus');cut('bonus',bonus,bonus);await page.screenshot({path:out+'/reaction-bonus.png'});await page.waitForTimeout(1200);
  await action(page,'[data-ct-action=choose-flagship]');const done=await finish(page);history=(await mini()).captain.history;
  const grand=history.at(-1);expect(grand.cue).toBe('bigwin');expect(grand.pose).toBe('laugh');cut('bigwin',grand,grand,1.6);
  results.push({name:'natural-flagship',costUnits:done.spentUnits,payoutUnits:done.returnedUnits,captain:history.filter((e:any)=>e.key.startsWith(done.id))});
  await page.screenshot({path:out+'/reaction-bigwin.png'});await page.waitForTimeout(1800);
  await page.locator('[data-ct-action=lines]').click();await page.locator('[data-ct-lines]').selectOption('1');
  await page.locator('[data-ct-action=buy]').click();await action(page,'[data-ct-modal=buy-raid]');
  await page.request.post('/__test/caribbean/force-cannon');const cannon=await action(page,'[data-ct-action=play]');history=(await mini()).captain.history;
  const shot=history.findLast((e:any)=>e.cue==='cannon');expect(shot.pose).toBe('surprise');cut('cannon',shot,shot,1.3);
  results.push({name:'cannon',roundId:cannon.id,captain:history.filter((e:any)=>e.key.startsWith(cannon.id))});
  await page.emulateMedia({reducedMotion:'reduce'});await finish(page);
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'no-preference'});await layout(page,'motion-mobile');
  await close(page);
 }finally{
  const video=page.video();await context.close();const {writeFile}=await import('node:fs/promises');
  await writeFile(out+'/character-measurements.json',JSON.stringify({video:await video?.path(),videoStartWall,cuts,results},null,2));
 }
});

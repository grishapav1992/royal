import {test as base,expect,type Page} from '@playwright/test';
import {Client} from '@colyseus/sdk';

const game='studio-caribbean-treasures',out='artifacts/work/caribbean-final';
const test=base.extend<{roomPath:string}>({roomPath:async({request},use)=>{
 const response=await request.post('/api/auth/login',{data:{email:`ct-room-${crypto.randomUUID()}@example.test`,password:'Royal-test-123!'}});
 expect(response.ok()).toBe(true);
 const cookie=response.headers()['set-cookie'].split(';')[0];
 await request.post('/api/auth/character',{data:{skin:0}});
 const client=new Client('http://127.0.0.1:2634',{headers:{Cookie:cookie},fetchFn:async(url,options)=>{
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
async function open(page:Page){
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
 await page.locator(`[data-platform-game="${game}"]`).click();
 await expect(page.locator('#mini-game')).toHaveAttribute('data-game-module-id',game,{timeout:25000});
 await expect(page.locator('.ct-root')).toBeVisible();
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
 await expect.poll(async()=>page.evaluate(()=>(window as any).royalDemo.getMiniState()?.presenting)).toBe(false);
 return body.session;
}
async function finish(page:Page){
 let s=await session(page);
 for(let moves=0;s.state==='active'&&moves<15;moves++)s=await action(page,'[data-ct-action=play]');
 expect(s.state).toBe('settled');return s;
}
async function layout(page:Page,name:string){
 await expect(page.locator('[data-ct-action=play]')).toBeInViewport();await expect(page.locator('#chat-input')).toBeInViewport();
 await expect.poll(async()=>page.locator('.ct-root').evaluate(e=>Math.abs(e.getBoundingClientRect().height-e.closest('.mini-stage')!.getBoundingClientRect().height))).toBeLessThan(2);
 expect(await page.locator('.ct-root').evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
 const boxes=await page.locator('.ct-board,.ct-giant').evaluateAll(nodes=>nodes.map(n=>{const b=n.getBoundingClientRect();return{x:b.x,y:b.y,right:b.right,bottom:b.bottom,width:b.width,height:b.height};}));
 if(boxes.length===2){expect(boxes[1].x).toBeGreaterThanOrEqual(boxes[0].x-1);expect(boxes[1].right).toBeLessThanOrEqual(boxes[0].right+1);expect(boxes[1].bottom).toBeLessThanOrEqual(boxes[0].bottom+1);expect(boxes[1].width).toBeGreaterThan(30);}
 await page.screenshot({path:out+'/'+name+'.png'});
}

test('natural bonus, real host/chat, line presets and desktop/mobile layout',async({page,roomPath})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await enter(page,roomPath);await topup(page);await open(page);
 await page.locator('[data-ct-lines]').selectOption('5');await page.locator('[data-ct-stake]').selectOption('200');
 await expect(page.locator('[data-ct-action=play]')).toContainText('10');
 await page.locator('[data-ct-action=info]').click();await expect(page.locator('.ct-modal')).toBeVisible();
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
 await action(page,'[data-ct-action=choose-raid]');await finish(page);
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
 await page.evaluate(()=>{const c=(globalThis as any)[Symbol.for('royal.game-host.v1')].gameAudio.context;if(!c)throw Error('Shared context missing');const active=(window as any).__ctSources=new Set();const create=c.createOscillator.bind(c);c.createOscillator=()=>{const node=create();active.add(node);node.addEventListener('ended',()=>active.delete(node));return node;};});
 await page.locator('[data-ct-lines]').selectOption('1');await page.request.post('/__test/caribbean/force-bonus');await action(page,'[data-ct-action=play]');
 await action(page,'[data-ct-action=choose-raid]');await page.request.post('/__test/caribbean/force-cannon');await action(page,'[data-ct-action=play]');
 const playback=await page.evaluate(()=>(window as any).royalDemo.getMiniState());expect(playback.audio.counts.cannon).toBe(1);expect(playback.accents.filter((a:any)=>a.cue==='stop')).toHaveLength(12);
 const maximumDeviationMs=Math.max(...playback.accents.map((a:any)=>Math.abs(a.deviationMs)));
 const {writeFile}=await import('node:fs/promises');await writeFile(out+'/playback-measurements.json',JSON.stringify({maximumDeviationMs,accents:playback.accents},null,2));expect(maximumDeviationMs).toBeLessThanOrEqual(50);
 await page.locator('[data-ct-action=play]').click();await expect.poll(async()=>page.evaluate(()=>(window as any).royalDemo.getMiniState().visualPhase)).toBe('reels');
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
 await page.evaluate(()=>{delete(document as any).hidden;document.dispatchEvent(new Event('visibilitychange'));});
 await close(page);await expect.poll(async()=>page.evaluate(()=>(window as any).__ctSources.size),{timeout:4000}).toBe(0);
 await open(page);expect(await page.evaluate(()=>(window as any).royalDemo.getMiniState().audio.counts)).toEqual({});
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

test('original audio renders without clipping and ends in silence',async({page})=>{
 await page.goto('/tests/fixtures/caribbean-audio.html');
 const rendered=await page.evaluate(async()=>{
  const offline=new OfflineAudioContext(1,44100*9,44100);let clock=0;const output=offline.createGain();output.connect(offline.destination);
  const context=new Proxy(offline,{get(target,key){if(key==='state')return'running';if(key==='currentTime')return clock;if(key==='getOutputTimestamp')return()=>({contextTime:0,performanceTime:0});const v=Reflect.get(target,key,target);return typeof v==='function'?v.bind(target):v;}});
  const prefs={muted:false,volume:1};(globalThis as any)[Symbol.for('royal.game-host.v1')]={apiVersion:1,gameAudio:{context,output,getPreferences:()=>prefs,onPreferences:()=>()=>{},unlock:async()=>{}}};
  const path='/games/caribbean-treasures/CaribbeanAudio.ts';const {CaribbeanAudio}=await import(/* @vite-ignore */path);const audio=new CaribbeanAudio();audio.setMusic(false);await audio.enter();
  const events:[number,string,number?][]=[[0,'click'],...[0,1,2,3,4,5].map(i=>[.3+i*.12,'stop',i] as [number,string,number]),[1.3,'giant'],[2,'cannon'],[2.7,'line'],[3.2,'bonus'],[4,'partial'],[4.5,'return'],[5.2,'win'],[6.4,'bigwin']];
  for(const [time,cue,variant] of events){clock=time;audio.cue(cue,variant);}
  const buffer=await offline.startRendering(),samples=buffer.getChannelData(0);let peak=0,step=0,sum=0,tail=0;
  const bytes=new Uint8Array(44+samples.length*2),view=new DataView(bytes.buffer),word=(at:number,text:string)=>{for(let i=0;i<text.length;i++)bytes[at+i]=text.charCodeAt(i);};
  word(0,'RIFF');view.setUint32(4,bytes.length-8,true);word(8,'WAVE');word(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,44100,true);view.setUint32(28,88200,true);view.setUint16(32,2,true);view.setUint16(34,16,true);word(36,'data');view.setUint32(40,samples.length*2,true);
  for(let i=0;i<samples.length;i++){peak=Math.max(peak,Math.abs(samples[i]));sum+=samples[i]*samples[i];if(i)step=Math.max(step,Math.abs(samples[i]-samples[i-1]));if(i>samples.length-4410)tail=Math.max(tail,Math.abs(samples[i]));view.setInt16(44+i*2,Math.round(Math.max(-1,Math.min(1,samples[i]))*32767),true);}
  let encoded='';for(let i=0;i<bytes.length;i+=8192)encoded+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return{peak,rms:Math.sqrt(sum/samples.length),maxSampleStep:step,tail,wav:btoa(encoded)};
 });
 expect(rendered.peak).toBeGreaterThan(.001);expect(rendered.peak).toBeLessThan(.9);expect(rendered.maxSampleStep).toBeLessThan(.05);expect(rendered.tail).toBeLessThan(.0001);
 const {writeFile}=await import('node:fs/promises');await writeFile(out+'/sound-preview.wav',Buffer.from(rendered.wav,'base64'));
 await writeFile(out+'/audio-measurements.json',JSON.stringify({...rendered,wav:undefined},null,2));
});

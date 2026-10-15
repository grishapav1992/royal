import {test,expect,type Page} from '@playwright/test';
import {Client} from '@colyseus/sdk';
import {selectHall,showChat,worldPoint} from './room-ui';
const state=(p:Page)=>p.evaluate(()=>(window as any).royalDemo.getState());
const activities=(p:Page)=>p.evaluate(()=>(window as any).royalDemo.getActivities());
async function join(p:Page,room:string){
 await p.goto('/?room='+room,{waitUntil:'domcontentloaded'});await p.getByLabel('Почта',{exact:true}).fill(`hall-${crypto.randomUUID()}@example.test`);await p.getByLabel('Пароль',{exact:true}).fill('Royal-test-123!');await p.getByRole('button',{name:'Продолжить',exact:true}).click();await expect(p.locator('#character-step')).toBeVisible();await p.getByRole('button',{name:'Войти в зал',exact:true}).click();await expect.poll(async()=>(await state(p)).online).toBe(true);
}
test('two halls isolate avatars and music, preserve chat and reject stale movement',async({browser,request})=>{
 test.setTimeout(150000);
 const login=await request.post('/api/auth/login',{data:{email:`hall-host-${crypto.randomUUID()}@example.test`,password:'Royal-test-123!'}});expect(login.ok()).toBe(true);
 const cookie=login.headers()['set-cookie'].split(';')[0];await request.post('/api/auth/character',{data:{skin:0}});
 const host=await new Client(process.env.TEST_ROOM_URL||process.env.TEST_BASE_URL||'http://127.0.0.1:2567',{headers:{Cookie:cookie},fetchFn:async(url,options)=>{
   const response=await request.fetch(String(url),{method:options?.method,headers:Object.fromEntries(new Headers(options?.headers)),data:options?.body as string});
   return new Response(await response.body(),{status:response.status(),headers:response.headers()});
 }}).create<any>('lobby');
 for(const type of ['chat','activities','piano-note','notice'])host.onMessage(type,()=>{});
 const ca=await browser.newContext(),cb=await browser.newContext();const a=await ca.newPage(),b=await cb.newPage();const errors:string[]=[];for(const p of [a,b])p.on('pageerror',e=>errors.push(e.message));
 try{
  await join(a,host.roomId);await join(b,host.roomId);await expect.poll(async()=>(await state(a)).remotes).toBe(2);
  await expect(a.locator('#chat-panel')).toBeVisible();await expect(a.locator('#chat-input')).toBeInViewport();await expect(a.locator('#chat-tab')).toHaveCount(0);await expect(a.locator('[data-hall]:not([data-cabinet])')).toHaveCount(0);
  for(const [width,height] of [[1366,768],[390,844],[320,640],[844,390]]){
    await b.setViewportSize({width,height});await b.waitForTimeout(250);
    const game=(await b.locator('#game').boundingBox())!,chat=(await b.locator('#chat-panel').boundingBox())!;
    expect(game.width).toBeGreaterThan(300);expect(game.height).toBeGreaterThan(180);
    expect(game.x+game.width<=chat.x+1||game.y+game.height<=chat.y+1).toBe(true);
    await expect(b.locator('#chat-input')).toBeInViewport();
    expect(await b.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight+1)).toBe(true);
    await b.screenshot({path:'artifacts/chat-visible-'+width+'.png'});
  }
  await b.setViewportSize({width:1440,height:1000});
  await b.locator('#room-overview').click();const threshold=await worldPoint(b,900,285);await b.mouse.click(threshold.x,threshold.y);
  await expect.poll(async()=>Math.abs((await state(b)).x-900)+Math.abs((await state(b)).y-285),{timeout:15000}).toBeLessThan(4);expect((await state(b)).hall).toBe('arcade');
  await b.evaluate(()=>{const watch=()=>{const s=(window as any).royalDemo.getState();if(s.hall==='tables'){(window as any).hallArrival={x:s.x,y:s.y};return;}requestAnimationFrame(watch);};watch();});
  await b.keyboard.down('w');await expect.poll(async()=>(await state(b)).hall).toBe('tables');const arrival=await b.evaluate(()=>(window as any).hallArrival);expect(arrival.y).toBeGreaterThan(530);await b.waitForTimeout(3200);await b.keyboard.up('w');expect((await state(b)).hall).toBe('tables');expect((await state(b)).y).toBeLessThan(310);await b.locator('#room-overview').click();
  await expect.poll(async()=>(await state(a)).remotes).toBe(1);await expect.poll(async()=>(await state(b)).remotes).toBe(0);
  await b.locator('#games-tab').click();await expect(b.locator('[data-activity="chess"]')).toBeVisible();await expect(b.locator('#chat-input')).toBeVisible();await expect(b.locator('[data-activity="piano"]')).toBeHidden();await expect(b.locator('[data-cabinet]:not([hidden])')).toHaveCount(1);await expect(b.locator('[data-cabinet="luelon"]')).toBeVisible();await b.locator('#panel-close').click();
  const before=await state(b);await b.keyboard.down('d');await b.waitForTimeout(250);await b.keyboard.up('d');await expect.poll(async()=>(await state(b)).x).toBeGreaterThan(before.x+15);
  await showChat(b);await b.locator('#chat-input').fill('Привет из второго зала');await b.locator('#chat-input').press('Enter');await expect(a.locator('#chat-log')).toContainText('Привет из второго зала');await b.locator('#chat-input').press('Escape');
  await a.locator('#room-overview').click();const piano=await worldPoint(a,120,290);await a.mouse.click(piano.x,piano.y);await expect(a.locator('#shared-dialog')).toBeVisible({timeout:15000});await expect(a.locator('[data-note="60"]')).toBeEnabled();
  const heard=(await activities(b)).audio.played;await a.keyboard.down('a');await a.waitForTimeout(250);await a.keyboard.up('a');expect((await activities(b)).audio.played).toBe(heard);
  await selectHall(b,'arcade');await a.keyboard.down('s');await expect.poll(async()=>(await activities(b)).audio.played).toBeGreaterThan(heard);await a.keyboard.up('s');await a.locator('#shared-close').click();
  await selectHall(a,'tables');await selectHall(b,'tables');await expect.poll(async()=>(await state(a)).remotes).toBe(1);
  await a.screenshot({path:'artifacts/hall-tables.png'});await b.setViewportSize({width:390,height:844});await b.locator('#room-overview').click();await b.screenshot({path:'artifacts/hall-tables-mobile.png'});
  expect(await b.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  host.send('target',{x:900,y:240,revision:0});await expect.poll(()=>host.state.players.get(host.sessionId)?.hallRevision,{timeout:15000}).toBe(1);
  host.send('target',{x:800,y:600,revision:0});host.send('inputs',{revision:0,inputs:[{seq:1,x:1,y:0,ms:50}]});await a.waitForTimeout(300);
  expect(host.state.players.get(host.sessionId).x).toBe(900);expect(host.state.players.get(host.sessionId).inputSeq).toBe(0);
  host.send('target',{x:222,y:610,revision:1});await expect.poll(()=>Math.abs(host.state.players.get(host.sessionId).x-222),{timeout:10000}).toBeLessThan(10);
  host.send('activity',{type:'join',id:'chess'});await expect.poll(()=>host.state.players.get(host.sessionId).activity).toBe('chess');host.send('activity',{type:'leave'});host.send('target',{x:900,y:640,revision:1});await expect.poll(()=>host.state.players.get(host.sessionId).hallRevision,{timeout:15000}).toBe(2);await expect.poll(async()=>(await activities(a)).chess.players.length).toBe(0);
  await selectHall(a,'arcade');await a.screenshot({path:'artifacts/hall-arcade.png'});expect(errors).toEqual([]);
 }finally{await ca.close();await cb.close();await host.leave();await request.post('/api/auth/logout');}
});

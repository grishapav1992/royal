import {selectHall,worldPoint} from './room-ui';
import {test,expect,type Page,type Browser,type APIRequestContext} from '@playwright/test';
import {Client} from '@colyseus/sdk';
import {ACTIVITIES} from '../src/shared/activities';
const activities=(p:Page)=>p.evaluate(()=>(window as any).royalDemo.getActivities());
const game=(p:Page)=>p.evaluate(()=>(window as any).royalDemo.getState());
const net=(p:Page)=>p.evaluate(()=>(window as any).royalDemo.getNetworkState());
async function join(page:Page,room:string){
 const login=await page.context().request.post('/api/auth/login',{data:{email:`social-${crypto.randomUUID()}@example.test`,password:'Royal-test-123!'}});expect(login.ok()).toBe(true);await page.context().request.post('/api/auth/character',{data:{skin:0}});await page.goto('/?room='+room);await expect.poll(async()=>(await net(page))?.status).toBe('connected');
}
async function open(page:Page,id:string){
 await selectHall(page,id==='piano'?'arcade':'tables');
 if(id==='piano'){
  const {x,y,w,h}=ACTIVITIES.piano.bounds;
  const point=await worldPoint(page,x+w/2,y+h/2);await page.mouse.click(point.x,point.y);
 }else{await page.locator('#games-tab').click();await page.locator(`[data-activity="${id}"]`).click();}
 await expect(page.locator('#shared-dialog')).toBeVisible({timeout:15000});
}
async function close(page:Page){await page.locator('#shared-close').click();await expect(page.locator('#shared-dialog')).toBeHidden();}
async function withPlayers(browser:Browser,request:APIRequestContext,play:(a:Page,b:Page)=>Promise<void>){
 const login=await request.post('/api/auth/login',{data:{email:`host-${crypto.randomUUID()}@example.test`,password:'Royal-test-123!'}});expect(login.ok()).toBe(true);
 const cookie=login.headers()['set-cookie'].split(';')[0];await request.post('/api/auth/character',{data:{skin:0}});
 const host=await new Client(process.env.TEST_BASE_URL||'http://127.0.0.1:2567',{headers:{Cookie:cookie}}).create('lobby');host.onMessage('chat',()=>{});host.onMessage('activities',()=>{});host.onMessage('piano-note',()=>{});
 const ca=await browser.newContext(),cb=await browser.newContext();const a=await ca.newPage(),b=await cb.newPage();const errors:string[]=[];for(const p of [a,b])p.on('pageerror',e=>errors.push(e.message));
 host.reconnection.enabled=false;
 try{await join(a,host.roomId);await join(b,host.roomId);await play(a,b);expect(errors).toEqual([]);}
 finally{host.connection.close(1000);await Promise.allSettled([ca.close(),cb.close(),request.post('/api/auth/logout',{timeout:5000})]);}
}
test('two players share hockey and pool; both regain control after fouls',async({browser,request})=>{
 test.setTimeout(160000);
 await withPlayers(browser,request,async(a,b)=>{
  const aid=(await net(a)).selfId,bid=(await net(b)).selfId;
  await open(a,'hockey');await expect(a.locator('#shared-status')).toContainText('Ждём второго');
  await open(b,'hockey');await expect.poll(async()=>(await activities(a)).tables[0].phase).toBe('playing');await expect.poll(async()=>(await activities(b)).tables[0].players).toEqual([aid,bid]);
  const box=await a.locator('#shared-canvas').boundingBox();await a.mouse.move(box!.x+box!.width*.4,box!.y+box!.height*.3);
  await expect.poll(async()=>(await activities(b)).tables[0].paddles[0].x).toBeGreaterThan(250);
  const x=(await activities(a)).tables[0].balls[0].x;await expect.poll(async()=>Math.abs((await activities(b)).tables[0].balls[0].x-x)).toBeGreaterThan(15);
  await a.screenshot({path:'artifacts/shared-hockey.png'});await close(a);await expect.poll(async()=>(await activities(b)).tables[0].phase).toBe('waiting');await close(b);
  await open(a,'pool');await expect(a.locator('#shared-status')).toContainText('Ждём второго');await expect(a.locator('#pool-shoot')).toBeDisabled();await open(b,'pool');await expect(a.locator('#pool-shoot')).toBeEnabled();await expect(b.locator('#pool-shoot')).toBeDisabled();await expect(a.locator('#shared-status')).toContainText('Ты разбиваешь');await expect(b.locator('#shared-status')).toContainText('Соперник разбивает');
  await expect.poll(async()=>(await activities(a)).tables[1].balls.length).toBe(16);await a.locator('#shot-power').focus();await a.keyboard.press('Home');await a.locator('#pool-shoot').click();await expect.poll(async()=>(await activities(b)).tables[1].moving).toBe(true);
  await expect.poll(()=>a.evaluate(()=>(window as any).royalDemo.getAudio().table.played['pool:cue']||0)).toBeGreaterThan(0);
  await expect.poll(async()=>(await activities(a)).tables[1].moving,{timeout:15000}).toBe(false);await expect.poll(async()=>(await activities(a)).tables[1].turn).toBe(1);
  await expect.poll(async()=>(await activities(b)).tables[1].ballInHand).toBe('kitchen');await expect(b.locator('#shared-status')).toContainText('Твой ход');await expect(a.locator('#shared-status')).toContainText('Соперник ставит белый шар');await expect(b.locator('#pool-place')).toBeEnabled();await expect(a.locator('#pool-place')).toBeDisabled();
  const tableBox=await b.locator('#shared-canvas').boundingBox();await b.mouse.click(tableBox!.x+tableBox!.width*500/720,tableBox!.y+tableBox!.height*.5);await expect(b.locator('#pool-place')).toBeEnabled();await expect(b.locator('#pool-shoot')).toBeDisabled();
  await b.locator('#pool-place').click();await expect(b.locator('#pool-shoot')).toBeEnabled();await expect(b.locator('#pool-place')).toBeHidden();await expect(a.locator('#pool-shoot')).toBeDisabled();
  await b.locator('#shot-power').focus();await b.keyboard.press('Home');await b.mouse.move(tableBox!.x+tableBox!.width*60/720,tableBox!.y+tableBox!.height*.5);await b.locator('#pool-shoot').click();await expect.poll(async()=>(await activities(a)).tables[1].moving).toBe(true);await expect.poll(async()=>(await activities(a)).tables[1].turn,{timeout:15000}).toBe(0);
  await expect(a.locator('#pool-place')).toBeEnabled();await a.locator('#pool-place').click();await expect(a.locator('#pool-shoot')).toBeEnabled();
  await a.locator('#shared-dialog .settings-shortcut').click();await a.locator('#sound-enabled').uncheck();await a.locator('#cancel-name').click();
  const cueSounds=await a.evaluate(()=>(window as any).royalDemo.getAudio().table.played['pool:cue']);
  await a.locator('#pool-shoot').click();await expect.poll(async()=>(await activities(b)).tables[1].moving).toBe(true);
  expect(await a.evaluate(()=>(window as any).royalDemo.getAudio().table.played['pool:cue'])).toBe(cueSounds);await expect.poll(()=>a.evaluate(()=>(window as any).royalDemo.getAudio().rms)).toBeLessThan(.000001);
  await a.screenshot({path:'artifacts/shared-pool.png'});await close(a);await close(b);
 });
});
test('piano is shared and listeners can close their ears independently',async({browser,request})=>{
 test.setTimeout(160000);
 await withPlayers(browser,request,async(a,b)=>{
  const aid=(await net(a)).selfId,bid=(await net(b)).selfId;
  await selectHall(b,'arcade');await b.keyboard.press('Shift');await open(a,'piano');await expect.poll(async()=>(await activities(b)).pianist).toBe(aid);
  await expect.poll(async()=>(await activities(b)).audio.context).toBe('running');
  const heard=(await activities(b)).audio.played,own=(await activities(a)).audio.played;await a.keyboard.down('a');await expect.poll(async()=>(await activities(b)).audio.played).toBeGreaterThan(heard);await expect.poll(async()=>(await activities(b)).notes).toContain(60);await a.keyboard.up('a');
  await expect.poll(async()=>(await activities(b)).notes).toEqual([]);
  expect((await activities(a)).audio.played).toBe(own+1);
  await b.getByRole('button',{name:'Настройки игрока',exact:true}).click();await b.locator('#mute-piano').click();await expect(b.locator('#mute-piano')).toHaveAttribute('aria-pressed','true');await b.keyboard.press('Escape');const muted=(await activities(b)).audio.played;
  await a.keyboard.down('s');await expect.poll(async()=>(await activities(b)).notes).toContain(62);await a.keyboard.up('s');expect((await activities(b)).audio.played).toBe(muted);expect((await activities(a)).audio.muted).toBe(false);
  await expect(a.locator('#people-list')).toContainText('🙉');await open(b,'piano');await expect(b.locator('[data-note="60"]')).toBeDisabled();await expect(b.locator('#shared-join')).toHaveCount(0);
  expect(await a.locator('#piano-keys').innerText()).toBe('');await expect(a.locator('#shared-rules')).toBeHidden();await a.screenshot({path:'artifacts/shared-piano.png'});await close(a);await expect(b.locator('[data-note="60"]')).toBeEnabled();await expect.poll(async()=>(await activities(a)).pianist).toBe(bid);
  await b.setViewportSize({width:390,height:844});expect(await b.locator('#shared-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await b.locator('#shared-dialog .settings-shortcut').click();await b.locator('#mute-piano').click();await expect(b.locator('#mute-piano')).toHaveAttribute('aria-pressed','false');await b.keyboard.press('Escape');await expect(b.locator('#shared-dialog')).toBeVisible();
  const key=await b.locator('[data-note="64"]').boundingBox();await b.mouse.move(key!.x+key!.width/2,key!.y+key!.height*.85);await b.mouse.down();await expect.poll(async()=>(await activities(a)).notes).toContain(64);await b.mouse.up();
  await b.screenshot({path:'artifacts/shared-piano-mobile.png'});await close(b);await expect.poll(async()=>(await activities(a)).pianist).toBe('');await expect.poll(async()=>(await game(b)).locked).toBe(false);
 });
});

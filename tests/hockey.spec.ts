import {selectHall} from './room-ui';
import {test,expect,type Page} from '@playwright/test';
import {Client} from '@colyseus/sdk';
const state=(p:Page)=>p.evaluate(()=>(window as any).royalDemo.getActivities());
const net=(p:Page)=>p.evaluate(()=>(window as any).royalDemo.getNetworkState());
async function join(p:Page,room:string){const login=await p.context().request.post('/api/auth/login',{data:{email:`hockey-${crypto.randomUUID()}@example.test`,password:'Royal-test-123!'}});expect(login.ok()).toBe(true);await p.context().request.post('/api/auth/character',{data:{skin:0}});await p.goto('/?room='+room);await expect.poll(async()=>(await net(p)).status).toBe('connected');await selectHall(p,'tables');await p.locator('#games-tab').click();await p.locator('[data-activity="hockey"]').click();await expect(p.locator('#shared-dialog')).toBeVisible({timeout:15000});}
test('hockey responds locally before delayed network replies, stays bounded and supports touch',async({browser,request})=>{
 test.setTimeout(100000);
 const login=await request.post('/api/auth/login',{data:{email:`host-${crypto.randomUUID()}@example.test`,password:'Royal-test-123!'}});expect(login.ok()).toBe(true);const cookie=login.headers()['set-cookie'].split(';')[0];await request.post('/api/auth/character',{data:{skin:0}});
 const host=await new Client(process.env.TEST_BASE_URL||'http://127.0.0.1:2567',{headers:{Cookie:cookie}}).create('lobby');for(const type of ['chat','activities','piano-note'])host.onMessage(type,()=>{});
 const ca=await browser.newContext(),cb=await browser.newContext({hasTouch:true});const a=await ca.newPage(),b=await cb.newPage(),errors:string[]=[];for(const p of [a,b])p.on('pageerror',e=>errors.push(e.message));
 await a.addInitScript(()=>{
  const Native=window.WebSocket;(window as any).__socketDelay=0;
  window.WebSocket=class extends Native{
   private handler:((e:MessageEvent)=>void)|null=null;
   constructor(url:string|URL,protocols?:string|string[]){super(url,protocols);super.addEventListener('message',event=>{const delay=(window as any).__socketDelay;if(delay)setTimeout(()=>this.handler?.call(this,event),delay);else this.handler?.call(this,event);});}
   get onmessage(){return this.handler;}set onmessage(handler){this.handler=handler;}
   send(data:string|ArrayBufferLike|Blob|ArrayBufferView){const copy=ArrayBuffer.isView(data)?new Uint8Array(data.buffer,data.byteOffset,data.byteLength).slice():data instanceof ArrayBuffer?data.slice(0):data;const delay=(window as any).__socketDelay;if(delay)setTimeout(()=>{if(this.readyState===Native.OPEN)super.send(copy);},delay);else super.send(copy);}
  };
 });
 try{
  await join(a,host.roomId);await join(b,host.roomId);await expect.poll(async()=>(await state(a)).tables[0].phase).toBe('playing');await b.waitForTimeout(300);
  expect((await state(b)).tables[0].paddles[1]).toEqual({x:620,y:200});expect((await state(b)).hockey.local).toEqual({x:620,y:200});expect((await state(a)).hockey.radius).toBe(32);
  await a.evaluate(()=>{(window as any).__socketDelay=300;});
  const box=await a.locator('#shared-canvas').boundingBox();await a.mouse.move(box!.x+box!.width*260/720,box!.y+box!.height*120/400);
  await a.waitForFunction(()=>(window as any).royalDemo.getActivities().hockey.rendered[0].x>115,undefined,{timeout:200});
  expect((await state(a)).tables[0].paddles[0].x).toBe(100);
  await expect.poll(async()=>{const p=(await state(a)).hockey.local;return Math.hypot(p.x-260,p.y-120);}).toBeLessThan(.01);await expect.poll(async()=>{const p=(await state(b)).tables[0].paddles[0];return Math.hypot(p.x-260,p.y-120);}).toBeLessThan(.01);
  await a.keyboard.down('ArrowDown');await a.waitForFunction(()=>(window as any).royalDemo.getActivities().hockey.rendered[0].y>125,undefined,{timeout:200});await a.keyboard.up('ArrowDown');const stopped=(await state(a)).hockey.local.y;
  await a.waitForTimeout(850);expect(Math.abs((await state(a)).hockey.local.y-stopped)).toBeLessThan(.1);expect(Math.abs((await state(b)).tables[0].paddles[0].y-stopped)).toBeLessThan(.1);
  await a.keyboard.down('ArrowRight');await a.waitForTimeout(250);await a.keyboard.up('ArrowRight');expect((await state(a)).hockey.local.x).toBe(328);
  await a.keyboard.down('ArrowLeft');await a.waitForFunction(()=>(window as any).royalDemo.getActivities().hockey.local.x<320,undefined,{timeout:200});await a.evaluate(()=>window.dispatchEvent(new Event('blur')));const paused=(await state(a)).hockey.local;await a.keyboard.up('ArrowLeft');await a.waitForTimeout(850);expect((await state(a)).hockey.local).toEqual(paused);await expect.poll(async()=>(await state(b)).tables[0].paddles[0]).toEqual(paused);
  await b.setViewportSize({width:390,height:844});const touch=await b.locator('#shared-canvas').boundingBox();await b.touchscreen.tap(touch!.x+touch!.width*550/720,touch!.y+touch!.height*280/400);
  await expect.poll(async()=>Math.abs((await state(b)).hockey.local.x-550)).toBeLessThan(3);await expect.poll(async()=>Math.abs((await state(a)).tables[0].paddles[1].y-280)).toBeLessThan(3);
  expect(await b.locator('#shared-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);await b.screenshot({path:'artifacts/hockey-mobile-fast.png'});await a.screenshot({path:'artifacts/hockey-fast.png'});
  await a.evaluate(()=>{(window as any).__socketDelay=0;});await a.locator('#shared-close').click();await expect.poll(async()=>(await state(b)).tables[0].phase).toBe('waiting');expect(errors).toEqual([]);
 }finally{await ca.close();await cb.close();host.reconnection.enabled=false;host.connection.close(1000);await request.post('/api/auth/logout');}
});

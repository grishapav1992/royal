import {test,expect,type Page} from '@playwright/test';
import {GUARD_STOPS} from '../server/guardRoutine';
import {worldPoint} from './room-ui';
import {OFFENSIVE_CHAT_BURST,securityRoom} from './security-room';
const state=(p:Page)=>p.evaluate(()=>(window as any).royalDemo?.getState());
const guard=async(p:Page)=>(await state(p))?.guards?.[0];
async function register(page:Page,room:string){
 await page.request.post('/api/auth/login',{data:{email:`guard-life-${crypto.randomUUID()}@example.test`,password:'Royal-test-123!'}});
 await page.request.post('/api/auth/character',{data:{skin:0,name:'Проверка обхода'}});
 await page.goto('/?mode=club&lang=ru&room='+room);await expect(page.locator('#chat-input')).toBeEnabled({timeout:15000});
 await expect.poll(()=>guard(page),{timeout:15000}).toBeDefined();
}
test('two viewers and a late joiner see the same patrol, conversation and window visit; an offense interrupts leisure',async({browser,request},info)=>{
 test.setTimeout(110000);
 const {room:host}=await securityRoom(request);
 const ca=await browser.newContext(),cb=await browser.newContext(),a=await ca.newPage(),b=await cb.newPage();const errors:string[]=[];
 for(const p of [a,b])p.on('pageerror',e=>errors.push(e.message));
 try{
  await register(a,host.roomId);
  await expect.poll(async()=>(await guard(a))?.phase,{timeout:20000}).toBe('chat');
  await register(b,host.roomId);
  await expect.poll(async()=>{const x=await guard(a),y=await guard(b);return !!x&&!!y&&x.phase===y.phase&&x.routine===y.routine&&Math.hypot(x.x-y.x,x.y-y.y)<8;}).toBe(true);
  await expect.poll(async()=>(await guard(b))?.reply,{timeout:10000}).toBeTruthy();
  const reply=(await guard(b)).reply;
  await b.screenshot({path:info.outputPath('guard-life-bar.png')});
  expect(await b.locator('#chat-log').textContent()).not.toContain(reply);
  await b.reload();await expect(b.locator('#chat-input')).toBeEnabled();
  await expect.poll(async()=>(await guard(b))?.phase,{timeout:20000}).toBe('patrol');
  const start=await guard(b);await expect.poll(async()=>{const g=await guard(b);return Math.hypot(g.x-start.x,g.y-start.y);}).toBeGreaterThan(15);
  const windowStop=GUARD_STOPS.arcade.find(stop=>stop.id==='window')!;
  const approach={x:windowStop.x,y:windowStop.y+80};
  await b.locator('#room-overview').click();
  const point=await worldPoint(b,approach.x,approach.y);await b.mouse.click(point.x,point.y);
  await expect.poll(async()=>{const s=await state(b);return Math.hypot(s.x-approach.x,s.y-approach.y);},{timeout:15000}).toBeLessThan(6);
  await expect.poll(async()=>(await guard(b)).phase,{timeout:65000}).toBe('window');
  await b.screenshot({path:info.outputPath('guard-life-window.png')});
  await b.locator('#chat-input').fill(OFFENSIVE_CHAT_BURST);await b.locator('#chat-input').press('Enter');
  const selfId=await b.evaluate(()=>(window as any).royalDemo.getNetworkState().selfId);
  await expect.poll(async()=>(await guard(b)).target,{timeout:20000}).toBe(selfId);
  expect((await guard(b)).reply).toBe('');
  await expect.poll(async()=>(await state(b)).security,{timeout:10000}).toBe('ejecting');
  await expect.poll(async()=>(await state(b)).hall,{timeout:30000}).toBe('street');
  await expect(b.locator('#club-chat-dock')).toBeHidden();
  await expect.poll(async()=>(await guard(b)).phase,{timeout:20000}).toBe('patrol');
  expect(errors).toEqual([]);
 }finally{await ca.close();await cb.close();await host.leave();await request.post('/api/auth/logout');}
});

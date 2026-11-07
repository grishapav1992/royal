import {test,expect,type Page} from '@playwright/test';
import {GUARD_STOPS} from '../server/guardRoutine';
import {worldPoint} from './room-ui';
import {securityRoom} from './security-room';
const state=(p:Page)=>p.evaluate(()=>(window as any).royalDemo?.getState());
const network=(p:Page)=>p.evaluate(()=>(window as any).royalDemo?.getNetworkState());
async function join(page:Page,room:string){
 await page.request.post('/api/auth/login',{data:{email:`bump-${crypto.randomUUID()}@example.test`,password:'Royal-test-123!'}});
 await page.request.post('/api/auth/character',{data:{skin:1,name:'Проверка толчков'}});
 await page.goto('/?mode=club&lang=ru&room='+room);await expect.poll(async()=>(await state(page))?.online).toBe(true);
 await page.locator('#room-overview').click();await page.locator('#game').focus();
}
test('solid guard shows a fist to both players; holding does not multiply hits and ten contacts eject',async({browser,request},info)=>{
 test.setTimeout(100000);
 const {room:host}=await securityRoom(request),ca=await browser.newContext(),cb=await browser.newContext(),a=await ca.newPage(),b=await cb.newPage();
 const errors:string[]=[];for(const p of [a,b])p.on('pageerror',e=>errors.push(e.message));
 try{
  await join(a,host.roomId);await join(b,host.roomId);
  const {selfId}=await network(a);
  const bar=GUARD_STOPS.arcade.find(stop=>stop.id==='bar')!;
  const start={x:bar.x,y:bar.y+94};
  const point=await worldPoint(a,start.x,start.y);await a.mouse.click(point.x,point.y);
  await expect.poll(async()=>{const s=await state(a);return Math.hypot(s.x-start.x,s.y-start.y);},{timeout:10000}).toBeLessThan(8);
  await a.locator('#game').focus();
  await expect.poll(async()=>(await state(a)).guards[0].phase,{timeout:20000}).toBe('chat');
  await a.keyboard.down('w');await expect.poll(async()=>(await state(a)).guards[0].phase,{timeout:10000,intervals:[30]}).toBe('bump');
  await expect.poll(async()=>(await state(a)).guards[0].progress,{intervals:[30]}).toBeGreaterThan(.4);await a.keyboard.up('w');
  expect((await state(a)).guards[0].speech).toBe('Не толкайся.');
  const first=await state(a);expect(Math.hypot(first.x-first.guards[0].x,first.y-first.guards[0].y)).toBeGreaterThanOrEqual(35);
  await expect.poll(async()=>(await state(b)).guards[0].speech,{intervals:[30]}).toBe('Не толкайся.');
  await b.screenshot({path:info.outputPath('guard-chain-fist.png')});
  for(let hit=2;hit<=10;hit++){
   await a.keyboard.down('s');await expect.poll(async()=>{const s=await state(a);return s.y-s.guards[0].y;},{intervals:[30]}).toBeGreaterThan(60);await a.keyboard.up('s');
   await a.keyboard.down('w');
   if(hit<10){
    await expect.poll(async()=>{const s=await state(a);return Math.hypot(s.x-s.guards[0].x,s.y-s.guards[0].y);},{timeout:5000,intervals:[30]}).toBeLessThan(40);
    await expect.poll(async()=>(await state(a)).guards[0].progress,{timeout:5000,intervals:[30]}).toBeLessThan(.15);
    expect((await state(a)).guards[0].speech).toBe(hit===9?'Ещё один толчок, и на выход.':'Не толкайся.');expect((await state(a)).security).toBe('');
   }
   else await expect.poll(async()=>(await state(a)).security,{timeout:10000,intervals:[30]}).toBe('ejecting');
   await a.keyboard.up('w');
  }
  await expect.poll(async()=>(await state(b)).guards[0].phase,{timeout:15000,intervals:[50]}).toBe('carry');
  await b.screenshot({path:info.outputPath('guard-chain-carry.png')});
  await expect(b.locator('.security-message')).toContainText('десять толчков охранника');
  await expect.poll(async()=>(await state(a)).hall,{timeout:30000}).toBe('street');
  expect(await network(a)).toMatchObject({status:'connected',roomId:host.roomId,selfId});
  await expect(a.locator('#club-chat-dock')).toBeHidden();
  await expect(a.locator('#security-dialog')).toBeHidden();
  await a.reload();await expect.poll(async()=>(await network(a))?.status,{timeout:30000}).toBe('connected');
  await expect.poll(async()=>(await state(a))?.hall).toBe('street');
  await expect(a.locator('#join-dialog')).toBeHidden();
  await expect(a.locator('#club-fine-open')).toBeVisible();
  expect(errors).toEqual([]);
 }finally{await ca.close();await cb.close();await Promise.race([host.leave(),new Promise(resolve=>setTimeout(resolve,1500))]);}
});

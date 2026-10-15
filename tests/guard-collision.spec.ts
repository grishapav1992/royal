import {test,expect,type Page} from '@playwright/test';
import {securityRoom} from './security-room';
const state=(p:Page)=>p.evaluate(()=>(window as any).royalDemo.getState());
async function join(page:Page,room:string){
 await page.request.post('/api/auth/login',{data:{email:`bump-${crypto.randomUUID()}@example.test`,password:'Royal-test-123!'}});
 await page.request.post('/api/auth/character',{data:{skin:1,name:'Проверка толчков'}});
 await page.goto('/?room='+room);await expect.poll(async()=>(await state(page)).online).toBe(true);
 await page.locator('#room-overview').click();await page.locator('#game').focus();
}
test('solid guard shows a fist to both players; holding does not multiply hits and ten contacts eject',async({browser,request})=>{
 test.setTimeout(100000);
 const {room:host}=await securityRoom(request),ca=await browser.newContext(),cb=await browser.newContext(),a=await ca.newPage(),b=await cb.newPage();
 const errors:string[]=[];for(const p of [a,b])p.on('pageerror',e=>errors.push(e.message));
 try{
  await join(a,host.roomId);await join(b,host.roomId);
  await a.keyboard.down('s');await expect.poll(async()=>(await state(a)).y,{intervals:[20]}).toBeGreaterThan(582);await a.keyboard.up('s');
  await a.keyboard.down('d');await expect.poll(async()=>(await state(a)).x,{intervals:[20]}).toBeGreaterThan(824);await a.keyboard.up('d');
  expect((await state(a)).x).toBeLessThan(836);
  await expect.poll(async()=>(await state(a)).guards[0].phase,{timeout:20000}).toBe('chat');
  await a.keyboard.down('w');await expect.poll(async()=>(await state(a)).guards[0].phase,{timeout:10000,intervals:[30]}).toBe('bump');
  await a.waitForTimeout(600);await a.keyboard.up('w');
  expect((await state(a)).guards[0].speech).toBe('Не толкайся.');
  const first=await state(a);expect(Math.hypot(first.x-first.guards[0].x,first.y-first.guards[0].y)).toBeGreaterThanOrEqual(35);
  await expect.poll(async()=>(await state(b)).guards[0].speech,{intervals:[30]}).toBe('Не толкайся.');
  await b.screenshot({path:'artifacts/guard-chain-fist.png'});
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
  await b.screenshot({path:'artifacts/guard-chain-carry.png'});
  await expect(a.locator('#security-dialog')).toBeVisible({timeout:15000});await expect(a.locator('#security-dialog')).toContainText('за толчки охранника');
  await a.reload();await expect(a.locator('#join-error')).toContainText('Охрана закрыла вход',{timeout:15000});
  expect(errors).toEqual([]);
 }finally{await ca.close();await cb.close();await Promise.race([host.leave(),new Promise(resolve=>setTimeout(resolve,1500))]);}
});

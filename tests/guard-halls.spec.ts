import {test,expect,type Page} from '@playwright/test';
import {securityRoom} from './security-room';
import {selectHall} from './room-ui';
const state=(page:Page)=>page.evaluate(()=>(window as any).royalDemo.getState());
async function join(page:Page,room:string){
 await page.request.post('/api/auth/login',{data:{email:`guard-halls-${crypto.randomUUID()}@example.test`,password:'Royal-test-123!'}});
 await page.request.post('/api/auth/character',{data:{skin:1,name:'Проверка перехода'}});
 await page.goto('/?room='+room);await expect.poll(async()=>(await state(page)).online).toBe(true);
 await page.locator('#room-overview').click();
}
test('one guard walks through both doors, remains shared after reload, and returns for an offense',async({browser,request})=>{
 test.setTimeout(150000);
 const {room:host}=await securityRoom(request),ca=await browser.newContext(),cb=await browser.newContext(),a=await ca.newPage(),b=await cb.newPage();
 const errors:string[]=[];for(const p of [a,b])p.on('pageerror',e=>errors.push(e.message));
 const crossings:{hall:string,x:number,y:number}[]=[];let previous='arcade',maxGuards=0,disconnected=false;
 host.onLeave(()=>{disconnected=true;});
 host.onStateChange(s=>{maxGuards=Math.max(maxGuards,s.guards.size);const g=s.guards.get('security');if(g&&g.hall!==previous){crossings.push({hall:g.hall,x:g.x,y:g.y});previous=g.hall;}});
 try{
  await join(a,host.roomId);await join(b,host.roomId);await selectHall(b,'tables');
  expect((await state(a)).guards).toHaveLength(1);expect((await state(b)).guards).toHaveLength(1);
  expect((await state(b)).guards[0].hall).toBe('arcade');
  await b.screenshot({path:'artifacts/guard-tables-empty.png'});
  await expect.poll(async()=>{expect(disconnected,'isolated room must stay connected during patrol').toBe(false);return (await state(b)).guards[0].hall;},{timeout:80000}).toBe('tables');
  await expect.poll(async()=>(await state(a)).guards[0].hall).toBe('tables');
  expect(crossings[0].hall).toBe('tables');expect(crossings[0].x).toBeCloseTo(900,0);expect(crossings[0].y).toBeGreaterThan(620);
  await expect.poll(async()=>(await state(b)).guards[0].phase).toBe('patrol');
  await b.screenshot({path:'artifacts/guard-arrives-tables.png'});
  await a.screenshot({path:'artifacts/guard-arcade-empty.png'});
  await b.reload();await expect.poll(async()=>(await state(b)).online).toBe(true);
  expect((await state(b)).guards).toHaveLength(1);expect((await state(b)).guards[0].hall).toBe('tables');
  await a.locator('#chat-input').fill('ты дебил');await a.locator('#chat-input').press('Enter');
  await expect.poll(async()=>(await state(a)).guards[0].target,{timeout:20000}).not.toBe('');
  await expect.poll(async()=>(await state(a)).guards[0].hall,{timeout:15000}).toBe('arcade');
  expect(crossings[1].hall).toBe('arcade');expect(crossings[1].x).toBeCloseTo(900,0);expect(crossings[1].y).toBeLessThan(260);
  await expect.poll(async()=>(await state(a)).guards[0].phase,{timeout:15000}).toBe('warn');
  await expect(a.locator('#chat-input')).toBeEnabled({timeout:10000});
  expect(maxGuards).toBe(1);expect(errors).toEqual([]);
 }finally{await ca.close();await cb.close();await Promise.race([host.leave(),new Promise(resolve=>setTimeout(resolve,1500))]);}
});

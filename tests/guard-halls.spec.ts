import {test,expect,type Page} from '@playwright/test';
import {HALL_DOORS} from '../src/shared/world';
import {OFFENSIVE_CHAT_BURST,securityRoom} from './security-room';
import {worldPoint} from './room-ui';
const state=(page:Page)=>page.evaluate(()=>(window as any).royalDemo?.getState());
async function join(page:Page,room:string){
 await page.request.post('/api/auth/login',{data:{email:`guard-halls-${crypto.randomUUID()}@example.test`,password:'Royal-test-123!'}});
 await page.request.post('/api/auth/character',{data:{skin:1,name:'Проверка перехода'}});
 await page.goto('/?mode=club&lang=ru&room='+room);await expect.poll(async()=>(await state(page))?.online).toBe(true);
 await page.locator('#room-overview').click();
}
test('one guard walks through both doors, remains shared after reload, and returns for an offense',async({browser,request},info)=>{
 test.setTimeout(180000);
 const {room:host}=await securityRoom(request),ca=await browser.newContext(),cb=await browser.newContext(),a=await ca.newPage(),b=await cb.newPage();
 const errors:string[]=[];for(const p of [a,b])p.on('pageerror',e=>errors.push(e.message));
 const crossings:{hall:string,x:number,y:number,target:string}[]=[];let previous='arcade',maxGuards=0,disconnected=false;
 host.onLeave(()=>{disconnected=true;});
 host.onStateChange(s=>{maxGuards=Math.max(maxGuards,s.guards.size);const g=s.guards.get('security');if(g&&g.hall!==previous){crossings.push({hall:g.hall,x:g.x,y:g.y,target:g.target});previous=g.hall;}});
 try{
  await expect.poll(()=>host.state.guards.get('security')?.hall).toBe('arcade');
  await join(a,host.roomId);
  const position={x:HALL_DOORS.arcade.arrival.x,y:HALL_DOORS.arcade.arrival.y+30};
  const point=await worldPoint(a,position.x,position.y);await a.mouse.click(point.x,point.y);
  await expect.poll(async()=>{const s=await state(a);return Math.hypot(s.x-position.x,s.y-position.y);},{timeout:15000}).toBeLessThan(8);
  await join(b,host.roomId);
  await b.locator('[data-floor-target="tables"]').click();
  await expect.poll(async()=>(await state(b))?.hall,{timeout:30000}).toBe('tables');
  await expect.poll(()=>crossings.some(crossing=>crossing.hall==='tables'),{timeout:80000}).toBe(true);
  const tablesEntry=crossings.find(crossing=>crossing.hall==='tables')!;
  expect(tablesEntry.x).toBeCloseTo(HALL_DOORS.tables.entry.x,0);
  expect(tablesEntry.y).toBeGreaterThan(HALL_DOORS.tables.arrival.y);
  await b.bringToFront();await b.reload();
  await expect.poll(async()=>(await state(b))?.guards?.length,{timeout:20000}).toBe(1);
  await expect.poll(async()=>(await state(b))?.hall).toBe('tables');
  await expect.poll(async()=>{
   const [first,second]=await Promise.all([state(a),state(b)]);
   return first?.guards?.length===1&&first.guards[0].hall===second?.guards?.[0]?.hall;
  }).toBe(true);
  await b.screenshot({path:info.outputPath('guard-shared-after-reload.png')});
  await a.bringToFront();
  await a.locator('#chat-input').fill(OFFENSIVE_CHAT_BURST);
  await expect.poll(()=>host.state.guards.get('security')?.hall,{timeout:45000}).not.toBe('arcade');
  await a.locator('#chat-input').press('Enter');
  const selfId=await a.evaluate(()=>(window as any).royalDemo.getNetworkState().selfId);
  const returnCrossing=()=>crossings.find(crossing=>crossing.hall==='arcade'&&crossing.target===selfId);
  await expect.poll(returnCrossing,{timeout:20000}).toBeDefined();
  expect(returnCrossing()!.x).toBeCloseTo(HALL_DOORS.arcade.entry.x,0);
  expect(returnCrossing()!.y).toBeLessThan(HALL_DOORS.arcade.arrival.y);
  await expect.poll(async()=>(await state(a)).security,{timeout:20000}).toBe('ejecting');
  await expect.poll(async()=>(await state(a)).hall,{timeout:30000}).toBe('street');
  await expect(a.locator('#club-chat-dock')).toBeHidden();
  await expect(b.locator('#chat-input')).toBeEnabled();
  expect(disconnected,'isolated room must stay connected during patrol').toBe(false);
  expect(maxGuards).toBe(1);expect(errors).toEqual([]);
 }finally{await ca.close();await cb.close();await Promise.race([host.leave(),new Promise(resolve=>setTimeout(resolve,1500))]);}
});

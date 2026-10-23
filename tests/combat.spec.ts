import {test,expect,type Page} from '@playwright/test';
import {worldPoint} from './room-ui';
const activity=(p:Page)=>p.evaluate(()=>(window as any).royalDemo.getActivities());
const state=(p:Page)=>p.evaluate(()=>(window as any).royalDemo.getState());
async function login(p:Page,identity:string,room?:string){
 await p.goto('/'+(room?'?room='+room:''),{waitUntil:'domcontentloaded'});
 await p.getByLabel('Почта',{exact:true}).fill(identity);
 await p.getByLabel('Пароль',{exact:true}).fill('Royal-test-123!');
 await p.getByRole('button',{name:'Продолжить',exact:true}).click();
 await expect.poll(async()=>(await state(p)).online).toBe(true);
 await expect.poll(async()=>{try{return await balance(p);}catch{return null;}},{timeout:10000}).toBe('200000000');
}
async function open(p:Page){
 await p.bringToFront();
 if(await p.locator('#room-overview').getAttribute('aria-pressed')!=='true')await p.locator('#room-overview').click();
 const point=await worldPoint(p,1460,425);await p.mouse.click(point.x,point.y);
 await expect(p.locator('[data-combat]')).toBeVisible({timeout:25000});
}
async function balance(p:Page){return p.evaluate(async()=>{const me=await(await fetch('/api/auth/me')).json();const response=await fetch('/api/nile-play/wallet',{headers:{'X-Royal-Account-Id':me.account?.id??me.id}});const wallet=await response.json();if(!response.ok)throw Error('Balance pending');return wallet.balanceUnits;});}
test('real host: two players, equal stakes, chat, phone controls, surrender payout and reopen',async({browser})=>{
 const ca=await browser.newContext(),cb=await browser.newContext();
 const a=await ca.newPage(),b=await cb.newPage();const errors:string[]=[];
 for(const p of [a,b])p.on('pageerror',e=>errors.push(e.message));
 try{
  await login(a,'combat-local-a@example.test');
  const network=await a.evaluate(()=>(window as any).royalDemo.getNetworkState());
  await login(b,'combat-local-b@example.test',network.roomId);
  for(const p of [a,b]){await p.locator('#floor-links [data-floor-target="tables"]').click();await expect.poll(async()=>(await state(p)).hall,{timeout:30000}).toBe('tables');}
  await a.evaluate(async()=>{
   const {LobbyClient}=await import('/src/network/LobbyClient.ts');
   const original=LobbyClient.prototype.send;
   LobbyClient.prototype.send=function(type:string,data?:unknown){(window as any).__combatAttack=(packet:unknown)=>original.call(this,'activity',packet);return original.call(this,type,data);};
  });
  await open(a);await open(b);
  await expect.poll(async()=>(await activity(a)).combat.players.length).toBe(2);
  await expect(a.locator('#shared-dialog #chat-input')).toBeVisible();
  await a.locator('#shared-dialog #chat-input').fill('Проверка чата J K L');
  await a.locator('#shared-dialog #chat-input').press('Enter');
  await expect(b.locator('#chat-log')).toContainText('Проверка чата J K L');
  await a.locator('[data-ready]').click();
  await expect.poll(async()=>(await activity(a)).combat.ready.length).toBe(1);
  expect((await activity(a)).combat.phase).toBe('waiting');
  await b.locator('[data-ready]').click();
  await expect.poll(async()=>(await activity(a)).combat.phase).toBe('playing');
  await expect.poll(async()=>{try{return await balance(a);}catch{return null;}},{timeout:10000}).toBe('199000000');
  expect(await a.evaluate(async()=>{
   const me=await(await fetch('/api/auth/me')).json();
   return (await fetch('/api/nile-play/combat-settle',{method:'POST',headers:{'Content-Type':'application/json','X-Royal-Account-Id':me.account?.id??me.id},body:JSON.stringify({winner:me.account?.id??me.id,payoutUnits:'999999999'})})).status;
  })).toBe(405);
  await a.evaluate(()=>{
   const s=(window as any).royalDemo.getActivities().combat,send=(window as any).__combatAttack;
   for(const payload of [
    {type:'combat-win',winner:s.players[0]},
    {type:'combat-settle',winner:s.players[0],payout:1000000},
    {type:'combat-input',seq:100,input:{left:false,right:false,jump:false,punch:true,kick:false,block:false},player:s.players[1]},
    {type:'combat-input',seq:100,input:{left:false,right:false,jump:false,punch:true,kick:false,block:false},health:0,dt:90},
    {type:'combat-input',seq:s.fighters[0].inputSequence,input:{left:false,right:false,jump:false,punch:true,kick:false,block:false}},
   ])send({match:s.id,...payload});
  });
  await expect.poll(async()=>(await activity(b)).combat.fighters.map((f:any)=>f.health)).toEqual([100,100]);
  expect((await activity(b)).combat.winner).toBe('');
  await a.setViewportSize({width:390,height:844});
  await expect(a.locator('#shared-dialog #chat-input')).toBeInViewport();
  await expect(a.locator('[data-key="punch"]')).toBeInViewport();
  await a.screenshot({path:'artifacts/work/mortal-kombat-duel/mobile.png'});
  const oldX=(await activity(a)).combat.fighters[0].x;
  const right=(await a.locator('[data-key="right"]').boundingBox())!;await a.mouse.move(right.x+right.width/2,right.y+right.height/2);await a.mouse.down();
  await expect.poll(async()=>(await activity(a)).combat.fighters[0].x).toBeGreaterThan(oldX);
  await a.mouse.up();
  await a.setViewportSize({width:1366,height:900});
  await a.screenshot({path:'artifacts/work/mortal-kombat-duel/desktop.png'});
  await b.locator('#shared-close').click();
  await expect.poll(async()=>(await activity(a)).combat.phase).toBe('finished');
  await expect(a.locator('[data-combat] [data-status]')).toContainText('1,9');
  await expect.poll(async()=>{try{return await balance(a);}catch{return null;}},{timeout:10000}).toBe('200900000');
  await a.locator('#shared-close').click();
  await expect(a.locator('#shared-dialog')).toHaveCount(0);
  await expect(a.locator('#chat-input')).toBeVisible();
  await open(a);
  await expect(a.locator('[data-ready]')).toBeDisabled();
  expect(errors).toEqual([]);
 }finally{await ca.close();await cb.close();}
});

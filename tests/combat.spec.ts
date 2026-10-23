import {test,expect,type Page} from '@playwright/test';
import {selectHall,worldPoint} from './room-ui';
const activity=(p:Page)=>p.evaluate(()=>(window as any).royalDemo.getActivities());
const state=(p:Page)=>p.evaluate(()=>(window as any).royalDemo.getState());
async function login(p:Page,room?:string){
 await p.goto('/'+(room?'?room='+room:''),{waitUntil:'domcontentloaded'});
 await p.getByLabel('Почта',{exact:true}).fill('mk-'+crypto.randomUUID()+'@example.test');
 await p.getByLabel('Пароль',{exact:true}).fill('Royal-test-123!');
 await p.getByRole('button',{name:'Продолжить',exact:true}).click();
 await p.getByRole('button',{name:'Войти в зал',exact:true}).click();
 await expect.poll(async()=>(await state(p)).online).toBe(true);
 await p.evaluate(async()=>{
  const me=await(await fetch('/api/auth/me')).json();
  const id=me.account?.id??me.id;
  const response=await fetch('/api/demo-wallet/operations',{method:'POST',headers:{'Content-Type':'application/json','X-Royal-Account-Id':id},body:JSON.stringify({id:crypto.randomUUID(),kind:'deposit',amount:1000})});
  if(!response.ok)throw Error(await response.text());
 });
}
async function open(p:Page){
 await p.bringToFront();
 if(await p.locator('#room-overview').getAttribute('aria-pressed')!=='true')await p.locator('#room-overview').click();
 const point=await worldPoint(p,1460,425);await p.mouse.click(point.x,point.y);
 await expect(p.locator('[data-combat]')).toBeVisible({timeout:25000});
}
test('real host: two players, equal stakes, chat, phone controls, surrender payout and reopen',async({browser})=>{
 const ca=await browser.newContext(),cb=await browser.newContext();
 const a=await ca.newPage(),b=await cb.newPage();const errors:string[]=[];
 for(const p of [a,b])p.on('pageerror',e=>errors.push(e.message));
 try{
  await login(a);
  const network=await a.evaluate(()=>(window as any).royalDemo.getNetworkState());
  await login(b,network.roomId);
  await selectHall(a,'tables');await selectHall(b,'tables');
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
  const amount=await a.evaluate(async()=>{const me=await(await fetch('/api/auth/me')).json();const w=await(await fetch('/api/demo-wallet',{headers:{'X-Royal-Account-Id':me.account?.id??me.id}})).json();return w.balance;});
  expect(amount).toBe(900);
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
  await expect(a.locator('[data-combat] [data-status]')).toContainText('190');
  const payout=await a.evaluate(async()=>{const me=await(await fetch('/api/auth/me')).json();return(await(await fetch('/api/demo-wallet',{headers:{'X-Royal-Account-Id':me.account?.id??me.id}})).json()).balance;});
  expect(payout).toBe(1090);
  await a.locator('#shared-close').click();
  await expect(a.locator('#shared-dialog')).toHaveCount(0);
  await expect(a.locator('#chat-input')).toBeVisible();
  await open(a);
  await expect(a.locator('[data-ready]')).toBeDisabled();
  expect(errors).toEqual([]);
 }finally{await ca.close();await cb.close();}
});

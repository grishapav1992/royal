import {test,expect,type Page} from '@playwright/test';
import {securityRoom} from './security-room';
const state=(page:Page)=>page.evaluate(()=>(window as any).royalDemo.getState());
async function register(page:Page){
 const login=await page.request.post('/api/auth/login',{data:{email:`security-${crypto.randomUUID()}@example.test`,password:'Royal-test-123!'}});expect(login.ok()).toBe(true);
 await page.request.post('/api/auth/character',{data:{skin:4,name:'Тест охраны'}});
}
test('swearing is allowed; personal insults trigger warning and ejection, including after reload',async({browser,request})=>{
 test.setTimeout(120000);
 const a=await browser.newContext(),b=await browser.newContext();const player=await a.newPage(),observer=await b.newPage();const errors:string[]=[];
 for(const p of [player,observer])p.on('pageerror',e=>errors.push(e.message));
 const {room:host}=await securityRoom(request);
 try{
  await register(player);await player.goto('/?room='+host.roomId);await expect.poll(async()=>(await state(player)).online).toBe(true);
  await register(observer);await observer.goto(player.url());await expect.poll(async()=>(await state(observer)).remotes).toBe(2);
  await player.locator('#chat-input').fill('Всем привет');await player.locator('#chat-input').press('Enter');await expect(observer.locator('#chat-log')).toContainText('Всем привет',{timeout:20000});
  for(const text of ['блять, опять проиграл','fuck, I lost']){
   await expect(player.locator('#chat-input')).toBeEnabled();
   await player.locator('#chat-input').fill(text);await player.locator('#chat-input').press('Enter');
   await expect(observer.locator('#chat-log')).toContainText(text,{timeout:20000});
  }
  expect(await observer.locator('.security-message').count()).toBe(0);
  await expect(player.locator('#chat-input')).toBeEnabled();
  await player.locator('#chat-input').fill('ты дебил');await player.locator('#chat-input').press('Enter');
  await expect(observer.locator('.security-message')).toContainText('первое предупреждение',{timeout:20000});
  await expect.poll(async()=>(await state(player)).guards[0].phase,{timeout:15000}).toBe('warn');
  await player.screenshot({path:'artifacts/security-warning.png'});
  await expect(player.locator('#chat-log')).not.toContainText('ты дебил');
  await expect(player.locator('#chat-input')).toBeEnabled({timeout:15000});
  await player.reload();await expect(player.locator('#chat-input')).toBeEnabled();
  await player.locator('#chat-input').fill('fuck you');await player.locator('#chat-input').press('Enter');
  await expect.poll(async()=>(await state(player)).security,{timeout:20000}).toBe('ejecting');
  const before=await state(player);await player.keyboard.down('d');await player.waitForTimeout(150);await player.keyboard.up('d');
  expect((await state(player)).predicted).toBe(false);
  await expect.poll(async()=>(await state(observer)).guards[0].phase,{intervals:[50]}).toBe('carry');
  await observer.screenshot({path:'artifacts/security-carry.png'});
  await expect(player.locator('#security-dialog')).toBeVisible({timeout:20000});
  await expect(player.locator('#security-return')).toBeDisabled();
  await player.setViewportSize({width:390,height:844});await player.screenshot({path:'artifacts/security-outside-mobile.png'});
  expect(await player.locator('#security-dialog').evaluate(e=>e.getBoundingClientRect().width)).toBeLessThan(390);
  await expect.poll(async()=>(await state(observer)).remotes).toBe(1);
  await player.goto('/');await expect(player.locator('#join-error')).toContainText('Охрана закрыла вход',{timeout:15000});
  expect(errors).toEqual([]);
 }finally{await a.close();await b.close();await host.leave();}
});

test('spam across rooms warns once, ignores in-flight verdicts and ejects only for a new episode',async({request})=>{
 test.setTimeout(90000);
 const {room:a,cookie}=await securityRoom(request),{room:b}=await securityRoom(request,cookie);
 const warnings:any[]=[];a.onMessage('security',value=>warnings.push(value));
 try{
  for(let i=0;i<8;i++)(i%2?a:b).send('chat','Проверка потока '+i);
  await expect.poll(()=>warnings.length,{timeout:10000}).toBe(1);
  expect(warnings[0]).toMatchObject({kind:'warning',reason:'spam'});
  await expect.poll(()=>a.state.players.get(a.sessionId)?.security,{timeout:20000}).toBe('');
  // Allow the old provider call to settle; it must not turn the same episode into a second strike.
  await expect.poll(()=>a.state.guards.get('security')?.phase,{timeout:20000}).toBe('patrol');
  expect(warnings).toHaveLength(1);
  for(let i=0;i<8;i++)a.send('chat','Повторный поток '+i);
  await expect.poll(()=>warnings.length,{timeout:10000}).toBe(2);
  expect(warnings[1]).toMatchObject({kind:'ejecting',reason:'spam'});
  await expect.poll(()=>a.state.guards.get('security')?.phase,{timeout:20000,intervals:[100]}).toBe('carry');
 }finally{await a.leave();await b.leave();}
});

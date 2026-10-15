import {test,expect,type Page} from '@playwright/test';
import {Client} from '@colyseus/sdk';
const guard=(p:Page)=>p.evaluate(()=>(window as any).royalDemo.getState().guards[0]);
async function register(page:Page,room:string){
 await page.request.post('/api/auth/login',{data:{email:`guard-life-${crypto.randomUUID()}@example.test`,password:'Royal-test-123!'}});
 await page.request.post('/api/auth/character',{data:{skin:0,name:'Проверка обхода'}});
 await page.goto('/?room='+room);await expect(page.locator('#join-dialog')).not.toBeVisible({timeout:15000});
}
test('two viewers and a late joiner see the same patrol, conversation and window visit; an offense interrupts leisure',async({browser,request})=>{
 test.setTimeout(110000);
 const login=await request.post('/api/auth/login',{data:{email:`guard-host-${crypto.randomUUID()}@example.test`,password:'Royal-test-123!'}});
 const cookie=login.headers()['set-cookie'].split(';')[0];await request.post('/api/auth/character',{data:{skin:0}});
 const host=await new Client(process.env.TEST_BASE_URL||'http://127.0.0.1:2567',{headers:{Cookie:cookie},fetchFn:async(url,options)=>{
  const response=await request.fetch(String(url),{method:options?.method,headers:Object.fromEntries(new Headers(options?.headers)),data:options?.body as string});
  return new Response(await response.body(),{status:response.status(),headers:response.headers()});
 }}).create<any>('lobby');
 for(const type of ['chat','activities','piano-note','notice'])host.onMessage(type,()=>{});
 const ca=await browser.newContext(),cb=await browser.newContext(),a=await ca.newPage(),b=await cb.newPage();const errors:string[]=[];
 for(const p of [a,b])p.on('pageerror',e=>errors.push(e.message));
 try{
  await register(a,host.roomId);
  await expect.poll(async()=>(await guard(a)).phase,{timeout:20000}).toBe('chat');
  await register(b,host.roomId);
  await expect.poll(async()=>{const x=await guard(a),y=await guard(b);return x.phase===y.phase&&x.routine===y.routine&&Math.hypot(x.x-y.x,x.y-y.y)<8;}).toBe(true);
  await expect.poll(async()=>(await guard(b)).reply,{timeout:10000}).not.toBe('');
  await b.screenshot({path:'artifacts/guard-life-bar.png'});
  expect(await b.locator('#chat-log').textContent()).not.toContain((await guard(b)).reply);
  await b.reload();await expect(b.locator('#join-dialog')).not.toBeVisible();
  await expect.poll(async()=>(await guard(b)).phase,{timeout:20000}).toBe('patrol');
  const start=await guard(b);await expect.poll(async()=>{const g=await guard(b);return Math.hypot(g.x-start.x,g.y-start.y);}).toBeGreaterThan(15);
  await expect.poll(async()=>(await guard(b)).phase,{timeout:65000}).toBe('window');
  await b.screenshot({path:'artifacts/guard-life-window.png'});
  await b.locator('#chat-input').fill('ты дебил');await b.locator('#chat-input').press('Enter');
  await expect.poll(async()=>(await guard(b)).target,{timeout:20000}).not.toBe('');
  expect((await guard(b)).reply).toBe('');
  await expect.poll(async()=>(await guard(b)).phase,{timeout:10000}).toBe('warn');
  await expect(b.locator('#chat-input')).toBeEnabled({timeout:10000});
  await expect.poll(async()=>(await guard(b)).phase,{timeout:20000}).toBe('patrol');
  expect(errors).toEqual([]);
 }finally{await ca.close();await cb.close();await host.leave();await request.post('/api/auth/logout');}
});

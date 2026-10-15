import {test,expect,type BrowserContext} from '@playwright/test';

test('Mira moves, works and stays synchronized for two viewers and a late arrival',async({browser,baseURL})=>{
 test.setTimeout(100000);
 const contexts:BrowserContext[]=[];
 async function guest(room?:string){
  const context=await browser.newContext();contexts.push(context);
  const login=await context.request.post(`${baseURL}/api/auth/login`,{headers:{Origin:baseURL!},data:{email:`mira-life-${crypto.randomUUID()}@example.test`,password:crypto.randomUUID()}});expect(login.ok()).toBe(true);
  const choice=await context.request.post(`${baseURL}/api/auth/character`,{headers:{Origin:baseURL!},data:{skin:0,name:'Гость бара'}});expect(choice.ok()).toBe(true);
  const page=await context.newPage();await page.goto(room?`/?room=${room}`:'/');await expect(page.locator('#join-dialog')).not.toBeVisible({timeout:20000});
  await expect.poll(()=>page.evaluate(()=>(window as any).royalDemo.getNetworkState().status)).toBe('connected');return page;
 }
 try{
  const a=await guest(),room=await a.evaluate(()=>(window as any).royalDemo.getNetworkState().roomId),b=await guest(room);
  const state=(p:typeof a)=>p.evaluate(()=>(window as any).royalDemo.getState().mira);
  await expect.poll(async()=>Math.abs((await state(a)).x-(await state(b)).x)).toBeLessThan(5);
  await expect.poll(async()=>['walk','wipe'].includes((await state(a)).action),{timeout:50000}).toBe(true);
  const initial=await state(a);
  await expect.poll(async()=>Math.abs((await state(a)).x-initial.x),{timeout:12000}).toBeGreaterThan(8);
  await expect.poll(async()=>Math.abs((await state(a)).x-(await state(b)).x)).toBeLessThan(5);
  await expect.poll(async()=>(await state(a)).action,{timeout:45000}).toBe('wipe');
  await a.screenshot({path:'artifacts/mira-life-wipe.png'});
  const late=await guest(room);await expect.poll(async()=>Math.abs((await state(a)).x-(await state(late)).x)).toBeLessThan(5);
 }finally{for(const context of contexts)await context.close();}
});

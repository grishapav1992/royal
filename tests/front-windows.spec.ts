import {test,expect,type Page} from '@playwright/test';
import {projectStreetPoint} from '../src/game/streetView';
const state=(page:Page)=>page.evaluate(()=>(window as any).royalDemo.getState());
async function overview(page:Page,on:boolean){
  const button=page.locator('#room-overview');if((await button.getAttribute('aria-pressed')==='true')!==on)await button.click();
  await expect.poll(async()=>(await state(page)).view.overview).toBe(on);
}
async function tapWorld(page:Page,x:number,y:number){
  await page.bringToFront();await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
  const s=await state(page),p=projectStreetPoint({x,y},s.street.view.orientation),b=(await page.locator('#game canvas').boundingBox())!;
  const px=b.x+(p.x-s.view.x)*s.view.zoom*b.width/s.view.width,py=b.y+(p.y-s.view.y)*s.view.zoom*b.height/s.view.height;
  expect(px).toBeGreaterThanOrEqual(b.x);expect(px).toBeLessThanOrEqual(b.x+b.width);expect(py).toBeGreaterThanOrEqual(b.y);expect(py).toBeLessThanOrEqual(b.y+b.height);
  if(page.viewportSize()!.width<600)await page.touchscreen.tap(px,py);else await page.mouse.click(px,py);
}
async function walk(page:Page,x:number,y:number){
  await tapWorld(page,x,y);await expect.poll(async()=>{const s=await state(page);return Math.hypot(s.x-x,s.y-y);},{timeout:20000}).toBeLessThan(5);
}
async function liveWindows(page:Page,side:'front'|'rear'){
  const key=side==='front'?'frontWindows':'rearWindows';
  await expect.poll(async()=>(await state(page)).street[key].visible).toBe(true);
  await expect.poll(async()=>{
    const w=(await state(page)).street[key];return w.windows.filter((p:any)=>p.onscreen&&p.room).length>0&&w.windows.filter((p:any)=>p.onscreen&&p.room).every((p:any)=>p.captured);
  }).toBe(true);
  const w=(await state(page)).street[key];expect(w.maskApplied).toBe(true);expect(w.people.every((p:any)=>!p.interactive)).toBe(true);
  await expect.poll(async()=>(await state(page)).street[key].people.some((p:any)=>p.visible&&p.moving)).toBe(true);
}
test('front facade shows real floors through glass, pauses its visitors and preserves the entrance and rear view',async({page},info)=>{
  test.setTimeout(180000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await page.getByLabel('Почта',{exact:true}).fill('facade-'+crypto.randomUUID()+'@example.test');await page.getByLabel('Пароль',{exact:true}).fill('Front-window-browser-test!');
  await page.getByRole('button',{name:'Продолжить',exact:true}).click();await expect(page.locator('#character-step')).toBeVisible({timeout:15000});
  await page.getByRole('button',{name:'Войти в зал',exact:true}).click();await expect.poll(async()=>(await state(page)).online).toBe(true);
  const balance=await page.locator('#wallet-balance').textContent();
  await page.locator('[data-floor-target="street"]').click();await expect.poll(async()=>(await state(page)).hall,{timeout:25000}).toBe('street');
  await overview(page,true);await walk(page,1550,1050);await overview(page,false);await liveWindows(page,'front');
  const front=(await state(page)).street.frontWindows;
  expect(front.entry).toBeNull();expect([...new Set(front.windows.filter((w:any)=>w.room).map((w:any)=>w.room.hall))].sort()).toEqual(['arcade','github','tables']);
  expect(front.windows.filter((w:any)=>w.room)).toHaveLength(14);
  expect(front.windows.filter((w:any)=>w.floor>3).every((w:any)=>!w.room)).toBe(true);
  const before=front.people.map((p:any)=>p.x);await page.waitForTimeout(450);expect((await state(page)).street.frontWindows.people.some((p:any,i:number)=>Math.abs(p.x-before[i])>3)).toBe(true);
  await page.screenshot({path:'../front-windows-'+info.project.name+'-ground.png'});
  await tapWorld(page,1550,805);await page.waitForTimeout(200);expect((await state(page)).hall).toBe('street');expect((await state(page)).stairStep).toBe(0);expect((await state(page)).y).toBeGreaterThan(935);
  await overview(page,true);const time=(await state(page)).street.frontWindows.time;await page.waitForTimeout(250);expect((await state(page)).street.frontWindows.time).toBe(time);
  for(const p of [{x:480,y:1050},{x:480,y:450},{x:590,y:450}])await walk(page,p.x,p.y);
  await overview(page,false);await liveWindows(page,'front');
  expect((await state(page)).street.frontWindows.windows.some((w:any)=>w.onscreen&&w.room?.floor===3&&w.captured)).toBe(true);
  await page.screenshot({path:'../front-windows-'+info.project.name+'-upper.png'});
  if(info.project.name==='desktop'){
    const viewport=page.viewportSize()!;await page.setViewportSize({width:3200,height:2200});
    await expect.poll(async()=>(await state(page)).street.frontWindows.windows.filter((w:any)=>w.onscreen&&w.room&&w.captured).length).toBe(14);
    await page.locator('#game canvas').screenshot({path:'../front-windows-all-floors.png'});await page.setViewportSize(viewport);
  }
  await overview(page,true);for(const p of [{x:480,y:450},{x:480,y:360},{x:1370,y:360}])await walk(page,p.x,p.y);
  await overview(page,false);await liveWindows(page,'rear');expect((await state(page)).street.frontWindows.visible).toBe(false);
  const frozen=(await state(page)).street.frontWindows.time;await page.waitForTimeout(250);expect((await state(page)).street.frontWindows.time).toBe(frozen);
  expect((await state(page)).street.rearWindows.entry.available).toBe(false);await page.screenshot({path:'../front-windows-'+info.project.name+'-rear-regression.png'});
  await overview(page,true);for(const p of [{x:2320,y:360},{x:2320,y:1050},{x:1550,y:1050}])await walk(page,p.x,p.y);await overview(page,false);
  await page.emulateMedia({reducedMotion:'reduce'});await page.reload();await expect(page.locator('#chat-input')).toBeEnabled({timeout:25000});
  await expect.poll(async()=>(await state(page)).hall).toBe('street');await expect.poll(async()=>(await state(page)).street.frontWindows.motion).toBe(false);
  const paused=(await state(page)).street.frontWindows;await page.waitForTimeout(400);const still=(await state(page)).street.frontWindows;
  expect(still.time).toBe(paused.time);expect(still.people.map((p:any)=>[p.x,p.y,p.frame])).toEqual(paused.people.map((p:any)=>[p.x,p.y,p.frame]));
  await page.locator('[data-floor-target="arcade"]').click();await expect.poll(async()=>(await state(page)).hall,{timeout:25000}).toBe('arcade');
  await expect(page.locator('#chat-input')).toBeEnabled();await expect(page.locator('#wallet-balance')).toHaveText(balance!);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});

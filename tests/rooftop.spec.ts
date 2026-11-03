import { test, expect, type Page } from '@playwright/test';
import { ROOF, ROOF_STAIRS, STREET_ROOF_STAIRS, ROOF_STAIR_ROUTE, ROOF_STAIR_RETURN } from '../src/shared/rooftop';
import { projectStreetPoint,StreetView } from '../src/game/streetView';

const state = (page: Page) => page.evaluate(() => (window as any).royalDemo.getState());
async function overview(page: Page, on: boolean) {
  const button = page.locator('#room-overview');
  if ((await button.getAttribute('aria-pressed') === 'true') !== on) await button.click();
  await expect.poll(async () => (await state(page)).view.overview).toBe(on);
}
async function clickViewPoint(page:Page, point:{x:number;y:number}) {
  await page.bringToFront();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const box = (await page.locator('#game canvas').boundingBox())!, current=await state(page), { view } = current;
  const x=box.x+(point.x-view.x)*view.zoom*box.width/view.width,y=box.y+(point.y-view.y)*view.zoom*box.height/view.height;
  expect(x).toBeGreaterThanOrEqual(box.x);expect(x).toBeLessThanOrEqual(box.x+box.width);
  expect(y).toBeGreaterThanOrEqual(box.y);expect(y).toBeLessThanOrEqual(box.y+box.height);
  if(page.viewportSize()!.width<600)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);
}
async function clickWorld(page: Page, x: number, y: number) {
  const current=await state(page);
  const point=current.hall==='street'?projectStreetPoint({x,y},current.street.view.orientation):{x,y};
  await clickViewPoint(page,point);
}
async function walk(page: Page, x: number, y: number) {
  const tolerance = Math.max(5, 2 / (await state(page)).view.zoom);
  await clickWorld(page, x, y);
  await expect.poll(async () => { const p = await state(page); return Math.hypot(p.x - x, p.y - y); }, { timeout: 25000 }).toBeLessThan(tolerance);
  await expect.poll(async () => { const p = await state(page); return Math.hypot(p.serverX - p.x, p.serverY - p.y); }).toBeLessThan(3);
}

async function flight(page:Page,mobile:boolean,sprint=false){
  const before=await state(page),step=before.stairStep,target=ROOF_STAIR_ROUTE[step],from=ROOF_STAIR_ROUTE[step-1];
  let clicked:{x:number;y:number}|undefined;
  if(mobile){
    const view=new StreetView();view.side=before.street.view.side;view.overview=before.view.overview;
    const a=view.point(before,true),b=view.point(target,true);
    clicked={x:(a.x+b.x)/2,y:(a.y+b.y)/2-8};await clickViewPoint(page,clicked);
  }else{
    const key=target.x===from.x?'ArrowUp':(target.x>from.x)===(before.street.view.orientation==='rear')?'ArrowLeft':'ArrowRight';
    if(sprint)await page.keyboard.down('Shift');
    await page.keyboard.down(key);
    try{await expect.poll(async()=>{const s=await state(page);return s.hall==='roof'||s.stairStep>step;},{timeout:10000}).toBe(true);}
    finally{await page.keyboard.up(key);if(sprint)await page.keyboard.up('Shift');}
  }
  await expect.poll(async()=>{const s=await state(page);return s.hall==='roof'||s.stairStep>step;},{timeout:10000}).toBe(true).catch(async error=>{
    const s=await state(page);console.log('Stair input diagnostic',JSON.stringify({before:{step,x:before.x,y:before.y,dir:before.stairDirection,view:before.view},clicked,after:{step:s.stairStep,x:s.x,y:s.y,dir:s.stairDirection,serverX:s.serverX,serverY:s.serverY,moving:s.moving,predicted:s.predicted,pending:s.pendingInputs,renderX:s.renderX,renderY:s.renderY,view:s.view}}));throw error;
  });
  if(step===ROOF_STAIR_ROUTE.length-1)await expect.poll(async()=>(await state(page)).hall,{timeout:10000}).toBe('roof');
  await expect.poll(async()=>{const s=await state(page);return Math.hypot(s.serverX-s.x,s.serverY-s.y);}).toBeLessThan(1);
}

const stairSpeed=(page:Page)=>page.evaluate(()=>new Promise<number>(resolve=>{
  const start=performance.now();let previous=(window as any).royalDemo.getState(),distance=0;
  const sample=()=>{const now=performance.now(),s=(window as any).royalDemo.getState();distance+=Math.hypot(s.x-previous.x,s.y-previous.y);previous=s;
    if(now-start<180)requestAnimationFrame(sample);else resolve(distance*1000/(now-start));};requestAnimationFrame(sample);
}));

async function staysOnStep(page:Page){
  await expect.poll(async()=>{const s=await state(page);return Math.hypot(s.serverX-s.x,s.serverY-s.y);}).toBeLessThan(.1);
  const before=await state(page);
  await page.keyboard.press('e',{delay:250});
  await page.keyboard.press('Space');
  const box=(await page.locator('#game canvas').boundingBox())!;
  if(page.viewportSize()!.width<600)await page.touchscreen.tap(box.x+18,box.y+box.height*.5);
  else await page.mouse.click(box.x+18,box.y+box.height*.5);
  await page.waitForTimeout(250);
  const after=await state(page);
  expect(after.hall).toBe('street');expect(after.stairStep).toBe(before.stairStep);
  expect(Math.hypot(after.x-before.x,after.y-before.y)).toBeLessThan(.1);
  expect(Math.hypot(after.serverX-before.serverX,after.serverY-before.serverY)).toBeLessThan(.1);
}

async function noGroundConversation(page:Page){
  await expect.poll(async()=>(await state(page)).street.residents.active).toBe(false);
  const residents=(await state(page)).street.residents;
  expect(residents.nearby).toBeNull();expect(residents.conversation).toBeNull();expect(residents.approaching).toBeNull();
  await expect(page.locator('.street-conversation')).toBeHidden();
}

async function verifyRearWindows(page:Page,project:string){
  const before=(await state(page)).street.rearWindows;
  expect(before.visible).toBe(true);expect(before.maskApplied).toBe(true);
  expect(before.windows.length).toBeGreaterThanOrEqual(20);
  expect(new Set(before.windows.map((w:any)=>w.kind)).size).toBe(3);
  expect(before.windows.some((w:any)=>w.onscreen)).toBe(true);
  expect(before.people.some((p:any)=>p.visible&&p.moving)).toBe(true);
  expect(before.people.every((p:any)=>!p.interactive)).toBe(true);
  await page.waitForTimeout(400);
  const after=(await state(page)).street.rearWindows;
  expect(after.people.some((p:any,i:number)=>Math.abs(p.x-before.people[i].x)>3)).toBe(true);
  await page.screenshot({path:`../rear-windows-${project}-lower.png`});
  await overview(page,true);
  await expect.poll(async()=>(await state(page)).street.rearWindows.visible).toBe(false);
  const hiddenTime=(await state(page)).street.rearWindows.time;await page.waitForTimeout(250);
  expect((await state(page)).street.rearWindows.time).toBe(hiddenTime);
  await overview(page,false);
  await expect.poll(async()=>(await state(page)).street.rearWindows.motion).toBe(true);
}

async function verifyFrozenRearWindows(page:Page){
  // The host reads the motion preference when the scene is created after reload.
  await expect.poll(async()=>(await state(page)).reducedMotion).toBe(true);
  await expect.poll(async()=>(await state(page)).street.rearWindows.motion).toBe(false);
  const frozen=(await state(page)).street.rearWindows;await page.waitForTimeout(250);
  const still=(await state(page)).street.rearWindows;
  expect(still.time).toBe(frozen.time);expect(still.people.map((p:any)=>[p.x,p.y,p.frame])).toEqual(frozen.people.map((p:any)=>[p.x,p.y,p.frame]));
}

async function keyUntil(page:Page,key:string,condition:()=>Promise<boolean>,timeout=15000){
  await page.keyboard.down(key);
  try{await expect.poll(condition,{timeout,intervals:[16,32,50]}).toBe(true);}
  finally{await page.keyboard.up(key);}
  await expect.poll(async()=>{const s=await state(page);return Math.hypot(s.serverX-s.x,s.serverY-s.y);}).toBeLessThan(.1);
}

test('manually climb each switchback without falling, reach the roof edge and return with chat intact', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('Почта', { exact: true }).fill(`roof-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Пароль', { exact: true }).fill('Roof-browser-test!');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('#character-step')).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'Войти в зал', exact: true }).click();
  await expect.poll(async () => (await state(page)).online).toBe(true);
  const balance = await page.locator('#wallet-balance').textContent();
  const network = await page.evaluate(() => (window as any).royalDemo.getNetworkState());
  await page.locator('[data-floor-target="street"]').click();
  await expect.poll(async () => (await state(page)).hall, { timeout: 25000 }).toBe('street');
  expect((await state(page)).street.rearWindows.visible).toBe(false);
  await expect(page.locator('[data-floor-target="roof"]')).toHaveCount(0);
  await overview(page, true);
  for (const p of [{ x: 480, y: 1050 }, { x: 480, y: 360 }, { x: 1660, y: 360 }]) await walk(page, p.x, p.y);
  expect((await state(page)).hall).toBe('street');
  await overview(page, false);
  await page.screenshot({ path: `../roof-${info.project.name}-stairs.png` });
  // A rung click approaches the foot only; every later flight requires its own input.
  await page.evaluate(() => {
    (window as any).__roofClimb = [];
    const record = () => { const s = (window as any).royalDemo.getState(); (window as any).__roofClimb.push({ hall:s.hall, x:s.x, y:s.y }); if(s.hall==='street')requestAnimationFrame(record); };
    requestAnimationFrame(record);
  });
  const foot=projectStreetPoint(STREET_ROOF_STAIRS.foot,(await state(page)).street.view.orientation);
  const mobile=info.project.name==='mobile';
  if(!mobile){
    for(const side of [-1,1]){
      await walk(page,STREET_ROOF_STAIRS.foot.x+side*54,STREET_ROOF_STAIRS.foot.y-20);
      await keyUntil(page,side<0?'ArrowLeft':'ArrowRight',async()=>(await state(page)).stairStep===1);
      expect(Math.abs((await state(page)).x-STREET_ROOF_STAIRS.foot.x)).toBeLessThan(.1);
      await page.screenshot({path:`../roof-flex-${info.project.name}-side-${side}.png`});
      await keyUntil(page,'ArrowDown',async()=>(await state(page)).stairStep===0);
    }
    await walk(page,STREET_ROOF_STAIRS.foot.x-54,STREET_ROOF_STAIRS.foot.y-20);
    await keyUntil(page,'ArrowUp',async()=>(await state(page)).stairStep===1);
  }else{
    await walk(page,STREET_ROOF_STAIRS.foot.x+54,STREET_ROOF_STAIRS.foot.y-20);
    await clickViewPoint(page,{x:foot.x,y:foot.y-80});
  }
  await expect.poll(async () => (await state(page)).stairStep,{timeout:10000}).toBe(1);
  await page.waitForTimeout(400);expect((await state(page)).stairStep).toBe(1);
  await noGroundConversation(page);
  await flight(page,mobile);await flight(page,mobile);
  expect((await state(page)).stairStep).toBe(3);
  // Descend through a landing, leave safely and re-enter without aligning by hand.
  await keyUntil(page,'ArrowDown',async()=>(await state(page)).stairStep===0);
  await walk(page,STREET_ROOF_STAIRS.foot.x-45,STREET_ROOF_STAIRS.foot.y-22);
  await keyUntil(page,'ArrowUp',async()=>(await state(page)).stairStep===1);
  await flight(page,mobile);await flight(page,mobile);
  if(!mobile){
    await page.keyboard.down('ArrowRight');
    let walking=0,running=0,released=0;
    try{
      await expect.poll(async()=>(await state(page)).moving).toBe(true);
      walking=await stairSpeed(page);await page.keyboard.down('Shift');running=await stairSpeed(page);
      await page.keyboard.up('Shift');released=await stairSpeed(page);
    }finally{await page.keyboard.up('ArrowRight');await page.keyboard.up('Shift');}
    expect(running/walking).toBeGreaterThan(1.4);expect(running/walking).toBeLessThan(2.1);
    expect(released/walking).toBeGreaterThan(.8);expect(released/walking).toBeLessThan(1.2);
    console.log('Stair sprint speeds',JSON.stringify({walking,running,released}));
    const forward=await state(page);
    await page.keyboard.down('ArrowLeft');await page.waitForTimeout(180);await page.keyboard.up('ArrowLeft');
    expect((await state(page)).x).toBeGreaterThan(forward.x);
    expect((await state(page)).stairStep).toBe(3);
  }else{
    const view=new StreetView();view.side='rear';
    const here=view.point(await state(page),true),next=view.point(ROOF_STAIR_ROUTE[3],true);
    await clickViewPoint(page,{x:(here.x+next.x)/2,y:(here.y+next.y)/2-8});
    await page.waitForTimeout(450);const forward=await state(page);
    const now=view.point(forward,true),back=view.point(ROOF_STAIR_ROUTE[2],true);
    await clickViewPoint(page,{x:(now.x+back.x)/2,y:(now.y+back.y)/2-8});
    await page.waitForTimeout(160);
    const box=(await page.locator('#game canvas').boundingBox())!;await page.touchscreen.tap(box.x+18,box.y+box.height*.5);
    await expect.poll(async()=>(await state(page)).x).toBeGreaterThan(forward.x);
  }
  await staysOnStep(page);
  expect((await state(page)).stairDirection).toBe(-1);
  await noGroundConversation(page);
  await verifyRearWindows(page,info.project.name);
  expect((await state(page)).renderDepth).toBeGreaterThan(620);
  expect((await state(page)).street.frontRoadVisible).toBe(false);
  {const s=await state(page);expect(s.renderVisible).toBe(true);expect(Math.hypot(s.halo.x-s.renderX,s.halo.y-s.renderY)).toBeLessThan(.1);}
  await page.screenshot({path:`../roof-${info.project.name}-climb.png`});
  const prefix=await page.evaluate(()=>(window as any).__roofClimb as {hall:string;x:number;y:number}[]);
  await page.reload();
  await expect(page.locator('#chat-input')).toBeEnabled({timeout:25000});
  await expect.poll(async ()=>(await state(page)).hall).toBe('street');
  expect((await state(page)).stairStep).toBe(3);
  expect((await state(page)).stairDirection).toBe(-1);
  await staysOnStep(page);
  await noGroundConversation(page);
  await page.evaluate(()=>{
    (window as any).__roofClimb=[];
    const record=()=>{const s=(window as any).royalDemo.getState();(window as any).__roofClimb.push({hall:s.hall,x:s.x,y:s.y});if(s.hall==='street')requestAnimationFrame(record);};requestAnimationFrame(record);
  });
  while((await state(page)).hall==='street'){
    const s=await state(page);
    if(s.stairStep===ROOF_STAIR_ROUTE.length-1){
      // A nearby map position must not make a ground resident reachable from this height.
      await expect.poll(async()=>{
        const p=await state(page);return p.street.residents.people.some((npc:any)=>Math.hypot(npc.x-p.x,npc.y-p.y)<=112);
      },{timeout:20000}).toBe(true);
      await noGroundConversation(page);
      await page.screenshot({path:`../stair-npc-${info.project.name}.png`});
      const view=new StreetView();view.side='rear';
      expect(view.roofEdge).toBeGreaterThan(s.view.y);expect(view.roofEdge).toBeLessThan(s.view.y+s.view.height/s.view.zoom);
      await page.screenshot({path:`../roof-${info.project.name}-top.png`});
    }
    await flight(page,mobile,!mobile);
    if((await state(page)).hall==='street'){
      const paused=await state(page);await page.waitForTimeout(120);
      const still=await state(page);expect(still.stairStep).toBe(paused.stairStep);expect(Math.hypot(still.x-paused.x,still.y-paused.y)).toBeLessThan(.1);
      await noGroundConversation(page);
    }
  }
  const continuation = await page.evaluate(() => (window as any).__roofClimb as {hall:string;x:number;y:number}[]);
  const climb=[...prefix,...continuation];
  for(const waypoint of ROOF_STAIR_ROUTE.slice(1,-1))expect(climb.some(p=>p.hall==='street'&&Math.hypot(p.x-waypoint.x,p.y-waypoint.y)<10)).toBe(true);
  const bottom = climb.findIndex(p => p.hall==='street' && Math.abs(p.x-STREET_ROOF_STAIRS.foot.x)<5 && p.y>475);
  expect(bottom).toBeGreaterThan(-1);
  expect(climb.slice(bottom).some(p=>p.hall==='street'&&p.y<430)).toBe(true);
  await expect(page.locator('h1')).toContainText('Крыша казино');
  await expect(page.locator('#games-tab')).toBeHidden();
  await expect(page.locator('#chat-panel')).toBeVisible(); await expect(page.locator('#chat-input')).toBeEnabled();
  await expect(page.locator('#elevator-shortcut')).toBeHidden();
  const floors = await page.evaluate(() => (window as any).royalDemo.getElevator().floors);
  expect(floors).not.toContain('roof');
  expect((await state(page)).x).toBe(ROOF.spawn.x);
  await page.screenshot({ path: `../roof-${info.project.name}-arrival.png` });
  await overview(page, true);
  await page.screenshot({ path: `../roof-${info.project.name}-overview.png` });
  for (const p of ROOF.loop) await walk(page, p.x, p.y);
  await walk(page, 960, 1050); await overview(page, false);
  await page.screenshot({ path: `../roof-${info.project.name}-terrace.png` });
  const before = await state(page); await page.emulateMedia({reducedMotion:'reduce'}); await page.reload();
  await expect(page.locator('#chat-input')).toBeEnabled({timeout:25000});
  await expect.poll(async () => (await state(page)).online).toBe(true);
  await expect.poll(async () => (await state(page)).hall).toBe('roof');
  const recovered = await state(page); expect(recovered.reducedMotion).toBe(true);
  expect(Math.hypot(recovered.x - before.x, recovered.y - before.y)).toBeLessThan(5);
  expect((await page.evaluate(() => (window as any).royalDemo.getNetworkState())).roomId).toBe(network.roomId);
  await expect(page.locator('#chat-input')).toBeEnabled();
  await overview(page, true);
  await clickWorld(page, ROOF_STAIRS.click.x, ROOF_STAIRS.click.y);
  await expect.poll(async () => (await state(page)).hall, { timeout: 15000 }).toBe('street');
  await expect.poll(async()=>{const s=await state(page);return Math.hypot(s.x-ROOF_STAIR_RETURN.x,s.y-ROOF_STAIR_RETURN.y);}).toBeLessThan(.02);
  expect((await state(page)).stairStep).toBe(ROOF_STAIR_RETURN.stairStep);
  expect((await state(page)).stairDirection).toBe(-1);
  await overview(page,false);
  await page.waitForTimeout(300);
  expect((await state(page)).hall).toBe('street');
  expect((await state(page)).street.view.side).toBe('rear');
  await noGroundConversation(page);
  await verifyFrozenRearWindows(page);
  await page.screenshot({path:`../roof-${info.project.name}-return-top.png`});
  await page.reload();
  await expect(page.locator('#chat-input')).toBeEnabled({timeout:25000});
  await expect.poll(async()=>(await state(page)).online).toBe(true);
  expect((await state(page)).hall).toBe('street');
  expect((await state(page)).stairStep).toBe(ROOF_STAIR_RETURN.stairStep);
  expect((await state(page)).stairDirection).toBe(-1);
  await noGroundConversation(page);
  if(mobile){
    while((await state(page)).stairStep>0){
      const s=await state(page),step=s.stairStep,target=ROOF_STAIR_ROUTE[step-1];
      const view=new StreetView();view.side='rear';
      const a=view.point(s,true),b=view.point(target,true);
      await clickViewPoint(page,{x:(a.x+b.x)/2,y:(a.y+b.y)/2-8});
      await expect.poll(async()=>(await state(page)).stairStep,{timeout:10000}).toBeLessThan(step);
      await expect.poll(async()=>{const p=await state(page);return Math.hypot(p.serverX-p.x,p.serverY-p.y);}).toBeLessThan(.1);
    }
  }else{
    await page.keyboard.down('Shift');
    try{await keyUntil(page,'ArrowDown',async()=>(await state(page)).stairStep===0,30000);}
    finally{await page.keyboard.up('Shift');}
  }
  expect((await state(page)).hall).toBe('street');
  if(mobile)expect(Math.hypot((await state(page)).x-STREET_ROOF_STAIRS.foot.x,(await state(page)).y-STREET_ROOF_STAIRS.foot.y)).toBeLessThan(20);
  else{
    // A held key resumes ordinary pavement movement after leaving the lower ladder.
    expect(Math.abs((await state(page)).x-STREET_ROOF_STAIRS.foot.x)).toBeLessThan(.1);
    expect((await state(page)).y).toBeLessThan(STREET_ROOF_STAIRS.foot.y-7);
  }
  await overview(page,true);
  // The narrow strip is outside the normal rear circulation route.
  for (const p of [{ x: 1760, y: 470 }, { x: 2320, y: 360 }, { x: 2320, y: 1050 }]) await walk(page, p.x, p.y);
  const doorman=(await state(page)).street.residents.people.find((p:any)=>p.id==='doorman');
  await clickWorld(page,doorman.x,doorman.y-35);
  await expect.poll(async()=>(await state(page)).street.residents.conversation,{timeout:25000}).toBe('doorman');
  await expect(page.locator('.street-conversation')).toBeVisible();
  await page.screenshot({path:`../stair-npc-ground-${info.project.name}.png`});
  await page.locator('.street-conversation').getByRole('button',{name:'Закрыть',exact:true}).click();
  await page.locator('[data-floor-target="arcade"]').click();
  await expect.poll(async () => (await state(page)).hall, { timeout: 25000 }).toBe('arcade');
  await expect(page.locator('#wallet-balance')).toHaveText(balance!);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  expect(errors).toEqual([]);
});

import {test,expect,type Page} from '@playwright/test';
import {TOILET,ROOF_TOILET,TOILET_WINDOW,OCCUPIED_TOILET_CUBICLE,toiletCubicleStanding,toiletSinkApproaches} from '../src/shared/toilet';
import {projectStreetPoint} from '../src/game/streetView';
import {securityRoom} from './security-room';

const state=(page:Page)=>page.evaluate(()=>(window as any).royalDemo.getState());
async function overview(page:Page){const b=page.locator('#room-overview');if(await b.getAttribute('aria-pressed')!=='true')await b.click();}
async function clickWorld(page:Page,x:number,y:number){
  await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
  const s=await state(page),p=s.hall==='street'?projectStreetPoint({x,y},s.street.view.orientation):{x,y},b=(await page.locator('#game canvas').boundingBox())!;
  const sx=b.x+(p.x-s.view.x)*s.view.zoom*b.width/s.view.width,sy=b.y+(p.y-s.view.y)*s.view.zoom*b.height/s.view.height;
  expect(sx).toBeGreaterThanOrEqual(b.x);expect(sx).toBeLessThanOrEqual(b.x+b.width);expect(sy).toBeGreaterThanOrEqual(b.y);expect(sy).toBeLessThanOrEqual(b.y+b.height);
  if(page.viewportSize()!.width<600)await page.touchscreen.tap(sx,sy);else await page.mouse.click(sx,sy);
}
async function walk(page:Page,x:number,y:number){
  await clickWorld(page,x,y);const tolerance=Math.max(5,2/(await state(page)).view.zoom);
  await expect.poll(async()=>Math.hypot((await state(page)).x-x,(await state(page)).y-y),{timeout:25000}).toBeLessThan(tolerance);
  await expect.poll(async()=>{const s=await state(page);return Math.hypot(s.x-s.serverX,s.y-s.serverY);}).toBeLessThan(1);
}

test('occupied toilet visitor animates behind a locked door and leaves the other stalls and exit accessible',async({page,request,context},info)=>{
  test.setTimeout(150000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const host=await securityRoom(request);await context.clearCookies();
  try{
    await page.goto('/?room='+host.room.roomId);
    await page.getByLabel('Почта',{exact:true}).fill('toilet-browser-'+crypto.randomUUID()+'@example.test');
    await page.getByLabel('Пароль',{exact:true}).fill('Toilet-local-check-123!');
    await page.getByRole('button',{name:'Продолжить',exact:true}).click();
    await expect(page.locator('#character-step')).toBeVisible();await page.getByRole('button',{name:'Войти в зал',exact:true}).click();
    await expect(page.locator('#chat-input')).toBeEnabled({timeout:25000});
    await expect.poll(async()=>{const s=await state(page);return s.online&&!s.locked&&Number.isFinite(s.serverX);}).toBe(true);
    await expect(page.locator('#join-dialog')).toBeHidden();
    await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
    const balance=await page.locator('#wallet-balance').textContent();
    await page.locator('[data-floor-target="street"]').click();
    await expect.poll(async()=>(await state(page)).hall,{timeout:25000}).toBe('street');
    await overview(page);for(const p of [{x:480,y:1050},{x:480,y:360},{x:1660,y:360}])await walk(page,p.x,p.y);
    await page.locator('#room-overview').click();
    await page.keyboard.down('Shift');await page.keyboard.down('w');
    try{await expect.poll(async()=>(await state(page)).hall,{timeout:45000}).toBe('roof');}finally{await page.keyboard.up('w');await page.keyboard.up('Shift');}
    await expect.poll(async()=>(await state(page)).switching).toBe(false);await overview(page);
    await clickWorld(page,ROOF_TOILET.click.x,ROOF_TOILET.click.y);await expect.poll(async()=>(await state(page)).hall,{timeout:20000}).toBe('toilet');
    await expect.poll(async()=>(await state(page)).switching).toBe(false);await overview(page);
    await expect(page.locator('.npc-count')).toContainText('НПС: 1');
    expect((await state(page)).toilet.resident.artVersion).toBe(2);expect((await state(page)).toilet.resident.artLoaded).toBe(true);
    const p=TOILET.cubicles[OCCUPIED_TOILET_CUBICLE];await walk(page,p.x+50,430);
    await clickWorld(page,p.x+50,p.y+110);await page.waitForTimeout(500);
    expect((await state(page)).y).toBeGreaterThan(425);expect((await state(page)).toilet.openDoors[p.id]).toBe(false);
    for(const sprint of [false,true]){
      if(sprint)await page.keyboard.down('Shift');await page.keyboard.down('w');
      try{await page.waitForTimeout(1100);}finally{await page.keyboard.up('w');if(sprint)await page.keyboard.up('Shift');}
      const s=await state(page);expect(s.y).toBeGreaterThanOrEqual(p.y+p.h+12);expect(s.y).toBeLessThan(410);expect(s.toilet.openDoors[p.id]).toBe(false);
      expect(s.serverY).toBeGreaterThanOrEqual(p.y+p.h+12);
    }
    await walk(page,400,470);
    await expect.poll(async()=>(await state(page)).toilet.resident.stage,{timeout:14000,intervals:[80]}).toBe('take-paper');
    const reach=(await state(page)).toilet.resident;expect(reach.interactive).toBe(false);
    await expect.poll(async()=>(await state(page)).toilet.resident.behindShirt,{timeout:6000,intervals:[80]}).toBe(true);
    expect((await state(page)).toilet.resident.paper).toBe(true);
    await page.screenshot({path:info.outputPath('occupied-toilet.png')});
    await expect.poll(async()=>(await state(page)).toilet.resident.stage,{timeout:6000,intervals:[80]}).toBe('settle');
    for(const q of toiletCubicleStanding){await walk(page,q.x,q.y);expect((await state(page)).toilet.openDoors[q.id]).toBe(true);await walk(page,q.x,430);}
    for(const q of toiletSinkApproaches)await walk(page,q.x,q.y);
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.reload();await expect(page.locator('#chat-input')).toBeEnabled({timeout:25000});
    await expect.poll(async()=>{const s=await state(page);return s.hall==='toilet'&&s.online&&!s.locked&&Number.isFinite(s.serverX);}).toBe(true);await overview(page);
    await expect.poll(async()=>(await state(page)).toilet.resident.reducedMotion).toBe(true);
    const still=(await state(page)).toilet.resident;await page.waitForTimeout(300);expect((await state(page)).toilet.resident).toEqual(still);expect(still.stage).toBe('idle');
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.reload();await expect(page.locator('#chat-input')).toBeEnabled({timeout:25000});
    await expect.poll(async()=>{const s=await state(page);return s.hall==='toilet'&&s.online&&!s.locked&&Number.isFinite(s.serverX);}).toBe(true);await overview(page);
    await clickWorld(page,TOILET_WINDOW.click.x,TOILET_WINDOW.click.y);await expect.poll(async()=>(await state(page)).hall,{timeout:20000}).toBe('roof');
    await expect(page.locator('#chat-input')).toBeEnabled();await expect(page.locator('#wallet-balance')).toHaveText(balance!);expect(errors).toEqual([]);
  }catch(error){
    const s=await state(page);console.log('Toilet route failure',JSON.stringify({hall:s.hall,x:s.x,y:s.y,serverX:s.serverX,serverY:s.serverY,locked:s.locked,switching:s.switching,nav:s.stairNavigation,errors}));
    await page.screenshot({path:info.outputPath('route-diagnostic.png')});throw error;
  }finally{await page.goto('about:blank');await Promise.race([host.room.leave(),new Promise(r=>setTimeout(r,1500))]);}
});

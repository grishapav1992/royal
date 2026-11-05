import {test,expect,type Page} from '@playwright/test';
import {TOILET,ROOF_TOILET,TOILET_WINDOW,OCCUPIED_TOILET_CUBICLE,toiletCubicleStanding,toiletSinkApproaches} from '../../../src/shared/toilet';
import {projectStreetPoint} from '../../../src/game/streetView';
import {CASINO_EXIT} from '../../../src/shared/street';
import {securityRoom} from '../../../tests/security-room';

const state=(page:Page)=>page.evaluate(()=>(window as any).royalDemo.getState());
async function overview(page:Page){const b=page.locator('#room-overview');if(await b.getAttribute('aria-pressed')!=='true')await b.click();}
async function clickWorld(page:Page,x:number,y:number){
  await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
  await page.bringToFront();
  const s=await state(page),p=s.hall==='street'?projectStreetPoint({x,y},s.street.view.orientation):{x,y},b=(await page.locator('#game canvas').boundingBox())!;
  const sx=b.x+(p.x-s.view.x)*s.view.zoom*b.width/s.view.width,sy=b.y+(p.y-s.view.y)*s.view.zoom*b.height/s.view.height;
  expect(sx).toBeGreaterThanOrEqual(b.x);expect(sx).toBeLessThanOrEqual(b.x+b.width);expect(sy).toBeGreaterThanOrEqual(b.y);expect(sy).toBeLessThanOrEqual(b.y+b.height);
  if(s.hall==='arcade')console.log('Exit input',JSON.stringify({x:s.x,y:s.y,view:s.view,box:b,target:{x,y},screen:{sx,sy}}));
  await page.mouse.move(sx,sy,{steps:8});await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
  if(page.viewportSize()!.width<600)await page.touchscreen.tap(sx,sy);else await page.mouse.click(sx,sy);
  if(s.hall==='arcade'){await page.waitForTimeout(200);const a=await state(page);console.log('Exit result',JSON.stringify({x:a.x,y:a.y,nav:a.stairNavigation}));}
}
async function walk(page:Page,x:number,y:number){
  await clickWorld(page,x,y);const tolerance=Math.max(5,2/(await state(page)).view.zoom);
  await expect.poll(async()=>Math.hypot((await state(page)).x-x,(await state(page)).y-y),{timeout:25000}).toBeLessThan(tolerance);
  await expect.poll(async()=>{const s=await state(page);return Math.hypot(s.x-s.serverX,s.y-s.serverY);}).toBeLessThan(1);
}
async function cubicleImage(page:Page,path:string){
  const s=await state(page),b=(await page.locator('#game canvas').boundingBox())!,p=TOILET.cubicles[OCCUPIED_TOILET_CUBICLE];
  const sx=s.view.zoom*b.width/s.view.width,sy=s.view.zoom*b.height/s.view.height;
  await page.screenshot({path,clip:{x:b.x+(p.x-5-s.view.x)*sx,y:b.y+(p.y-5-s.view.y)*sy,width:(p.w+10)*sx,height:(p.h+10)*sy}});
}

test('occupied toilet visitor animates behind a locked door and leaves the other stalls and exit accessible',async({page,request,context},info)=>{
  test.setTimeout(150000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const host=await securityRoom(request);await context.clearCookies();
  try{
    const login=await page.request.post('/api/auth/login',{data:{email:'npc-release-'+crypto.randomUUID()+'@example.test',password:'Npc-release-local-123!'}});expect(login.ok()).toBe(true);
    const character=await page.request.post('/api/auth/character',{data:{skin:0}});expect(character.ok()).toBe(true);
    await page.goto('/?room='+host.room.roomId);
    await expect(page.locator('#chat-input')).toBeEnabled({timeout:25000});
    await expect.poll(async()=>{const s=await state(page);return s.online&&!s.locked&&Number.isFinite(s.serverX);}).toBe(true);
    await expect(page.locator('#join-dialog')).toBeHidden();
    await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
    const settings=page.getByRole('button',{name:'Настройки игрока',exact:true});
    if(!await settings.isVisible())await page.getByRole('button',{name:'Профиль и настройки',exact:true}).click();
    await settings.click();await expect(page.locator('#name-dialog')).toBeVisible();
    await page.locator('#recover-player').scrollIntoViewIfNeeded();await page.locator('#recover-player').click();
    await expect(page.locator('#name-dialog')).toBeHidden();
    await expect.poll(async()=>{const a=await state(page);return !a.locked&&Math.hypot(a.serverX-540,a.serverY-590)<210;}).toBe(true);
    await page.locator('#game').focus();await page.keyboard.down('ArrowRight');
    try{await expect.poll(async()=>(await state(page)).x,{timeout:6000}).toBeGreaterThan(580);}finally{await page.keyboard.up('ArrowRight');}
    await page.keyboard.down('ArrowDown');try{await expect.poll(async()=>(await state(page)).y,{timeout:6000}).toBeGreaterThan(730);}finally{await page.keyboard.up('ArrowDown');}
    const balance=await page.locator('#wallet-balance').textContent();
    await overview(page);await clickWorld(page,CASINO_EXIT.entry.x,CASINO_EXIT.entry.y);
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
    await cubicleImage(page,info.outputPath('resident-wiping.png'));
    await expect.poll(async()=>(await state(page)).toilet.resident.stage,{timeout:6000,intervals:[80]}).toBe('settle');
    for(const q of toiletCubicleStanding){await walk(page,q.x,q.y);expect((await state(page)).toilet.openDoors[q.id]).toBe(true);await walk(page,q.x,430);}
    for(const q of toiletSinkApproaches)await walk(page,q.x,q.y);
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.reload();await expect(page.locator('#chat-input')).toBeEnabled({timeout:25000});
    await expect.poll(async()=>{const s=await state(page);return s.hall==='toilet'&&s.online&&!s.locked&&Number.isFinite(s.serverX);}).toBe(true);await overview(page);
    await expect.poll(async()=>(await state(page)).toilet.resident.reducedMotion).toBe(true);
    const still=(await state(page)).toilet.resident;await page.waitForTimeout(300);expect((await state(page)).toilet.resident).toEqual(still);expect(still.stage).toBe('idle');
    await cubicleImage(page,info.outputPath('resident-resting.png'));
    if(info.project.name==='desktop'){
      const viewport=page.viewportSize()!;await page.setViewportSize({width:2400,height:1500});
      await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
      await cubicleImage(page,info.outputPath('resident-detail.png'));await page.setViewportSize(viewport);
    }
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.reload();await expect(page.locator('#chat-input')).toBeEnabled({timeout:25000});
    await expect.poll(async()=>{const s=await state(page);return s.hall==='toilet'&&s.online&&!s.locked&&Number.isFinite(s.serverX);}).toBe(true);await overview(page);
    await clickWorld(page,TOILET_WINDOW.click.x,TOILET_WINDOW.click.y);await expect.poll(async()=>(await state(page)).hall,{timeout:20000}).toBe('roof');
    await expect(page.locator('#chat-input')).toBeEnabled();await expect(page.locator('#wallet-balance')).toHaveText(balance!);expect(errors).toEqual([]);
  }catch(error){
    const s=await state(page);console.log('Toilet route failure',JSON.stringify({hall:s.hall,x:s.x,y:s.y,serverX:s.serverX,serverY:s.serverY,locked:s.locked,switching:s.switching,nav:s.stairNavigation,errors}));
    await page.screenshot({path:info.outputPath('route-diagnostic.png')});throw error;
  }finally{if(!page.isClosed())await page.goto('about:blank').catch(()=>{});await Promise.race([host.room.leave(),new Promise(r=>setTimeout(r,1500))]);}
});

import {test,expect,type Page} from '@playwright/test';
import {TOILET_HALL_DOOR,CARD_TOILET_DOOR,ROOF_TOILET,TOILET_WINDOW} from '../src/shared/toilet';
import {CASINO_EXIT} from '../src/shared/street';
import {projectStreetPoint} from '../src/game/streetView';
import {securityRoom} from './security-room';

const state=(page:Page)=>page.evaluate(()=>(window as any).royalDemo.getState());
async function overview(page:Page,on=true){const b=page.locator('#room-overview');if((await b.getAttribute('aria-pressed')==='true')!==on)await b.click();}
async function clickWorld(page:Page,x:number,y:number){
  await page.bringToFront();await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
  const s=await state(page),p=s.hall==='street'?projectStreetPoint({x,y},s.street.view.orientation):{x,y},b=(await page.locator('#game canvas').boundingBox())!;
  const sx=b.x+(p.x-s.view.x)*s.view.zoom*b.width/s.view.width,sy=b.y+(p.y-s.view.y)*s.view.zoom*b.height/s.view.height;
  expect(sx).toBeGreaterThanOrEqual(b.x);expect(sx).toBeLessThanOrEqual(b.x+b.width);expect(sy).toBeGreaterThanOrEqual(b.y);expect(sy).toBeLessThanOrEqual(b.y+b.height);
  await page.mouse.move(sx,sy,{steps:8});await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
  if(page.viewportSize()!.width<600)await page.touchscreen.tap(sx,sy);else await page.mouse.click(sx,sy);
}
async function walk(page:Page,x:number,y:number){
  await clickWorld(page,x,y);
  await expect.poll(async()=>{const s=await state(page);return Math.hypot(s.x-x,s.y-y);},{timeout:25000}).toBeLessThan(Math.max(5,2/(await state(page)).view.zoom));
  await expect.poll(async()=>{const s=await state(page);return Math.hypot(s.x-s.serverX,s.y-s.serverY);}).toBeLessThan(1);
}
async function hall(page:Page,value:string){await expect.poll(async()=>(await state(page)).hall,{timeout:25000}).toBe(value);await expect.poll(async()=>(await state(page)).switching).toBe(false);}

test('toilet door reaches floor three by walking and click, returns without bouncing and keeps the roof window',async({page,request,context},info)=>{
  test.setTimeout(200000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const host=await securityRoom(request);await context.clearCookies();
  try{
    expect((await page.request.post('/api/auth/login',{data:{email:'toilet-door-'+crypto.randomUUID()+'@example.test',password:'Toilet-door-local-123!'}})).ok()).toBe(true);
    expect((await page.request.post('/api/auth/character',{data:{skin:0}})).ok()).toBe(true);
    await page.goto('/?room='+host.room.roomId);await expect(page.locator('#chat-input')).toBeEnabled({timeout:25000});
    await expect.poll(async()=>{const s=await state(page);return s.online&&!s.locked&&Number.isFinite(s.serverX);}).toBe(true);
    const settings=page.getByRole('button',{name:'Настройки игрока',exact:true});if(!await settings.isVisible())await page.getByRole('button',{name:'Профиль и настройки',exact:true}).click();
    await settings.click();await page.locator('#recover-player').scrollIntoViewIfNeeded();await page.locator('#recover-player').click();await expect(page.locator('#name-dialog')).toBeHidden();
    await expect.poll(async()=>{const s=await state(page);return !s.locked&&!s.switching&&Math.hypot(s.serverX-540,s.serverY-590)<1;}).toBe(true);
    await page.bringToFront();await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
    await page.locator('#game').focus();await page.keyboard.down('ArrowRight');try{await expect.poll(async()=>(await state(page)).x,{timeout:6000}).toBeGreaterThan(580);}finally{await page.keyboard.up('ArrowRight');}
    await page.keyboard.down('ArrowDown');try{await expect.poll(async()=>(await state(page)).y,{timeout:6000}).toBeGreaterThan(730);}finally{await page.keyboard.up('ArrowDown');}
    const balance=await page.locator('#wallet-balance').textContent();
    await overview(page);await clickWorld(page,CASINO_EXIT.entry.x,CASINO_EXIT.entry.y);await hall(page,'street');await overview(page);
    for(const p of [{x:480,y:1050},{x:480,y:360},{x:1660,y:360}])await walk(page,p.x,p.y);
    await overview(page,false);await page.locator('#game').focus();await page.keyboard.down('Shift');await page.keyboard.down('w');
    try{await expect.poll(async()=>(await state(page)).hall,{timeout:45000}).toBe('roof');}finally{await page.keyboard.up('w');await page.keyboard.up('Shift');}
    await hall(page,'roof');await overview(page);await clickWorld(page,ROOF_TOILET.click.x,ROOF_TOILET.click.y);await hall(page,'toilet');await overview(page);
    await expect(page.locator('#floor-links [data-floor-target="roof"]')).toHaveCount(1);await expect(page.locator('#floor-links [data-floor-target="github"]')).toHaveCount(1);
    expect((await state(page)).toilet.resident.artLoaded).toBe(true);expect((await state(page)).toilet.openDoors[1]).toBe(false);
    await walk(page,TOILET_HALL_DOOR.arrival.x,TOILET_HALL_DOOR.arrival.y);await page.screenshot({path:info.outputPath('toilet-exit.png')});
    await page.locator('#game').focus();await page.keyboard.down('s');try{await hall(page,'github');await page.waitForTimeout(650);expect((await state(page)).hall).toBe('github');}finally{await page.keyboard.up('s');}
    await overview(page,false);await walk(page,CARD_TOILET_DOOR.arrival.x,CARD_TOILET_DOOR.arrival.y);await page.screenshot({path:info.outputPath('third-floor-door.png')});
    await clickWorld(page,CARD_TOILET_DOOR.click.x,CARD_TOILET_DOOR.click.y);await hall(page,'toilet');
    await page.locator('#game').focus();await page.keyboard.down('w');try{await page.waitForTimeout(650);expect((await state(page)).hall).toBe('toilet');}finally{await page.keyboard.up('w');}
    await overview(page);await clickWorld(page,TOILET_HALL_DOOR.click.x,TOILET_HALL_DOOR.click.y);await hall(page,'github');
    await page.locator('#game').focus();await page.keyboard.down('w');try{await hall(page,'toilet');await page.waitForTimeout(650);expect((await state(page)).hall).toBe('toilet');}finally{await page.keyboard.up('w');}
    await overview(page);await clickWorld(page,TOILET_WINDOW.click.x,TOILET_WINDOW.click.y);await hall(page,'roof');
    await expect(page.locator('#chat-input')).toBeEnabled();await expect(page.locator('#wallet-balance')).toHaveText(balance!);expect(errors).toEqual([]);
  }catch(error){
    const s=await state(page);console.log('Toilet doorway failure',JSON.stringify({hall:s.hall,x:s.x,y:s.y,serverX:s.serverX,serverY:s.serverY,locked:s.locked,switching:s.switching,nav:s.stairNavigation,errors}));
    await page.screenshot({path:info.outputPath('failure.png')});throw error;
  }finally{await page.goto('about:blank').catch(()=>{});await Promise.race([host.room.leave(),new Promise(r=>setTimeout(r,1500))]);}
});

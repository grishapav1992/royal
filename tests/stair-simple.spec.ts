import {test,expect,type Page} from '@playwright/test';
import {STAIR_WINDOW} from '../src/shared/stairWindow';
import {ROOF_WINDOW_PLATFORM,onRoofWindowPlatform,roofWindowPlatformOffset,roofWindowPlatformPosition} from '../src/shared/rooftop';
import {StreetView,projectStreetPoint} from '../src/game/streetView';
const state=(page:Page)=>page.evaluate(()=>(window as any).royalDemo.getState());
async function overview(page:Page,on:boolean){const b=page.locator('#room-overview');if((await b.getAttribute('aria-pressed')==='true')!==on)await b.click();}
async function clickPoint(page:Page,p:{x:number;y:number}){
  await page.bringToFront();await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
  const s=await state(page),b=(await page.locator('#game canvas').boundingBox())!;
  const x=b.x+(p.x-s.view.x)*s.view.zoom*b.width/s.view.width,y=b.y+(p.y-s.view.y)*s.view.zoom*b.height/s.view.height;
  expect(x).toBeGreaterThanOrEqual(b.x);expect(x).toBeLessThanOrEqual(b.x+b.width);expect(y).toBeGreaterThanOrEqual(b.y);expect(y).toBeLessThanOrEqual(b.y+b.height);await page.mouse.click(x,y);
}
async function walk(page:Page,x:number,y:number){
  const s=await state(page);await clickPoint(page,projectStreetPoint({x,y},s.street.view.orientation));
  await expect.poll(async()=>{const p=await state(page);return Math.hypot(p.x-x,p.y-y);},{timeout:20000}).toBeLessThan(Math.max(5,2/s.view.zoom));
}
async function keyUntil(page:Page,key:string,ready:()=>Promise<boolean>){
  await page.keyboard.down(key);try{await expect.poll(ready,{timeout:20000,intervals:[30,60,100]}).toBe(true);}finally{await page.keyboard.up(key);}
}
async function settled(page:Page,online:boolean){if(online)await expect.poll(async()=>{const s=await state(page);return Math.hypot(s.serverX-s.x,s.serverY-s.y);}).toBeLessThan(.1);}
for(const online of [false,true])test('simple stair movement and unlabelled window in '+(online?'connected':'solo')+' mode',async({page},info)=>{
  test.skip(info.project.name!=='desktop');test.setTimeout(180000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(online?'/':'/?offline=1');
  if(online){
    await page.getByLabel('Почта',{exact:true}).fill('stair-simple-'+crypto.randomUUID()+'@example.test');await page.getByLabel('Пароль',{exact:true}).fill('Stair-simple-browser-test!');
    await page.getByRole('button',{name:'Продолжить',exact:true}).click();await expect(page.locator('#character-step')).toBeVisible({timeout:15000});await page.getByRole('button',{name:'Войти в зал',exact:true}).click();
    await expect(page.locator('#chat-input')).toBeEnabled({timeout:25000});
  }
  await expect(page.locator('#game canvas')).toBeVisible();
  await page.locator('[data-floor-target="street"]').click();await expect.poll(async()=>(await state(page)).hall,{timeout:25000}).toBe('street');
  await overview(page,true);for(const p of [{x:480,y:1050},{x:480,y:360},{x:1660,y:360}])await walk(page,p.x,p.y);await overview(page,false);
  await keyUntil(page,'w',async()=>{const s=await state(page);return s.stairStep===6&&Math.hypot(s.x-STAIR_WINDOW.landing.x,s.y-STAIR_WINDOW.landing.y)>120;});
  await keyUntil(page,'d',async()=>roofWindowPlatformOffset(await state(page))>=ROOF_WINDOW_PLATFORM.length-.1);
  const edge=await state(page);expect(edge.y).toBe(STAIR_WINDOW.landing.y);expect(edge.street.landingControlsVisible).toBe(false);
  await page.keyboard.press('e');await page.waitForTimeout(200);expect((await state(page)).hall).toBe('street');
  await page.screenshot({path:'../stair-simple-'+(online?'online':'offline')+'-window.png'});
  await page.keyboard.down('w');
  try{await expect.poll(async()=>(await state(page)).hall,{timeout:10000}).toBe('github');await expect.poll(async()=>(await state(page)).switching).toBe(false);await page.waitForTimeout(350);expect((await state(page)).hall).toBe('github');}finally{await page.keyboard.up('w');}
  await page.keyboard.down('w');
  try{await expect.poll(async()=>(await state(page)).hall,{timeout:10000}).toBe('street');await expect.poll(async()=>(await state(page)).switching).toBe(false);await page.waitForTimeout(350);expect((await state(page)).hall).toBe('street');expect(onRoofWindowPlatform(await state(page))).toBe(true);}finally{await page.keyboard.up('w');}
  const view=new StreetView();view.side='rear';
  const toBalcony=async()=>{const p=view.point(roofWindowPlatformPosition(130),true);await clickPoint(page,{x:p.x,y:p.y+6});await expect.poll(async()=>{const s=await state(page);return onRoofWindowPlatform(s)&&Math.abs(roofWindowPlatformOffset(s)-130)<15;},{timeout:10000}).toBe(true).catch(async error=>{const s=await state(page);console.log('Balcony approach',JSON.stringify({online,x:s.x,y:s.y,step:s.stairStep,navigation:s.stairNavigation,view:s.view}));await page.screenshot({path:'../stair-simple-approach-diagnostic.png'});throw error;});};
  await keyUntil(page,'a',async()=>roofWindowPlatformOffset(await state(page))<.1);
  await page.keyboard.down('w');await expect.poll(async()=>(await state(page)).y<STAIR_WINDOW.landing.y-1).toBe(true);await toBalcony();await page.keyboard.up('w');
  await keyUntil(page,'a',async()=>roofWindowPlatformOffset(await state(page))<.1);
  await page.keyboard.down('s');await expect.poll(async()=>(await state(page)).y>STAIR_WINDOW.landing.y+1).toBe(true);await toBalcony();await page.keyboard.up('s');
  await keyUntil(page,'a',async()=>roofWindowPlatformOffset(await state(page))<.1);
  await keyUntil(page,'w',async()=>(await state(page)).stairStep>=8);
  await settled(page,online);const stopped=await state(page);await page.keyboard.press('d',{delay:250});await page.keyboard.press('a',{delay:250});await settled(page,online);
  expect(Math.hypot((await state(page)).x-stopped.x,(await state(page)).y-stopped.y)).toBeLessThan(.2);
  await keyUntil(page,'s',async()=>{const s=await state(page);return s.stairStep===7&&Math.hypot(s.x-STAIR_WINDOW.landing.x,s.y-STAIR_WINDOW.landing.y)>110;});
  await page.keyboard.down('s');await page.keyboard.down('Shift');
  try{await keyUntil(page,'d',async()=>onRoofWindowPlatform(await state(page))&&roofWindowPlatformOffset(await state(page))>200);}
  finally{await page.keyboard.up('s');await page.keyboard.up('Shift');}
  await keyUntil(page,'a',async()=>roofWindowPlatformOffset(await state(page))<.1);
  await page.screenshot({path:'../stair-simple-'+(online?'online':'offline')+'-return.png'});
  await keyUntil(page,'s',async()=>(await state(page)).stairStep===0);
  expect((await state(page)).hall).toBe('street');if(online)await expect(page.locator('#chat-input')).toBeEnabled();expect(errors).toEqual([]);
});

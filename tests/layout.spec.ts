import {test,expect} from '@playwright/test';
import {worldPoint} from './room-ui';
test('hall fills small screens, follows the player, offers overview and closes the games drawer on selection',async({browser})=>{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const page=await context.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto('/?offline=1');await page.locator('#loading').waitFor({state:'detached'});await expect(page.locator('.sidebar')).toBeHidden();
  const state=()=>page.evaluate(()=>(window as any).royalDemo.getState());
  const box=(await page.locator('#game canvas').boundingBox())!;expect(box.height).toBeGreaterThan(680);expect(box.width).toBeGreaterThan(375);expect((await state()).view.zoom).toBeGreaterThan(.9);
  const before=await state(),target=await worldPoint(page,690,590);await page.touchscreen.tap(target.x,target.y);await expect.poll(async()=>(await state()).x).toBeGreaterThan(675);expect((await state()).view.x).toBeGreaterThan(before.view.x+100);
  await page.locator('#room-overview').tap();await expect.poll(async()=>(await state()).view.overview).toBe(true);expect((await state()).view.zoom).toBeLessThan(.4);
  await page.screenshot({path:'artifacts/room-mobile-overview.png'});await page.locator('#room-overview').tap();await expect.poll(async()=>(await state()).view.zoom).toBeGreaterThan(.9);await page.screenshot({path:'artifacts/room-mobile-large.png'});
  await page.locator('#games-tab').tap();await expect(page.locator('.sidebar')).toBeVisible();await expect(page.locator('#games-tab')).toHaveAttribute('aria-expanded','true');await page.screenshot({path:'artifacts/room-mobile-games.png'});
  await page.getByRole('button',{name:'Подойти к автомату Night Drift',exact:true}).tap();await expect(page.locator('.sidebar')).toBeHidden();await expect(page.locator('#mini-dialog')).toBeVisible({timeout:15000});await page.getByRole('button',{name:'Вернуться в зал',exact:true}).tap();
  for(const [width,height] of [[844,390],[1366,768],[1920,1080]]){
   await page.setViewportSize({width,height});await expect.poll(async()=>Math.abs(width-(await state()).view.width)).toBeLessThan(30);
   const r=(await page.locator('#game canvas').boundingBox())!;expect(r.width).toBeGreaterThan(width-30);expect(r.height).toBeGreaterThan(height*.75);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight+1)).toBe(true);
   await page.screenshot({path:`artifacts/room-responsive-${width}.png`});
  }
  expect(errors).toEqual([]);
 }finally{await context.close();}
});

import{test,expect,type Page}from'@playwright/test';
import{projectStreetPoint}from'../../../src/game/streetView';
const state=(page:Page)=>page.evaluate(()=>(window as any).royalDemo.getState());
async function overview(page:Page,value:boolean){const b=page.locator('#room-overview');if((await b.getAttribute('aria-pressed')==='true')!==value)await b.click();}
async function clickWorld(page:Page,x:number,y:number){
 await page.bringToFront();await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
 const s=await state(page),p=s.hall==='street'?projectStreetPoint({x,y},s.street.view.orientation):{x,y},b=(await page.locator('#game canvas').boundingBox())!;
 const px=b.x+(p.x-s.view.x)*s.view.zoom*b.width/s.view.width,py=b.y+(p.y-s.view.y)*s.view.zoom*b.height/s.view.height;
 await page.mouse.move(px,py,{steps:5});await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
 if(page.viewportSize()!.width<600)await page.touchscreen.tap(px,py);else await page.mouse.click(px,py);
}
test('the near-wall exit exposes the street and supports ordinary walking and return',async({page},info)=>{
 test.setTimeout(60000);await page.goto('/?offline=1');await page.locator('#loading').waitFor({state:'detached'});
 await page.waitForFunction(()=>{try{return Number.isFinite((window as any).royalDemo.getState().x);}catch{return false;}});
 await overview(page,true);await clickWorld(page,180,1210);
 await expect.poll(async()=>{const s=await state(page);return Math.hypot(s.x-180,s.y-1210);},{timeout:20000}).toBeLessThan(4);
 await overview(page,false);await page.screenshot({path:info.outputPath('casino-exit-open.png')});
 await page.locator('#game').focus();await page.keyboard.down('s');try{await expect.poll(async()=>(await state(page)).hall).toBe('street');}finally{await page.keyboard.up('s');}
 await page.locator('#game').focus();await page.keyboard.down('w');try{await expect.poll(async()=>(await state(page)).hall,{timeout:12000}).toBe('arcade');}finally{await page.keyboard.up('w');}
 await overview(page,false);await page.screenshot({path:info.outputPath('casino-exit-return.png')});
});

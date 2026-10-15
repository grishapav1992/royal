import {HALL_DOORS} from '../src/shared/world';
import {expect, type Page} from '@playwright/test';
export async function worldPoint(page:Page,x:number,y:number){
 await page.bringToFront();
 await page.evaluate(()=>document.fonts.ready);
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 const box=(await page.locator('#game canvas').boundingBox())!;
 const {view}=await page.evaluate(()=>(window as any).royalDemo.getState());
 return {x:box.x+(x-view.x)*view.zoom*box.width/view.width,y:box.y+(y-view.y)*view.zoom*box.height/view.height};
}
export async function showChat(page:Page){await expect(page.locator('#chat-panel')).toBeVisible();}

export async function selectHall(page:Page,hall:'arcade'|'tables'){
 if(await page.evaluate(()=>(window as any).royalDemo.getState().hall)===hall)return;
 await page.bringToFront();
 const overview=await page.locator('#room-overview').getAttribute('aria-pressed')==='true';
 if(!overview)await page.locator('#room-overview').click();
 await page.evaluate(()=>{(window as any).__royalDoorView=undefined;});
 await page.waitForFunction(()=>{
  const key=JSON.stringify((window as any).royalDemo.getState().view),now=performance.now(),last=(window as any).__royalDoorView;
  if(!last||last.key!==key){(window as any).__royalDoorView={key,at:now};return false;}
  return now-last.at>=150;
 },undefined,{timeout:5000});
 const source=hall==='tables'?'arcade':'tables';
 const door=await worldPoint(page,HALL_DOORS[source].click.x,HALL_DOORS[source].click.y);await page.mouse.click(door.x,door.y);
 await expect.poll(()=>page.evaluate(()=>(window as any).royalDemo.getState().hall),{timeout:30000}).toBe(hall);
 if(!overview)await page.locator('#room-overview').click();
}

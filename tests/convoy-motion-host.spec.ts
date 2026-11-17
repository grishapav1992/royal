import {expect} from '@playwright/test';
import {test} from './themed-room';
import {enterGameHall,chooseGame} from './game-layout-host';
import {walletSnapshot} from './wallet-snapshot';

test('last-convoy: confirmed animation facade in the host with chat',async({page,roomPath})=>{
 await enterGameHall(page,roomPath);await chooseGame(page,'studio-last-convoy');
 const root=page.locator('[data-convoy-game]');
 await expect(root).toHaveAttribute('data-asset-state','ready',{timeout:40000});
 await page.locator('[data-cc-action="enter"]').click();
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 const fixture=await page.request.post('/__test/layout/bonus',{data:{gameId:'studio-last-convoy'}});
 expect(fixture.ok(),await fixture.text()).toBe(true);
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.locator('[data-cc-speed]').click();
 await root.evaluate(root=>{
  (window as any).convoyPhases=[];
  new MutationObserver(()=>{(window as any).convoyPhases.push((root as HTMLElement).dataset.phase);}).observe(root,{attributes:true,attributeFilter:['data-phase']});
 });
 const before=await walletSnapshot(page),previousTotal=await page.locator('[data-cc-total]').getAttribute('data-units');
 let release!:()=>void,requested=false;
 const gate=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/demo-wallet/expansion',async route=>{
  if(route.request().method()==='POST'){requested=true;await gate;}await route.continue();
 });
 const response=page.waitForResponse(response=>response.url().endsWith('/api/demo-wallet/expansion')&&response.request().method()==='POST');
 await page.locator('[data-cc-spin]').click();await expect.poll(()=>requested).toBe(true);
 await expect(root).not.toHaveAttribute('data-phase','idle');
 await expect(root).not.toHaveAttribute('data-revision',/\d/);
 expect(await page.locator('[data-cc-total]').getAttribute('data-units')).toBe(previousTotal);
 for(const [width,height]of [[1440,900],[393,852],[852,393]]){
  await page.setViewportSize({width,height});
  expect(await page.evaluate(()=>(window as any).royalDemo.getState().online)).toBe(true);
  if(width===1440)await expect(page.locator('#club-chat-dock')).toBeVisible();
  else await expect(page.locator('#mini-dialog .game-chat-toggle')).toBeVisible();
  await expect(page.locator('[data-cc-board]')).toBeInViewport();
 }
 release();const accepted=await response;expect(accepted.ok(),await accepted.text()).toBe(true);
 const {session}=await accepted.json();
 await expect(page.locator('[data-cc-action="bonus"]')).toBeVisible({timeout:30000});
 await page.unroute('**/api/demo-wallet/expansion');
 const grid=await root.locator('[data-cc-cell]').evaluateAll(cells=>cells.map(cell=>({position:Number((cell as HTMLElement).dataset.ccCell),symbol:Number((cell as HTMLElement).dataset.symbol)})).sort((a,b)=>a.position-b.position).map(cell=>cell.symbol));
 expect(grid).toEqual(session.view.convoy.spin.finalGrid);
 expect(await root.getAttribute('data-revision')).toBe(String(session.view.convoy.revision));
 const phases=await page.evaluate(()=>(window as any).convoyPhases as string[]);
 expect(phases).toContain('stopping');expect(phases).toContain('tickets');
 if(session.view.convoy.spin.frames.some((frame:any)=>frame.addedPins.length))expect(phases).toContain('energy');
 expect((await walletSnapshot(page)).entries.filter((entry:any)=>entry.kind==='bet').length).toBe(before.entries.filter((entry:any)=>entry.kind==='bet').length+1);
 await page.emulateMedia({reducedMotion:'reduce'});
 const next=page.waitForResponse(response=>response.url().endsWith('/api/demo-wallet/expansion')&&response.request().method()==='POST');
 await page.locator('[data-cc-action="bonus"]').click();expect((await next).ok()).toBe(true);
 await page.locator('[data-cc-pause]').click();
 expect((await walletSnapshot(page)).entries.filter((entry:any)=>entry.kind==='bet').length).toBe(before.entries.filter((entry:any)=>entry.kind==='bet').length+1);
 expect(errors).toEqual([]);
});

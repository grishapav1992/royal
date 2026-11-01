import {expect,type Page,type Frame} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {test} from './themed-room';
import {enterGameHall,chooseGame} from './game-layout-host';
const out=process.env.LAYOUT_ARTIFACTS_DIR||'artifacts/work/layout-release-20261101/browser';
const profiles:Record<string,[string,string,boolean?]>={
 'studio-caribbean-treasures':['.ct-board','.ct-play'],
 'studio-neopolis':['.np-board','.np-spin'],'royal-plinko':['.vp-board','[data-vp=drop]'],'flag-battle':['.fb-stage','.fb-play'],
 'studio-cosmic-escape':['.lg-board','.ce-spin'],'studio-velvet-reign':['.lg-board','.ce-spin'],
 'studio-caramel-carnival':['.cc-board','.cc-spin'],'studio-last-convoy':['.cc-board','.cc-spin'],
 'studio-nitro-run':['.cc-board','.cc-spin'],'studio-afterglow':['.cc-board','.cc-spin'],'studio-meme-overload':['.cc-board','.cc-spin'],
 'studio-dracona':['.board','.spin-button',true],'studio-forest-heart':['.fh-board','.fh-spin',true],'studio-flooded-temple':['.ft-reels','[data-ft=primary]',true],
 'royal-roulette':['.rr-wheel','[data-rr-spin]'],'github-crash':['.le-stage','[data-start]'],
 'original-cr-vs-leo':['.cl-stage','[data-shoot]'],'original-jackie-chan':['.jc-stage','[data-fight]'],
};
async function surface(page:Page,id:string):Promise<Page|Frame>{
 if(!profiles[id][2])return page;
 const handle=await page.locator('#mini-game iframe').elementHandle();return (await handle!.contentFrame())!;
}
async function fits(view:Page|Frame,selectors:string[]){
 await view.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 const errors=await view.evaluate(selectors=>{
  const errors:string[]=[];
  for(const selector of selectors){const e=document.querySelector<HTMLElement>(selector);if(!e||!e.getClientRects().length){errors.push(selector+': missing');continue;}
   const b=e.getBoundingClientRect();if(b.width<1||b.height<1||b.top< -1||b.left< -1||b.right>innerWidth+2||b.bottom>innerHeight+2)errors.push(selector+': outside viewport');
   for(let p=e.parentElement;p;p=p.parentElement){if(!/(hidden|clip|auto|scroll)/.test(getComputedStyle(p).overflow))continue;const r=p.getBoundingClientRect();if(b.top<r.top-2||b.left<r.left-2||b.right>r.right+2||b.bottom>r.bottom+2)errors.push(selector+': clipped by '+p.className);}
   if(e.matches('button')){const hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);if(!hit||!e.contains(hit))errors.push(selector+': obstructed');if(b.width<44||b.height<44)errors.push(selector+': below 44');}
  }return errors;
 },selectors);expect(errors).toEqual([]);
}
test('all 18 published games and connected chat on desktop and both phone orientations',async({page,roomPath})=>{
 await mkdir(out,{recursive:true});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await enterGameHall(page,roomPath);const rows=[];
 const sizes=process.env.LAYOUT_PUBLIC==='1'?[[1440,900],[393,852],[852,393]]:[[1440,900],[1280,720],[768,1024],[1024,768],[393,852],[852,393],[320,568],[568,320]];
 for(const id of Object.keys(profiles)){
  await page.setViewportSize({width:1440,height:900});await chooseGame(page,id);const view=await surface(page,id);
  const intro=view.locator('[data-cc-action=enter],[data-lg-dialog-action=enter],[data-vp=enter]');
  if(await intro.count()&&await intro.first().isVisible())await intro.first().click();
  for(const [width,height]of sizes){
   await page.setViewportSize({width,height});await test.step(id+' '+width+'x'+height,()=>fits(view,profiles[id].slice(0,2) as string[]));
   const dock=page.locator('#club-chat-dock'),toggle=page.locator('#mini-dialog .game-chat-toggle');
   const column=width>=1080&&height>=600;
   if(column){await expect(dock).toBeVisible();await expect(page.locator('#mini-dialog')).toHaveAttribute('data-game-chat','column');}
   else{await expect(dock).toBeHidden();await toggle.click();await expect(dock).toBeVisible();await expect(page.locator('#mini-dialog')).toHaveAttribute('data-game-chat','overlay');}
   await expect(dock.locator('#chat-input')).toBeEnabled();await dock.locator('#chat-input').fill('Проверка компоновки');
   await dock.locator('.game-chat-close').click();await expect(dock).toBeHidden();await expect(toggle).toBeFocused();
   await fits(view,profiles[id].slice(0,2) as string[]);
   if(column){await toggle.click();await expect(dock).toBeVisible();}
   if(profiles[id][2])await fits(page,['#mini-game iframe']);
   const stage=await page.locator('.mini-stage').evaluate(e=>({x:e.scrollWidth-e.clientWidth,y:e.scrollHeight-e.clientHeight}));expect(stage.x).toBeLessThanOrEqual(2);expect(stage.y).toBeLessThanOrEqual(2);
   rows.push({game:id,width,height,field:await view.locator(profiles[id][0]).boundingBox(),action:await view.locator(profiles[id][1]).boundingBox(),connectedChat:true});
   if(['studio-caribbean-treasures','royal-roulette'].includes(id)&&[1440,393,852].includes(width))await page.screenshot({path:out+'/'+id+'-'+width+'x'+height+'.png'});
  }
  await writeFile(out+'/measurements.json',JSON.stringify({public:process.env.LAYOUT_PUBLIC==='1',rows,errors},null,2));
 }
 expect(errors).toEqual([]);expect(rows).toHaveLength(18*sizes.length);
});

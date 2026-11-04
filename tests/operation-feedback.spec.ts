import {expect,type Page,type Frame,type Route} from '@playwright/test';
import {test} from './themed-room';
import {enterGameHall,chooseGame} from './game-layout-host';

const games:Record<string,[string,string?]>={
 'studio-cosmic-escape':['.ce-spin'],'studio-caramel-carnival':['.cc-spin'],
 'studio-velvet-reign':['.ce-spin'],'studio-last-convoy':['.cc-spin'],
 'studio-nitro-run':['.cc-spin'],'studio-afterglow':['.cc-spin'],'studio-meme-overload':['.cc-spin'],
 'studio-dracona':['#spin','.dracona-frame'],'studio-neopolis':['.np-spin'],
 'studio-forest-heart':['[data-fh=spin]','.forest-frame'],
 'studio-caribbean-treasures':['.ct-play'],'studio-flooded-temple':['[data-ft=primary]','.temple-frame'],
 'studio-wild-nudge':['[data-gn=spin]'],'flag-battle':['[data-fb=play]'],
 'royal-roulette':['[data-rr-spin]'],'royal-plinko':['[data-vp=drop]'],
 'original-cr-vs-leo':['[data-shoot]'],'original-jackie-chan':['[data-fight]'],'github-crash':['[data-start]'],
};
const recovery='[data-lg-retry],[data-cc-retry],[data-fh=retry],[data-fb=retry],[data-gn=retry],[data-ct-action=retry],[data-recovery]';
async function surface(p:Page,id:string):Promise<Page|Frame>{
 if(!games[id][1])return p;
 const iframe=p.locator('#mini-game iframe');await expect(iframe).toBeAttached();
 return (await(await iframe.elementHandle())!.contentFrame())!;
}
async function ready(p:Page,id:string){
 await chooseGame(p,id);const view=await surface(p,id);
 const entries=['[data-cc-action=enter]','[data-lg-dialog-action=enter]','[data-vp=enter]'];
 const intro=view.locator(entries.join(',')).filter({visible:true});
 const readyControls=view.locator([...entries.map(selector=>selector+':enabled'),games[id][0]+':enabled'].join(',')).filter({visible:true});
 await expect(readyControls.first()).toBeVisible({timeout:60000});
 if(await intro.count())await intro.first().click();
 await expect(view.locator(games[id][0])).toBeEnabled({timeout:60000});return view;
}
function requestFor(route:Route,id:string){
 if(route.request().method()!=='POST')return false;
 try{return route.request().postDataJSON()?.gameId===id;}catch{return false;}
}

test('all active house games keep normal requests separate from recovery',async({page,roomPath})=>{
 await enterGameHall(page,roomPath);
 for(const id of Object.keys(games))await test.step(id,async()=>{
  const view=await ready(page,id);let held:Route|undefined,release!:()=>void;
  if(id==='studio-dracona')await page.emulateMedia({reducedMotion:'no-preference'});
  const gate=new Promise<void>(r=>release=r);
  const handler=async(route:Route)=>{if(!held&&requestFor(route,id)){held=route;await gate;}await route.continue();};
  await page.route('**/api/*-wallet/**',handler);
  try{
   await view.locator(games[id][0]).click();await expect.poll(()=>!!held).toBe(true);
   await expect(view.locator(games[id][0])).toBeDisabled();
   expect(await view.locator(games[id][0]).innerText()).not.toMatch(/проверить|проверь|check (?:round|move|result)/i);
   await expect(view.locator(recovery).filter({visible:true})).toHaveCount(0);
   if(id==='studio-dracona')expect(await view.locator('.board').evaluate(e=>e.getAnimations({subtree:true}).filter(a=>a instanceof CSSAnimation&&a.animationName==='dracona-request-fall'&&a.playState==='running').length)).toBe(20);
  }finally{release();}
  await expect.poll(()=>page.evaluate(()=>{
   const h=(window as any)[Symbol.for('royal.game-host.v1')];return !h.expansionClient.busy&&!h.expansionClient.pending&&!h.demoWallet.busy&&!h.demoWallet.pending;
  }),{timeout:30000}).toBe(true);
  await page.unroute('**/api/*-wallet/**',handler);
  await page.emulateMedia({reducedMotion:'reduce'});
 });
});

for(const width of [1440,390])test(`Temple responds before the reply and restores the same operation at ${width}px`,async({page,roomPath})=>{
 await page.setViewportSize({width,height:width===390?844:1000});await enterGameHall(page,roomPath);
 const view=await ready(page,'studio-flooded-temple');await page.emulateMedia({reducedMotion:'no-preference'});
 let held:Route|undefined,release!:()=>void;const gate=new Promise<void>(r=>release=r),ids:string[]=[];
 const handler=async(route:Route)=>{
  if(requestFor(route,'studio-flooded-temple')&&route.request().postDataJSON().action==='start'){ids.push(route.request().postDataJSON().id);if(!held){held=route;await route.fetch();await gate;await route.abort('failed');return;}}
  await route.continue();
 };
 await page.route('**/api/*-wallet/expansion',handler);
 await view.locator('[data-ft=primary]').click();await expect.poll(()=>!!held).toBe(true);
 const root=view.locator('.ft-cascade');await expect(root).toHaveAttribute('data-requesting','true');
 await expect(view.locator('[data-ft=primary]')).toHaveText(/Вращение/);
 expect(await root.evaluate(e=>e.getAnimations({subtree:true}).filter(a=>a instanceof CSSAnimation&&a.animationName==='ft-request-fall'&&a.playState==='running').length)).toBe(15);
 await expect(view.locator('.ft-status')).toHaveAttribute('data-error','false');
 await page.emulateMedia({reducedMotion:'reduce'});
 expect(await root.evaluate(e=>e.getAnimations({subtree:true}).filter(a=>a instanceof CSSAnimation&&a.animationName==='ft-request-fall').length)).toBe(0);
 release();await expect(view.locator('[data-ft=primary]')).toHaveText('Проверить раунд');
 await expect(view.locator('[data-ft=primary]')).toBeEnabled();
 await page.locator('#studio-game-list').click();const reopened=await readyRecovery(page);
 await reopened.locator('[data-ft=primary]').click();await expect.poll(()=>ids.length).toBe(2);expect(ids[1]).toBe(ids[0]);
 await expect.poll(()=>page.evaluate(()=>{
  const h=(window as any)[Symbol.for('royal.game-host.v1')];return !h.expansionClient.pending&&!h.expansionClient.busy;
 }),{timeout:30000}).toBe(true);
 const debits=await page.evaluate(id=>(window as any)[Symbol.for('royal.game-host.v1')].demoWallet.wallet.entries.filter((e:any)=>e.kind==='bet'&&e.operationId===id).map((e:any)=>e.amount),ids[0]);
 expect(debits).toEqual([-.1]);
 await page.unroute('**/api/*-wallet/expansion',handler);
 await expect(page.locator('#mini-dialog .game-chat-toggle')).toBeVisible();
});
async function readyRecovery(page:Page){
 await page.locator('[data-platform-game=studio-flooded-temple]').click();const view=await surface(page,'studio-flooded-temple');
 await expect(view.locator('[data-ft=primary]')).toHaveText('Проверить раунд');await expect(view.locator('[data-ft=primary]')).toBeEnabled();return view;
}

import {expect,type Page} from '@playwright/test';
import {test} from './themed-room';
import {chooseGame} from './game-layout-host';
import {walletSnapshot} from './wallet-snapshot';
const game='studio-velvet-reign',out=process.env.VELVET_ARTIFACTS_DIR||'artifacts/work/velvet-dressing-room';
async function open(page:Page){
 await chooseGame(page,game);
 await expect(page.locator('[data-velvet-reign]')).toHaveAttribute('data-asset-state','ready');
 await page.locator('[data-lg-dialog-action=enter]').click();
}
async function enter(page:Page,path:string){
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto(path);
 await page.getByLabel('Почта',{exact:true}).fill(`velvet-${crypto.randomUUID()}@example.test`);
 await page.getByLabel('Пароль',{exact:true}).fill('Royal-layout-123!');await page.getByRole('button',{name:'Продолжить',exact:true}).click();
 await page.locator('[data-entry-mode=casino]').click();
 await expect(page.locator('#casino-catalog [data-platform-game="studio-velvet-reign"]')).toBeVisible({timeout:30000});
 expect((await page.request.post('/__test/layout/topup')).ok()).toBe(true);
 await page.evaluate(async()=>{const path='/src/wallet/WalletClient.ts';await(await import(/* @vite-ignore */path)).demoWallet.refresh();});
 await page.locator('#casino-catalog [data-platform-game="studio-velvet-reign"]').click();
 await expect(page.locator('[data-velvet-reign]')).toHaveAttribute('data-asset-state','ready');
 await page.locator('[data-lg-dialog-action=enter]').click();
}
async function geometry(page:Page,bonus=false){
 const selectors=['.lg-board','.vr-mirror','[data-lg-spin]','[data-stake-field]','.slot-settings-button','[data-vr-buy=spotlight]','[data-vr-buy=super-encore]','[data-vr-paid-mode=hyper]','.ce-money','[data-lg-speed]','[data-lg-auto]'];
 for(const selector of selectors){
  const el=page.locator('[data-velvet-reign] '+selector);await expect(el).toBeInViewport({ratio:1});
  if(!bonus&&(selector.includes('data-vr-buy')||selector.includes('data-lg-spin'))){
   const hit=await el.evaluate(el=>{const b=el.getBoundingClientRect(),hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return hit!==null&&el.contains(hit);});expect(hit,selector).toBe(true);
  }
 }
 const overlap=await page.locator('[data-velvet-reign]').evaluate(root=>{const a=root.querySelector('.vr-mode-switch')!.getBoundingClientRect(),b=root.querySelector('.ce-right-controls')!.getBoundingClientRect();return Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));});expect(overlap).toBe(0);
 expect(await page.locator('.mini-stage').evaluate(e=>e.scrollHeight-e.clientHeight)).toBeLessThanOrEqual(2);
}
async function finish(page:Page){
 await expect.poll(async()=>{
  const dialog=page.locator('[data-lg-dialog]');
  if(await dialog.isVisible()){
   const action=await dialog.getAttribute('data-dialog');
   if(action==='bonus'||action==='complete')await page.locator(`[data-lg-dialog-action=${action}]`).click();
   return false;
  }
  const state=await page.evaluate(async()=>{const path='/src/wallet/ExpansionClient.ts';return(await import(/* @vite-ignore */path)).expansionClient.sessions.find((s:any)=>s.gameId==='studio-velvet-reign')?.state;});
  if(state==='settled'&&await page.locator('[data-lg-spin]').isEnabled())return true;
  if(state==='active'&&await page.locator('[data-lg-pause]').isDisabled()&&await page.locator('[data-lg-spin]').isEnabled()){
   // A scheduled free spin can start between the readiness check and the click.
   try{await page.locator('[data-lg-spin]').click({timeout:1000});}catch(error){if(!(error instanceof Error)||error.name!=='TimeoutError')throw error;}
  }
  return false;
 },{timeout:90000,intervals:[100,250,500]}).toBe(true);
}
test('dressing room fits connected host and keeps a ten-cent round recoverable',async({page,roomPath})=>{
 test.setTimeout(180000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await enter(page,roomPath);
 await expect(page.locator('#mini-dialog')).toHaveAttribute('data-game-chat','column');
 for(const[width,height]of [[1440,900],[393,852],[852,393],[320,568],[568,320]]){
  await page.setViewportSize({width,height});await geometry(page);await page.screenshot({path:`${out}/velvet-${width}x${height}.png`});
 }
 await page.setViewportSize({width:393,height:852});await page.locator('.slot-settings-button').click();
 await page.locator('[data-lg-auto-count]').selectOption('25');await page.keyboard.press('Escape');
 await page.setViewportSize({width:1440,height:900});await expect(page.locator('[data-lg-auto-count]')).toHaveValue('25');
 await page.locator('[data-vr-paid-mode=hyper]').click();await expect(page.locator('[data-lg-cost]')).toContainText('1,00');
 await page.locator('[data-vr-paid-mode=normal]').click();await expect(page.locator('[data-lg-cost]')).toContainText('0,10');
 await page.locator('[data-vr-buy=super-encore]').click();await expect(page.locator('[data-lg-dialog]')).toHaveAttribute('data-dialog','buy');
 await expect(page.locator('.ce-confirm>strong')).toContainText('30,00');await page.keyboard.press('Escape');
 const before=await walletSnapshot(page);let lost=false;
 await page.route('**/api/demo-wallet/expansion',async route=>{
  if(route.request().method()==='POST'&&!lost){lost=true;expect(route.request().postDataJSON().stakeUnits).toBe('10');await route.fetch();await route.abort('failed');}else await route.continue();
 });
 await page.locator('[data-lg-spin]').click();await expect(page.locator('[data-lg-retry]')).toBeVisible();await open(page);
 if(await page.locator('[data-lg-retry]').isVisible())await page.locator('[data-lg-retry]').click();
 await page.unroute('**/api/demo-wallet/expansion');await finish(page);
 const after=await walletSnapshot(page);expect(after.entries.filter((e:any)=>e.kind==='bet')).toHaveLength(before.entries.filter((e:any)=>e.kind==='bet').length+1);
 await open(page);expect((await walletSnapshot(page)).entries).toEqual(after.entries);
 await page.locator('.slot-settings-button').click();await expect(page.locator('.slot-settings-dialog')).toBeVisible();
 await page.locator('[data-lg-history]').click();await expect(page.locator('[data-lg-dialog]')).toHaveAttribute('data-dialog','history');await page.keyboard.press('Escape');
 expect(errors).toEqual([]);
});
test('Spotlight keeps stars, free continuation and one debit across close and reopen',async({page,roomPath})=>{
 test.setTimeout(180000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await enter(page,roomPath);
 const seeded=await page.request.post('/__test/layout/bonus',{data:{gameId:game}});expect(seeded.ok(),await seeded.text()).toBe(true);
 await page.locator('[data-lg-spin]').click();await expect(page.locator('[data-lg-dialog-action=bonus]')).toBeVisible();
 await page.locator('[data-lg-dialog-action=bonus]').click();await expect(page.locator('[data-lg-pause]')).toBeEnabled();await page.locator('[data-lg-pause]').click();
 await expect(page.locator('[data-lg-spin]')).toBeEnabled();
 for(const[width,height]of [[393,852],[852,393],[568,320]]){
  await page.setViewportSize({width,height});await geometry(page,true);await expect(page.locator('[data-lg-remaining]')).toBeVisible();
  await page.screenshot({path:`${out}/velvet-bonus-${width}x${height}.png`});
 }
 const paid=await walletSnapshot(page);expect(paid.entries.filter((e:any)=>e.kind==='bet')).toHaveLength(1);
 await open(page);await finish(page);
 expect((await walletSnapshot(page)).entries.filter((e:any)=>e.kind==='bet')).toHaveLength(1);
 await open(page);await expect(page.locator('[data-lg-spin]')).toBeEnabled();expect((await walletSnapshot(page)).entries.filter((e:any)=>e.kind==='bet')).toHaveLength(1);
 expect(errors).toEqual([]);
});

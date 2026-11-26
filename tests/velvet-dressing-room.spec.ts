import { selectEntryMode } from './entry-mode';
import {expect,type Page} from '@playwright/test';
import {test} from './themed-room';
import {chooseGame} from './game-layout-host';
import {walletSnapshot} from './wallet-snapshot';
const game='studio-velvet-reign',out=process.env.VELVET_ARTIFACTS_DIR||'artifacts/work/velvet-dressing-room';
async function open(page:Page){
 if(await page.locator('#mini-dialog').isVisible())await chooseGame(page,game);
 else await page.locator('#casino-catalog [data-platform-game="studio-velvet-reign"]').click();
 await expect(page.locator('[data-velvet-reign]')).toHaveAttribute('data-asset-state','ready');
 await page.locator('[data-lg-dialog-action=enter]').click();
}
async function enter(page:Page,path:string){
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto(path);await selectEntryMode(page,'casino');
 await page.getByLabel('Почта',{exact:true}).fill(`velvet-${crypto.randomUUID()}@example.test`);
 await page.getByLabel('Пароль',{exact:true}).fill('Royal-layout-123!');await page.getByRole('button',{name:'Продолжить',exact:true}).click();
 await expect(page.locator('#casino-catalog [data-platform-game="studio-velvet-reign"]')).toBeVisible({timeout:30000});
 expect((await page.request.post('/__test/layout/topup')).ok()).toBe(true);
 await page.evaluate(async()=>{const path='/src/wallet/WalletClient.ts';await(await import(/* @vite-ignore */path)).demoWallet.refresh();});
 await page.locator('#casino-catalog [data-platform-game="studio-velvet-reign"]').click();
 await expect(page.locator('[data-velvet-reign]')).toHaveAttribute('data-asset-state','ready');
 await page.locator('[data-lg-dialog-action=enter]').click();
}
async function geometry(page:Page,bonus=false){
 const selectors=['.lg-board','.vr-host .vr-mirror','[data-lg-spin]','[data-stake-field]','.slot-settings-button','[data-vr-buy=spotlight]','[data-vr-buy=super-encore]','[data-vr-paid-mode=hyper]','.ce-money','[data-lg-speed]','[data-lg-auto]'];
 for(const selector of selectors){
  if(bonus&&['[data-vr-buy=spotlight]','[data-vr-buy=super-encore]','[data-vr-paid-mode=hyper]','[data-lg-speed]','[data-lg-auto]'].includes(selector))continue;
  if(bonus&&selector==='.vr-host .vr-mirror'&&await page.locator('.vr-host').isHidden())continue;
  const el=page.locator('[data-velvet-reign] '+selector);await expect(el).toBeInViewport({ratio:1});
  if(!bonus&&(selector.includes('data-vr-buy')||selector.includes('data-lg-spin'))){
   const hit=await el.evaluate(el=>{const b=el.getBoundingClientRect(),hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return hit!==null&&el.contains(hit);});expect(hit,selector).toBe(true);
  }
 }
 const overlap=await page.locator('[data-velvet-reign]').evaluate(root=>{const a=root.querySelector('.vr-mode-switch')!.getBoundingClientRect(),b=root.querySelector('.ce-right-controls')!.getBoundingClientRect();return Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));});if(!bonus)expect(overlap).toBe(0);
 const amount=await page.locator('[data-manual-stake]').evaluate(e=>({width:e.clientWidth,content:e.scrollWidth}));expect(amount.width).toBeGreaterThanOrEqual(amount.content);
 const consoleOverflow=await page.locator('.ce-console').evaluate(e=>e.scrollWidth-e.clientWidth);expect(consoleOverflow).toBeLessThanOrEqual(2);
 const title=await page.locator('.ce-wordmark').evaluate(e=>e.scrollWidth-e.clientWidth);expect(title).toBeLessThanOrEqual(2);
 expect(await page.locator('.mini-stage').evaluate(e=>e.scrollHeight-e.clientHeight)).toBeLessThanOrEqual(2);
}
async function finish(page:Page){
 await expect.poll(async()=>{
  const dialog=page.locator('[data-lg-dialog]');
  if(await dialog.isVisible()){
   const action=await dialog.getAttribute('data-dialog');
   if(action==='bonus'||action==='complete'||action==='star')await page.locator(`[data-lg-dialog-action=${action}]`).click();
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
 for(const[width,height]of [[1440,900],[1024,768],[768,1024],[700,900],[393,852],[852,393],[320,568],[568,320]]){
  await page.setViewportSize({width,height});await geometry(page);
  if(width===1440){await expect(page.locator('#mini-dialog')).toHaveAttribute('data-game-chat','column');await expect(page.locator('#club-chat-dock')).toBeVisible();}
  if(width===393||width===768){await page.locator('#mini-dialog .game-chat-toggle').click();await expect(page.locator('#chat-input')).toBeVisible();await page.locator('#chat-input').focus();await page.keyboard.press('Escape');await expect(page.locator('#chat-input')).toBeHidden();await geometry(page);}
  await page.screenshot({path:`${out}/velvet-${width}x${height}.png`});
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
 for(const[width,height]of [[1440,900],[1024,768],[768,1024],[700,900],[393,852],[852,393],[320,568],[568,320]]){
  await page.setViewportSize({width,height});await geometry(page,true);await expect(page.locator('[data-lg-remaining]')).toBeVisible();
  await page.screenshot({path:`${out}/velvet-bonus-${width}x${height}.png`});
 }
 const paid=await walletSnapshot(page);expect(paid.entries.filter((e:any)=>e.kind==='bet')).toHaveLength(1);
 await open(page);await finish(page);
 expect((await walletSnapshot(page)).entries.filter((e:any)=>e.kind==='bet')).toHaveLength(1);
 await open(page);await expect(page.locator('[data-lg-spin]')).toBeEnabled();expect((await walletSnapshot(page)).entries.filter((e:any)=>e.kind==='bet')).toHaveLength(1);
 expect(errors).toEqual([]);
});
// Instrument only the test response, keeping the actual host, package and backend intact.
async function exposeVelvet(page:Page){
 await page.route('**/game-modules/studio-velvet-reign/**/entry-*.js*',async route=>{
  if(route.request().url().includes('visual-original'))return route.continue();
  const original=process.env.VELVET_SOURCE==='1'?'/games/velvet-reign/entry.ts':route.request().url()+'?visual-original=1';
  await route.fulfill({contentType:'text/javascript',body:`import * as original from ${JSON.stringify(original)};export const {gameId,apiVersion,rulesVersion,progressVersion}=original;export function mount(...args){const router=original.mount(...args);window.__velvetTestRouter=router;return router;}`});
 });
}
async function ui(page:Page,method:string,arg?:unknown){return page.evaluate(({method,arg})=>{const instance=(window as any).__velvetTestRouter.child;return instance[method](arg);},{method,arg});}
const sizes=[[1440,900],[1024,768],[768,1024],[700,900],[393,852],[852,393],[320,568],[568,320]];
async function dialogFits(page:Page){
 const dialog=page.locator('[data-lg-dialog]');await expect(dialog).toBeVisible();
 expect(await dialog.evaluate(e=>e.scrollWidth-e.clientWidth)).toBeLessThanOrEqual(2);
 const actions=dialog.locator('button[data-lg-dialog-action]');
 for(const action of await actions.all()){await action.scrollIntoViewIfNeeded();await expect(action).toBeInViewport({ratio:.98});expect(await action.evaluate(el=>{const b=el.getBoundingClientRect(),hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return !!hit&&el.contains(hit);})).toBe(true);}
 await dialog.evaluate(e=>e.scrollTop=0);
}
test('all dressing-room windows and confirmed star arrival fit desktop, tablet and phones',async({page,roomPath})=>{
 test.setTimeout(240000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await exposeVelvet(page);await enter(page,roomPath);
 for(const[width,height]of sizes){
  await page.setViewportSize({width,height});
  for(const kind of ['intro','info','history','buy']){
   if(kind==='buy')await page.locator('[data-vr-buy=spotlight]').click();else await ui(page,'openDialog',kind);
   await dialogFits(page);await page.screenshot({path:`${out}/${kind}-${width}x${height}.png`});await ui(page,'closeDialog');
  }
  await page.locator('.slot-settings-button').click();const settings=page.locator('.slot-settings-dialog');await expect(settings).toBeVisible();
  expect(await settings.evaluate(e=>e.scrollWidth-e.clientWidth)).toBeLessThanOrEqual(2);
  for(const action of await settings.locator('button').all()){await action.scrollIntoViewIfNeeded();await expect(action).toBeInViewport({ratio:.98});}
  await settings.evaluate(e=>e.scrollTop=0);
  await page.screenshot({path:`${out}/settings-${width}x${height}.png`});await page.keyboard.press('Escape');
  // Presentation fixture only: exercise symbol, line, WILD factor and amount without a wallet request.
  await ui(page,'renderWins',{wins:[{line:0,symbol:0,positions:[0,1,2],factor:3,payoutUnits:'9'}]});await ui(page,'setTotal',9);
  await expect(page.locator('.vr-line-win')).toContainText('Линия 1');await expect(page.locator('.vr-line-win')).toContainText('WILD ×3');await expect(page.locator('.vr-line-win')).toContainText('0,09');await expect(page.locator('.vr-line-win .lg-symbol')).toBeVisible();
  expect(await page.locator('.vr-line-win').evaluate(e=>{const b=e.getBoundingClientRect(),p=e.closest('.ce-results')!.getBoundingClientRect();return b.top>=p.top&&b.bottom<=p.bottom;})).toBe(true);
  await ui(page,'renderWins');await ui(page,'setTotal',0);
 }
 await page.setViewportSize({width:1440,height:900});await page.emulateMedia({reducedMotion:'no-preference'});
 const seeded=await page.request.post('/__test/layout/bonus',{data:{gameId:game}});expect(seeded.ok()).toBe(true);
 await page.locator('[data-lg-spin]').click();await expect(page.locator('[data-lg-dialog]')).toHaveAttribute('data-dialog','bonus');
 for(const[width,height]of sizes){await page.setViewportSize({width,height});await dialogFits(page);await page.screenshot({path:`${out}/bonus-intro-${width}x${height}.png`});}
 await page.locator('[data-lg-dialog-action=bonus]').click();
 await expect(page.locator('[data-lg-dialog][data-dialog=star]')).toBeVisible({timeout:60000});
 const confirmed=await page.evaluate(async()=>{const path='/src/wallet/ExpansionClient.ts';return(await import(/* @vite-ignore */path)).expansionClient.sessions.find((s:any)=>s.gameId==='studio-velvet-reign')!.view.luelon.spin!;});
 const newest=confirmed.featuresAfter.wilds.at(-1)!;await expect(page.locator('.vr-reveal-awards')).toContainText(`WILD ×${newest.factor}`);await expect(page.locator('.vr-reveal-awards')).toContainText(`+${confirmed.triggerAwards}`);
 for(const[width,height]of sizes){await page.setViewportSize({width,height});await dialogFits(page);await page.screenshot({path:`${out}/star-${width}x${height}.png`});}
 const backdrop=page.locator('[data-lg-dialog-backdrop]');await backdrop.evaluate(e=>e.style.visibility='hidden');
 for(const[width,height]of sizes){
  await page.setViewportSize({width,height});await geometry(page,true);await expect(page.locator('[data-vr-roster]>span')).toHaveCount(5);await expect(page.locator('[data-vr-gem-slots]>span')).toHaveCount(3);
  if(await page.locator('.vr-host').isVisible())await expect(page.locator('[data-vr-mirror-factor]')).toContainText(`WILD ×${newest.factor}`);
  const details=page.locator('.vr-line-win');if(await details.count()){
   await expect(details.first()).toBeVisible();expect(await details.first().evaluate(e=>{const b=e.getBoundingClientRect(),p=e.closest('.ce-results')!.getBoundingClientRect();return b.top>=p.top&&b.bottom<=p.bottom;})).toBe(true);
  }
  await page.screenshot({path:`${out}/confirmed-hud-${width}x${height}.png`});
 }
 await backdrop.evaluate(e=>e.style.visibility='');
 // Closing the game while presentation is waiting must settle its promise and retain the accepted round.
 await page.locator('#studio-game-list').click();await open(page);await page.emulateMedia({reducedMotion:'reduce'});await finish(page);
 expect((await walletSnapshot(page)).entries.filter((e:any)=>e.kind==='bet')).toHaveLength(1);
 await ui(page,'openDialog','complete');
 for(const[width,height]of sizes){await page.setViewportSize({width,height});await dialogFits(page);await page.screenshot({path:`${out}/complete-${width}x${height}.png`});}
 await ui(page,'closeDialog');expect(errors).toEqual([]);
});
test('Super Encore and populated history use the same complete responsive cabinet',async({page,roomPath})=>{
 test.setTimeout(180000);await exposeVelvet(page);await enter(page,roomPath);
 await page.locator('[data-vr-buy=super-encore]').click();await expect(page.locator('.ce-confirm>strong')).toContainText('30,00');
 await page.locator('[data-lg-dialog-action=buy]').click();await expect(page.locator('[data-lg-dialog]')).toHaveAttribute('data-dialog','bonus');
 // Inspect the already accepted entry before requesting its first free continuation.
 await ui(page,'closeDialog');
 for(const[width,height]of sizes){
  await page.setViewportSize({width,height});await geometry(page,true);await expect(page.locator('[data-vr-title]')).toHaveText('SUPER ENCORE');await expect(page.locator('[data-vr-mirror-factor]')).toContainText('WILD');
  await page.screenshot({path:`${out}/super-encore-${width}x${height}.png`});
 }
 await finish(page);expect((await walletSnapshot(page)).entries.filter((e:any)=>e.kind==='bet')).toHaveLength(1);
 await ui(page,'openDialog','history');await expect(page.locator('.lg-round-ledger')).toBeVisible();
 for(const[width,height]of sizes){await page.setViewportSize({width,height});await dialogFits(page);await page.screenshot({path:`${out}/history-populated-${width}x${height}.png`});}
 await ui(page,'closeDialog');
});
test('reel frame keeps its place for wins, notices and the bonus',async({page,roomPath})=>{
 test.setTimeout(240000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await exposeVelvet(page);await enter(page,roomPath);
 const all=[[1920,1080],[1366,768],[1280,720],[430,932],[375,667],...sizes];
 // Presentation fixture: set a text state and read the layout in one task, so a background wallet refresh cannot interleave.
 const measure=(name:string)=>page.evaluate(name=>{
  const u=(window as any).__velvetTestRouter.child,retry=u.root.querySelector('[data-lg-retry]'),help=u.find('[data-velvet-wallet-help]');
  if(name!=='keep'){
   u.error='';u.controls();retry.hidden=true;help.hidden=true;u.renderWins();
   u.find('[data-lg-message]').textContent=name==='long'?'НОВАЯ ЗВЕЗДА · +2 ВРАЩЕНИЯ · ВЫХОД СО СЛЕДУЮЩЕГО СПИНА ПОСЛЕ ДЛИННОГО СООБЩЕНИЯ':'';u.setTotal(name==='long'?123456789:0);
   if(name==='one'||name==='many')u.renderWins({wins:Array.from({length:name==='one'?1:8},(_,line)=>({line,symbol:0,positions:[0,1,2],factor:4,payoutUnits:'12345'}))});
   if(name==='status')u.find('[data-lg-status]').textContent='Автовращений осталось: 25';
   if(name==='error'||name==='retry'){u.error='Связь прервалась. Проверьте прежний ход, прежде чем продолжать.';u.controls();retry.hidden=name!=='retry';}
   if(name==='help')help.hidden=false;
  }
  const box=(selector:string)=>u.root.querySelector(selector).getBoundingClientRect();
  const target=({error:'[data-lg-error]',retry:'[data-lg-retry]',help:'[data-velvet-wallet]',long:'[data-lg-total]'} as Record<string,string>)[name];
  let onTop=true;
  if(target){const el=u.root.querySelector(target),b=el.getBoundingClientRect(),r=u.root.getBoundingClientRect(),hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);onTop=b.width>0&&b.left>=r.left-1&&b.right<=r.right+1&&b.top>=r.top-1&&b.bottom<=r.bottom+1&&!!hit&&el.contains(hit);}
  return {onTop,place:['.ce-metal-frame','.ce-results','[data-lg-spin]'].map(selector=>{const b=box(selector);return [b.x,b.y,b.width,b.height].map(Math.round).join(',');}).join(' | ')};
 },name);
 const base=new Map<string,string>();
 for(const[width,height]of all){
  await page.setViewportSize({width,height});await measure('empty');await geometry(page);await page.waitForTimeout(350);
  const frame=(await page.locator('.ce-metal-frame').boundingBox())!,start=(await measure('empty')).place;base.set(width+'x'+height,start);
  expect(frame.width,'field width at '+width+'x'+height).toBeGreaterThan(Math.min(width,height)*.45);
  for(const name of ['one','many','long','status','error','retry','help']){
   expect(await measure(name),name+' at '+width+'x'+height).toEqual({onTop:true,place:start});
  }
  await measure('empty');
 }
 await page.setViewportSize({width:1440,height:900});await page.emulateMedia({reducedMotion:'no-preference'});
 const seeded=await page.request.post('/__test/layout/bonus',{data:{gameId:game}});expect(seeded.ok()).toBe(true);
 await page.evaluate(()=>{const w=window as any,seen=w.__velvetFrames=new Set<string>(),read=()=>{const b=document.querySelector('[data-velvet-reign] .ce-metal-frame')?.getBoundingClientRect();if(b)seen.add([b.x,b.y,b.width,b.height].map(Math.round).join(','));requestAnimationFrame(read);};read();});
 await page.locator('[data-lg-spin]').click();await expect(page.locator('[data-lg-dialog-action=bonus]')).toBeVisible({timeout:60000});await page.locator('[data-lg-dialog-action=bonus]').click();
 await expect.poll(()=>page.evaluate(()=>(window as any).__velvetTestRouter.child.session()?.view.luelon.bonus?.played??0),{timeout:60000}).toBeGreaterThan(0);
 await expect(page.locator('[data-lg-pause]')).toBeEnabled({timeout:60000});await page.locator('[data-lg-pause]').click();
 await expect(page.locator('[data-lg-spin]')).toBeEnabled({timeout:60000});
 expect(await page.evaluate(()=>[...(window as any).__velvetFrames])).toHaveLength(1);
 for(const[width,height]of all){await page.setViewportSize({width,height});await geometry(page,true);await expect.poll(async()=>(await measure('keep')).place,{message:'bonus at '+width+'x'+height,timeout:3000}).toBe(base.get(width+'x'+height));}
 await page.emulateMedia({reducedMotion:'reduce'});await finish(page);
 expect((await walletSnapshot(page)).entries.filter((e:any)=>e.kind==='bet')).toHaveLength(1);expect(errors).toEqual([]);
});

test('the cabaret recording follows the cabinet music controls', async ({page, roomPath}) => {
  await page.addInitScript(() => {
    const connect = AudioContext.prototype.createMediaElementSource;
    AudioContext.prototype.createMediaElementSource = function (audio) {
      const source = connect.call(this, audio);
      if (audio.src.endsWith('/backbay-lounge.mp3')) {
        const meter = this.createAnalyser();
        source.connect(meter);
        Object.assign(window, {velvetTrack: audio, velvetMeter: meter});
      }
      return source;
    };
  });
  await enter(page, roomPath);
  const track = await page.waitForFunction(() => (window as Window & {velvetTrack?: HTMLAudioElement}).velvetTrack);
  const playing = () => track.evaluate(audio => !audio.paused && audio.currentTime > 0);
  await expect.poll(playing).toBe(true);
  expect(await track.evaluate(audio => new URL(audio.currentSrc).pathname)).toMatch(/\/game-modules\/studio-velvet-reign\/.+\/backbay-lounge\.mp3$/);
  await expect.poll(() => page.evaluate(() => {
    const meter = (window as Window & {velvetMeter: AnalyserNode}).velvetMeter;
    const data = new Float32Array(meter.fftSize);
    meter.getFloatTimeDomainData(data);
    return data.some(sample => Math.abs(sample) > 0.001);
  })).toBe(true);
  expect(await track.evaluate(audio => audio.loop)).toBe(true);
  await track.evaluate(audio => { audio.currentTime = audio.duration - 0.4; });
  await expect.poll(() => track.evaluate(audio => audio.currentTime)).toBeLessThan(3);

  await page.locator('.slot-settings-button').click();
  const music = page.locator('[data-lg-music]');
  await music.click();
  await expect(music).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => track.evaluate(audio => audio.paused)).toBe(true);
  const position = await track.evaluate(audio => audio.currentTime);
  await music.click();
  await expect.poll(playing).toBe(true);
  expect(await track.evaluate(audio => audio.currentTime)).toBeGreaterThanOrEqual(position);
  const volume = page.locator('[data-lg-volume]');
  await volume.press('Home');
  await expect.poll(() => track.evaluate(audio => audio.paused)).toBe(true);
  await volume.press('End');
  await expect.poll(playing).toBe(true);
  await page.keyboard.press('Escape');
  await page.locator('[data-lg-sound]').click();
  await expect.poll(() => track.evaluate(audio => audio.paused)).toBe(true);
  await page.locator('[data-lg-sound]').click();
  await expect.poll(playing).toBe(true);

  // Simulate the browser visibility event even on headless devices with one active page.
  const visibility = (hidden: boolean) => page.evaluate(hidden => {
    Object.defineProperty(document, 'hidden', {configurable: true, value: hidden});
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
  await visibility(true);
  await expect.poll(() => track.evaluate(audio => audio.paused)).toBe(true);
  await visibility(false);
  await expect.poll(playing).toBe(true);

  await page.locator('[data-lg-spin]').click();
  await expect.poll(async () => (await walletSnapshot(page)).entries.filter((e: {kind: string}) => e.kind === 'bet').length).toBe(1);
  await expect.poll(playing).toBe(true);
  await finish(page);
  await page.locator('.slot-settings-button').click();
  await music.click();
  await page.keyboard.press('Escape');
  await page.locator('#studio-game-list').click();
  await expect.poll(() => track.evaluate(audio => audio.paused && !audio.hasAttribute('src'))).toBe(true);
  await open(page);
  await page.locator('.slot-settings-button').click();
  await expect(music).toHaveAttribute('aria-pressed', 'false');
  expect(await track.evaluate(old => (window as Window & {velvetTrack?: HTMLAudioElement}).velvetTrack === old)).toBe(true);
  await music.click();
  await expect.poll(() => track.evaluate(old => {
    const current = (window as Window & {velvetTrack?: HTMLAudioElement}).velvetTrack;
    return current !== old && !!current && !current.paused && current.currentTime > 0;
  })).toBe(true);
});

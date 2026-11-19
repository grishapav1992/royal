import {expect,type Page} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {test} from './themed-room';
import {enterGameHall,chooseGame} from './game-layout-host';
import {walletSnapshot} from './wallet-snapshot';

const out=process.env.LAYOUT_ARTIFACTS_DIR||'artifacts/work/game-layout-slots';
const games=['studio-cosmic-escape','studio-velvet-reign','studio-caramel-carnival','studio-last-convoy','studio-nitro-run','studio-afterglow','studio-meme-overload'];
const family=(id:string)=>id==='studio-cosmic-escape'||id==='studio-velvet-reign'?'lg':'cc';
async function open(page:Page,id:string){
 await chooseGame(page,id);const prefix=family(id);
 await expect(page.locator('#mini-game>:is(.cc-game,.ce-game)')).toHaveAttribute('data-asset-state','ready',{timeout:40000});
 const intro=page.locator(`[data-${prefix}-${prefix==='lg'?'dialog-action':'action'}="enter"]`);
 if(await intro.isVisible())await intro.click();
 await expect(page.locator('.cc-dialog-backdrop,.ce-dialog-backdrop')).toBeHidden();
}
test('measure the seven active slots in their connected host',async({page,roomPath})=>{
 test.setTimeout(300000);await mkdir(out,{recursive:true});await enterGameHall(page,roomPath);
 const rows:any[]=[];
 for(const id of process.env.LAYOUT_GAMES?.split(',')??games){
  await page.setViewportSize({width:1440,height:900});await open(page,id);
  for(const [width,height]of [[1440,900],[393,852],[852,393],[568,320]]){
   await page.setViewportSize({width,height});await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
   const state=await page.locator('#mini-game').evaluate((host,prefix)=>{
    const root=host.firstElementChild!,board=root.querySelector<HTMLElement>(`[data-${prefix}-board]`)!,play=root.querySelector<HTMLElement>(`[data-${prefix}-spin]`)!;
    const rect=(e:Element)=>{const b=e.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height,bottom:b.bottom,right:b.right};};
    const p=rect(play),hit=document.elementFromPoint(p.x+p.width/2,p.y+p.height/2);
    return{board:rect(board),play:p,playHit:!!hit&&play.contains(hit),hit:hit?.outerHTML.slice(0,200),root:rect(root),rootRows:getComputedStyle(root).gridTemplateRows,rootChildren:[...root.children].map(c=>({class:c.className,box:rect(c),display:getComputedStyle(c).display,visibility:getComputedStyle(c).visibility})),hud:[...root.querySelectorAll('.slot-feature-strip>*')].map(c=>({class:c.className,box:rect(c)})),sceneOverflow:[...root.querySelectorAll('.cc-scene,.ce-stage')].map(e=>({height:e.clientHeight,scrollHeight:e.scrollHeight,width:e.clientWidth,scrollWidth:e.scrollWidth}))};
   },family(id));rows.push({id,width,height,...state});
   if([393,852,1440].includes(width))await page.screenshot({path:out+'/'+(process.env.LAYOUT_PHASE||'before')+'-'+id+'-'+width+'x'+height+'.png'});
  }
 }
 await writeFile(out+'/'+(process.env.LAYOUT_PHASE||'before')+'-audit.json',JSON.stringify({games,connectedHost:true,rows},null,2));
 console.log(JSON.stringify(rows.filter(r=>r.width===852).map(r=>({id:r.id,field:[Math.round(r.board.width),Math.round(r.board.height)],primary:r.playHit}))));
});

const sizes=[[1440,900],[1280,720],[768,1024],[1024,768],[393,852],[852,393],[320,568],[568,320]];
async function fit(page:Page,id:string,action?:string,modal=false){
 const prefix=family(id),primary=action||`[data-${prefix}-spin]`;
 await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
 const failures=await page.locator('#mini-game').evaluate((host,{prefix,primary,modal})=>{
  const root=host.firstElementChild!,selectors=[`[data-${prefix}-board]`,primary,`[data-${prefix}-stake]`,`[data-${prefix}-cost]`,'.slot-settings-button',`[data-${prefix}-auto]`,'.slot-feature-strip'];
  const failures:string[]=[];
  for(const selector of selectors){
   // Cosmic Escape moves its settings button into the window bar, as in its approved prototype.
   const el=root.querySelector<HTMLElement>(selector)??(selector==='.slot-settings-button'?host.closest('#mini-dialog')?.querySelector<HTMLElement>('.mini-top .slot-settings-button')??null:null);if(!el){failures.push(selector+': missing');continue;}
   if(!el.getClientRects().length)continue;
   const box=el.getBoundingClientRect();if(!box.width||!box.height){failures.push(selector+': empty');continue;}
   for(let parent=el.parentElement;parent;parent=parent.parentElement){
    if(!/(hidden|auto|scroll|clip)/.test(getComputedStyle(parent).overflow))continue;
    const b=parent.getBoundingClientRect();if(box.left<b.left-2||box.top<b.top-2||box.right>b.right+2||box.bottom>b.bottom+2)failures.push(selector+': clipped by '+parent.className);
   }
   if(!modal&&el.matches('button,select')){const hit=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);if(!hit||!el.contains(hit))failures.push(selector+': blocked');}
  }
  const stake=root.querySelector(`[data-${prefix}-stake]`)!.closest('.cc-stake,.ce-stake,.cx-stake')!.getBoundingClientRect();
  const cost=root.querySelector(`[data-${prefix}-cost]`)!.getBoundingClientRect();
  if(cost.top<stake.top-2||cost.bottom>stake.bottom+2)failures.push('whole-round price outside stake');
  const stage=host.closest('.mini-stage')!;if(stage.scrollHeight>stage.clientHeight+2||stage.scrollWidth>stage.clientWidth+2)failures.push('host scroll');
  return failures;
 },{prefix,primary,modal});
 expect(failures).toEqual([]);
 for(const selector of [primary,`[data-${prefix}-stake]`,'.slot-settings-button']){
  const box=await page.locator((selector==='.slot-settings-button'?'#mini-dialog ':'#mini-game ')+selector).boundingBox();expect(box).not.toBeNull();expect(box!.height).toBeGreaterThanOrEqual(44);
 }
}
async function currentSession(page:Page,id:string){return page.evaluate(id=>{
 const host=(globalThis as any)[Symbol.for('royal.game-host.v1')];
 if(!host)throw Error('The connected game host is not installed');
 return host.expansionClient.sessions.find((s:any)=>s.gameId===id);
},id);}
async function finish(page:Page,id:string){
 const p=family(id),attribute=p==='lg'?'data-lg-dialog-action':'data-cc-action';
 await expect.poll(async()=>{
  const dialog=page.locator('#mini-game :is(.cc-dialog,.ce-dialog)');
  if(await dialog.isVisible()){
   const kind=await dialog.getAttribute('data-dialog'),button=dialog.locator(`[${attribute}="${kind}"]`);
   if((kind==='bonus'||kind==='complete')&&await button.isEnabled())await button.click();
   return false;
  }
  const session=await currentSession(page,id),spin=page.locator(`[data-${p}-spin]`);
  if(session?.state==='settled'&&await spin.isEnabled())return true;
  if(id==='studio-nitro-run'&&session?.state==='active'){
   // Resume a paused bonus once. Its own scheduler completes the free spins;
   // a second manual click can otherwise race the final free-spin settlement.
   const pause=page.locator('[data-cc-pause]');
   if(await pause.isVisible()&&!await pause.isEnabled()&&await spin.isEnabled())await spin.click();
   return false;
  }
  if(session?.state==='active'&&await spin.isEnabled()){
   // A scheduled free spin can start between the readiness check and the click.
   try{await spin.click({timeout:process.env.LAYOUT_BROWSER==='webkit'?5000:1000});}catch(error){if(!(error instanceof Error)||error.name!=='TimeoutError')throw error;}
  }
  return false;
 },{timeout:process.env.LAYOUT_BROWSER==='webkit'?180000:90000,intervals:[100,250,500]}).toBe(true);
}
for(const id of games)test('field and actions without scrolling: '+id,async({page,roomPath})=>{
 await enterGameHall(page,roomPath);await open(page,id);
 for(const [width,height]of sizes)await test.step(width+'x'+height,async()=>{await page.setViewportSize({width,height});await fit(page,id);});
});

test('Last Convoy keeps its radio and stake legible in the connected host',async({page,roomPath})=>{
 const game='studio-last-convoy';
 await enterGameHall(page,roomPath);await open(page,game);
 const root=page.locator('#mini-game > .cv-game');
 const chat=page.locator('#club-chat-dock');
 if(!await chat.isVisible())await page.locator('#mini-dialog .game-chat-toggle').click();
 await expect(chat.locator('#chat-input')).toBeVisible();
 await fit(page,game);
 await expect(root.locator('[data-cv-heroine]')).toHaveJSProperty('complete',true);

 await page.setViewportSize({width:393,height:700});
 if(await chat.isVisible())await chat.locator('.game-chat-close').click();
 const layout=await root.evaluate(game=>{
  const radio=game.querySelector('.cv-radio')!;
  const message=radio.querySelector('[data-cc-message]')!;
  message.textContent='Баррикады усиливают защиту. Эвакуация продолжается бесплатно. Держитесь ближе к фонарям.';
  const text=document.createRange();
  text.selectNodeContents(message);
  const controls=game.querySelector('.cv-controls')!.getBoundingClientRect();
  const board=game.querySelector('[data-cc-board]')!.getBoundingClientRect();
  const portrait=radio.querySelector('.cv-portrait')!.getBoundingClientRect();
  return {
   boardBottom:board.bottom,radioTop:radio.getBoundingClientRect().top,
   radioBottom:radio.getBoundingClientRect().bottom,controlsTop:controls.top,
   messageBottom:text.getBoundingClientRect().bottom,portraitBottom:portrait.bottom,
   stake:game.querySelector<HTMLInputElement>('[data-manual-stake]')!.value,
  };
 });
 expect(layout.boardBottom).toBeLessThanOrEqual(layout.radioTop);
 expect(Math.max(layout.radioBottom,layout.messageBottom,layout.portraitBottom)).toBeLessThan(layout.controlsTop);
 expect(layout.stake).toBe('0,10');
 await fit(page,game);
 const stake=root.locator('[data-manual-stake]');
 await stake.fill('0,11');
 await expect(root.locator('[data-cc-stake]')).toHaveValue('11');
 await stake.fill('0,10');
 await expect(root.locator('[data-cc-stake]')).toHaveValue('10');
 await page.locator('#mini-dialog .game-chat-toggle').click();
 await expect(chat.locator('#chat-input')).toBeVisible();
});

test('Nitro Run keeps its field and instruments stable with connected chat',async({page,roomPath})=>{
 await mkdir(out,{recursive:true});const report:unknown[]=[];
 await enterGameHall(page,roomPath);await open(page,'studio-nitro-run');
 const game=page.locator('#mini-game > .nr-game'),chat=page.locator('#club-chat-dock');
 for(const [width,height]of sizes){
  await test.step(`${width}x${height}`,async()=>{
   await page.setViewportSize({width,height});
   await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
   if(width>=1080&&height>=600){
    if(!await chat.isVisible())await page.locator('#mini-dialog .game-chat-toggle').click();
    await expect(chat.locator('#chat-input')).toBeVisible();
   }else await expect(page.locator('#mini-dialog')).toHaveAttribute('data-game-chat','closed');
   await fit(page,'studio-nitro-run');
   const composition=await game.evaluate(root=>{
    const rect=(selector:string)=>root.querySelector(selector)!.getBoundingClientRect().toJSON();
    return {profile:root.dataset.slotPriority,cabinet:rect('.nr-cabinet'),stage:rect('.nr-stage'),hud:rect('.nr-hud'),header:rect('.nr-heading'),frame:rect('.cc-board-frame'),console:rect('.nr-console'),root:root.getBoundingClientRect().toJSON()};
   });
   const c=composition;
   expect(Math.abs((c.cabinet.left-c.root.left)-(c.root.right-c.cabinet.right)),'cabinet has balanced outer margins').toBeLessThanOrEqual(2);
   if(c.profile==='full'){
    expect(c.frame.left-c.hud.right,'instruments touch the field through one short gutter').toBeGreaterThanOrEqual(10);
    expect(c.frame.left-c.hud.right).toBeLessThanOrEqual(14);
    expect(Math.abs(c.header.left-c.hud.left)).toBeLessThanOrEqual(2);
    expect(Math.abs(c.console.left-c.hud.left)).toBeLessThanOrEqual(2);
    expect(Math.abs(c.console.right-c.frame.right)).toBeLessThanOrEqual(2);
    expect(c.console.top-c.frame.bottom,'no empty result band below the field').toBeLessThanOrEqual(12);
    if(width===1440&&height===900)expect(c.frame.width).toBeGreaterThan(700);
   }else if(c.profile==='portrait'){
    expect(c.console.top-c.frame.bottom,'field and console stay together on phones').toBeLessThanOrEqual(10);
   }else expect(c.console.left-c.frame.right,'landscape console stays beside the field').toBeLessThanOrEqual(16);
   const state=await game.evaluate(root=>{
    const frame=root.querySelector('.cc-board-frame')!,message=root.querySelector('[data-cc-message]')!;
    const error=root.querySelector('[data-cc-error]')!,retry=root.querySelector<HTMLButtonElement>('[data-cc-retry]')!;
    const initial={message:message.textContent,error:error.textContent,hidden:retry.hidden,phase:root.dataset.phase,charge:root.dataset.nitroCharge,multiplier:root.dataset.multiplier};
    const measure=()=>frame.getBoundingClientRect().toJSON(),idle=measure();
    try{
     root.dataset.phase='spinning';message.textContent='';const spinning=measure();
     error.textContent='Не удалось получить ответ. Проверь сохранённый раунд.';retry.hidden=false;
     const recovery=measure(),retryHeight=retry.getBoundingClientRect().height;
     root.dataset.nitroCharge='2';root.dataset.multiplier='5';
     message.textContent='БОНУСНАЯ ГОНКА ПРОДОЛЖАЕТСЯ';const charged=measure();
     const panels=[...root.querySelectorAll<HTMLElement>('.nr-hud>section,.nr-hud>aside')].map(el=>el.getBoundingClientRect().toJSON());
     return {idle,spinning,recovery,charged,retryHeight,panels};
    }finally{
     message.textContent=initial.message;error.textContent=initial.error;retry.hidden=initial.hidden;
     for(const [key,value]of Object.entries({phase:initial.phase,nitroCharge:initial.charge,multiplier:initial.multiplier})){
      if(value===undefined)delete root.dataset[key];else root.dataset[key]=value;
     }
    }
   });
   expect(state.spinning).toEqual(state.idle);expect(state.recovery).toEqual(state.idle);expect(state.charged).toEqual(state.idle);
   expect(state.retryHeight).toBeGreaterThanOrEqual(44);
   report.push({width,height,field:state.idle,composition,stableDuringSpinRecoveryAndCharge:true});
   if([1440,393,852,320].includes(width))await page.screenshot({path:out+`/nitro-run-${width}x${height}.png`});
   if(width===393&&height===852){
    const before=await game.locator('.cc-board-frame').boundingBox();
    await page.locator('#mini-dialog .game-chat-toggle').click();
    await expect(chat.locator('#chat-input')).toBeVisible();
    await expect(page.locator('#mini-dialog .game-chat-game')).toHaveJSProperty('inert',true);
    await chat.locator('.game-chat-close').click();
    await expect(page.locator('#mini-dialog')).toHaveAttribute('data-game-chat','closed');
    expect(await game.locator('.cc-board-frame').boundingBox()).toEqual(before);
   }
   for(let i=0;i<state.panels.length;i++)for(let j=i+1;j<state.panels.length;j++){
    const a=state.panels[i],b=state.panels[j];
    expect(a.right<=b.left+1||b.right<=a.left+1||a.bottom<=b.top+1||b.bottom<=a.top+1,'instruments must not overlap').toBe(true);
   }
  });
 }
 await writeFile(out+'/nitro-run-layout.json',JSON.stringify({connectedHost:true,moduleVersion:await page.locator('#mini-game').getAttribute('data-game-module-version'),rows:report},null,2));
});

test('Caramel Carnival keeps the reel frame still as feedback and festival state change',async({page,roomPath})=>{
 await enterGameHall(page,roomPath);
 await open(page,'studio-caramel-carnival');
 const game=page.locator('#mini-game > .ccf');
 const chat=page.locator('#club-chat-dock');
 for(const [width,height,layout] of [[1280,720,'full'],[393,852,'portrait'],[320,568,'portrait'],[852,393,'landscape']] as const){
  await test.step(`${width}x${height}`,async()=>{
   await page.setViewportSize({width,height});
   await expect(game).toHaveAttribute('data-slot-priority',layout);
   if(layout==='full'){
    if(!await chat.isVisible())await page.locator('#mini-dialog .game-chat-toggle').click();
    await expect(chat.locator('#chat-input')).toBeVisible();
   }else if(await chat.locator('.game-chat-close').isVisible()){
    await chat.locator('.game-chat-close').click();
   }
   await page.evaluate(async()=>{await document.fonts.ready;await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));});
   const {idle,spinning,recovery,notice,festival,retryHeight}=await game.evaluate(root=>{
    const frame=root.querySelector('.ccf-frame')!;
    const message=root.querySelector('[data-cc-message]')!;
    const error=root.querySelector('[data-cc-error]')!;
    const retry=root.querySelector<HTMLButtonElement>('[data-cc-retry]')!;
    const phaseTitle=root.querySelector('[data-cc-phase-title]')!;
    const originalMessage=message.textContent;
    const originalTitle=phaseTitle.textContent;
    const originalState={phase:root.dataset.phase,hasWin:root.dataset.hasWin,notice:root.dataset.notice,festival:root.dataset.festival};
    const rect=()=>frame.getBoundingClientRect().toJSON();
    const idle=rect();
    try{
     message.textContent='';
     root.dataset.phase='spinning';
     const spinning=rect();
     error.textContent='Не удалось получить ответ. Проверь сохранённый раунд.';
     retry.hidden=false;
     const recovery=rect();
     const retryHeight=retry.getBoundingClientRect().height;
     error.textContent='';
     retry.hidden=true;
     root.dataset.phase='idle';
     root.dataset.hasWin='true';
     root.dataset.notice='true';
     message.textContent='Автоигра остановлена: выигрыш достиг лимита';
     const notice=rect();
     root.dataset.notice='false';
     root.dataset.festival='true';
     message.textContent='Фестиваль идёт сам · множитель ×50 сохраняется между вращениями';
     phaseTitle.textContent='Фестиваль · вращение 25 из 30';
     return {idle,spinning,recovery,notice,festival:rect(),retryHeight};
    }finally{
     message.textContent=originalMessage;
     phaseTitle.textContent=originalTitle;
     error.textContent='';
     retry.hidden=true;
     for(const [key,value] of Object.entries(originalState)){
      if(value===undefined) delete root.dataset[key];
      else root.dataset[key]=value;
     }
    }
   });
   expect(idle.width).toBeGreaterThan(0);
   expect(spinning).toEqual(idle);
   expect(recovery).toEqual(idle);
   expect(notice).toEqual(idle);
   expect(festival).toEqual(idle);
   expect(retryHeight).toBeGreaterThanOrEqual(44);
  });
 }
});

test('Cosmic Escape keeps results in the controls and the reel frame still',async({page,roomPath})=>{
 await enterGameHall(page,roomPath);
 await open(page,'studio-cosmic-escape');
 const root=page.locator('#mini-game > .cx-game');
 const speed=root.locator('[data-cx-speed-cycle]');
 await expect(root.locator('[data-cx-speed]')).toHaveCount(2);
 for(const [width,height,layout] of [[1440,900,'full'],[393,852,'portrait'],[852,393,'landscape'],[568,320,'landscape']] as const){
  await test.step(`${width}x${height}`,async()=>{
   await page.setViewportSize({width,height});
   await expect(root).toHaveAttribute('data-slot-priority',layout);
   if(await speed.isVisible()){
    await speed.click();
    await expect(root).toHaveAttribute('data-speed','fast');
    await speed.click();
    await expect(root).toHaveAttribute('data-speed','normal');
   }
   const chat=page.locator('#club-chat-dock');
   if(!await chat.isVisible())await page.locator('#mini-dialog .game-chat-toggle').click();
   await expect(chat.locator('#chat-input')).toBeVisible();
   await expect(root.locator('.cx-scene > .cx-outcome, [data-lg-message]')).toHaveCount(0);
   await expect(root.locator('.cx-bar [data-cosmic-lastwin]')).toBeVisible();
   const {idle,recovery,retryVisible}=await root.evaluate(game=>{
    const frame=game.querySelector('.cx-frame')!;
    const error=game.querySelector<HTMLElement>('[data-lg-error]')!;
    const retry=game.querySelector<HTMLButtonElement>('[data-lg-retry]')!;
    const idle=frame.getBoundingClientRect().toJSON();
    error.textContent='Не удалось получить ответ. Проверь сохранённый раунд.';
    retry.hidden=false;
    const recovery=frame.getBoundingClientRect().toJSON(),retryVisible=retry.getBoundingClientRect().height>=44;
    retry.hidden=true;
    error.textContent='';
    return {idle,recovery,retryVisible};
   });
   expect(idle.width).toBeGreaterThan(0);
   expect(recovery).toEqual(idle);
   expect(retryVisible).toBe(true);
   if(layout!=='full')await chat.locator('.game-chat-close').click();
  });
 }
});

test('Cosmic Escape keeps its 2K reel size when the chat column closes',async({page,roomPath})=>{
 const game='studio-cosmic-escape';
 await enterGameHall(page,roomPath);
 await open(page,game);
 await page.setViewportSize({width:2560,height:1440});
 const chat=page.locator('#club-chat-dock');
 const toggle=page.locator('#mini-dialog .game-chat-toggle');
 if(!await chat.isVisible())await toggle.click();
 await expect(chat.locator('#chat-input')).toBeVisible();
 await fit(page,game);
 const frame=page.locator('#mini-game .cx-frame');
 const openBox=(await frame.boundingBox())!;
 expect(openBox.width).toBeLessThanOrEqual(1280);

 await toggle.click();
 await expect(chat).toBeHidden();
 await fit(page,game);
 const closedBox=(await frame.boundingBox())!;
 expect(closedBox.width).toBe(openBox.width);
 expect(closedBox.height).toBe(openBox.height);
});

for(const game of ['studio-cosmic-escape','studio-caramel-carnival'])test(game+' accepts 100 USDT as a whole-round stake and rejects the next cent',async({page,roomPath})=>{
 await enterGameHall(page,roomPath);
 await open(page,game);
 const prefix=family(game),chat=page.locator('#club-chat-dock');
 if(!await chat.isVisible())await page.locator('#mini-dialog .game-chat-toggle').click();
 await expect(chat.locator('#chat-input')).toBeVisible();
 if(process.env.LAYOUT_TOUCH==='1')await chat.locator('.game-chat-close').click();
 const stake=page.locator('#mini-game [data-manual-stake]'),spin=page.locator(`[data-${prefix}-spin]`);
 const stakes=page.locator(`[data-${prefix}-stake]`);
 await expect(stakes.locator('option[value="10000"]')).toHaveCount(1);
 const before=await walletSnapshot(page);
 await stake.fill('100,01');
 await expect(stake).toHaveAttribute('aria-invalid','true');
 await spin.click();
 expect((await walletSnapshot(page)).entries).toEqual(before.entries);
 await stake.fill('100,00');
 await expect(stake).toHaveAttribute('aria-invalid','false');
 await expect(stakes).toHaveValue('10000');
 if(game==='studio-caramel-carnival'){
  await expect(page.locator('[data-cc-buy-price]')).toHaveText(/3[\s\u00a0\u202f]*500[,.]00/);
 }
 const paid=page.waitForResponse(response=>response.url().endsWith('/api/demo-wallet/expansion')&&response.request().method()==='POST');
 await spin.click();
 const response=await paid;
 expect(response.ok(),await response.text()).toBe(true);
 expect(response.request().postDataJSON().stakeUnits).toBe('10000');
 await finish(page,game);
 const after=await walletSnapshot(page);
 const bets=after.entries.filter((entry:any)=>entry.kind==='bet');
 expect(bets).toHaveLength(1);
 expect(bets[0].amount).toBe(-100);
});

for(const id of games)test('settings, Stop and one accepted ten-cent round: '+id,async({page,roomPath})=>{
 test.skip(process.env.LAYOUT_BROWSER==='webkit'&&!['studio-cosmic-escape','studio-caramel-carnival','studio-afterglow','studio-velvet-reign'].includes(id),'All seven flows run in Chromium; four distinct presentations also run with WebKit touch.');
 await enterGameHall(page,roomPath);await page.setViewportSize({width:393,height:852});await open(page,id);const p=family(id);
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.locator('.slot-settings-button').click();
 if(process.env.LAYOUT_DEBUG==='1')console.log(await page.locator('.slot-secondary-controls').evaluate(root=>[root,...root.children,...root.querySelectorAll('.ce-sidebar>*')].map(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return{node:e.className,display:s.display,flexDirection:s.flexDirection,contain:s.contain,columns:s.gridTemplateColumns,rows:s.gridTemplateRows,area:s.gridArea,position:s.position,height:r.height,width:r.width,left:r.left,top:r.top};})));
 // The redesigned Cosmic Escape and Caramel Carnival keep speed and autoplay on the cabinet: a speed control and an autoplay panel.
 const cosmic=id==='studio-cosmic-escape'||id==='studio-caramel-carnival',caramel=id==='studio-caramel-carnival';
 const cabinet=caramel?{fast:'[data-cc-speed-option="fast"]',cycle:'[data-cc-speed-cycle]',panel:'[data-cc-auto-panel]',count:'[data-cc-auto-count="25"]',start:'[data-cc-auto-start]',purchase:'[data-cc-buy]'}
  :{fast:'[data-cx-speed="fast"]',cycle:'[data-cx-speed-cycle]',panel:'[data-cx-auto-panel]',count:'[data-cx-auto-count="25"]',start:'[data-cx-auto-start]',purchase:'[data-cosmic-missions]'};
 const fastSpeed=()=>cosmic?expect(page.locator('#mini-game '+cabinet.fast)).toHaveAttribute('aria-checked','true'):expect(page.locator(`[data-${p}-speed]`)).toHaveAttribute('aria-pressed','true');
 if(!cosmic){await page.locator(`[data-${p}-auto-count]`).selectOption('25');await page.locator(`[data-${p}-speed]`).click();}
 expect(errors).toEqual([]);
 if(!cosmic)await fastSpeed();
 if(id==='studio-velvet-reign'||id==='studio-afterglow')await page.screenshot({path:out+'/'+id+'-options.png'});
 await page.setViewportSize({width:852,height:393});await page.keyboard.press('Escape');await expect(page.locator('.slot-settings-dialog')).toBeHidden();await expect(page.locator('.slot-settings-button')).toBeFocused();
 if(cosmic){await page.locator('#mini-game '+cabinet.cycle).click();await fastSpeed();}
 await fit(page,id);await page.setViewportSize({width:1440,height:900});await fit(page,id);
 await fastSpeed();
 if(!cosmic)await expect(page.locator(`[data-${p}-auto-count]`)).toHaveValue('25');await page.setViewportSize({width:393,height:852});
 await page.locator('.slot-settings-button').click();await fastSpeed();await page.keyboard.press('Escape');
 let release!:()=>void;const gate=new Promise<void>(r=>release=r);let request:any;
 await page.route('**/api/demo-wallet/expansion',async route=>{if(route.request().method()==='POST'){request=route.request().postDataJSON();await gate;}await route.continue();});
 const response=page.waitForResponse(r=>r.url().endsWith('/api/demo-wallet/expansion')&&r.request().method()==='POST');
 await page.locator(`[data-${p}-auto]`).click();
 if(cosmic){const panel=page.locator('#mini-game '+cabinet.panel);await expect(panel).toBeVisible();await panel.locator(cabinet.count).click();await panel.locator(cabinet.start).click();await expect(panel).toBeHidden();}
 await expect.poll(()=>!!request).toBe(true);expect(request.stakeUnits).toBe('10');
 await expect(page.locator(`[data-${p}-auto]`)).toContainText('Стоп');await page.setViewportSize({width:852,height:393});await fit(page,id);
 await page.locator(`[data-${p}-auto]`).click();release();const paid=await response;expect(paid.ok(),await paid.text()).toBe(true);
 await finish(page,id);await page.unroute('**/api/demo-wallet/expansion');
 const snapshot=await walletSnapshot(page),bets=snapshot.entries.filter((e:any)=>e.kind==='bet');expect(bets).toHaveLength(1);expect(bets[0].amount).toBe(-0.1);
 await open(page,id);await finish(page,id);expect((await walletSnapshot(page)).entries).toEqual(snapshot.entries);await fit(page,id);
 for(const kind of ['info','history','purchase']){
  const selector=kind==='purchase'?'[data-cc-buy],[data-cosmic-missions],[data-velvet-missions]':`[data-${p}-${kind}]`;
  // Cosmic Escape keeps missions and Caramel Carnival keeps the festival purchase on the cabinet.
  if(cosmic&&kind==='purchase')await page.locator('#mini-game').locator(cabinet.purchase).click();
  else{await page.locator('.slot-settings-button').click();await page.locator('.slot-settings-dialog').locator(selector).click();}
  await expect(page.locator('.slot-settings-dialog')).toBeHidden();
  await expect(page.locator('#mini-game :is(.cc-dialog,.ce-dialog)')).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.locator('#mini-game :is(.cc-dialog,.ce-dialog)')).toBeHidden();
 }
 expect((await walletSnapshot(page)).entries).toEqual(snapshot.entries);
 let lost=false;
 await page.route('**/api/demo-wallet/expansion',async route=>{
  if(!lost&&route.request().method()==='POST'){lost=true;await route.fetch();await route.abort('failed');}else await route.continue();
 });
 await page.locator(`[data-${p}-spin]`).click();await expect(page.locator(`[data-${p}-retry]`)).toBeVisible();
 await page.setViewportSize({width:568,height:320});await fit(page,id,`[data-${p}-retry]`);
 await open(page,id);const retry=page.locator(`[data-${p}-retry]`);
 if(await retry.isVisible())await retry.click();await finish(page,id);await page.unroute('**/api/demo-wallet/expansion');
 expect((await walletSnapshot(page)).entries.filter((e:any)=>e.kind==='bet')).toHaveLength(2);
 await page.screenshot({path:out+'/'+id+'-result.png'});expect(errors).toEqual([]);
});

test('moving symbols retain their field through both phone orientations',async({page,roomPath})=>{
 test.setTimeout(240000);await enterGameHall(page,roomPath);
 for(const id of ['studio-cosmic-escape','studio-caramel-carnival','studio-velvet-reign','studio-afterglow']){
  await page.setViewportSize({width:393,height:852});await open(page,id);const p=family(id);await page.emulateMedia({reducedMotion:'no-preference'});
  await page.locator(`[data-${p}-spin]`).click();await expect(page.locator('#mini-game > .slot-priority-game, #mini-game > .cx-game, #mini-game > .cc-game.ccf')).not.toHaveAttribute('data-phase','idle');
  await page.setViewportSize({width:852,height:393});await fit(page,id);await page.setViewportSize({width:393,height:852});await fit(page,id);
  await page.emulateMedia({reducedMotion:'reduce'});await finish(page,id);
 }
});

test('album, photo and themed menu remain accessible from the compact panel',async({page,roomPath})=>{
 await enterGameHall(page,roomPath);await page.setViewportSize({width:393,height:852});await open(page,'studio-afterglow');
 const before=(await walletSnapshot(page)).entries;
 await page.locator('.slot-settings-button').click();await page.screenshot({path:out+'/studio-afterglow-options.png'});await page.locator('.slot-settings-dialog [data-ag-album]').click();
 await expect(page.locator('.slot-settings-dialog')).toBeHidden();await expect(page.getByRole('heading',{name:'АЛЬБОМ ГЕРОИНЬ',exact:true})).toBeVisible();
 await page.keyboard.press('Escape');await page.locator('.slot-settings-button').click();await page.locator('.slot-settings-dialog [data-ag-photo]').click();
 await expect(page.locator('.slot-settings-dialog')).toBeHidden();await expect(page.locator('.slot-photo-viewer')).toBeVisible();
 await page.setViewportSize({width:852,height:393});await expect(page.locator('.slot-photo-viewer [aria-label="Закрыть фото"]')).toBeInViewport({ratio:1});
 await page.keyboard.press('Escape');await expect(page.locator('.slot-photo-viewer')).toBeHidden();await fit(page,'studio-afterglow');
 await open(page,'studio-meme-overload');
 for(const kind of ['info','history']){
  await page.locator('.slot-settings-button').click();await page.locator(`.slot-settings-dialog [data-mo-menu="${kind}"]`).click();
  await expect(page.locator('.slot-settings-dialog')).toBeHidden();await expect(page.locator('[data-cc-dialog]')).toHaveAttribute('data-dialog',kind);await page.keyboard.press('Escape');
 }
 expect((await walletSnapshot(page)).entries).toEqual(before);
});

test('natural bonuses keep counters and free continuation visible in both orientations',async({page,roomPath})=>{
 test.setTimeout(process.env.LAYOUT_BROWSER==='webkit'?900000:300000);await mkdir(out,{recursive:true});await enterGameHall(page,roomPath);
 for(const id of process.env.LAYOUT_GAMES?.split(',')??games){
  await test.step(id,async()=>{
   await page.setViewportSize({width:393,height:852});await open(page,id);const p=family(id),attribute=p==='lg'?'data-lg-dialog-action':'data-cc-action';
   const fixture=await page.request.post('/__test/layout/bonus',{data:{gameId:id}});expect(fixture.ok(),await fixture.text()).toBe(true);
   const accepted=page.waitForResponse(r=>r.url().endsWith('/api/demo-wallet/expansion')&&r.request().method()==='POST');await page.locator(`[data-${p}-spin]`).click();expect((await accepted).ok()).toBe(true);
   const bonus=page.locator(`[${attribute}="bonus"]`);await expect(bonus).toBeVisible({timeout:30000});
   for(const [width,height]of [[393,852],[852,393],[568,320]]){
    await page.setViewportSize({width,height});await fit(page,id,undefined,true);await expect(bonus).toBeInViewport({ratio:1});
   }
    await bonus.click();await expect(page.locator(`[data-${p}-pause]`)).toBeVisible({timeout:15000});await fit(page,id,`[data-${p}-pause]`);
   await page.locator(`[data-${p}-pause]`).click();await page.setViewportSize({width:393,height:852});await fit(page,id);
   const before=await walletSnapshot(page),debits=before.entries.filter((e:any)=>e.kind==='bet').length;
   await page.screenshot({path:out+'/'+id+'-bonus-portrait.png'});await page.setViewportSize({width:852,height:393});await fit(page,id);
   await page.screenshot({path:out+'/'+id+'-bonus-landscape.png'});await finish(page,id);
   expect((await walletSnapshot(page)).entries.filter((e:any)=>e.kind==='bet')).toHaveLength(debits);
  });
 }
});

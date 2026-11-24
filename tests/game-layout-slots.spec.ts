import {expect,type Page} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {test} from './themed-room';
import {enterGameHall,chooseGame} from './game-layout-host';
import {walletSnapshot} from './wallet-snapshot';
import {selectEntryMode} from './entry-mode';

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
  // Last Convoy shows the accepted stake instead of the stake field during its evacuation.
  if(selector===`[data-${prefix}-stake]`&&id==='studio-last-convoy'&&await page.locator('#mini-game > [data-bonus="true"]').count())continue;
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

test('Last Convoy keeps its result line and stake legible in the connected host',async({page,roomPath})=>{
 const game='studio-last-convoy';
 await enterGameHall(page,roomPath);await open(page,game);
 const root=page.locator('#mini-game > .cv-game');
 const chat=page.locator('#club-chat-dock');
 if(!await chat.isVisible())await page.locator('#mini-dialog .game-chat-toggle').click();
 await expect(chat.locator('#chat-input')).toBeVisible();
 await fit(page,game);
 await expect(root.locator('[data-cv-heroine]')).toHaveJSProperty('complete',true);
 // On a spacious screen Maya stands beside the field as a full figure, without a speech card.
 await expect(root.locator('.cv-radio .cv-portrait')).toBeVisible();
 await expect(root.locator('.cv-radio [data-cc-message]')).toHaveCount(0);

 await page.setViewportSize({width:393,height:700});
 if(await chat.isVisible())await chat.locator('.game-chat-close').click();
 const layout=await root.evaluate(game=>{
  const result=game.querySelector('.cv-result')!;
  const message=result.querySelector('[data-cc-message]')!;
  message.textContent='Баррикады усиливают защиту. Эвакуация продолжается бесплатно. Держитесь ближе к фонарям.';
  const text=document.createRange();
  text.selectNodeContents(message);
  const box=result.getBoundingClientRect();
  const controls=game.querySelector('.cv-controls')!.getBoundingClientRect();
  const board=game.querySelector('[data-cc-board]')!.getBoundingClientRect();
  return {
   boardBottom:board.bottom,resultTop:box.top,resultBottom:box.bottom,controlsTop:controls.top,
   messageBottom:text.getBoundingClientRect().bottom,
   radio:getComputedStyle(game.querySelector('.cv-radio')!).display,
   stake:game.querySelector<HTMLInputElement>('[data-manual-stake]')!.value,
  };
 });
 expect(layout.boardBottom).toBeLessThanOrEqual(layout.resultTop);
 expect(layout.messageBottom).toBeLessThanOrEqual(layout.resultBottom);
 expect(layout.resultBottom).toBeLessThan(layout.controlsTop);
 expect(layout.radio,'phones give the space to the field').toBe('none');
 expect(layout.stake).toBe('0,10');
 await fit(page,game);
 const stake=root.locator('[data-manual-stake]');
 await stake.fill('0,11');
 await expect(root.locator('[data-cc-stake]')).toHaveValue('11');
 await stake.fill('0,10');
 await expect(root.locator('[data-cc-stake]')).toHaveValue('10');
 // Pressing the stake opens the list of amounts; a choice uses the manual stake path and never places a bet.
 const debits=(await walletSnapshot(page)).entries.filter((e:any)=>e.kind==='bet').length;
 const menu=root.locator('[data-cv-stake-menu]');
 await expect(root.locator('[data-cv-preset]')).toHaveCount(0);
 for(const [width,height] of [[1440,900],[390,844],[844,390]] as const){
  await page.setViewportSize({width,height});
  if(width>800&&height>800&&!await chat.isVisible())await page.locator('#mini-dialog .game-chat-toggle').click();
  if(width<800&&await chat.isVisible())await chat.locator('.game-chat-close').click();
  await fit(page,game);
  await expect(menu).toBeHidden();
  await stake.click();
  await expect(menu).toBeVisible();
  await expect(stake).toHaveAttribute('aria-expanded','true');
  const inside=await menu.evaluate(element=>{const box=element.getBoundingClientRect(),game=element.closest('.cv-game')!.getBoundingClientRect();return box.top>=game.top&&box.bottom<=game.bottom&&box.left>=game.left&&box.right<=game.right;});
  expect(inside,`${width}x${height}: the stake list stays inside the game`).toBe(true);
  await menu.locator('[data-cv-stake-option="50"]').click();
  await expect(menu).toBeHidden();
  await expect(root.locator('[data-cc-stake]')).toHaveValue('50');
  await expect(stake).toHaveValue('0,50');
  await stake.click();
  await expect(menu.locator('[data-cv-stake-option="50"]')).toHaveAttribute('aria-selected','true');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await stake.press('ArrowDown');
  await expect(menu.locator('[data-cv-stake-option="50"]')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  await expect(root.locator('[data-cc-stake]')).toHaveValue('10');
  await expect(menu).toBeHidden();
  await root.locator('.cv-stake-value > label').click();
  await expect(menu).toBeVisible();
  await menu.locator('[data-cv-stake-custom]').click();
  await expect(menu).toBeHidden();
  await expect(stake).toBeFocused();
  await stake.fill('0,12');
  await expect(root.locator('[data-cc-stake]')).toHaveValue('12');
  await stake.fill('0,10');
  await expect(root.locator('[data-cc-stake]')).toHaveValue('10');
  await page.mouse.click(1,1);
 }
 expect((await walletSnapshot(page)).entries.filter((e:any)=>e.kind==='bet')).toHaveLength(debits);
 await page.setViewportSize({width:1440,height:900});
 await fit(page,game);
 if(!await chat.isVisible())await page.locator('#mini-dialog .game-chat-toggle').click();
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
    return {profile:root.dataset.slotPriority,cabinet:rect('.nr-cabinet'),stage:rect('.nr-stage'),hud:rect('.nr-hud'),header:rect('.nr-heading'),frame:rect('.cc-board-frame'),status:rect('.nr-status'),console:rect('.nr-console'),root:root.getBoundingClientRect().toJSON()};
   });
   const c=composition;
   expect(Math.abs((c.cabinet.left-c.root.left)-(c.root.right-c.cabinet.right)),'cabinet has balanced outer margins').toBeLessThanOrEqual(2);
   for(const part of [c.frame,c.status,c.console])expect(part.bottom,'cabinet parts stay inside the module').toBeLessThanOrEqual(c.root.bottom+1);
   if(c.profile==='full'){
    expect(c.hud.left-c.frame.right,'the instrument rail meets the field through one short gutter').toBeGreaterThanOrEqual(10);
    expect(c.hud.left-c.frame.right).toBeLessThanOrEqual(18);
    expect(Math.abs(c.header.left-c.hud.left)).toBeLessThanOrEqual(2);
    expect(Math.abs(c.console.left-c.hud.left)).toBeLessThanOrEqual(2);
    expect(Math.abs(c.console.right-c.hud.right)).toBeLessThanOrEqual(2);
    expect(c.console.top-c.hud.bottom,'instruments and console do not overlap').toBeGreaterThanOrEqual(0);
    expect(Math.abs(c.status.left-c.frame.left)).toBeLessThanOrEqual(2);
    expect(Math.abs(c.status.right-c.frame.right)).toBeLessThanOrEqual(2);
    expect(c.status.top-c.frame.bottom,'status line sits directly below the field').toBeLessThanOrEqual(14);
    if(width===1440&&height===900)expect(c.frame.width).toBeGreaterThan(700);
   }else if(c.profile==='portrait'){
    expect(c.status.top-c.frame.bottom,'status line stays under the field on phones').toBeLessThanOrEqual(12);
    expect(c.console.top-c.status.bottom,'console stays below the status line').toBeGreaterThanOrEqual(0);
   }else{
    expect(c.console.left-c.frame.right,'landscape console stays beside the field').toBeLessThanOrEqual(16);
    expect(c.console.left-c.frame.right).toBeGreaterThanOrEqual(0);
   }
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

test('Nitro Run previews autoplay costs without placing a bet',async({page,roomPath})=>{
 await mkdir(out,{recursive:true});await enterGameHall(page,roomPath);await open(page,'studio-nitro-run');
 const panel=page.locator('[data-nr-auto-panel]'),auto=page.locator('[data-cc-auto]'),stake=page.locator('#mini-game [data-manual-stake]');
 const before=await walletSnapshot(page);let paidRequests=0;
 page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/api/demo-wallet/expansion'))paidRequests++;});
 await auto.click();await expect(panel).toBeVisible();await expect(panel.locator('[data-nr-auto-count="10"]')).toBeFocused();
 await expect(panel.locator('[data-nr-auto-stake]')).toHaveText('0,10');await expect(panel.locator('[data-nr-auto-total]')).toHaveText('1,00');
 await page.keyboard.press('ArrowRight');await expect(panel.locator('[data-nr-auto-count="25"]')).toBeFocused();
 await expect(panel.locator('[data-nr-auto-total]')).toHaveText('2,50');
 await panel.locator('[data-nr-auto-count="50"]').click();await expect(panel.locator('[data-nr-auto-total]')).toHaveText('5,00');
 await page.keyboard.press('Escape');await expect(panel).toBeHidden();await expect(auto).toBeFocused();
 await stake.fill('1,23');await auto.click();await expect(panel.locator('[data-nr-auto-total]')).toHaveText('61,50');
 await panel.locator('[data-nr-auto-count="25"]').click();await expect(panel.locator('[data-nr-auto-total]')).toHaveText('30,75');
 for(const [width,height]of sizes){
  await page.setViewportSize({width,height});
  await expect(panel.locator('[data-nr-auto-start]')).toBeInViewport({ratio:1});
  await expect(panel.locator('[data-nr-auto-close]').last()).toBeInViewport({ratio:1});
  const geometry=await panel.evaluate(dialog=>{
   const r=dialog.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,viewport:[innerWidth,innerHeight],scroll:dialog.scrollHeight-dialog.clientHeight};
  });
  expect(geometry.left).toBeGreaterThanOrEqual(0);expect(geometry.right).toBeLessThanOrEqual(width);
  expect(geometry.top).toBeGreaterThanOrEqual(0);expect(geometry.bottom).toBeLessThanOrEqual(height);
  expect(geometry.scroll,'autoplay choices, cost and actions fit together').toBeLessThanOrEqual(1);
  if(width===1440||width===393)await page.screenshot({path:out+`/nitro-run-auto-${width}x${height}.png`});
 }
 const cancel=panel.locator('[data-nr-auto-close]').last();await cancel.focus();await page.keyboard.press('Tab');
 await expect(panel.locator('[data-nr-auto-close]').first()).toBeFocused();await page.keyboard.press('Shift+Tab');await expect(cancel).toBeFocused();
 await cancel.click();await expect(panel).toBeHidden();await expect(auto).toBeFocused();
 await stake.fill('50,00');await auto.click();await panel.locator('[data-nr-auto-count="50"]').click();
 await expect(panel.locator('[data-nr-auto-total]')).toHaveText(/2\s500,00/);await panel.locator('[data-nr-auto-close]').first().click();
 await stake.fill('0,09');await auto.click();await expect(panel).toBeHidden();
 expect(paidRequests).toBe(0);expect((await walletSnapshot(page)).entries).toEqual(before.entries);
 await stake.fill('0,10');
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
     message.textContent='Достигнут предел выигрыша';
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

/** Records every distinct position of the Cosmic field, result strip and controls on every frame. */
async function watchCosmicCockpit(page:Page){
 await page.evaluate(()=>{
  const root=document.querySelector<HTMLElement>('#mini-game > .cx-game')!,seen=new Map<string,string>(),phases=new Set<string>();
  const parts=['.cx-frame','[data-lg-board]','.cx-result','.cx-energy','.cx-portals','.cx-bar','.cx-money','.cx-lastwin','.cx-stepper','[data-cx-crew]','.cx-podium','.cx-alien'];
  let running=true,frames=0;
  const sample=()=>{
   if(!running)return;
   frames++;phases.add(root.dataset.phase+(root.dataset.bonus==='true'?'+mission':''));
   const note=(key:string)=>{if(!seen.has(key))seen.set(key,root.dataset.phase+'/'+root.dataset.bonus);};
   for(const part of parts){const b=root.querySelector(part)!.getBoundingClientRect();note(part+' '+[b.x,b.y,b.width,b.height].map(v=>v.toFixed(1)).join(','));}
   // The pressed reactor scales for a moment; its layout box must stay.
   const spin=root.querySelector<HTMLElement>('[data-lg-spin]')!;note('[data-lg-spin] '+[spin.offsetLeft,spin.offsetTop,spin.offsetWidth,spin.offsetHeight].join(','));
   // Auto and the series pause share one slot.
   const slot=[...root.querySelectorAll<HTMLElement>('[data-lg-auto],[data-lg-pause]')].find(e=>!e.hidden)!.getBoundingClientRect();note('auto '+[slot.x,slot.y,slot.width,slot.height].map(v=>v.toFixed(1)).join(','));
   requestAnimationFrame(sample);
  };
  (window as any).cosmicCockpit=()=>{running=false;return {frames,phases:[...phases],places:[...seen].map(([key,phase])=>key+' @'+phase),parts:parts.length+2};};
  sample();
 });
 return ()=>page.evaluate(()=>(window as any).cosmicCockpit() as {frames:number;phases:string[];places:string[];parts:number});
}
for(const [width,height,chatOpen] of [[1440,900,true],[1280,720,true],[1440,900,false],[1280,720,false],[393,852,false],[852,393,false],[320,568,false],[568,320,false]] as const)test(`Cosmic Escape cockpit never moves through real rounds: ${width}x${height}${chatOpen?' with chat':''}`,async({page,roomPath})=>{
 test.setTimeout(240000);await enterGameHall(page,roomPath);await page.setViewportSize({width,height});
 const id='studio-cosmic-escape',chat=page.locator('#club-chat-dock');await open(page,id);
 if(await chat.isVisible()!==chatOpen){if(chatOpen||width>=1080)await page.locator('#mini-dialog .game-chat-toggle').click();else await chat.locator('.game-chat-close').click();}
 await page.evaluate(()=>document.fonts.ready.then(()=>new Promise<void>(r=>setTimeout(r,400))));
 await page.emulateMedia({reducedMotion:'no-preference'});
 const game=page.locator('#mini-game > .cx-game'),stop=await watchCosmicCockpit(page);
 const seed=async(scenario?:string)=>{const fixture=await page.request.post('/__test/layout/bonus',{data:{gameId:id,scenario}});expect(fixture.ok(),await fixture.text()).toBe(true);};
 for(const [scenario,kind] of [['calm','none'],['win','win'],['big-win','win']] as const){
  await seed(scenario);await page.locator('[data-lg-spin]').click();
  await expect(game).not.toHaveAttribute('data-phase','idle');
  await expect.poll(()=>game.evaluate(e=>e.dataset.phase==='idle'&&!e.dataset.animationToken),{timeout:60000}).toBe(true);
  if(kind==='win'){await expect(game.locator('[data-cx-result]')).toHaveAttribute('data-kind','win');await expect(game.locator('[data-cx-result-amount]')).not.toBeEmpty();}
 }
 await seed('features');await page.locator('[data-lg-spin]').click();
 const bonus=page.locator('[data-lg-dialog-action="bonus"]');await expect(bonus).toBeVisible({timeout:60000});await bonus.click();
 await expect(page.locator('[data-lg-pause]')).toBeEnabled({timeout:15000});await page.waitForTimeout(3500);await page.locator('[data-lg-pause]').click();
 await expect(game).toHaveAttribute('data-phase','idle',{timeout:30000});
 // The reactor segments show the free spin that the count names.
 const [next,awarded]=(await game.locator('[data-cx-spin-count]').textContent())!.match(/\d+/g)!;
 await expect(game.locator('.cx-core')).toHaveAttribute('data-segments',awarded);await expect(game.locator('.cx-core')).toHaveAttribute('data-lit',next);
 const result=await stop();expect(result.frames).toBeGreaterThan(60);
 for(const phase of ['spinning','winning','idle','idle+mission'])expect(result.phases).toContain(phase);
 expect(result.places,JSON.stringify(result.places,null,1)).toHaveLength(result.parts);
 await page.emulateMedia({reducedMotion:'reduce'});await finish(page,id);
});

test('Cosmic Escape cockpit ignores the length of every changing text',async({page,roomPath})=>{
 test.setTimeout(120000);await enterGameHall(page,roomPath);await open(page,'studio-cosmic-escape');
 for(const [width,height] of [[2560,1440],[1440,900],[1280,720],[1024,768],[768,1024],[393,852],[852,393],[320,568],[568,320]])await test.step(width+'x'+height,async()=>{
  await page.setViewportSize({width,height});await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
  const moved=await page.locator('#mini-game > .cx-game').evaluate(root=>{
   const place=()=>['.cx-frame','[data-lg-board]','.cx-result','.cx-energy','.cx-bar','.cx-money','.cx-lastwin','.cx-stepper','[data-lg-spin]','[data-lg-cell="0"]','[data-cx-crew]','.cx-crew-bar'].map(part=>{const b=root.querySelector(part)!.getBoundingClientRect();return part+' '+[b.x,b.y,b.width,b.height].map(v=>v.toFixed(1)).join(',');}).join(' | ');
   const before=place(),moved:string[]=[],long='Очень длинная подпись, которая занимает несколько строк и в другом языке бывает ещё длиннее. '.repeat(4);
   const parts=['[data-cx-result-title]','[data-cx-result-note]','[data-cx-mode]','[data-lg-status]','[data-lg-error]','[data-lg-factor-note]','[data-cosmic-wallet-note]','[data-lg-cost]','[data-cx-spin-count]','[data-lg-spin-label]','[data-cx-auto-label]','[data-lg-pause]','[data-cx-crew-title]','[data-cx-crew-count]','[data-cx-crew-note]','[data-cx-crew-gain]','[data-cx-newcomer]'];
   const texts=[...parts.map(part=>[part,long]),...['[data-lg-balance]','[data-cosmic-lastwin]','[data-cx-result-amount]'].map(part=>[part,'9 999 999,99']),['[data-lg-factor]','×50']];
   for(const [part,text] of texts){
    const el=root.querySelector<HTMLElement>(part)!,html=el.innerHTML,hidden=el.hidden,strip=root.querySelector<HTMLElement>('[data-cx-result]')!,kind=strip.dataset.kind,state={...root.dataset};
    for(const value of ['',text])for(const [next,bonus,spin] of [['idle','false','idle'],['spin','false','spinning'],['win','false','idle'],['win','true','bonus'],['return','false','auto'],['portal','false','idle']]){
     el.hidden=false;el.textContent=value;strip.dataset.kind=next;Object.assign(root.dataset,{bonus,spinState:spin});
     if(place()!==before)moved.push(part+' "'+value.slice(0,6)+'" '+next+'/'+bonus+': '+before+' -> '+place());
    }
    el.innerHTML=html;el.hidden=hidden;strip.dataset.kind=kind;Object.assign(root.dataset,state);
   }
   return moved;
  });
  expect(moved).toEqual([]);
 });
});

test('Cosmic Escape labels stay whole beside the open chat',async({page,roomPath})=>{
 test.setTimeout(180000);await enterGameHall(page,roomPath);await page.setViewportSize({width:1440,height:900});
 const id='studio-cosmic-escape';await open(page,id);const game=page.locator('#mini-game > .cx-game'),chat=page.locator('#club-chat-dock');
 await expect(game).toHaveAttribute('data-crew','ready');if(!await chat.isVisible())await page.locator('#mini-dialog .game-chat-toggle').click();await expect(chat).toBeVisible();
 const sizes=[[1920,1080],[1600,1000],[1600,900],[1440,900],[1366,768],[1280,800],[1280,720],[1250,1000]];
 const whole=async(state:string)=>{for(const [width,height] of sizes){
  await page.setViewportSize({width,height});await page.evaluate(()=>document.fonts.ready.then(()=>new Promise<void>(r=>setTimeout(r,250))));
  expect(await game.evaluate(root=>{
   const box=(s:string)=>root.querySelector(s)!.getBoundingClientRect(),problems:string[]=[];
   for(const e of root.querySelectorAll<HTMLElement>('[data-cx-crew-title],[data-cx-crew-count],[data-cx-crew-note],[data-cx-crew-gain],[data-cx-newcomer],[data-cx-mode],.cx-portals h3,.cx-portals header strong,.cx-ladder li,.cx-ladder li span,.cx-missions b,.cx-missions small,.cx-energy h3,[data-lg-factor],[data-cx-result-amount],[data-cx-result-title],[data-cx-result-note],[data-lg-balance]')){
    if(!e.offsetParent||!e.textContent!.trim())continue;
    if(e.scrollWidth>e.clientWidth+1&&e.clientWidth||e.scrollHeight>e.clientHeight+3&&e.clientHeight&&getComputedStyle(e).overflowY!=='visible')problems.push((e.className||e.getAttributeNames().find(n=>n.startsWith('data-'))||e.tagName)+': '+e.textContent);
   }
   const clear=(a:string,b:string,gap:number)=>{const p=box(a),q=box(b);if(p.right+gap>q.left&&q.right+gap>p.left&&p.bottom+gap>q.top&&q.bottom+gap>p.top)problems.push(a+' touches '+b);};
   clear('.cx-stepper','[data-lg-spin]',4);clear('.cx-portals','.cx-missions',8);clear('.cx-portals','.cx-frame',8);clear('.cx-result','.cx-frame',8);clear('[data-cx-crew]','.cx-result',4);clear('[data-cx-crew]','.cx-money',4);
   if(box('.cx-energy').right>box('.cx-scene').right||box('.cx-missions').right>box('.cx-scene').right||box('.cx-portals').top<box('.cx-scene').top)problems.push('outside the scene');
   // The heroine keeps at least half of the scene height beside the chat.
   if(box('.cx-alien').height<box('.cx-scene').height*.5)problems.push('small heroine '+box('.cx-alien').height);
   return problems;
  }),state+' '+width+'x'+height).toEqual([]);
 }await page.setViewportSize({width:1440,height:900});};
 const round=async()=>{await page.locator('[data-lg-spin]').click();await expect(game).not.toHaveAttribute('data-phase','idle');await expect.poll(()=>game.evaluate(e=>e.dataset.phase==='idle'&&!e.dataset.animationToken),{timeout:60000}).toBe(true);};
 const points=async(...cents:number[])=>expect((await page.request.post('/__test/layout/crew',{data:{cents}})).ok()).toBe(true);
 await points(...Array(4).fill(1000));await round();await expect(game.locator('[data-cx-crew-gain]')).toHaveText('+33');await whole('progress');
 expect((await page.request.post('/__test/layout/bonus',{data:{gameId:id,scenario:'win'}})).ok()).toBe(true);await round();await whole('win');
 await game.evaluate(root=>{const set=(s:string,t:string)=>{root.querySelector(s)!.textContent=t;};root.querySelector<HTMLElement>('[data-cx-result]')!.dataset.kind='return';set('[data-cx-result-amount]','1 234,56');set('[data-cx-result-title]','Возврат части ставки · Линия 18 · 3 × Космическое щупальце с WILD');set('[data-cx-result-note]','×0,2 от ставки · зачислено на баланс');});await whole('longest result');
 await points(...Array(6).fill(5000));await round();await expect(game).toHaveAttribute('data-crew','new');await whole('new character');
 await game.locator('[data-cx-crew]').click();await game.locator('[data-lg-dialog-action="crew-choose:silver"]').click();await expect(game).toHaveAttribute('data-crew','full');await whole('silver');
 // A lost reply takes the row without touching portals, missions or the field.
 await page.setViewportSize({width:1280,height:720});await page.route('**/api/demo-wallet/expansion',route=>route.abort(),{times:1});await page.locator('[data-lg-spin]').click();
 const retry=page.locator('[data-lg-retry]');await expect(retry).toBeVisible();
 expect(await game.locator('.cx-feedback').evaluate(e=>[...e.querySelectorAll<HTMLElement>('.lg-error,.lg-status,button')].filter(n=>n.offsetParent&&n.scrollHeight>n.clientHeight+3).map(n=>n.textContent))).toEqual([]);
 await retry.click();await finish(page,id);
});

test('Cosmic Escape shows the full price of every mission and charges it once',async({page,roomPath})=>{
 await enterGameHall(page,roomPath);await open(page,'studio-cosmic-escape');
 const game=page.locator('#mini-game > .cx-game'),prices=game.locator('[data-cx-price]');
 const before=await walletSnapshot(page);
 for(const [width,height] of [[1440,900],[393,852],[852,393],[320,568],[568,320]]){
  await page.setViewportSize({width,height});await game.locator('[data-cosmic-missions]').click();
  await expect(prices).toHaveCount(3);await expect(prices).toHaveText([/4,00/,/7,50/,/13,50/]);
  for(const button of await prices.all()){await button.scrollIntoViewIfNeeded();expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);}
  expect(await game.locator('[data-lg-dialog]').evaluate(e=>e.scrollWidth-e.clientWidth)).toBeLessThanOrEqual(1);
  await page.keyboard.press('Escape');await expect(prices.first()).toBeHidden();
 }
 expect((await walletSnapshot(page)).entries).toEqual(before.entries);
 await page.setViewportSize({width:1440,height:900});await game.locator('[data-cosmic-missions]').click();
 const paid=page.waitForResponse(response=>response.url().endsWith('/api/demo-wallet/expansion')&&response.request().method()==='POST');
 await game.locator('[data-lg-dialog-action="buy:ufo-invasion"]').dblclick({noWaitAfter:true}).catch(()=>{});
 expect((await paid).ok()).toBe(true);await finish(page,'studio-cosmic-escape');
 const bets=(await walletSnapshot(page)).entries.filter((entry:any)=>entry.kind==='bet');
 expect(bets).toHaveLength(1);expect(bets[0].amount).toBe(-7.5);
});

test('Cosmic Escape opens, keeps and changes a character without touching the wallet',async({page,roomPath})=>{
 test.setTimeout(240000);await enterGameHall(page,roomPath);await page.setViewportSize({width:1440,height:900});
 const id='studio-cosmic-escape';await open(page,id);
 const game=page.locator('#mini-game > .cx-game'),plate=game.locator('[data-cx-crew]'),dialog=game.locator('[data-lg-dialog]'),figure=game.locator('[data-cosmic-alien]'),spin=page.locator('[data-lg-spin]');
 const points=async(...cents:number[])=>expect((await page.request.post('/__test/layout/crew',{data:{cents}})).ok()).toBe(true);
 const round=async()=>{await spin.click();await expect(game).not.toHaveAttribute('data-phase','idle');await expect.poll(()=>game.evaluate(e=>e.dataset.phase==='idle'&&!e.dataset.animationToken),{timeout:60000}).toBe(true);};
 await expect(game).toHaveAttribute('data-crew','ready');await expect(game.locator('[data-cx-crew-gain]')).toBeEmpty();
 // One paid ten cent round earns exactly one point.
 await round();await expect(game.locator('[data-cx-crew-gain]')).toHaveText('+1');await expect(game.locator('[data-cx-crew-note]')).toContainText('99');
 // A locked capsule shows its silhouette and cannot be chosen.
 await plate.click();await expect(dialog).toHaveAttribute('data-dialog','crew');await expect(dialog.locator('.cx-pod')).toHaveCount(4);await expect(dialog.locator('.cx-pod[data-look="soon"]')).toHaveCount(2);
 await dialog.locator('[data-lg-dialog-action="crew-view:silver"]').click();await expect(dialog.locator('[data-lg-dialog-action="crew-choose:silver"]')).toBeDisabled();
 await page.keyboard.press('Escape');await expect(dialog).toBeHidden();
 expect((await page.request.post('/api/cosmic-crew',{data:{action:'select',characterId:'silver'},headers:{'X-Royal-Account-Id':await page.evaluate(async()=>(await (await fetch('/api/auth/me')).json()).account.id)}})).status()).toBe(403);
 // The threshold is reached while playing. Nothing opens on its own.
 await points(...Array(9).fill(5000));await round();await expect(game).toHaveAttribute('data-crew','new');await expect(dialog).toBeHidden();await expect(game.locator('[data-cx-newcomer]')).toBeVisible();await expect(figure).toHaveAttribute('data-crew','racer');
 const before=(await walletSnapshot(page)).entries;
 await plate.click();await expect(dialog).toHaveAttribute('data-dialog','reveal');await dialog.locator('[data-lg-dialog-action="crew-open"]').click();await expect(dialog).toHaveAttribute('data-dialog','crew');
 await expect(game).toHaveAttribute('data-crew','full');await expect(game.locator('[data-cx-newcomer]')).toBeHidden();
 // The choice is saved, its reply is lost. The game reads the saved choice back.
 await page.route('**/api/cosmic-crew',async route=>{if(route.request().method()!=='POST'){await route.continue();return;}await route.fetch();await route.abort();},{times:1});
 await dialog.locator('[data-lg-dialog-action="crew-choose:silver"]').click();
 await expect(figure).toHaveAttribute('data-crew','silver');await expect(dialog.locator('.cx-pod[data-look="chosen"] b')).toHaveText('Серебряная героиня');await expect(dialog.locator('.cx-crew-message')).toBeEmpty();
 expect(await dialog.evaluate(e=>[e.scrollWidth-e.clientWidth,e.scrollHeight-e.clientHeight])).toEqual([0,0]);
 await page.keyboard.press('Escape');await expect(dialog).toBeHidden();
 expect((await walletSnapshot(page)).entries).toEqual(before);
 // Reels, autoplay and a mission keep the entry closed.
 await page.emulateMedia({reducedMotion:'no-preference'});await spin.click();await expect(game).not.toHaveAttribute('data-phase','idle');
 await expect(plate).toHaveAttribute('aria-disabled','true');await plate.click({force:true});await expect(dialog).toBeHidden();
 await expect.poll(()=>game.evaluate(e=>e.dataset.phase==='idle'&&!e.dataset.animationToken),{timeout:60000}).toBe(true);
 await page.emulateMedia({reducedMotion:'reduce'});
 expect((await page.request.post('/__test/layout/bonus',{data:{gameId:id,scenario:'features'}})).ok()).toBe(true);await spin.click();
 const bonus=page.locator('[data-lg-dialog-action="bonus"]');await expect(bonus).toBeVisible({timeout:60000});await bonus.click();
 await expect(plate).toHaveAttribute('aria-disabled','true');await plate.click({force:true});await expect(dialog.and(page.locator('[data-dialog="crew"]'))).toBeHidden();
 await expect(page.locator('[data-lg-pause]')).toBeEnabled({timeout:15000});await page.locator('[data-lg-pause]').click();await expect(game).toHaveAttribute('data-phase','idle',{timeout:30000});
 if(await game.getAttribute('data-bonus')==='true'){
  // A paused mission shows the crew and keeps the character.
  await plate.click();await expect(dialog).toHaveAttribute('data-dialog','crew');await dialog.locator('[data-lg-dialog-action="crew-view:racer"]').click();await expect(dialog.locator('[data-lg-dialog-action="crew-choose:racer"]')).toBeDisabled();await page.keyboard.press('Escape');
 }
 await finish(page,id);
 // Reopening and reloading keep the character.
 await open(page,id);await expect(figure).toHaveAttribute('data-crew','silver');
 await page.reload();await selectEntryMode(page);await expect.poll(()=>page.evaluate(()=>{try{return (window as any).royalDemo?.getState()?.online;}catch{return false;}}),{timeout:30000}).toBe(true);
 if(await page.locator('#room-overview').getAttribute('aria-pressed')!=='true')await page.locator('#room-overview').click();
 await expect.poll(async()=>{
  if(await page.locator('#mini-dialog').isVisible())return true;
  const cabinet=page.locator('[data-cabinet="studio-cosmic-escape"]');
  try{if(!await cabinet.isVisible())await page.locator('#games-tab').click({timeout:4000});await cabinet.click({timeout:4000});}catch(error){if(!(error instanceof Error&&error.name==='TimeoutError'))throw error;}
  return page.locator('#mini-dialog').isVisible();
 },{timeout:60000,intervals:[1000,4000]}).toBe(true);
 await open(page,id);await expect(figure).toHaveAttribute('data-crew','silver');
});

test('Cosmic Escape stays playable when the crew service fails',async({page,roomPath})=>{
 await page.route('**/api/cosmic-crew',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"unavailable"}'}));
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await enterGameHall(page,roomPath);await page.setViewportSize({width:1440,height:900});await open(page,'studio-cosmic-escape');
 const game=page.locator('#mini-game > .cx-game');await expect(game).toHaveAttribute('data-crew','none');await expect(game.locator('[data-cosmic-alien]')).toHaveAttribute('data-crew','racer');
 await page.locator('[data-lg-spin]').click();await expect(game).not.toHaveAttribute('data-phase','idle');await expect.poll(()=>game.evaluate(e=>e.dataset.phase==='idle'&&!e.dataset.animationToken),{timeout:60000}).toBe(true);
 expect((await walletSnapshot(page)).entries.filter((entry:any)=>entry.kind==='bet')).toHaveLength(1);
 await game.locator('[data-cx-crew]').click();await expect(game.locator('.cx-crew-message')).not.toBeEmpty();await expect(game.locator('[data-lg-dialog-action^="crew-choose"]')).toBeDisabled();
 expect(errors).toEqual([]);
});

/** Collects every distinct position of the Caramel box, board, lid, outcome line and controls, frame by frame. */
async function watchCaramelBox(page:Page){
 await page.evaluate(()=>{
  const root=document.querySelector<HTMLElement>('#mini-game > .ccf')!,seen=new Map<string,string>(),phases=new Set<string>();
  const parts=['.ccf-frame','[data-cc-board]','.ccf-lid','.ccf-outcome','.ccf-bar','.ccf-stepper'];
  let running=true,frames=0;
  const sample=()=>{
   if(!running)return;
   frames++;phases.add(root.dataset.phase+(root.dataset.festival==='true'?'+festival':''));
   for(const part of parts){const b=root.querySelector(part)!.getBoundingClientRect(),key=part+' '+[b.x,b.y,b.width,b.height].map(v=>v.toFixed(1)).join(',');if(!seen.has(key))seen.set(key,String(root.dataset.phase));}
   const spin=root.querySelector<HTMLElement>('[data-cc-spin]')!,key='[data-cc-spin] '+[spin.offsetLeft,spin.offsetTop,spin.offsetWidth,spin.offsetHeight].join(',');if(!seen.has(key))seen.set(key,String(root.dataset.phase));
   requestAnimationFrame(sample);
  };
  (window as any).caramelBox=()=>{running=false;return {frames,phases:[...phases],places:[...seen].map(([key,phase])=>key+' @'+phase),parts:parts.length+1};};
  sample();
 });
 return ()=>page.evaluate(()=>(window as any).caramelBox() as {frames:number;phases:string[];places:string[];parts:number});
}
for(const [width,height,chatOpen] of [[1440,900,true],[1440,900,false],[393,852,false],[852,393,false],[320,568,false],[568,320,false]] as const)test(`Caramel Carnival box never moves through real rounds: ${width}x${height}${chatOpen?' with chat':''}`,async({page,roomPath})=>{
 test.setTimeout(240000);await enterGameHall(page,roomPath);await page.setViewportSize({width,height});await open(page,'studio-caramel-carnival');
 const id='studio-caramel-carnival',chat=page.locator('#club-chat-dock');
 if(await chat.isVisible()!==chatOpen){if(chatOpen||width>=1080)await page.locator('#mini-dialog .game-chat-toggle').click();else await chat.locator('.game-chat-close').click();}
 await page.evaluate(()=>document.fonts.ready.then(()=>new Promise<void>(r=>setTimeout(r,400))));
 await page.emulateMedia({reducedMotion:'no-preference'});const stop=await watchCaramelBox(page);
 const game=page.locator('#mini-game > .ccf');
 for(let round=0;round<3;round++){
  const paid=page.waitForResponse(r=>r.url().endsWith('/api/demo-wallet/expansion')&&r.request().method()==='POST');
  // While the reels move the same button hurries the cascade, so the round ends by its phase and token.
  await page.locator('[data-cc-spin]').click();expect((await paid).ok()).toBe(true);
  await expect.poll(async()=>(await page.locator('[data-cc-action="bonus"]').isVisible())||await game.evaluate(e=>e.dataset.phase==='idle'&&!e.dataset.animationToken),{timeout:60000}).toBe(true);
  if(await page.locator('[data-cc-action="bonus"]').isVisible()){await page.emulateMedia({reducedMotion:'reduce'});await finish(page,id);await page.emulateMedia({reducedMotion:'no-preference'});}
 }
 // A real natural festival: award dialog, free spins, pause, continuation and result.
 const fixture=await page.request.post('/__test/layout/bonus',{data:{gameId:id}});expect(fixture.ok(),await fixture.text()).toBe(true);
 await page.locator('[data-cc-spin]').click();const bonus=page.locator('[data-cc-action="bonus"]');await expect(bonus).toBeVisible({timeout:60000});await bonus.click();
 await expect(page.locator('[data-cc-pause]')).toBeEnabled({timeout:15000});await page.waitForTimeout(2500);await page.locator('[data-cc-pause]').click();
 await expect(game).toHaveAttribute('data-phase','idle',{timeout:30000});await page.waitForTimeout(400);
 const result=await stop();expect(result.frames).toBeGreaterThan(60);
 for(const phase of ['spinning','idle','idle+festival'])expect(result.phases).toContain(phase);
 expect(result.places,JSON.stringify(result.places,null,1)).toHaveLength(result.parts);
 await page.emulateMedia({reducedMotion:'reduce'});await finish(page,id);
});

test('Caramel Carnival box ignores the length of every changing text',async({page,roomPath})=>{
 test.setTimeout(120000);await enterGameHall(page,roomPath);await open(page,'studio-caramel-carnival');
 for(const [width,height] of [[1440,900],[1280,720],[1024,768],[768,1024],[393,852],[852,393],[320,568],[568,320]])await test.step(width+'x'+height,async()=>{
  await page.setViewportSize({width,height});await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
  const moved=await page.locator('#mini-game > .ccf').evaluate(root=>{
   const place=()=>['.ccf-frame','[data-cc-board]','.ccf-outcome','.ccf-bar','[data-cc-cell="0"]'].map(part=>{const b=root.querySelector(part)!.getBoundingClientRect();return [b.x,b.y,b.width,b.height].map(v=>v.toFixed(1)).join(',');}).join(' | ');
   const status=root.querySelector('.ccf-status')!.getBoundingClientRect(),line=root.querySelector('.ccf-outcome')!.getBoundingClientRect();
   if(status.width<100||status.left<line.left-1||status.right>line.right+1||status.bottom>line.bottom+1)return ['status text is not readable in its own line'];
   const before=place(),moved:string[]=[],long='Очень длинная подпись, которая занимает несколько строк и в другом языке бывает ещё длиннее. '.repeat(4);
   for(const name of ['message','phase-title','ticket-help','factor-note','energy-chip','cascade','total','groups','status','error','last','last-label','balance','cost','spin-count','spin-label','fest-win','fest-count','ticket-count','wallet-note']){
    const el=root.querySelector<HTMLElement>(`[data-cc-${name}]`)!,html=el.innerHTML,hidden=el.hidden,state={...root.dataset};
    for(const text of ['',long])for(const [phase,win,festival,notice] of [['idle','false','false','false'],['spinning','false','false','false'],['winning','true','false','false'],['idle','true','true','false'],['idle','true','false','true']]){
     el.hidden=false;el.textContent=text;Object.assign(root.dataset,{phase,hasWin:win,festival,notice});
     if(place()!==before)moved.push(name+' "'+text.slice(0,6)+'" '+phase+'/'+festival+': '+before+' -> '+place());
    }
    el.innerHTML=html;el.hidden=hidden;Object.assign(root.dataset,state);
   }
   return moved;
  });
  expect(moved).toEqual([]);
 });
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
 const cosmic=id==='studio-cosmic-escape'||id==='studio-caramel-carnival',caramel=id==='studio-caramel-carnival',nitro=id==='studio-nitro-run';
 const cabinet=caramel?{fast:'[data-cc-speed-option="fast"]',cycle:'[data-cc-speed-cycle]',panel:'[data-cc-auto-panel]',count:'[data-cc-auto-count="25"]',start:'[data-cc-auto-start]',purchase:'[data-cc-buy]'}
  :{fast:'[data-cx-speed="fast"]',cycle:'[data-cx-speed-cycle]',panel:'[data-cx-auto-panel]',count:'[data-cx-auto-count="25"]',start:'[data-cx-auto-start]',purchase:'[data-cosmic-missions]'};
 const fastSpeed=()=>cosmic?expect(page.locator('#mini-game '+cabinet.fast)).toHaveAttribute('aria-checked','true'):expect(page.locator(`[data-${p}-speed]`)).toHaveAttribute('aria-pressed','true');
 const convoy=id==='studio-last-convoy';
 const usesSettingsCount=!cosmic&&!nitro&&!convoy;
 if(!cosmic){
  if(usesSettingsCount)await page.locator(`[data-${p}-auto-count]`).selectOption('25');
  await page.locator(`[data-${p}-speed]`).click();
 }
 expect(errors).toEqual([]);
 if(!cosmic)await fastSpeed();
 if(id==='studio-velvet-reign'||id==='studio-afterglow')await page.screenshot({path:out+'/'+id+'-options.png'});
 await page.setViewportSize({width:852,height:393});await page.keyboard.press('Escape');await expect(page.locator('.slot-settings-dialog')).toBeHidden();await expect(page.locator('.slot-settings-button')).toBeFocused();
 if(cosmic){await page.locator('#mini-game '+cabinet.cycle).click();await fastSpeed();}
 await fit(page,id);await page.setViewportSize({width:1440,height:900});await fit(page,id);
 await fastSpeed();
 if(usesSettingsCount)await expect(page.locator(`[data-${p}-auto-count]`)).toHaveValue('25');
 await page.setViewportSize({width:393,height:852});
 await page.locator('.slot-settings-button').click();await fastSpeed();await page.keyboard.press('Escape');
 let release!:()=>void;const gate=new Promise<void>(r=>release=r);let request:any;
 await page.route('**/api/demo-wallet/expansion',async route=>{if(route.request().method()==='POST'){request=route.request().postDataJSON();await gate;}await route.continue();});
 const response=page.waitForResponse(r=>r.url().endsWith('/api/demo-wallet/expansion')&&r.request().method()==='POST');
 await page.locator(`[data-${p}-auto]`).click();
 if(nitro){const panel=page.locator('[data-nr-auto-panel]');await expect(panel).toBeVisible();await panel.locator('[data-nr-auto-count="25"]').click();expect(request).toBeUndefined();await expect(panel.locator('[data-nr-auto-total]')).toHaveText('2,50');await panel.locator('[data-nr-auto-start]').click();await expect(panel).toBeHidden();}
 if(cosmic){const panel=page.locator('#mini-game '+cabinet.panel);await expect(panel).toBeVisible();await panel.locator(cabinet.count).click();await panel.locator(cabinet.start).click();await expect(panel).toBeHidden();}
 if(convoy){
  const panel=page.getByRole('dialog',{name:'Автоигра'});
  await expect(panel.getByRole('radio',{name:'25'})).toBeChecked();
  await panel.getByRole('button',{name:'Запустить 25 вращений'}).click();
  await expect(panel).toBeHidden();
 }
 await expect.poll(()=>!!request).toBe(true);expect(request.stakeUnits).toBe('10');
 await expect(page.locator(`[data-${p}-auto]`)).toContainText('Стоп');await page.setViewportSize({width:852,height:393});await fit(page,id);
 await page.locator(`[data-${p}-auto]`).click();release();const paid=await response;expect(paid.ok(),await paid.text()).toBe(true);
 await finish(page,id);await page.unroute('**/api/demo-wallet/expansion');
 const snapshot=await walletSnapshot(page),bets=snapshot.entries.filter((e:any)=>e.kind==='bet');expect(bets).toHaveLength(1);expect(bets[0].amount).toBe(-0.1);
 await open(page,id);await finish(page,id);expect((await walletSnapshot(page)).entries).toEqual(snapshot.entries);await fit(page,id);
 for(const kind of ['info','history','purchase']){
  const selector=kind==='purchase'?'[data-cc-buy],[data-cosmic-missions],[data-velvet-missions]':`[data-${p}-${kind}]`;
  // Cosmic Escape keeps missions and Caramel Carnival keeps the festival purchase on the cabinet.
  // Last Convoy keeps rules and history in its header and the evacuation help in the beacon card.
  if(cosmic&&kind==='purchase')await page.locator('#mini-game').locator(cabinet.purchase).click();
  else if(convoy)await page.locator('#mini-game').locator(selector).click();
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
  await page.locator(`[data-${p}-spin]`).click();await expect(page.locator('#mini-game > .slot-priority-game, #mini-game > .cx-game, #mini-game > .cc-game.ccf, #mini-game > .ag-game')).not.toHaveAttribute('data-phase','idle');
  await page.setViewportSize({width:852,height:393});await fit(page,id);await page.setViewportSize({width:393,height:852});await fit(page,id);
  await page.emulateMedia({reducedMotion:'reduce'});await finish(page,id);
 }
});

test('album, photo and themed menu remain accessible on a phone',async({page,roomPath})=>{
 await enterGameHall(page,roomPath);await page.setViewportSize({width:393,height:852});await open(page,'studio-afterglow');
 const before=(await walletSnapshot(page)).entries;
 // The studio cabinet keeps the heroine strip with photo and album above the field on phones.
 await page.locator('.slot-settings-button').click();await page.screenshot({path:out+'/studio-afterglow-options.png'});await page.keyboard.press('Escape');
 await page.locator('#mini-game [data-ag-album]').click();await expect(page.getByRole('heading',{name:'АЛЬБОМ ГЕРОИНЬ',exact:true})).toBeVisible();
 await page.keyboard.press('Escape');await page.locator('#mini-game [data-ag-photo]').click();await expect(page.locator('.slot-photo-viewer')).toBeVisible();
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
   if(id==='studio-last-convoy')for(const [width,height]of [[393,852],[1512,862]]){
    // The accepted stake replaces the stake field during the evacuation, and the spin count is declined.
    await page.setViewportSize({width,height});await fit(page,id);
    await expect(page.locator('#mini-game [data-cc-stake]')).toBeHidden();
    const accepted=page.locator('#mini-game [data-cv-accepted]');
    await expect(accepted).toBeVisible();await expect(accepted).toHaveText('Ставка 0,10 уже принята. Вращения эвакуации бесплатны.');
    const plate=await accepted.evaluate(e=>({scroll:e.scrollWidth,client:e.clientWidth}));expect(plate.scroll,`${width}x${height}: accepted stake is clipped`).toBeLessThanOrEqual(plate.client);
    await expect(page.locator('#mini-game [data-cc-pause]')).toHaveAttribute('aria-pressed','false');
    await expect(page.locator('#mini-game [data-cc-spin]')).toHaveAccessibleName('Далее');
    if(width===1512){
     // The mechanics column shows the evacuation cards of the mockup: spins, locked defense and the evacuation win.
     const session=await currentSession(page,id),bonusView=session.view.convoy.bonus;
     await expect(page.locator('#mini-game .cv-freecard')).toBeVisible();await expect(page.locator('#mini-game .cv-beacons')).toBeHidden();await expect(page.locator('#mini-game .cv-round')).toBeHidden();
     await expect(page.locator('#mini-game [data-cv-played]')).toHaveText(String(bonusView.played));await expect(page.locator('#mini-game [data-cv-awarded]')).toHaveText(String(bonusView.awarded));
     await expect(page.locator('#mini-game [data-cv-fsegs] > i')).toHaveCount(bonusView.awarded);
     await expect(page.locator('#mini-game .cv-defense .cv-tag')).toBeVisible();
     await expect(page.locator('#mini-game [data-cv-evac]')).toHaveText((await page.locator('#mini-game [data-cc-total]').textContent())!);
     for(const card of ['.cv-freecard','.cv-defense','.cv-evac']){const box=await page.locator('#mini-game '+card).evaluate(e=>({scroll:e.scrollWidth,client:e.clientWidth}));expect(box.scroll,card+' overflows').toBeLessThanOrEqual(box.client);}
    }
    const free=(await page.locator('#mini-game [data-cc-free]').textContent())??'',count=Number(free.split(' ')[0]),form=({one:'бесплатное вращение',few:'бесплатных вращения'} as Record<string,string>)[new Intl.PluralRules('ru').select(count)]??'бесплатных вращений';
    expect(free).toBe(`${count} ${form}`);
   }
   if(id==='studio-last-convoy'){await page.setViewportSize({width:393,height:852});await fit(page,id);}
   await page.screenshot({path:out+'/'+id+'-bonus-portrait.png'});await page.setViewportSize({width:852,height:393});await fit(page,id);
   await page.screenshot({path:out+'/'+id+'-bonus-landscape.png'});await finish(page,id);
   expect((await walletSnapshot(page)).entries.filter((e:any)=>e.kind==='bet')).toHaveLength(debits);
  });
 }
});

test('Last Convoy scales the field, Maya and controls at 2K and 4K',async({page,roomPath})=>{
 const game='studio-last-convoy';
 await enterGameHall(page,roomPath);
 await open(page,game);
 const root=page.locator('#mini-game > .cv-game');
 const chat=page.locator('#club-chat-dock');
 const toggle=page.locator('#mini-dialog .game-chat-toggle');
 if(!await chat.isVisible())await toggle.click();
 await expect(chat.locator('#chat-input')).toBeVisible();
 const measure=async()=>root.evaluate(e=>{
  const board=e.querySelector('[data-cc-board]')!.getBoundingClientRect();
  const character=e.querySelector('.cv-portrait')!.getBoundingClientRect();
  const spin=e.querySelector('[data-cc-spin]')!.getBoundingClientRect();
  return {width:board.width,height:board.height,character:character.height,spin:spin.height,
   type:parseFloat(getComputedStyle(e.querySelector('.cv-result')!).fontSize)};
 });
 await fit(page,game);
 const base=await measure();
 for(const [width,height] of [[2560,1440],[3840,2160]]){
  await page.setViewportSize({width,height});
  await fit(page,game);
  const expanded=await measure();
  expect(expanded.width).toBeGreaterThan(base.width*1.25);
  expect(expanded.type).toBeGreaterThan(base.type*1.25);
  expect(expanded.character).toBeGreaterThan(base.character);
  expect(expanded.spin).toBeGreaterThan(base.spin);
  expect(expanded.width/expanded.height).toBeCloseTo(1.2,2);
 }
 await page.setViewportSize({width:2560,height:1440});
 await fit(page,game);
 const withChat=await measure();
 await chat.locator('.game-chat-close').click();
 await fit(page,game);
 expect(Math.abs((await measure()).width-withChat.width)).toBeLessThan(4);
 // The mockup's display face, round log and dock toggles are in place.
 await page.evaluate(()=>document.fonts.ready);
 expect(await page.evaluate(()=>document.fonts.check('700 32px "Convoy Oswald"','LAST CONVOY ЭВАКУАЦИЯ'))).toBe(true);
 expect(await root.locator('.cv-logo').evaluate(e=>getComputedStyle(e).fontFamily)).toContain('Convoy Oswald');
 await expect(root.locator('.cv-round')).toBeVisible();
 const fast=root.locator('[data-cv-fast]');await expect(fast).toBeVisible();await expect(fast).toHaveAttribute('aria-pressed','false');
 await fast.click();await expect(fast).toHaveAttribute('aria-pressed','true');await expect(root.locator('[data-cc-speed]')).toHaveAttribute('aria-pressed','true');
 await fast.click();await expect(fast).toHaveAttribute('aria-pressed','false');
 await expect(root.locator('[data-cc-auto]')).toHaveText(/Авто · 25/);
 // A short desktop window without the chat sets Maya aside and gives her space to the field.
 const short=async()=>{await page.setViewportSize({width:1280,height:680});await fit(page,game);return root.evaluate(e=>({maya:getComputedStyle(e.querySelector('.cv-radio')!).display,round:getComputedStyle(e.querySelector('.cv-round')!).display,board:e.querySelector('[data-cc-board]')!.getBoundingClientRect().height}));};
 const closed=await short();expect(closed.maya).toBe('none');expect(closed.round).toBe('none');expect(closed.board).toBeGreaterThan(395);
});

const countOnlyGames=['studio-last-convoy','studio-cosmic-escape','studio-caramel-carnival','studio-meme-overload'];

for(const game of countOnlyGames)test('count-only autoplay fits the connected host: '+game,async({page,roomPath})=>{
 await enterGameHall(page,roomPath);
 await open(page,game);
 const chat=page.locator('#club-chat-dock');
 if(!await chat.isVisible())await page.locator('#mini-dialog .game-chat-toggle').click();
 await expect(chat.locator('#chat-input')).toBeVisible();
 const auto=page.locator(`[data-${family(game)}-auto]`);
 const dialog=page.getByRole('dialog',{name:'Автоигра',exact:true});
 const before=await walletSnapshot(page);
 if(game==='studio-last-convoy'){
  const stake=page.locator('[data-manual-stake]');
  await stake.fill('0,001');
  await auto.click();
  await expect(dialog).toBeHidden();
  await stake.fill('0,10');
 }
 await auto.click();
 await expect(dialog.getByRole('textbox')).toHaveCount(0);
 await expect(dialog.getByRole('checkbox')).toHaveCount(0);
 await expect(dialog.getByRole('button',{name:'Запустить 25 вращений'})).toBeVisible();
 for(const count of [10,50,100,25]){
  await dialog.getByText(String(count),{exact:true}).click();
  await expect(dialog.getByRole('button',{name:`Запустить ${count} вращений`})).toBeVisible();
 }
 await page.keyboard.press('Escape');
 await expect(dialog).toBeHidden();
 await expect(auto).toBeFocused();
 for(const [width,height] of [[393,852],[852,393],[568,320]]){
  await page.setViewportSize({width,height});
  if(await chat.isVisible())await chat.locator('.game-chat-close').click();
  await auto.click();
  await expect(dialog).toBeInViewport({ratio:1});
  await expect(dialog.getByRole('button',{name:'Запустить 25 вращений'})).toBeInViewport({ratio:1});
  await page.keyboard.press('Escape');
 }
 expect((await walletSnapshot(page)).entries).toEqual(before.entries);
});

for(const game of countOnlyGames)test('autoplay completes ten paid spins through a natural bonus: '+game,async({page,roomPath})=>{
 await enterGameHall(page,roomPath);
 await open(page,game);
 const fixture=await page.request.post('/__test/layout/bonus',{data:{gameId:game}});
 expect(fixture.ok(),await fixture.text()).toBe(true);
 const prefix=family(game),action=prefix==='lg'?'data-lg-dialog-action':'data-cc-action';
 const root=page.locator('#mini-game > [data-auto-remaining]');
 const bonus=page.locator(`[${action}="bonus"]`);
 const complete=page.locator(`[${action}="complete"]`);
 const bets=async()=>(await walletSnapshot(page)).entries.filter((entry:{kind:string})=>entry.kind==='bet');
 await page.locator(`[data-${prefix}-auto]`).click();
 const dialog=page.getByRole('dialog',{name:'Автоигра',exact:true});
 await dialog.getByText('10',{exact:true}).click();
 await dialog.getByRole('button',{name:'Запустить 10 вращений'}).click();
 await expect(bonus).toBeVisible();
 await expect(root).toHaveAttribute('data-auto-remaining','9');
 expect(await bets()).toHaveLength(1);
 await bonus.click();
 await expect(complete).toBeVisible({timeout:60000});
 await expect(root).toHaveAttribute('data-auto-remaining','9');
 expect(await bets()).toHaveLength(1);
 await complete.click();

 await expect.poll(async()=>{
  if(await bonus.isVisible())await bonus.click();
  if(await complete.isVisible())await complete.click();
  return Number(await root.getAttribute('data-auto-remaining'));
 },{timeout:90000}).toBe(0);
 await finish(page,game);
 const paid=await bets();
 expect(paid).toHaveLength(10);
 expect(paid.every((entry:{amount:number})=>entry.amount===-0.1)).toBe(true);
});

test('GIRLHUB keeps autoplay results visible and scrolls in tiny windows',async({page,roomPath})=>{
 test.setTimeout(240000);await enterGameHall(page,roomPath);await page.setViewportSize({width:1440,height:900});await open(page,'studio-afterglow');
 // Between autoplay spins the progress note is announced but must not cover the confirmed result line.
 await page.locator('[data-cc-auto]').click();
 const between=await page.waitForFunction(()=>{
  const status=document.querySelector('[data-cc-status]')?.textContent??'';if(!status.includes('Платных вращений осталось'))return false;
  const message=document.querySelector<HTMLElement>('[data-cc-message]')!,box=message.getBoundingClientRect();
  const hit=document.elementFromPoint(box.left+Math.min(24,box.width/2),box.top+box.height/2);
  return {status,message:message.textContent,covered:!message.contains(hit)};
 },undefined,{timeout:60000,polling:50});
 const seen=await between.jsonValue() as {covered:boolean;message:string};
 expect(seen.covered,seen.message).toBe(false);
 await page.locator('[data-cc-auto]').click();await expect(page.locator('[data-cc-auto]')).not.toContainText('Стоп');await finish(page,'studio-afterglow');
 // A window smaller than the smallest readable cabinet scrolls inside the module instead of clipping the dock.
 for(const [width,height]of [[400,480],[480,300]]){
  await page.setViewportSize({width,height});await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
  const root=page.locator('#mini-game > .ag-game');await expect(root).toHaveAttribute('data-cramped','true');
  const spin=page.locator('[data-cc-spin]');await spin.scrollIntoViewIfNeeded();
  const reachable=await spin.evaluate(button=>{const box=button.getBoundingClientRect(),root=button.closest('.ag-game')!.getBoundingClientRect();
   const hit=document.elementFromPoint(box.left+box.width/2,box.top+box.height/2);
   return !!hit&&button.contains(hit)&&box.top>=root.top-1&&box.bottom<=root.bottom+1;});
  expect(reachable,width+'x'+height).toBe(true);
 }
 await page.setViewportSize({width:1440,height:900});await expect(page.locator('#mini-game > .ag-game')).toHaveAttribute('data-cramped','false');
});

test('Meme Overload keeps the field in place through real rounds and the virus mode',async({page,roomPath})=>{
 const game='studio-meme-overload';test.setTimeout(240000);await page.emulateMedia({reducedMotion:'no-preference'});
 await enterGameHall(page,roomPath);await page.emulateMedia({reducedMotion:'no-preference'});await open(page,game);
 const root=page.locator('#mini-game > .mo-game'),spin=page.locator('[data-cc-spin]'),bonus=page.locator('[data-cc-action="bonus"]'),complete=page.locator('[data-cc-action="complete"]');
 for(const [width,height] of [[1440,900],[393,852],[852,393]]){
  await page.setViewportSize({width,height});await fit(page,game);
  await root.evaluate(element=>{
   const box=()=>['.cc-board','.mo-status','.mo-round','.cc-spin','.mo-stake'].map(name=>{const b=element.querySelector(name)!.getBoundingClientRect();return [b.x,b.y,b.width,b.height].map(Math.round).join();});
   const start=box(),moved=new Set<string>();(element as any).moved=moved;(element as any).watching=true;
   const tick=()=>{if(!(element as any).watching)return;box().forEach((value,i)=>{if(value!==start[i])moved.add(i+': '+start[i]+' > '+value+' '+(element as HTMLElement).dataset.phase);});requestAnimationFrame(tick);};tick();
  });
  const fixture=await page.request.post('/__test/layout/bonus',{data:{gameId:game}});expect(fixture.ok(),await fixture.text()).toBe(true);
  await spin.click();await expect(bonus).toBeVisible({timeout:40000});await bonus.click();
  await expect(root).toHaveAttribute('data-virus','true');await expect(page.locator('[data-mo-free-count]')).toContainText(' из 8');
  await expect(complete).toBeVisible({timeout:120000});await complete.click();await expect(spin).toBeEnabled();
  expect(await root.evaluate(element=>{(element as any).watching=false;return [...(element as any).moved];}),width+'x'+height).toEqual([]);
 }
});

test('Meme Overload shows English labels in every window',async({page,roomPath})=>{
 const game='studio-meme-overload';test.setTimeout(180000);await enterGameHall(page,roomPath);
 await page.goto(roomPath+'&lang=en');await selectEntryMode(page);
 // A full navigation can reach the hall before its previous presence lease expires.
 await expect.poll(async()=>{
  if(await page.evaluate(()=>{try{return (window as any).royalDemo?.getState()?.online;}catch{return false;}}))return true;
  const retry=page.locator('#retry-entry');if(await retry.isVisible()&&await retry.isEnabled())await retry.click();return false;
 },{timeout:60000,intervals:[1000,5000]}).toBe(true);
 await expect.poll(async()=>{
  if(await page.locator('#mini-dialog').isVisible())return true;
  try{
   if(await page.locator('#room-overview').getAttribute('aria-pressed')!=='true')await page.locator('#room-overview').click({timeout:4000});
   const cabinet=page.locator('[data-cabinet="studio-cosmic-escape"]');if(!await cabinet.isVisible())await page.locator('#games-tab').click({timeout:4000});
   await cabinet.click({timeout:4000});
  }catch(error){if(!(error instanceof Error&&error.name==='TimeoutError'))throw error;}
  return page.locator('#mini-dialog').isVisible();
 },{timeout:60000,intervals:[1000,4000]}).toBe(true);
 await chooseGame(page,game);const root=page.locator('#mini-game > .mo-game');await expect(root).toHaveAttribute('data-asset-state','ready',{timeout:40000});
 const cyrillic=/[А-Яа-яЁё]/,labels=async(selector:string)=>page.locator(selector).evaluateAll(nodes=>nodes.flatMap(node=>[node as HTMLElement,...node.querySelectorAll<HTMLElement>('*')]).flatMap(node=>[...node.childNodes].filter(child=>child.nodeType===3).map(child=>child.textContent!.trim()).concat(node.getAttribute('aria-label')??'')).filter(Boolean));
 const english=async(selector:string)=>expect((await labels(selector)).filter(text=>cyrillic.test(text))).toEqual([]);
 await english('#mini-game > .mo-game');await english('.mo-headbar');
 await page.locator('[data-cc-action="enter"]').click();await english('#mini-game > .mo-game');
 const fixture=await page.request.post('/__test/layout/bonus',{data:{gameId:game}});expect(fixture.ok(),await fixture.text()).toBe(true);
 await page.locator('[data-cc-auto]').click();await english('[data-mo-auto-panel]');await page.keyboard.press('Escape');
 await page.locator('[data-mo-quick="info"]').click();await english('[data-cc-dialog]');await page.keyboard.press('Escape');
 await page.locator('[data-cc-spin]').click();await expect(page.locator('[data-cc-action="bonus"]')).toBeVisible({timeout:40000});await english('#mini-game > .mo-game');
 await page.locator('[data-cc-action="bonus"]').click();await expect(page.locator('[data-cc-action="complete"]')).toBeVisible({timeout:120000});await english('#mini-game > .mo-game');
 for(const [width,height] of [[393,852],[852,393],[320,568],[568,320]]){
  await page.setViewportSize({width,height});await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
  const clipped=await root.evaluate(element=>[...element.querySelectorAll<HTMLElement>('.mo-bar button, .mo-window h3, .mo-round, .mo-stake-text, .cc-primary')].filter(node=>node.getClientRects().length&&node.scrollWidth>node.clientWidth+1).map(node=>node.className+': '+node.textContent));
  expect(clipped,width+'x'+height).toEqual([]);
 }
});

test('Meme Overload restores the same round after a lost reply without a second debit',async({page,roomPath})=>{
 const game='studio-meme-overload';await enterGameHall(page,roomPath);await open(page,game);
 const before=(await walletSnapshot(page)).entries.filter((entry:{kind:string})=>entry.kind==='bet').length,ids:string[]=[];
 let lose=true;
 await page.route('**/api/demo-wallet/expansion',async route=>{
  if(route.request().method()!=='POST'){await route.continue();return;}
  ids.push(route.request().postDataJSON().id);
  if(lose){lose=false;await route.fetch();await route.abort('connectionreset');return;}
  await route.continue();
 });
 await page.locator('[data-cc-spin]').click();
 const retry=page.locator('[data-cc-retry]');await expect(retry).toBeVisible({timeout:60000});
 for(const [width,height] of [[1440,900],[393,852],[852,393],[320,568],[568,320]]){
  await page.setViewportSize({width,height});await expect(retry).toBeInViewport({ratio:1});
  const rows=await page.locator('#mini-game > .mo-game').evaluate(element=>{
   const box=(name:string)=>element.querySelector(name)!.getBoundingClientRect(),notice=box('[data-cc-feedback]'),board=box('.cc-board'),total=box('[data-cc-total]');
   const over=(a:DOMRect,b:DOMRect)=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1;
   return {board:over(notice,board),total:over(notice,total)};
  });
  expect(rows,width+'x'+height).toEqual({board:false,total:false});
 }
 await page.setViewportSize({width:1440,height:900});await retry.click();await expect(retry).toBeHidden({timeout:30000});
 await finish(page,game);
 expect(new Set(ids).size).toBe(1);
 expect((await walletSnapshot(page)).entries.filter((entry:{kind:string})=>entry.kind==='bet').length).toBe(before+1);
});

test('Meme Overload looks the same after other themed slots',async({page,roomPath})=>{
 await enterGameHall(page,roomPath);const game='studio-meme-overload',root=page.locator('#mini-game > .mo-game');
 const look=()=>root.evaluate(element=>['','.mo-title','.cc-board','.cc-cell','.mo-status','.mo-status-main','.mo-round','.mo-window','.mo-window h3','[data-cc-factor]','.mo-bar','.mo-money','.mo-stake','[data-manual-stake]','[data-cc-stake-step]','.mo-speed','.mo-auto','.cc-spin'].map(name=>{
  const node=name?element.querySelector<HTMLElement>(name)!:element as HTMLElement,style=getComputedStyle(node),box=node.getBoundingClientRect();
  return [name,Math.round(box.width),Math.round(box.height),style.fontFamily,style.fontSize,style.fontWeight,style.color,style.backgroundColor,style.borderRadius,style.borderWidth,style.padding,style.letterSpacing,style.boxShadow,style.transform].join('|');
 }));
 await open(page,game);await expect(page.getByRole('heading',{name:'MEME OVERLOAD',exact:true})).toBeVisible();const clean=await look();
 for(const other of ['studio-caramel-carnival','studio-nitro-run']){await open(page,other);await open(page,game);expect(await look(),other).toEqual(clean);}
});

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
});

const countOnlyGames=['studio-last-convoy','studio-cosmic-escape','studio-caramel-carnival'];

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

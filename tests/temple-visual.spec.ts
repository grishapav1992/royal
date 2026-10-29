import {test,expect,request as apiRequest,type Page} from '@playwright/test';
import {Client} from '@colyseus/sdk';
import {mkdir,writeFile} from 'node:fs/promises';
import sharp from 'sharp';
const scope='artifacts/work/temple-visual-acceptance';
const game=(p:Page)=>p.frameLocator('.temple-frame');
const state=(p:Page)=>p.evaluate(()=>(window as any).templePreview?.state()??(window as any).royalDemo?.getMiniState());
const session=(p:Page)=>p.evaluate(()=>(window as any)[Symbol.for('royal.game-host.v1')].expansionClient.sessions.find((s:any)=>s.gameId==='studio-flooded-temple'));
const balance=(p:Page)=>p.evaluate(()=>(window as any)[Symbol.for('royal.game-host.v1')].demoWallet.wallet.balance);
async function ready(p:Page,scenario='cascade-seed-15',lang='en',reduced=true){await p.context().setExtraHTTPHeaders({'x-temple-test-case':scenario});await p.emulateMedia({reducedMotion:reduced?'reduce':'no-preference'});await p.goto('/tests/fixtures/temple-preview.html?lang='+lang);await expect(game(p).locator('[data-ft=primary]')).toBeEnabled();await expect.poll(async()=>(await state(p)).character.loaded.length).toBe(6);}
async function done(p:Page){await expect.poll(async()=>{const s=await state(p);return s?.completed&&!s.busy&&!s.presenting;},{timeout:60000}).toBe(true);}
async function report(name:string,value:unknown){await mkdir(scope,{recursive:true});await writeFile(`${scope}/${name}.json`,JSON.stringify(value,null,2)+'\n');}

test('changing the next stake cannot rescale an accepted payout, net or result label',async({page})=>{
  await ready(page);await game(page).locator('[data-ft=primary]').click();await done(page);const accepted=await session(page),before=await balance(page),values:any[]=[];
  for(const selected of['50000','2000','1000']){
    await game(page).locator('[data-ft=stake]').selectOption(selected);await expect(game(page).locator('[data-ft-value=payout]')).toHaveText('2.50');await expect(game(page).locator('[data-ft-value=net]')).toHaveText('Round net -7.50');await expect(game(page).locator('.ft-fall-award')).toHaveText('PARTIAL RETURN · 2.50');expect((await state(page)).feedback.effects.shownUnits).toBe('250');expect(await session(page)).toEqual(accepted);expect(await balance(page)).toBe(before);values.push({selected,payout:'2.50',net:'-7.50'});
  }
  await game(page).locator('[data-ft=stake]').selectOption('2000');await page.context().setExtraHTTPHeaders({'x-temple-test-case':'cascade-seed-15-second'});await game(page).locator('[data-ft=primary]').click();await done(page);expect((await session(page)).stakeUnits).toBe('2000');await expect(game(page).locator('[data-ft-value=payout]')).toHaveText('5.00');await expect(game(page).locator('[data-ft-value=net]')).toHaveText('Round net -15.00');expect(await balance(page)).toBe(before-20+5);
  await report('accepted-stake',{values,nextPaidStakeUnits:'2000',nextPayoutUnits:'500',balanceMatched:true});
});

test('five complete-round outcomes stay explicit in RU/EN across every allowed stake',async({page})=>{
  const rows:any[]=[];
  const outcomes=[{case:'cascade-blank',kind:'loss',label:['БЕЗ ВЫПЛАТЫ','NO PAYOUT'],points:0},{case:'cascade-seed-15',kind:'partial',label:['ЧАСТИЧНЫЙ ВОЗВРАТ','PARTIAL RETURN'],points:5},{case:'cascade-seed-7',kind:'return',label:['СТАВКА ВОЗВРАЩЕНА','STAKE RETURNED'],points:20},{case:'cascade-seed-5',kind:'win',label:['ВЫИГРЫШ','ROUND WIN'],points:45},{case:'cascade-cap',kind:'big',label:['ПРЕДЕЛ 500×','500× LIMIT'],points:10000}];
  for(const [i,lang]of ['ru','en'].entries()){
    await ready(page,'cascade-blank',lang);for(const outcome of outcomes){
      await page.context().setExtraHTTPHeaders({'x-temple-test-case':outcome.case+'-visual-'+lang});if(outcome.case==='cascade-blank'||outcome.case==='cascade-cap')await page.context().setExtraHTTPHeaders({'x-temple-test-case':outcome.case});
      await game(page).locator('[data-ft=stake]').selectOption('1000');await game(page).locator('[data-ft=primary]').click();await done(page);const s=await session(page);expect(s.returnedUnits).toBe(String(outcome.points*50));await expect(game(page).locator('.ft-fall-award')).toContainText(outcome.label[i]);await expect(game(page).locator('.ft')).toHaveAttribute('data-outcome',outcome.kind);rows.push({lang,kind:outcome.kind,payoutUnits:s.returnedUnits});
    }
    await page.setViewportSize({width:360,height:740});await page.context().setExtraHTTPHeaders({'x-temple-test-case':'cascade-cap'});
    for(const stake of['1000','2000','5000','10000','20000','50000']){await game(page).locator('[data-ft=stake]').selectOption(stake);await game(page).locator('[data-ft=primary]').click();await done(page);const s=await session(page);expect(s.returnedUnits).toBe(String(BigInt(stake)*500n));const geometry=await game(page).locator('.ft').evaluate(root=>{const result=root.querySelector('.ft-collected-total')!;return{width:root.clientWidth,scroll:root.scrollWidth,resultWidth:result.clientWidth,resultScroll:result.scrollWidth,netFont:parseFloat(getComputedStyle(root.querySelector('.ft-net')!).fontSize)};});expect(geometry.scroll).toBeLessThanOrEqual(geometry.width+1);expect(geometry.resultScroll).toBeLessThanOrEqual(geometry.resultWidth+1);expect(geometry.netFont).toBeGreaterThanOrEqual(12);rows.push({lang,stake,payoutUnits:s.returnedUnits,...geometry});}
    await page.setViewportSize({width:1440,height:1000});
  }
  await report('outcomes',rows);
});

test('skip finishes every remaining free continuation quietly and resets for the next paid round',async({page})=>{
  await ready(page,'cascade-seed-118','en',false);await page.evaluate(()=>(window as any).templePreview.audio.setMuted(true));await game(page).locator('[data-ft=mute]').click();await expect.poll(async()=>(await state(page)).audio.ready).toBe(true);
  const posts:any[]=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/expansion'))posts.push(r.postDataJSON());});await game(page).locator('[data-ft=primary]').click();await expect.poll(async()=>(await state(page)).presenting).toBe(true);const initial=await state(page);expect((await session(page)).state).toBe('active');
  await game(page).locator('[data-ft=primary]').click();const afterSkip=await state(page);await done(page);const final=await state(page),paid=await session(page);
  expect(paid.view.templeCascade.state.falls).toBe(31);expect(paid.view.templeCascade.state.playedFreeSpins).toBe(20);expect(paid.returnedUnits).toBe('30250');expect(posts.filter(p=>p.action==='start').length).toBe(1);expect(posts.filter(p=>p.action==='move').length).toBe(1);expect(final.feedback.frames).toEqual(initial.feedback.frames);expect(final.audio.played).toEqual(afterSkip.audio.played);expect(final.decorationsSkipped).toBe(true);await expect(game(page).locator('[data-ft-value=net]')).toHaveText('Round net +292.50');
  await report('skip',{paidStarts:1,continuations:1,falls:31,freeSpins:20,payoutUnits:paid.returnedUnits,decoratedPhases:final.feedback.frames.map((f:any)=>f.kind),noNewCueAfterSkip:true,view:paid.view.templeCascade});
  await page.context().setExtraHTTPHeaders({'x-temple-test-case':'cascade-seed-15-after-skip'});await game(page).locator('[data-ft=primary]').click();await expect.poll(async()=>(await state(page)).presenting).toBe(true);expect((await state(page)).decorationsSkipped).toBe(false);await done(page);
});

test('ordinary bonus retains every confirmed phase and the existing pacing',async({page})=>{
  await ready(page,'cascade-seed-118','en',false);const started=Date.now();await game(page).locator('[data-ft=primary]').click();await expect(game(page).locator('.ft-fall-award')).toContainText('FREE SPINS',{timeout:20000});await done(page);const s=await state(page),v=(await session(page)).view.templeCascade;
  expect(s.feedback.frames.filter((f:any)=>f.kind==='drop').length).toBe(31);expect(s.feedback.frames.filter((f:any)=>f.kind==='bonus').length).toBe(1);expect(s.feedback.frames.filter((f:any)=>f.kind==='base-return').length).toBe(1);expect(v.totalPayoutUnits).toBe('30250');expect(s.feedback.effects.maxNodes).toBeLessThanOrEqual(60);await expect(game(page).locator('.ft-fall-award')).toHaveText('BIG WIN · 302.50');await report('ordinary-bonus',{elapsedMs:Date.now()-started,phaseOrder:s.feedback.frames.map((f:any)=>({kind:f.kind,fall:f.fall})),view:v});
});

test('quiet reopen preserves the complete-round label without a new celebration or leaked account result',async({page})=>{
  await ready(page,'cascade-cap');await game(page).locator('[data-ft=primary]').click();await done(page);await page.locator('#reopen').click();await done(page);await expect(game(page).locator('.ft-fall-award')).toHaveText('500× LIMIT · 5,000.00');await expect(game(page).locator('[data-ft-value=net]')).toHaveText('Round net +4,990.00');expect((await state(page)).audio.played).toEqual({});expect((await state(page)).character.clip).not.toBe('triumph');
  await page.evaluate(()=>(window as any).templePreview.wallet.setAccount(null));await expect(game(page).locator('[data-ft-value=net]')).toHaveCount(0);await expect(game(page).locator('.ft')).toHaveAttribute('data-outcome','');await expect(game(page).locator('[data-ft-value=payout]')).toHaveText('0.00');
});

for(const lang of['ru','en'])test(`real Royal framing, readable results and connected chat: ${lang}`,async({page})=>{
  const api=await apiRequest.newContext({baseURL:test.info().project.use.baseURL});let peer:any;
  try{
    const auth=await api.post('/api/auth/login',{data:{email:'temple-visual-peer-'+crypto.randomUUID()+'@example.test',password:'Temple-local-review-42!'}});expect(auth.ok()).toBe(true);await api.post('/api/auth/character',{data:{skin:0}});
    peer=await new Client('http://127.0.0.1:'+(process.env.TEMPLE_API_PORT??'2634'),{headers:{Cookie:auth.headers()['set-cookie'].split(';')[0]},fetchFn:async(url,options)=>{const r=await api.fetch(String(url),{method:options?.method,headers:Object.fromEntries(new Headers(options?.headers)),data:options?.body as string});return new Response(await r.body(),{status:r.status(),headers:r.headers()});}}).create('lobby');for(const type of['chat','activities','piano-note','notice','pvp'])peer.onMessage(type,()=>{});
    await ready(page,'cascade-seed-15',lang);await page.request.post('/api/auth/character',{data:{skin:0}});await page.goto('/?lang='+lang+'&room='+peer.roomId);await expect(page.locator('#join-dialog')).toBeHidden();await page.waitForFunction(()=>{try{return(window as any).royalDemo?.getState().online===true;}catch{return false;}});
    await page.locator('#games-tab').click();await page.locator('[data-cabinet=studio-dracona]').click();await page.locator('[data-platform-game=studio-flooded-temple]').click();await expect(game(page).locator('[data-ft=primary]')).toBeEnabled();await expect.poll(async()=>(await state(page)).character.loaded.length).toBe(6);await game(page).locator('[data-ft=primary]').click();await done(page);
    const geometry:any[]=[];for(const [width,height]of[[1440,1000],[1000,760],[768,1024],[390,844],[360,740],[844,390]]){
      await page.setViewportSize({width,height});await expect(page.locator('#mini-dialog #chat-input')).toBeVisible();await expect(page.locator('#mini-dialog #chat-input')).toBeEnabled();
      const g=await game(page).locator('.ft').evaluate(root=>{const box=(q:string)=>root.querySelector(q)!.getBoundingClientRect().toJSON();return{width:root.clientWidth,scroll:root.scrollWidth,board:box('.ft-cabinet'),girl:box('.ft-character'),portrait:box('.ft-portrait:not([hidden])'),console:box('.ft-console'),statusFont:parseFloat(getComputedStyle(root.querySelector('.ft-status')!).fontSize),netFont:parseFloat(getComputedStyle(root.querySelector('.ft-net')!).fontSize)};});
      expect(g.scroll).toBeLessThanOrEqual(g.width+1);expect(g.console.top).toBeGreaterThanOrEqual(g.board.bottom);expect(g.statusFont).toBeGreaterThanOrEqual(12);expect(g.netFont).toBeGreaterThanOrEqual(12);if(g.width>520){expect(g.girl.right).toBeLessThanOrEqual(g.board.left-8);expect(g.portrait.left).toBeGreaterThanOrEqual(g.girl.left);expect(g.portrait.bottom).toBeLessThanOrEqual(g.girl.bottom);}else expect(g.girl.bottom).toBeLessThanOrEqual(g.board.top);geometry.push({width,height,...g});
      await game(page).locator('[data-ft=primary]').evaluate(el=>el.scrollIntoView({block:'nearest'}));await expect(game(page).locator('[data-ft-value=net]')).toBeInViewport();
      if(g.width<=520){const result=await game(page).locator('.ft-collected-total').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,net:el.querySelector('.ft-net')!.getBoundingClientRect().top,payout:el.querySelector('strong')!.getBoundingClientRect().bottom}));expect(result.scroll).toBeLessThanOrEqual(result.width+1);expect(result.net).toBeGreaterThanOrEqual(result.payout);}
      if(lang==='ru'&&(width===1440||width===390)){await mkdir('docs/assets/flooded-temple',{recursive:true});await sharp(await page.screenshot()).webp({quality:84}).toFile(`docs/assets/flooded-temple/visual-acceptance-${width}.webp`);if(width===390){await game(page).locator('.ft-top').scrollIntoViewIfNeeded();await sharp(await page.screenshot()).webp({quality:84}).toFile('docs/assets/flooded-temple/visual-acceptance-phone-top.webp');}}
    }
    await report('host-'+lang,{geometry,chatConnected:true,chatMessagesSent:0,partialReturnExplicit:true});
  }finally{if(peer)await peer.leave();await api.dispose();}
});

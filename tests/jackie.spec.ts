import {test,expect,type Page} from '@playwright/test';
import {createServer,type ViteDevServer} from 'vite';
import {spawn,type ChildProcess} from 'node:child_process';
import {createServer as netServer} from 'node:net';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {temporaryDatabase} from '../scripts/database-test';
import {PostgresDatabase,databaseConfig} from '../server/database';

let vite:ViteDevServer,backend:ChildProcess,db:Awaited<ReturnType<typeof temporaryDatabase>>,baseURL:string,logs='';
const out='artifacts/work/jackie-chan';
test.beforeAll(async()=>{
  test.setTimeout(120000);db=await temporaryDatabase();const socket=netServer();await new Promise<void>(yes=>socket.listen(0,'127.0.0.1',yes));const port=(socket.address() as {port:number}).port;await new Promise<void>(yes=>socket.close(()=>yes()));
  const projected=process.env.JACKIE_RELEASE_PROJECTION==='1';
  backend=spawn(process.execPath,projected?['artifacts/work/jackie-chan/jackie-backend.mjs']:['--import','tsx','tests/fixtures/jackie-backend.ts'],{env:{...process.env,...db.env,AUTH_DB_PATH:'jackie_qa',PORT:String(port)},stdio:['ignore','pipe','pipe','ipc']});
  backend.stdout?.on('data',b=>logs=(logs+b.toString()).slice(-6000));backend.stderr?.on('data',b=>logs=(logs+b.toString()).slice(-6000));const target=`http://127.0.0.1:${port}`;
  try{await expect.poll(async()=>{try{return(await fetch(target+'/healthz')).ok;}catch{return false;}},{timeout:60000,message:'Jackie backend readiness'}).toBe(true);}
  catch(error){throw new Error(`Jackie backend did not become ready (exit ${backend.exitCode}): ${logs}`,{cause:error});}
  const plugins=projected?[(await import('../deployment/releases/jackie-chan-20261029-v2/projection.mjs')).viteProjection(JSON.parse(await readFile(out+'/production-before.json','utf8')))]:[];
  vite=await createServer({configFile:false,root:process.cwd(),plugins,cacheDir:projected?'node_modules/.vite-jackie-production':'node_modules/.vite-jackie',optimizeDeps:{entries:['index.html','tests/fixtures/independent-games.html']},server:{host:'127.0.0.1',port:0,watch:{ignored:['**/module-dist/**','**/module-build/**']},proxy:{'/api':target,'/game-modules':target,'/multiplayer':{target,ws:true,rewrite:path=>path.replace(/^\/multiplayer/,'')}}}});await vite.listen();baseURL=`http://127.0.0.1:${(vite.httpServer!.address() as {port:number}).port}`;await mkdir(out,{recursive:true});
});
test.afterAll(async()=>{await vite?.close();if(backend?.exitCode===null){backend.kill();await new Promise<void>(yes=>backend.once('exit',()=>yes()));}await db?.cleanup();});
async function seed(email:string){const connection=new PostgresDatabase('jackie_qa',{existingSchema:true,config:databaseConfig({...process.env,...db.env})});try{const a=await connection.prepare('SELECT id FROM accounts WHERE email=?').get(email);expect(a).toBeDefined();await connection.prepare('INSERT INTO demo_wallets(account_id,balance,fraction_units) VALUES(?,10000,0) ON CONFLICT(account_id) DO UPDATE SET balance=10000,fraction_units=0').run(a!.id);return String(a!.id);}finally{await connection.close();}}
async function outcome(mode:'win'|'lose'){await new Promise<void>(resolve=>{backend.once('message',()=>resolve());backend.send?.(mode);});}
async function enter(page:Page,lang='ru'){
  await page.route('https://luelonplay.com/**',route=>route.fulfill({json:{games:[]}}));await page.route('**/api/casinoapipro/status',route=>route.fulfill({json:{configured:false,walletConnected:false}}));await page.goto(baseURL+'/?lang='+lang);
  const email=`jackie-${crypto.randomUUID()}@example.test`,en=lang==='en';await page.getByLabel(en?'Email':'Почта',{exact:true}).fill(email);await page.getByLabel(en?'Password':'Пароль',{exact:true}).fill('Jackie-isolated-check-123!');const auth=page.waitForResponse(r=>r.url().endsWith('/api/auth/login')&&r.request().method()==='POST');await page.getByRole('button',{name:en?'Continue':'Продолжить',exact:true}).click();expect((await auth).ok()).toBe(true);await seed(email);await page.getByRole('button',{name:en?'Enter the hall':'Войти в зал',exact:true}).click();
  await expect(page.locator('#join-dialog')).toBeHidden();await expect.poll(()=>page.evaluate(()=>(window as any).royalDemo?.getState().online)).toBe(true);await page.evaluate(async()=>{const p='/src/wallet/WalletClient.ts';await(await import(/* @vite-ignore */p)).demoWallet.refresh();});
  await page.locator('#game').focus();await page.keyboard.down('ArrowRight');try{await expect.poll(()=>page.evaluate(()=>(window as any).royalDemo.getState().x),{timeout:15000,intervals:[50]}).toBeGreaterThan(1100);}finally{await page.keyboard.up('ArrowRight');}
  await page.locator('#game').focus();await page.keyboard.down('ArrowDown');try{await expect.poll(()=>page.evaluate(()=>(window as any).royalDemo.getState().y),{timeout:15000,intervals:[50]}).toBeGreaterThan(760);}finally{await page.keyboard.up('ArrowDown');}
  await page.locator('#games-tab').click();
  let cabinet='studio-afterglow';
  await expect.poll(async()=>{if(await page.locator('#mini-dialog').isVisible())return true;cabinet=await page.evaluate(preferred=>{const occupied=new Set((window as any).royalDemo.getState().remotePositions.map((player:any)=>player.cabinet));return [preferred,'studio-nitro-run','studio-last-convoy','studio-meme-overload','studio-velvet-reign','studio-caramel-carnival','studio-cosmic-escape'].find(id=>!occupied.has(id))??preferred;},cabinet);try{await page.locator(`[data-cabinet="${cabinet}"]`).click({timeout:1000});}catch{}return page.locator('#mini-dialog').isVisible();},{timeout:30000,intervals:[1000,2500]}).toBe(true);
  await page.locator('[data-platform-game="original-jackie-chan"]').click();await expect(page.locator('.jackie')).toHaveAttribute('data-loading','false',{timeout:30000});await expect(page.locator('#mini-dialog #chat-input')).toBeEnabled();
}
async function act(page:Page,selector='[data-fight]'){
  const reply=page.waitForResponse(r=>r.url().endsWith('/api/demo-wallet/expansion')&&r.request().method()==='POST');await page.locator('.jackie '+selector).click();const r=await reply;expect(r.ok()).toBe(true);const body=await r.json();await expect(page.locator('.jackie [data-fight]')).toBeEnabled({timeout:15000});return body.session;
}
test('location themes, independent switches and shared audio lifecycle work in the real host',async({page})=>{
  test.setTimeout(180000);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{const original=AudioContext.prototype.createMediaElementSource;(window as any).musicElements=[];AudioContext.prototype.createMediaElementSource=function(audio){if(audio.src.includes('/jackie-chan/audio/'))(window as any).musicElements.push(audio);return original.call(this,audio);};});
  await enter(page);const game=page.locator('.jackie'),state=()=>page.evaluate(()=>(window as any).royalDemo.getMiniState().audio.music);let posts=0;
  page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/api/demo-wallet/expansion'))posts++;});
  await expect.poll(async()=>(await state()).playing,{timeout:15000}).toBe(true);
  const themes=[];
  for(const [location,title]of [['restaurant','Shenyang'],['harbor','Hot Pursuit'],['market','Eighties Action']]){
    await game.locator('[data-location]').selectOption(location);await expect.poll(async()=>(await state()).title).toBe(title);
    await expect.poll(async()=>(await state()).playing,{timeout:10000}).toBe(true);await expect.poll(async()=>(await state()).active).toBe(1);themes.push(await state());
  }
  for(const location of ['restaurant','market','harbor','market','restaurant'])await game.locator('[data-location]').selectOption(location);
  await expect.poll(async()=>(await state()).playing).toBe(true);await expect.poll(async()=>(await state()).active).toBe(1);expect((await state()).title).toBe('Shenyang');
  await page.route('**/jackie-chan/audio/harbor.mp3',route=>route.abort('failed'));await game.locator('[data-location]').selectOption('harbor');await expect.poll(async()=>(await state()).error).not.toBe('');
  await page.unroute('**/jackie-chan/audio/harbor.mp3');await game.locator('[data-speed]').click();await expect.poll(async()=>(await state()).playing).toBe(true);await game.locator('[data-speed]').click();
  await game.locator('[data-sound]').click();await expect(game.locator('[data-sound]')).toHaveAttribute('aria-pressed','false');expect((await state()).playing).toBe(true);
  await game.locator('[data-music]').click();await expect(game.locator('[data-music]')).toHaveAttribute('aria-pressed','false');await expect.poll(async()=>(await state()).active).toBe(0);
  await game.locator('[data-location]').selectOption('harbor');expect((await state()).enabled).toBe(false);expect((await state()).active).toBe(0);
  await game.locator('[data-music]').click();await expect.poll(async()=>(await state()).playing).toBe(true);expect((await state()).title).toBe('Hot Pursuit');
  await game.locator('[data-sound]').click();await expect(game.locator('[data-sound]')).toHaveAttribute('aria-pressed','true');
  const master=async(command:'mute'|'unmute'|'zero'|'volume'|'suspend'|'resume')=>page.evaluate(async command=>{const path='/src/game/GameAudio.ts',audio=(await import(/* @vite-ignore */path)).gameAudio;if(command==='mute'||command==='unmute')audio.setMuted(command==='mute');else if(command==='zero'||command==='volume')audio.setVolume(command==='zero'?0:.35);else await audio.context[command]();},command);
  for(const [pause,resume]of [['mute','unmute'],['zero','volume'],['suspend','resume']]as const){
    const before=await state();await master(pause);await expect.poll(async()=>(await state()).active).toBe(0);await master(resume);await expect.poll(async()=>(await state()).playing).toBe(true);expect((await state()).positionSeconds).toBeGreaterThanOrEqual(before.positionSeconds);
  }
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));});
  await expect.poll(async()=>(await state()).active).toBe(0);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{value:false,configurable:true});document.dispatchEvent(new Event('visibilitychange'));});
  await expect.poll(async()=>(await state()).playing).toBe(true);
  await game.locator('[data-rules]').click();await expect(game.locator('.jc-music-credits a')).toHaveCount(3);await expect(game.locator('[data-dialog]')).toContainText('Kevin MacLeod');await expect(game.locator('[data-dialog] a[href="https://creativecommons.org/licenses/by/4.0/"]')).toBeVisible();await game.locator('[data-close]').click();
  await page.setViewportSize({width:390,height:844});for(const selector of ['[data-music]','[data-sound]']){await game.locator(selector).scrollIntoViewIfNeeded();await expect(game.locator(selector)).toBeInViewport();expect((await game.locator(selector).boundingBox())!.height).toBeGreaterThanOrEqual(44);}
  await expect(page.locator('#mini-dialog #chat-input')).toBeInViewport();await page.screenshot({path:out+'/music-mobile.png'});expect(posts).toBe(0);
  await outcome('win');const operation=act(page);await expect.poll(async()=>(await state()).ducked).toBe(true);await expect.poll(async()=>(await state()).playing).toBe(true);await operation;await expect.poll(async()=>(await state()).ducked).toBe(false);expect(posts).toBe(1);
  await page.emulateMedia({reducedMotion:'reduce'});await act(page,'[data-cashout]');
  await game.locator('[data-music]').click();await game.locator('[data-sound]').click();await page.locator('#studio-game-list').click();await expect(game).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).musicElements.every((audio:HTMLAudioElement)=>audio.paused&&!audio.getAttribute('src')))).toBe(true);
  await page.locator('[data-platform-game="original-jackie-chan"]').click();await expect(game).toHaveAttribute('data-loading','false');
  await expect(game.locator('[data-music]')).toHaveAttribute('aria-pressed','false');await expect(game.locator('[data-sound]')).toHaveAttribute('aria-pressed','false');expect((await state()).active).toBe(0);expect(posts).toBe(2);
  await game.locator('[data-music]').click();await expect.poll(async()=>(await state()).playing).toBe(true);await expect.poll(async()=>(await state()).active).toBe(1);
  expect(errors).toEqual([]);await writeFile(out+'/music-acceptance.json',JSON.stringify({themes,independentSwitches:true,preferencesSurviveReopen:true,sharedMuteAndVolume:true,contextAndVisibilityRecovery:true,closeDisposesAllMedia:true,duckingDuringFight:true,settingsPosts:0,realTemporaryPostgres:true,connectedChat:true,errors},null,2));
  await page.locator('#mini-dialog .mini-top [data-close]').click({timeout:5000});await expect(page.locator('#mini-dialog')).toBeHidden();
});

test('game follows the real available stage, keeps actions visible and uses readable location options',async({page})=>{
  test.setTimeout(180000);await enter(page);const game=page.locator('.jackie'),rows=[];let paidPosts=0;
  page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/demo-wallet/expansion'))paidPosts++;});
  for(const [width,height]of [[1920,1080],[1440,900],[1366,768],[1280,600],[1024,768],[820,1180],[768,1024],[640,900],[390,844],[360,640],[320,568],[844,390],[667,375]]){
    await page.setViewportSize({width,height});
    await expect.poll(()=>game.evaluate(el=>Math.abs(el.getBoundingClientRect().height-el.closest('.mini-stage')!.clientHeight))).toBeLessThanOrEqual(1);
    const geometry=await game.evaluate(el=>{const root=el.getBoundingClientRect(),stage=el.closest('.mini-stage')!,arena=el.querySelector('canvas')!.getBoundingClientRect(),button=el.querySelector('[data-fight]')!.getBoundingClientRect();return{width:innerWidth,height:innerHeight,layout:(el as HTMLElement).dataset.layout,root:root.toJSON(),arena:arena.toJSON(),button:button.toJSON(),stageOverflow:stage.scrollHeight-stage.clientHeight,overflow:el.scrollWidth-el.clientWidth};});
    expect(geometry.overflow).toBeLessThanOrEqual(1);expect(geometry.stageOverflow).toBeLessThanOrEqual(1);
    expect(geometry.button.top).toBeGreaterThanOrEqual(geometry.root.top);expect(geometry.button.bottom).toBeLessThanOrEqual(geometry.root.bottom+1);expect(geometry.button.height).toBeGreaterThanOrEqual(44);
    expect(geometry.arena.height).toBeGreaterThan(60);await expect(game.locator('[data-fight]')).toBeInViewport();await expect(page.locator('#mini-dialog #chat-input')).toBeInViewport();
    await game.locator('[data-location]').scrollIntoViewIfNeeded();await expect(game.locator('[data-location]')).toBeInViewport();await game.locator('[data-location]').selectOption('harbor');await expect(game.locator('[data-scene-name]')).toHaveText('Старый порт');
    const colors=await game.locator('[data-location]').evaluate(el=>{const s=getComputedStyle(el),o=getComputedStyle(el.querySelector('option')!);return{color:s.color,background:s.backgroundColor,scheme:s.colorScheme,font:parseFloat(s.fontSize),optionColor:o.color,optionBackground:o.backgroundColor};});
    expect(colors.background).toBe('rgb(55, 41, 30)');expect(colors.color).toBe('rgb(255, 231, 187)');expect(colors.scheme).toBe('dark');expect(colors.font).toBeGreaterThanOrEqual(14);expect(colors.optionColor).toBe(colors.color);expect(colors.optionBackground).toBe(colors.background);
    await expect(game.locator('[data-fight]')).toBeInViewport();rows.push({...geometry,colors});
    if([1920,1366,390,844].includes(width))await page.screenshot({path:out+'/responsive-'+width+'x'+height+'.png'});
  }
  expect(paidPosts).toBe(0);await writeFile(out+'/responsive-layout.json',JSON.stringify(rows,null,2));
  await page.locator('#mini-dialog .mini-top [data-close]').click({timeout:5000});await expect(page.locator('#mini-dialog')).toBeHidden();
});
test('real host, chat, risk groups, gallery and account progress work on desktop and mobile',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await outcome('win');await enter(page);await page.emulateMedia({reducedMotion:'no-preference'});
  const game=page.locator('.jackie');
  await game.locator('[data-wardrobe]').click();const concealed=game.locator('.jc-costume[data-open="false"]');await expect(concealed).toHaveCount(7);
  const cards=await concealed.evaluateAll(cards=>cards.map(card=>{const image=card.querySelector('.jc-costume-image')!,bar=card.querySelector('progress')!;return{text:card.textContent,background:getComputedStyle(image).backgroundImage,filter:getComputedStyle(image).filter,value:bar.value,max:bar.max};}));
  expect(new Set(cards.map(c=>c.background)).size).toBe(1);for(const card of cards){expect(card.background).toContain('/master.webp');expect(card.filter).toContain('brightness(0)');expect(card.text).toContain('Скрытый костюм');expect(card.text).not.toMatch(/USDT|1983|1985|1986|1998|2002|2010|Проект|Полицейская|Доспехи|Час пик|Кто я|Смокинг|Карате|\d+\s*\/\s*\d+/);expect(card.max).toBe(1);expect(card.value).toBe(0);}
  await page.screenshot({path:out+'/wardrobe-concealed-desktop.png'});
  await page.setViewportSize({width:320,height:740});await expect.poll(()=>game.locator('[data-dialog]').evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);await page.screenshot({path:out+'/wardrobe-concealed-mobile.png'});
  await page.setViewportSize({width:1440,height:1000});await game.locator('[data-close]').click();await expect(game.locator('[data-collection-label]')).toHaveText('Прогресс коллекции костюмов');
  await game.locator('[data-risk="extreme"]').click();await expect(game.locator('canvas')).toHaveAttribute('data-opponents','3');
  const initialFoes=(await game.locator('canvas').getAttribute('data-foes'))!.split(',');expect(initialFoes).toHaveLength(3);expect(new Set(initialFoes).size).toBe(3);await page.screenshot({path:out+'/desktop.png'});
  expect(initialFoes).toContain('master');await expect(game.locator('[data-risk="extreme"] b')).toHaveText('Сложный');
  const first=await act(page);expect(first.view.jackie.combat.shots).toHaveLength(1);const firstRoutine=await game.locator('canvas').getAttribute('data-sequence');await expect(game.locator('[data-cashout]')).toContainText('22,00');await expect(game.locator('[data-location]')).toBeDisabled();
  await game.locator('[data-risk="sharp"]').click();await expect(game.locator('[data-lineup]')).toBeVisible();
  const plannedFoes=(await game.getAttribute('data-next-foes'))!.split(',');expect(plannedFoes).toHaveLength(2);expect(plannedFoes).not.toContain('master');
  await expect(game.locator('canvas')).toHaveAttribute('data-foes',initialFoes.join(','));
  const second=await act(page);expect(second.view.jackie.combat.shots.map((s:any)=>s.risk)).toEqual(['extreme','sharp']);
  expect(await game.locator('canvas').getAttribute('data-sequence')).not.toBe(firstRoutine);
  const nextFoes=(await game.locator('canvas').getAttribute('data-foes'))!.split(',');expect(nextFoes).toEqual(plannedFoes);expect(new Set(nextFoes).size).toBe(2);
  await act(page);await act(page);
  let posts=0;page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/api/demo-wallet/expansion'))posts++;});
  const finalOperation=act(page);
  await page.waitForFunction(()=>(window as any).royalDemo.getMiniState()?.phase==='victory-fist',undefined,{polling:'raf',timeout:15000});
  await page.screenshot({path:out+'/victory-desktop.png'});
  await expect(game).toHaveAttribute('data-result-kind','complete',{timeout:15000});await expect(game.locator('[data-result-title]')).toHaveText('ПОБЕДА!');await expect(game.locator('[data-result-caption]')).toContainText('5 БОЁВ');await expect(game.locator('.jc-takes .won')).toHaveCount(5);
  await game.locator('[data-skip-victory]').click();const completed=await finalOperation;expect(completed.view.jackie.combat.status).toBe('complete');expect(posts).toBe(1);await expect(game.locator('[data-skip-victory]')).toBeHidden();
  expect(await page.evaluate(()=>(window as any).royalDemo.getMiniState()?.audio.active)).toBe(0);
  for(const [width,height]of [[390,844],[320,740]]){await page.setViewportSize({width,height});await page.locator('.jc-stage').scrollIntoViewIfNeeded();await expect(game.locator('[data-result-title]')).toBeInViewport();await expect(game.locator('canvas')).toHaveAttribute('data-celebrating','false');await page.screenshot({path:out+'/victory-'+width+'.png'});}
  await page.setViewportSize({width:1440,height:1000});
  await act(page);await act(page,'[data-cashout]');await expect(game).toHaveAttribute('data-result-kind','cashout');
  for(const [width,height]of [[1440,1000],[390,844],[320,740]]){
    await page.setViewportSize({width,height});await game.locator('.jc-stage').scrollIntoViewIfNeeded();await expect(page.locator('#mini-dialog #chat-input')).toBeEnabled();
    await expect.poll(async()=>game.locator('.jc-stage').evaluate(stage=>{const canvas=stage.querySelector('canvas')!,hero=JSON.parse(canvas.dataset.heroFrame!),result=stage.closest('.jackie')!.querySelector('[data-result]')!.getBoundingClientRect();return canvas.getBoundingClientRect().top+hero.top-result.bottom;})).toBeGreaterThanOrEqual(6);
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.emulateMedia({reducedMotion:'reduce'});await game.locator('[data-stake]').selectOption('50000');await outcome('lose');for(let i=0;i<9;i++)await act(page);await expect(game.locator('[data-count]')).toHaveText('8/8');
  await game.locator('[data-wardrobe]').click();await expect(game.locator('.jc-costume[data-open="true"]')).toHaveCount(8);
  for(const [id,film]of [['rush','Час пик'],['whoami','Кто я?'],['tuxedo','Смокинг'],['mentor','Карате-пацан']])await expect(game.locator(`[data-costume="${id}"] strong`)).toHaveText(film);
  await game.locator('[data-costume="mentor"]').scrollIntoViewIfNeeded();await page.screenshot({path:out+'/wardrobe-eight-desktop.png'});
  await game.locator('[data-costume="mentor"]').click();const mentor=await act(page);expect(mentor.view.jackie.costume).toBe('mentor');expect(mentor.view.jackie.version).toBe(2);
  await game.locator('[data-wardrobe]').click();await game.locator('[data-costume="sailor"]').click();await game.locator('[data-location]').selectOption('harbor');await page.screenshot({path:out+'/sailor-harbor.png'});
  for(const [width,height] of [[1440,1000],[390,844],[320,740]]){
    await page.setViewportSize({width,height});await expect(page.locator('#mini-dialog #chat-input')).toBeVisible();await writeFile(out+'/layout-'+width+'.json',JSON.stringify(await game.evaluate(e=>{const root=e.getBoundingClientRect();return{width:e.clientWidth,scroll:e.scrollWidth,overflow:[...e.querySelectorAll('*')].map(n=>({class:n.className,tag:n.tagName,rect:n.getBoundingClientRect().toJSON()})).filter(n=>n.rect.width>0&&(n.rect.right>root.right+1||n.rect.left<root.left-1))};}),null,2));await expect.poll(()=>game.evaluate(e=>e.scrollWidth-e.clientWidth),{timeout:3000}).toBeLessThanOrEqual(1);await game.locator('[data-fight]').scrollIntoViewIfNeeded();await expect(game.locator('[data-fight]')).toBeInViewport();await page.screenshot({path:out+'/host-'+width+'.png'});
  }
  await game.locator('[data-wardrobe]').click();await expect(game.locator('[data-dialog]')).toBeVisible();await page.screenshot({path:out+'/wardrobe-mobile.png'});await game.locator('[data-close]').click();expect(errors).toEqual([]);
  await writeFile(out+'/browser-summary.json',JSON.stringify({errors,viewports:[1440,390,320],realHost:true,connectedGuestChat:false,connectedAuthenticatedChat:true,realTemporaryPostgres:true,actualWalletRequests:true,realWagers:false},null,2));
});
test('preview brings a varied fight contact into a laptop viewport and reopens without a new stake',async({page})=>{
  await page.setViewportSize({width:1280,height:720});await page.emulateMedia({reducedMotion:'no-preference'});await outcome('win');
  const email='jackie-preview-'+crypto.randomUUID()+'@example.test';
  const login=await page.request.post(baseURL+'/api/auth/login',{data:{email,password:'Jackie-isolated-check-123!'}});expect(login.ok()).toBe(true);const account=await seed(email);
  await page.route('**/__jackie/setup',route=>route.fulfill({json:{account:{id:account}}}));
  await page.goto(baseURL+'/tests/fixtures/jackie-play.html');
  const game=page.locator('.jackie');await expect(game).toHaveAttribute('data-loading','false',{timeout:30000});
  await game.locator('[data-risk="extreme"]').click();
  const version=await page.locator('#preview').getAttribute('data-game-module-version');
  let posts=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/demo-wallet/expansion'))posts++;});
  const operation=act(page);
  await page.waitForFunction(()=>!!document.querySelector('canvas')?.dataset.phase?.match(/^(cross-punch|straight-punch|counter-punch|side-kick|table-vault|stool-kick|backfist-strike|palm-strike|sweep-strike|knee-strike|elbow-strike|spin-kick-strike)$/),undefined,{polling:'raf',timeout:15000});
  const scene=await game.locator('canvas').evaluate(el=>{const r=el.getBoundingClientRect();return{top:r.top,bottom:r.bottom,height:innerHeight,held:(el as HTMLElement).dataset.heldFurniture,phase:(el as HTMLElement).dataset.phase,sequence:(el as HTMLElement).dataset.sequence};});
  expect(scene.top).toBeGreaterThanOrEqual(0);expect(scene.bottom).toBeLessThanOrEqual(scene.height);expect(scene.held).not.toBe('chair');
  await page.screenshot({path:out+'/furniture-live-preview.png'});const accepted=await operation;expect(accepted.view.jackie.combat.shots).toHaveLength(1);
  await page.locator('#reopen').click();await expect(game).toHaveAttribute('data-loading','false',{timeout:30000});await expect(game.locator('[data-cashout]')).toBeVisible();await expect(game.locator('canvas')).toHaveAttribute('data-sequence',scene.sequence!);expect(posts).toBe(1);
  await expect(page.locator('#preview')).toHaveAttribute('data-game-module-version',version!);await expect(page.locator('#preview-version')).toContainText('Актуальная сборка');
  await writeFile(out+'/preview-continuity.json',JSON.stringify({viewport:[1280,720],version,scene,postOperations:posts,reopenPreservedAcceptedShot:true},null,2));
  await act(page,'[data-cashout]');await expect(game).toHaveAttribute('data-result-kind','cashout');
  const layouts=[];
  for(const width of [1000,601,600,580,440,390,320]){
    await page.setViewportSize({width,height:900});await game.locator('.jc-stage').scrollIntoViewIfNeeded();
    await expect.poll(async()=>game.locator('.jc-stage').evaluate(stage=>{
      const canvas=stage.querySelector('canvas')!,hero=JSON.parse(canvas.dataset.heroFrame!),result=stage.closest('.jackie')!.querySelector('[data-result]')!.getBoundingClientRect();return canvas.getBoundingClientRect().top+hero.top-result.bottom;
    })).toBeGreaterThanOrEqual(6);
    layouts.push(await game.locator('.jc-stage').evaluate(stage=>{const canvas=stage.querySelector('canvas')!,hero=JSON.parse(canvas.dataset.heroFrame!),result=stage.closest('.jackie')!.querySelector('[data-result]')!.getBoundingClientRect();return{width:innerWidth,sceneWidth:stage.clientWidth,resultBottom:result.bottom,heroTop:canvas.getBoundingClientRect().top+hero.top};}));
    if(width===580||width===320)await page.screenshot({path:out+'/cashout-raised-'+width+'.png'});
  }
  await writeFile(out+'/cashout-layout.json',JSON.stringify(layouts,null,2));
});

test('speed changes during a fight preserve its operation and survive reopening',async({page})=>{
  await page.emulateMedia({reducedMotion:'no-preference'});await outcome('win');
  const email='jackie-speed-'+crypto.randomUUID()+'@example.test';
  expect((await page.request.post(baseURL+'/api/auth/login',{data:{email,password:'Jackie-isolated-check-123!'}})).ok()).toBe(true);const account=await seed(email);
  await page.route('**/__jackie/setup',route=>route.fulfill({json:{account:{id:account}}}));await page.goto(baseURL+'/tests/fixtures/jackie-play.html');
  const game=page.locator('.jackie');await expect(game).toHaveAttribute('data-loading','false',{timeout:30000});await expect(game.locator('[data-speed]')).toHaveAttribute('aria-pressed','false');
  await game.locator('[data-risk="extreme"]').click();let posts=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/demo-wallet/expansion'))posts++;});
  const operation=act(page);await expect(game).toHaveAttribute('data-revision','1');
  await expect.poll(()=>page.evaluate(()=>(window as any).jackiePreview.state().elapsed)).toBeGreaterThan(1.2);
  const resizing=await page.evaluate(()=>(window as any).jackiePreview.state());
  for(const [width,height]of [[390,844],[844,390],[1440,1000]]){
    await page.setViewportSize({width,height});const current=await page.evaluate(()=>(window as any).jackiePreview.state());
    expect(current.sequence).toBe(resizing.sequence);expect(current.elapsed).toBeGreaterThanOrEqual(resizing.elapsed);expect(posts).toBe(1);
    await expect(game.locator('[data-fight]')).toBeInViewport();
  }
  const before=await page.evaluate(()=>(window as any).jackiePreview.state());await game.locator('[data-speed]').click();
  const after=await page.evaluate(()=>(window as any).jackiePreview.state());expect(after.elapsed).toBeGreaterThanOrEqual(before.elapsed);expect(after.elapsed-before.elapsed).toBeLessThan(.6);expect(after.sequence).toBe(before.sequence);expect(after.speed).toBe(2);
  await expect(game.locator('[data-fight]')).toBeDisabled();await expect(game.locator('[data-speed]')).toHaveAttribute('aria-pressed','true');
  expect((await operation).view.jackie.combat.shots).toHaveLength(1);expect(posts).toBe(1);
  await page.locator('#reopen').click();await expect(game).toHaveAttribute('data-loading','false',{timeout:30000});await expect(game).toHaveAttribute('data-speed','2');await expect(game.locator('[data-cashout]')).toBeVisible();
  const restored=await page.evaluate(()=>(window as any).jackiePreview.state());expect(restored.busy).toBe(false);expect(restored.audio.active).toBe(0);expect(posts).toBe(1);
  await page.emulateMedia({reducedMotion:'reduce'});await game.locator('[data-speed]').click();await expect(game).toHaveAttribute('data-speed','1');expect((await page.evaluate(()=>(window as any).jackiePreview.state())).busy).toBe(false);
  await page.setViewportSize({width:320,height:740});await expect.poll(()=>game.evaluate(e=>e.scrollWidth-e.clientWidth)).toBeLessThanOrEqual(1);await game.locator('[data-speed]').scrollIntoViewIfNeeded();await expect(game.locator('[data-speed]')).toBeInViewport();
  await writeFile(out+'/speed-continuity.json',JSON.stringify({before,after,restored,operations:posts,preferenceSurvivedReopen:true,mobileWidth:320},null,2));
});

test('lost response recovers the same operation; reopening loads saved state without another stake',async({page})=>{
  await outcome('win');
  const email='jackie-recovery-'+crypto.randomUUID()+'@example.test';
  const login=await page.request.post(baseURL+'/api/auth/login',{data:{email,password:'Jackie-isolated-check-123!'}});expect(login.ok()).toBe(true);const account=await seed(email);
  await page.goto(baseURL+'/tests/fixtures/independent-games.html?lang=en');await page.waitForFunction(()=>!!(window as any).moduleHarness);
  await page.evaluate(id=>{(window as any).moduleHarness.account(id);(window as any).moduleHarness.open('original-jackie-chan');},account);await expect(page.locator('.jackie')).toHaveAttribute('data-loading','false',{timeout:30000});await page.emulateMedia({reducedMotion:'reduce'});
  const operations:string[]=[];let dropped=false;await page.route('**/api/demo-wallet/expansion',async route=>{
    if(route.request().method()!=='POST')return route.continue();operations.push(route.request().postDataJSON().id);const response=await route.fetch();if(!dropped){dropped=true;return route.abort('failed');}return route.fulfill({response});
  });
  await page.locator('.jackie [data-fight]').click();await expect(page.locator('.jackie [data-retry]')).toBeVisible();await page.locator('.jackie [data-retry]').click();await expect(page.locator('.jackie [data-cashout]')).toBeVisible();expect(operations).toHaveLength(2);expect(operations[0]).toBe(operations[1]);
  await page.evaluate(()=>(window as any).moduleHarness.close());await expect(page.locator('#primary')).toBeEmpty();await page.evaluate(()=>(window as any).moduleHarness.open('original-jackie-chan'));await expect(page.locator('.jackie')).toHaveAttribute('data-loading','false',{timeout:30000});await expect(page.locator('.jackie [data-cashout]')).toBeVisible();expect(operations).toHaveLength(2);await act(page,'[data-cashout]');
});

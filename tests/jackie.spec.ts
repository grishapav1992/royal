import {test,expect,type Page} from '@playwright/test';
import {createServer,type ViteDevServer} from 'vite';
import {spawn,type ChildProcess} from 'node:child_process';
import {createServer as netServer} from 'node:net';
import {mkdir,writeFile} from 'node:fs/promises';
import {temporaryDatabase} from '../scripts/database-test';
import {PostgresDatabase,databaseConfig} from '../server/database';

let vite:ViteDevServer,backend:ChildProcess,db:Awaited<ReturnType<typeof temporaryDatabase>>,baseURL:string,logs='';
const out='artifacts/work/jackie-chan';
test.beforeAll(async()=>{
  test.setTimeout(120000);db=await temporaryDatabase();const socket=netServer();await new Promise<void>(yes=>socket.listen(0,'127.0.0.1',yes));const port=(socket.address() as {port:number}).port;await new Promise<void>(yes=>socket.close(()=>yes()));
  backend=spawn(process.execPath,['--import','tsx','tests/fixtures/jackie-backend.ts'],{env:{...process.env,...db.env,AUTH_DB_PATH:'jackie_qa',PORT:String(port)},stdio:['ignore','pipe','pipe','ipc']});
  backend.stdout?.on('data',b=>logs=(logs+b.toString()).slice(-6000));backend.stderr?.on('data',b=>logs=(logs+b.toString()).slice(-6000));const target=`http://127.0.0.1:${port}`;
  await expect.poll(async()=>{try{return(await fetch(target+'/healthz')).ok;}catch{return false;}},{timeout:60000,message:'Jackie backend: '+logs}).toBe(true);
  vite=await createServer({configFile:false,root:process.cwd(),cacheDir:'node_modules/.vite-jackie',optimizeDeps:{entries:['index.html','tests/fixtures/independent-games.html']},server:{host:'127.0.0.1',port:0,watch:{ignored:['**/module-dist/**','**/module-build/**']},proxy:{'/api':target,'/game-modules':target,'/multiplayer':{target,ws:true,rewrite:path=>path.replace(/^\/multiplayer/,'')}}}});await vite.listen();baseURL=`http://127.0.0.1:${(vite.httpServer!.address() as {port:number}).port}`;await mkdir(out,{recursive:true});
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
  await page.locator('#games-tab').click();await page.locator('[data-cabinet="studio-afterglow"]').click();await expect(page.locator('#mini-dialog')).toBeVisible({timeout:30000});await page.locator('[data-platform-game="original-jackie-chan"]').click();await expect(page.locator('.jackie')).toHaveAttribute('data-loading','false',{timeout:30000});await expect(page.locator('#mini-dialog #chat-input')).toBeEnabled();
}
async function act(page:Page,selector='[data-fight]'){
  const reply=page.waitForResponse(r=>r.url().endsWith('/api/demo-wallet/expansion')&&r.request().method()==='POST');await page.locator('.jackie '+selector).click();const r=await reply;expect(r.ok()).toBe(true);const body=await r.json();await expect(page.locator('.jackie [data-fight]')).toBeEnabled({timeout:10000});return body.session;
}
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
  const first=await act(page);expect(first.view.jackie.combat.shots).toHaveLength(1);await expect(game.locator('[data-cashout]')).toContainText('22,00');await expect(game.locator('[data-location]')).toBeDisabled();
  await game.locator('[data-risk="sharp"]').click();await expect(game.locator('[data-lineup]')).toBeVisible();
  const plannedFoes=(await game.getAttribute('data-next-foes'))!.split(',');expect(plannedFoes).toHaveLength(2);expect(plannedFoes).not.toContain('master');
  await expect(game.locator('canvas')).toHaveAttribute('data-foes',initialFoes.join(','));
  const second=await act(page);expect(second.view.jackie.combat.shots.map((s:any)=>s.risk)).toEqual(['extreme','sharp']);
  const nextFoes=(await game.locator('canvas').getAttribute('data-foes'))!.split(',');expect(nextFoes).toEqual(plannedFoes);expect(new Set(nextFoes).size).toBe(2);
  await act(page);await act(page);
  let posts=0;page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/api/demo-wallet/expansion'))posts++;});
  const finalOperation=act(page);
  await expect(game).toHaveAttribute('data-result-kind','complete');await expect(game.locator('[data-result-title]')).toHaveText('ПОБЕДА!');await expect(game.locator('[data-result-caption]')).toContainText('5 БОЁВ');await expect(game.locator('.jc-takes .won')).toHaveCount(5);
  await expect.poll(()=>page.evaluate(()=>(window as any).royalDemo.getMiniState()?.phase)).toBe('victory-fist');
  await page.screenshot({path:out+'/victory-desktop.png'});await game.locator('[data-skip-victory]').click();const completed=await finalOperation;expect(completed.view.jackie.combat.status).toBe('complete');expect(posts).toBe(1);await expect(game.locator('[data-skip-victory]')).toBeHidden();
  expect(await page.evaluate(()=>(window as any).royalDemo.getMiniState()?.audio.active)).toBe(0);
  for(const [width,height]of [[390,844],[320,740]]){await page.setViewportSize({width,height});await page.locator('.jc-stage').scrollIntoViewIfNeeded();await expect(game.locator('[data-result-title]')).toBeInViewport();await expect(game.locator('canvas')).toHaveAttribute('data-celebrating','false');await page.screenshot({path:out+'/victory-'+width+'.png'});}
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
test('preview brings the entire furniture contact into a laptop viewport and reopens without a new stake',async({page})=>{
  await page.setViewportSize({width:1280,height:720});await page.emulateMedia({reducedMotion:'no-preference'});await outcome('win');
  const email='jackie-preview-'+crypto.randomUUID()+'@example.test';
  const login=await page.request.post(baseURL+'/api/auth/login',{data:{email,password:'Jackie-isolated-check-123!'}});expect(login.ok()).toBe(true);const account=await seed(email);
  await page.route('**/__jackie/setup',route=>route.fulfill({json:{account:{id:account}}}));
  await page.goto(baseURL+'/tests/fixtures/jackie-play.html');
  const game=page.locator('.jackie');await expect(game).toHaveAttribute('data-loading','false');
  const version=await page.locator('#preview').getAttribute('data-game-module-version');
  let posts=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/demo-wallet/expansion'))posts++;});
  const operation=act(page);
  await page.waitForFunction(()=>document.querySelector('canvas')?.dataset.phase==='chair-strike',undefined,{polling:'raf',timeout:10000});
  const scene=await game.locator('canvas').evaluate(el=>{const r=el.getBoundingClientRect();return{top:r.top,bottom:r.bottom,height:innerHeight,held:(el as HTMLElement).dataset.heldFurniture,phase:(el as HTMLElement).dataset.phase};});
  expect(scene.top).toBeGreaterThanOrEqual(0);expect(scene.bottom).toBeLessThanOrEqual(scene.height);expect(scene.held).toBe('chair');
  await page.screenshot({path:out+'/furniture-live-preview.png'});const accepted=await operation;expect(accepted.view.jackie.combat.shots).toHaveLength(1);
  await page.locator('#reopen').click();await expect(game).toHaveAttribute('data-loading','false');await expect(game.locator('[data-cashout]')).toBeVisible();expect(posts).toBe(1);
  await expect(page.locator('#preview')).toHaveAttribute('data-game-module-version',version!);await expect(page.locator('#preview-version')).toContainText('Актуальная сборка');
  await writeFile(out+'/preview-continuity.json',JSON.stringify({viewport:[1280,720],version,scene,postOperations:posts,reopenPreservedAcceptedShot:true},null,2));
});

test('lost response recovers the same operation; reopening loads saved state without another stake',async({page})=>{
  await outcome('win');
  const email='jackie-recovery-'+crypto.randomUUID()+'@example.test';
  const login=await page.request.post(baseURL+'/api/auth/login',{data:{email,password:'Jackie-isolated-check-123!'}});expect(login.ok()).toBe(true);const account=await seed(email);
  await page.goto(baseURL+'/tests/fixtures/independent-games.html?lang=en');await page.waitForFunction(()=>!!(window as any).moduleHarness);
  await page.evaluate(id=>{(window as any).moduleHarness.account(id);(window as any).moduleHarness.open('original-jackie-chan');},account);await expect(page.locator('.jackie')).toHaveAttribute('data-loading','false');await page.emulateMedia({reducedMotion:'reduce'});
  const operations:string[]=[];let dropped=false;await page.route('**/api/demo-wallet/expansion',async route=>{
    if(route.request().method()!=='POST')return route.continue();operations.push(route.request().postDataJSON().id);const response=await route.fetch();if(!dropped){dropped=true;return route.abort('failed');}return route.fulfill({response});
  });
  await page.locator('.jackie [data-fight]').click();await expect(page.locator('.jackie [data-retry]')).toBeVisible();await page.locator('.jackie [data-retry]').click();await expect(page.locator('.jackie [data-cashout]')).toBeVisible();expect(operations).toHaveLength(2);expect(operations[0]).toBe(operations[1]);
  await page.evaluate(()=>(window as any).moduleHarness.close());await expect(page.locator('#primary')).toBeEmpty();await page.evaluate(()=>(window as any).moduleHarness.open('original-jackie-chan'));await expect(page.locator('.jackie')).toHaveAttribute('data-loading','false');await expect(page.locator('.jackie [data-cashout]')).toBeVisible();expect(operations).toHaveLength(2);await act(page,'[data-cashout]');
});

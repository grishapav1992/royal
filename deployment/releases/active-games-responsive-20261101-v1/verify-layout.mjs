import {chromium,request,expect} from '@playwright/test';
import {Client} from '@colyseus/sdk';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
const out=resolve(process.env.ROYAL_LAYOUT_ARTIFACTS_DIR||'artifacts/work/active-games-responsive-check')+'/';
if(!out.startsWith(resolve('artifacts/work')+'/')&&!out.startsWith(resolve('..')+'/'))throw Error('Use a task-owned artifacts/work directory');
const baseline=JSON.parse(await readFile(process.env.ROYAL_LAYOUT_BASELINE||out+'production-baseline.json','utf8'));
const origin=process.env.ROYAL_LAYOUT_WEB_ORIGIN||'http://127.0.0.1:5255',api=process.env.ROYAL_LAYOUT_API_ORIGIN||'http://127.0.0.1:2655';
for(const value of [origin,api]){const u=new URL(value);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1')throw Error('Disposable account verification must use loopback only');}
const touch=process.env.ROYAL_LAYOUT_TOUCH==='1';
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:touch?{width:390,height:844}:{width:1440,height:1000},isMobile:touch,hasTouch:touch});
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='warning'&&m.text().includes('Game module'))console.log(m.text());});
const host=await request.newContext({baseURL:api});
const response=await host.post('/api/auth/login',{data:{email:'layout-host-'+crypto.randomUUID()+'@example.test',password:'Layout-test-123!'}});
expect(response.ok()).toBe(true);const cookie=response.headers()['set-cookie'].split(';')[0];await host.post('/api/auth/character',{data:{skin:0}});
const client=new Client(api,{headers:{Cookie:cookie},fetchFn:async(url,options)=>{const r=await host.fetch(String(url),{method:options?.method,headers:Object.fromEntries(new Headers(options?.headers)),data:options?.body});return new Response(await r.body(),{status:r.status(),headers:r.headers()});}});
const room=await client.create('lobby');for(const name of ['chat','activities','piano-note','notice','chat-check','security','ejected','pvp'])room.onMessage(name,()=>{});
await mkdir(out+'screens',{recursive:true});
const all=[];
const mainControls={
 'studio-cosmic-escape':['[data-lg-spin]','[data-lg-stake]'],
 'studio-velvet-reign':['[data-lg-spin]','[data-lg-stake]'],
 'studio-caramel-carnival':['[data-cc-spin]','[data-cc-stake]'],
 'studio-last-convoy':['[data-cc-spin]','[data-cc-stake]'],
 'studio-nitro-run':['[data-cc-spin]','[data-cc-stake]'],
 'studio-afterglow':['[data-cc-spin]','[data-cc-stake]'],
 'studio-meme-overload':['[data-cc-spin]','[data-cc-stake]'],
 'studio-neopolis':['[data-np="spin"]','[data-np="bet"]'],
 'github-crash':['[data-start]','[data-stake]'],
 'royal-plinko':['[data-vp="drop"]','[data-vp="minus"]','[data-vp="plus"]','[data-risk]'],
 'original-cr-vs-leo':['[data-shoot]','[data-stake]','[data-risk]'],
 'original-jackie-chan':['[data-fight]','[data-risk]'],
 'studio-caribbean-treasures':['[data-ct-action="play"]'],
 'royal-roulette':['[data-rr-spin]','[data-rr-amount]'],
 'flag-battle':['[data-fb="play"]','#fb-stake','[data-mode]'],
 'variant-blackjack-target':['[data-start]','[data-stake]'],
 'variant-triple-poker':['[data-start]','[data-stake]'],
 'variant-duel':['[data-start]','[data-stake]'],
 'variant-war':['[data-start]','[data-stake]'],
};
async function fullyVisible(frame,selector){
 return frame.locator(selector).evaluateAll(nodes=>nodes.map(e=>{
  const b=e.getBoundingClientRect();let left=0,top=0,right=innerWidth,bottom=innerHeight;
  for(let p=e.parentElement;p;p=p.parentElement){const s=getComputedStyle(p),r=p.getBoundingClientRect();
   if(/auto|scroll|hidden|clip/.test(s.overflowX)){left=Math.max(left,r.left+p.clientLeft);right=Math.min(right,r.left+p.clientLeft+p.clientWidth);}
   if(/auto|scroll|hidden|clip/.test(s.overflowY)){top=Math.max(top,r.top+p.clientTop);bottom=Math.min(bottom,r.top+p.clientTop+p.clientHeight);}
  }
  return{label:e.getAttribute('aria-label')||e.innerText||e.id,width:b.width,height:b.height,hidden:getComputedStyle(e).visibility==='hidden',clipped:Math.max(0,left-b.left,top-b.top,b.right-right,b.bottom-bottom)};
 }));
}
async function revealScrollable(frame,selector){
 await frame.locator(selector).first().evaluate(e=>{
  for(let p=e.parentElement;p;p=p.parentElement){const c=getComputedStyle(p),r=p.getBoundingClientRect();let b=e.getBoundingClientRect();
   if(/auto|scroll/.test(c.overflowY)){if(b.bottom>r.top+p.clientTop+p.clientHeight)p.scrollTop+=b.bottom-(r.top+p.clientTop+p.clientHeight);b=e.getBoundingClientRect();if(b.top<r.top+p.clientTop)p.scrollTop-=r.top+p.clientTop-b.top;}
   b=e.getBoundingClientRect();if(/auto|scroll/.test(c.overflowX)){if(b.right>r.left+p.clientLeft+p.clientWidth)p.scrollLeft+=b.right-(r.left+p.clientLeft+p.clientWidth);b=e.getBoundingClientRect();if(b.left<r.left+p.clientLeft)p.scrollLeft-=r.left+p.clientLeft-b.left;}
  }
  if(document.scrollingElement.scrollHeight>innerHeight&&!/hidden|clip/.test(getComputedStyle(document.documentElement).overflowY)){const b=e.getBoundingClientRect();window.scrollBy(0,b.bottom>innerHeight?b.bottom-innerHeight:b.top<0?b.top:0);}
 });
}
async function geometry(frame){return frame.evaluate(()=>{
 const root=document.querySelector('#mini-game')||document.body;
 const rect=e=>{const b=e.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height,right:b.right,bottom:b.bottom};};
 const visible=e=>{const s=getComputedStyle(e),b=e.getBoundingClientRect();return s.visibility!=='hidden'&&s.display!=='none'&&b.width>0&&b.height>0;};
 const stage=document.querySelector('.mini-stage')||document.documentElement;
 const controls=[...root.querySelectorAll('button,input,select')].filter(visible).map(e=>({id:e.id,tag:e.tagName,label:(e.getAttribute('aria-label')||e.innerText||'').slice(0,55),attributes:[...e.attributes].filter(a=>a.name.startsWith('data-')).map(a=>[a.name,a.value]),box:rect(e),font:parseFloat(getComputedStyle(e).fontSize),disabled:e.disabled}));
 const boards=[...root.querySelectorAll('canvas,.cc-board,.lg-board,.np-board,.ct-board,.fb-stage,.le-stage,.cl-stage,.rr-table,.fh-board,.temple-board')].filter(visible).map(e=>({class:e.className,box:rect(e)}));
 return{url:location.pathname,rootClass:root.firstElementChild?.className,mode:document.querySelector('#mini-dialog')?.dataset.gameViewport,viewport:{width:innerWidth,height:innerHeight},stage:rect(stage),stageScroll:{width:stage.scrollWidth,height:stage.scrollHeight,clientWidth:stage.clientWidth,clientHeight:stage.clientHeight},root:rect(root),rootScroll:{width:root.scrollWidth,height:root.scrollHeight,clientWidth:root.clientWidth,clientHeight:root.clientHeight},pageOverflowX:document.documentElement.scrollWidth-innerWidth,chat:document.querySelector('#chat-input')?rect(document.querySelector('#chat-input')):null,boards,controls};
 });}
try{
 await page.route('https://luelonplay.com/demo-api/**',route=>route.fulfill({json:{games:[]}}));
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto(origin+'/?room='+room.roomId);
 await page.getByLabel('Почта',{exact:true}).fill('layout-player-'+crypto.randomUUID()+'@example.test');await page.getByLabel('Пароль',{exact:true}).fill('Layout-test-123!');await page.getByRole('button',{name:'Продолжить',exact:true}).click();
 await expect.poll(async()=>await page.locator('#character-step').isVisible()||!(await page.locator('#join-dialog').isVisible())).toBe(true);
 if(await page.locator('#character-step').isVisible())await page.getByRole('button',{name:'Войти в зал',exact:true}).click();
 await expect(page.locator('#join-dialog')).toBeHidden({timeout:30000});await expect.poll(()=>page.evaluate(()=>{try{return window.royalDemo.getState().online;}catch{return false;}}),{timeout:30000}).toBe(true);
 if(process.env.ROYAL_LAYOUT_FUNDED!=='0'){const r=await context.request.post(origin+'/__test/layout/topup');expect(r.ok(),await r.text()).toBe(true);await page.reload();await expect(page.locator('#join-dialog')).toBeHidden({timeout:30000});await expect.poll(()=>page.evaluate(()=>{try{return window.royalDemo.getState().online;}catch{return false;}}),{timeout:30000}).toBe(true);}
 if(process.env.ROYAL_LAYOUT_CARDS_ONLY!=='1'){
 await page.locator('#room-overview').click();
 await expect.poll(async()=>{
  if(await page.locator('#mini-dialog').isVisible())return true;
  if(!await page.locator('[data-cabinet="studio-cosmic-escape"]').isVisible())await page.locator('#games-tab').click();
  await page.locator('[data-cabinet="studio-cosmic-escape"]').click();return false;
 },{timeout:35000,intervals:[1000,3000]}).toBe(true);
 await expect(page.locator('.royal-platform')).toBeVisible({timeout:30000});
 }
 for(const {id,cardTable} of [...baseline.cards,...baseline.cardGames||[]]){
  if(!/^[a-z0-9-]+$/.test(id))throw Error('Unexpected catalogue identity');
  if(process.env.ONLY_GAME&&id!==process.env.ONLY_GAME)continue;if(process.env.ROYAL_LAYOUT_CARDS_ONLY==='1'&&!cardTable)continue;
  const entry={id,views:[],errors:[]};all.push(entry);
  try{
   await page.setViewportSize(touch?{width:390,height:844}:{width:1440,height:1000});
   if(cardTable){
    if(await page.locator('#mini-dialog').isVisible())await page.locator('#mini-dialog .mini-top [data-close]').click();
    for(const hall of ['tables','github']){
     const current=await page.evaluate(()=>window.royalDemo.getState().hall);if(current===hall||current==='github')continue;
     if(await page.locator('#panel-close').isVisible())await page.locator('#panel-close').click();
     await expect.poll(async()=>{if(await page.evaluate(()=>window.royalDemo.getState().hall)===hall)return true;if(await page.locator('#panel-close').isVisible())await page.locator('#panel-close').click();await page.locator('[data-floor-target="'+hall+'"]').click();return false;},{timeout:45000,intervals:[1000,2000]}).toBe(true);
    }
    if(await page.locator('#games-tab').getAttribute('aria-expanded')!=='true')await page.locator('#games-tab').click();
    await page.locator('[data-card-table="'+id+'"]').click();
   }else{
    if(!await page.locator('.royal-platform').isVisible())await page.locator('#studio-game-list').click();
    await page.locator('[data-platform-game="'+id+'"]').click();
   }
   await expect(page.locator('#mini-game')).toHaveAttribute('data-game-module-id',id,{timeout:90000});
   await expect(page.locator('#mini-game')).toHaveAttribute('data-game-module-version',/\d+\.\d+\.\d+-[a-f0-9]{12}/,{timeout:90000});
   const intro=page.locator('[data-cc-action="enter"],[data-lg-dialog-action="enter"],[data-vp="enter"]');
   if(await intro.count()){await expect(intro).toBeEnabled({timeout:90000});await intro.click();}
   if(id==='original-cr-vs-leo')await expect(page.locator('.cr-leo')).toHaveAttribute('data-loading','false',{timeout:120000});
   if(id==='original-jackie-chan')await expect(page.locator('.jackie')).toHaveAttribute('data-loading','false',{timeout:120000});
   await page.waitForTimeout(1500);
   entry.version=await page.locator('#mini-game').getAttribute('data-game-module-version');
   for(const [width,height] of (touch?[[390,844],[360,740],[844,390]]:[[1920,1080],[1440,1000],[1366,768],[1280,720],[1024,768],[430,932],[390,844],[360,740],[320,700],[844,390]])){
    await page.setViewportSize({width,height});await page.waitForTimeout(400);
    await page.locator('.mini-stage').evaluate(e=>e.scrollTop=0);
    const frames=[];for(const f of page.frames())frames.push(await geometry(f));
    const checks=[];
    for(const selector of mainControls[id]||[]){let boxes=await fullyVisible(page.mainFrame(),selector);const scrolled=boxes.some(b=>b.clipped>2);if(scrolled){await revealScrollable(page.mainFrame(),selector);boxes=await fullyVisible(page.mainFrame(),selector);}expect(boxes.length,id+' '+selector).toBeGreaterThan(0);for(const b of boxes){expect(b.hidden,id+' '+selector).toBe(false);expect(b.clipped,id+' '+selector+' '+width+'x'+height).toBeLessThanOrEqual(2);expect(b.width).toBeGreaterThan(15);expect(b.height).toBeGreaterThan(15);}checks.push({selector,boxes,scrolled});}
    if(id==='studio-dracona'||id==='studio-forest-heart'||id==='studio-flooded-temple'){
     const child=page.frames().find(f=>f!==page.mainFrame());expect(child).toBeTruthy();
     const selector=id==='studio-dracona'?'#spin':id==='studio-forest-heart'?'[data-fh="spin"]':'[data-ft="primary"]';
     let boxes=await fullyVisible(child,selector);const scrolled=boxes.some(b=>b.clipped>2);if(scrolled){await revealScrollable(child,selector);boxes=await fullyVisible(child,selector);}expect(boxes.length,id+' primary action').toBeGreaterThan(0);for(const b of boxes)expect(b.clipped,id+' '+width+'x'+height).toBeLessThanOrEqual(2);checks.push({selector,boxes,scrolled});
    }
    expect(frames.every(f=>f.pageOverflowX<=1),id+' horizontal overflow').toBe(true);
    await expect(page.locator('#mini-dialog #chat-input')).toBeInViewport();
    entry.views.push({width,height,frames,checks});
    if([1280,390,844].includes(width))await page.screenshot({path:out+'screens/'+id+'-'+width+(touch?'-touch':'-candidate')+'.jpg',type:'jpeg',quality:65});
   }
   console.log(JSON.stringify({id,version:entry.version,views:entry.views.map(v=>({w:v.width,mode:v.frames[0].mode,stage:[v.frames[0].stage.width,v.frames[0].stage.height],scroll:v.frames[0].stageScroll.height-v.frames[0].stageScroll.clientHeight,x:v.frames.map(f=>f.pageOverflowX),iframes:v.frames.length-1}))}));
  }catch(e){entry.errors.push(String(e));console.log(JSON.stringify({id,error:String(e)}));await page.screenshot({path:out+'screens/'+id+'-failure.jpg',type:'jpeg',quality:65});}
  await writeFile(out+'layout-'+(touch?'touch':'desktop')+(process.env.ONLY_GAME?'-'+process.env.ONLY_GAME:process.env.ROYAL_LAYOUT_CARDS_ONLY==='1'?'-cards':'')+'.json',JSON.stringify({productionCheckedAtUtc:baseline.checkedAtUtc,pinnedProductionModules:true,realHostAndChat:true,source:process.env.ROYAL_LAYOUT_SOURCE_COMMIT||'unrecorded',all,errors},null,2)+'\n');
 }
 if(process.env.ROYAL_LAYOUT_RECOVERY==='1'){
  if(process.env.ONLY_GAME!=='studio-caramel-carnival')throw Error('Recovery scenario requires the isolated Caramel Carnival selection');
  await page.setViewportSize({width:390,height:844});let starts=0;
  page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/expansion')&&r.postDataJSON()?.action==='start')starts++;});
  const before=await context.request.get(origin+'/api/demo-wallet').then(r=>r.json());
  const response=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/expansion'));
  await page.locator('[data-cc-spin]').click();const acceptedResponse=await response;expect(acceptedResponse.ok(),await acceptedResponse.text()).toBe(true);const accepted=await acceptedResponse.json();expect(accepted.session.id).toBeTruthy();
  await page.locator('#mini-dialog .mini-top [data-close]').click();await expect(page.locator('#mini-dialog')).toBeHidden();
  await page.locator('#room-overview').click();await expect.poll(async()=>{if(await page.locator('#mini-dialog').isVisible())return true;if(!await page.locator('[data-cabinet="studio-cosmic-escape"]').isVisible())await page.locator('#games-tab').click();await page.locator('[data-cabinet="studio-cosmic-escape"]').click();return false;},{timeout:35000,intervals:[1000,2000]}).toBe(true);
  await page.locator('[data-platform-game="studio-caramel-carnival"]').click();await expect(page.locator('#mini-game')).toHaveAttribute('data-game-module-id','studio-caramel-carnival');
  const intro=page.locator('[data-cc-action="enter"]');if(await intro.count()){await expect(intro).toBeEnabled();await intro.click();}await page.waitForTimeout(1500);
  const recovered=await context.request.get(origin+'/api/demo-wallet').then(r=>r.json());expect(starts).toBe(1);expect(recovered.balance).toBe(accepted.wallet.balance);expect(recovered.entries.length).toBe(accepted.wallet.entries.length);
  await writeFile(out+'wallet-recovery.json',JSON.stringify({localOnly:true,game:'studio-caramel-carnival',source:process.env.ROYAL_LAYOUT_SOURCE_COMMIT,acceptedSession:accepted.session.id,acceptedState:accepted.session.state,paidStarts:starts,balanceBefore:before.balance,balanceAfter:recovered.balance,entriesPreserved:true,closeReopenPassed:true},null,2)+'\n');
 }
 if(errors.length||all.some(g=>g.errors.length))process.exitCode=1;
}finally{await context.close();await browser.close();await Promise.race([room.leave(),new Promise(r=>setTimeout(r,1500))]);await host.dispose();}

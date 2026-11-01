import {test,expect,type Page,type Browser} from '@playwright/test';
import {Client} from '@colyseus/sdk';
const base='http://127.0.0.1:5193';
const connected=(p:Page)=>expect.poll(()=>p.evaluate(()=>(window as any).royalDemo?.getNetworkState()?.status),{timeout:30000}).toBe('connected');
const sign=(p:Page,choice='paper')=>p.locator(`.td-choices [data-choice="${choice}"]`);
const balance=async(p:Page)=>Math.round(Number((await p.locator('[data-balance]').innerText()).replace(/[^\d,.-]/g,'').replace(',','.'))*100);
async function players(browser:Browser){
  const contexts=await Promise.all([browser.newContext(),browser.newContext()]),[a,b]=await Promise.all(contexts.map(c=>c.newPage())),errors:string[]=[];
  for(const p of[a,b]){p.on('pageerror',e=>errors.push(e.message));await p.context().route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());}
  const seed=await browser.newContext(),login=await seed.request.post(base+'/api/auth/login',{data:{email:`tsu-room-${crypto.randomUUID()}@example.test`,password:'test-password!'}});
  await seed.request.post(base+'/api/auth/character',{data:{skin:0}});
  const room=await new Client(base,{headers:{Cookie:login.headers()['set-cookie'].split(';')[0]}}).create('lobby');room.onMessage('*',()=>{});
  try{for(const[i,p]of[a,b].entries()){
    expect((await p.context().request.post(base+'/api/auth/login',{data:{email:`pvp-local-${i?'b':'a'}@example.test`,password:'test-password!'}})).ok()).toBe(true);
    await p.goto(base+'/?room='+room.roomId);await connected(p);
  }}catch(e){await Promise.all(contexts.map(c=>c.close()));throw e;}finally{await room.leave();await seed.close();}
  return{a,b,errors,close:()=>Promise.all(contexts.map(c=>c.close()))};
}
async function offer(p:Page,key=false){
  await expect.poll(()=>p.evaluate(()=>(window as any).royalDemo.getState().remotePositions.length)).toBe(1);
  if(key)await p.keyboard.press('e');else{
    const remote=await p.evaluate(()=>(window as any).royalDemo.getState().remotePositions[0]),view=await p.evaluate(()=>(window as any).royalDemo.getState().view),box=(await p.locator('#game canvas').boundingBox())!;
    await p.mouse.click(box.x+(remote.x-view.x)*view.zoom*box.width/view.width,box.y+(remote.y-24-view.y)*view.zoom*box.height/view.height,{button:'right'});
  }
  await expect(p.locator('#player-actions')).toBeVisible();await p.locator('[data-player-invite]').click();
}
async function accept(a:Page,b:Page,key=false){await offer(a,key);await expect(b.locator('#pvp-incoming')).toBeVisible();await b.locator('#pvp-incoming [data-accept]').click();for(const p of[a,b])await expect(p.locator('.td-terms')).toBeVisible({timeout:25000});}
async function ready(a:Page,b:Page){await a.locator('[data-ready]').click();await expect(a.locator('[data-ready]')).toHaveText('Снять готовность');await expect(a.locator('.td-choices')).toHaveCount(0);await b.locator('[data-ready]').click();for(const p of[a,b])await expect(sign(p)).toBeEnabled();}
async function winRound(a:Page,b:Page,wins:number){await expect(sign(a)).toBeEnabled();await sign(a).click();await expect(sign(b,'rock')).toBeEnabled();await sign(b,'rock').click();await expect(a.locator('.td-stage')).toHaveAttribute('data-stage','countdown');await expect(a.locator('.td-score')).toHaveText(`${wins-1} : 0`);await expect(a.locator('.td-score')).toHaveText(`${wins} : 0`,{timeout:10000});}

test('right-click and E open a consent invitation; decline, revised terms and readiness withdrawal never charge',async({browser})=>{
  const c=await players(browser),{a,b}=c;try{
    await offer(a);await expect(b.locator('#pvp-incoming')).toContainText('Деньги списываются только');await b.locator('#pvp-incoming [data-decline]').click();await expect(a.locator('[data-active]')).toContainText('Деньги не списаны');await expect(a.locator('[data-balance]')).toContainText('200 USDT');await a.locator('#pvp-dialog [data-close]').click();
    await accept(a,b,true);expect(await balance(a)).toBe(20000);expect(await balance(b)).toBe(20000);
    await expect(a.locator('[data-stake]')).toHaveValue('100000');await expect(a.locator('[name=mode]')).toHaveCount(0);await expect(a.locator('.td-active-hand')).toHaveCount(2);
    await a.locator('[data-ready]').click();await expect(b.locator('[data-peer-ready]')).toContainText('Соперник готов');await b.locator('[data-stake]').selectOption('200000');await expect(a.locator('[data-ready]')).toHaveText('Готово');await expect(a.locator('[data-stake]')).toHaveValue('200000');
    await a.locator('[data-ready]').click();await a.locator('[data-ready]').click();await expect(a.locator('[data-ready]')).toHaveText('Готово');expect(await balance(a)).toBe(20000);
    await a.setViewportSize({width:1280,height:720});
    for(const control of ['[data-ready]','[data-exit]']){const box=(await a.locator(control).boundingBox())!;expect(box.y).toBeGreaterThanOrEqual(0);expect(box.y+box.height).toBeLessThanOrEqual(720);}
    await a.screenshot({path:'artifacts/work/tsu-refined-short-desktop.png'});
    await a.setViewportSize({width:1366,height:900});
    await a.screenshot({path:'artifacts/work/tsu-v3-terms.png'});await a.setViewportSize({width:390,height:844});const chat=(await a.locator('#pvp-dialog .game-chat-dock').boundingBox())!,readyBox=(await a.locator('[data-ready]').boundingBox())!;expect(readyBox.y+readyBox.height).toBeLessThanOrEqual(chat.y);await a.screenshot({path:'artifacts/work/tsu-v3-terms-mobile.png'});await b.locator('[data-exit]').click();await expect(a.locator('.td-status')).toContainText('Деньги не списаны');expect(await balance(b)).toBe(20000);expect(c.errors).toEqual([]);
  }finally{await c.close();}
});

test('ten-cent best-of-three match uses secret choices, synchronized reveal, two wins, exact single credit, mobile chat and recovery',async({browser})=>{
  const c=await players(browser),{a,b}=c;try{
    await accept(a,b);const beforeA=await balance(a),beforeB=await balance(b);await ready(a,b);expect(await balance(a)).toBe(beforeA-10);expect(await balance(b)).toBe(beforeB-10);
    await sign(a).click();await expect(a.locator('.td-status')).toContainText('Твой знак закрыт');await expect(b.locator('.td-stage')).toHaveAttribute('data-stage','select');await expect(b.locator('.td-score')).toHaveText('0 : 0');
    await a.reload();await connected(a);await expect(a.locator('#pvp-dialog')).toBeVisible();await expect(sign(a)).toHaveAttribute('aria-pressed','true');await expect(sign(b,'rock')).toBeEnabled();await sign(b,'rock').click();await expect(a.locator('.td-stage')).toHaveAttribute('data-stage','countdown');await expect(a.locator('.td-score')).toHaveText('1 : 0',{timeout:10000});
    await a.screenshot({path:'artifacts/work/tsu-v3-desktop.png'});await a.setViewportSize({width:390,height:844});
    const chat=(await a.locator('#pvp-dialog .game-chat-dock').boundingBox())!;for(const button of await a.locator('.td-choices button').all()){const box=(await button.boundingBox())!;expect(box.width).toBeGreaterThanOrEqual(44);expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(390);expect(box.y+box.height).toBeLessThanOrEqual(chat.y);}
    await a.screenshot({path:'artifacts/work/tsu-v3-mobile.png'});await expect(a.locator('.td-status')).not.toContainText('Ты победил');await winRound(a,b,2);
    await expect(a.locator('.td-status')).toContainText('Начислено 0,19 USDT');expect(await balance(a)).toBe(beforeA+9);expect(await balance(b)).toBe(beforeB-10);
    await a.locator('#pvp-dialog [data-close]').click();if(!await a.locator('#pvp-button').isVisible())await a.locator('.profile-toggle').click();await a.locator('#pvp-button').click();await expect(a.locator('.td-score')).toHaveText('2 : 0');await expect(a.locator('[data-chant]')).toHaveText('');expect(await balance(a)).toBe(beforeA+9);expect(c.errors).toEqual([]);
  }finally{await c.close();}
});

test('real lost connection freezes selection and countdown; reconnect resumes the locked choice and surrender confirms once',async({browser})=>{
  const c=await players(browser),b=c.b;let a=c.a;try{
    await accept(a,b);const beforeA=await balance(a),beforeB=await balance(b);await ready(a,b);await sign(a).click();await expect(sign(a)).toHaveAttribute('aria-pressed','true');const url=a.url();
    await a.context().setOffline(true);await a.reload().catch(()=>{});await expect(b.locator('.td-pause')).toBeVisible({timeout:15000});await expect(sign(b)).toBeDisabled();
    await a.context().setOffline(false);const recovered=await a.context().newPage();recovered.on('pageerror',e=>c.errors.push(e.message));await a.close();a=recovered;await a.goto(base+'/');await connected(a);await expect(sign(a)).toHaveAttribute('aria-pressed','true');await expect(sign(b,'rock')).toBeEnabled();await sign(b,'rock').click();await expect(b.locator('.td-stage')).toHaveAttribute('data-stage','countdown');
    await a.context().setOffline(true);await a.reload().catch(()=>{});await expect(b.locator('.td-pause')).toBeVisible({timeout:15000});await b.waitForTimeout(4500);await expect(b.locator('.td-score')).toHaveText('0 : 0');
    await a.context().setOffline(false);await a.goto(url);await connected(a);await expect(b.locator('.td-pause')).toHaveCount(0);await expect(a.locator('.td-score')).toHaveText('1 : 0',{timeout:12000});expect(await balance(a)).toBe(beforeA-10);
    await a.locator('[data-exit]').click();await expect(a.locator('.td-confirm')).toBeVisible();await a.locator('[data-continue]').click();await expect(a.locator('.td-confirm')).toHaveCount(0);await a.locator('[data-exit]').click();await a.locator('[data-confirm-exit]').click();
    await expect(b.locator('.td-status')).toContainText('Начислено 0,19 USDT');expect(await balance(b)).toBe(beforeB+9);expect(await balance(a)).toBe(beforeA-10);expect(c.errors).toEqual([]);
  }finally{await c.close();}
});

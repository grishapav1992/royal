import { test, expect, type Page, type Browser } from '@playwright/test';
import { Client } from '@colyseus/sdk';
async function worldPoint(page:Page,x:number,y:number){
  await page.evaluate(()=>document.fonts.ready);
  const box=(await page.locator('#game canvas').boundingBox())!,view=await page.evaluate(()=>(window as any).royalDemo.getState().view);
  return{x:box.x+(x-view.x)*view.zoom*box.width/view.width,y:box.y+(y-view.y)*view.zoom*box.height/view.height};
}

const connected=(page:Page)=>expect.poll(()=>page.evaluate(()=>(window as any).royalDemo?.getNetworkState()?.status),{timeout:30000}).toBe('connected');
const sign=(page:Page,choice:string)=>page.locator(`.tsu-choices [data-choice="${choice}"]`);
const score=(page:Page)=>page.locator('.tsu-score>strong');
async function open(page:Page){if(!await page.locator('#pvp-dialog').isVisible())await page.locator('#pvp-button').click();await expect(page.locator('#pvp-dialog')).toBeVisible();}
async function players(browser:Browser,mobile=false){
  const contexts=await Promise.all([browser.newContext(),browser.newContext(mobile?{viewport:{width:390,height:844},isMobile:true,hasTouch:true}:{})]);
  const [a,b]=await Promise.all(contexts.map(c=>c.newPage()));const errors:string[]=[];
  for(const page of[a,b]){page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());}
  // A separate room prevents a previous test's reconnect reservation from receiving new clients.
  const seed=await browser.newContext(),login=await seed.request.post('http://127.0.0.1:5193/api/auth/login',{data:{email:`tsu-room-${crypto.randomUUID()}@example.test`,password:'test-password!'}});
  await seed.request.post('http://127.0.0.1:5193/api/auth/character',{data:{skin:0}});
  const room=await new Client('http://127.0.0.1:5193',{headers:{Cookie:login.headers()['set-cookie'].split(';')[0]}}).create('lobby');room.onMessage('*',()=>{});
  try{for(const [index,page]of[a,b].entries()){
    const response=await page.context().request.post('http://127.0.0.1:5193/api/auth/login',{data:{email:`pvp-local-${index===0?'a':'b'}@example.test`,password:'test-password!'}});expect(response.ok()).toBe(true);
    await page.goto(index===0?'http://127.0.0.1:5193/?room='+room.roomId:a.url());await connected(page);
  }}catch(error){await Promise.all(contexts.map(c=>c.close()));throw error;}finally{await room.leave();await seed.close();}
  return{a,b,errors,close:()=>Promise.all(contexts.map(c=>c.close()))};
}
async function inviteFromAvatar(page:Page,touch=false){
  await expect.poll(()=>page.evaluate(()=>(window as any).royalDemo.getState().remotePositions.length)).toBe(1);
  const remote=await page.evaluate(()=>(window as any).royalDemo.getState().remotePositions[0]);const point=await worldPoint(page,remote.x,remote.y-24);
  if(touch)await page.touchscreen.tap(point.x,point.y);else await page.mouse.click(point.x,point.y,{button:'right'});
  await expect(page.locator('#player-actions')).toBeVisible();await expect(page.locator('[data-player-invite]')).toBeEnabled();await page.locator('[data-player-invite]').click();
  await expect(page.locator('[name=game]')).toHaveValue('tsu-e-fa');await expect(page.locator('[name=target]')).not.toHaveValue('');
}
async function round(a:Page,b:Page,left='rock',right='scissors'){
  await expect(sign(a,left)).toBeEnabled();await expect(sign(b,right)).toBeEnabled();await sign(a,left).click();await expect(sign(a,left)).toBeDisabled();await sign(b,right).click();
}

test('right-click invitation opens a free first-to-three duel in place, with mobile chat and recovery',async({browser})=>{
  const c=await players(browser),{a,b}=c;try{
    const hall=await a.evaluate(()=>(window as any).royalDemo.getState().hall);
    await inviteFromAvatar(a);await expect(a.locator('[name=mode]')).toHaveValue('free');await expect(a.locator('[name=targetWins] option')).toHaveText(['3 побед','5 побед','7 побед']);await expect(a.locator('[data-preview]')).toContainText('Бесплатная игра');
    await a.locator('[data-create-button]').click();await expect(b.locator('#pvp-incoming')).toBeVisible();await expect(b.locator('#pvp-incoming')).toContainText('до 3 побед');await expect(b.locator('#pvp-incoming')).toContainText('Без списаний');await b.locator('#pvp-incoming [data-accept]').click();
    for(const page of[a,b]){await expect(sign(page,'rock')).toBeEnabled({timeout:20000});await expect(page.locator('#pvp-dialog .game-chat-dock')).toBeVisible();expect(await page.evaluate(()=>(window as any).royalDemo.getState().hall)).toBe(hall);}
    await sign(a,'rock').click();await expect(b.locator('.tsu-sealed>span').nth(1)).toContainText('Соперник готов');await expect(b.locator('.tsu-result')).toHaveCount(0);await sign(b,'rock').click();await expect(a.locator('.tsu-result')).toContainText('Ничья');
    await sign(a,'rock').click();await a.locator('#pvp-dialog [data-close]').click();await open(a);await expect(sign(a,'rock')).toHaveAttribute('aria-pressed','true');await a.reload();await connected(a);await open(a);await expect(sign(a,'rock')).toHaveAttribute('aria-pressed','true');
    await sign(b,'scissors').click();await expect(score(a)).toHaveText('1 : 0');await expect(a.locator('.tsu-score>small')).toHaveText('ДО 3 ПОБЕД');await expect(a.locator('#pvp-dialog')).not.toContainText('Загрузка игры…');
    await a.screenshot({path:'artifacts/work/tsu-e-fa-invites-desktop.png'});await a.setViewportSize({width:390,height:844});
    const chat=(await a.locator('#pvp-dialog .game-chat-dock').boundingBox())!;for(const button of await a.locator('.tsu-choices button').all()){const box=(await button.boundingBox())!;expect(box.width).toBeGreaterThanOrEqual(44);expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(390);expect(box.y+box.height).toBeLessThanOrEqual(chat.y);}
    await a.screenshot({path:'artifacts/work/tsu-e-fa-invites-mobile.png'});await round(a,b);await expect(score(a)).toHaveText('2 : 0');await expect(sign(a,'rock')).toBeEnabled();await round(a,b);await expect(score(a)).toHaveText('3 : 0');await expect(a.locator('.tsu-status')).toHaveText('Поединок твой!');
    for(const page of[a,b])await expect(page.locator('[data-balance]')).toContainText('200 USDT');await expect(a.locator('[data-active]')).not.toContainText('Начислено');
    await a.locator('#pvp-dialog [data-close]').click();await Promise.all([a.waitForEvent('load'),a.locator('.profile select[name=language]').selectOption('en')]);await connected(a);await open(a);await expect(a.locator('.tsu-heading h2')).toHaveText('Rock Paper Scissors');await expect(score(a)).toHaveText('3 : 0');await expect(a.locator('.tsu-reveal')).toHaveCount(0);expect(c.errors).toEqual([]);
  }finally{await c.close();}
});

test('phone tap offers an agreed five-win staked duel, decline refunds and settlement occurs once',async({browser})=>{
  const c=await players(browser,true),{a,b}=c;try{
    for(const decline of [true,false]){
      await inviteFromAvatar(b,true);await b.locator('[name=mode]').selectOption('stake');await b.locator('[name=stake]').fill('1.10');await b.locator('[name=targetWins]').selectOption('5');await b.locator('[data-create-button]').click();
      await expect(a.locator('#pvp-incoming')).toBeVisible();await expect(a.locator('#pvp-incoming')).toContainText('до 5 побед');await expect(a.locator('#pvp-incoming')).toContainText('2,09');
      if(decline){await a.locator('#pvp-incoming [data-decline]').click();await expect(b.locator('[data-active]')).toContainText('Средства возвращены');await expect(b.locator('[data-balance]')).toContainText('200 USDT');await b.locator('#pvp-dialog [data-close]').click();}else await a.locator('#pvp-incoming [data-accept]').click();
    }
    await expect(sign(a,'rock')).toBeEnabled({timeout:20000});for(let wins=1;wins<=5;wins++){await round(a,b,'scissors','rock');await expect(score(b)).toHaveText(`${wins} : 0`);if(wins<5)await expect(sign(b,'rock')).toBeEnabled();}
    await expect(b.locator('[data-active]')).toContainText('Начислено 2,09 USDT');await expect(b.locator('[data-balance]')).toContainText('200,99');await expect(a.locator('[data-balance]')).toContainText('198,9');await b.locator('#pvp-dialog [data-close]').click();await open(b);await expect(score(b)).toHaveText('5 : 0');await expect(b.locator('.tsu-reveal')).toHaveCount(0);expect(c.errors).toEqual([]);
  }finally{await c.close();}
});

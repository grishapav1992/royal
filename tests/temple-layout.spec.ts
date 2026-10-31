import {test,expect,request as apiRequest,type Page} from '@playwright/test';
import {Client} from '@colyseus/sdk';
const game=(page:Page)=>page.frameLocator('.temple-frame');
async function ready(page:Page,language='ru'){
  await page.context().setExtraHTTPHeaders({'x-temple-test-case':'cascade-blank'});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/tests/fixtures/temple-preview.html?lang='+language);
  await expect(game(page).locator('[data-ft=primary]')).toBeEnabled();
}
async function geometry(page:Page){
  await game(page).locator('.ft').evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  return game(page).locator('.ft').evaluate(root=>{
    const box=(q:string)=>root.querySelector(q)!.getBoundingClientRect().toJSON();
    return {width:root.clientWidth,scrollWidth:root.scrollWidth,height:root.clientHeight,
      viewport:root.ownerDocument.defaultView!.innerHeight,board:box('.ft-cabinet'),cell:box('[data-cell]'),
      award:box('.ft-fall-award'),console:box('.ft-console'),primary:box('[data-ft=primary]'),
      character:box('.ft-character'),heading:box('.ft-cascade-heading'),title:box('.ft-title'),
      tools:box('.ft-tools'),playback:box('.ft-playback'),status:box('.ft-status')};
  });
}
async function checkLayout(page:Page){
  const g=await geometry(page);
  expect(g.scrollWidth).toBeLessThanOrEqual(g.width+1);
  expect(Math.min(g.cell.width,g.cell.height)).toBeGreaterThanOrEqual(44);
  expect(g.heading.top).toBeGreaterThanOrEqual(g.title.bottom);
  expect(g.award.bottom).toBeLessThanOrEqual(g.console.top);
  expect(g.board.bottom).toBeLessThanOrEqual(g.console.top);
  expect(g.primary.right).toBeLessThanOrEqual(g.width);
  if(g.width>760){
    expect(g.console.height).toBeLessThan(170);
    expect(g.character.right).toBeLessThanOrEqual(g.board.left-8);
    expect(g.height).toBeLessThanOrEqual(Math.max(540,g.viewport)+1);
  }else if(g.width<=520){
    expect(g.primary.bottom).toBeLessThanOrEqual(g.viewport);
    expect(g.console.height).toBeLessThan(300);
    expect(g.character.bottom).toBeLessThanOrEqual(g.heading.top);
    expect(g.tools.bottom).toBeLessThanOrEqual(g.heading.top);
  }
  return g;
}
for(const language of ['ru','en'])test(`field and controls use the available host dimensions: ${language}`,async({page})=>{
  await ready(page,language);
  for(const [width,height] of [[2160,1422],[1440,1000],[1280,720],[1000,760],[768,1024],[740,360],[520,844],[390,844],[360,740]]){
    await page.setViewportSize({width,height});
    const g=await checkLayout(page);
    if(width===1440)expect(g.board.width).toBeGreaterThan(950);
    if(width===1280)expect(g.board.width).toBeGreaterThan(500);
  }
  await page.setViewportSize({width:390,height:844});
  await game(page).locator('[data-ft=primary]').click();
  await expect(game(page).locator('.ft-status')).toContainText(language==='ru'?'Итог раунда':'Round net');
  await checkLayout(page);
  await game(page).locator('[data-ft=rules]').click();
  await expect(game(page).locator('dialog')).toBeVisible();
  await game(page).locator('[data-ft=close]').click();
  await expect(game(page).locator('[data-ft=rules]')).toBeFocused();
});

test('real Royal host retains connected chat, compact controls and the same round on reopen',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const api=await apiRequest.newContext({baseURL:test.info().project.use.baseURL});
  const auth=await api.post('/api/auth/login',{data:{email:'temple-layout-'+crypto.randomUUID()+'@example.test',password:'Temple-layout-review-42!'}});
  expect(auth.ok()).toBe(true);await api.post('/api/auth/character',{data:{skin:0}});
  const peer=await new Client('http://127.0.0.1:2627',{headers:{Cookie:auth.headers()['set-cookie'].split(';')[0]},fetchFn:async(url,options)=>{
    const response=await api.fetch(String(url),{method:options?.method,headers:Object.fromEntries(new Headers(options?.headers)),data:options?.body as string});
    return new globalThis.Response(await response.body(),{status:response.status(),headers:response.headers()});
  }}).create('lobby');
  for(const type of ['chat','activities','piano-note','notice','pvp'])peer.onMessage(type,()=>{});
  try{
    await ready(page);await page.request.post('/api/auth/character',{data:{skin:0}});
    await page.goto('/?lang=ru&room='+peer.roomId);
    await expect(page.locator('#join-dialog')).toBeHidden({timeout:30000});
    await page.waitForFunction(()=>{try{return (window as any).royalDemo?.getState().online===true;}catch{return false;}});
    await page.locator('#games-tab').click();
    await expect.poll(async()=>{
      if(await page.locator('#mini-dialog').isVisible())return true;
      await page.locator('[data-cabinet=studio-cosmic-escape]').click({timeout:1000}).catch(()=>{});
      return page.locator('#mini-dialog').isVisible();
    },{timeout:25000,intervals:[1000,2000]}).toBe(true);
    await page.locator('[data-platform-game=studio-flooded-temple]').click();
    await expect(game(page).locator('[data-ft=primary]')).toBeEnabled();
    const paid:string[]=[];page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/expansion')&&request.postDataJSON().action==='start')paid.push(request.postDataJSON().id);});
    await game(page).locator('[data-ft=primary]').click();await expect(game(page).locator('.ft-status')).toContainText('Итог раунда');
    for(const [width,height] of [[1440,1000],[1280,720],[768,1024],[390,844],[360,740]]){
      await page.setViewportSize({width,height});
      await expect(page.locator('#mini-dialog #chat-input')).toBeVisible();
      await expect(page.locator('#mini-dialog #chat-input')).toBeEnabled();
      await checkLayout(page);
      if(width===1440||width===390)await page.screenshot({path:`artifacts/work/temple-layout/host-${width}.png`});
    }
    await page.locator('#studio-game-list').click();await page.locator('[data-platform-game=studio-flooded-temple]').click();
    await expect(game(page).locator('.ft-status')).toContainText('Итог раунда');expect(paid).toHaveLength(1);
    await page.locator('#mini-dialog .mini-top [data-close]').click();
    await expect(page.locator('#club-chat-dock')).toBeVisible();expect(errors).toEqual([]);
  }finally{await peer.leave();await api.dispose();}
});

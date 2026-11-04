import {test,expect,type Browser,type BrowserContext,type Page} from '@playwright/test';

const state=(page:Page)=>page.evaluate(()=>(window as any).royalDemo.getState());
async function guest(browser:Browser,baseURL:string,room?:string) {
  const context=await browser.newContext({baseURL,viewport:{width:1440,height:1000}});
  expect((await context.request.post('/api/auth/login',{data:{email:`royal-bar-${crypto.randomUUID()}@example.test`,password:'RoyalBarTest2026!'}})).ok()).toBe(true);
  expect((await context.request.post('/api/auth/character',{data:{skin:0,name:'Гость бара'}})).ok()).toBe(true);
  const page=await context.newPage();await page.goto(room?`/?room=${room}`:'/');
  await expect.poll(()=>page.evaluate(()=>(window as any).royalDemo.getNetworkState()?.status)).toBe('connected');
  await expect.poll(async()=>(await state(page)).serverX).toBeDefined();
  return {context,page};
}

test('dialogue drives the shared room Mira, including listening, reply, serving and close',async({browser,baseURL})=>{
  test.setTimeout(90000);const contexts:BrowserContext[]=[];
  try {
    const one=await guest(browser,baseURL!);contexts.push(one.context);const a=one.page;
    const room=await a.evaluate(()=>(window as any).royalDemo.getNetworkState().roomId);
    const two=await guest(browser,baseURL!,room);contexts.push(two.context);const b=two.page;
    let reply:undefined|(()=>void);
    await a.route('**/api/npc/mira',async route=>{
      if(route.request().method()==='GET')return route.fulfill({json:{turns:[{role:'assistant',content:'Ну? Чем удивишь?'}]}});
      await new Promise<void>(resolve=>{reply=resolve;});
      await route.fulfill({json:{reply:'Смена длинная, но я ещё успею приготовить тебе лимонад. Рассказывай, как проходит твой вечер.',emotion:'tease'}});
    });
    await a.locator('#visit-bar').click();await expect(a.locator('#bar-dialog')).toBeVisible({timeout:20000});
    await expect.poll(async()=>(await state(a)).mira.action).toBe('listen');
    await expect.poll(async()=>(await state(b)).mira.action).toBe('listen');
    // Restoring history must not look like a fresh response.
    await expect(a.locator('.mira-portrait')).toHaveAttribute('data-activity','listen');
    await a.getByRole('textbox',{name:'Твоя реплика Мире'}).fill('Как твоя смена?');
    await a.getByRole('button',{name:'Сказать',exact:true}).click();
    await expect(a.locator('.mira-status')).toHaveText('Мира отвечает…');
    await expect.poll(async()=>(await state(a)).mira.action).toBe('listen');
    expect(reply).toBeDefined();reply!();
    await expect(a.locator('.mira-portrait')).toHaveAttribute('data-activity','speak');
    await expect.poll(async()=>(await state(a)).mira.action).toBe('chat');
    await expect.poll(async()=>(await state(b)).mira.action).toBe('chat');
    const late=await guest(browser,baseURL!,room);contexts.push(late.context);
    await expect.poll(async()=>Math.abs((await state(late.page)).mira.x-(await state(a)).mira.x)).toBeLessThan(2);
    await a.getByRole('button',{name:'Напитки',exact:true}).click();await a.locator('[data-drink="wine"]').click();
    await expect.poll(async()=>(await state(a)).drink).toBe('wine');expect((await state(a)).intoxication.stage).toBe(1);
    await expect.poll(async()=>(await state(b)).mira.action).toBe('serve');
    await a.getByRole('button',{name:'Уйти',exact:true}).click();
    await expect(a.locator('.mira-portrait')).toHaveAttribute('data-activity','listen');
    await expect.poll(async()=>['listen','chat','greet'].includes((await state(a)).mira.action),{timeout:10000}).toBe(false);
  } finally {for(const context of contexts)await context.close();}
});

test('seated rest, layered contact and localized bar are usable at real desktop and mobile scale',async({page})=>{
  test.setTimeout(65000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/?offline=1');await page.locator('#loading').waitFor({state:'detached'});
  await expect.poll(async()=>(await state(page)).mira.action,{timeout:50000,intervals:[500]}).toBe('sit');
  const rest=(await state(page)).mira;expect(rest.seatAmount).toBe(1);expect(rest.artVersion).toBe(2);
  expect(rest.joints.hip.y).toBeGreaterThan(440);expect(rest.joints.hip.y).toBeLessThan(454);
  expect(rest.joints.rightHand.y).toBeGreaterThan(445);expect(rest.joints.rightHand.y).toBeLessThan(464);
  await page.screenshot({path:'artifacts/work/royal-bar-mira/seated-desktop.png'});
  await page.route('**/api/npc/mira',route=>route.fulfill({json:{turns:[{role:'assistant',content:'Ну? Чем удивишь?'}]}}));
  await page.locator('#visit-bar').click();await expect(page.locator('#bar-dialog')).toBeVisible({timeout:20000});
  for(const size of [{width:1440,height:1000},{width:390,height:844},{width:844,height:390}]) {
    await page.setViewportSize(size);await expect(page.getByRole('textbox',{name:'Твоя реплика Мире'})).toBeInViewport();
    const box=(await page.locator('#bar-dialog').boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(size.width+1);
  }
  await page.emulateMedia({reducedMotion:'reduce'});await expect.poll(async()=>(await state(page)).reducedMotion).toBe(true);
  await page.getByRole('button',{name:'Уйти',exact:true}).click();
  await page.screenshot({path:'artifacts/work/royal-bar-mira/mobile-reduced.png'});
  expect(errors).toEqual([]);
});

import {test,expect,type Page} from '@playwright/test';
const game=(p:Page)=>p.frameLocator('.temple-frame');
const state=(p:Page)=>p.evaluate(()=>(window as any).templePreview.state());
const idle=(p:Page)=>expect.poll(async()=>!!(await state(p))?.busy,{timeout:15000}).toBe(false);
async function ready(p:Page){await p.emulateMedia({reducedMotion:'reduce'});await p.goto('/tests/fixtures/temple-preview.html?lang=en');await expect(game(p).locator('.ft')).toBeVisible();await idle(p);await game(p).locator('[data-ft=primary]').click();await idle(p);}
async function confirm(p:Page){const revision=(await state(p)).revision;await game(p).locator('[data-ft=primary]').click();await expect.poll(async()=>(await state(p)).revision).toBe(revision+1);await idle(p);}

test('the only passage is preselected and inspecting other rooms never disables that move',async({page})=>{
  await ready(page);const posts:string[]=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/expansion'))posts.push(r.postData()!);});
  expect((await state(page)).selected).toBe(6);await expect(game(page).locator('.ft-route-option')).toHaveCount(1);await expect(game(page).locator('.ft-route-caption')).toContainText('only passage');await expect(game(page).locator('[data-ft=primary]')).toBeEnabled();await expect(game(page).locator('[data-ft=primary]')).toHaveText(/Move to B2/);
  await page.screenshot({path:'artifacts/work/flooded-temple-navigation/only-passage.png'});
  await game(page).locator('[data-room="0"]').click();expect((await state(page)).selected).toBe(6);expect((await state(page)).inspected).toBe(0);await expect(game(page).locator('[data-ft=primary]')).toBeEnabled();expect(posts).toEqual([]);
  await confirm(page);expect(posts).toHaveLength(1);expect((await state(page)).moves).toBe(5);expect((await state(page)).selected).toBeNull();await expect(game(page).locator('.ft-route-option')).toHaveCount(3);await expect(game(page).locator('.ft-choice-path')).toHaveCount(3);await expect(game(page).locator('.ft-choice-number')).toHaveCount(3);await expect(game(page).locator('[data-ft=primary]')).toHaveText('Choose a numbered passage');
  await page.screenshot({path:'artifacts/work/flooded-temple-navigation/fork.png'});
});

test('fork cards identify revisits and preserve the chosen route while inspecting the map',async({page})=>{
  await ready(page);await confirm(page);
  await expect(game(page).locator('[data-ft=route][data-to="5"]')).toContainText('Revisit, no new reward');await expect(game(page).locator('[data-ft=route][data-to="11"]')).toContainText('Lever opens gate');
  const option=game(page).locator('[data-ft=route][data-to="7"]');await option.focus();await page.keyboard.press('Enter');expect((await state(page)).selected).toBe(7);await expect(option).toBeFocused();
  await game(page).locator('[data-room="19"]').click();expect((await state(page)).selected).toBe(7);await expect(game(page).locator('[data-ft=primary]')).toHaveText(/Move to C2/);
  await game(page).locator('[data-ft=base]').click();await game(page).locator('[data-room="0"]').click();await game(page).locator('[data-ft=bonus]').click();expect((await state(page)).selected).toBe(7);
  await confirm(page);expect((await state(page)).totalPayoutUnits).toBe('100');expect((await state(page)).moves).toBe(4);
});

test('rope preparation is explicit and sends no operation until the crossing is confirmed',async({page})=>{
  await ready(page);await confirm(page);await game(page).locator('[data-ft=route][data-to="11"]').click();await confirm(page);
  const posts:any[]=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/expansion'))posts.push(JSON.parse(r.postData()!));});
  await game(page).locator('[data-ft=route][data-to="12"]').click();await expect(game(page).locator('[data-ft=primary]')).toBeEnabled();await expect(game(page).locator('[data-ft=primary]')).toHaveText('Prepare rope for C3');
  await game(page).locator('[data-ft=primary]').click();expect(posts).toEqual([]);expect((await state(page)).ropeSelected).toBe(true);expect((await state(page)).moves).toBe(4);await expect(game(page).locator('[data-ft=primary]')).toHaveText(/Rope to C3/);
  await confirm(page);expect(posts).toHaveLength(1);expect(posts[0].move).toBe('temple-rope');expect((await state(page)).moves).toBe(3);expect((await state(page)).totalPayoutUnits).toBe('250');
});

test('reopening restores passage guidance without choosing a fork or consuming a move',async({page})=>{
  await ready(page);await page.reload();await expect(game(page).locator('.ft')).toBeVisible();await idle(page);expect((await state(page)).selected).toBe(6);expect((await state(page)).moves).toBe(6);
  await confirm(page);await game(page).locator('[data-ft=route][data-to="11"]').click();await page.reload();await expect(game(page).locator('.ft')).toBeVisible();await idle(page);expect((await state(page)).selected).toBeNull();expect((await state(page)).moves).toBe(5);await expect(game(page).locator('.ft-route-option')).toHaveCount(3);expect((await state(page)).feedback.audio.played).toEqual({});
});

test('the first action stays disabled while the module is refreshing its initial shared snapshot',async({page})=>{
  let release!:()=>void,held=false,posts=0;
  page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/expansion'))posts++;});
  await page.route('**/api/*-wallet/expansion',async route=>{
    if(route.request().method()==='GET'&&!held&&await page.evaluate(()=>!!document.querySelector<HTMLIFrameElement>('.temple-frame')?.contentDocument?.querySelector('.ft'))){held=true;await new Promise<void>(resolve=>{release=resolve;});}
    await route.continue();
  });
  await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/tests/fixtures/temple-preview.html?lang=en');await expect(game(page).locator('.ft')).toBeVisible();await expect.poll(()=>!!release).toBe(true);
  await expect(game(page).locator('.ft')).toHaveAttribute('aria-busy','true');await expect(game(page).locator('[data-ft=primary]')).toBeDisabled();expect(posts).toBe(0);
  release();await expect(game(page).locator('[data-ft=primary]')).toBeEnabled();await game(page).locator('[data-ft=primary]').click();await expect.poll(async()=>(await state(page)).revision).toBe(1);await idle(page);expect(posts).toBe(1);expect((await state(page)).selected).toBe(6);
});

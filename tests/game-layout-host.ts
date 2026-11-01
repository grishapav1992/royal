import {expect,type Page} from '@playwright/test';

export async function enterGameHall(page:Page,path:string){
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto(path);
 await expect(page.getByLabel('Почта',{exact:true})).toBeVisible({timeout:30000});
 await page.getByLabel('Почта',{exact:true}).fill(`layout-${crypto.randomUUID()}@example.test`);
 await page.getByLabel('Пароль',{exact:true}).fill('Royal-layout-check-123!');await page.getByRole('button',{name:'Продолжить',exact:true}).click();
 await expect(page.locator('#character-step')).toBeVisible();await page.getByRole('button',{name:'Войти в зал',exact:true}).click();
 await expect(page.locator('#join-dialog')).toBeHidden();
 await expect.poll(()=>page.evaluate(()=>(window as any).royalDemo?.getState()?.online)).toBe(true);
 const credit=await page.request.post('/__test/layout/topup');expect(credit.ok(),await credit.text()).toBe(true);
 await page.evaluate(async()=>{const module='/src/wallet/WalletClient.ts';await(await import(/* @vite-ignore */module)).demoWallet.refresh();});
 await page.locator('#room-overview').click();
 await expect.poll(()=>page.evaluate(()=>Math.abs((window as any).royalDemo.getState().view.width-document.getElementById('game')!.clientWidth))).toBeLessThanOrEqual(1);
 await page.locator('#games-tab').click();
 await expect.poll(async()=>{
  if(await page.locator('#mini-dialog').isVisible())return true;
  const cabinet=page.locator('[data-cabinet="studio-cosmic-escape"]');
  try{
   if(!await cabinet.isVisible())await page.locator('#games-tab').click({timeout:4000});
   if(!await page.locator('#mini-dialog').isVisible())await cabinet.click({timeout:4000});
  }catch(error){if(!(error instanceof Error&&error.name==='TimeoutError'))throw error;}
  return page.locator('#mini-dialog').isVisible();
 },{timeout:60000,intervals:[1000,4000]}).toBe(true);
 await expect(page.locator('.royal-platform')).toBeVisible();
}
export async function chooseGame(page:Page,id:string){
 if(await page.locator('#mini-dialog').getAttribute('data-game')!=='royal-catalog')await page.locator('#studio-game-list').click();
 await page.locator(`[data-platform-game="${id}"]`).click();await expect(page.locator('#mini-game')).toHaveAttribute('data-game-module-id',id);
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
}

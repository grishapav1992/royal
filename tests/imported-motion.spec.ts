import { expect, type Page } from '@playwright/test';
import { test } from './themed-room';
import { worldPoint } from './room-ui';
import { IMPORTED_MOTION_GAMES } from '../src/ui/importedMotion/Outcome';

async function enter(page: Page, path: string) {
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto(path);
  await page.getByLabel('Почта',{exact:true}).fill(`imported-motion-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Пароль',{exact:true}).fill('Royal-motion-test-123!');
  await page.getByRole('button',{name:'Продолжить',exact:true}).click();
  await expect(page.locator('#character-step')).toBeVisible();
  await page.getByRole('button',{name:'Войти в зал',exact:true}).click();
  await expect(page.locator('#join-dialog')).toBeHidden({timeout:20000});
  await expect.poll(()=>page.evaluate(()=>(window as any).royalDemo.getState().online)).toBe(true);
  await page.getByRole('button',{name:'Открыть демокошелёк'}).click();
  await page.getByRole('button',{name:'Пополнить демобаланс',exact:true}).click();
  await page.getByRole('button',{name:'Закрыть кошелёк'}).click();
  if(await page.locator('#room-overview').getAttribute('aria-pressed')!=='true') await page.locator('#room-overview').click();
  if((await page.evaluate(()=>(window as any).royalDemo.getState())).x<1100){
    const aisle=await worldPoint(page,1100,900);await page.mouse.click(aisle.x,aisle.y);
    await expect.poll(async()=>{const s=await page.evaluate(()=>(window as any).royalDemo.getState());return Math.hypot(s.x-1100,s.y-900);},{timeout:25000}).toBeLessThan(30);
  }
  await page.locator('#games-tab').click();await page.locator('[data-cabinet=royal-fruits]').click();
  await expect(page.locator('#mini-game')).toHaveAttribute('data-game-module-id','royal-fruits',{timeout:25000});
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(()=>{(window as any).importedResults=[];document.addEventListener('royal-imported-confirmed-outcome',event=>(window as any).importedResults.push((event as CustomEvent).detail));});
}
async function choose(page: Page, id: string) {
  await page.locator('#studio-game-list').click();await page.locator('#mini-game [data-source=github]').click();
  await page.locator(`#mini-game [data-platform-game="${id}"]`).click();
  await expect(page.locator('#mini-game')).toHaveAttribute('data-game-module-id',id,{timeout:20000});
  await expect(page.locator(`[data-imported-motion="${id}"]`)).toBeVisible();
}
const results=(page:Page)=>page.evaluate(()=>(window as any).importedResults);

test('all eight retained GitHub modules animate owned confirmed outcomes in the real host with chat',async({page,roomPath})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.emulateMedia({reducedMotion:'no-preference'});await enter(page,roomPath);
  for(const id of IMPORTED_MOTION_GAMES){
    await choose(page,id);const root=page.locator(`[data-imported-motion="${id}"]`),before=(await results(page)).length;
    if(id==='royal-fruits')await page.locator('[data-fruits-spin]').click();
    else if(id==='royal-dice')await page.locator('[data-dice-play]').click();
    else if(id==='royal-limbo')await page.locator('[data-limbo-play]').click();
    else if(id==='royal-keno')await page.locator('#original-play').click();
    else if(id==='royal-mines'){
      await page.locator('#original-play').click();await expect(page.locator('[data-mine-cell="0"]')).toBeEnabled();
      await page.locator('[data-mine-cell="0"]').click();await expect(page.locator('#original-play')).toBeEnabled();
      if(!await root.getAttribute('data-win-tier'))await page.locator('#original-play').click();
    }else if(id==='github-craps'){
      await page.locator('#github-choice').selectOption('field');await page.locator('[data-action=start]').click();
    }else await page.locator('#mini-game [data-start]').click();
    await expect(root).toHaveAttribute('data-win-tier',/^(none|return|win|big|epic)$/,{timeout:15000});
    const accepted=await results(page);expect(accepted).toHaveLength(before+1);
    const last=accepted.at(-1);expect(last.gameId).toBe(id);
    expect(await root.getAttribute('data-returned-units')).toBe(last.returnedUnits);
    expect(await root.getAttribute('data-profit-units')).toBe(String(BigInt(last.returnedUnits)-BigInt(last.spentUnits)));
    if(BigInt(last.returnedUnits)<=BigInt(last.spentUnits))await expect(root.locator('.imp-celebration')).toHaveCount(0);
    expect(await page.evaluate(()=>(window as any).royalDemo.getState().cabinet)).toBe('royal-fruits');
    await expect(page.locator('#chat-input')).toBeInViewport();
    console.log('Confirmed motion',id,await root.getAttribute('data-win-tier'));
  }
  await choose(page,'royal-mines');await expect(page.locator('.imp-celebration')).toHaveCount(0);
  const count=(await results(page)).length;
  if(await page.locator('#original-refresh').isVisible())await page.locator('#original-refresh').click();
  await page.waitForTimeout(250);expect((await results(page)).length).toBe(count);
  await page.setViewportSize({width:390,height:844});await expect(page.locator('#chat-input')).toBeInViewport();
  expect(await page.locator('.imported-motion').evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
  await page.locator('#chat-input').fill('Проверка анимаций рядом с чатом');await page.locator('#send-chat').click();
  await expect(page.locator('#chat-log')).toContainText('Проверка анимаций рядом с чатом');
  await page.screenshot({path:'artifacts/imported-motion/real-host-mobile.png'});
  await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'artifacts/imported-motion/real-host-desktop.png'});
  await page.locator('#studio-game-list').click();await page.locator('#mini-game [data-source=royal]').click();
  await page.locator('[data-platform-game=studio-cosmic-escape]').click();
  await expect(page.locator('#mini-game')).toHaveAttribute('data-game-module-id','studio-cosmic-escape');
  await expect(page.locator('[data-imported-motion]')).toHaveCount(0);expect(errors).toEqual([]);
});

test('profit tiers, skip, new actions, reduced motion and closing cancel presentation without touching the wallet',async({page,roomPath})=>{
  await page.emulateMedia({reducedMotion:'no-preference'});await enter(page,roomPath);await choose(page,'royal-dice');
  const before=await page.locator('[data-dice-balance]').textContent();
  // Visual QA injects a presentation receipt locally. The target handler is blocked,
  // so these rare-tier previews create no gameplay or wallet request.
  const preview=async(returned:string)=>page.evaluate(value=>{
    const root=document.querySelector<HTMLElement>('[data-imported-motion=royal-dice]')!,button=root.querySelector<HTMLButtonElement>('[data-dice-play]')!;
    button.addEventListener('click',event=>event.stopImmediatePropagation(),{capture:true,once:true});button.click();
    const context=(window as any)[Symbol.for('royal.game-host.v1')].gameAudio.context;
    const original=context.createOscillator,voices:{disconnected:boolean}[]=[];
    context.createOscillator=function(){const node=original.call(context),voice={disconnected:false},disconnect=node.disconnect.bind(node);voices.push(voice);node.disconnect=()=>{voice.disconnected=true;disconnect();};return node;};
    try {root.dispatchEvent(new CustomEvent('royal-imported-confirmed-outcome',{detail:{gameId:'royal-dice',spentUnits:'10000',returnedUnits:value},bubbles:true}));}
    finally{context.createOscillator=original;}
    (window as any).motionVoices=voices;return voices.length;
  },returned);
  expect(await preview('50000')).toBe(9);await expect(page.locator('.imp-tier-big')).toBeVisible();
  await expect(page.locator('.imp-value')).toHaveText('+400,00');await page.screenshot({path:'artifacts/imported-motion/big-win-desktop.png'});
  await page.getByRole('button',{name:'Пропустить эффекты'}).click();await expect(page.locator('.imp-celebration')).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).motionVoices.every((v:any)=>v.disconnected))).toBe(true);
  await page.setViewportSize({width:390,height:844});expect(await preview('200000')).toBe(11);await expect(page.locator('.imp-tier-epic')).toBeVisible();
  await expect(page.locator('.imp-value')).toHaveText('+1 900,00');
  await expect(page.locator('#chat-input')).toBeInViewport();await page.screenshot({path:'artifacts/imported-motion/epic-win-mobile.png'});
  await page.evaluate(()=>(window as any)[Symbol.for('royal.game-host.v1')].gameAudio.setMuted(true));
  expect(await page.evaluate(()=>(window as any).motionVoices.every((v:any)=>v.disconnected))).toBe(true);
  await page.evaluate(()=>(window as any)[Symbol.for('royal.game-host.v1')].gameAudio.setMuted(false));
  await page.emulateMedia({reducedMotion:'reduce'});await expect(page.locator('.imp-celebration')).toHaveCount(0);
  expect(await preview('200000')).toBe(0);await expect(page.locator('.imp-celebration')).toBeVisible();await expect(page.locator('.imp-particle')).toHaveCount(0);
  expect(await page.locator('.imp-value').textContent()).toBe('+1 900,00');
  await page.waitForTimeout(750);await expect(page.locator('.imp-celebration')).toHaveCount(0);
  await preview('9999');await expect(page.locator('.imp-celebration')).toHaveCount(0);
  expect(await page.locator('[data-dice-balance]').textContent()).toBe(before);
  await page.locator('#mini-dialog .mini-top [data-close]').click();await expect(page.locator('[data-imported-motion]')).toHaveCount(0);
});

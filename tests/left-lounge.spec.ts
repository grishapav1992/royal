import {expect,type Page} from '@playwright/test';
import {test} from './themed-room';
import {worldPoint} from './room-ui';
import {SEATS,atBar} from '../src/shared/world';
import {BAR_POSITION} from '../src/shared/furniture';
import {ACTIVITIES} from '../src/shared/activities';
const state=(page:Page)=>page.evaluate(()=>(window as any).royalDemo.getState());
async function point(page:Page,x:number,y:number){const p=await worldPoint(page,x,y);await page.mouse.click(p.x,p.y);}
async function enter(page:Page,path:string){
 await page.route('https://luelonplay.com/**',r=>r.fulfill({json:{games:[]}}));
 await page.route('**/api/npc/mira',r=>r.fulfill({json:{turns:[{role:'assistant',content:'Добро пожаловать в бар.'}]}}));
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto(path);
 await page.getByLabel('Почта',{exact:true}).fill(`lounge-${crypto.randomUUID()}@example.test`);await page.getByLabel('Пароль',{exact:true}).fill('Royal-lounge-123!');
 await page.getByRole('button',{name:'Продолжить',exact:true}).click();await expect(page.locator('#character-step')).toBeVisible();await page.getByRole('button',{name:'Войти в зал',exact:true}).click();
 await expect(page.locator('#join-dialog')).toBeHidden({timeout:20000});await expect.poll(async()=>(await state(page)).online).toBe(true);
 await page.locator('#room-overview').click();await expect(page.locator('#room-overview')).toHaveAttribute('aria-pressed','true');
}
for(const mobile of [false,true])test(`relocated bar, both sofas and piano work online with chat on ${mobile?'mobile':'desktop'}`,async({page,roomPath})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));if(mobile)await page.setViewportSize({width:390,height:844});
 await enter(page,roomPath);
 await expect(page.locator('#chat-panel')).toBeVisible();
 await point(page,BAR_POSITION.x+132,BAR_POSITION.y+102);await expect(page.locator('#bar-dialog')).toBeVisible({timeout:18000});
 expect(atBar(await state(page))).toBe(true);
 await page.getByRole('button',{name:'Напитки',exact:true}).click();await page.locator('[data-drink=lemonade]').click();
 await expect.poll(async()=>(await state(page)).drink).toBe('lemonade');await page.locator('#bar-dialog [data-close]').click();
 await expect.poll(async()=>(await state(page)).action,{timeout:12000}).toBe('idle');
 for(const seat of SEATS.filter(s=>s.hall==='arcade')){
  await point(page,seat.x,seat.y-28);await expect.poll(async()=>(await state(page)).seat,{timeout:20000}).toBe(seat.id);
  const s=await state(page);expect(Math.hypot(s.x-seat.x,s.y-seat.y)).toBeLessThan(2);
  await page.locator('#game').focus();await page.keyboard.down('ArrowDown');await page.waitForTimeout(180);await page.keyboard.up('ArrowDown');await expect.poll(async()=>(await state(page)).seat).toBe('');
 }
 await point(page,ACTIVITIES.piano.bounds.x+55,ACTIVITIES.piano.bounds.y+30);
 await expect(page.locator('#shared-dialog[data-game=piano]')).toBeVisible({timeout:20000});await expect(page.locator('#piano-keys [data-note="60"]')).toBeEnabled();
 await page.locator('#piano-keys [data-note="60"]').click();await page.locator('#shared-close').click();
 await expect(page.locator('#shared-dialog')).toBeHidden();
 await page.locator('#chat-input').fill(mobile?'С телефона удобно пройти к диванам':'Зашёл в обновлённую гостиную');await page.locator('#send-chat').click();
 await expect(page.locator('#chat-log > [data-message-id]').filter({hasText:mobile?'С телефона удобно пройти к диванам':'Зашёл в обновлённую гостиную'})).toBeVisible();
 await page.screenshot({path:`artifacts/work/left-lounge/proof/hall-${mobile?'mobile':'desktop'}.png`});
 expect(await page.locator('body').evaluate(e=>e.scrollWidth<=window.innerWidth)).toBe(true);expect(errors).toEqual([]);
});

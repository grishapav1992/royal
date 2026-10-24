import {expect,type Page} from '@playwright/test';
import {test} from './themed-room';
import {worldPoint} from './room-ui';
import {ACTIVITIES} from '../src/shared/activities';
import {writeFile} from 'node:fs/promises';

const state=(page:Page)=>page.evaluate(()=>(window as any).royalDemo.getState());
for(const mobile of [false,true])test(`pianist stays at the visible piano when playing and reopening on ${mobile?'mobile':'desktop'}`,async({page,roomPath},testInfo)=>{
  test.setTimeout(90000);
  if(mobile)await page.setViewportSize({width:390,height:844});
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://luelonplay.com/**',route=>route.fulfill({json:{games:[]}}));
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto(roomPath);
  await page.getByLabel('Почта',{exact:true}).fill(`piano-position-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Пароль',{exact:true}).fill('Royal-piano-123!');
  await page.getByRole('button',{name:'Продолжить',exact:true}).click();
  await expect(page.locator('#character-step')).toBeVisible();
  await page.getByRole('button',{name:'Войти в зал',exact:true}).click();
  await expect.poll(async()=>(await state(page)).online).toBe(true);
  await page.locator('#room-overview').click();
  await expect(page.locator('#chat-panel')).toBeVisible();
  for(let attempt=0;attempt<2;attempt++){
    const bounds=ACTIVITIES.piano.bounds;
    const point=await worldPoint(page,bounds.x+bounds.w/2,bounds.y+bounds.h/2);
    await page.mouse.click(point.x,point.y);
    await expect(page.locator('#piano-keys [data-note="60"]')).toBeEnabled({timeout:20000});
    await expect.poll(async()=>{const s=await state(page);return Math.hypot(s.x-ACTIVITIES.piano.seat.x,s.y-ACTIVITIES.piano.seat.y);}).toBeLessThan(.05);
    expect(await state(page)).toMatchObject({seat:'piano',facing:'up'});
    await expect.poll(async()=>{const s=await state(page);return {x:s.serverX,y:s.serverY};}).toEqual(ACTIVITIES.piano.seat);
    await page.keyboard.down('a');
    await expect.poll(()=>page.evaluate(()=>(window as any).royalDemo.getActivities().notes)).toContain(60);
    await page.keyboard.up('a');
    if(attempt===0){
      const png=await page.locator('#game canvas').evaluate(canvas=>new Promise<string>(resolve=>requestAnimationFrame(()=>resolve((canvas as HTMLCanvasElement).toDataURL('image/png')))));
      await writeFile(testInfo.outputPath('piano-hall.png'),Buffer.from(png.split(',')[1],'base64'));
    }
    await page.locator('#shared-close').click();
    await expect.poll(async()=>{const s=await state(page);return Math.hypot(s.x-ACTIVITIES.piano.entry.x,s.y-ACTIVITIES.piano.entry.y);}).toBeLessThan(.05);
    expect(await state(page)).toMatchObject({seat:'',locked:false});
  }
  await expect(page.locator('#chat-panel')).toBeVisible();
  expect(errors).toEqual([]);
});

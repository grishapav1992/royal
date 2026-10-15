import {test,expect,type Page} from '@playwright/test';
import {worldPoint} from './room-ui';
const state=(p:Page)=>p.evaluate(()=>(window as any).royalDemo.getState());
const mini=(p:Page)=>p.evaluate(()=>(window as any).royalDemo.getMiniState());
async function ready(p:Page){await p.goto('/?offline=1');await expect(p.locator('#loading')).toHaveCount(0);}
async function open(p:Page,name:string){await p.locator('#games-tab').click();await p.getByRole('button',{name:'Подойти к автомату '+name,exact:true}).click();await expect(p.locator('#mini-dialog')).toBeVisible({timeout:15000});await p.getByRole('button',{name:'Начать игру',exact:true}).click();}
async function point(p:Page,x:number,y:number){const b=(await p.locator('#mini-game canvas').boundingBox())!;await p.mouse.click(b.x+b.width*x/640,b.y+b.height*y/450);}

test('former sofa space is walkable and animated drinks work while standing locally',async({page})=>{
  await ready(page);
  await expect(page.locator('#sit-sofa,#sit-bar')).toHaveCount(0);
  await page.locator('#room-overview').click();
  const point=await worldPoint(page,230,430);await page.mouse.click(point.x,point.y);
  await expect.poll(async()=>Math.hypot((await state(page)).x-230,(await state(page)).y-430),{timeout:12000}).toBeLessThan(4);
  expect((await state(page)).seat).toBe('');
  await page.getByRole('button',{name:'Мини-бар',exact:true}).click();
  await expect(page.locator('#bar-dialog')).toBeVisible({timeout:12000});
  await page.getByRole('button',{name:'Напитки',exact:true}).click();
  await page.locator('[data-drink="lemonade"]').click();
  await expect.poll(async()=>(await state(page)).action).toBe('drink');
  const frame=(await state(page)).frame;
  await expect.poll(async()=>(await state(page)).frame).not.toBe(frame);
  await page.screenshot({path:'artifacts/bar-drinking-standing.png'});
  await expect.poll(async()=>(await state(page)).action,{timeout:5000}).toBe('idle');
  await page.locator('#bar-dialog [data-close]').click();
  await page.getByRole('button',{name:'Мини-бар',exact:true}).click();
  await page.getByRole('button',{name:'Напитки',exact:true}).click();
  await page.locator('[data-drink="lemonade"]').click();
  await expect.poll(async()=>(await state(page)).action).toBe('drink');
  await page.locator('#bar-dialog [data-close]').click();
  await page.getByRole('button',{name:'Встать',exact:true}).click();
  await expect.poll(async()=>(await state(page)).seat).toBe('');
  await expect.poll(async()=>(await state(page)).action).toBe('idle');
  await expect.poll(async()=>(await state(page)).locked).toBe(false);
  const before=(await state(page)).y;
  await page.keyboard.down('ArrowDown');await page.waitForTimeout(200);await page.keyboard.up('ArrowDown');
  expect((await state(page)).y).toBeGreaterThan(before+15);
});

test('space shooter scores hits and cleans up on close',async({page})=>{
  test.setTimeout(60000);await ready(page);await open(page,'Space Orbit');
  const end=Date.now()+22000;
  while(Date.now()<end&&(await mini(page)).score<400){
    const s=await mini(page);const enemy=s.enemies.sort((a:any,b:any)=>b.y-a.y)[0];
    if(enemy){const b=(await page.locator('#mini-game canvas').boundingBox())!;await page.mouse.move(b.x+b.width*enemy.x/640,b.y+b.height*370/450);}
    await page.waitForTimeout(60);
  }
  expect((await mini(page)).score).toBeGreaterThanOrEqual(400);
  await page.screenshot({path:'artifacts/space-orbit.png'});
  await page.keyboard.press('Escape');await expect(page.locator('#mini-game canvas')).toHaveCount(0);
  expect((await state(page)).locked).toBe(false);
});

test('night drift steering, crashes and retry',async({page})=>{
  test.setTimeout(60000);await ready(page);await open(page,'Night Drift');
  await page.keyboard.press('ArrowRight');await expect.poll(async()=>(await mini(page)).lane).toBe(2);
  const end=Date.now()+20000;
  while(Date.now()<end&&(await mini(page)).phase==='playing'){
    const s=await mini(page);const obstacle=s.obstacles.filter((o:any)=>!o.coin&&o.y<360).sort((a:any,b:any)=>b.y-a.y)[0];
    if(obstacle)await point(page,220+obstacle.lane*100,373);
    await page.waitForTimeout(70);
  }
  expect((await mini(page)).phase).toBe('lost');expect((await mini(page)).score).toBeGreaterThan(0);
  await page.getByRole('button',{name:'Сыграть ещё',exact:true}).click();
  expect((await mini(page)).lives).toBe(3);
  await page.screenshot({path:'artifacts/night-drift.png'});
});

test('pixel quest collects all gems, wins and restarts',async({page})=>{
  test.setTimeout(60000);await ready(page);await open(page,'Pixel Quest');
  for(const key of ['3,1','11,1','7,3','1,7','7,7']){
    const [x,y]=key.split(',').map(Number);await point(page,80+x*40,75+y*40);
    await expect.poll(async()=>(await mini(page)).gems.includes(key),{timeout:12000}).toBe(false);
  }
  await point(page,80+11*40,75+7*40);
  await expect.poll(async()=>(await mini(page)).phase,{timeout:8000}).toBe('won');
  expect((await mini(page)).score).toBeGreaterThanOrEqual(1000);
  await page.screenshot({path:'artifacts/pixel-quest.png'});
  await page.getByRole('button',{name:'Сыграть ещё',exact:true}).click();
  expect((await mini(page)).gems.length).toBe(5);expect((await mini(page)).score).toBe(0);
});

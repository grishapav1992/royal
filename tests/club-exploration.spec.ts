import { expect, type Page } from '@playwright/test';
import { test } from './themed-room';
import { worldPoint } from './room-ui';
import { HALL_DOORS, GITHUB_ROOM_DOOR } from '../src/shared/world';
import { WORLD } from '../src/shared/clubGeometry';

const state=(page:Page)=>page.evaluate(()=>(window as any).royalDemo.getState());
async function overview(page:Page,on:boolean){if((await page.locator('#room-overview').getAttribute('aria-pressed')==='true')!==on)await page.locator('#room-overview').click();await page.waitForTimeout(200);}
async function walk(page:Page,x:number,y:number){const point=await worldPoint(page,x,y);await page.mouse.click(point.x,point.y);await expect.poll(async()=>{const s=await state(page);return Math.hypot(s.x-x,s.y-y);},{timeout:18000}).toBeLessThan(5);}
async function change(page:Page,door:{click:{x:number;y:number}},target:string){await overview(page,true);const point=await worldPoint(page,door.click.x,door.click.y);await page.mouse.click(point.x,point.y);await expect.poll(async()=>(await state(page)).hall,{timeout:22000}).toBe(target);}

test('explore the enlarged club, follow camera, map, all floors and local guest routines',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://luelonplay.com/**',route=>route.fulfill({json:{games:[]}}));
  await page.goto('/?offline=1');await expect(page.locator('#loading')).toHaveCount(0);
  const initial=await state(page);expect(initial.world.width).toBe(WORLD.width);expect(initial.world.height).toBe(WORLD.height);
  expect(initial.view.width/initial.view.zoom).toBeLessThan(initial.world.width);
  expect(initial.guests).toHaveLength(10);expect(initial.guests.some((guest:any)=>guest.mood==='drinking')).toBe(true);
  await expect(page.locator('.club-map')).toBeVisible();
  await page.screenshot({path:'artifacts/club-exploration/entrance.png'});
  await page.locator('.club-map canvas').click();await expect(page.locator('#room-overview')).toHaveAttribute('aria-pressed','true');
  await page.screenshot({path:'artifacts/club-exploration/floor-1-map.png'});
  await walk(page,1800,760);await overview(page,false);
  const far=await state(page);expect(far.view.x).toBeGreaterThan(initial.view.x+500);
  await page.screenshot({path:'artifacts/club-exploration/casino-gallery.png'});
  await overview(page,true);await walk(page,320,950);
  await page.keyboard.press('e');
  await expect.poll(async()=>(await state(page)).seat).toBe('arcade-lounge');
  await page.keyboard.down('d');await page.waitForTimeout(200);await page.keyboard.up('d');await expect.poll(async()=>(await state(page)).seat).toBe('');
  await change(page,HALL_DOORS.arcade,'tables');
  expect((await state(page)).guests.length).toBeGreaterThanOrEqual(7);
  await page.screenshot({path:'artifacts/club-exploration/floor-2-map.png'});
  await walk(page,1550,950);await overview(page,false);
  await page.screenshot({path:'artifacts/club-exploration/upstairs-library.png'});
  await change(page,GITHUB_ROOM_DOOR,'github');await page.screenshot({path:'artifacts/club-exploration/cards-map.png'});
  await change(page,HALL_DOORS.github,'tables');await change(page,HALL_DOORS.tables,'arcade');
  await page.setViewportSize({width:390,height:844});await overview(page,false);
  await expect(page.locator('.club-map')).toBeVisible();expect(await page.locator('body').evaluate(element=>element.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'artifacts/club-exploration/mobile.png'});
  await page.locator('.club-map-header button').click();await expect(page.locator('.club-map canvas')).toBeHidden();
  expect(errors).toEqual([]);
});

test('ambient guests remain visible online and agree between two visitors',async({page,roomPath,browser})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://luelonplay.com/**',route=>route.fulfill({json:{games:[]}}));
  await page.goto(roomPath);
  await page.getByLabel('Почта',{exact:true}).fill('explore-'+crypto.randomUUID()+'@example.test');await page.getByLabel('Пароль',{exact:true}).fill('Explore-club-password!');
  await page.getByRole('button',{name:'Продолжить',exact:true}).click();await expect(page.locator('#character-step')).toBeVisible();await page.getByRole('button',{name:'Войти в зал',exact:true}).click();
  await expect(page.locator('#join-dialog')).toBeHidden({timeout:15000});await expect.poll(async()=>(await state(page)).online).toBe(true);
  await expect.poll(async()=>(await state(page)).guests.length).toBe(10);
  const before=(await state(page)).guests;
  await expect.poll(async()=>{const guests=(await state(page)).guests;return guests.some((guest:any)=>{const previous=before.find((old:any)=>old.id===guest.id);return previous&&Math.hypot(guest.x-previous.x,guest.y-previous.y)>15;});},{timeout:30000}).toBe(true);
  // A second account joins the same persistent club with independent cookies.
  const otherContext=await browser.newContext(),other=await otherContext.newPage();
  await other.route('https://luelonplay.com/**',route=>route.fulfill({json:{games:[]}}));await other.goto(new URL(roomPath,page.url()).href);
  await other.getByLabel('Почта',{exact:true}).fill('explore-other-'+crypto.randomUUID()+'@example.test');await other.getByLabel('Пароль',{exact:true}).fill('Explore-other-password!');
  await other.getByRole('button',{name:'Продолжить',exact:true}).click();await expect(other.locator('#character-step')).toBeVisible();await other.getByRole('button',{name:'Войти в зал',exact:true}).click();
  await expect.poll(async()=>{try{return (await state(other)).online;}catch{return false;}},{timeout:20000}).toBe(true);
  await expect.poll(async()=>(await state(other)).guests.length).toBe(10);
  const first=(await state(page)).guests,second=(await state(other)).guests;
  expect(first.map((guest:any)=>guest.id)).toEqual(second.map((guest:any)=>guest.id));
  for(const guest of first){const remote=second.find((value:any)=>value.id===guest.id);expect(Math.hypot(guest.x-remote.x,guest.y-remote.y)).toBeLessThan(40);}
  await change(page,HALL_DOORS.arcade,'tables');await expect.poll(async()=>(await state(page)).guests.length).toBeGreaterThanOrEqual(7);
  await page.screenshot({path:'artifacts/club-exploration/online-floor-2.png'});
  expect(errors).toEqual([]);await otherContext.close();
});

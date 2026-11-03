import {test,expect,type Page} from '@playwright/test';
import {STREET} from '../src/shared/street';
const state=(page:Page)=>page.evaluate(()=>(window as any).royalDemo.getState());
async function overview(page:Page,on:boolean){const b=page.locator('#room-overview');if((await b.getAttribute('aria-pressed')==='true')!==on)await b.click();await expect.poll(async()=>(await state(page)).view.overview).toBe(on);}
async function walk(page:Page,x:number,y:number){
  await overview(page,true);
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  const box=(await page.locator('#game canvas').boundingBox())!,s=await state(page),v=s.view;
  await page.mouse.click(box.x+(x-v.x)*v.zoom*box.width/v.width,box.y+(y-v.y)*v.zoom*box.height/v.height);
  await expect.poll(async()=>{const p=await state(page);return Math.hypot(p.x-x,p.y-y);},{timeout:25000}).toBeLessThan(5);
  await expect.poll(async()=>{const p=await state(page);return Math.hypot(p.serverX-p.x,p.serverY-p.y);}).toBeLessThan(3);
}
test('keep the road in front and enter the full-width courtyard only after clearing the rear corner',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');await page.getByLabel('Почта',{exact:true}).fill(`camera-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Пароль',{exact:true}).fill('Camera-test-local!');await page.getByRole('button',{name:'Продолжить',exact:true}).click();
  await expect(page.locator('#character-step')).toBeVisible({timeout:15000});await page.getByRole('button',{name:'Войти в зал',exact:true}).click();
  await expect.poll(async()=>(await state(page)).online).toBe(true);
  const balance=await page.locator('#wallet-balance').textContent();
  await page.locator('[data-floor-target="street"]').click();await expect.poll(async()=>(await state(page)).hall,{timeout:25000}).toBe('street');
  await walk(page,840,1130);await overview(page,false);
  const cars=(await state(page)).street.carRender;
  expect(cars.some((car:any)=>car.visible)).toBe(true);
  await expect.poll(async()=>(await state(page)).street.carRender[0].x).not.toBe(cars[0].x);
  const after=(await state(page)).street.carRender;
  expect(after.every((car:any,index:number)=>car.y===cars[index].y&&car.angle===0&&car.y>=1210)).toBe(true);
  await page.screenshot({path:`../courtyard-${info.project.name}-front-road.png`});
  await walk(page,480,1050);await walk(page,480,710);await overview(page,false);
  expect((await state(page)).street.view.orientation).toBe('front');
  expect((await state(page)).street.view.angle).toBe(0);
  await page.screenshot({path:`../courtyard-${info.project.name}-side-pass.png`});
  await walk(page,480,360);await overview(page,false);
  expect((await state(page)).street.view.side).toBe('front');
  await page.screenshot({path:`../courtyard-${info.project.name}-before-corner.png`});
  await page.evaluate(()=>{
    (window as any).__cornerFrames=[];
    const record=()=>{const s=(window as any).royalDemo.getState();(window as any).__cornerFrames.push({x:s.x,y:s.y,side:s.street?.view.side});if((window as any).__recordCorner)requestAnimationFrame(record);};
    (window as any).__recordCorner=true;requestAnimationFrame(record);
  });
  await page.keyboard.down('ArrowRight');
  try{await expect.poll(async()=>(await state(page)).street.view.side,{timeout:8000,intervals:[50]}).toBe('rear');}finally{await page.keyboard.up('ArrowRight');}
  await page.evaluate(()=>(window as any).__recordCorner=false);
  const frames=await page.evaluate(()=>(window as any).__cornerFrames as {x:number;y:number;side:string}[]);
  const entered=frames.find(p=>p.side==='rear');expect(entered).toBeTruthy();expect(entered!.x).toBeGreaterThan(STREET.building.x+32);expect(entered!.y).toBeLessThan(STREET.building.y-48);
  const rear=await state(page);expect(rear.street.view.wall.width).toBe(STREET.building.w);expect(rear.street.carRender.every((car:any)=>!car.visible)).toBe(true);expect(rear.street.frontRoadVisible).toBe(false);
  expect(rear.street.props.find((p:any)=>p.texture==='street-detail-parked-taxi').visible).toBe(false);
  await walk(page,1370,365);await overview(page,false);
  await page.screenshot({path:`../courtyard-${info.project.name}-rear.png`});
  await page.reload();await expect(page.locator('#chat-input')).toBeEnabled({timeout:25000});await expect.poll(async()=>(await state(page)).street?.view.side).toBe('rear');
  await walk(page,2320,360);expect((await state(page)).street.view.side).toBe('rear');
  await walk(page,2320,710);await overview(page,false);expect((await state(page)).street.view.orientation).toBe('front');
  await page.screenshot({path:`../courtyard-${info.project.name}-right-pass.png`});
  await expect(page.locator('#chat-input')).toBeEnabled();await expect(page.locator('#wallet-balance')).toHaveText(balance!);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);expect(errors).toEqual([]);
});

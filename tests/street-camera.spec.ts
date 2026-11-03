import {test,expect,type Page} from '@playwright/test';
import {STREET} from '../src/shared/street';
import {projectStreetGround} from '../src/game/streetView';
const state=(page:Page)=>page.evaluate(()=>(window as any).royalDemo.getState());
async function overview(page:Page,on:boolean){const b=page.locator('#room-overview');if((await b.getAttribute('aria-pressed')==='true')!==on)await b.click();await expect.poll(async()=>(await state(page)).view.overview).toBe(on);}
async function walk(page:Page,x:number,y:number){
  await overview(page,true);
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  const box=(await page.locator('#game canvas').boundingBox())!,s=await state(page),v=s.view;
  await page.mouse.click(box.x+(x-v.x)*v.zoom*box.width/v.width,box.y+(y-v.y)*v.zoom*box.height/v.height);
  const tolerance=Math.max(5,2/v.zoom);
  await expect.poll(async()=>{const p=await state(page);return Math.hypot(p.x-x,p.y-y);},{timeout:25000}).toBeLessThan(tolerance);
  await expect.poll(async()=>{const p=await state(page);return Math.hypot(p.serverX-p.x,p.serverY-p.y);}).toBeLessThan(3);
}
async function closeWalk(page:Page,x:number,y:number){
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  const box=(await page.locator('#game canvas').boundingBox())!,s=await state(page),v=s.view,p=projectStreetGround({x,y},s.street.view.orientation);
  await page.mouse.click(box.x+(p.x-v.x)*v.zoom*box.width/v.width,box.y+(p.y-v.y)*v.zoom*box.height/v.height);
  await expect.poll(async()=>{const s=await state(page);return Math.hypot(s.x-x,s.y-y);},{timeout:15000}).toBeLessThan(5);
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
  await walk(page,600,1050);await overview(page,false);
  await page.evaluate(()=>{
    (window as any).__edgeViolations=[];(window as any).__recordEdges=true;(window as any).__clearanceFrames=0;
    const record=()=>{
      const s=(window as any).royalDemo.getState();
      if(s.hall==='street'&&!s.view.overview){
        const wall=s.street.view.wall,body=s.renderBounds;
        const bodyOnWall=s.renderY<wall.base&&body.x+body.width>wall.left&&body.x<wall.right;
        const npcOnWall=s.street.characterBounds.some((p:any)=>p.visible&&p.y<wall.base&&p.right>wall.left&&p.left<wall.right);
        const bad=!s.renderVisible||!s.halo.visible||Math.hypot(s.halo.x-s.renderX,s.halo.y-s.renderY)>.1||bodyOnWall||npcOnWall;
        (window as any).__clearanceFrames++;
        if(bad)(window as any).__edgeViolations.push({x:s.x,y:s.y,side:s.street.view.side,bodyOnWall,npcOnWall,body,halo:s.halo});
      }
      if((window as any).__recordEdges)requestAnimationFrame(record);
    };requestAnimationFrame(record);
  });
  await closeWalk(page,600,700);
  expect((await state(page)).street.view.orientation).toBe('front');
  expect((await state(page)).street.view.angle).toBe(0);
  await page.screenshot({path:`../courtyard-${info.project.name}-side-pass.png`});
  await closeWalk(page,600,470);
  await page.screenshot({path:`../courtyard-${info.project.name}-left-tight.png`});
  await closeWalk(page,600,360);
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
  await walk(page,600,360);await overview(page,false);
  await closeWalk(page,600,536);expect((await state(page)).street.view.side).toBe('rear');
  await closeWalk(page,600,570);expect((await state(page)).street.view.side).toBe('front');
  await page.screenshot({path:`../courtyard-${info.project.name}-left-tight-exit.png`});
  await closeWalk(page,600,360);
  await page.keyboard.down('ArrowRight');
  try{await expect.poll(async()=>(await state(page)).street.view.side,{timeout:8000,intervals:[50]}).toBe('rear');}finally{await page.keyboard.up('ArrowRight');}
  await walk(page,2320,360);expect((await state(page)).street.view.side).toBe('rear');
  await walk(page,2320,710);await overview(page,false);expect((await state(page)).street.view.orientation).toBe('front');
  await closeWalk(page,2120,700);await closeWalk(page,2120,470);
  await page.screenshot({path:`../courtyard-${info.project.name}-right-tight.png`});
  await closeWalk(page,2120,360);
  await page.keyboard.down('ArrowLeft');
  try{await expect.poll(async()=>(await state(page)).street.view.side,{timeout:8000,intervals:[50]}).toBe('rear');}finally{await page.keyboard.up('ArrowLeft');}
  await closeWalk(page,2120,536);expect((await state(page)).street.view.side).toBe('rear');
  await closeWalk(page,2120,570);expect((await state(page)).street.view.side).toBe('front');
  await page.screenshot({path:`../courtyard-${info.project.name}-right-tight-exit.png`});
  await page.evaluate(()=>(window as any).__recordEdges=false);
  expect(await page.evaluate(()=>(window as any).__edgeViolations)).toEqual([]);
  expect(await page.evaluate(()=>(window as any).__clearanceFrames)).toBeGreaterThan(100);
  await page.screenshot({path:`../courtyard-${info.project.name}-right-pass.png`});
  await page.reload();await expect(page.locator('#chat-input')).toBeEnabled({timeout:25000});await expect.poll(async()=>(await state(page)).street?.view.side).toBe('front');
  await expect(page.locator('#chat-input')).toBeEnabled();await expect(page.locator('#wallet-balance')).toHaveText(balance!);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);expect(errors).toEqual([]);
});

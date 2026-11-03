import {test,expect,type Page} from '@playwright/test';
import {STREET} from '../src/shared/street';
import {projectStreetPoint} from '../src/game/streetView';

const state=(page:Page)=>page.evaluate(()=>(window as any).royalDemo.getState());
async function overview(page:Page,on:boolean){
  const b=page.locator('#room-overview');
  if((await b.getAttribute('aria-pressed')==='true')!==on)await b.click();
  await expect.poll(async()=>(await state(page)).view.overview).toBe(on);
}
async function walk(page:Page,x:number,y:number,plan=false){
  if(plan)await overview(page,true);
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  const box=(await page.locator('#game canvas').boundingBox())!,s=await state(page),v=s.view,p=projectStreetPoint({x,y},s.street.view.orientation);
  await page.mouse.click(box.x+(p.x-v.x)*v.zoom*box.width/v.width,box.y+(p.y-v.y)*v.zoom*box.height/v.height);
  await expect.poll(async()=>{const s=await state(page);return Math.hypot(s.x-x,s.y-y);},{timeout:25000}).toBeLessThan(Math.max(5,3/v.zoom));
  await expect.poll(async()=>{const s=await state(page);return Math.hypot(s.serverX-s.x,s.serverY-s.y);}).toBeLessThan(3);
  await expect.poll(async()=>{const s=await state(page),p=projectStreetPoint(s,s.street.view.orientation);return Math.hypot(s.renderX-p.x,s.renderY-p.y);}).toBeLessThan(.6);
}

test('building covers people before the view changes behind either rear corner',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');await page.getByLabel('Почта',{exact:true}).fill(`layers-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Пароль',{exact:true}).fill('Layers-test-local!');await page.getByRole('button',{name:'Продолжить',exact:true}).click();
  await expect(page.locator('#character-step')).toBeVisible({timeout:15000});await page.getByRole('button',{name:'Войти в зал',exact:true}).click();
  await expect.poll(async()=>(await state(page)).online).toBe(true);
  const balance=await page.locator('#wallet-balance').textContent();
  await page.locator('[data-floor-target="street"]').click();await expect.poll(async()=>(await state(page)).hall,{timeout:25000}).toBe('street');
  await walk(page,600,1050,true);await overview(page,false);await walk(page,600,360);

  await page.evaluate(()=>{
    (window as any).__layerViolations=[];(window as any).__layerFrames=0;(window as any).__recordLayers=true;
    const record=()=>{
      const s=(window as any).royalDemo.getState();
      if(s.hall==='street'&&!s.view.overview){
        const w=s.street.view.wall,b=s.renderBounds;
        const belowBuilding=s.renderY<w.base&&b.x+b.width>w.left&&b.x<w.right;
        const badNpc=s.street.characterBounds.some((p:any)=>p.visible&&p.y<w.base&&p.right>w.left&&p.left<w.right&&p.depth>=w.base);
        if((belowBuilding&&s.renderDepth>=w.base)||badNpc||(s.buildingOccluded&&(s.halo.visible||s.labelVisible)))(window as any).__layerViolations.push({x:s.x,y:s.y,belowBuilding,badNpc,depth:s.renderDepth});
        (window as any).__layerFrames++;
      }
      if((window as any).__recordLayers)requestAnimationFrame(record);
    };requestAnimationFrame(record);
  });
  for(const side of ['left','right'] as const){
    if(side==='right'){await walk(page,2320,360,true);await walk(page,2320,710,true);await overview(page,false);await walk(page,2120,360);}
    await walk(page,side==='left'?636:2084,360);
    let s=await state(page);expect(s.street.view.side).toBe('front');expect(s.buildingOccluded).toBe(false);expect(s.renderDepth).toBeLessThan(s.street.view.wall.base);
    await page.screenshot({path:`../layers-${info.project.name}-${side}-partial.png`});
    await walk(page,side==='left'?656:2064,360);
    s=await state(page);expect(s.street.view.side).toBe('front');expect(s.buildingOccluded).toBe(true);expect(s.halo.visible).toBe(false);expect(s.labelVisible).toBe(false);
    await page.screenshot({path:`../layers-${info.project.name}-${side}-hidden.png`});
    await walk(page,side==='left'?688:2032,360);
    s=await state(page);expect(s.street.view.side).toBe('rear');expect(s.buildingOccluded).toBe(false);expect(s.halo.visible).toBe(true);expect(s.street.view.wall.width).toBe(STREET.building.w);
    expect(s.street.carRender.every((p:any)=>!p.visible)).toBe(true);expect(s.street.frontRoadVisible).toBe(false);
    await page.screenshot({path:`../layers-${info.project.name}-${side}-rear.png`});
  }
  await page.evaluate(()=>(window as any).__recordLayers=false);
  expect(await page.evaluate(()=>(window as any).__layerViolations)).toEqual([]);
  expect(await page.evaluate(()=>(window as any).__layerFrames)).toBeGreaterThan(100);
  await page.reload();await expect(page.locator('#chat-input')).toBeEnabled({timeout:25000});await expect.poll(async()=>(await state(page)).street?.view.side).toBe('rear');
  await expect(page.locator('#wallet-balance')).toHaveText(balance!);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);expect(errors).toEqual([]);
});

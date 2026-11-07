import {test,expect,type Page} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {STAIR_WINDOW} from '../src/shared/stairWindow';
import {ROOF_STAIRS,ROOF_STAIR_RETURN,STREET_ROOF_STAIRS,ROOF_WINDOW_PLATFORM,onRoofWindowPlatform,roofWindowPlatformOffset} from '../src/shared/rooftop';
import {projectStreetPoint} from '../src/game/streetView';

const state=(page:Page)=>page.evaluate(()=>(window as any).royalDemo.getState());
async function overview(page:Page,on:boolean){const b=page.locator('#room-overview');if((await b.getAttribute('aria-pressed')==='true')!==on)await b.click();}
async function clickPoint(page:Page,p:{x:number;y:number}){
  await page.bringToFront();await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
  const s=await state(page),b=(await page.locator('#game canvas').boundingBox())!;
  const x=b.x+(p.x-s.view.x)*s.view.zoom*b.width/s.view.width,y=b.y+(p.y-s.view.y)*s.view.zoom*b.height/s.view.height;
  expect(x).toBeGreaterThanOrEqual(b.x);expect(x).toBeLessThanOrEqual(b.x+b.width);expect(y).toBeGreaterThanOrEqual(b.y);expect(y).toBeLessThanOrEqual(b.y+b.height);
  await page.mouse.click(x,y);
}
async function walk(page:Page,x:number,y:number){
  const s=await state(page);await clickPoint(page,projectStreetPoint({x,y},s.street.view.orientation));
  await expect.poll(async()=>{const p=await state(page);return Math.hypot(p.x-x,p.y-y);},{timeout:25000}).toBeLessThan(Math.max(5,2/s.view.zoom));
}
async function keyUntil(page:Page,key:string,ready:()=>Promise<boolean>){
  await page.keyboard.down(key);try{await expect.poll(ready,{timeout:20000,intervals:[16,32,50]}).toBe(true);}finally{await page.keyboard.up(key);}
}
async function leaveWindow(page:Page){
  await keyUntil(page,'w',async()=>(await state(page)).hall==='street');
  await expect.poll(async()=>(await state(page)).switching).toBe(false);
  expect(onRoofWindowPlatform(await state(page))).toBe(true);
}
async function holdCombo(page:Page,y:number,goal:'inside'|'roof'|'window'|'ground',name:string){
  await page.bringToFront();await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
  await page.keyboard.down(y<0?'w':'s');await page.keyboard.down('d');
  let trace:{samples:number[][];elapsedMs:number;steps:number[];maxReverse:number;maxIdleMs:number};
  try{trace=await page.evaluate(({y,goal,landingY,windowOffset,junctionX,index,groundRenderY})=>new Promise<any>((resolve,reject)=>{
    const start=performance.now(),samples:number[][]=[],steps=new Set<number>();
    let previous:any,lastMovement=start,maxReverse=0,maxIdleMs=0,bestProgress=-Infinity;
    const sample=()=>{
      const now=performance.now(),s=(window as any).royalDemo.getState();
      samples.push([Math.round(now-start),s.x,s.y,s.stairStep,s.hall==='street'?0:s.hall==='github'?1:2,s.renderX,s.renderY]);
      if(s.hall==='street'&&s.stairStep>0)steps.add(s.stairStep);
      // Rendered feet stay in one coordinate system when predicted movement reaches the pavement.
      if(s.hall==='street'){bestProgress=Math.max(bestProgress,s.renderY*y);maxReverse=Math.max(maxReverse,bestProgress-s.renderY*y);}
      if(previous&&previous.hall==='street'&&s.hall==='street'&&previous.stairStep>0&&s.stairStep>0){
        if(Math.hypot(s.renderX-previous.renderX,s.renderY-previous.renderY)>.05)lastMovement=now;
        maxIdleMs=Math.max(maxIdleMs,now-lastMovement);
      }else lastMovement=now;
      const offset=junctionX-s.x;
      const done=goal==='inside'?s.hall==='github':goal==='roof'?s.hall==='roof':goal==='ground'?s.hall==='street'&&(s.stairStep===0||s.renderY>=groundRenderY):s.hall==='street'&&Math.abs(s.y-landingY)<.001&&[index,index+1].includes(s.stairStep)&&offset>=windowOffset-12;
      if(done){resolve({samples,elapsedMs:now-start,steps:[...steps].sort((a,b)=>a-b),maxReverse,maxIdleMs});return;}
      if(s.hall!=='street'||!s.stairStep||maxReverse>.3||now-lastMovement>1500||now-start>30000){
        reject(new Error(JSON.stringify({goal,hall:s.hall,x:s.x,y:s.y,step:s.stairStep,maxReverse,maxIdleMs,elapsedMs:now-start})));return;
      }
      previous=s;requestAnimationFrame(sample);
    };sample();
  }),{y,goal,landingY:STAIR_WINDOW.landing.y,windowOffset:ROOF_WINDOW_PLATFORM.windowOffset,junctionX:ROOF_WINDOW_PLATFORM.junction.x,index:ROOF_WINDOW_PLATFORM.index,groundRenderY:projectStreetPoint(STREET_ROOF_STAIRS.foot,'rear').y+8});}
  finally{await page.keyboard.up('d');await page.keyboard.up(y<0?'w':'s');}
  expect(trace.elapsedMs).toBeGreaterThan(1000);expect(trace.maxReverse).toBeLessThan(.3);expect(trace.maxIdleMs).toBeLessThan(1500);
  console.log('Held stair route',JSON.stringify({name,y,goal,durationMs:Math.round(trace.elapsedMs),samples:trace.samples.length,steps:trace.steps,maxReverse:trace.maxReverse,maxIdleMs:Math.round(trace.maxIdleMs)}));
  return {name,y,goal,...trace};
}

for(const online of [false,true])test('held stair combinations complete every flight and window round trip in '+(online?'connected':'solo')+' mode',async({page})=>{
  test.setTimeout(240000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const mode=online?'connected':'solo';await page.goto(online?'/':'/?offline=1');
  if(online){
    await page.getByLabel('Почта',{exact:true}).fill('held-stair-'+crypto.randomUUID()+'@example.test');
    await page.getByLabel('Пароль',{exact:true}).fill('Held-stair-local-check!');
    await page.getByRole('button',{name:'Продолжить',exact:true}).click();await expect(page.locator('#character-step')).toBeVisible({timeout:15000});await page.getByRole('button',{name:'Войти в зал',exact:true}).click();
    await expect(page.locator('#chat-input')).toBeEnabled({timeout:25000});
  }
  await page.locator('[data-floor-target="street"]').click();await expect.poll(async()=>(await state(page)).hall,{timeout:25000}).toBe('street');
  await overview(page,true);for(const p of [{x:480,y:1050},{x:480,y:360},{x:1660,y:360}])await walk(page,p.x,p.y);await overview(page,false);
  await keyUntil(page,'w',async()=>(await state(page)).stairStep>0);
  const traces=[];
  traces.push(await holdCombo(page,-1,'inside','lower ascent to window'));
  await expect.poll(async()=>(await state(page)).switching).toBe(false);await leaveWindow(page);
  await page.screenshot({path:'../held-stair-'+mode+'-window.png'});
  await keyUntil(page,'a',async()=>roofWindowPlatformOffset(await state(page))<.1);
  await keyUntil(page,'w',async()=>(await state(page)).y<STAIR_WINDOW.landing.y-6);
  traces.push(await holdCombo(page,-1,'roof','upper ascent past balcony to roof'));
  await page.screenshot({path:'../held-stair-'+mode+'-roof.png'});
  await overview(page,true);await clickPoint(page,ROOF_STAIRS.click);await expect.poll(async()=>(await state(page)).hall,{timeout:15000}).toBe('street');
  expect((await state(page)).stairStep).toBe(ROOF_STAIR_RETURN.stairStep);await overview(page,false);
  traces.push(await holdCombo(page,1,'window','upper descent to window'));
  await keyUntil(page,'w',async()=>(await state(page)).hall==='github');await expect.poll(async()=>(await state(page)).switching).toBe(false);await leaveWindow(page);
  await keyUntil(page,'a',async()=>roofWindowPlatformOffset(await state(page))<.1);
  await keyUntil(page,'s',async()=>(await state(page)).y>STAIR_WINDOW.landing.y+6);
  traces.push(await holdCombo(page,1,'ground','lower descent past balcony to ground'));
  await expect.poll(async()=>(await state(page)).stairStep).toBe(0);
  const final=await state(page);
  await writeFile('../held-stair-'+mode+'-trace.json',JSON.stringify({mode,errors,traces,final:{hall:final.hall,x:final.x,y:final.y,stairStep:final.stairStep}}));
  expect(final.hall).toBe('street');expect(final.stairStep).toBe(0);
  // The held diagonal can advance one normal walking frame after stepping onto the ground.
  expect(Math.abs(final.x-STREET_ROOF_STAIRS.foot.x)).toBeLessThan(12);
  for(const step of [1,2,3,4,5,6])expect(traces[0].steps).toContain(step);
  for(const step of [7,8,9,10,11])expect(traces[1].steps).toContain(step);
  for(const step of [7,8,9,10])expect(traces[2].steps).toContain(step);
  for(const step of [1,2,3,4,5,6])expect(traces[3].steps).toContain(step);
  expect(errors).toEqual([]);
  if (online) {
    await expect(page.locator('.local-label')).toHaveAttribute('data-status', 'connected');
    await expect(page.locator('#club-chat-dock')).toBeHidden();
    await expect(page.locator('#chat-input')).toBeDisabled();
  }
  await page.screenshot({path:'../held-stair-'+mode+'-ground.png'});
});

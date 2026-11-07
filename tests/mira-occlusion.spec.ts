import {test,expect,type Browser,type Page,type BrowserContext} from '@playwright/test';
import {ROYAL_BAR_PROPS} from '../src/game/royalBarLayers';
import {sampleMiraFrame} from '../src/game/miraAnimation';
import {MIRA_SEAT,type MiraView} from '../src/shared/miraRoutine';

const work=process.env.MIRA_AUDIT_WORK??'artifacts/work/royal-bar-mira/animation-check-20261105/';
const compiledHost=process.env.MIRA_AUDIT_COMPILED==='1';
const state=(page:Page)=>page.evaluate(()=>(window as any).royalDemo.getState());
const settle=(page:Page)=>page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
async function ready(page:Page){
  await page.waitForFunction(requireAudit=>{try{return (window as any).royalDemo.getState().mira.artVersion===3&&(!requireAudit||Boolean((window as any).royalMiraAudit));}catch{return false;}},!compiledHost,{timeout:45000});
  await page.locator('#loading').waitFor({state:'detached'});
}
function inside(x:number,y:number,polygon:readonly(readonly number[])[]){
  let included=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const [ax,ay]=polygon[i],[bx,by]=polygon[j];
    if((ay>y)!==(by>y)&&x<(bx-ax)*(y-ay)/(by-ay)+ax)included=!included;
    const dx=bx-ax,dy=by-ay,t=Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy)));
    if(Math.hypot(x-ax-t*dx,y-ay-t*dy)<5)return false;
  }
  return included;
}
const probes=Object.entries(ROYAL_BAR_PROPS).flatMap(([name,polygon])=>{
  const rows:{name:string;point:number[]}[]=[];
  for(let y=Math.min(...polygon.map(p=>p[1]));y<=Math.max(...polygon.map(p=>p[1]));y+=4){
    for(let x=Math.min(...polygon.map(p=>p[0]));x<=Math.max(...polygon.map(p=>p[0]));x+=4){
      if(inside(x,y,polygon))rows.push({name,point:[117.4+x*.2,316+y*.2]});
    }
  }
  return rows;
});
for(let y=451;y<=459;y+=2)for(let x=390;x<=398;x+=2)probes.push({name:'cat-mug',point:[x,y]});
const points=probes.map(p=>p.point);
const diff=(a:number[][],b:number[][])=>probes.reduce<Record<string,number>>((out,probe,i)=>{
  if(a[i].some((value,channel)=>value!==b[i][channel]))out[probe.name]=(out[probe.name]??0)+1;
  return out;
},{});
const poses=new Map<string,MiraView>();
for(const action of ['walk','sit','sit-down','stand-up','wipe','polish','stock','serve','greet','listen','chat'] as const){
  for(let n=0;n<=1000;n++){
    const view:MiraView={x:['sit','sit-down','stand-up','wipe'].includes(action)?191:action==='stock'?335:265,y:action==='stock'?446:456,facing:action==='walk'?'right':'down',action,progress:n/1000};
    const frame=sampleMiraFrame(view),key=frame.atlas+':'+frame.frame;
    if(!poses.has(key))poses.set(key,view);
  }
}

for(const viewport of [{width:1280,height:900},{width:390,height:844}])test(`${viewport.width}: all 128 poses keep countertop props and the cat mug in front`,async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize(viewport);await page.goto('/?offline=1');await ready(page);
  await page.evaluate(()=>{const audit=(window as any).royalMiraAudit;audit.focus();audit.actors(false);audit.showMira(false);});await settle(page);
  const reference=await page.evaluate(points=>(window as any).royalMiraAudit.pixels(points),points) as number[][];
  expect(reference.every(pixel=>pixel.length===4&&pixel[3]===255)).toBe(true);
  await page.evaluate(()=>{const audit=(window as any).royalMiraAudit;audit.showMira(true);audit.legacyProps(true);audit.pose({x:191,y:456,facing:'down',action:'wipe',progress:.08});});await settle(page);
  const legacy=diff(reference,await page.evaluate(points=>(window as any).royalMiraAudit.pixels(points),points));
  expect(legacy.glass??0,'Negative control must reproduce the original hand-over-glass defect').toBeGreaterThan(0);
  await page.evaluate(()=>(window as any).royalMiraAudit.legacyProps(false));
  const checked:string[]=[];
  for(const [key,view] of poses){
    await page.evaluate(view=>(window as any).royalMiraAudit.pose(view),view);await settle(page);
    const current=await page.evaluate(points=>(window as any).royalMiraAudit.pixels(points),points);
    expect(diff(reference,current),key).toEqual({});
    const actual=(await state(page)).mira;expect(actual.atlas+':'+actual.frame).toBe(key);checked.push(key);
  }
  expect(checked).toHaveLength(128);
  for(let n=0;n<24;n++){
    await page.evaluate(view=>(window as any).royalMiraAudit.pose(view),{x:334,y:456,facing:'down',action:'wipe',progress:(n+.5)/120});await settle(page);
    expect(diff(reference,await page.evaluate(points=>(window as any).royalMiraAudit.pixels(points),points)),'right wiping '+n).toEqual({});
  }
  await page.evaluate(()=>(window as any).royalMiraAudit.pose({x:191,y:456,facing:'down',action:'wipe',progress:.08}));await settle(page);
  await page.screenshot({path:work+'fixed-wipe-'+viewport.width+'.png'});
  await page.evaluate(()=>(window as any).royalMiraAudit.pose({x:218,y:474,facing:'down',action:'sit',progress:.5}));await settle(page);
  await page.screenshot({path:work+'fixed-sit-'+viewport.width+'.png'});
  const layers=await page.evaluate(()=>(window as any).royalMiraAudit.layers());
  const hand=layers.find((layer:any)=>layer.name==='mira-painted-front').depth;
  const body=layers.find((layer:any)=>layer.name==='mira-painted-body').depth;
  expect((await state(page)).mira).toMatchObject({...MIRA_SEAT,action:'sit'});
  expect(body).toBeGreaterThan(layers.find((layer:any)=>layer.name==='royal-bar-prop-flowers').depth);
  for(const prop of Object.keys(ROYAL_BAR_PROPS))expect(layers.find((layer:any)=>layer.name==='royal-bar-prop-'+prop).depth).toBeGreaterThan(hand);
  expect(layers.find((layer:any)=>layer.name==='cat-water-mug').depth).toBe(513);
  expect(errors).toEqual([]);
  await test.info().attach('pixel-occlusion.json',{body:JSON.stringify({viewport,probes:probes.length,negativeControlChangedPixels:legacy,checked,extraRightWipingFrames:24,layers,errors},null,2),contentType:'application/json'});
});

async function guest(browser:Browser,baseURL:string,viewport:{width:number;height:number},room?:string,video=false){
  const context=await browser.newContext({baseURL,viewport,...(video?{recordVideo:{dir:work+'videos',size:{width:1280,height:900}}}:{})});
  expect((await context.request.post('/api/auth/login',{data:{email:`mira-layer-${crypto.randomUUID()}@example.test`,password:crypto.randomUUID()}})).ok()).toBe(true);
  expect((await context.request.post('/api/auth/character',{data:{skin:0,name:'Гость бара'}})).ok()).toBe(true);
  const page=await context.newPage();await page.route('**/api/npc/mira',route=>route.fulfill({json:route.request().method()==='GET'?{turns:[{role:'assistant',content:'Ну? Чем удивишь?'}]}:{reply:'Я слушаю. Сначала расскажи про свой вечер, а затем я приготовлю тебе что-нибудь освежающее.',emotion:'smile'}}));
  await page.goto(room?'/?mode=club&room='+room:'/?mode=club');await ready(page);
  await expect.poll(()=>page.evaluate(()=>(window as any).royalDemo.getNetworkState()?.status)).toBe('connected');
  await page.evaluate(()=>(window as any).royalMiraAudit?.focus());
  return {context,page};
}

test('real shared routine seats Mira, rises for dialogue and serves with a late mobile viewer',async({browser,baseURL})=>{
  test.setTimeout(120000);
  const contexts:BrowserContext[]=[],errors:string[]=[];let video:ReturnType<Page['video']>,completed=false;
  try{
    const a=await guest(browser,baseURL!,{width:1280,height:900},undefined,true);contexts.push(a.context);video=a.page.video();a.page.on('pageerror',e=>errors.push(e.message));
    const room=await a.page.evaluate(()=>(window as any).royalDemo.getNetworkState().roomId);
    const started=Date.now();
    await expect.poll(async()=>(await state(a.page)).mira.action,{timeout:45000,intervals:[100]}).toBe('sit');
    const seatedAfterMs=Date.now()-started;
    await a.page.screenshot({path:work+'natural-shared-seat.png'});
    await a.page.evaluate(()=>{(window as any).observedMira=[];setInterval(()=>{(window as any).observedMira.push((window as any).royalDemo.getState().mira.action);},50);});
    await a.page.locator('#visit-bar').click();await expect(a.page.locator('#bar-dialog')).toBeVisible({timeout:20000});
    await expect.poll(async()=>(await state(a.page)).mira.action).toBe('listen');
    const seen=await a.page.evaluate(()=>(window as any).observedMira as string[]);
    for(const action of ['stand-up','walk','greet','listen'])expect(seen).toContain(action);
    const b=await guest(browser,baseURL!,{width:390,height:844},room);contexts.push(b.context);b.page.on('pageerror',e=>errors.push(e.message));
    await expect.poll(async()=>Math.abs((await state(a.page)).mira.x-(await state(b.page)).mira.x)).toBeLessThan(2);
    await expect.poll(async()=>(await state(b.page)).mira.action).toBe('listen');
    await b.page.locator('#visit-bar').click();await expect(b.page.locator('#bar-dialog')).toBeVisible({timeout:20000});
    await expect(b.page.getByRole('textbox',{name:'Твоя реплика Мире'})).toBeInViewport();
    await b.page.getByRole('button',{name:'Уйти',exact:true}).click();
    await a.page.getByRole('textbox',{name:'Твоя реплика Мире'}).fill('Как проходит смена?');await a.page.getByRole('button',{name:'Сказать',exact:true}).click();
    await expect.poll(async()=>(await state(a.page)).mira.action).toBe('chat');await expect.poll(async()=>(await state(b.page)).mira.action).toBe('chat');
    await b.page.evaluate(()=>{(window as any).observedMiraService=[];setInterval(()=>{const mira=(window as any).royalDemo.getState().mira;if(mira.atlas==='serve')(window as any).observedMiraService.push(mira.frame);},50);});
    await a.page.getByRole('button',{name:'Напитки',exact:true}).click();await a.page.locator('[data-drink="wine"]').click();
    await expect.poll(async()=>(await state(b.page)).mira.action).toBe('serve');
    // Record the short handover phase in the browser so increasing poll delays cannot miss it.
    await expect.poll(()=>b.page.evaluate(()=>(window as any).observedMiraService.includes(7)),{timeout:7000}).toBe(true);
    await a.page.emulateMedia({reducedMotion:'reduce'});await expect.poll(async()=>(await state(a.page)).reducedMotion).toBe(true);
    await a.page.getByRole('button',{name:'Уйти',exact:true}).click();
    await expect.poll(async()=>['greet','listen','chat'].includes((await state(a.page)).mira.action)).toBe(false);
    expect(errors).toEqual([]);
    await test.info().attach('shared-routine.json',{body:JSON.stringify({seatedAfterDesktopReadyMs:seatedAfterMs,desktop:{width:1280,height:900},mobile:{width:390,height:844},lateArrival:true,observedActions:[...new Set(seen)],serviceFinalFrame:7,reducedMotion:true,providerStubbed:true,productionDataUsed:false,errors},null,2),contentType:'application/json'});
    completed=true;
  }finally{
    for(const context of contexts)await context.close();if(video&&completed)await video.saveAs(work+'natural-cycle.webm');
  }
});

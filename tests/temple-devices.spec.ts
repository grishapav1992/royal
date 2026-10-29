import {test,expect,request as apiRequest,chromium,type Page,type Locator} from '@playwright/test';
import {Client} from '@colyseus/sdk';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import sharp from 'sharp';

const scope='artifacts/work/temple-device-acceptance';
const entry='/tests/fixtures/temple-preview.html?lang=en';
const game=(p:Page)=>p.frameLocator('.temple-frame');
const state=(p:Page)=>p.evaluate(()=>(window as any).templePreview?.state()??(window as any).royalDemo?.getMiniState());
async function activate(p:Page,locator:Locator){if(await p.evaluate(()=>navigator.maxTouchPoints>0))await locator.tap();else await locator.click();}
async function ready(p:Page,scenario='cascade-seed-15'){
  await p.context().setExtraHTTPHeaders({'x-temple-test-case':scenario});await p.emulateMedia({reducedMotion:'no-preference'});await p.goto(entry);
  await expect(game(p).locator('[data-ft=primary]')).toBeEnabled();await expect.poll(async()=>(await state(p)).character.loaded.length).toBe(6);
}
async function sound(p:Page){await p.evaluate(()=>{const a=(window as any)[Symbol.for('royal.game-host.v1')].gameAudio;a.setVolume(1);a.setMuted(true);});await activate(p,game(p).locator('[data-ft=mute]'));await expect.poll(async()=>(await state(p)).audio.ready).toBe(true);await expect.poll(async()=>(await state(p)).audio.music.playing).toBe(true);}
async function done(p:Page){await expect.poll(async()=>{const s=await state(p);return s?.completed&&!s.busy&&!s.presenting;},{timeout:90000}).toBe(true);}
async function report(name:string,value:unknown){await mkdir(scope,{recursive:true});await writeFile(`${scope}/${name}.json`,JSON.stringify(value,null,2)+'\n');}

async function probe(p:Page){
  await game(p).locator('.ft').evaluate(root=>{
    const w=root.ownerDocument.defaultView! as any;
    const result=w.templeDeviceProbe={frames:[] as number[],inputs:[] as number[],tasks:[] as number[],previous:0,active:true,handle:0,observer:null as PerformanceObserver|null};
    const tick=(at:number)=>{if(!result.active)return;const showing=(root as HTMLElement).dataset.feedback!=='idle';if(showing&&result.previous&&result.frames.length<10000)result.frames.push(at-result.previous);result.previous=showing?at:0;result.handle=w.requestAnimationFrame(tick);};
    result.handle=w.requestAnimationFrame(tick);
    root.addEventListener('pointerdown',()=>{const at=w.performance.now();w.requestAnimationFrame(()=>result.inputs.push(w.performance.now()-at));},{capture:true});
    if(w.PerformanceObserver.supportedEntryTypes.includes('longtask')){result.observer=new w.PerformanceObserver((list:PerformanceObserverEntryList)=>{if((root as HTMLElement).dataset.feedback!=='idle')for(const e of list.getEntries())result.tasks.push(e.duration);});result.observer.observe({type:'longtask'});}
  });
}
async function metrics(p:Page){return game(p).locator('.ft').evaluate(root=>{
  const w=root.ownerDocument.defaultView! as any,r=w.templeDeviceProbe;r.active=false;w.cancelAnimationFrame(r.handle);r.observer?.disconnect();
  const stats=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b);return {samples:values.length,p50Ms:sorted[Math.floor(sorted.length*.5)]??0,p95Ms:sorted[Math.floor(sorted.length*.95)]??0,maxMs:sorted.at(-1)??0,over50Ms:values.filter(v=>v>50).length};};
  const canvas=root.querySelector('canvas') as HTMLCanvasElement|null,gl=canvas?.getContext('webgl'),extension=gl?.getExtension('WEBGL_debug_renderer_info');
  return {frames:stats(r.frames),pointerDispatchToNextFrame:stats(r.inputs),longTasks:stats(r.tasks),renderer:gl&&extension?gl.getParameter(extension.UNMASKED_RENDERER_WEBGL):'unavailable',dpr:w.devicePixelRatio,touchPoints:w.navigator.maxTouchPoints,viewport:{width:w.innerWidth,height:w.innerHeight},userAgent:w.navigator.userAgent};
});}

async function geometry(p:Page){return game(p).locator('.ft').evaluate(root=>{
  const box=(q:string)=>root.querySelector(q)!.getBoundingClientRect().toJSON();
  const controls=Array.from(root.querySelectorAll<HTMLElement>('[data-ft]')).filter(el=>el.matches('button,select')).map(el=>({name:el.dataset.ft,width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height,disabled:(el as HTMLButtonElement).disabled}));
  return {width:root.clientWidth,scrollWidth:root.scrollWidth,board:box('.ft-cabinet'),character:box('.ft-character'),console:box('.ft-console'),cell:box('[data-cell]'),controls};
});}

async function meter(p:Page){await p.evaluate(async()=>{
  const w=window as any,host=w[Symbol.for('royal.game-host.v1')],c=host.gameAudio.context;
  const source=`class MixAudit extends AudioWorkletProcessor { constructor(){super();this.frames=0;this.samples=0;this.sum=0;this.peak=0;this.clipped=0;this.port.onmessage=e=>{if(e.data==='flush')this.port.postMessage({frames:this.frames,samples:this.samples,peak:this.peak,rms:Math.sqrt(this.sum/Math.max(1,this.samples)),clipped:this.clipped,sampleRate:sampleRate});};} process(inputs,outputs){const channels=inputs[0]||[];this.frames+=channels[0]?.length||0;for(const data of channels)for(const sample of data){this.samples++;this.sum+=sample*sample;this.peak=Math.max(this.peak,Math.abs(sample));if(Math.abs(sample)>=1)this.clipped++;}for(const channel of outputs[0])channel.fill(0);return true;}} registerProcessor('temple-mix-audit',MixAudit);`;
  const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));try{await c.audioWorklet.addModule(url);}finally{URL.revokeObjectURL(url);}
  const node=new AudioWorkletNode(c,'temple-mix-audit');host.gameAudio.output.connect(node);node.connect(c.destination);w.templeMixAudit={node,context:c,output:host.gameAudio.output};
});}
async function stopMeter(p:Page){return p.evaluate(async()=>{const w=window as any,m=w.templeMixAudit;const result=await new Promise(resolve=>{m.node.port.onmessage=(event:MessageEvent)=>resolve(event.data);m.node.port.postMessage('flush');});m.output.disconnect(m.node);m.node.disconnect();delete w.templeMixAudit;return result;});}

for(const profile of[
  {name:'desktop',width:1440,height:1000,dpr:1,touch:false,cpu:1},
  {name:'phone-390-cpu4',width:390,height:844,dpr:3,touch:true,cpu:4},
])test(`normal 31-fall bonus, graphics, input and full-volume mix: ${profile.name}`,async({browser})=>{
  const context=await browser.newContext({baseURL:test.info().project.use.baseURL,viewport:{width:profile.width,height:profile.height},deviceScaleFactor:profile.dpr,hasTouch:profile.touch,isMobile:profile.touch});
  try{
    const page=await context.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:profile.cpu});
    await ready(page,'cascade-seed-118');await sound(page);await probe(page);await meter(page);const initial=await geometry(page);
    expect(initial.scrollWidth).toBeLessThanOrEqual(initial.width+1);expect(Math.min(initial.cell.width,initial.cell.height)).toBeGreaterThanOrEqual(44);
    await activate(page,game(page).locator('[data-ft=primary]'));await done(page);const s=await state(page),timing=await metrics(page),mix:any=await stopMeter(page);
    expect(s.visual.fall).toBe(31);expect(s.feedback.effects.shownUnits).toBe('30250');expect(s.feedback.effects.maxNodes).toBeLessThanOrEqual(60);expect(s.character.textures).toBe(6);expect(s.feedback.framePending).toBe(false);expect(s.audio.activeSources).toBeLessThanOrEqual(10);
    expect(timing.frames.samples).toBeGreaterThan(300);expect(timing.frames.maxMs).toBeLessThan(2000);expect(mix.samples).toBeGreaterThan(100000);expect(mix.clipped).toBe(0);expect(mix.peak).toBeLessThan(.95);expect(mix.rms).toBeGreaterThan(0);expect(errors).toEqual([]);
    await report(profile.name,{profile,environment:'Desktop Chrome with explicit viewport/touch/CPU emulation, not physical phone',geometry:initial,timing,mix,feedback:s.feedback,audio:s.audio,character:s.character,errors});
  }finally{await context.close();}
});

test('touch controls remain reachable through rotation, live resize and reduced motion',async({browser})=>{
  const context=await browser.newContext({baseURL:test.info().project.use.baseURL,viewport:{width:360,height:740},deviceScaleFactor:2,hasTouch:true,isMobile:true});
  try{
    const page=await context.newPage();await ready(page);const sizes:any[]=[];await probe(page);
    for(const [width,height]of[[360,740],[740,360],[768,1024],[1024,768],[390,844]]){
      await page.setViewportSize({width,height});const g=await geometry(page);expect(g.scrollWidth).toBeLessThanOrEqual(g.width+1);expect(g.console.top).toBeGreaterThanOrEqual(g.board.bottom);sizes.push({width,height,...g});
      if(width<=520)for(const control of g.controls.filter(c=>['journal','rules','mute'].includes(c.name!))){expect(control.width).toBeGreaterThanOrEqual(44);expect(control.height).toBeGreaterThanOrEqual(44);}
      await game(page).locator('[data-ft=primary]').scrollIntoViewIfNeeded();await expect(game(page).locator('[data-ft=primary]')).toBeInViewport();
      await activate(page,game(page).locator('[data-ft=rules]'));await expect(game(page).locator('dialog')).toBeVisible();await activate(page,game(page).locator('[data-ft=close]'));
    }
    await activate(page,game(page).locator('[data-ft=primary]'));await expect.poll(async()=>(await state(page)).presenting).toBe(true);await page.setViewportSize({width:844,height:390});await done(page);expect((await state(page)).feedback.effects.shownUnits).toBe('250');
    await page.emulateMedia({reducedMotion:'reduce'});await activate(page,game(page).locator('[data-ft=primary]'));await done(page);expect((await state(page)).character.framePending).toBe(false);expect((await state(page)).feedback.effects.nodes).toBe(0);
    await report('touch-rotation',{sizes,timing:await metrics(page),reducedMotion:true});
  }finally{await context.close();}
});

test('WebGL loss and restoration retain the heroine and do not change the paid result',async({page})=>{
  await ready(page);await sound(page);const before=await state(page);expect(before.character.renderer).toBe('mesh');
  await game(page).locator('canvas.ft-portrait').evaluate(canvas=>{const gl=(canvas as HTMLCanvasElement).getContext('webgl')!;(window as any).templeLoss=gl.getExtension('WEBGL_lose_context');(window as any).templeLoss.loseContext();});
  await expect(game(page).locator('.ft-portrait-fallback')).toBeVisible();await activate(page,game(page).locator('[data-ft=primary]'));await done(page);expect((await state(page)).feedback.effects.shownUnits).toBe('250');
  await game(page).locator('.ft').evaluate(()=>{(window as any).templeLoss.restoreContext();});await expect.poll(async()=>(await state(page)).character.renderer).toBe('mesh');expect((await state(page)).character.textures).toBe(6);
  await report('webgl-recovery',{fallbackVisibleDuringLoss:true,texturesAfterRestore:6,paidResultUnits:'250'});
});

for(const latency of[.3,.7])test(`fallback output clock at ${latency}s and suspended audio never omit or replay cues`,async({page})=>{
  await page.addInitScript(delay=>{Object.defineProperty(AudioContext.prototype,'getOutputTimestamp',{configurable:true,value:undefined});Object.defineProperty(AudioContext.prototype,'outputLatency',{configurable:true,get:()=>delay});},latency);
  await ready(page);await sound(page);await activate(page,game(page).locator('[data-ft=primary]'));await done(page);const s=await state(page);expect(s.audio.anchors.every((a:any)=>a.method==='latency-estimate')).toBe(true);expect(s.audio.anchors.filter((a:any)=>a.state==='scheduled').length).toBe(4);
  const before=s.audio.played;await page.evaluate(async()=>{await(window as any)[Symbol.for('royal.game-host.v1')].gameAudio.context.suspend();});await expect.poll(async()=>(await state(page)).audio.activeSources).toBe(0);
  await page.evaluate(async()=>{const a=(window as any)[Symbol.for('royal.game-host.v1')].gameAudio;a.setMuted(true);await a.context.resume();});await page.waitForTimeout(200);expect((await state(page)).audio.played).toEqual(before);expect((await state(page)).audio.activeSources).toBe(0);
  await activate(page,game(page).locator('[data-ft=mute]'));await page.waitForTimeout(200);expect((await state(page)).audio.played).toEqual(before);
  await report('audio-output-lifecycle-'+latency,{simulatedOutputLatencyMs:latency*1000,physicalBluetooth:false,anchors:s.audio.anchors,accents:s.feedback.accents,noOldCueReplay:true});
});

test('Windows Edge decodes the same recordings and uses one host output',async()=>{
  const browser=await chromium.launch({channel:'msedge'}),context=await browser.newContext({baseURL:test.info().project.use.baseURL});
  try{const page=await context.newPage();await ready(page);await sound(page);await probe(page);await meter(page);await activate(page,game(page).locator('[data-ft=primary]'));await done(page);const mix:any=await stopMeter(page),s=await state(page);expect(mix.clipped).toBe(0);expect(mix.rms).toBeGreaterThan(0);expect(s.feedback.effects.shownUnits).toBe('250');expect(s.audio.anchors.filter((a:any)=>a.state==='scheduled').length).toBe(4);await report('edge',{browser:browser.version(),timing:await metrics(page),mix,audio:s.audio});}finally{await context.close();await browser.close();}
});

test('a blocked music resource leaves confirmed play and recorded effects usable',async({page})=>{
  let blocked=0;const fail=async(route:any)=>{blocked++;await route.abort('failed');};await page.route('**/audio/music.mp3',fail);await ready(page);await page.evaluate(()=>(window as any)[Symbol.for('royal.game-host.v1')].gameAudio.setMuted(true));await activate(page,game(page).locator('[data-ft=mute]'));await expect.poll(async()=>(await state(page)).audio.ready).toBe(true);
  await activate(page,game(page).locator('[data-ft=primary]'));await done(page);const s=await state(page);await report('missing-music',{blocked,paidResultUnits:s.feedback.effects.shownUnits,audio:s.audio});expect(blocked).toBeGreaterThan(0);expect(s.feedback.effects.shownUnits).toBe('250');expect(s.audio.played.cascadeLandB).toBe(1);expect(s.audio.music.playing).toBe(false);
  await page.unroute('**/audio/music.mp3',fail);await activate(page,game(page).locator('[data-ft=mute]'));await activate(page,game(page).locator('[data-ft=mute]'));await expect.poll(async()=>(await state(page)).audio.music.positionSeconds,{timeout:15000}).toBeGreaterThan(.1);expect((await state(page)).audio.music.error).toBe('');
  await report('missing-music',{blocked,paidResultUnits:'250',recordedEffectsUsable:true,recoveredOnGesture:true,failed:s.audio.music,recovered:(await state(page)).audio.music});
});

for(const mobile of[false,true])test(`real Royal with connected chat and a normal touch/click round: ${mobile?'phone':'desktop'}`,async({browser})=>{
  const context=await browser.newContext({baseURL:test.info().project.use.baseURL,viewport:mobile?{width:390,height:844}:{width:1440,height:1000},hasTouch:mobile,isMobile:mobile,deviceScaleFactor:mobile?3:1});
  const api=await apiRequest.newContext({baseURL:test.info().project.use.baseURL});let peer:any;
  try{
    const auth=await api.post('/api/auth/login',{data:{email:'temple-device-peer-'+crypto.randomUUID()+'@example.test',password:'Temple-local-review-42!'}});expect(auth.ok()).toBe(true);await api.post('/api/auth/character',{data:{skin:0}});
    peer=await new Client('http://127.0.0.1:'+(process.env.TEMPLE_API_PORT??'2632'),{headers:{Cookie:auth.headers()['set-cookie'].split(';')[0]},fetchFn:async(url,options)=>{const r=await api.fetch(String(url),{method:options?.method,headers:Object.fromEntries(new Headers(options?.headers)),data:options?.body as string});return new globalThis.Response(await r.body(),{status:r.status(),headers:r.headers()});}}).create('lobby');for(const type of['chat','activities','piano-note','notice','pvp'])peer.onMessage(type,()=>{});
    const page=await context.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await ready(page);expect((await page.request.post('/api/auth/character',{data:{skin:0}})).ok()).toBe(true);await page.goto('/?lang=en&room='+peer.roomId);await expect(page.locator('#join-dialog')).toBeHidden({timeout:30000});await page.waitForFunction(()=>(window as any).royalDemo?.getState().online===true);
    await activate(page,page.locator('#games-tab'));await activate(page,page.locator('[data-cabinet=studio-dracona]'));await activate(page,page.locator('[data-platform-game=studio-flooded-temple]'));await expect(game(page).locator('[data-ft=primary]')).toBeEnabled();await expect.poll(async()=>(await state(page)).character.loaded.length).toBe(6);
    await sound(page);await probe(page);await expect(page.locator('#mini-dialog #chat-input')).toBeVisible();await expect(page.locator('#mini-dialog #chat-input')).toBeEnabled();
    const sizes:any[]=[];for(const size of mobile?[{width:390,height:844},{width:844,height:390},{width:390,height:844}]:[{width:1440,height:1000},{width:1000,height:1100}]){
      await page.setViewportSize(size);const g=await geometry(page);expect(g.scrollWidth).toBeLessThanOrEqual(g.width+1);if(g.width>520)expect(g.character.right).toBeLessThanOrEqual(g.board.left-8);else expect(g.character.bottom).toBeLessThanOrEqual(g.board.top);sizes.push({...size,...g});
    }
    await game(page).locator('[data-ft=primary]').scrollIntoViewIfNeeded();await activate(page,game(page).locator('[data-ft=primary]'));await done(page);expect((await state(page)).feedback.effects.shownUnits).toBe('250');
    await mkdir('docs/assets/flooded-temple',{recursive:true});await sharp(await page.screenshot()).webp({quality:82}).toFile(`docs/assets/flooded-temple/device-acceptance-${mobile?'phone':'desktop'}.webp`);
    const timing=await metrics(page);await activate(page,page.locator('#studio-game-list'));await activate(page,page.locator('[data-platform-game=studio-flooded-temple]'));await expect(game(page).locator('.ft-status')).toContainText('Round net -7.50');expect(errors).toEqual([]);
    await report('host-'+(mobile?'phone':'desktop'),{mobile,emulated:mobile,sizes,timing,chatConnected:true,chatMessagesSent:0,closeReopen:true,errors});
  }finally{if(peer)await peer.leave();await context.close();await api.dispose();}
});

test('manual listening page repeats prepared examples and exports a draft without claiming physical listening',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/tests/fixtures/temple-device-review.html?lang=ru');await expect(game(page).locator('[data-ft=primary]')).toBeEnabled();
  await activate(page,game(page).locator('[data-ft=primary]'));await done(page);expect((await state(page)).feedback.effects.shownUnits).toBe('250');
  await page.locator('#review-case').selectOption('bonus');const posts:any[]=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/expansion'))posts.push({op:r.postDataJSON(),scenario:r.headers()['x-temple-test-case']});});
  await page.route('**/api/*-wallet/expansion',async route=>{if(route.request().method()==='POST'&&route.request().postDataJSON().action==='start'){const response=await route.fetch();await page.locator('#review-case').selectOption('cap');await route.fulfill({response});}else await route.fallback();});
  await activate(page,game(page).locator('[data-ft=primary]'));await done(page);expect((await state(page)).visual.fall).toBe(31);expect((await state(page)).feedback.effects.shownUnits).toBe('30250');expect(posts.length).toBe(2);expect(posts[0].scenario).toBe(posts[1].scenario);
  await page.locator('summary').click();const download=page.waitForEvent('download');await page.locator('button[type=submit]').click();const file=await download;await file.saveAs(scope+'/manual-listening-draft.json');const draft=JSON.parse(await readFile(scope+'/manual-listening-draft.json','utf8'));expect(draft.physicalListeningConfirmed).toBe(false);expect(draft.scenario).toBe('bonus');expect(draft.nextScenario).toBe('cap');expect(draft.module).toMatch(/^0\.9\.2-/);expect(draft.testOnly).toBe(true);
  await report('manual-review',{preparedExamples:true,choiceChangeCannotAlterAcceptedContinuation:true,unconfirmedDraft:true});
});

import {test,expect,type Page} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const scope=process.env.TEMPLE_MOTION_SCOPE??'artifacts/work/temple-character-life';
const game=(p:Page)=>p.frameLocator('.temple-frame');
const state=(p:Page)=>p.evaluate(()=>(window as any).templePreview.state());
async function ready(p:Page,scenario='cascade-seed-15'){
  await p.context().setExtraHTTPHeaders({'x-temple-test-case':scenario});await p.emulateMedia({reducedMotion:'no-preference'});
  await p.goto('/tests/fixtures/temple-preview.html?lang=ru');await expect(game(p).locator('[data-ft=primary]')).toBeEnabled();
  await expect.poll(async()=>(await state(p)).character.loaded.length).toBe(6);
  await expect.poll(async()=>(await state(p)).character.renderer).toBe('mesh');
}
async function done(p:Page){await expect.poll(async()=>{const s=await state(p);return !!s&&s.completed&&!s.presenting&&!s.busy;},{timeout:60000}).toBe(true);}
async function probe(p:Page){await game(p).locator('canvas.ft-portrait').evaluate(canvas=>{
  const c=canvas as HTMLCanvasElement,w=c.ownerDocument.defaultView! as any,gl=c.getContext('webgl')!,original=gl.drawArrays.bind(gl);
  const pixels=new Uint8Array(c.width*c.height*4),result=w.templeCharacterProbe={frames:[] as any[],captures:{} as Record<string,string>,draws:0,blinkPeak:0,active:true};
  const hash=(start:number,end:number,stride:number)=>{let n=2166136261;for(let i=start;i<end;i+=stride)n=Math.imul(n^pixels[i],16777619);return n>>>0;};
  const read=()=>{gl.readPixels(0,0,c.width,c.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);};
  gl.drawArrays=(...args:Parameters<WebGLRenderingContext['drawArrays']>)=>{
    original(...args);if(!result.active)return;
    const parent=(w.parent as any).templePreview;if(!parent)return;
    const character=parent.state().character,rig=character.rig;result.blinkPeak=Math.max(result.blinkPeak,rig.channels.blink);
    const capture=rig.channels.blink>.85&&!result.captures.blink?'blink':rig.clip==='relic'&&rig.channels.leftArm>.25&&!result.captures.bonus?'bonus':rig.clip==='triumph'&&rig.channels.lift>.4&&!result.captures.big?'big':undefined;
    if(++result.draws%12!==0&&!capture)return;read();
    let alpha=0,minX=c.width,maxX=0,maxY=0,footPixels=0;
    for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++)if(pixels[(y*c.width+x)*4+3]>32){alpha++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);if(y<80)footPixels++;}
    result.frames.push({clip:rig.clip,channels:rig.channels,upper:hash(c.width*80*4,pixels.length,16),feet:hash(0,c.width*80*4,4),alpha,minX,maxX,maxY,footPixels});
    if(capture)result.captures[capture]=c.toDataURL('image/png');
    if(result.frames.length>500)result.active=false;
  };
  result.stop=()=>{result.active=false;gl.drawArrays=original;};
});}
async function finish(p:Page,name:string){
  const result=await game(p).locator('canvas.ft-portrait').evaluate(canvas=>{const r=(canvas.ownerDocument.defaultView! as any).templeCharacterProbe;r.stop();return{frames:r.frames,captures:r.captures,blinkPeak:r.blinkPeak};});
  await mkdir(scope+'/captures',{recursive:true});
  for(const [label,data]of Object.entries(result.captures))await writeFile(scope+'/captures/'+name+'-'+label+'.png',Buffer.from(String(data).split(',')[1],'base64'));
  const clips=[...new Set(result.frames.map((f:any)=>f.clip))],footHashes=[...new Set(result.frames.map((f:any)=>f.feet))];
  const report={samples:result.frames.length,clips,footHashes,upperHashes:new Set(result.frames.map((f:any)=>f.upper)).size,blinkPeak:result.blinkPeak,
    maxLift:Math.max(...result.frames.map((f:any)=>f.channels.lift)),maxSmile:Math.max(...result.frames.map((f:any)=>f.channels.smile)),captures:Object.keys(result.captures),
    bounds:{minX:Math.min(...result.frames.map((f:any)=>f.minX)),maxX:Math.max(...result.frames.map((f:any)=>f.maxX)),maxY:Math.max(...result.frames.map((f:any)=>f.maxY))}};
  await writeFile(scope+'/'+name+'.json',JSON.stringify(report,null,2)+'\n');
  expect(report.samples).toBeGreaterThan(5);expect(report.upperHashes).toBeGreaterThan(4);expect(footHashes).toHaveLength(1);
  expect(result.frames.every((f:any)=>f.alpha>40000&&f.footPixels>500)).toBe(true);expect(report.bounds.minX).toBeGreaterThan(2);expect(report.bounds.maxX).toBeLessThan(510);expect(report.bounds.maxY).toBeLessThan(766);
  return report;
}

test('actual pixels breathe, blink and follow a cascade while the boots stay fixed and a partial return stays restrained',async({page})=>{
  await ready(page);await probe(page);await expect.poll(()=>game(page).locator('canvas.ft-portrait').evaluate(c=>(c.ownerDocument.defaultView! as any).templeCharacterProbe.blinkPeak),{timeout:7000}).toBeGreaterThan(.6);
  await game(page).locator('[data-ft=primary]').click();await done(page);const r=await finish(page,'partial');
  expect(r.clips).toContain('watch-fall');expect(r.clips).toContain('reflect');expect(r.maxSmile).toBe(0);
  await expect(game(page).locator('[data-ft-value=payout]')).toHaveText('2,50');
});

test('bonus discovery and a large completed result have distinct rendered gestures; reopening and account changes stay quiet',async({page})=>{
  await ready(page,'cascade-seed-118');await probe(page);const starts:any[]=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/expansion')&&r.postDataJSON().action==='start')starts.push(r.postDataJSON());});
  await game(page).locator('[data-ft=primary]').click();await done(page);const r=await finish(page,'bonus');
  expect(r.clips).toContain('relic');expect(r.clips).toContain('triumph');expect(r.captures).toContain('bonus');expect(r.captures).toContain('big');expect(r.maxLift).toBeGreaterThan(.4);expect(r.maxSmile).toBeGreaterThan(.8);expect(starts).toHaveLength(1);
  await expect(game(page).locator('[data-ft-value=payout]')).toHaveText('302,50');await page.locator('#reopen').click();await done(page);
  expect((await state(page)).character.rig.channels.smile).toBe(0);expect((await state(page)).character.clip).not.toBe('triumph');expect((await state(page)).audio.played).toEqual({});expect(starts).toHaveLength(1);
  await page.evaluate(()=>(window as any).templePreview.wallet.setAccount(null));const cleared=(await state(page)).character;expect(Object.values(cleared.rig.channels).every(v=>v===0)).toBe(true);expect(cleared.framePending).toBe(false);
});

test('quick large-win gestures remain smooth, pause freezes, reduced motion and WebGL recovery do not replay a reward',async({page})=>{
  await ready(page,'cascade-cap');await game(page).locator('[data-ft=fast]').click();await probe(page);await game(page).locator('[data-ft=primary]').click();await done(page);
  const r=await finish(page,'quick-big');expect(r.captures).toContain('big');expect(r.maxLift).toBeGreaterThan(.4);
  const sounds=(await state(page)).audio.played;await page.evaluate(()=>(window as any).templePreview.pause());const paused=(await state(page)).character.clockMs;
  await page.waitForTimeout(180);expect((await state(page)).character.clockMs).toBe(paused);
  await page.evaluate(()=>(window as any).templePreview.resume());await expect.poll(async()=>(await state(page)).character.rig.channels.smile).toBeLessThan(.02);expect((await state(page)).audio.played).toEqual(sounds);
  await page.emulateMedia({reducedMotion:'reduce'});await expect.poll(async()=>(await state(page)).character.framePending).toBe(false);expect((await state(page)).character.rig.channels.blink).toBe(0);
  await game(page).locator('canvas.ft-portrait').evaluate(c=>{const w=c.ownerDocument.defaultView! as any;w.characterLoss=(c as HTMLCanvasElement).getContext('webgl')!.getExtension('WEBGL_lose_context');w.characterLoss.loseContext();});
  await expect.poll(async()=>(await state(page)).character.renderer).toBe('image');await expect(game(page).locator('.ft-portrait-fallback')).toBeVisible();
  await game(page).locator('canvas.ft-portrait').evaluate(c=>(c.ownerDocument.defaultView! as any).characterLoss.restoreContext());await expect.poll(async()=>(await state(page)).character.renderer).toBe('mesh');
  expect((await state(page)).audio.played).toEqual(sounds);await page.evaluate(()=>(window as any).templePreview.close());
  const closed=await page.evaluate(()=>(window as any).templePreview.closedState());expect(closed.character.disposed).toBe(true);expect(closed.character.framePending).toBe(false);expect(closed.character.textures).toBe(0);
});

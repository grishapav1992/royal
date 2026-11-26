import {test,expect} from '@playwright/test';
import {createServer,type ViteDevServer} from 'vite';
import {mkdir,writeFile} from 'node:fs/promises';
import {RATE,contactAt,revealAt} from '../games/jackie-chan/JackieFight';
let vite:ViteDevServer,url:string;const out='artifacts/work/jackie-chan';
const COSTUMES=['master','sailor','police','hawk','rush','whoami','tuxedo','mentor'],PLACES=['restaurant','harbor','market'],SIZES=[[1,'safe'],[2,'sharp'],[3,'extreme']]as const;
const contact=(i:number)=>contactAt(i)/RATE,reveal=(n:number)=>revealAt(n)/RATE;
test.beforeAll(async()=>{vite=await createServer({configFile:false,root:process.cwd(),cacheDir:'node_modules/.vite-jackie-motion',optimizeDeps:{entries:['tests/fixtures/jackie-motion.html']},server:{host:'127.0.0.1',port:0}});await vite.listen();url=`http://127.0.0.1:${(vite.httpServer!.address()as{port:number}).port}`;await mkdir(out,{recursive:true});});
test.afterAll(async()=>await vite?.close());
test.beforeEach(async({page})=>{await page.goto(url+'/tests/fixtures/jackie-motion.html');await page.waitForFunction(()=>(window as any).jackieMotion?.ready(),undefined,{timeout:60000});});

test('the next fight starts at the last displayed position, the beaten group leaves and consecutive frames are painted',async({page})=>{
  const result=await page.evaluate(()=>{
    const h=(window as any).jackieMotion,scene=h.scene,canvas=document.querySelector('canvas')!,context=canvas.getContext('2d')!;
    h.restore({risk:'extreme'});const before=JSON.parse(canvas.dataset.heroFrame!),view=Reflect.get(scene,'view');
    const next={...view,combat:{...view.combat,revision:2,shots:[...view.combat.shots,{...view.combat.shots[0],index:1}]}};
    scene.show(next,true,false,'motion-preview');
    const playback=Reflect.get(scene,'playback'),anchor=Reflect.get(playback,'anchor');
    scene.paint(anchor);const first=JSON.parse(canvas.dataset.heroFrame!),leaving=Reflect.get(scene,'leaving').length;
    const clear=context.clearRect.bind(context);let paints=0;context.clearRect=((...args:any[])=>{paints++;(clear as any)(...args);})as typeof context.clearRect;
    try{for(const offset of [1000,1016,1032])scene.paint(anchor+offset);}finally{context.clearRect=clear;}
    scene.settle();return{before:(before.left+before.right)/2,first:(first.left+first.right)/2,leaving,paints};
  });
  expect(Math.abs(result.first-result.before)).toBeLessThan(2);expect(result.leaving).toBe(3);expect(result.paints).toBe(3);
});
test('costume atlases retain the same drawing scale through every move',async({page})=>{
  const rows=await page.evaluate(costumes=>{
    const h=(window as any).jackieMotion;return costumes.map((costume:string)=>{const sheet=h.fight({costume}).hero.sheet;
      const url=(suffix:string)=>h.scene.images.get(`/assets/jackie-chan/${costume}${suffix}.webp`),unit=(i:HTMLImageElement)=>Math.sqrt(i.naturalWidth*i.naturalHeight/8);
      return{costume,body:[['b',''],['f','-furniture'],['c','-combat']].map(([letter,suffix])=>sheet[letter+'0'].k*unit(url(suffix))),poses:Object.keys(sheet).length,tips:Object.values(sheet).every((f:any)=>Number.isFinite(f.tip.dx+f.tip.dy)&&f.tip.dx>0)};});
  },COSTUMES);
  for(const row of rows){expect(row.poses).toBe(24);expect(row.tips).toBe(true);expect(Math.max(...row.body)/Math.min(...row.body),row.costume).toBeCloseTo(1,6);}
});
test('every exchange and closing move plays in every costume without leaving the hero out of the frame',async({page})=>{
  test.setTimeout(240000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));let frames=0;
  for(const width of [1000,360]){
    await page.setViewportSize({width,height:800});
    const rows=await page.evaluate(costumes=>{
      const h=(window as any).jackieMotion,canvas=document.querySelector('canvas')!,rows:any[]=[];h.render({});
      const list=h.moves(),moves=[...list.exchanges.map((m:any)=>({...m,kind:'exchange'})),...list.finishers.map((m:any)=>({...m,kind:'finish'}))];
      moves.forEach((m:any,index:number)=>{
        const costume=costumes[index%costumes.length];
        for(let step=0;step<14;step++){
          const frame=h.render({costume,location:m.place??'restaurant',risk:m.duo||m.only==='bruiser'?'sharp':m.only==='master'?'extreme':'safe',plan:m.id,time:(m.kind==='exchange'?.4+step*.11:1.9+step*.14)});
          const hero=JSON.parse(frame.heroFrame);rows.push({id:m.id,x:(hero.left+hero.right)/2,y:(hero.top+hero.bottom)/2,width:canvas.clientWidth,height:canvas.clientHeight});
        }
      });return rows;
    },COSTUMES);
    for(const row of rows){expect(row.x,row.id).toBeGreaterThan(-row.width*.06);expect(row.x,row.id).toBeLessThan(row.width*1.06);expect(row.y,row.id).toBeGreaterThan(0);expect(row.y,row.id).toBeLessThan(row.height);}
    frames+=rows.length;
  }
  expect(errors).toEqual([]);await writeFile(out+'/moves.json',JSON.stringify({frames,viewports:[1000,360],pageErrors:errors},null,2));
});
test('fights change through five wins and survive restoring the same accepted shot and a new window size',async({page})=>{
  const rows=[];
  for(const width of [1000,360]){
    await page.setViewportSize({width,height:800});
    rows.push(await page.evaluate(()=>{const h=(window as any).jackieMotion,rows=[];
      for(const risk of ['safe','sharp','extreme'])for(let fight=0;fight<5;fight++){const config={seriesId:'restore-series',fight,risk,location:'harbor',time:1.3};rows.push({risk,fight,win:h.render(config).sequence,loss:h.render({...config,status:'lost'}).sequence,restored:h.restore(config).sequence});}
      return rows;}));
  }
  expect(rows[1]).toEqual(rows[0]);
  for(const risk of ['safe','sharp','extreme']){const fights=rows[0].filter((r:any)=>r.risk===risk);expect(new Set(fights.map((r:any)=>r.win)).size).toBe(5);for(const r of fights){expect(r.restored).toBe(r.win);expect(r.loss).toBe(r.win);}}
});
test('the outcome is not drawn before the decisive contact',async({page})=>{
  const rows=await page.evaluate(({contacts,sizes,places})=>{
    const h=(window as any).jackieMotion,canvas=document.querySelector('canvas')!,rows:any[]=[];
    const paint=(config:any)=>{h.render(config);return canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data;};
    for(const location of places)for(const [count,risk]of sizes)for(const fight of [0,2])for(const before of [1.4,.6,.2]){
      const config={location,risk,fight,seriesId:'hidden',time:contacts[count-1]-before};
      // The GPU may resample an image differently between two reads; a drawn difference repeats.
      let share=1;for(let attempt=0;attempt<4&&share;attempt++){const a=paint(config),b=paint({...config,status:'lost'});let different=0;for(let i=0;i<a.length;i+=4)if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>12)different++;share=different/(a.length/4);}
      rows.push({location,risk,fight,before,share});
    }return rows;
  },{contacts:[0,1,2].map(contact),sizes:SIZES,places:PLACES});
  for(const row of rows)expect(row.share,JSON.stringify(row)).toBe(0);
});
test('after every result the hero and the group rest inside the frame',async({page})=>{
  let frames=0;
  for(const [width,height]of [[1000,800],[360,800]]){
    await page.setViewportSize({width,height});
    const rows=await page.evaluate(({sizes,places})=>{const h=(window as any).jackieMotion,canvas=document.querySelector('canvas')!,rows:any[]=[];
      for(const location of places)for(const [,risk]of sizes)for(let fight=0;fight<5;fight++)for(const status of fight===4?['complete','lost']:['playing','lost','banked']){const f=h.restore({location,risk,fight,status,seriesId:'rest'});rows.push({location,risk,fight,status,w:canvas.clientWidth,h:canvas.clientHeight,hero:JSON.parse(f.heroFrame),foes:JSON.parse(f.foeFrames)});}
      return rows;},{sizes:SIZES,places:PLACES});
    for(const row of rows){
      const label=JSON.stringify([row.location,row.risk,row.fight,row.status]);
      expect(row.hero.left,label).toBeGreaterThanOrEqual(-2);expect(row.hero.right,label).toBeLessThanOrEqual(row.w+2);expect(row.hero.top,label).toBeGreaterThanOrEqual(0);expect(row.hero.bottom,label).toBeLessThanOrEqual(row.h);
      for(const foe of row.foes){const x=(foe.left+foe.right)/2;expect(x,label).toBeGreaterThan(0);expect(x,label).toBeLessThan(row.w);}
    }frames+=rows.length;
  }
  await writeFile(out+'/rest.json',JSON.stringify({frames},null,2));
});
test('five distinct opponents rotate through the series',async({page})=>{
  const rows=await page.evaluate(({sizes,places})=>{const h=(window as any).jackieMotion,rows:any[]=[];for(const location of places)for(let fight=0;fight<5;fight++)for(const [count,risk]of sizes)for(const status of ['playing','lost'])rows.push({count,foes:h.render({location,fight,risk,status,time:1}).foes,reopened:h.restore({location,fight,risk,status}).foes});return rows;},{sizes:SIZES,places:PLACES});
  const seen=new Set<string>();
  for(const row of rows){const ids=row.foes.split(',');expect(ids).toHaveLength(row.count);expect(new Set(ids).size).toBe(row.count);ids.forEach((id:string)=>seen.add(id));expect(row.reopened).toBe(row.foes);const allowed=row.count===1?['street','agile']:row.count===2?['agile','bruiser','enforcer']:['bruiser','enforcer','master'];expect(ids.every((id:string)=>allowed.includes(id))).toBe(true);}
  expect([...seen].sort()).toEqual(['agile','bruiser','enforcer','master','street']);
});
test('victory has fist and bow poses, cashout bows, restored results and losses never celebrate',async({page})=>{
  for(const [count,risk]of SIZES){
    for(const [offset,phase,pose]of [[.6,'victory-fist','f6'],[1.35,'victory-bow','f7']]as const){const frame=await page.evaluate(c=>(window as any).jackieMotion.render(c),{risk,status:'complete',time:reveal(count)+offset});expect(frame.phase).toBe(phase);expect(frame.heroPose).toBe(pose);expect(frame.celebrating).toBe('true');}
    const restored=await page.evaluate(c=>(window as any).jackieMotion.restore(c),{risk,status:'complete'});expect(restored.phase).toBe('victory-hold');expect(restored.celebrating).toBe('false');
    const lost=await page.evaluate(c=>(window as any).jackieMotion.render(c),{risk,status:'lost',time:reveal(count)+.5});expect(lost.phase).toBe('lost');expect(lost.celebrating).toBe('false');
    const paid=await page.evaluate(c=>(window as any).jackieMotion.restore(c),{risk,status:'banked'});expect(paid.phase).toBe('paid');expect(paid.heroPose).toBe('f7');
  }
});
test('sound returns on the current timeline after mute, zero volume and context suspension',async({page})=>{
  await page.locator('#sound').click();
  await page.waitForFunction(async()=>{const p='/src/game/GameAudio.ts';return(await import(/* @vite-ignore */p)).gameAudio.context?.state==='running';});
  const rows=await page.evaluate(async()=>{
    const h=(window as any).jackieMotion,p='/src/game/GameAudio.ts',{gameAudio}=await import(/* @vite-ignore */p),rows=[];
    const original=h.audio.begin.bind(h.audio),calls:any[]=[];h.audio.begin=(...args:any[])=>{calls.push(args);return original(...args);};
    for(const speed of [1,2])for(const mode of ['local','global','volume','context']){
      h.render({risk:'extreme'});h.scene.setSpeed(speed);h.scene.show(Reflect.get(h.scene,'view'),true,false,'audio-recovery');
      await new Promise(resolve=>setTimeout(resolve,1900/speed));const before=h.scene.state();
      if(mode==='local')h.audio.toggle();else if(mode==='global')gameAudio.setMuted(true);else if(mode==='volume')gameAudio.setVolume(0);else await gameAudio.context!.suspend();
      await new Promise(resolve=>setTimeout(resolve,60));const stopped=h.audio.state().active,previous=calls.length;
      if(mode==='local')h.audio.toggle();else if(mode==='global')gameAudio.setMuted(false);else if(mode==='volume')gameAudio.setVolume(.35);else await gameAudio.context!.resume();
      await new Promise(resolve=>setTimeout(resolve,80));const after=h.scene.state();
      rows.push({speed,mode,before,after,stopped,active:h.audio.state().active,resumes:calls.slice(previous).map(a=>({speed:a[3],from:a[4]}))});
      h.scene.settle();
    }
    h.scene.show(Reflect.get(h.scene,'view'),true);await gameAudio.context!.suspend();const previous=calls.length;h.scene.destroy();h.audio.destroy();await gameAudio.context!.resume();await new Promise(resolve=>setTimeout(resolve,50));
    return{rows,closed:{active:h.audio.state().active,resumes:calls.length-previous}};
  });
  for(const row of rows.rows){expect(row.stopped).toBe(0);expect(row.active).toBeGreaterThan(0);expect(row.resumes).toHaveLength(1);expect(row.resumes[0].from).toBeGreaterThanOrEqual(row.before.elapsed);expect(row.resumes[0].speed).toBe(row.speed);expect(row.after.elapsed).toBeGreaterThanOrEqual(row.before.elapsed);expect(row.after.busy).toBe(true);}
  expect(rows.closed).toEqual({active:0,resumes:0});await writeFile(out+'/audio-recovery.json',JSON.stringify(rows,null,2));
});
test('dense exchanges keep headroom, decisive contacts are audible and owned sound is cancelled',async({page})=>{
  test.setTimeout(240000);
  const stats=await page.evaluate(async({contacts})=>{
    const h=(window as any).jackieMotion,path='/src/game/GameAudio.ts',{gameAudio}=await import(/* @vite-ignore */path),previousContext=gameAudio.context,previousOutput=gameAudio.output;
    async function render(config:any,cancel:boolean,speed:1|2,from=0){
      const fight=h.fight(config),won=config.status!=='lost',length=15/speed;
      const context=new OfflineAudioContext(1,length*44100,44100),output=context.createGain();output.connect(context.destination);gameAudio.context=context as unknown as AudioContext;gameAudio.output=output;
      const Audio=h.audio.constructor,audio=new Audio();audio.allowed=()=>true;audio.begin(fight,won,config.status==='complete',speed,from);const scheduled=audio.state().active;if(cancel)audio.cancel();
      const data=(await context.startRendering()).getChannelData(0);let peak=0,tail=0;for(let i=0;i<data.length;i++){peak=Math.max(peak,Math.abs(data[i]));if(i>data.length-44100*.5)tail=Math.max(tail,Math.abs(data[i]));}
      const near=(at:number)=>{let v=0;for(let i=Math.floor((.06+(at-from)/speed-.004)*44100);i<(.06+(at-from)/speed+.05)*44100;i++)v=Math.max(v,Math.abs(data[i]));return v;};
      audio.destroy();return{scheduled,peak,tail,contacts:contacts.filter(at=>at>from).map(near),active:audio.state().active};
    }
    try{const mixes=[];for(const location of ['restaurant','harbor','market'])for(const seriesId of ['a','b','c','d','e','f'])for(const speed of [1,2]as const)for(const status of ['playing','lost','complete'])mixes.push({location,seriesId,speed,status,...await render({risk:'extreme',location,seriesId,status,fight:status==='complete'?4:1},false,speed)});
      const config={risk:'extreme',seriesId:'a',location:'harbor'};return{mixes,cancelled:await render(config,true,1),resumed:await render(config,false,2,contacts[1]+.1)};}
    finally{gameAudio.context=previousContext;gameAudio.output=previousOutput;}
  },{contacts:[0,1,2].map(contact)});
  await writeFile(out+'/fight-audio.json',JSON.stringify({...stats,interpretation:'Timing, signal, headroom and cleanup checks only; not a subjective listening assessment.'},null,2));
  for(const mix of stats.mixes){expect(mix.scheduled).toBeGreaterThan(30);expect(mix.peak,JSON.stringify(mix)).toBeLessThan(.95);expect(mix.tail).toBe(0);expect(mix.active).toBe(0);for(const value of mix.contacts)expect(value,JSON.stringify(mix)).toBeGreaterThan(.2);}
  expect(stats.cancelled.peak).toBe(0);expect(stats.cancelled.active).toBe(0);expect(stats.resumed.contacts).toHaveLength(1);expect(stats.resumed.scheduled).toBeLessThan(stats.mixes[0].scheduled);
});
test('enabling reduced motion during a running fight settles once without replay on speed changes',async({page})=>{
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(()=>{const h=(window as any).jackieMotion;h.render({risk:'extreme',status:'complete'});Reflect.get(h.scene,'playback').start(performance.now());});
  expect(await page.evaluate(()=>(window as any).jackieMotion.scene.state().busy)).toBe(true);
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect.poll(()=>page.evaluate(()=>(window as any).jackieMotion.scene.state().reduced)).toBe(true);
  await expect.poll(()=>page.evaluate(()=>(window as any).jackieMotion.scene.state().phase)).toBe('victory-hold');
  const state=await page.evaluate(()=>{const h=(window as any).jackieMotion;h.scene.setSpeed(2);return{...h.scene.state(),audio:h.audio.state()};});
  expect(state.busy).toBe(false);expect(state.celebrating).toBe(false);expect(state.audio.active).toBe(0);expect(state.speed).toBe(2);
});
test('a resting scene under reduced motion is not repainted and keeps the frame rate of a running fight',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await page.setViewportSize({width:1000,height:800});
  const paints=await page.evaluate(()=>{const h=(window as any).jackieMotion,scene=h.scene;h.restore({risk:'sharp'});const c=document.querySelector('canvas')!.getContext('2d')!,clear=c.clearRect.bind(c);let n=0;c.clearRect=((...a:any[])=>{n++;(clear as any)(...a);})as typeof c.clearRect;for(let i=0;i<20;i++)scene.paint(performance.now()+i*50);c.clearRect=clear;return n;});
  expect(paints).toBe(0);
  await page.emulateMedia({reducedMotion:'no-preference'});
  const frames=await page.evaluate(async()=>{const h=(window as any).jackieMotion;h.render({risk:'extreme',location:'market'});h.scene.show(Reflect.get(h.scene,'view'),true,false,'rate');const list:number[]=[];let last=0;await new Promise<void>(done=>{const f=(now:number)=>{h.scene.paint(now);if(last)list.push(now-last);last=now;if(list.length<180)requestAnimationFrame(f);else done();};requestAnimationFrame(f);});list.sort((a,b)=>a-b);return{median:list[90],p95:list[171]};});
  await writeFile(out+'/frame-rate.json',JSON.stringify(frames));expect(frames.median).toBeLessThan(20);
});

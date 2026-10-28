import {test,expect} from '@playwright/test';
import {createServer,type ViteDevServer} from 'vite';
import {mkdir,writeFile} from 'node:fs/promises';
import {contactAt,chairReleaseAt,resultAt} from '../games/jackie-chan/JackieChoreography';
let vite:ViteDevServer,url:string;const out='artifacts/work/jackie-chan';
test.beforeAll(async()=>{vite=await createServer({configFile:false,root:process.cwd(),cacheDir:'node_modules/.vite-jackie-motion',server:{host:'127.0.0.1',port:0}});await vite.listen();url=`http://127.0.0.1:${(vite.httpServer!.address()as{port:number}).port}`;await mkdir(out,{recursive:true});});
test.afterAll(async()=>await vite?.close());
test.beforeEach(async({page})=>{await page.goto(url+'/tests/fixtures/jackie-motion.html');await page.waitForFunction(()=>(window as any).jackieMotion?.ready(),{timeout:30000});});
test('all four costumes grip furniture at every contact without a second item on the floor',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));let frames=0;
  for(const width of [1000,360]){
    await page.setViewportSize({width,height:800});
    const results=await page.evaluate(({contacts})=>{
      const rows=[];for(const costume of ['master','sailor','police','hawk'])for(const location of ['restaurant','harbor','market'])for(const [risk,count]of [['safe',1],['sharp',2],['extreme',3]]as const)for(let i=0;i<count;i++){
        const data=(window as any).jackieMotion.render({costume,location,risk,time:contacts[i]});rows.push({costume,location,risk,i,...data});
      }return rows;
    },{contacts:[contactAt(0),contactAt(1),contactAt(2)]});
    for(const row of results){expect(row.atlas).toBe('furniture');expect(row.heldFurniture).toBe(['chair','table','stool'][row.i]);expect(row.floorFurniture.split(',')).not.toContain(row.heldFurniture);expect(row.pose).toBe(String([3,4,5][row.i]));expect(row.reveal).toBe('false');}frames+=results.length;
  }
  for(const [costume,location,risk,i]of [['master','restaurant','safe',0],['sailor','harbor','sharp',1],['hawk','market','extreme',2]]as const){await page.setViewportSize({width:1000,height:700});await page.evaluate(c=>(window as any).jackieMotion.render(c),{costume,location,risk,time:contactAt(i)});await page.locator('canvas').screenshot({path:out+'/furniture-'+['chair','table','stool'][i]+'.png'});}
  expect(errors).toEqual([]);await writeFile(out+'/furniture-frames.json',JSON.stringify({frames,viewports:[1000,360],costumes:4,locations:3,pageErrors:errors},null,2));
});
test('victory has fist and bow poses, while restored results and losses remain static',async({page})=>{
  for(const [risk,count]of [['safe',1],['sharp',2],['extreme',3]]as const){
    for(const [offset,phase,pose]of [[.6,'victory-fist',6],[1.6,'victory-bow',7]]as const){const frame=await page.evaluate(config=>(window as any).jackieMotion.render(config),{risk,status:'complete',time:resultAt(count)+offset});expect(frame.phase).toBe(phase);expect(frame.pose).toBe(String(pose));expect(frame.celebrating).toBe('true');}
    const restored=await page.evaluate(c=>(window as any).jackieMotion.restore(c),{risk,status:'complete'});expect(restored.phase).toBe('victory-hold');expect(restored.celebrating).toBe('false');
    const lost=await page.evaluate(config=>(window as any).jackieMotion.render(config),{risk,status:'lost',time:resultAt(count)+.6});expect(lost.phase).toBe('lost');expect(lost.celebrating).toBe('false');
  }
});
test('five distinct opponents rotate through the series and every rendered pose stays in the stage',async({page})=>{
  const seen=new Set<string>();let frames=0;
  for(const width of [1000,360]){
    await page.setViewportSize({width,height:800});
    const rows=await page.evaluate(({contact,end})=>{
      const rows=[];
      for(const location of ['restaurant','harbor','market'])for(let fight=0;fight<5;fight++)for(const[risk,count]of [['safe',1],['sharp',2],['extreme',3]]as const)for(const status of ['playing','lost']){
        const times=[0,...contact.slice(0,count).flatMap(t=>[t-.2,t,t+.2,t+.45]),end[count-1]+.1];
        for(const time of times){const frame=(window as any).jackieMotion.render({location,fight,risk,status,time});rows.push({location,fight,risk,count,status,time,width:document.querySelector('canvas')!.clientWidth,height:document.querySelector('canvas')!.clientHeight,...frame});}
      }
      return rows;
    },{contact:[contactAt(0),contactAt(1),contactAt(2)],end:[resultAt(1),resultAt(2),resultAt(3)]});
    for(const row of rows){
      const ids=row.foes.split(',');expect(ids).toHaveLength(row.count);expect(new Set(ids).size).toBe(row.count);ids.forEach((id:string)=>seen.add(id));
      const allowed=row.count===1?['street','agile']:row.count===2?['agile','bruiser','enforcer']:['bruiser','enforcer','master'];
      expect(ids.every((id:string)=>allowed.includes(id))).toBe(true);expect(ids.includes('master')).toBe(row.count===3);
      for(const frame of JSON.parse(row.foeFrames)){expect(frame.left).toBeGreaterThanOrEqual(0);expect(frame.right).toBeLessThanOrEqual(row.width+.01);expect(frame.top).toBeGreaterThanOrEqual(0);expect(frame.bottom).toBeLessThanOrEqual(row.height);expect(frame.pose).toBeGreaterThanOrEqual(0);expect(frame.pose).toBeLessThan(8);}
    }
    frames+=rows.length;
  }
  expect([...seen].sort()).toEqual(['agile','bruiser','enforcer','master','street']);
  const restored=await page.evaluate(()=>{const h=(window as any).jackieMotion,config={location:'harbor',fight:3,risk:'extreme',status:'lost'};return{played:h.render({...config,time:5}).foes,reopened:h.restore(config).foes};});expect(restored.played).toBe(restored.reopened);
  await page.setViewportSize({width:1000,height:700});
  for(const[location,fight,label]of [['restaurant',0,'restaurant'],['harbor',0,'harbor'],['market',1,'market']]as const){await page.evaluate(config=>(window as any).jackieMotion.render(config),{location,fight,risk:'extreme',time:0});await page.locator('canvas').screenshot({path:out+'/opponents-'+label+'.png'});}
  await writeFile(out+'/opponents-summary.json',JSON.stringify({frames,viewports:[1000,360],identities:[...seen].sort(),reopenPreservedLineup:true,allPosesInStage:true},null,2));
});
test('furniture survives pickup, strike, return and group transition on wins and losses',async({page})=>{
  let frames=0;
  for(const width of [1000,360]){
    await page.setViewportSize({width,height:800});
    const rows=await page.evaluate(({end,release})=>{
      const rows=[];
      for(const costume of ['master','sailor','police','hawk'])for(const [risk,count]of [['safe',1],['sharp',2],['extreme',3]]as const)for(const status of ['playing','lost']){
        const times=Array.from({length:Math.ceil(end[count-1]*10)+1},(_,i)=>i/10);times.push(release-.01,release+.01,end[count-1]+.8);
        for(const time of times)rows.push({count,time,...(window as any).jackieMotion.render({costume,risk,status,time})});
      }
      return rows;
    },{end:[resultAt(1),resultAt(2),resultAt(3)],release:chairReleaseAt()});
    for(const row of rows){
      const items=[...row.floorFurniture.split(',').filter(Boolean),...(row.heldFurniture?[row.heldFurniture]:[])];
      expect(items.sort()).toEqual(['chair','table','stool'].slice(0,row.count).sort());
      if(row.time>chairReleaseAt())expect(row.floorFurniture.split(',')).toContain('chair');
    }
    frames+=rows.length;
  }
  const phases=[0,.3,.7,1.05,contactAt(0),contactAt(0)+.3,contactAt(0)+.6,chairReleaseAt()+.05,contactAt(1),contactAt(1)+.4,contactAt(2),resultAt(3)+.1];
  const {default:sharp}=await import('sharp');const shots=[];
  await page.setViewportSize({width:1000,height:700});
  for(let i=0;i<phases.length;i++){
    await page.evaluate(time=>(window as any).jackieMotion.render({risk:'extreme',time}),phases[i]);
    const bytes=await page.locator('canvas').screenshot();shots.push({input:await sharp(bytes).resize(400,200).png().toBuffer(),left:i%3*400,top:Math.floor(i/3)*200});
  }
  await sharp({create:{width:1200,height:800,channels:3,background:'#1c1511'}}).composite(shots).png().toFile(out+'/furniture-sequence.png');
  await writeFile(out+'/furniture-continuity.json',JSON.stringify({frames,viewports:[1000,360],costumes:4,outcomes:['win','loss'],invariant:'Every selected item exists exactly once, attached or on the floor; chair is released only after lowering.'},null,2));
});
test('new wood and victory mix has bounded peaks and cancels all owned sound without closing the host context',async({page})=>{
  const stats=await page.evaluate(async()=>{
    const path='/src/game/GameAudio.ts',{gameAudio}=await import(/* @vite-ignore */path);const previousContext=gameAudio.context,previousOutput=gameAudio.output;
    async function render(cancel:boolean){
      const context=new OfflineAudioContext(1,9*44100,44100),output=context.createGain();output.connect(context.destination);gameAudio.context=context as unknown as AudioContext;gameAudio.output=output;
      const Audio=(window as any).jackieMotion.audio.constructor,audio=new Audio();audio.allowed=()=>true;audio.begin(3,true,true);const scheduled=audio.state().active;if(cancel)audio.cancel();
      const buffer=await context.startRendering(),data=buffer.getChannelData(0);let peak=0,energy=0,tailPeak=0;for(let i=0;i<data.length;i++){peak=Math.max(peak,Math.abs(data[i]));energy+=data[i]*data[i];if(i>8*44100)tailPeak=Math.max(tailPeak,Math.abs(data[i]));}audio.destroy();return{scheduled,peak,rms:Math.sqrt(energy/data.length),tailPeak,active:audio.state().active};
    }
    try{return{mix:await render(false),cancelled:await render(true)};}finally{gameAudio.context=previousContext;gameAudio.output=previousOutput;}
  });
  expect(stats.mix.scheduled).toBeGreaterThan(0);expect(stats.mix.peak).toBeGreaterThan(.01);expect(stats.mix.peak).toBeLessThan(.8);expect(stats.mix.tailPeak).toBe(0);expect(stats.mix.active).toBe(0);expect(stats.cancelled.peak).toBe(0);expect(stats.cancelled.active).toBe(0);await writeFile(out+'/furniture-audio.json',JSON.stringify({...stats,interpretation:'Signal, headroom and cleanup checks only; not a subjective listening assessment.'},null,2));
});

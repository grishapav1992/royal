import {test,expect,type Page} from '@playwright/test';
import {build} from 'esbuild';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import type {SlotAudioGame,SlotOutcome} from '../src/game/SlotAudio';
const directory=resolve('artifacts/game-presentation-goal-20261012/audio/wave4');
type Mode='loss'|'return'|'win'|'bigwin'|'loop'|'sequence'|'cancel'|'loop-cancel'|'cascade'|'cascade-cancel'|'cascade-wait';
let bundle:string,beforeBundle:string,currentBundle:string;
test.beforeAll(async()=>{
  const compile=async(path:string)=>(await build({entryPoints:[resolve(path)],bundle:true,write:false,format:'iife',globalName:'RoyalSlotAudio',target:'es2022'})).outputFiles[0].text+';window.setupSlotAudioTrace='+traceContext.toString()+';';
  currentBundle=await compile('src/game/SlotAudio.ts');beforeBundle=await compile(directory+'/SlotAudio-before.ts');bundle=currentBundle;mkdirSync(directory,{recursive:true});
});
function traceContext(context:any){
  const trace:any[]=[],waves=new WeakMap(),oscillator=context.createOscillator.bind(context),periodic=context.createPeriodicWave.bind(context);
  context.__audioTrace=trace;
  context.createPeriodicWave=(real:any,imag:any,options:any)=>{const wave=periodic(real,imag,options);waves.set(wave,Array.from(imag));return wave;};
  context.createOscillator=()=>{
    const source=oscillator(),voice:any={frequency:[],stops:[]};trace.push(voice);
    const frequency=source.frequency.setValueAtTime.bind(source.frequency),start=source.start.bind(source),stop=source.stop.bind(source),wave=source.setPeriodicWave.bind(source);
    source.frequency.setValueAtTime=(value:number,at:number)=>{voice.frequency.push({value,at});return frequency(value,at);};
    source.setPeriodicWave=(value:any)=>{voice.partials=waves.get(value);wave(value);};
    source.start=(at=context.currentTime)=>{voice.at=at;voice.type=source.type;voice.initialFrequency=source.frequency.value;start(at);};
    source.stop=(at=context.currentTime)=>{voice.stops.push(at);stop(at);};return source;
  };
}
function wav(samples:number[],rate:number){
  const bytes=Buffer.alloc(44+samples.length*2);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);
  bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(rate,24);bytes.writeUInt32LE(rate*2,28);
  bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(samples.length*2,40);
  samples.forEach((v,i)=>bytes.writeInt16LE(Math.round(Math.max(-1,Math.min(1,v))*32767),44+i*2));return bytes;
}
async function cascadeRender(page:Page,gameId:SlotAudioGame,mode:Mode){
  await page.addScriptTag({content:bundle});
  return page.evaluate(async({gameId,mode})=>{
    const themed=gameId!=='studio-neon-crown',newGame=gameId==='studio-caramel-carnival'||gameId==='studio-starfall-oracle',cascade=mode.startsWith('cascade');
    const duration=mode==='sequence'?(newGame?5:themed?6:4):cascade?4:2.6;
    const c=new OfflineAudioContext(1,44100*duration,44100),output=c.createGain();output.gain.value=.35;output.connect(c.destination);(window as any).setupSlotAudioTrace(c);
    const cues:string[]=[],{SlotAudio}=(window as any).RoyalSlotAudio;
    const owner=new SlotAudio({context:()=>c,output:()=>output,enabled:()=>true,unlock:()=>Promise.resolve(),reducedMotion:()=>false,
      duck:()=>{},played:(cue:string)=>cues.push(cue),canceled:()=>{},disposed:()=>{}},gameId);
    if(cascade)owner.beginCascade('isolated',{motion:true});else owner.begin('isolated',{motion:mode==='loop'||mode==='loop-cancel'||mode==='sequence'});
    await Promise.resolve();await Promise.resolve();
    if(!cascade&&!['loop','loop-cancel','sequence'].includes(mode))owner.outcome('isolated',mode==='cancel'?'bigwin':mode);
    const legacy=themed?[
      ...[0,1,2,3,4].map(index=>({at:.3+index*.3,play:()=>owner.stopReel('isolated',index)})),
      ...['free-stage','expand','sticky','multiplier'].map((kind,i)=>({at:1.8+i*.35,play:()=>owner.effect('isolated',kind,`stage:${kind}:${i}`)})),
      ...[0,gameId==='studio-cosmic-escape'?19:13].map((index,i)=>({at:3.2+i*.35,play:()=>owner.line('isolated',index)})),
      {at:3.9,play:()=>owner.outcome('isolated','bigwin')},
    ]:[
      ...[0,1,2].map(index=>({at:.3+index*.3,play:()=>owner.stopReel('isolated',index)})),
      ...[0,2,4].map((index,i)=>({at:1.02+i*.33,play:()=>owner.line('isolated',index)})),
      {at:2.01,play:()=>owner.outcome('isolated','bigwin')},
    ];
    const base=[...[0,1,2,3,4,5].map(index=>({at:.3+index*.25,play:()=>owner.stopReel('isolated',index)})),
      ...[0,1,2].map((index,i)=>({at:1.9+i*.33,play:()=>owner.group('isolated',index)})),
      {at:3,play:()=>owner.outcome('isolated','win')}];
    const cascadeStages=[
      {at:.25,play:()=>{owner.confirmCascade('isolated');owner.effect('isolated','collapse','accepted:collapse');}},
      {at:.53,play:()=>owner.effect('isolated','drop','accepted:drop')},
      {at:.96,play:()=>owner.effect('isolated','refill','accepted:refill')},
      {at:1.61,play:()=>{owner.settleCascade('isolated');if(gameId==='studio-starfall-oracle')owner.effect('isolated','orb','accepted:orb');}},
      ...[0,1,2].map((index,i)=>({at:1.7+i*.33,play:()=>owner.group('isolated',index)})),
      {at:2.69,play:()=>owner.outcome('isolated','return')},
    ];
    const actions=mode==='sequence'?(newGame?base:legacy):mode==='cascade'||mode==='cascade-cancel'?cascadeStages:[];
    const schedule=actions.map(action=>c.suspend(action.at).then(async()=>{action.play();await c.resume();}));
    const pause=mode==='cancel'||mode==='loop-cancel'?c.suspend(.15):mode==='cascade-cancel'?c.suspend(1.05):undefined;
    const rendered=c.startRendering();if(pause){await pause;owner.cancel();await c.resume();}
    const buffer=await rendered;await Promise.all(schedule);const data=buffer.getChannelData(0);
    let sum=0,peak=0,mean=0,tail=0,afterCancel=0;
    for(let i=0;i<data.length;i++){const v=data[i];sum+=v*v;peak=Math.max(peak,Math.abs(v));mean+=v;
      if(i>c.sampleRate*(duration-.05))tail=Math.max(tail,Math.abs(v));if(i>c.sampleRate*(mode==='cascade-cancel'?1.12:.22))afterCancel=Math.max(afterCancel,Math.abs(v));}
    const state=owner.getState();owner.dispose();
    return{samples:Array.from(data),rate:c.sampleRate,stats:{rms:Math.sqrt(sum/data.length),peak,mean:mean/data.length,tail,afterCancel,seamJump:Math.abs(data[c.sampleRate*2]-data[c.sampleRate*2-1]),cues,state,trace:(c as any).__audioTrace}};
  },{gameId,mode});
}
async function legacyRender(page:Page,mode:SlotOutcome|'loop'|'cancel'|'loop-cancel'|'sequence',gameId:SlotAudioGame='studio-neon-crown'){
  await page.addScriptTag({content:bundle});
  return page.evaluate(async({mode,gameId})=>{
    const themed=gameId!=='studio-neon-crown';
    const c=new OfflineAudioContext(1,44100*(mode==='sequence'?themed?6:4:2.6),44100),output=c.createGain();output.gain.value=.35;output.connect(c.destination);(window as any).setupSlotAudioTrace(c);
    const cues:string[]=[];
    const {SlotAudio}=(window as unknown as {RoyalSlotAudio:{SlotAudio:new(environment:unknown,gameId:string)=>{
      begin:(token:string,options:{motion:boolean})=>void;outcome:(token:string,kind:string)=>void;cancel:()=>void;
      stopReel:(token:string,index:number)=>void;line:(token:string,index:number)=>void;
      effect:(token:string,kind:string,eventId:string)=>void;
      dispose:()=>void;getState:()=>{activeSources:number;looping:boolean};
    }}}).RoyalSlotAudio;
    const owner=new SlotAudio({context:()=>c,output:()=>output,enabled:()=>true,unlock:()=>Promise.resolve(),reducedMotion:()=>false,
      duck:()=>{},played:(cue:string)=>cues.push(cue),canceled:()=>{},disposed:()=>{}},gameId);
    owner.begin('isolated',{motion:mode==='loop'||mode==='loop-cancel'||mode==='sequence'});await Promise.resolve();await Promise.resolve();
    if(mode!=='loop'&&mode!=='loop-cancel'&&mode!=='sequence')owner.outcome('isolated',mode==='cancel'?'bigwin':mode);
    const stages=themed?[
      ...[0,1,2,3,4].map(index=>({at:.3+index*.3,play:()=>owner.stopReel('isolated',index)})),
      ...['free-stage','expand','sticky','multiplier'].map((kind,i)=>({at:1.8+i*.35,play:()=>owner.effect('isolated',kind,`stage:${kind}:${i}`)})),
      ...[0,gameId==='studio-cosmic-escape'?19:13].map((index,i)=>({at:3.2+i*.35,play:()=>owner.line('isolated',index)})),
      {at:3.9,play:()=>owner.outcome('isolated','bigwin')},
    ]:[
      ...[0,1,2].map(index=>({at:.3+index*.3,play:()=>owner.stopReel('isolated',index)})),
      ...[0,2,4].map((index,i)=>({at:1.02+i*.33,play:()=>owner.line('isolated',index)})),
      {at:2.01,play:()=>owner.outcome('isolated','bigwin')},
    ];
    const sequence=mode==='sequence'?stages.map(action=>c.suspend(action.at).then(async()=>{action.play();await c.resume();})):[];
    const pause=mode==='cancel'||mode==='loop-cancel'?c.suspend(.15):undefined,rendering=c.startRendering();
    if(pause){await pause;owner.cancel();await c.resume();}
    const buffer=await rendering;await Promise.all(sequence);const data=buffer.getChannelData(0);let squares=0,peak=0,mean=0,tail=0,late=0;
    for(let i=0;i<data.length;i++){const value=data[i];squares+=value*value;peak=Math.max(peak,Math.abs(value));mean+=value;
      if(i>c.sampleRate*(mode==='sequence'?themed?5.95:3.8:2.2))tail=Math.max(tail,Math.abs(value));if(i>c.sampleRate*.22)late=Math.max(late,Math.abs(value));}
    const seamJump=Math.abs(data[c.sampleRate*2]-data[c.sampleRate*2-1]);
    const state=owner.getState();owner.dispose();
    return {samples:Array.from(data),sampleRate:c.sampleRate,stats:{rms:Math.sqrt(squares/data.length),peak,mean:mean/data.length,tail,late,seamJump,cues,state,trace:(c as any).__audioTrace}};
  },{mode,gameId});
}

type ClusterMode=SlotOutcome|'loop'|'free-loop'|'sequence'|'free-sequence'|'cancel'|'loop-cancel'|'feature-cancel'|'reduced-bigwin';
async function clusterRender(page:Page,gameId:'studio-lumen-grove'|'studio-prism-atelier',mode:ClusterMode){
  await page.addScriptTag({content:bundle});
  return page.evaluate(async({gameId,mode})=>{
    const duration=mode.includes('sequence')?7.2:2.6,c=new OfflineAudioContext(1,44100*duration,44100),output=c.createGain();output.gain.value=.35;output.connect(c.destination);(window as any).setupSlotAudioTrace(c);
    const cues:string[]=[],{SlotAudio}=(window as any).RoyalSlotAudio,isolated=['loss','return','win','bigwin','cancel','feature-cancel'].includes(mode);let enabled=!isolated;
    const owner=new SlotAudio({context:()=>c,output:()=>output,enabled:()=>enabled,unlock:()=>Promise.resolve(),reducedMotion:()=>false,duck:()=>{},played:(cue:string)=>cues.push(cue),canceled:()=>{},disposed:()=>{}},gameId);
    owner.begin('cluster',{motion:mode!=='reduced-bigwin',click:!mode.startsWith('free-')&&mode!=='reduced-bigwin'});await Promise.resolve();await Promise.resolve();
    if(isolated){for(let index=0;index<6;index++)owner.stopReel('cluster',index);enabled=true;}
    if(['loss','return','win','bigwin','cancel','reduced-bigwin'].includes(mode))owner.outcome('cluster',mode==='cancel'||mode==='reduced-bigwin'?'bigwin':mode);
    const stages=[...[0,1,2,3,4,5].map(index=>({at:.3+index*.25,play:()=>owner.stopReel('cluster',index)}))];
    if(mode.startsWith('free-'))stages.push({at:1.9,play:()=>owner.effect('cluster','free-stage','free:1')});
    if(gameId==='studio-prism-atelier')stages.push({at:2.45,play:()=>owner.effect('cluster','cell-values','cells:1')});
    const groups=gameId==='studio-prism-atelier'?4:3;
    stages.push(...Array.from({length:groups},(_,index)=>({at:2.9+index*.33,play:()=>owner.group('cluster',index)})));
    if(gameId==='studio-lumen-grove')stages.push({at:4,play:()=>owner.effect('cluster','collect','collector:1')},{at:4.5,play:()=>owner.effect('cluster','collect','collector:2')});
    stages.push({at:5,play:()=>owner.outcome('cluster','bigwin')});
    if(mode==='feature-cancel'){
      owner.effect('cluster',gameId==='studio-lumen-grove'?'collect':'cell-values','confirmed:feature');
    }
    const scheduled=mode.includes('sequence')?stages.map(stage=>c.suspend(stage.at).then(async()=>{stage.play();await c.resume();})):[];
    const cancel=mode==='cancel'||mode==='loop-cancel'?c.suspend(.15):mode==='feature-cancel'?c.suspend(.04):undefined,rendering=c.startRendering();
    if(cancel){await cancel;owner.cancel();await c.resume();}
    const buffer=await rendering;await Promise.all(scheduled);const data=buffer.getChannelData(0);let squares=0,peak=0,mean=0,tail=0,late=0;
    for(let index=0;index<data.length;index++){const v=data[index];squares+=v*v;peak=Math.max(peak,Math.abs(v));mean+=v;
      if(index>c.sampleRate*(duration-.05))tail=Math.max(tail,Math.abs(v));if(index>c.sampleRate*(mode==='feature-cancel'?.11:.22))late=Math.max(late,Math.abs(v));}
    const state=owner.getState(),trace=(c as any).__audioTrace;owner.dispose();return{samples:Array.from(data),sampleRate:c.sampleRate,stats:{rms:Math.sqrt(squares/data.length),peak,mean:mean/data.length,tail,late,seamJump:Math.abs(data[c.sampleRate*2]-data[c.sampleRate*2-1]),cues,state,trace}};
  },{gameId,mode});
}
const measured:Record<string,unknown>={},hashes:Record<string,string>={};
function save(game:string,mode:string,result:{samples:number[];sampleRate:number;stats:unknown}){
  const key=game+'-'+mode,bytes=wav(result.samples,result.sampleRate);measured[key]=result.stats;hashes[key]=createHash('sha256').update(bytes).digest('hex');writeFileSync(resolve(directory,key+'.wav'),bytes);
  writeFileSync(resolve(directory,'renders.json'),JSON.stringify(measured,null,2));writeFileSync(resolve(directory,'sha256.json'),JSON.stringify(hashes,null,2));
}
function comparePcm(actual:number[],expected:number[]){
  expect(actual.length).toBe(expected.length);let max=0,differences=0;for(let index=0;index<actual.length;index++){const a=Math.round(actual[index]*32767),b=Math.round(expected[index]*32767),difference=Math.abs(a-b);if(difference)differences++;max=Math.max(max,difference);}
  expect(max).toBeLessThanOrEqual(1);expect(differences).toBeLessThan(actual.length*.001);return {differences,maxDifference:max};
}
test('all five released palettes preserve every old oscillator note, timing, timbre and PCM waveform',async({page})=>{
  const proof:Record<string,unknown>={};
  for(const game of ['studio-neon-crown','studio-cosmic-escape','studio-velvet-reign','studio-caramel-carnival','studio-starfall-oracle'] as const){
    const cascade=game==='studio-caramel-carnival'||game==='studio-starfall-oracle';
    const modes:Mode[]=game==='studio-neon-crown'?['loss','return','win','bigwin','loop','sequence']:cascade?['loss','return','win','bigwin','loop','sequence','cancel','loop-cancel','cascade','cascade-cancel','cascade-wait']:['loss','return','win','bigwin','loop','sequence','cancel','loop-cancel'];
    for(const mode of modes){
      bundle=beforeBundle;const before=cascade?await cascadeRender(page,game,mode):await legacyRender(page,mode as any,game);
      bundle=currentBundle;const after=cascade?await cascadeRender(page,game,mode):await legacyRender(page,mode as any,game);
      expect(after.stats.trace,game+' '+mode+' notes').toEqual(before.stats.trace);expect(after.stats.cues).toEqual(before.stats.cues);
      const beforeRate='rate'in before?before.rate:before.sampleRate,afterRate='rate'in after?after.rate:after.sampleRate;expect(afterRate).toBe(beforeRate);
      const pcm=comparePcm(after.samples,before.samples),beforeHash=createHash('sha256').update(wav(before.samples,beforeRate)).digest('hex'),afterHash=createHash('sha256').update(wav(after.samples,afterRate)).digest('hex');
      proof[game+'-'+mode]={...pcm,exactHash:beforeHash===afterHash,beforeHash,afterHash,oscillatorTraceIdentical:true};
    }
  }
  writeFileSync(resolve(directory,'released-palettes-preserved.json'),JSON.stringify(proof,null,2));
});
test('new forest and prism outcomes are distinct musical originals with quiet returns and reduced-motion cues',async({page})=>{
  bundle=currentBundle;for(const game of ['studio-lumen-grove','studio-prism-atelier'] as const){const rms:Record<string,number>={};
    for(const mode of ['loss','return','win','bigwin','reduced-bigwin'] as const){const result=await clusterRender(page,game,mode);save(game,mode,result);rms[mode]=result.stats.rms;
      expect(result.stats.peak).toBeGreaterThan(.0005);expect(result.stats.peak).toBeLessThan(.12);expect(Math.abs(result.stats.mean)).toBeLessThan(.002);expect(result.stats.tail).toBeLessThan(.000001);expect(result.stats.state.activeSources).toBe(0);
      expect(result.stats.cues).toEqual(mode==='reduced-bigwin'?['bigwin']:[mode]);
    }
    expect(rms.loss).toBeLessThan(rms.return);expect(rms.return).toBeLessThan(rms.win);expect(rms.win).toBeLessThan(rms.bigwin);expect(rms['reduced-bigwin']).toBeLessThan(rms.win);
  }
  expect(hashes['studio-lumen-grove-win']).not.toBe(hashes['studio-prism-atelier-win']);
});
test('free spin omits only the click, retaining a quiet continuous six-stop motor',async({page})=>{
  bundle=currentBundle;for(const game of ['studio-lumen-grove','studio-prism-atelier'] as const){for(const mode of ['loop','free-loop'] as const){const result=await clusterRender(page,game,mode);save(game,mode,result);
    expect(result.stats.cues).toEqual(mode==='free-loop'?[]:['click']);expect(result.stats.rms).toBeGreaterThan(.0001);expect(result.stats.peak).toBeLessThan(.04);expect(result.stats.seamJump).toBeLessThan(.0002);expect(result.stats.state.looping).toBe(true);
  }}
});
test('confirmed base and free stages play all groups and feature accents before the real bigwin phrase',async({page})=>{
  bundle=currentBundle;for(const game of ['studio-lumen-grove','studio-prism-atelier'] as const)for(const mode of ['sequence','free-sequence'] as const){const result=await clusterRender(page,game,mode);save(game,mode,result);
    const expected=[...(mode==='sequence'?['click']:[]),...Array(6).fill('reel-stop'),...(mode==='free-sequence'?['free-stage']:[]),...(game==='studio-prism-atelier'?['cell-values']:[]),...Array(game==='studio-prism-atelier'?4:3).fill('group'),...(game==='studio-lumen-grove'?['collect','collect']:[]),'bigwin'];
    expect(result.stats.cues).toEqual(expected);expect(result.stats.peak).toBeLessThan(.12);expect(result.stats.state.looping).toBe(false);expect(result.stats.state.activeSources).toBe(0);expect(result.stats.tail).toBeLessThan(.000001);
  }
});
test('future notes, motor and feature cancellation end in exact silence without a gain spike',async({page})=>{
  bundle=currentBundle;for(const game of ['studio-lumen-grove','studio-prism-atelier'] as const)for(const mode of ['cancel','loop-cancel','feature-cancel'] as const){const result=await clusterRender(page,game,mode);save(game,mode,result);
    expect(result.stats.peak).toBeGreaterThan(.0005);expect(result.stats.peak).toBeLessThan(.03);expect(result.stats.late).toBeLessThan(.000001);expect(result.stats.state.activeSources).toBe(0);expect(result.stats.state.looping).toBe(false);
  }
});


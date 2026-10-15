import {test,expect,type Page} from '@playwright/test';
import {build} from 'esbuild';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import type {SlotAudioGame,SlotOutcome} from '../src/game/SlotAudio';

const directory=resolve('artifacts/game-presentation-goal-20261012/audio/wave3');
type Mode='loss'|'return'|'win'|'bigwin'|'loop'|'sequence'|'cancel'|'loop-cancel'|'cascade'|'cascade-cancel'|'cascade-wait';
let bundle:string;
test.beforeAll(async()=>{
  const result=await build({entryPoints:[resolve('src/game/SlotAudio.ts')],bundle:true,write:false,format:'iife',globalName:'RoyalSlotAudio',target:'es2022'});
  bundle=result.outputFiles[0].text;mkdirSync(directory,{recursive:true});
});
function wav(samples:number[],rate:number){
  const bytes=Buffer.alloc(44+samples.length*2);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);
  bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(rate,24);bytes.writeUInt32LE(rate*2,28);
  bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(samples.length*2,40);
  samples.forEach((v,i)=>bytes.writeInt16LE(Math.round(Math.max(-1,Math.min(1,v))*32767),44+i*2));return bytes;
}
async function render(page:Page,gameId:SlotAudioGame,mode:Mode){
  await page.addScriptTag({content:bundle});
  return page.evaluate(async({gameId,mode})=>{
    const themed=gameId!=='studio-neon-crown',newGame=gameId==='studio-caramel-carnival'||gameId==='studio-starfall-oracle',cascade=mode.startsWith('cascade');
    const duration=mode==='sequence'?(newGame?5:themed?6:4):cascade?4:2.6;
    const c=new OfflineAudioContext(1,44100*duration,44100),output=c.createGain();output.gain.value=.35;output.connect(c.destination);
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
    return{samples:Array.from(data),rate:c.sampleRate,stats:{rms:Math.sqrt(sum/data.length),peak,mean:mean/data.length,tail,afterCancel,seamJump:Math.abs(data[c.sampleRate*2]-data[c.sampleRate*2-1]),cues,state}};
  },{gameId,mode});
}
async function legacyRender(page:Page,mode:SlotOutcome|'loop'|'cancel'|'loop-cancel'|'sequence',gameId:SlotAudioGame='studio-neon-crown'){
  await page.addScriptTag({content:bundle});
  return page.evaluate(async({mode,gameId})=>{
    const themed=gameId!=='studio-neon-crown';
    const c=new OfflineAudioContext(1,44100*(mode==='sequence'?themed?6:4:2.6),44100),output=c.createGain();output.gain.value=.35;output.connect(c.destination);
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
    return {samples:Array.from(data),sampleRate:c.sampleRate,stats:{rms:Math.sqrt(squares/data.length),peak,mean:mean/data.length,tail,late,seamJump,cues,state}};
  },{mode,gameId});
}

const measured:Record<string,unknown>={},hashes:Record<string,string>={};
function save(game:SlotAudioGame,mode:Mode,result:Awaited<ReturnType<typeof render>>){
  const name=`${game}-${mode}`,bytes=wav(result.samples,result.rate);measured[name]=result.stats;hashes[name]=createHash('sha256').update(bytes).digest('hex');
  writeFileSync(resolve(directory,`${name}.wav`),bytes);
  writeFileSync(resolve(directory,'renders.json'),JSON.stringify(measured,null,2));writeFileSync(resolve(directory,'sha256.json'),JSON.stringify(hashes,null,2));
}
test('released Neon, Cosmic and Velvet waveforms preserve all samples within one mixer rounding unit',async({page})=>{
  const neon=JSON.parse(readFileSync(resolve('artifacts/game-presentation-goal-20261012/audio/neon-baseline.json'),'utf8'));
  const old=JSON.parse(readFileSync(resolve(directory,'wave2-baseline.json'),'utf8'));
  const checked:Record<string,unknown>={};
  for(const game of ['studio-neon-crown','studio-cosmic-escape','studio-velvet-reign'] as const){
    const modes:Mode[]=game==='studio-neon-crown'?['loss','return','win','bigwin','loop','sequence']:['loss','return','win','bigwin','loop','sequence','cancel','loop-cancel'];
    for(const mode of modes){const result=await legacyRender(page,mode as SlotOutcome|'loop'|'cancel'|'loop-cancel'|'sequence',game),hash=createHash('sha256').update(wav(result.samples,result.sampleRate)).digest('hex');
      writeFileSync(resolve(directory,`${game}-${mode}-preservation.wav`),wav(result.samples,result.sampleRate));
      writeFileSync(resolve(directory,`${game}-${mode}-preservation.json`),JSON.stringify(result.stats,null,2));
      const key=game==='studio-neon-crown'?(mode==='loop'?'reel-loop':mode==='sequence'?'live-sequence':mode):`${game}-${mode}`;
      const expected=game==='studio-neon-crown'?neon[key]:old[key];let differences=0,maxDifference=0;
      if(hash!==expected){
        const reference=readFileSync(resolve(game==='studio-neon-crown'?'artifacts/neon-slot-20261012/audio':'artifacts/game-presentation-goal-20261012/audio/wave2',`${key}.wav`));
        const actual=wav(result.samples,result.sampleRate);expect(actual.length).toBe(reference.length);expect(actual.subarray(0,44)).toEqual(reference.subarray(0,44));
        for(let i=44;i<actual.length;i+=2){const difference=Math.abs(actual.readInt16LE(i)-reference.readInt16LE(i));if(difference)differences++;maxDifference=Math.max(maxDifference,difference);}
        expect(maxDifference,`${game} ${mode}`).toBeLessThanOrEqual(1);expect(differences).toBeLessThan((actual.length-44)/2*.001);
      }
      checked[`${game}-${mode}`]={hash,expected,exact:hash===expected,differences,maxDifference};
    }
  }
  writeFileSync(resolve(directory,'released-palettes-preserved.json'),JSON.stringify(checked,null,2));
});
test('new original palettes have bounded peaks, subdued returns and distinct win motifs',async({page})=>{
  for(const game of ['studio-caramel-carnival','studio-starfall-oracle'] as const){
    const rms:Record<string,number>={};for(const mode of ['loss','return','win','bigwin'] as const){
      const result=await render(page,game,mode);save(game,mode,result);rms[mode]=result.stats.rms;
      expect(result.stats.cues).toEqual(['click',mode]);expect(result.stats.peak).toBeGreaterThan(.0005);expect(result.stats.peak).toBeLessThan(.12);
      expect(Math.abs(result.stats.mean)).toBeLessThan(.002);expect(result.stats.tail).toBeLessThan(.000001);expect(result.stats.state.activeSources).toBe(0);
    }
    expect(rms.loss).toBeLessThan(rms.return);expect(rms.return).toBeLessThan(rms.win);expect(rms.win).toBeLessThan(rms.bigwin);
  }
  expect(hashes['studio-caramel-carnival-win']).not.toBe(hashes['studio-starfall-oracle-win']);
  // Generic bigwin is an audio signal check, not a reachable financial case in these games.
});
test('six-stop base loops are quiet and end before confirmed groups and ordinary win',async({page})=>{
  for(const game of ['studio-caramel-carnival','studio-starfall-oracle'] as const){
    const loop=await render(page,game,'loop'),sequence=await render(page,game,'sequence');save(game,'loop',loop);save(game,'sequence',sequence);
    expect(loop.stats.peak).toBeLessThan(.04);expect(loop.stats.rms).toBeGreaterThan(.0001);expect(loop.stats.seamJump).toBeLessThan(.0002);
    expect(sequence.stats.cues).toEqual(['click',...Array(6).fill('reel-stop'),...Array(3).fill('group'),'win']);
    expect(sequence.stats.peak).toBeLessThan(.12);expect(sequence.stats.tail).toBeLessThan(.000001);expect(sequence.stats.state.activeSources).toBe(0);expect(sequence.stats.state.looping).toBe(false);
  }
});
test('cascade waits are silent and confirmed transforms have no motor or fake reel stops',async({page})=>{
  for(const game of ['studio-caramel-carnival','studio-starfall-oracle'] as const){
    const waiting=await render(page,game,'cascade-wait'),cascade=await render(page,game,'cascade');save(game,'cascade-wait',waiting);save(game,'cascade',cascade);
    expect(waiting.stats.peak).toBe(0);expect(waiting.stats.cues).toEqual([]);expect(waiting.stats.state.activeSources).toBe(0);expect(waiting.stats.state.looping).toBe(false);
    expect(cascade.stats.cues).toEqual(['collapse','drop','refill',...(game==='studio-starfall-oracle'?['orb']:[]),'group','group','group','return']);
    expect(cascade.stats.peak).toBeLessThan(.12);expect(cascade.stats.tail).toBeLessThan(.000001);expect(cascade.stats.state.activeSources).toBe(0);expect(cascade.stats.state.looping).toBe(false);
  }
});
test('canceling future outcome, motor and cascade notes leaves exact silence',async({page})=>{
  for(const game of ['studio-caramel-carnival','studio-starfall-oracle'] as const)for(const mode of ['cancel','loop-cancel','cascade-cancel'] as const){
    const result=await render(page,game,mode);save(game,mode,result);expect(result.stats.peak).toBeGreaterThan(.0005);expect(result.stats.afterCancel).toBeLessThan(.000001);
    expect(result.stats.state.activeSources).toBe(0);expect(result.stats.state.looping).toBe(false);
    if(mode==='cascade-cancel'){expect(result.stats.cues).toEqual(['collapse','drop','refill']);expect(result.stats.peak).toBeLessThan(.02);}
  }
});

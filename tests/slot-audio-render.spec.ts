import {test,expect,type Page} from '@playwright/test';
import {build} from 'esbuild';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {SlotOutcome,SlotAudioGame} from '../src/game/SlotAudio';

const artifact=resolve('artifacts/neon-slot-20261012/audio');
let bundle:string;
test.beforeAll(async()=>{
  const result=await build({entryPoints:[fileURLToPath(new URL('../src/game/SlotAudio.ts',import.meta.url))],bundle:true,write:false,format:'iife',globalName:'RoyalSlotAudio',target:'es2022'});
  bundle=result.outputFiles[0].text;mkdirSync(artifact,{recursive:true});
});
function wav(data:number[],sampleRate:number){
  const bytes=Buffer.alloc(44+data.length*2);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);
  bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(sampleRate,24);
  bytes.writeUInt32LE(sampleRate*2,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(data.length*2,40);
  data.forEach((value,i)=>bytes.writeInt16LE(Math.round(Math.max(-1,Math.min(1,value))*32767),44+i*2));return bytes;
}
async function render(page:Page,mode:SlotOutcome|'loop'|'cancel'|'loop-cancel'|'sequence',gameId:SlotAudioGame='studio-neon-crown'){
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

test('original outcome cues render below clipping, return and loss stay quieter than celebrations',async({page})=>{
  const results:Record<string,unknown>={},rms:Record<string,number>={};
  for(const mode of ['loss','return','win','bigwin'] as const){
    const result=await render(page,mode);rms[mode]=result.stats.rms;results[mode]=result.stats;
    expect(result.stats.peak).toBeGreaterThan(.0005);expect(result.stats.peak).toBeLessThan(.12);
    expect(Math.abs(result.stats.mean)).toBeLessThan(.002);expect(result.stats.tail).toBeLessThan(.000001);
    expect(result.stats.state.activeSources).toBe(0);expect(result.stats.cues).toEqual(['click',mode]);
    writeFileSync(resolve(artifact,`${mode}.wav`),wav(result.samples,result.sampleRate));
  }
  expect(rms.return).toBeLessThan(rms.win);expect(rms.loss).toBeLessThan(rms.return);expect(rms.win).toBeLessThan(rms.bigwin);
  writeFileSync(resolve(artifact,'outcome-render.json'),JSON.stringify(results,null,2));
});

test('reel motor is low, continuous and canceled melodies have no later tail',async({page})=>{
  const loop=await render(page,'loop'),canceled=await render(page,'cancel'),motorCanceled=await render(page,'loop-cancel');
  expect(loop.stats.rms).toBeGreaterThan(.0001);expect(loop.stats.peak).toBeLessThan(.04);expect(loop.stats.cues).toEqual(['click']);
  expect(canceled.stats.peak).toBeGreaterThan(.0005);expect(canceled.stats.late).toBeLessThan(.000001);
  expect(canceled.stats.state.activeSources).toBe(0);expect(canceled.stats.state.looping).toBe(false);
  expect(loop.stats.seamJump).toBeLessThan(.0002);expect(motorCanceled.stats.late).toBeLessThan(.000001);
  expect(motorCanceled.stats.state.activeSources).toBe(0);expect(motorCanceled.stats.state.looping).toBe(false);
  writeFileSync(resolve(artifact,'reel-loop.wav'),wav(loop.samples,loop.sampleRate));
  writeFileSync(resolve(artifact,'bigwin-canceled.wav'),wav(canceled.samples,canceled.sampleRate));
  writeFileSync(resolve(artifact,'motor-canceled.wav'),wav(motorCanceled.samples,motorCanceled.sampleRate));
  writeFileSync(resolve(artifact,'motor-cancel-render.json'),JSON.stringify({loop:loop.stats,canceled:canceled.stats,motorCanceled:motorCanceled.stats},null,2));
});

test('complete live presentation includes three distinct stops, line cues then the original celebration',async({page})=>{
  const result=await render(page,'sequence');
  expect(result.stats.cues).toEqual(['click','reel-stop','reel-stop','reel-stop','line','line','line','bigwin']);
  expect(result.stats.peak).toBeLessThan(.12);expect(result.stats.tail).toBeLessThan(.000001);
  expect(result.stats.state.activeSources).toBe(0);expect(result.stats.state.looping).toBe(false);
  writeFileSync(resolve(artifact,'live-sequence.wav'),wav(result.samples,result.sampleRate));
  writeFileSync(resolve(artifact,'live-sequence-render.json'),JSON.stringify(result.stats,null,2));
});

test('expanding to five reels preserves every original Neon cue sample',async({page})=>{
  const original=JSON.parse(readFileSync(resolve('artifacts/game-presentation-goal-20261012/audio/neon-baseline.json'),'utf8')) as Record<string,string>;
  for(const mode of ['loss','return','win','bigwin','loop','sequence'] as const){
    const result=await render(page,mode),name=mode==='loop'?'reel-loop':mode==='sequence'?'live-sequence':mode;
    expect(createHash('sha256').update(wav(result.samples,result.sampleRate)).digest('hex'),name).toBe(original[name]);
  }
});

test('Cosmic and Velvet have distinct original palettes and cancel all five-reel future sounds',async({page})=>{
  const dir=resolve('artifacts/game-presentation-goal-20261012/audio/wave2');mkdirSync(dir,{recursive:true});
  const results:Record<string,unknown>={},hashes:Record<string,string>={};
  for(const game of ['studio-cosmic-escape','studio-velvet-reign'] as const){
    const measured:Record<string,unknown>={},outcomeRms:Record<string,number>={};
    for(const mode of ['loss','return','win','bigwin','loop','sequence','cancel','loop-cancel'] as const){
      const result=await render(page,mode,game),bytes=wav(result.samples,result.sampleRate);measured[mode]=result.stats;
      expect(result.stats.peak).toBeGreaterThan(.0005);expect(result.stats.peak).toBeLessThan(.12);
      if(mode==='loop')expect(result.stats.seamJump).toBeLessThan(.0002);
      if(mode==='sequence'){
        expect(result.stats.cues).toEqual(['click','reel-stop','reel-stop','reel-stop','reel-stop','reel-stop','free-stage','expand','sticky','multiplier','line','line','bigwin']);
        expect(result.stats.tail).toBeLessThan(.000001);expect(result.stats.state.activeSources).toBe(0);
        hashes[game]=createHash('sha256').update(bytes).digest('hex');
      }
      if(mode==='cancel'||mode==='loop-cancel'){expect(result.stats.late).toBeLessThan(.000001);expect(result.stats.state.activeSources).toBe(0);expect(result.stats.state.looping).toBe(false);}
      if(['loss','return','win','bigwin'].includes(mode)){outcomeRms[mode]=result.stats.rms;expect(result.stats.tail).toBeLessThan(.000001);expect(result.stats.cues).toEqual(['click',mode]);}
      writeFileSync(resolve(dir,`${game}-${mode}.wav`),bytes);
    }
    expect(outcomeRms.loss).toBeLessThan(outcomeRms.return);expect(outcomeRms.return).toBeLessThan(outcomeRms.win);expect(outcomeRms.win).toBeLessThan(outcomeRms.bigwin);
    results[game]=measured;
  }
  expect(hashes['studio-cosmic-escape']).not.toBe(hashes['studio-velvet-reign']);
  writeFileSync(resolve(dir,'renders.json'),JSON.stringify(results,null,2));
});

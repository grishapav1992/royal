import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const out=process.env.FOREST_ARTIFACT_DIR || 'artifacts/work/forest-heart-audio-v3';

function wav(samples:number[],rate:number){
  const bytes=Buffer.alloc(44+samples.length*2);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(rate,24);bytes.writeUInt32LE(rate*2,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(samples.length*2,40);samples.forEach((value,index)=>bytes.writeInt16LE(Math.max(-32768,Math.min(32767,Math.round(value*32767))),44+index*2));return bytes;
}

test('the new arrangement and event palette render without clipping, with equal-level comparison previews',async({page})=>{
  await page.goto('/');
  const rendered=await page.evaluate(async()=>{
    const newPath='/games/forest-heart/ForestScore.ts',musicPath='/games/forest-heart/ForestMusic.ts';
    const oldPath='/tests/fixtures/forest-audio-v1.ts';
    const {ForestScore}=await import(newPath),{FOREST_MUSIC_STEP}=await import(musicPath),Before=(await import(oldPath)).ForestScore;
    const rate=22050,events=['land','turn','flow','flower','choice','bonus','win','big'];
    async function effects(Score:any){
      const c=new OfflineAudioContext(1,rate*24,rate),score=new Score(c,c.destination);
      events.forEach((cue,i)=>score.cue(cue,.25+i*2.75,i===3?1:0));
      const result=await c.startRendering();score.destroy();return Array.from(result.getChannelData(0));
    }
    const stats=(data:number[])=>{let peak=0,sum=0;for(const n of data){if(!Number.isFinite(n))throw Error('Nonfinite sample');peak=Math.max(peak,Math.abs(n));sum+=n*n;}return{peak,rms:Math.sqrt(sum/data.length)};};
    const before=await effects(Before),after=await effects(ForestScore),a=stats(before),b=stats(after);
    const targetRms=Math.min(.035,.8*a.rms/a.peak,.8*b.rms/b.peak);
    const equalBefore=before.map(n=>n*targetRms/a.rms),equalAfter=after.map(n=>n*targetRms/b.rms);
    const c=new OfflineAudioContext(2,rate*55,rate),score=new ForestScore(c,c.destination);
    for(let index=0;index*FOREST_MUSIC_STEP<51;index++)score.tick(index,.05+index*FOREST_MUSIC_STEP,index>=96);
    const music=await c.startRendering(),left=music.getChannelData(0),right=music.getChannelData(1);
    let stereoDifference=0;const mono=Array.from(left,(n,i)=>{stereoDifference+=Math.abs(n-right[i]);return(n+right[i])*.5;});
    const voicesBeforeDestroy=score.active;score.destroy();
    const cues=events.map((cue,i)=>({cue,...stats(after.slice(Math.floor((.25+i*2.75)*rate),Math.floor((.25+i*2.75+2.6)*rate)))}));
    const correlation=(i:number,j:number)=>{
      const at=(n:number)=>Math.floor((.25+n*2.75)*rate);let dot=0,aa=0,bb=0;
      for(let n=0;n<rate*.7;n++){const x=after[at(i)+n],y=after[at(j)+n];dot+=x*y;aa+=x*x;bb+=y*y;}
      return dot/Math.sqrt(aa*bb);
    };
    return{rate,before:equalBefore,after:equalAfter,music:mono,metrics:{originalBefore:a,originalAfter:b,comparisonBefore:stats(equalBefore),comparisonAfter:stats(equalAfter),targetRms,music:stats(mono),stereoDifference:stereoDifference/left.length,cues,pairCorrelation:{woodTurn:correlation(0,1),choiceBonus:correlation(4,5),winBig:correlation(6,7)},voicesBeforeDestroy,voicesAfterDestroy:score.active}};
  });
  expect(rendered.metrics.music.peak).toBeLessThan(.95);expect(rendered.metrics.music.rms).toBeGreaterThan(.003);
  expect(rendered.metrics.originalAfter.peak).toBeLessThan(.95);expect(rendered.metrics.voicesAfterDestroy).toBe(0);
  expect(rendered.metrics.stereoDifference).toBeGreaterThan(.0001);
  for(const cue of rendered.metrics.cues)expect(cue.rms).toBeGreaterThan(.001);
  for(const value of Object.values(rendered.metrics.pairCorrelation))expect(Math.abs(value)).toBeLessThan(.9);
  expect(Math.abs(rendered.metrics.comparisonBefore.rms-rendered.metrics.comparisonAfter.rms)).toBeLessThan(.00001);
  await mkdir(out,{recursive:true});
  await writeFile(out+'/audio-before.wav',wav(rendered.before,rendered.rate));await writeFile(out+'/audio-after.wav',wav(rendered.after,rendered.rate));await writeFile(out+'/music-preview.wav',wav(rendered.music,rendered.rate));
  await writeFile(out+'/palette-measurement.json',JSON.stringify({...rendered.metrics,scope:'Digital waveform checks and RMS-matched comparison, not a human listening study or physical loudness measurement.'},null,2));
});

test('turning music off preserves the effect and cancelling clears scheduled voices and room tails',async({page})=>{
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const path='/games/forest-heart/ForestScore.ts',{ForestScore}=await import(path),rate=22050;
    const c=new OfflineAudioContext(1,rate*4,rate),score=new ForestScore(c,c.destination);
    score.tick(0,.02,false);score.cue('big',.1);const before={music:score.activeMusic,effects:score.activeEffects};
    score.cancelMusic();const afterMusicOff={music:score.activeMusic,effects:score.activeEffects};
    const stopped=c.suspend(.7).then(async()=>{score.cancel();await c.resume();});
    const rendered=c.startRendering();await stopped;const data=(await rendered).getChannelData(0);
    const energy=(from:number,to:number)=>{let sum=0;for(let i=Math.floor(from*rate);i<Math.floor(to*rate);i++)sum+=data[i]*data[i];return Math.sqrt(sum/((to-from)*rate));};
    const afterCancel=score.active;score.destroy();return{before,afterMusicOff,afterCancel,effectRms:energy(.1,.6),cancelledTailRms:energy(.85,3.9)};
  });
  expect(result.before.music).toBeGreaterThan(0);expect(result.afterMusicOff.music).toBe(0);expect(result.afterMusicOff.effects).toBeGreaterThan(0);expect(result.effectRms).toBeGreaterThan(.005);expect(result.afterCancel).toBe(0);expect(result.cancelledTailRms).toBeLessThan(.00001);
});

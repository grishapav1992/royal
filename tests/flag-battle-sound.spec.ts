import {test,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const out='artifacts/work/flag-battle';
test('every Flag Battle cue renders with signal, clean tails, no clicks and headroom in a real Web Audio engine',async({page})=>{
  await mkdir(out,{recursive:true});
  await page.goto('/tests/fixtures/flag-audio.html');
  const metrics=await page.evaluate(async()=>{
    const path='/games/flag-battle/FlagBattleSound.ts',{FlagBattleSound}=await import(/* @vite-ignore */path);
    const cues=['select','start','collision','wall','eliminate','pulse','final-two','heartbeat','reveal','win','lose'];
    const rows:{cue:string;peak:number;rms:number;tail:number;maxStep:number;voices:number}[]=[];
    for(const cue of cues)for(const variant of cue==='eliminate'?[2,-1]:[2]){
      const context=new OfflineAudioContext(2,48000*1.6,48000);
      const audio=new FlagBattleSound({context:()=>context,output:()=>context.destination,allowed:()=>true,unlock:async()=>{},subscribe:()=>()=>{},now:()=>0});
      await audio.unlock();audio.playAt({cue,at:0,strength:1,pan:.35,variant},.05);
      const buffer=await context.startRendering();let peak=0,sum=0,tail=0,maxStep=0;
      for(const data of [buffer.getChannelData(0),buffer.getChannelData(1)])for(let i=0;i<data.length;i++){
        peak=Math.max(peak,Math.abs(data[i]));sum+=data[i]*data[i];if(i)maxStep=Math.max(maxStep,Math.abs(data[i]-data[i-1]));if(i>48000*1.3)tail=Math.max(tail,Math.abs(data[i]));
      }
      rows.push({cue:cue+(variant<0?'-own':''),peak,rms:Math.sqrt(sum/(2*buffer.length)),tail,maxStep,voices:audio.state().voices});audio.destroy();
    }
    return rows;
  });
  for(const m of metrics){expect(m.peak,m.cue).toBeGreaterThan(.01);expect(m.peak,m.cue).toBeLessThan(.18);expect(m.rms,m.cue).toBeGreaterThan(.0005);
    expect(m.tail,m.cue).toBeLessThan(.0001);expect(m.maxStep,m.cue).toBeLessThan(.025);expect(m.voices,m.cue).toBe(0);}
  await writeFile(out+'/battle-sound-metrics.json',JSON.stringify(metrics,null,2)+'\n');
});

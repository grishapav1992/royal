import {test,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const out='artifacts/work/flag-battle';
test('every synthesized cue renders with signal, clean tails and headroom in a real Web Audio engine',async({page})=>{
  await mkdir(out,{recursive:true});
  await page.goto('/tests/fixtures/flag-audio.html');
  const result=await page.evaluate(async()=>{
    const path='/games/flag-battle/FlagAudio.ts',{FlagAudio}=await import(/* @vite-ignore */path);
    const cues=['select','start','collision','wall','eliminate','final-two','win','lose'];
    const clips:Float32Array[][]=[],metrics:{cue:string;peak:number;rms:number;tail:number;voices:number}[]=[];
    for(const cue of cues){
      const context=new OfflineAudioContext(2,48000,48000);
      const audio=new FlagAudio({context:()=>context,output:()=>context.destination,allowed:()=>true,unlock:async()=>{},subscribe:()=>()=>{},now:()=>0});
      await audio.unlock();audio.playAt({cue,at:0,strength:.8,pan:.35,variant:2},.08);
      const buffer=await context.startRendering();let peak=0,sum=0,tail=0;
      const channels=[buffer.getChannelData(0),buffer.getChannelData(1)];
      for(const data of channels)for(let i=0;i<data.length;i++){peak=Math.max(peak,Math.abs(data[i]));sum+=data[i]*data[i];if(i>43200)tail=Math.max(tail,Math.abs(data[i]));}
      metrics.push({cue,peak,rms:Math.sqrt(sum/96000),tail,voices:audio.state().voices});clips.push(channels.map(c=>new Float32Array(c)));audio.destroy();
    }
    const frames=clips.length*48000,bytes=new Uint8Array(44+frames*4),view=new DataView(bytes.buffer);
    const label=(at:number,s:string)=>{for(let i=0;i<s.length;i++)view.setUint8(at+i,s.charCodeAt(i));};
    label(0,'RIFF');view.setUint32(4,bytes.length-8,true);label(8,'WAVE');label(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,2,true);view.setUint32(24,48000,true);view.setUint32(28,192000,true);view.setUint16(32,4,true);view.setUint16(34,16,true);label(36,'data');view.setUint32(40,frames*4,true);
    let offset=44;
    for(const channels of clips)for(let i=0;i<48000;i++)for(let channel=0;channel<2;channel++){view.setInt16(offset,Math.round(Math.max(-1,Math.min(1,channels[channel][i]))*32767),true);offset+=2;}
    let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
    return {metrics,wav:btoa(binary)};
  });
  for(const m of result.metrics){expect(m.peak,m.cue).toBeGreaterThan(.001);expect(m.peak,m.cue).toBeLessThan(.85);expect(m.rms,m.cue).toBeGreaterThan(.0001);expect(m.tail,m.cue).toBeLessThan(.0001);expect(m.voices,m.cue).toBe(0);}
  await writeFile(out+'/sound-preview.wav',Buffer.from(result.wav,'base64'));
  await writeFile(out+'/audio-render-metrics.json',JSON.stringify(result.metrics,null,2)+'\n');
});

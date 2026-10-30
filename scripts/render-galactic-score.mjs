/** Original deterministic ambient score. No recordings, external soundtrack or game RNG. */
import {writeFile,mkdir} from 'node:fs/promises';
const rate=44100,seconds=32,samples=rate*seconds,channels=2,pcm=Buffer.alloc(samples*channels*2);
const chords=[[146.832,174.614,220,293.665],[116.541,146.832,174.614,233.082],[130.813,164.814,196,261.626],[130.813,174.614,196,293.665]];
let peak=0,sum=0;
for(let i=0;i<samples;i++){
 const t=i/rate,segment=Math.floor(t/8),phase=t%8,envelope=Math.sin(Math.PI*phase/8)**.65,edge=Math.min(1,t/.5,(seconds-t)/.5),values=[];
 for(let ch=0;ch<2;ch++){
  let value=0;for(const [voice,hz]of chords[segment].entries()){
   const detune=1+(ch?1:-1)*.0009,drift=2*Math.sin(2*Math.PI*.09*t+voice)*.001;
   for(let harmonic=1;harmonic<=5;harmonic++)value+=Math.sin(2*Math.PI*hz*harmonic*detune*t+voice*.7+drift)/(harmonic**2.1)*.042;
  }
  value=(value*envelope+Math.sin(2*Math.PI*chords[segment][0]/2*t)*.027*Math.sin(Math.PI*phase/8)**2)*edge;
  value+=Math.sin(2*Math.PI*587.329*t+ch*.23)*.009*(.5+.5*Math.sin(2*Math.PI*t/16))*(1-envelope)*edge;
  value=Math.tanh(value*2.3)*.72;peak=Math.max(peak,Math.abs(value));sum+=value*value;values.push(value);
 }
 for(let ch=0;ch<2;ch++)pcm.writeInt16LE(Math.round(Math.max(-1,Math.min(1,values[ch]))*32767),(i*channels+ch)*2);
}
const header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(36+pcm.length,4);header.write('WAVE',8);header.write('fmt ',12);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(channels,22);header.writeUInt32LE(rate,24);header.writeUInt32LE(rate*channels*2,28);header.writeUInt16LE(channels*2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(pcm.length,40);
await mkdir(new URL('../public/assets/wild-nudge/',import.meta.url),{recursive:true});await writeFile(new URL('../public/assets/wild-nudge/score.wav',import.meta.url),Buffer.concat([header,pcm]));
console.log(JSON.stringify({original:true,seconds,rate,channels,peak,rms:Math.sqrt(sum/(samples*channels)),note:'Signal measurements do not establish subjective listening quality.'}));

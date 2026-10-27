/** Original deterministic PCM authoring, not a game outcome generator. */
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
export const rate=24000;
const specs={scrape:[.32,.018],stone:[.34,.012],step:[.22,.009],chest:[.58,.012],lever:[.64,.012],rope:[.65,.16],relic:[1.35,.018],neutral:[.32,.012],return:[.6,.012],win:[.95,.012],big:[1.8,.012],ambience:[8,0]};
export function synthesize(name){
  const [duration,accent]=specs[name],size=Math.ceil(duration*rate),channels=[new Float32Array(size),new Float32Array(size)];
  let seed=0x7f4a7c15+Object.keys(specs).indexOf(name)*613;
  const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/2147483648-1;};
  const add=(sample,at,pan=0)=>{if(at<0||at>=size)return;channels[0][at]+=sample*Math.sqrt((1-pan)/2);channels[1][at]+=sample*Math.sqrt((1+pan)/2);};
  const tone=(hz,start,length,level,decay=.12,pan=0,endHz=hz)=>{
    let phase=0;for(let i=0;i<length*rate;i++){const t=i/rate,f=hz+(endHz-hz)*Math.min(1,t/length);phase+=2*Math.PI*f/rate;
      const envelope=Math.min(1,t/.007)*Math.exp(-t/decay)*Math.min(1,(length-t)/.028);
      add((Math.sin(phase)+.12*Math.sin(phase*2.003))*level*envelope,Math.floor(start*rate)+i,pan);}
  };
  const noise=(start,length,level,cutoff,decay,pan=0,attack=.005)=>{
    let low=0;const alpha=1-Math.exp(-2*Math.PI*cutoff/rate);
    for(let i=0;i<length*rate;i++){const t=i/rate;low+=alpha*(random()-low);const envelope=Math.min(1,t/attack)*Math.exp(-t/decay)*Math.min(1,(length-t)/.025);add(low*level*envelope,Math.floor(start*rate)+i,pan);}
  };
  if(name==='scrape'){noise(0,.3,.22,650,.17,0,.018);noise(.02,.2,.06,1900,.1);}
  if(name==='stone'){noise(0,.31,.32,430,.1);tone(83,0,.32,.14,.09,0,46);noise(.012,.17,.055,2100,.06);}
  if(name==='step'){noise(0,.16,.13,1700,.043,-.12);tone(114,0,.17,.065,.045,0,72);tone(690,.024,.14,.025,.035,.18,480);}
  if(name==='chest'){for(const [hz,level,pan]of[[810,.065,-.2],[1411,.055,.2],[2029,.024,-.3],[3270,.013,.25]])tone(hz,0,.46,level,.14,pan);noise(0,.08,.08,2500,.025);}
  if(name==='lever'){for(let i=0;i<5;i++){noise(i*.067,.16,.13-i*.014,1150-i*140,.035,i%2?.2:-.2);tone(290+i*37,i*.067,.2,.033,.04);}tone(93,.035,.48,.055,.18,0,62);}
  if(name==='rope'){noise(0,.17,.12,1750,.3,-.25,.055);tone(245,.148,.4,.09,.1,.15,124);noise(.15,.11,.15,900,.032,.15);}
  if(name==='relic'){for(const [i,hz]of[146.83,220,293.66,440].entries())tone(hz,i*.13,1.05,.053,.35,i%2?.25:-.25);tone(880,.38,.7,.019,.22);}
  if(name==='neutral'){tone(86,0,.26,.052,.07,0,72);noise(0,.13,.025,500,.04);}
  if(name==='return'){tone(196,0,.53,.065,.16);tone(392,.006,.42,.016,.11);}
  if(name==='win'){for(const [i,hz]of[196,246.94,293.66].entries())tone(hz,i*.095,.68,.068,.22,(i-1)*.18);tone(587.33,.2,.5,.022,.16);}
  if(name==='big'){for(const [i,hz]of[196,293.66,392,493.88,587.33].entries())tone(hz,i*.11,1.12,.063,.32,(i-2)*.11);for(const hz of[146.83,196,246.94])tone(hz,.44,1.2,.027,.38);}
  if(name==='ambience'){
    let low=0;for(let i=0;i<size;i++){low+=.026*(random()-low);const t=i/rate,envelope=Math.min(1,t/.16,(duration-t)/.16);add(low*.19*envelope*(.85+.15*Math.sin(2*Math.PI*t/8)),i,Math.sin(t*.9)*.2);}
    for(let i=0;i<11;i++){const start=.38+i*.67,hz=620+(i*113)%470;tone(hz,start,.32,.014,.065,Math.sin(i)*.7,hz*.62);tone(hz*.55,start+.095,.4,.005,.1,-Math.sin(i)*.7);}
  }
  // Short stereo reflections, bounded and owned by the file rather than a global reverb tail.
  if(name!=='ambience')for(const channel of channels){for(let i=size-1;i>=0;i--){const delay=Math.floor(rate*.067);if(i>=delay)channel[i]+=channel[i-delay]*.17;}}
  for(const channel of channels)for(let i=0;i<size;i++)channel[i]*=Math.min(1,i/(rate*.002),(size-1-i)/(rate*.035));
  const target={scrape:.14,stone:.3,step:.14,chest:.24,lever:.22,rope:.2,relic:.26,neutral:.07,return:.14,win:.27,big:.3,ambience:.04}[name];
  const peak=metrics(channels).peak;for(const data of channels)for(let i=0;i<data.length;i++)data[i]*=target/peak;
  return {name,duration,accent,channels};
}
export function wav(channels){
  const samples=channels[0].length,buffer=Buffer.alloc(44+samples*4);buffer.write('RIFF');buffer.writeUInt32LE(buffer.length-8,4);buffer.write('WAVEfmt ',8);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(2,22);buffer.writeUInt32LE(rate,24);buffer.writeUInt32LE(rate*4,28);buffer.writeUInt16LE(4,32);buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(samples*4,40);
  for(let i=0;i<samples;i++)for(let c=0;c<2;c++)buffer.writeInt16LE(Math.round(Math.max(-1,Math.min(1,channels[c][i]))*32767),44+(i*2+c)*2);return buffer;
}
export function metrics(channels){let peak=0,sum=0;for(const data of channels)for(const value of data){peak=Math.max(peak,Math.abs(value));sum+=value*value;}return {peak,rms:Math.sqrt(sum/(channels[0].length*2))};}
export async function writePack(root=process.cwd()){
  const folder=resolve(root,'public/assets/flooded-temple/audio');await mkdir(folder,{recursive:true});const manifest={sampleRate:rate,format:'stereo PCM16',cues:{}};
  for(const name of Object.keys(specs)){const audio=synthesize(name);await writeFile(resolve(folder,name+'.wav'),wav(audio.channels));manifest.cues[name]={file:name+'.wav',duration:audio.duration,accent:audio.accent,...metrics(audio.channels)};}
  await writeFile(resolve(root,'games/flooded-temple/sounds.json'),JSON.stringify(manifest,null,2)+'\n');
  const demo=[new Float32Array(rate*12),new Float32Array(rate*12)];
  for(const [name,start,level]of[['ambience',0,.8],['stone',.4,.8],['step',1.1,1],['chest',1.7,1],['lever',2.5,1],['rope',3.5,1],['relic',4.35,1],['neutral',6,1],['return',6.65,1],['win',7.55,1],['big',9,1]]){
    const audio=synthesize(name);for(let c=0;c<2;c++)for(let i=0;i<audio.channels[c].length;i++){const at=Math.floor(start*rate)+i;if(at<demo[c].length)demo[c][at]+=audio.channels[c][i]*level;}
  }
  await writeFile(resolve(root,'docs/assets/flooded-temple/stage4-sound-preview.wav'),wav(demo));
  return manifest;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){const result=await writePack();console.log(JSON.stringify(result));}

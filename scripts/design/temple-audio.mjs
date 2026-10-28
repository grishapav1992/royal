/** Deterministic editing/mixing of licensed recordings. No oscillator music or synthetic Foley. */
import {readFileSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
export const rate=48000;
const specs={scrape:[.65,.02],stone:[.55,.012],step:[.4,.012],chest:[1.1,.025],lever:[1.15,.02],rope:[1,.27],relic:[2.1,.04],neutral:[.35,.015],return:[.6,.015],win:[1.25,.025],big:[2.2,.03],ambience:[8,0]};
const cache=new Map();
function recording(name){
 if(cache.has(name))return cache.get(name);
 const bytes=readFileSync(resolve('games/flooded-temple/assets/audio-source',name+'.wav'));let format,pcm;
 if(bytes.toString('ascii',0,4)!=='RIFF')throw Error('Not a PCM recording');
 for(let at=12;at+8<=bytes.length;){const id=bytes.toString('ascii',at,at+4),size=bytes.readUInt32LE(at+4);if(id==='fmt ')format=bytes.subarray(at+8,at+8+size);if(id==='data')pcm=bytes.subarray(at+8,at+8+size);at+=8+size+(size%2);}
 if(!format||!pcm||format.readUInt16LE(0)!==1||format.readUInt16LE(2)!==2||format.readUInt32LE(4)!==rate||format.readUInt16LE(14)!==16)throw Error('Expected prepared 48 kHz stereo PCM16: '+name);
 const channels=[new Float32Array(pcm.length/4),new Float32Array(pcm.length/4)];let peak=0;
 for(let i=0;i<channels[0].length;i++)for(let c=0;c<2;c++){const v=pcm.readInt16LE(i*4+c*2)/32768;channels[c][i]=v;peak=Math.max(peak,Math.abs(v));}
 if(peak<.00001)throw Error('Silent source '+name);
 for(const channel of channels)for(let i=0;i<channel.length;i++)channel[i]*=.7/peak;
 cache.set(name,channels);return channels;
}
export function renderCue(name){
 const [duration,accent]=specs[name],size=Math.ceil(duration*rate),channels=[new Float32Array(size),new Float32Array(size)];
 const layer=(source,start,length,level,speed=1,pan=0,offset=0)=>{
  const input=recording(source);
  for(let i=0;i<length*rate;i++){const at=Math.floor(start*rate)+i,position=offset*rate+i*speed;if(at<0||at>=size||position>=input[0].length-1)continue;
   const left=Math.floor(position),fraction=position-left,t=i/rate,fade=Math.max(0,Math.min(1,t/.006,(length-t)/.05));
   for(let c=0;c<2;c++){const balance=c===0?(pan>0?1-pan:1):(pan<0?1+pan:1);channels[c][at]+=(input[c][left]*(1-fraction)+input[c][left+1]*fraction)*level*fade*balance;}
  }
 };
 if(name==='scrape'){layer('stone',0,.62,.58,.87);layer('metal',.02,.3,.075,.8,-.15);}
 if(name==='stone'){layer('stone',0,.51,.55,1.25);layer('metal',.012,.3,.12,.7);}
 if(name==='step'){layer('step',0,.31,.68);layer('splash',.012,.36,.34,1.25,.12);}
 if(name==='chest'){layer('latch',0,.35,.35);layer('wood',.035,.83,.58,.8);layer('coins',.16,.65,.15,1,-.12);}
 if(name==='lever'){layer('latch',0,.32,.25);layer('chain',.012,.81,.53,1,-.12);layer('stone',.03,.94,.28,.76,.1);}
 if(name==='rope'){layer('rope',0,.91,.64,1,-.18);layer('latch',.26,.4,.32,.8,.15);}
 if(name==='relic'){layer('chimes',0,2.06,.51,.9,.12);layer('bell',.025,1.9,.13,.72,-.12);}
 if(name==='neutral'){layer('wood',0,.32,.28,.75);layer('step',0,.22,.16,.9);}
 if(name==='return'){layer('latch',0,.3,.2,.88);layer('coins',.015,.54,.25,.9);}
 if(name==='win'){layer('coins',.01,.82,.27);layer('chimes',.025,1.18,.39,1.05,.1);}
 if(name==='big'){layer('bell',0,2.12,.26,.9,-.12);layer('chimes',.03,2.13,.53,.92,.12);layer('coins',.17,1.0,.18);}
 if(name==='ambience')layer('ambience',0,8,1);
 if(name!=='ambience'){const dry=channels.map(c=>c.slice());for(let c=0;c<2;c++)for(const [delay,level]of[[.073,.10],[.137,.055],[.211,.025]])for(let i=Math.floor(rate*delay);i<size;i++)channels[c][i]+=dry[1-c][i-Math.floor(rate*delay)]*level;}
 for(const channel of channels)for(let i=0;i<size;i++)channel[i]*=Math.max(0,Math.min(1,i/(rate*.003),(size-1-i)/(rate*(name==='ambience'?.12:.06))));
 const target={scrape:.14,stone:.25,step:.14,chest:.24,lever:.22,rope:.2,relic:.26,neutral:.065,return:.13,win:.27,big:.3,ambience:.04}[name];
 const peak=metrics(channels).peak;if(peak<.000001)throw Error('Silent mix '+name);
 for(const data of channels)for(let i=0;i<data.length;i++)data[i]*=target/peak;
 return {name,duration,accent,channels};
}
export function wav(channels){
 const samples=channels[0].length,buffer=Buffer.alloc(44+samples*4);buffer.write('RIFF');buffer.writeUInt32LE(buffer.length-8,4);buffer.write('WAVEfmt ',8);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(2,22);buffer.writeUInt32LE(rate,24);buffer.writeUInt32LE(rate*4,28);buffer.writeUInt16LE(4,32);buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(samples*4,40);
 for(let i=0;i<samples;i++)for(let c=0;c<2;c++)buffer.writeInt16LE(Math.round(Math.max(-1,Math.min(1,channels[c][i]))*32767),44+(i*2+c)*2);return buffer;
}
export function metrics(channels){let peak=0,sum=0;for(const data of channels)for(const value of data){peak=Math.max(peak,Math.abs(value));sum+=value*value;}return {peak,rms:Math.sqrt(sum/(channels[0].length*2))};}
export async function writePack(root=process.cwd()){
 const folder=resolve(root,'public/assets/flooded-temple/audio');await mkdir(folder,{recursive:true});
 const manifest={sampleRate:rate,format:'stereo PCM16',source:'Licensed recordings; see assets/audio-source/sources.json',cues:{}};
 for(const name of Object.keys(specs)){const audio=renderCue(name);await writeFile(resolve(folder,name+'.wav'),wav(audio.channels));manifest.cues[name]={file:name+'.wav',duration:audio.duration,accent:audio.accent,...metrics(audio.channels)};}
 await writeFile(resolve(root,'games/flooded-temple/sounds.json'),JSON.stringify(manifest,null,2)+'\n');
 const demo=[new Float32Array(rate*16),new Float32Array(rate*16)];
 for(const [name,start,level]of[['ambience',0,.8],['stone',.4,.8],['step',1.2,1],['chest',1.9,1],['lever',3.2,1],['rope',4.6,1],['relic',5.9,1],['neutral',8.4,1],['return',9.2,1],['win',10.3,1],['big',12.2,1]]){
  const audio=renderCue(name);for(let c=0;c<2;c++)for(let i=0;i<audio.channels[c].length;i++){const at=Math.floor(start*rate)+i;if(at<demo[c].length)demo[c][at]+=audio.channels[c][i]*level;}
 }
 await writeFile(resolve(root,'docs/assets/flooded-temple/reference-sound-preview.wav'),wav(demo));return manifest;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){const result=await writePack();console.log(JSON.stringify(result));}

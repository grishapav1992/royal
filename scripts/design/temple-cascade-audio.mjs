/** New material cues mixed only from the existing licensed PCM recordings. */
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {recording,metrics,wav,rate} from './temple-audio.mjs';
export const cascadeCueSpecs={
 cascadeLandA:{duration:.62,peak:.19,window:[.055,.11]},cascadeLandB:{duration:.62,peak:.19,window:[.055,.11]},cascadeLandC:{duration:.62,peak:.19,window:[.055,.11]},
 cascadeBreakA:{duration:.58,peak:.16,window:[.015,.08]},cascadeBreakB:{duration:.58,peak:.16,window:[.015,.08]},
 cascadeBonus:{duration:1.65,peak:.24,window:[.12,.32]},cascadeReturn:{duration:.68,peak:.12,window:[.015,.08]},
};
export function renderCascadeCue(name){
 const spec=cascadeCueSpecs[name];if(!spec)throw Error('Unknown cascade cue');
 const size=Math.ceil(spec.duration*rate),channels=[new Float32Array(size),new Float32Array(size)];
 const layer=(source,start,length,level,speed=1,pan=0,offset=0)=>{
  const input=recording(source);
  for(let i=0;i<length*rate;i++){
   const at=Math.floor(start*rate)+i,position=offset*rate+i*speed;if(at>=size||position>=input[0].length-1)break;
   const left=Math.floor(position),fraction=position-left,t=i/rate,fade=Math.max(0,Math.min(1,t/.005,(length-t)/.06));
   for(let c=0;c<2;c++){const balance=c===0?(pan>0?1-pan:1):(pan<0?1+pan:1);channels[c][at]+=(input[c][left]*(1-fraction)+input[c][left+1]*fraction)*level*fade*balance;}
  }
 };
 if(name.startsWith('cascadeLand')){
  const variant=name.at(-1)==='A'?0:name.at(-1)==='B'?1:2;
  for(let i=0;i<5;i++){layer('step',i*.015,.17,.16+i*.025,1.08+variant*.05,(i-2)*.12,variant*.008);}
  layer('stone',.06,.4,.23,.96+variant*.07,0,.06+variant*.035);layer('splash',.06,.38,.1,1.1+variant*.07,.12);
 }else if(name.startsWith('cascadeBreak')){
  const variant=name.endsWith('A')?0:1;
  layer('stone',0,.44,.5,1.27+variant*.13,variant?.13:-.13,.21+variant*.08);
  layer('latch',.025,.24,.09,1.2);layer('splash',.035,.32,.1,1.5,-.1);
 }else if(name==='cascadeBonus'){
  layer('splash',0,.65,.16,.8,-.12);layer('chimes',.09,1.5,.5,.86,.1);layer('bell',.13,1.35,.14,.82,-.1);
 }else{
  layer('stone',0,.51,.25,.89,0,.12);layer('latch',.02,.26,.1,.85);layer('splash',.04,.45,.12,.9,-.1);
 }
 const dry=channels.map(c=>c.slice());
 for(let c=0;c<2;c++)for(const [delay,level]of[[.079,.075],[.151,.035]])for(let i=Math.floor(rate*delay);i<size;i++)channels[c][i]+=dry[1-c][i-Math.floor(rate*delay)]*level;
 for(const channel of channels)for(let i=0;i<size;i++)channel[i]*=Math.max(0,Math.min(1,i/(rate*.003),(size-1-i)/(rate*.065)));
 const peak=metrics(channels).peak;if(peak<.00001)throw Error('Silent cascade mix');for(const channel of channels)for(let i=0;i<size;i++)channel[i]*=spec.peak/peak;
 let accentSample=Math.floor(spec.window[0]*rate),accentPeak=0;
 for(let i=accentSample;i<spec.window[1]*rate;i++){const peak=Math.max(Math.abs(channels[0][i]),Math.abs(channels[1][i]));if(peak>accentPeak){accentPeak=peak;accentSample=i;}}
 return {name,duration:spec.duration,accent:accentSample/rate,channels};
}
export async function writeCascadePack(root=process.cwd()){
 const folder=resolve(root,'public/assets/flooded-temple/audio');await mkdir(folder,{recursive:true});
 const manifest={sampleRate:rate,format:'stereo PCM16',source:'Existing CC0 recordings in assets/audio-source/sources.json; no new external audio',cues:{}};
 for(const name of Object.keys(cascadeCueSpecs)){const audio=renderCascadeCue(name);await writeFile(resolve(folder,name+'.wav'),wav(audio.channels));manifest.cues[name]={file:name+'.wav',duration:audio.duration,accent:audio.accent,...metrics(audio.channels)};}
 await writeFile(resolve(root,'games/flooded-temple/cascadeSounds.json'),JSON.stringify(manifest,null,2)+'\n');
 const demo=[new Float32Array(rate*7),new Float32Array(rate*7)];
 for(const [name,start]of[['cascadeLandA',.2],['cascadeBreakA',1],['cascadeLandB',1.3],['cascadeBreakB',2.2],['cascadeLandC',2.5],['cascadeBonus',3.5],['cascadeReturn',5.3]]){
  const audio=renderCascadeCue(name);for(let c=0;c<2;c++)for(let i=0;i<audio.channels[c].length;i++){const at=Math.floor(start*rate)+i;if(at<demo[c].length)demo[c][at]+=audio.channels[c][i];}
 }
 const preview=resolve(root,'docs/assets/flooded-temple');await mkdir(preview,{recursive:true});await writeFile(resolve(preview,'cascade-foley-preview.wav'),wav(demo));
 return manifest;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)console.log(JSON.stringify(await writeCascadePack()));

import {readGameHost} from '../../src/modules/GameHostContract';
export type CaribbeanCue='click'|'stop'|'giant'|'cannon'|'line'|'bonus'|'loss'|'partial'|'return'|'win'|'bigwin';
const ids=['music','stop-a','stop-b','stop-c','click','latch','creak','coins','coins-small','cannon','thud','metal'] as const;
type Clip=typeof ids[number];
type Voice={source:AudioBufferSourceNode;gain:GainNode;music:boolean;at:number;end:number;offset:number};
type Graph={context:AudioContext;master:GainNode;music:GainNode;fx:GainNode};
type Manifest={format:1;files:Record<Clip,{file:string;accentOffsetSeconds:number}>};
const root='/assets/caribbean-treasures/audio/';
/** Recorded score and Foley use the host context, never a separate audio engine or wallet. */
export class CaribbeanAudio{
 private host=readGameHost().gameAudio;
 private voices=new Set<Voice>();private graph?:Graph;private musicVoice?:Voice;private musicOffset=0;
 private entered=false;private dead=false;private epoch=0;private music=true;
 private lifetime=new AbortController();private loading?:Promise<boolean>;private buffers=new Map<Clip,AudioBuffer>();private manifest?:Manifest;
 private loadError='';private unsubscribe:()=>void;private retiring=new Map<ReturnType<typeof setTimeout>,Graph>();
 private counts:Partial<Record<CaribbeanCue,number>>={};private samples:Partial<Record<Clip,number>>={};
 constructor(){
  try{this.music=localStorage.getItem('royal-caribbean-music')!=='0';}catch{}
  this.unsubscribe=this.host.onPreferences(()=>{if(!this.enabled())this.cancel();else this.startMusic();});
  void this.prepare();
 }
 private enabled(){const p=this.host.getPreferences();return !this.dead&&this.entered&&!document.hidden&&!p.muted&&p.volume>0&&this.host.context?.state==='running';}
 async prepare():Promise<boolean>{
  if(this.dead)return false;if(this.buffers.size===ids.length)return true;if(this.loading)return this.loading;
  const c=this.host.context;if(!c)return false;
  this.loading=(async()=>{
   const response=await fetch(root+'manifest.json',{signal:this.lifetime.signal});if(!response.ok)throw Error('Audio manifest unavailable');
   const manifest=await response.json() as Manifest;
   if(manifest.format!==1||!ids.every(id=>manifest.files[id]?.file===id+'.m4a'&&Number.isFinite(manifest.files[id].accentOffsetSeconds)))throw Error('Invalid audio manifest');
   const decoded=await Promise.all(ids.map(async id=>{const r=await fetch(root+manifest.files[id].file,{signal:this.lifetime.signal});if(!r.ok)throw Error('Audio sample unavailable: '+id);return[id,await c.decodeAudioData(await r.arrayBuffer())] as const;}));
   if(this.dead||c!==this.host.context)return false;
   this.manifest=manifest;this.buffers=new Map(decoded);this.loadError='';return true;
  })().catch(error=>{if(!this.dead)this.loadError=error instanceof Error?error.message:'Audio unavailable';return false;}).finally(()=>{this.loading=undefined;});
  return this.loading;
 }
 async enter(scheduleMusic=true){
  if(this.dead)return false;const epoch=++this.epoch;this.entered=true;await this.host.unlock();const ready=await this.prepare();
  if(epoch!==this.epoch||!this.enabled())return false;if(ready&&scheduleMusic)this.startMusic();return ready;
 }
 musicEnabled(){return this.music;}
 setMusic(value:boolean){
  this.music=value;try{localStorage.setItem('royal-caribbean-music',value?'1':'0');}catch{}
  const c=this.host.context;if(c&&this.graph){this.graph.music.gain.cancelScheduledValues(c.currentTime);this.graph.music.gain.setTargetAtTime(value ? .42 : 0,c.currentTime,.015);}
  if(!value)this.stopMusic();else this.startMusic();
 }
 private audioGraph(){
  const c=this.host.context,out=this.host.output;if(!c||!out||!this.enabled())return;
  if(this.graph?.context===c)return this.graph;
  if(this.graph)this.disconnect(this.graph);
  const master=c.createGain(),music=c.createGain(),fx=c.createGain();master.gain.value=.85;music.gain.value=this.music ? .42 : 0;fx.gain.value=.8;
  music.connect(master);fx.connect(master);master.connect(out);return this.graph={context:c,master,music,fx};
 }
 private play(id:Clip,at:number,level:number,music=false,offset=0){
  const buffer=this.buffers.get(id),g=this.audioGraph();if(!g||!buffer||!this.enabled()||[...this.voices].filter(v=>v.at<=at&&v.end>at).length>=24)return;
  const c=g.context,source=c.createBufferSource(),gain=c.createGain();source.buffer=buffer;source.loop=music;
  gain.gain.value=0;gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(level,at+(music?.18:.003));
  source.connect(gain);gain.connect(music?g.music:g.fx);
  const voice={source,gain,music,at,end:music?Infinity:at+buffer.duration,offset};this.voices.add(voice);
  source.onended=()=>{source.disconnect();gain.disconnect();this.voices.delete(voice);if(this.musicVoice===voice)this.musicVoice=undefined;};
  source.start(at,offset);if(!music)source.stop(at+buffer.duration+.01);
  this.samples[id]=(this.samples[id]??0)+1;return voice;
 }
 private startMusic(){
  if(!this.music||!this.enabled()||this.musicVoice||!this.buffers.has('music'))return;
  const at=this.host.context!.currentTime+.07,duration=this.buffers.get('music')!.duration;
  this.musicVoice=this.play('music',at,1,true,this.musicOffset%duration);
 }
 private stopMusic(){
  const c=this.host.context,v=this.musicVoice;if(!v)return;
  if(c&&c.currentTime>v.at)this.musicOffset=(v.offset+c.currentTime-v.at)%(v.source.buffer?.duration||1);
  this.musicVoice=undefined;this.stopVoice(v);
 }
 private duck(at:number,duration:number){
  const gain=this.graph?.music.gain;if(!gain||!this.music)return;
  gain.cancelScheduledValues(at);gain.setTargetAtTime(.10,at,.025);gain.setTargetAtTime(.42,at+duration,.18);
 }
 /** Timestamp includes the measured attack inside the selected recorded sample. */
 cue(kind:CaribbeanCue,variant=0){
  const c=this.host.context;if(!c||!this.enabled()||!this.manifest)return performance.now();
  const at=c.currentTime+.07;let primary:Clip;
  if(kind==='click'){primary='click';this.play(primary,at,.35);}
  else if(kind==='stop'){primary=(['stop-a','stop-b','stop-c'] as const)[variant%3];this.play(primary,at,.36);this.play('metal',at+.012,.045);}
  else if(kind==='giant'){primary='thud';this.play(primary,at,.5);this.play('creak',at+.025,.13);this.play('latch',at+.035,.12);this.duck(at,.5);}
  else if(kind==='cannon'){primary='cannon';this.play(primary,at,.8);this.duck(at,1.1);}
  else if(kind==='line'){primary='coins-small';this.play(primary,at,.2);}
  else if(kind==='bonus'){primary='latch';this.play(primary,at,.3);this.play('creak',at+.025,.2);this.play('coins-small',at+.12,.22);this.duck(at,.8);}
  else if(kind==='loss'||kind==='partial'){primary='stop-a';this.play(primary,at,.13);}
  else if(kind==='return'){primary='latch';this.play(primary,at,.15);}
  else{primary='coins';this.play(primary,at,kind==='bigwin'?.65:.42);this.play('creak',at,.14);if(kind==='bigwin')this.play('coins-small',at+.28,.32);this.duck(at,kind==='bigwin'?1.7:1.1);}
  this.counts[kind]=(this.counts[kind]??0)+1;
  const accent=at+this.manifest.files[primary].accentOffsetSeconds,stamp=c.getOutputTimestamp?.();
  const estimate=stamp&&typeof stamp.contextTime==='number'&&typeof stamp.performanceTime==='number'&&stamp.contextTime>0&&stamp.performanceTime>0?stamp.performanceTime+(accent-stamp.contextTime)*1000:performance.now()+(accent-c.currentTime+(c.outputLatency||c.baseLatency||0))*1000;
  return Math.max(performance.now(),Math.min(performance.now()+1000,estimate));
 }
 private stopVoice(v:Voice){const c=this.host.context;try{if(c?.state==='running'&&!document.hidden&&!this.dead){v.gain.gain.cancelScheduledValues(c.currentTime);v.gain.gain.setTargetAtTime(0,c.currentTime,.006);v.source.stop(c.currentTime+.04);}else{v.source.stop();v.source.disconnect();v.gain.disconnect();this.voices.delete(v);}}catch{v.source.disconnect();v.gain.disconnect();this.voices.delete(v);}}
 private disconnect(g:Graph){g.master.disconnect();g.music.disconnect();g.fx.disconnect();}
 cancel(){
  this.stopMusic();for(const v of this.voices)this.stopVoice(v);const g=this.graph,c=this.host.context;this.graph=undefined;
  if(g){if(c?.state==='running'&&!document.hidden&&!this.dead){g.master.gain.setTargetAtTime(0,c.currentTime,.006);const timer=setTimeout(()=>{this.disconnect(g);this.retiring.delete(timer);},80);this.retiring.set(timer,g);}else this.disconnect(g);}
 }
 pause(){this.epoch++;this.entered=false;this.cancel();}
 state(){return{activeSources:this.voices.size,music:!!this.musicVoice,musicEnabled:this.music,ready:this.buffers.size===ids.length,loadedClips:this.buffers.size,loadError:this.loadError,counts:{...this.counts},samples:{...this.samples},ownedGraphs:(this.graph?1:0)+this.retiring.size};}
 destroy(){this.dead=true;this.lifetime.abort();this.pause();for(const [timer,g] of this.retiring){clearTimeout(timer);this.disconnect(g);}this.retiring.clear();this.buffers.clear();this.unsubscribe();}
}

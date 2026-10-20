import {gameAudio} from '../game/GameAudio';

export const AFTER_VOICES=['laugh-1','laugh-2','laugh-3','laugh-4','unlock','win-1','win-2','win-3'] as const;
type Clip=typeof AFTER_VOICES[number];
type Reaction='win'|'bonus'|'unlock';
export function afterglowVoiceWin(state:string,spentUnits:string,returnedUnits:string){return state==='settled'&&BigInt(spentUnits)>0n&&BigInt(returnedUnits)>=BigInt(spentUnits)*5n;}
export interface AfterglowVoicePorts {
 context:()=>AudioContext|undefined;
 output:()=>GainNode|undefined;
 allowed:()=>boolean;
 unlock:()=>Promise<void>;
 subscribe:(listener:()=>void)=>()=>void;
 fetch:(url:string,options:RequestInit)=>Promise<Response>;
 now:()=>number;
 random:()=>number;
}
const browserPorts:AfterglowVoicePorts={
 context:()=>gameAudio.context,output:()=>gameAudio.output,
 allowed:()=>!document.hidden&&!gameAudio.getPreferences().muted&&gameAudio.getPreferences().volume>0&&gameAudio.context?.state==='running',
 unlock:()=>gameAudio.unlock(),subscribe:listener=>gameAudio.onPreferences(listener),
 fetch:(url,options)=>fetch(url,options),now:()=>performance.now(),random:()=>Math.random(),
};
/** Plays existing recordings as presentation only, without changing round timing or outcomes. */
export class AfterglowVoices extends EventTarget {
 private enabled=true;
 private level=.7;
 private entered=false;
 private destroyed=false;
 private generation=0;
 private buffers=new Map<Clip,AudioBuffer>();
 private loading?:Promise<void>;
 private requests=new Set<AbortController>();
 private active?:{source:AudioBufferSourceNode;gain:GainNode;clip:Clip};
 private observed?:AudioContext;
 private unsubscribe:()=>void;
 private lastReaction=-Infinity;
 private failures=0;
 private played:Record<string,number>={};
 private lastClip='';
 private contextChanged=()=>{if(this.observed?.state!=='running')this.stop();};
 constructor(private ports:AfterglowVoicePorts=browserPorts){
  super();
  try{this.enabled=localStorage.getItem('royal-afterglow-voices')!=='0';const value=localStorage.getItem('royal-afterglow-voice-volume');if(value!==null&&Number.isFinite(Number(value)))this.level=Math.max(0,Math.min(1,Number(value)));}catch{}
  this.unsubscribe=ports.subscribe(()=>{if(!this.allowed())this.stop();});
 }
 private changed(){this.dispatchEvent(new Event('change'));}
 private allowed(){return !this.destroyed&&this.entered&&this.enabled&&this.level>0&&this.ports.allowed();}
 private watchContext(){const context=this.ports.context();if(context!==this.observed){this.observed?.removeEventListener('statechange',this.contextChanged);this.observed=context;context?.addEventListener('statechange',this.contextChanged);}}
 async enter(){
  if(this.destroyed)return;this.entered=true;const generation=this.generation;
  try{await this.ports.unlock();}catch{return;}
  if(generation!==this.generation||!this.allowed())return;
  this.watchContext();void this.prepare();
 }
 private prepare(){
  if(this.destroyed)return Promise.resolve();if(this.loading)return this.loading;
  const context=this.ports.context();if(!context)return Promise.resolve();
  const missing=AFTER_VOICES.filter(name=>!this.buffers.has(name));if(!missing.length)return Promise.resolve();
  const task=Promise.all(missing.map(async name=>{
   const controller=new AbortController();this.requests.add(controller);const timeout=setTimeout(()=>controller.abort(),8000);
   try{
    const response=await this.ports.fetch(`/assets/afterglow/audio/${name.startsWith('win-')?'v2':'v1'}/${name}.mp3`,{signal:controller.signal});
    if(!response.ok)throw Error('Voice unavailable');const data=await response.arrayBuffer();
    if(this.destroyed||controller.signal.aborted)return;const buffer=await context.decodeAudioData(data);
    if(!this.destroyed&&!controller.signal.aborted)this.buffers.set(name,buffer);
   }catch{if(!this.destroyed)this.failures++;}
   finally{clearTimeout(timeout);this.requests.delete(controller);}
  })).then(()=>{}).finally(()=>{if(this.loading===task)this.loading=undefined;if(!this.destroyed)this.changed();});
  this.loading=task;this.changed();return task;
 }
 private nextClip(event:Reaction|'preview'){const ready=AFTER_VOICES.filter(name=>this.buffers.has(name)&&(event==='win'?name.startsWith('win-'):name.startsWith('laugh-'))),alternatives=ready.filter(name=>name!==this.lastClip),pool=alternatives.length?alternatives:ready,sample=this.ports.random();return pool.length?pool[Math.min(pool.length-1,Math.max(0,Math.floor((Number.isFinite(sample)?sample:0)*pool.length)))]:undefined;}
 private play(clip:Clip,event:Reaction|'preview'){
  const context=this.ports.context(),output=this.ports.output(),buffer=this.buffers.get(clip);
  if(!this.allowed()||!context||!output||!buffer||this.active)return false;
  const source=context.createBufferSource(),gain=context.createGain();source.buffer=buffer;gain.gain.value=this.level*.65;
  source.connect(gain);gain.connect(output);this.active={source,gain,clip};
  source.onended=()=>{source.disconnect();gain.disconnect();if(this.active?.source===source){this.active=undefined;this.changed();}};
  try{source.start();}catch{source.onended=null;source.disconnect();gain.disconnect();this.active=undefined;return false;}
  this.played[event]=(this.played[event]??0)+1;this.lastClip=clip;this.changed();return true;
 }
 reaction(event:Reaction){
  if(!this.allowed())return false;
  if(event==='unlock'){
   if(!this.buffers.has('unlock')||this.active?.clip.startsWith('win-'))return false;this.stop();return this.play('unlock',event);
  }
  if(event==='win'&&this.active&&!this.active.clip.startsWith('win-'))this.stop();
  if(this.active||this.ports.now()-this.lastReaction<6000&&event!=='win')return false;
  const clip=this.nextClip(event);if(!clip)return false;
  const played=this.play(clip,event);if(played)this.lastReaction=this.ports.now();return played;
 }
 async preview(){
  if(this.destroyed||!this.enabled||this.level===0)return false;
  const generation=this.generation;await this.enter();
  if(generation!==this.generation||!this.allowed())return false;
  await this.prepare();if(generation!==this.generation||!this.allowed()||this.active)return false;
  const clip=this.nextClip('preview');return clip?this.play(clip,'preview'):false;
 }
 setEnabled(value:boolean){this.enabled=value;try{localStorage.setItem('royal-afterglow-voices',value?'1':'0');}catch{}if(!value)this.stop();else if(this.entered)void this.enter();this.changed();}
 setLevel(value:number){
  if(!Number.isFinite(value))return;this.level=Math.max(0,Math.min(1,value));
  try{localStorage.setItem('royal-afterglow-voice-volume',String(this.level));}catch{}
  if(this.level===0)this.stop();else{if(this.active)this.active.gain.gain.setTargetAtTime(this.level*.65,this.ports.context()!.currentTime,.03);if(this.entered)void this.enter();}this.changed();
 }
 stop(){
  this.generation++;const active=this.active;this.active=undefined;
  if(active){active.source.onended=null;try{active.source.stop();}catch{}active.source.disconnect();active.gain.disconnect();}
  this.changed();
 }
 pause(){this.entered=false;this.stop();}
 state(){return{enabled:this.enabled,level:this.level,loading:!!this.loading,ready:this.buffers.size,total:AFTER_VOICES.length,activeSources:this.active?1:0,failures:this.failures,lastClip:this.lastClip,played:{...this.played}};}
 destroy(){if(this.destroyed)return;this.destroyed=true;this.pause();this.unsubscribe();this.observed?.removeEventListener('statechange',this.contextChanged);for(const request of this.requests)request.abort();this.buffers.clear();}
}

/** A cosmetic streak counts confirmed paid rounds, including a whole free-spin bonus once. */
export class AfterglowWinSeries {
 private last='';private streak=0;
 accept(session:{id:string;state:string;spentUnits:string;returnedUnits:string}){
  if(session.state!=='settled'||session.id===this.last)return false;
  this.last=session.id;this.streak=BigInt(session.returnedUnits)>BigInt(session.spentUnits)?this.streak+1:0;
  return afterglowVoiceWin(session.state,session.spentUnits,session.returnedUnits)||this.streak>=3;
 }
 reset(){this.last='';this.streak=0;}
}

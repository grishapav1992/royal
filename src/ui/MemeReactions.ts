import {gameAudio} from '../game/GameAudio';

export const MEME_CLIPS=['wow','nice','boom','error','bruh','bonus'] as const;
export type MemeClip=typeof MEME_CLIPS[number];
export const MEME_CLIP_LABELS:Record<MemeClip,string>={wow:'Anime Wow',nice:'Nice',boom:'Vine Boom',error:'Windows XP Error',bruh:'Bruh',bonus:'Taco Bell'};
type Reaction='win'|'large'|'system'|'bonus'|'reconnect'|'preview';
type Timer=ReturnType<typeof setTimeout>;
export interface MemeReactionPorts {
  context:()=>AudioContext|undefined;output:()=>GainNode|undefined;allowed:()=>boolean;
  unlock:()=>Promise<void>;subscribe:(listener:()=>void)=>()=>void;
  fetch:(url:string,options:RequestInit)=>Promise<Response>;now:()=>number;random:()=>number;
  later:(callback:()=>void,ms:number)=>Timer;clear:(timer:Timer)=>void;
}
const browser:MemeReactionPorts={context:()=>gameAudio.context,output:()=>gameAudio.output,
  allowed:()=>!document.hidden&&!gameAudio.getPreferences().muted&&gameAudio.getPreferences().volume>0&&gameAudio.context?.state==='running',
  unlock:()=>gameAudio.unlock(),subscribe:fn=>gameAudio.onPreferences(fn),fetch:(url,options)=>fetch(url,options),
  now:()=>performance.now(),random:()=>Math.random(),later:(fn,ms)=>setTimeout(fn,ms),clear:id=>clearTimeout(id)};
type Job={event:Reaction;clips:readonly MemeClip[];priority:number;key:string;expires:number;notBefore:number};
/** One voice, one replaceable pending reaction, no delayed backlog of old jokes. */
export class MemeReactions extends EventTarget {
  private enabled=true;private level=.65;private entered=false;private destroyed=false;private generation=0;private previewGeneration=0;
  private buffers=new Map<MemeClip,AudioBuffer>();private loading?:Promise<void>;private requests=new Set<AbortController>();
  private active?:{source:AudioBufferSourceNode;gain:GainNode;clip:MemeClip;event:Reaction};private pending?:Job;private timer?:Timer;private watchdog?:Timer;
  private lastStart=-Infinity;private lastEnd=-Infinity;private lastClip?:MemeClip;private playedAt=new Map<MemeClip,number>();
  private accepted=new Set<string>();private results=new Set<string>();private counts:Record<string,number>={};private failures=0;
  private unsubscribe:()=>void;private observed?:AudioContext;private roundKey='';
  private contextChanged=()=>{if(this.observed?.state!=='running')this.cancel();};
  constructor(private duck:(active:boolean)=>void=()=>{},private ports:MemeReactionPorts=browser){
    super();try{this.enabled=localStorage.getItem('royal-meme-reactions')!=='0';const n=localStorage.getItem('royal-meme-reaction-volume');if(n!==null&&Number.isFinite(Number(n)))this.level=Math.max(0,Math.min(1,Number(n)));}catch{}
    this.unsubscribe=ports.subscribe(()=>{if(!this.allowed())this.cancel();});
  }
  private changed(){if(!this.destroyed)this.dispatchEvent(new Event('change'));}
  private allowed(){return !this.destroyed&&this.entered&&this.enabled&&this.level>0&&this.ports.allowed();}
  private remember(set:Set<string>,key:string){set.add(key);if(set.size>128)set.delete(set.values().next().value!);}
  async enter(){
    if(this.destroyed)return;this.entered=true;const generation=this.generation;
    try{await this.ports.unlock();}catch{return;}
    if(generation!==this.generation||!this.allowed())return;
    const c=this.ports.context();if(c!==this.observed){this.observed?.removeEventListener('statechange',this.contextChanged);this.observed=c;c?.addEventListener('statechange',this.contextChanged);}
    void this.prepare();
  }
  private prepare(){
    if(this.destroyed)return Promise.resolve();if(this.loading)return this.loading;const context=this.ports.context();if(!context)return Promise.resolve();
    const missing=MEME_CLIPS.filter(clip=>!this.buffers.has(clip));if(!missing.length)return Promise.resolve();
    const task=Promise.all(missing.map(async clip=>{
      const controller=new AbortController();this.requests.add(controller);const timeout=setTimeout(()=>controller.abort(),8000);
      try{const r=await this.ports.fetch(`/assets/meme-overload/audio/v1/${clip}.mp3`,{signal:controller.signal});if(!r.ok)throw Error('Clip unavailable');const data=await r.arrayBuffer();if(this.destroyed||controller.signal.aborted)return;
        const buffer=await context.decodeAudioData(data);if(!this.destroyed&&!controller.signal.aborted&&Number.isFinite(buffer.duration)&&buffer.duration>0)this.buffers.set(clip,buffer);
      }catch{if(!this.destroyed)this.failures++;}finally{clearTimeout(timeout);this.requests.delete(controller);}
    })).then(()=>{}).finally(()=>{if(this.loading===task)this.loading=undefined;this.changed();});
    this.loading=task;this.changed();return task;
  }
  newRound(key:string){this.previewGeneration++;this.roundKey=key;this.clearPending();if(this.active?.event==='preview'){this.stopActive();this.changed();}}
  reconnect(){return this.request({event:'reconnect',clips:['bruh'],priority:40,key:this.roundKey+':reconnect'});}
  bonus(){return this.request({event:'bonus',clips:['bonus'],priority:80,key:this.roundKey+':bonus'});}
  result(session:{id:string;state:string;spentUnits:string;returnedUnits:string}){
    if(session.state!=='settled'||this.results.has(session.id))return false;this.remember(this.results,session.id);
    try{const stake=BigInt(session.spentUnits),paid=BigInt(session.returnedUnits);if(stake<=0n||paid<stake*5n)return false;
      const type=paid>=stake*100n?'system':paid>=stake*20n?'large':'win';
      return this.request({event:type,clips:type==='system'?['error','boom']:type==='large'?['boom','wow']:['wow','nice'],priority:type==='system'?110:type==='large'?100:90,key:session.id+':result'});
    }catch{return false;}
  }
  private request(value:Omit<Job,'expires'|'notBefore'>){
    if(!this.allowed()||this.accepted.has(value.key)||!value.clips.some(c=>this.buffers.has(c)))return false;
    this.remember(this.accepted,value.key);const now=this.ports.now();const job={...value,expires:now+2400,notBefore:now+160};
    if(this.pending&&this.pending.priority>job.priority)return false;this.pending=job;this.pump();this.changed();return true;
  }
  private clearTimer(){if(this.timer!==undefined){this.ports.clear(this.timer);this.timer=undefined;}}
  private clearPending(){this.clearTimer();this.pending=undefined;}
  private pump(){
    this.clearTimer();const job=this.pending;if(!job)return;if(!this.allowed()||job.expires<this.ports.now()){this.pending=undefined;this.changed();return;}if(this.active)return;
    const now=this.ports.now(),next=Math.max(job.notBefore,this.lastEnd+700,this.lastStart+(job.priority>=80?4000:9000));
    if(next>job.expires){this.pending=undefined;this.changed();return;}
    if(next>now){this.timer=this.ports.later(()=>{this.timer=undefined;this.pump();},next-now);return;}
    const ready=job.clips.filter(c=>this.buffers.has(c)&&now-(this.playedAt.get(c)??-Infinity)>=30000);
    const alternatives=ready.filter(c=>c!==this.lastClip),pool=alternatives.length?alternatives:ready;
    this.pending=undefined;if(!pool.length){this.changed();return;}
    const sample=this.ports.random(),index=job.event==='win'?Math.max(0,Math.min(pool.length-1,Math.floor((Number.isFinite(sample)?sample:0)*pool.length))):0;
    this.play(pool[index],job.event);
  }
  private play(clip:MemeClip,event:Reaction){
    const c=this.ports.context(),output=this.ports.output(),buffer=this.buffers.get(clip);if(!this.allowed()||this.active||!c||!output||!buffer)return false;
    const source=c.createBufferSource(),gain=c.createGain();source.buffer=buffer;gain.gain.value=this.level*.7;source.connect(gain);gain.connect(output);this.active={source,gain,clip,event};
    const ended=()=>{source.disconnect();gain.disconnect();if(this.active?.source!==source)return;this.active=undefined;if(this.watchdog!==undefined)this.ports.clear(this.watchdog);this.watchdog=undefined;this.lastEnd=this.ports.now();this.duck(false);this.changed();this.pump();};
    source.onended=ended;
    try{this.duck(true);source.start(c.currentTime,0,Math.min(buffer.duration,2.8));}catch{source.onended=null;ended();return false;}
    this.lastStart=this.ports.now();this.lastClip=clip;this.playedAt.set(clip,this.lastStart);this.counts[event]=(this.counts[event]??0)+1;this.counts['clip:'+clip]=(this.counts['clip:'+clip]??0)+1;
    this.watchdog=this.ports.later(()=>{this.watchdog=undefined;if(this.active?.source===source){try{source.stop();}catch{}ended();}},Math.min(buffer.duration,2.8)*1000+250);
    this.changed();return true;
  }
  async preview(clip:MemeClip){
    if(!MEME_CLIPS.includes(clip)||!this.enabled||this.level===0||this.destroyed)return false;const generation=this.generation,previewGeneration=++this.previewGeneration;
    await this.enter();if(generation!==this.generation||previewGeneration!==this.previewGeneration)return false;await this.prepare();if(generation!==this.generation||previewGeneration!==this.previewGeneration||!this.allowed())return false;
    this.clearPending();this.stopActive();return this.play(clip,'preview');
  }
  private stopActive(){
    const active=this.active;this.active=undefined;if(this.watchdog!==undefined)this.ports.clear(this.watchdog);this.watchdog=undefined;
    if(active){active.source.onended=null;try{active.source.stop();}catch{}active.source.disconnect();active.gain.disconnect();this.lastEnd=this.ports.now();}
    this.duck(false);
  }
  setEnabled(value:boolean){this.enabled=value;try{localStorage.setItem('royal-meme-reactions',value?'1':'0');}catch{}if(!value)this.cancel();else if(this.entered)void this.enter();this.changed();}
  setLevel(value:number){if(!Number.isFinite(value))return;this.level=Math.max(0,Math.min(1,value));try{localStorage.setItem('royal-meme-reaction-volume',String(this.level));}catch{}if(this.level===0)this.cancel();else if(this.active)this.active.gain.gain.setTargetAtTime(this.level*.7,this.ports.context()!.currentTime,.035);this.changed();}
  cancel(){this.generation++;this.previewGeneration++;this.clearPending();this.stopActive();this.changed();}
  pause(){this.entered=false;this.cancel();}
  state(){return{enabled:this.enabled,level:this.level,loading:!!this.loading,ready:this.buffers.size,total:MEME_CLIPS.length,activeSources:this.active?1:0,pending:this.pending?.event??null,lastClip:this.lastClip,failures:this.failures,played:{...this.counts}};}
  destroy(){if(this.destroyed)return;this.destroyed=true;this.pause();this.unsubscribe();this.observed?.removeEventListener('statechange',this.contextChanged);for(const r of this.requests)r.abort();this.buffers.clear();}
}

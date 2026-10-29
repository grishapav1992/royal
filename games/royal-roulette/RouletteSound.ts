import type {GameHostV1} from '../../src/modules/GameHostContract';
import {roulettePcm,type RouletteCue,type RouletteSample} from './RouletteAudioBank';
import {rouletteAudioTime,rouletteClock,rouletteContacts} from './RouletteSoundTimeline';
import type {LandingPlan,SpinPose} from './SpinTimeline';
type HostAudio=Pick<GameHostV1['gameAudio'],'context'|'output'|'unlock'|'getPreferences'|'onPreferences'>;
type Voice={source:AudioBufferSourceNode;gain:GainNode;pan:StereoPannerNode;cue:RouletteCue;at:number;loop:boolean;stopped:boolean;cleaned:boolean};

/** Uses the shared audio context/output. Every source and subscription has this owner. */
export class RouletteSound {
  private lifetime=new AbortController();
  private unsubscribe:()=>void;
  private context?:AudioContext;
  private master?:GainNode;
  private bank?:Record<RouletteCue,RouletteSample>;
  private buffers=new Map<RouletteCue,AudioBuffer>();
  private voices=new Set<Voice>();
  private loops:Voice[]=[];
  private epoch=0;
  private disposed=false;
  private armed=false;
  private sequence=0;
  private maxVoices=0;
  private skipped=0;
  private counts:Partial<Record<RouletteCue,number>>={};
  private log:{cue:string;target:number;audible:number;errorMs:number;method:string}[]=[];
  constructor(private host:HostAudio,private now=()=>performance.now()) {
    this.unsubscribe=host.onPreferences(()=>{if(!this.enabled())this.cancel();});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)this.cancel();},{signal:this.lifetime.signal});
    void this.warm();
  }
  private enabled(){const p=this.host.getPreferences();return !this.disposed&&!document.hidden&&!p.muted&&p.volume>0;}
  async warm(){
    if(!this.enabled())return false;
    const epoch=this.epoch;
    try{
      await this.host.unlock();
      if(epoch!==this.epoch||!this.enabled())return false;
      const c=this.host.context,out=this.host.output;if(!c||!out||c.state!=='running')return false;
      if(this.context!==c){
        this.clearGraph();this.context=c;this.master=c.createGain();this.master.gain.value=.8;this.master.connect(out);
        this.bank=roulettePcm(c.sampleRate);
        for(const [name,sample]of Object.entries(this.bank)){const buffer=c.createBuffer(1,sample.data.length,c.sampleRate);buffer.getChannelData(0).set(sample.data);this.buffers.set(name as RouletteCue,buffer);}
        c.addEventListener('statechange',()=>{if(c.state!=='running')this.cancel();},{signal:this.lifetime.signal});
      }
      return true;
    }catch{return false;}
  }
  private lead(){return this.host.context?rouletteClock(this.host.context,this.now()).leadMs:25;}
  private async event(action:()=>void,epoch=this.epoch,started=this.now()){
    if(await this.warm()&&epoch===this.epoch&&this.enabled()){
      if(this.now()-started>200){this.skipped++;return;}action();
    }
  }
  select(kind:'chip'|'bet',peak:number){
    if(!this.enabled())return peak;
    const target=Math.max(peak,this.now()+this.lead()+18),cue=kind==='chip'?(this.sequence++%2?'chip-alt':'chip'):'bet';
    void this.event(()=>this.cue(cue,target,kind==='chip'?.39:.32));return target;
  }
  begin(animate:boolean){
    if(!this.enabled())return this.now();
    const target=this.now()+(this.enabled()?this.lead()+18:0),epoch=this.epoch;
    this.armed=animate&&this.enabled();
    void this.event(()=>{
      this.cue('start',target+120,.19);
      if(this.armed){this.loops=[this.cue('wheel',target,0,0,true),this.cue('roll',target,0,0,true)].filter((v):v is Voice=>!!v);}
    },epoch);
    return target;
  }
  plan(plan:LandingPlan,performanceStart:number){
    if(!this.armed||!this.enabled()||!this.bank)return;
    for(const contact of rouletteContacts(plan))this.cue(contact.cue,performanceStart+contact.ms,contact.gain,contact.pan);
  }
  frame(pose:SpinPose){
    if(!this.armed||!this.enabled()||!this.context)return;
    const at=this.context.currentTime,w=Math.min(1,Math.max(0,pose.wheelVelocity/450)),relative=Math.min(1,Math.abs(pose.ballVelocity-pose.wheelVelocity)/1450);
    const falling=pose.phase==='drop'?Math.max(0,Math.min(1,(pose.radius-148)/39)):pose.phase==='pocket'||pose.phase==='idle'?0:1;
    for(const v of this.loops){
      if(v.stopped)continue;const ball=v.cue==='roll';v.gain.gain.setTargetAtTime(ball?.27*relative*falling:.2*w,at,.035);
      v.source.playbackRate.setTargetAtTime(ball?.65+.5*relative:.6+.5*w,at,.045);
      v.pan.pan.setTargetAtTime(ball?.28*Math.sin(pose.ball*Math.PI/180):0,at,.035);
    }
  }
  finish(){this.armed=false;for(const v of this.loops)this.stop(v,.08);this.loops=[];}
  result(multiplier:number,peak:number){
    if(!this.enabled())return peak;
    const cue=multiplier>=36?'straight':multiplier>1?'win':'settle',target=Math.max(peak,this.now()+this.lead()+18);
    void this.event(()=>this.cue(cue,target,multiplier>1?.43:.14));return target;
  }
  private cue(cue:RouletteCue,target:number,level:number,pan=0,loop=false){
    const c=this.context,sample=this.bank?.[cue],buffer=this.buffers.get(cue);
    if(!this.enabled()||!c||c.state!=='running'||!this.master||!sample||!buffer||this.voices.size>=24){this.skipped++;return;}
    const when=rouletteAudioTime(c,this.now(),target,loop?0:sample.peakSeconds);
    if(!loop&&when.errorMs>80){this.skipped++;return;}
    const source=c.createBufferSource(),gain=c.createGain(),stereo=c.createStereoPanner();source.buffer=buffer;source.loop=loop;
    if(loop){source.loopStart=sample.loopStart;source.loopEnd=buffer.duration;}
    gain.gain.value=level;stereo.pan.value=pan;source.connect(gain);gain.connect(stereo);stereo.connect(this.master);
    const voice:Voice={source,gain,pan:stereo,cue,at:when.at,loop,stopped:false,cleaned:false};this.voices.add(voice);this.maxVoices=Math.max(this.maxVoices,this.voices.size);
    this.counts[cue]=(this.counts[cue]??0)+1;
    if(!loop){this.log.push({cue,target,audible:when.audiblePeak,errorMs:when.errorMs,method:when.method});this.log=this.log.slice(-40);}
    source.onended=()=>this.clean(voice);source.start(when.at,loop?sample.loopStart:0);return voice;
  }
  private clean(v:Voice){
    if(v.cleaned)return;v.cleaned=true;v.source.onended=null;v.source.disconnect();v.gain.disconnect();v.pan.disconnect();this.voices.delete(v);
    if(this.disposed&&!this.voices.size)this.clearGraph();
  }
  private stop(v:Voice,fade=.012){
    const c=this.context;if(!c||v.cleaned)return;
    if(c.state!=='running'){try{v.source.stop(c.currentTime);}catch{}this.clean(v);return;}
    if(v.stopped)return;v.stopped=true;
    const at=c.currentTime,p=v.gain.gain;
    if(typeof p.cancelAndHoldAtTime==='function')p.cancelAndHoldAtTime(at);else{const value=p.value;p.cancelScheduledValues(at);p.setValueAtTime(value,at);}
    p.linearRampToValueAtTime(0,at+fade);try{v.source.stop(at+fade+.004);}catch{this.clean(v);}
  }
  cancel(){this.epoch++;this.armed=false;for(const v of this.voices)this.stop(v);this.loops=[];}
  private clearGraph(){this.master?.disconnect();this.master=undefined;this.bank=undefined;this.buffers.clear();this.context=undefined;}
  state(){const now=this.context?.currentTime??0;return{activeSources:this.voices.size,looping:[...this.voices].filter(v=>v.loop&&!v.stopped).length,futureCues:[...this.voices].filter(v=>!v.stopped&&v.at>now).length,graphOwners:this.master?1:0,sharedContext:!!this.context&&this.context===this.host.context,maxVoices:this.maxVoices,skipped:this.skipped,scheduled:{...this.counts},alignment:[...this.log],disposed:this.disposed};}
  destroy(){if(this.disposed)return;this.cancel();this.disposed=true;this.lifetime.abort();this.unsubscribe();if(!this.voices.size)this.clearGraph();}
}

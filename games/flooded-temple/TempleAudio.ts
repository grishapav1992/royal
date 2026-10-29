import type {GameHostV1} from '../../src/modules/GameHostContract';
import manifest from './sounds.json';
import cascadeManifest from './cascadeSounds.json';
import {readTempleClock,contextTimeForAccent} from './audioClock';
import {TempleMusic} from './TempleMusic';
export type TempleCue=Exclude<keyof typeof manifest.cues,'ambience'>|keyof typeof cascadeManifest.cues;
type CueSpec={file:string;duration:number;accent:number;peak:number;rms:number};
type Voice={source:AudioBufferSourceNode;gain:GainNode;end:()=>void};
export type TempleAudioAnchor={cue:TempleCue;targetPerformanceTime:number;startContextTime:number|null;method:string;latencyMs:number;state:'scheduled'|'silent'|'late'};
const bytes=new Map<string,Promise<ArrayBuffer>>();
const loadBytes=(url:string)=>{if(!bytes.has(url))bytes.set(url,fetch(url).then(r=>{if(!r.ok)throw Error('Temple audio unavailable');return r.arrayBuffer();}).catch(error=>{bytes.delete(url);throw error;}));return bytes.get(url)!;};
export class TempleAudio{
  private buffers=new Map<string,AudioBuffer>();
  private cues:Record<string,CueSpec>;
  private voices=new Set<Voice>();
  private releasing=new Set<Voice>();
  private loop?:Voice;
  private master?:GainNode;
  private loopGain?:GainNode;
  private context?:AudioContext;
  private dead=false;
  private allowed=true;
  private accountActive=false;
  private loading?:Promise<void>;
  private anchors:TempleAudioAnchor[]=[];
  private played:Partial<Record<TempleCue,number>>={};
  private canceled=0;
  private unsubscribe:()=>void;
  private music:TempleMusic;
  constructor(private host:GameHostV1['gameAudio'],private doc:Document,cascades=false){
    this.cues=cascades?{ambience:manifest.cues.ambience,neutral:manifest.cues.neutral,return:manifest.cues.return,win:manifest.cues.win,big:manifest.cues.big,...cascadeManifest.cues}:manifest.cues;
    this.music=new TempleMusic(doc,()=>this.enabled());
    this.unsubscribe=host.onPreferences(p=>{if(p.muted||p.volume===0)this.cancel();else this.ambience();});
    for(const spec of Object.values(this.cues)){void loadBytes('/assets/flooded-temple/audio/'+spec.file).catch(()=>{});}
  }
  private enabled(){const p=this.host.getPreferences();return !this.dead&&this.allowed&&this.accountActive&&!this.doc.hidden&&!p.muted&&p.volume>0&&this.host.context?.state==='running';}
  async gesture(){
    if(this.dead)return;
    await this.host.unlock();const context=this.host.context,output=this.host.output;
    if(!context||!output||this.dead)return;
    if(this.context!==context){this.cancel(false);this.context?.removeEventListener('statechange',this.contextChanged);this.context=context;this.master?.disconnect();this.master=context.createGain();this.master.gain.value=.9;this.master.connect(output);this.loopGain=context.createGain();this.loopGain.gain.value=.24;this.loopGain.connect(this.master);this.music.attach(context,this.master);context.addEventListener('statechange',this.contextChanged);}
    this.music.gesture();
    if(!this.loading)this.loading=Promise.all(Object.keys(this.cues).filter(key=>!this.buffers.has(key)).map(async key=>{
      const url='/assets/flooded-temple/audio/'+this.cues[key].file;
      try{const data=await loadBytes(url);const buffer=await context.decodeAudioData(data.slice(0));if(!this.dead)this.buffers.set(key,buffer);}catch{/* A later gesture retries missing resources; no past cue is queued. */}
    })).then(()=>{}).finally(()=>{this.loading=undefined;});
    await this.loading;this.ambience();
  }
  private contextChanged=()=>{if(this.context?.state!=='running')this.cancel();else this.ambience();};
  // The context belongs to the host window. Use its performance origin, not the iframe's.
  clock(){return readTempleClock(this.host.context,performance.now());}
  get audible(){return this.enabled();}
  lead(cues?:TempleCue[]){const latency=this.clock().latencyMs,specs=cues?.length?cues.map(key=>this.cues[key]).filter(Boolean):Object.values(this.cues);return Math.min(1100,Math.max(220,latency+200,Math.max(0,...specs.map(c=>c.accent))*1000+latency+60));}
  schedule(cue:TempleCue,targetPerformanceTime:number):TempleAudioAnchor{
    const now=performance.now(),clock=readTempleClock(this.host.context,now),c=this.context;
    const spec=this.cues[cue];let start=c&&spec?contextTimeForAccent(clock,targetPerformanceTime,spec.accent):NaN;
    const state=!this.enabled()||!c||!this.master||!this.buffers.has(cue)||this.voices.size+this.releasing.size+(this.music.playing?1:0)>=10?'silent':start<c.currentTime+.002?'late':'scheduled';
    const anchor:TempleAudioAnchor={cue,targetPerformanceTime,startContextTime:state==='scheduled'?start:null,method:clock.method,latencyMs:clock.latencyMs,state};
    this.anchors.push(anchor);if(this.anchors.length>120)this.anchors.shift();
    if(state==='scheduled'){
      this.voice(this.buffers.get(cue)!,start,this.master!,false,1);this.played[cue]=(this.played[cue]??0)+1;
    }
    return anchor;
  }
  oneShot(cue:TempleCue){this.schedule(cue,performance.now()+this.lead());}
  private voice(buffer:AudioBuffer,start:number,output:AudioNode,loop:boolean,level:number):Voice{
    const c=this.context!,source=c.createBufferSource(),gain=c.createGain();source.buffer=buffer;source.loop=loop;gain.gain.value=level;source.connect(gain);gain.connect(output);
    let ended=false;const voice:Voice={source,gain,end:()=>{if(ended)return;ended=true;source.disconnect();gain.disconnect();this.voices.delete(voice);this.releasing.delete(voice);if(this.loop===voice)this.loop=undefined;this.releaseMaster();}};
    this.voices.add(voice);source.onended=voice.end;source.start(start);return voice;
  }
  ambience(){this.music.sync();if(!this.enabled()||this.loop||!this.context||!this.loopGain||!this.buffers.has('ambience')||this.voices.size+this.releasing.size+(this.music.playing?1:0)>=10)return;this.loop=this.voice(this.buffers.get('ambience')!,this.context.currentTime,this.loopGain,true,1);}
  duck(active:boolean){this.music.duck(active);if(this.context&&this.loopGain)this.loopGain.gain.setTargetAtTime(active?.065:.24,this.context.currentTime,.07);}
  setAllowed(value:boolean){this.allowed=value;if(!value)this.cancel();else this.ambience();}
  setAccountActive(value:boolean){if(this.accountActive===value)return;this.accountActive=value;if(!value)this.cancel();else this.ambience();}
  cancel(fade=true){this.music.pause();this.cancelVoices(fade,false);}
  cancelEffects(){this.cancelVoices(true,true);}
  private cancelVoices(fade:boolean,keepBed:boolean){this.canceled++;for(const v of new Set([...this.voices,...this.releasing])){
    if(keepBed&&v===this.loop)continue;
    if(fade&&this.context?.state==='running'){
      if(this.releasing.has(v))continue;this.voices.delete(v);this.releasing.add(v);const at=this.context.currentTime;
      v.gain.gain.cancelScheduledValues(at);v.gain.gain.setValueAtTime(v.gain.gain.value,at);v.gain.gain.linearRampToValueAtTime(0,at+.012);try{v.source.stop(at+.013);}catch{v.end();}
    }else{try{v.source.stop();}catch{}v.end();}
  }if(!keepBed)this.loop=undefined;if(keepBed)this.music.duck(false);if(this.context&&this.loopGain)this.loopGain.gain.setTargetAtTime(.24,this.context.currentTime,.07);}
  private releaseMaster(){if(this.dead&&!this.voices.size&&!this.releasing.size){this.loopGain?.disconnect();this.master?.disconnect();}}
  getState(){return {ready:this.buffers.size===Object.keys(this.cues).length,activeSources:this.voices.size+this.releasing.size+(this.music.playing?1:0),releasingSources:this.releasing.size,looping:!!this.loop,music:this.music.getState(),played:{...this.played},canceled:this.canceled,clock:this.clock(),anchors:this.anchors.slice(-24),disposed:this.dead};}
  destroy(){if(this.dead)return;this.dead=true;this.unsubscribe();this.music.destroy();this.cancel();this.context?.removeEventListener('statechange',this.contextChanged);this.buffers.clear();this.releaseMaster();}
}

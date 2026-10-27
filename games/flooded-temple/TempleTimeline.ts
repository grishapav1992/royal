import type {TempleAudio} from './TempleAudio';
import type {TempleBeat,TemplePlan} from './presentation';
export class TempleTimeline{
  private plan?:TemplePlan;
  private startAt=0;
  private pausedAt=0;
  private elapsed=0;
  private handle=0;
  private index=-1;
  private cues=new Set<number>();
  private accents=new Set<number>();
  private observed=new Set<number>();
  private seen=new Set<string>();
  private diagnostics:{kind:string;planned:number;shown:number|null;skewMs:number|null;rendered:boolean}[]=[];
  private pauses=new Set<string>();
  constructor(private audio:TempleAudio,private show:(beat:TempleBeat|undefined)=>void,private tickView:(beat:TempleBeat,elapsed:number)=>void){}
  get active(){return !!this.plan;}
  get paused(){return this.pauses.size>0;}
  get beat(){return this.plan?.beats[this.index];}
  get reduced(){return this.plan?.reduced??false;}
  get offset(){return this.beat?Math.max(0,this.elapsed-this.beat.at):0;}
  start(plan:TemplePlan){
    if(this.seen.has(plan.key))return false;this.seen.add(plan.key);if(this.seen.size>100)this.seen.delete(this.seen.values().next().value!);
    this.cancel();this.audio.ambience();this.plan=plan;this.startAt=performance.now()+this.audio.lead();this.elapsed=0;this.index=0;this.cues.clear();this.accents.clear();this.observed.clear();this.observed.add(0);this.show(plan.beats[0]);
    if(this.pauses.size)this.pausedAt=performance.now();else this.handle=requestAnimationFrame(this.tick);return true;
  }
  private tick=()=>{
    const plan=this.plan;if(!plan||this.pauses.size)return;
    const now=performance.now();this.elapsed=Math.max(0,now-this.startAt);
    for(const beat of plan.beats){const target=this.startAt+beat.at+(beat.cueAtMs??0);if(beat.cue&&!this.cues.has(beat.id)&&target-now<=Math.max(320,this.audio.lead())&&target>=now-30){this.cues.add(beat.id);this.audio.schedule(beat.cue,target);}}
    let next=0;for(let i=0;i<plan.beats.length;i++)if(plan.beats[i].at<=this.elapsed)next=i;
    if(next!==this.index){this.index=next;this.observed.add(next);const beat=plan.beats[next];this.audio.duck(['gate','relic','outcome'].includes(beat.kind));this.show(beat);}
    this.tickView(plan.beats[this.index],Math.max(0,this.elapsed-plan.beats[this.index].at));
    for(const beat of plan.beats){const planned=this.startAt+beat.at+(beat.cueAtMs??0);if(beat.cue&&!this.accents.has(beat.id)&&planned<=now){this.accents.add(beat.id);const rendered=this.observed.has(beat.id);this.diagnostics.push({kind:beat.kind,planned,shown:rendered?now:null,skewMs:rendered?now-planned:null,rendered});if(this.diagnostics.length>100)this.diagnostics.shift();}}
    if(this.elapsed>=plan.duration){this.complete(false);return;}
    this.handle=requestAnimationFrame(this.tick);
  };
  pause(reason:string){if(this.pauses.has(reason))return;this.pauses.add(reason);if(this.pauses.size===1){this.pausedAt=performance.now();cancelAnimationFrame(this.handle);this.audio.setAllowed(false);}}
  resume(reason:string){if(!this.pauses.delete(reason)||this.pauses.size)return;this.audio.setAllowed(true);if(this.plan){this.startAt+=performance.now()-this.pausedAt;this.handle=requestAnimationFrame(this.tick);}}
  complete(skipped=true){if(!this.plan)return;cancelAnimationFrame(this.handle);this.plan=undefined;this.index=-1;if(skipped)this.audio.cancel();this.audio.duck(false);if(!this.pauses.size)this.audio.ambience();this.show(undefined);}
  cancel(){cancelAnimationFrame(this.handle);this.plan=undefined;this.index=-1;this.audio.cancel();}
  getState(){return {active:this.active,paused:this.pauses.size>0,reasons:[...this.pauses],key:this.plan?.key??null,event:this.beat?.kind??null,offsetMs:this.offset,reduced:this.reduced,frames:this.diagnostics.slice(-24),audio:this.audio.getState()};}
  destroy(){this.cancel();this.pauses.clear();this.audio.destroy();}
}

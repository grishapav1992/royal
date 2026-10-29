import type {TempleAudio} from './TempleAudio';
import type {CascadeBeat,CascadePlan} from './cascadePresentation';

/** One performance clock owns board motion, character gestures and audible accents. */
export class CascadeTimeline{
  private plan?:CascadePlan;
  private index=0;
  private startAt=0;
  private elapsed=0;
  private handle=0;
  private seen=new Set<string>();
  private scheduled=new Set<number>();
  private accents=new Set<number>();
  private history:{key:string;kind:string;fall:number;id:number}[]=[];
  private diagnostics:{kind:string;fall:number;planned:number;shown:number;skewMs:number}[]=[];
  private stalls=0;
  constructor(private audio:TempleAudio,private show:(beat:CascadeBeat|undefined)=>void,private paint:(beat:CascadeBeat,elapsed:number)=>void){}
  get active(){return !!this.plan;}
  get remainingFrames(){return this.plan?.beats.slice(this.index+1).filter(b=>b.kind==='drop').length??0;}
  get beat(){return this.plan?.beats[this.index];}
  get offset(){return this.beat?Math.max(0,this.elapsed-this.beat.at):0;}
  start(plan:CascadePlan){
    if(this.seen.has(plan.key))return false;
    this.cancel();this.seen.add(plan.key);if(this.seen.size>100)this.seen.delete(this.seen.values().next().value!);
    this.plan=plan;this.index=0;this.elapsed=0;this.scheduled.clear();this.accents.clear();
    const cues=plan.beats.flatMap(b=>b.cue?[b.cue]:[]);
    this.startAt=performance.now()+(this.audio.audible?this.audio.lead(cues):0);this.enter(plan.beats[0]);this.handle=requestAnimationFrame(this.tick);return true;
  }
  private enter(beat:CascadeBeat){
    this.history.push({key:this.plan!.key,kind:beat.kind,fall:beat.frame.fall,id:beat.id});if(this.history.length>120)this.history.shift();
    this.audio.duck(beat.kind==='bonus'||beat.kind==='outcome'&&['win','big'].includes(beat.outcome??''));this.show(beat);this.paint(beat,0);
  }
  private tick=()=>{
    this.handle=0;const plan=this.plan;if(!plan)return;
    const now=performance.now();this.elapsed=Math.max(0,now-this.startAt);
    let beat=plan.beats[this.index];
    if(this.elapsed>=beat.at+beat.duration){
      // Keep every confirmed frame visible. A stalled main thread stretches later beats.
      if(this.elapsed-(beat.at+beat.duration)>100){this.startAt+=this.elapsed-(beat.at+beat.duration);this.elapsed=beat.at+beat.duration;this.stalls++;this.audio.cancelEffects();}
      this.paint(beat,beat.duration);
      if(++this.index===plan.beats.length){this.plan=undefined;this.audio.duck(false);this.show(undefined);return;}
      beat=plan.beats[this.index];this.enter(beat);
    }
    const horizon=this.audio.lead(plan.beats.flatMap(b=>b.cue?[b.cue]:[]))+80;
    // At most the current and next beat can own a scheduled sound.
    for(const candidate of plan.beats.slice(this.index,this.index+2)){
      if(!candidate.cue||this.scheduled.has(candidate.id))continue;
      const target=this.startAt+candidate.at+candidate.accentMs;
      if(target-now<=horizon){this.scheduled.add(candidate.id);if(target>=now-20)this.audio.schedule(candidate.cue,target);}
    }
    const offset=Math.max(0,this.elapsed-beat.at);this.paint(beat,offset);
    const planned=this.startAt+beat.at+beat.accentMs;
    if(beat.cue&&!this.accents.has(beat.id)&&planned<=now){this.accents.add(beat.id);this.diagnostics.push({kind:beat.kind,fall:beat.frame.fall,planned,shown:now,skewMs:now-planned});if(this.diagnostics.length>80)this.diagnostics.shift();}
    this.handle=requestAnimationFrame(this.tick);
  };
  cancel(){cancelAnimationFrame(this.handle);this.handle=0;this.plan=undefined;this.audio.cancelEffects();this.audio.duck(false);}
  getState(){return {active:this.active,event:this.beat?.kind??null,offsetMs:this.offset,framePending:!!this.handle,stalls:this.stalls,frames:this.history.slice(-100),accents:this.diagnostics.slice(-40)};}
  destroy(){this.cancel();this.seen.clear();}
}

import { gameAudio } from '../../src/game/GameAudio';
import {fightSound,type FightSound} from './JackieFightSounds';

import { contactAt, chairReleaseAt, resultAt, impacts } from './JackieChoreography';
import {FIGHT_PLANS,type FightPlan} from './JackieFightPlans';
import {JackieMusic} from './JackieMusic';
export { contactAt, resultAt } from './JackieChoreography';
export class JackieAudio {
  enabled = true;
  private sources = new Set<AudioScheduledSourceNode>();
  private disposed = false;
  private buffers = new Map<string,AudioBuffer>();
  private variation = 0;
  private resumeListener?:()=>void;
  private needsResume=false;
  private preferred=true;
  private context?:AudioContext;
  readonly music=new JackieMusic(document,()=>{const p=gameAudio.getPreferences();return !this.disposed&&!p.muted&&p.volume>0;});
  private onContextState=()=>{if(this.context?.state!=='running'){this.needsResume=true;this.cancel();}else this.resumeIfNeeded();};
  private unsubscribe = gameAudio.onPreferences(p => {
    const available=!p.muted&&p.volume>0,changed=available&&!this.preferred;this.preferred=available;
    if(!available){this.needsResume=true;this.cancel();}
    else if(changed&&this.enabled)void this.unlock();
    this.music.sync();
  });
  constructor(){try{this.enabled=localStorage.getItem('royal-kungfu-sound')!=='0';}catch{}}
  onResume(listener:()=>void){this.resumeListener=listener;return()=>{if(this.resumeListener===listener)this.resumeListener=undefined;};}
  private watchContext(){
    if(this.context===gameAudio.context)return;
    this.context?.removeEventListener('statechange',this.onContextState);this.context=gameAudio.context;
    this.context?.addEventListener('statechange',this.onContextState);
  }
  private resumeIfNeeded(){if(this.needsResume&&this.allowed()){this.needsResume=false;this.resumeListener?.();}}
  prime(){if(gameAudio.context?.state==='running')void this.unlock();}
  async unlock() { if (!this.disposed && (this.enabled||this.music.enabled)){await gameAudio.unlock();if(this.disposed)return;this.watchContext();if(gameAudio.context&&gameAudio.output){this.music.attach(gameAudio.context,gameAudio.output);this.music.gesture();}this.resumeIfNeeded();} }
  private allowed() { const p = gameAudio.getPreferences(); return !this.disposed && this.enabled && !p.muted && p.volume > 0 && !document.hidden && gameAudio.context?.state === 'running' && !!gameAudio.output; }
  private tone(at: number, frequency: number, duration: number, level: number, type: OscillatorType = 'sine') {
    if (!this.allowed()) return;
    const c = gameAudio.context!, source = c.createOscillator(), gain = c.createGain();
    source.type = type; source.frequency.setValueAtTime(frequency, at); source.frequency.exponentialRampToValueAtTime(Math.max(45, frequency * .65), at + duration);
    gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(level, at + .008); gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
    source.connect(gain); gain.connect(gameAudio.output!); this.sources.add(source);
    source.onended = () => { this.sources.delete(source); source.disconnect(); gain.disconnect(); };
    source.start(at); source.stop(at + duration + .01);
  }
  private sound(at:number,cue:FightSound,variation=0,level=1){
    if(!this.allowed())return;
    const context=gameAudio.context!,key=cue+':'+variation%4+':'+context.sampleRate;
    let buffer=this.buffers.get(key);
    if(!buffer){const samples=fightSound(cue,context.sampleRate,variation);buffer=context.createBuffer(1,samples.length,context.sampleRate);buffer.getChannelData(0).set(samples);this.buffers.set(key,buffer);}
    const source=context.createBufferSource(),gain=context.createGain();source.buffer=buffer;gain.gain.value=level;source.connect(gain);gain.connect(gameAudio.output!);this.sources.add(source);
    source.onended=()=>{this.sources.delete(source);source.disconnect();gain.disconnect();};source.start(at);
  }
  /** Visuals follow estimated audible time, including the shared output latency. */
  private audible(at: number) {
    const c = gameAudio.context!; const stamp = c.getOutputTimestamp?.();
    const now=performance.now(),estimated=stamp?.performanceTime&&stamp.contextTime?stamp.performanceTime+(at-stamp.contextTime)*1000:0;
    return estimated>=now?estimated:now+(at-c.currentTime+(c.outputLatency||c.baseLatency||0))*1000;
  }
  begin(count: number, success: boolean, paid: boolean,plan:FightPlan=FIGHT_PLANS[0],speed:1|2=1,from=0) {
    this.cancel();this.watchContext();
    if (!this.allowed()){this.needsResume=true;return performance.now();}
    this.needsResume=false;
    const at = gameAudio.context!.currentTime + .06;
    this.variation=(this.variation+1)%4;
    const when=(time:number)=>at+(time-from)/speed;
    const cue=(time:number,kind:FightSound,variant=this.variation,level=1)=>{if(time>=from+.001)this.sound(when(time),kind,variant,level*.9*(speed===2?.84:1));};
    const note=(time:number,frequency:number,duration:number,level:number,type:OscillatorType='sine')=>{if(time>=from+.001)this.tone(when(time),frequency,duration/speed,level,type);};
    if(plan.moves[0]==='chair'){cue(.5,'wood');cue(.84,'wood');cue(chairReleaseAt(),'wood');}
    plan.moves.slice(0,count).forEach((move,i)=>{if(move==='table'||move==='stool')cue(contactAt(i)-.24,'wood');if(move==='evade')cue(contactAt(i)-.52,'whoosh',(this.variation+i)%4);});
    for (const impact of impacts(plan,count)) {
      const contact=impact.at,variant=(this.variation+impact.fighter)%4,hit=success||impact.fighter<count-1;
      cue(contact-.16,'whoosh',variant,.65);
      cue(contact,impact.primary&&!hit?'punch':impact.kind,variant,impact.primary?1:.55);
      if(impact.primary&&!hit){cue(contact+.045,'block',variant);cue(contact+.24,'landing',variant);}
    }
    const end = resultAt(count);
    if (paid) {
      [196,392,588.7].forEach((f,i)=>note(end+.12,f,.85,.025/(i+1)));
      [392,494,587,784,880,784].forEach((f,i)=>note(end+.32+i*.14,f,.26,.035,'triangle'));
      cue(end+1.32,'wood');cue(end+1.46,'wood');
    } else note(end,success?330:100,success?.10:.18,.028,'triangle');
    return this.audible(at);
  }
  cashout() {
    this.cancel(); if (!this.allowed()) return;
    const at = gameAudio.context!.currentTime + .03;
    [392,494,587].forEach((f,i) => this.tone(at + i * .08, f, .2, .035, 'triangle'));
  }
  result(success:boolean,paid:boolean){this.cancel();if(paid){this.cashout();return;}if(this.allowed())this.tone(gameAudio.context!.currentTime+.02,success?330:100,.12,.028,'triangle');}
  toggle() { this.enabled = !this.enabled;try{localStorage.setItem('royal-kungfu-sound',this.enabled?'1':'0');}catch{} if (!this.enabled){this.needsResume=true;this.cancel();}else void this.unlock(); }
  cancel() { for (const source of this.sources) { try { source.stop(); } catch {} } this.sources.clear(); }
  state() { return { active: this.sources.size, enabled: this.enabled, style:'arcade-brawler',music:this.music.getState() }; }
  destroy() { this.disposed = true; this.cancel();this.music.destroy(); this.resumeListener=undefined;this.context?.removeEventListener('statechange',this.onContextState);this.buffers.clear(); this.unsubscribe(); }
}

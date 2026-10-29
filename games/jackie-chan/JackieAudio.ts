import { gameAudio } from '../../src/game/GameAudio';
import {fightSound,type FightSound} from './JackieFightSounds';

import { contactAt, chairReleaseAt, resultAt } from './JackieChoreography';
export { contactAt, resultAt } from './JackieChoreography';
export class JackieAudio {
  enabled = true;
  private sources = new Set<AudioScheduledSourceNode>();
  private disposed = false;
  private buffers = new Map<string,AudioBuffer>();
  private variation = 0;
  private unsubscribe = gameAudio.onPreferences(p => { if (p.muted || p.volume === 0) this.cancel(); });
  async unlock() { if (!this.disposed && this.enabled) await gameAudio.unlock(); }
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
  private sound(at:number,cue:FightSound,variation=0){
    if(!this.allowed())return;
    const context=gameAudio.context!,key=cue+':'+variation%4+':'+context.sampleRate;
    let buffer=this.buffers.get(key);
    if(!buffer){const samples=fightSound(cue,context.sampleRate,variation);buffer=context.createBuffer(1,samples.length,context.sampleRate);buffer.getChannelData(0).set(samples);this.buffers.set(key,buffer);}
    const source=context.createBufferSource();source.buffer=buffer;source.connect(gameAudio.output!);this.sources.add(source);
    source.onended=()=>{this.sources.delete(source);source.disconnect();};source.start(at);
  }
  private wood(at:number){this.sound(at,'wood',this.variation);}
  private victory(at:number){
    // Soft gong body, then a pentatonic phrase. This is original synthesized audio.
    [196,392,588.7].forEach((f,i)=>this.tone(at,f,.85,.025/(i+1),'sine'));
    [392,494,587,784,880,784].forEach((f,i)=>this.tone(at+.2+i*.14,f,.26,.035,'triangle'));
    this.wood(at+1.2);this.wood(at+1.34);
  }
  /** Visuals follow estimated audible time, including the shared output latency. */
  private audible(at: number) {
    const c = gameAudio.context!; const stamp = c.getOutputTimestamp?.();
    return stamp?.performanceTime && stamp.contextTime ? stamp.performanceTime + (at - stamp.contextTime) * 1000
      : performance.now() + (at - c.currentTime + (c.outputLatency || c.baseLatency || 0)) * 1000;
  }
  begin(count: number, success: boolean, paid: boolean) {
    this.cancel();
    if (!this.allowed()) return performance.now();
    const at = gameAudio.context!.currentTime + .06;
    this.variation=(this.variation+1)%4;
    this.wood(at+.5);this.wood(at+.84);this.wood(at+chairReleaseAt());
    for (let i = 0; i < count; i++) {
      const contact=at+contactAt(i),variant=(this.variation+i)%4,hit=success||i<count-1;
      this.sound(contact-.16,'whoosh',variant);
      this.sound(contact,hit?i===0?'chair':'kick':'punch',variant);
      if(!hit){this.sound(contact+.045,'block',variant);this.sound(contact+.24,'landing',variant);}
    }
    const end = at + resultAt(count);
    if (paid) this.victory(end+.12);
    else this.tone(end, success ? 330 : 100, success ? .10 : .18, .028, 'triangle');
    return this.audible(at);
  }
  cashout() {
    this.cancel(); if (!this.allowed()) return;
    const at = gameAudio.context!.currentTime + .03;
    [392,494,587].forEach((f,i) => this.tone(at + i * .08, f, .2, .035, 'triangle'));
  }
  result(success:boolean,paid:boolean){this.cancel();if(paid){this.cashout();return;}if(this.allowed())this.tone(gameAudio.context!.currentTime+.02,success?330:100,.12,.028,'triangle');}
  toggle() { this.enabled = !this.enabled; if (!this.enabled) this.cancel(); else void this.unlock(); }
  cancel() { for (const source of this.sources) { try { source.stop(); } catch {} } this.sources.clear(); }
  state() { return { active: this.sources.size, enabled: this.enabled, style:'arcade-brawler' }; }
  destroy() { this.disposed = true; this.cancel(); this.buffers.clear(); this.unsubscribe(); }
}

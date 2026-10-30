import {readGameHost} from '../../src/modules/GameHostContract';
export type GalacticCue='start'|'stop'|'nudge'|'bonus'|'partial'|'return'|'win';
export class GalacticAudio {
  private host=readGameHost().gameAudio;
  private sources=new Set<AudioScheduledSourceNode>();
  private musicSource?:AudioBufferSourceNode;
  private musicBuffer?:AudioBuffer;
  private musicOffset=0;private musicAt=0;private dead=false;private entered=false;private paused=false;
  private loading?:Promise<void>;private lifetime=new AbortController();private unsubscribe:()=>void;
  private counts:Partial<Record<GalacticCue,number>>={};
  music=true;effects=true;
  constructor(){
    try{this.music=localStorage.getItem('gn-music')!=='0';this.effects=localStorage.getItem('gn-effects')!=='0';}catch{}
    this.unsubscribe=this.host.onPreferences(()=>{if(!this.enabled())this.cancel();else this.startMusic();});
  }
  private enabled(){const pref=this.host.getPreferences();return !this.dead&&this.entered&&!this.paused&&!document.hidden&&!pref.muted&&pref.volume>0&&this.host.context?.state==='running';}
  async unlock(){
    if(this.dead||this.paused||document.hidden)return;this.entered=true;await this.host.unlock();
    if(!this.musicBuffer&&!this.loading&&this.host.context){
      const context=this.host.context;
      this.loading=(async()=>{const r=await fetch('/assets/wild-nudge/score.wav',{signal:this.lifetime.signal});if(!r.ok)throw Error('Score unavailable');const buffer=await context.decodeAudioData(await r.arrayBuffer());if(!this.dead)this.musicBuffer=buffer;})().catch(()=>{}).finally(()=>{this.loading=undefined;this.startMusic();});
    }
    this.startMusic();
  }
  setMusic(value:boolean){this.music=value;try{localStorage.setItem('gn-music',value?'1':'0');}catch{}if(value){void this.unlock();this.startMusic();}else this.stopMusic();}
  setEffects(value:boolean){this.effects=value;try{localStorage.setItem('gn-effects',value?'1':'0');}catch{}if(!value)this.cancelEffects();}
  private startMusic(){
    const c=this.host.context,out=this.host.output;if(!this.enabled()||!this.music||!this.musicBuffer||this.musicSource||!c||!out)return;
    const source=c.createBufferSource(),gain=c.createGain();source.buffer=this.musicBuffer;source.loop=true;gain.gain.value=.42;source.connect(gain);gain.connect(out);source.onended=()=>{source.disconnect();gain.disconnect();};
    source.start(0,this.musicOffset%this.musicBuffer.duration);this.musicSource=source;this.musicAt=c.currentTime;
  }
  private stopMusic(){if(!this.musicSource)return;this.musicOffset+=Math.max(0,(this.host.context?.currentTime??0)-this.musicAt);try{this.musicSource.stop();}catch{}this.musicSource=undefined;}
  schedule(cue:GalacticCue){
    const c=this.host.context,out=this.host.output;
    if(!this.enabled()||!this.effects||!c||!out)return {delayMs:0,target:performance.now(),mode:'silent'};
    const at=c.currentTime+.035,duration=cue==='nudge'?.28:cue==='bonus'?.65:cue==='win'?.6:.12;
    const pitches=cue==='bonus'?[146.83,220,293.66]:cue==='win'?[196,246.94,293.66]:cue==='nudge'?[82.41,164.81]:cue==='return'?[130.81]:cue==='partial'?[110]:cue==='start'?[65.41]:[110,167];
    const gain=c.createGain(),filter=c.createBiquadFilter();filter.type='lowpass';filter.frequency.value=cue==='stop'?700:1600;
    gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(cue==='stop'?.055:.07,at+.018);gain.gain.exponentialRampToValueAtTime(.0001,at+duration);
    gain.connect(filter);filter.connect(out);let remaining=pitches.length;
    for(const pitch of pitches){const source=c.createOscillator();source.type='sine';source.frequency.setValueAtTime(pitch,at);if(cue==='nudge')source.frequency.exponentialRampToValueAtTime(pitch*1.5,at+duration*.8);source.connect(gain);this.sources.add(source);source.onended=()=>{this.sources.delete(source);source.disconnect();if(--remaining===0){gain.disconnect();filter.disconnect();}};source.start(at);source.stop(at+duration);}
    this.counts[cue]=(this.counts[cue]??0)+1;
    const stamp=c.getOutputTimestamp?.();const target=stamp&&stamp.performanceTime&&stamp.contextTime?stamp.performanceTime+(at-stamp.contextTime)*1000:performance.now()+(at-c.currentTime+(c.outputLatency||c.baseLatency||0))*1000;
    return {delayMs:Math.max(0,Math.min(160,target-performance.now())),target,mode:stamp?.performanceTime?'output-timestamp':'latency-estimate'};
  }
  private cancelEffects(){for(const source of this.sources)try{source.stop();}catch{}this.sources.clear();}
  cancel(){this.cancelEffects();this.stopMusic();}
  pause(){this.paused=true;this.cancel();}
  resume(){this.paused=false;if(this.enabled())this.startMusic();}
  getState(){return {music:this.music,effects:this.effects,activeEffects:this.sources.size,musicPlaying:!!this.musicSource,loaded:!!this.musicBuffer,counts:{...this.counts}};}
  destroy(){this.dead=true;this.lifetime.abort();this.unsubscribe();this.cancel();}
}

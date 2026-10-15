import { gameAudio } from './GameAudio';
export class PianoAudio {
  private context?:AudioContext;
  private master?:GainNode;
  private voices=new Map<number,{gain:GainNode;osc:OscillatorNode}>();
  muted=false;
  played=0;
  async unlock(){
    try{
      await gameAudio.unlock();
      if(!this.context&&gameAudio.context&&gameAudio.output){this.context=gameAudio.context;this.master=this.context.createGain();this.master.gain.value=.3;this.master.connect(gameAudio.output);}
      if(this.context?.state==='suspended')await this.context.resume();
    }catch{/* The next user gesture can retry audio activation. */}
  }
  note(note:number,down:boolean){
    if(!down){this.release(note);return;}
    if(this.muted||this.context?.state!=='running'||!this.master||this.voices.has(note))return;
    if(this.voices.size>=8)this.release(this.voices.keys().next().value!);
    const c=this.context,now=c.currentTime,osc=c.createOscillator(),gain=c.createGain();
    const real=new Float32Array(10),imag=new Float32Array([0,1,.32,.17,.1,.06,.03,.02,.012,.005]);
    osc.setPeriodicWave(c.createPeriodicWave(real,imag));osc.frequency.value=440*2**((note-69)/12);
    gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(.65,now+.008);gain.gain.exponentialRampToValueAtTime(.035,now+1.6);gain.gain.exponentialRampToValueAtTime(.001,now+4.1);
    osc.connect(gain);gain.connect(this.master);osc.start();osc.stop(now+4.2);this.voices.set(note,{osc,gain});this.played++;
    osc.onended=()=>{osc.disconnect();gain.disconnect();if(this.voices.get(note)?.osc===osc)this.voices.delete(note);};
  }
  private release(note:number){const v=this.voices.get(note);if(!v||!this.context)return;const now=this.context.currentTime;v.gain.gain.cancelAndHoldAtTime(now);v.gain.gain.exponentialRampToValueAtTime(.001,now+.13);v.osc.stop(now+.15);this.voices.delete(note);}
  stop(){for(const note of this.voices.keys())this.release(note);}
  mute(value:boolean){this.muted=value;if(value)this.stop();}
  getState(){return{muted:this.muted,context:this.context?.state||'locked',voices:this.voices.size,played:this.played};}
}

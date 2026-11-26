/** Existing arcade effects plus two synthesized ones for the set. */
import {fightSound,type FightSound} from '../../../../games/jackie-chan/JackieFightSounds';
import type {Cue} from './fight';
export class Sound{
  enabled=false;private c?:AudioContext;private buf=new Map<string,AudioBuffer>();private live=new Set<AudioBufferSourceNode>();private out?:GainNode;
  async toggle(){this.enabled=!this.enabled;if(this.enabled){this.c??=new AudioContext();if(!this.out){this.out=this.c.createGain();this.out.gain.value=.5;const k=this.c.createDynamicsCompressor();this.out.connect(k);k.connect(this.c.destination);}await this.c.resume();}else this.stop();}
  private buffer(kind:Cue['kind'],v:number){
    const key=kind+v;let b=this.buf.get(key);if(b)return b;const sr=this.c!.sampleRate;
    const data=kind==='crash'||kind==='china'?debris(kind,sr,v):fightSound(kind as FightSound,sr,v);
    b=this.c!.createBuffer(1,data.length,sr);b.getChannelData(0).set(data);this.buf.set(key,b);return b;
  }
  schedule(cues:Cue[],speed:number,from=0){
    this.stop();if(!this.enabled||!this.c)return;const at=this.c.currentTime+.03;
    cues.forEach((q,i)=>{if(q.t<from)return;const s=this.c!.createBufferSource(),g=this.c!.createGain();s.buffer=this.buffer(q.kind,i%4);g.gain.value=Math.min(1,q.level);s.connect(g);g.connect(this.out!);s.start(at+(q.t-from)/speed);this.live.add(s);s.onended=()=>{this.live.delete(s);g.disconnect();};});
  }
  stop(){for(const s of this.live)try{s.stop();}catch{}this.live.clear();}
}
function debris(kind:'crash'|'china',sr:number,v:number){
  const d=kind==='crash'?.62:.55,out=new Float32Array(Math.ceil(d*sr));let seed=0x1234567^(v+1)*0x45d9f3b,max=0,low=0;
  const r=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296;};
  const n=kind==='crash'?13:15;
  for(let k=0;k<n;k++){const t0=k?Math.pow(r(),1.6)*d*.7:0,a=(k?.22+.4*r():1)*(1-t0/d),f=kind==='crash'?150+r()*620:1900+r()*4300,len=kind==='crash'?.05+.07*r():.06+.12*r();
    for(let i=0;i<len*sr;i++){const j=Math.floor(t0*sr)+i;if(j>=out.length)break;const t=i/sr,e=Math.exp(-t/(len*.28))*Math.min(1,i/24);low+=((r()*2-1)-low)*.35;out[j]+=a*e*(Math.sin(2*Math.PI*f*t)*.6+Math.sin(2*Math.PI*f*2.76*t)*.25+low*(kind==='crash'?.9:.25));}}
  for(const x of out)max=Math.max(max,Math.abs(x));for(let i=0;i<out.length;i++)out[i]*=.7/max;return out;
}

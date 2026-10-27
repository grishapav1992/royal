import {readGameHost} from '../../src/modules/GameHostContract';
export type CaribbeanCue='click'|'stop'|'giant'|'cannon'|'line'|'bonus'|'loss'|'partial'|'return'|'win'|'bigwin';
type Voice={source:OscillatorNode;gain:GainNode;filter:BiquadFilterNode};
const hz=(midi:number)=>440*2**((midi-69)/12);
/** Owns voices, never a context or balance. All output uses the common host. */
export class CaribbeanAudio{
 private host=readGameHost().gameAudio;
 private voices=new Set<Voice>();private timer?:ReturnType<typeof setInterval>;
 private entered=false;private dead=false;private tick=0;
 private musicOutput?:GainNode;private musicContext?:AudioContext;
 private music=true;private unsubscribe:()=>void;
 private counts:Partial<Record<CaribbeanCue,number>>={};
 constructor(){
  try{this.music=localStorage.getItem('royal-caribbean-music')!=='0';}catch{}
  this.unsubscribe=this.host.onPreferences(()=>{if(!this.enabled())this.cancel();else this.startMusic();});
 }
 private enabled(){const p=this.host.getPreferences();return !this.dead&&this.entered&&!document.hidden&&!p.muted&&p.volume>0&&this.host.context?.state==='running';}
 async enter(){if(this.dead)return;this.entered=true;await this.host.unlock();this.startMusic();}
 musicEnabled(){return this.music;}
 setMusic(value:boolean){this.music=value;try{localStorage.setItem('royal-caribbean-music',value?'1':'0');}catch{}if(!value)this.cancel();else this.startMusic();}
 private note(midi:number,at:number,duration:number,level:number,type:OscillatorType='triangle',slide=0,music=false){
  const c=this.host.context,out=this.host.output;if(!c||!out||!this.enabled()||this.voices.size>=36)return;
  const source=c.createOscillator(),gain=c.createGain(),filter=c.createBiquadFilter();
  source.type=type;source.frequency.setValueAtTime(hz(midi),at);if(slide)source.frequency.exponentialRampToValueAtTime(hz(midi+slide),at+duration);
  filter.type='lowpass';filter.frequency.setValueAtTime(type==='sine'?2200:1700,at);filter.frequency.exponentialRampToValueAtTime(650,at+duration);
  gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(level,at+.012);gain.gain.exponentialRampToValueAtTime(.0001,at+duration);
  if(music&&this.musicContext!==c){this.musicOutput?.disconnect();this.musicOutput=c.createGain();this.musicOutput.connect(out);this.musicContext=c;}
  source.connect(filter);filter.connect(gain);gain.connect(music?this.musicOutput!:out);
  const voice={source,gain,filter};this.voices.add(voice);
  source.onended=()=>{source.disconnect();gain.disconnect();filter.disconnect();this.voices.delete(voice);};source.start(at);source.stop(at+duration+.02);
 }
 private startMusic(){
  if(!this.music||!this.enabled()||this.timer)return;
  const play=()=>{if(!this.enabled()||!this.music){this.cancel();return;}const c=this.host.context!,at=c.currentTime+.035,step=this.tick%6,bar=Math.floor(this.tick/6)%8;
   const root=[50,50,55,55,57,57,50,50][bar];
   this.note(root+[12,19,24,15,19,24][step],at,.34,.013,'triangle',0,true);
   if(step===0||step===3)this.note(root-12,at,.52,.014,'sine',0,true);
   if(step===0||step===4)this.note([74,77,76,74,69,72,73,74][bar]+(step===4?3:0),at,.45,.008,'sine',0,true);
   this.tick++;
  };play();this.timer=setInterval(play,310);
 }
 /** Returns the estimated physical-output timestamp on the performance clock. */
 cue(kind:CaribbeanCue,variant=0){
  const c=this.host.context;if(!c||!this.enabled())return performance.now();
  const at=c.currentTime+.07;this.counts[kind]=(this.counts[kind]??0)+1;
  if(kind==='click')this.note(62,at,.07,.012);
  else if(kind==='stop'){this.note(45+variant,at,.09,.018,'triangle',-7);this.note(69+variant,at,.08,.007,'sine');}
  else if(kind==='giant'){this.note(38,at,.4,.032,'triangle',12);this.note(57,at+.02,.45,.013);}
  else if(kind==='cannon'){this.note(35,at,.42,.06,'sine',-16);this.note(50,at,.2,.025,'triangle',-12);}
  else if(kind==='line')this.note(81,at,.2,.016,'sine');
  else if(kind==='bonus')[74,77,81,86].forEach((n,i)=>this.note(n,at+i*.08,.36,.022,'sine'));
  else if(kind==='loss'||kind==='partial')this.note(62,at,.2,.009,'sine');
  else if(kind==='return'){this.note(69,at,.2,.012,'sine');this.note(74,at+.1,.23,.01,'sine');}
  else{if(this.musicOutput){this.musicOutput.gain.cancelScheduledValues(at);this.musicOutput.gain.setTargetAtTime(.28,at,.035);this.musicOutput.gain.setTargetAtTime(1,at+.85,.16);}[62,66,69,74].forEach((n,i)=>this.note(n,at+i*.065,kind==='bigwin'?.75:.4,.024));if(kind==='bigwin'){this.note(38,at,.5,.035,'sine');[86,90,93].forEach((n,i)=>this.note(n,at+.2+i*.09,.42,.018,'sine'));}}
  const stamp=c.getOutputTimestamp?.();
  const estimate=stamp&&typeof stamp.contextTime==='number'&&typeof stamp.performanceTime==='number'&&stamp.contextTime>0&&stamp.performanceTime>0?stamp.performanceTime+(at-stamp.contextTime)*1000:performance.now()+(at-c.currentTime+(c.outputLatency||c.baseLatency||0))*1000;
  return Math.max(performance.now(),Math.min(performance.now()+1000,estimate));
 }
 cancel(){
  clearInterval(this.timer);this.timer=undefined;
  const c=this.host.context;
  if(c&&this.musicOutput){this.musicOutput.gain.cancelScheduledValues(c.currentTime);this.musicOutput.gain.value=1;}
  for(const v of this.voices){try{
   if(!c||c.state!=='running'||document.hidden||this.dead){v.source.stop();v.source.disconnect();v.gain.disconnect();v.filter.disconnect();this.voices.delete(v);}
   else{v.gain.gain.cancelScheduledValues(c.currentTime);v.gain.gain.setTargetAtTime(0,c.currentTime,.006);v.source.stop(c.currentTime+.025);}
  }catch{v.source.disconnect();v.gain.disconnect();v.filter.disconnect();this.voices.delete(v);}}
 }
 pause(){this.entered=false;this.cancel();}
 state(){return{activeSources:this.voices.size,music:!!this.timer,musicEnabled:this.music,counts:{...this.counts}};}
 destroy(){this.dead=true;this.pause();this.musicOutput?.disconnect();this.musicOutput=undefined;this.unsubscribe();}
}

import {gameAudio} from '../game/GameAudio';
import {SlotAudio} from './slotKit/SlotAudio';
import {afterglowSlot} from './slotKit/nativeSlots';
import {AfterglowVoices} from './AfterglowVoices';
export type AfterAccent='line'|'charge'|'pin'|'bonus'|'win'|'big'|'epic'|'settle';
type AccentVoice={source:OscillatorNode;gain:GainNode};
export class AfterglowAudio extends SlotAudio{
 private vocals=new AfterglowVoices();
 private bed?:GainNode;private bedContext?:AudioContext;private accents=new Set<AccentVoice>();private accentCounts:Record<string,number>={};
 private releasePreferences:()=>void;private audioClosed=false;
 private contextChanged=()=>{if(gameAudio.context?.state!=='running')this.stopAccents();};
 constructor(){super(afterglowSlot.audio);this.releasePreferences=gameAudio.onPreferences(()=>{const p=gameAudio.getPreferences();if(p.muted||p.volume===0)this.stopAccents();});}
 protected override audioOutput(){
  const context=gameAudio.context,output=gameAudio.output;if(!context||!output)return;
  if(this.bedContext!==context){this.bedContext?.removeEventListener('statechange',this.contextChanged);this.bed?.disconnect();this.bed=context.createGain();this.bed.connect(output);this.bedContext=context;context.addEventListener('statechange',this.contextChanged);}
  return this.bed;
 }
 /** The visual marker follows the estimated audible attack, including host output latency. */
 accent(kind:AfterAccent,variant=0){
  const context=gameAudio.context,output=gameAudio.output,p=gameAudio.getPreferences(),now=performance.now();
  if(this.audioClosed||document.hidden||p.muted||p.volume===0||context?.state!=='running'||!output)return{visualAt:now+24,mode:'silent'};
  this.audioOutput();const at=context.currentTime+.045,attack=.012;
  let visualAt=now+((at+attack-context.currentTime)+(context.outputLatency||0)+(context.baseLatency||0))*1000,mode='latency';
  const timestamp=context.getOutputTimestamp?.();
  if(timestamp?.contextTime!==undefined&&timestamp.performanceTime!==undefined&&timestamp.contextTime>0&&timestamp.performanceTime>0){visualAt=timestamp.performanceTime+(at+attack-timestamp.contextTime)*1000;mode='timestamp';}
  visualAt=Math.max(now,visualAt);
  this.accentCounts[kind]=(this.accentCounts[kind]??0)+1;
  const note=(frequency:number,offset:number,duration:number,level:number,type:OscillatorType='triangle')=>{
   if(this.accents.size>=32)return;
   const source=context.createOscillator(),gain=context.createGain(),start=at+offset;
   source.type=type;source.frequency.value=frequency;gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(level,start+attack);gain.gain.exponentialRampToValueAtTime(.0001,start+duration);gain.gain.linearRampToValueAtTime(0,start+duration+.02);
   source.connect(gain);gain.connect(output);const voice={source,gain};this.accents.add(voice);
   source.onended=()=>{source.disconnect();gain.disconnect();this.accents.delete(voice);};source.start(start);source.stop(start+duration+.03);
  };
  if(kind==='line'){
   // A short camera-studio chord, with a bounded lift for later cascades.
   const shift=2**(Math.min(variant,4)*2/12);[329.63,415.3,493.88].forEach((f,i)=>note(f*shift,i*.035,.28,.025));note(164.81,0,.22,.034,'sine');
  }else if(kind==='charge'){[659.26,830.61,987.77].forEach((f,i)=>note(f,i*.07,.26,.024,'sine'));}
  else if(kind==='pin'){note(164.81,0,.35,.04,'sine');note(493.88,.04,.35,.03);note(659.26,.09,.35,.02,'sine');}
  else if(kind==='settle'){note(329.63,0,.18,.014,'sine');}
  else {
   const large=kind==='big'||kind==='epic',duration=kind==='epic'?1.6:large?1.15:.72;
   const bed=this.bed!.gain;bed.cancelScheduledValues(context.currentTime);bed.setTargetAtTime(.28,context.currentTime,.025);bed.setTargetAtTime(1,at+duration,.24);
   [164.81,329.63,415.3,493.88].forEach((f,i)=>note(f,i*.025,large?.8:.5,i===0?.055:.032,i===0?'sine':'triangle'));
   const melody=kind==='bonus'?[493.88,659.26,830.61,987.77]:large?[659.26,830.61,987.77,1318.51]:[659.26,830.61,987.77];
   melody.forEach((f,i)=>note(f,.09+i*.105,.45,.028,'sine'));
   if(kind==='epic')[493.88,659.26,830.61].forEach((f,i)=>note(f,.65+i*.1,.7,.026));
  }
  return{visualAt,mode};
 }
 stopAccents(){
  for(const {source,gain} of this.accents){source.onended=null;try{source.stop();}catch{}source.disconnect();gain.disconnect();}this.accents.clear();
  if(this.bed&&this.bedContext){const at=this.bedContext.currentTime;this.bed.gain.cancelScheduledValues(at);this.bed.gain.setTargetAtTime(1,at,.03);}
 }
 bonusVoice(){this.vocals.reaction('bonus');}
 override async enter(){await super.enter();await this.vocals.enter();}
 flash(){this.cue('flash');this.note(880,.075,.009,0,'triangle');this.note(440,.07,.008,.08,'triangle');}
 pin(){this.cue('pin');this.note(220,.4,.018,0,'sine',2);this.note(659.26,.4,.011,.1,'triangle');}
 album(){this.cue('album');[329.63,440,554.37,659.26,880].forEach((n,i)=>this.note(n,.6,.018,i*.09,'triangle'));this.vocals.reaction('unlock');}
 reaction(){this.vocals.reaction('win');}
 override tickets(){super.tickets();this.vocals.reaction('bonus');}
 override stopReel(col:number){this.cue('reel-stop');this.note(329.63*2**(col/12),.14,.016,0,'triangle');}
 override stopSpin(){super.stopSpin();}
 cancelVoices(){this.vocals.stop();}
 override pause(){super.pause();this.stopAccents();this.vocals?.pause();}
 override state(){return{...super.state(),accents:{activeSources:this.accents.size,counts:{...this.accentCounts}},vocal:{...this.vocals.state(),muted:gameAudio.getPreferences().muted||gameAudio.getPreferences().volume===0}};}
 setVoiceEnabled(value:boolean){this.vocals.setEnabled(value);}
 setVoiceLevel(value:number){this.vocals.setLevel(value);}
 previewVoice(){return this.vocals.preview();}
 onVoiceChange(listener:()=>void){this.vocals.addEventListener('change',listener);return()=>this.vocals.removeEventListener('change',listener);}
 override destroy(){this.audioClosed=true;this.vocals.destroy();super.destroy();this.releasePreferences();this.bedContext?.removeEventListener('statechange',this.contextChanged);this.bed?.disconnect();}
}

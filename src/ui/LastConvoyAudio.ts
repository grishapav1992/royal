import {SlotAudio} from './slotKit/SlotAudio';
import {convoySlot} from './slotKit/nativeSlots';
/** Soft minor synth, mechanical stops and a radio rescue signal. */
export class LastConvoyAudio extends SlotAudio {
 constructor(){super(convoySlot.audio);}
 override stopReel(column:number){this.cue('reel-stop');this.note(120+column*12,.12,.018,0,'triangle',.72);this.note(480+column*18,.08,.009,.035);}
 override cascade(index:number){this.cue('cascade');[293.66,349.23,440,587.33].forEach((f,i)=>this.note(f*2**(Math.min(index,3)/12),.35,.017,i*.065,'triangle'));}
 override feature(kind:string){if(kind!=='barricade'){super.feature(kind);return;}this.cue('barricade');this.note(110,.38,.021,0,'triangle',1.5);this.note(293.66,.48,.014,.11);this.note(440,.5,.012,.22);}
 override tickets(){this.cue('tickets');[587.33,880,587.33,1174.66].forEach((f,i)=>this.note(f,.32,.018,i*.16,'sine'));}
 override outcome(won:boolean){this.cue(won?'win':'settle');if(won)[293.66,349.23,440,587.33].forEach((f,i)=>this.note(f,.65,.02,i*.1,'triangle'));else this.note(146.83,.25,.008);}
}

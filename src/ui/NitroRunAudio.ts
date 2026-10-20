import {SlotAudio} from './slotKit/SlotAudio';
import {nitroSlot} from './slotKit/nativeSlots';
/** Original electronic racing cues, routed through the club volume and mute controls. */
export class NitroRunAudio extends SlotAudio {
 constructor(){super(nitroSlot.audio);}
 override stopReel(column:number){this.cue('reel-stop');this.note(130.81*2**(column/12),.16,.018,0,'triangle');this.note(523.25,.08,.007);}
 override cascade(index:number){this.cue('cascade');[164.81,220,329.63,440].forEach((n,i)=>this.note(n*2**(Math.min(index,4)/12),.28,.016,i*.065,'triangle'));}
 gear(value:number){this.cue('gear');this.note(65.41+value*12,.38,.021,0,'triangle',2.5);this.note(440,.07,.009,.08);}
 boost(){this.cue('nitro');this.note(98,.7,.022,0,'triangle',6);this.note(293.66,.55,.011,.15,'sine',3);}
 override drop(){this.cue('drop');this.note(196,.18,.012,0,'triangle',.5);}
 override tickets(){this.cue('tickets');[261.63,329.63,392,523.25,659.26].forEach((n,i)=>this.note(n,.5,.018,i*.11,'triangle'));}
 override outcome(won:boolean){this.cue(won?'win':'settle');if(won)[220,329.63,440,659.26].forEach((n,i)=>this.note(n,.45,.019,i*.075,'triangle'));else this.note(110,.2,.008);}
}

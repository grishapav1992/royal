import {gameAudio} from '../game/GameAudio';
import {SlotAudio} from './slotKit/SlotAudio';
import {afterglowSlot} from './slotKit/nativeSlots';
import {AfterglowVoices} from './AfterglowVoices';
export class AfterglowAudio extends SlotAudio{
 private vocals=new AfterglowVoices();
 constructor(){super(afterglowSlot.audio);}
 override async enter(){await super.enter();await this.vocals.enter();}
 flash(){this.cue('flash');this.note(880,.075,.009,0,'triangle');this.note(440,.07,.008,.08,'triangle');}
 pin(){this.cue('pin');this.note(220,.4,.018,0,'sine',2);this.note(659.26,.4,.011,.1,'triangle');}
 album(){this.cue('album');[329.63,440,554.37,659.26,880].forEach((n,i)=>this.note(n,.6,.018,i*.09,'triangle'));this.vocals.reaction('unlock');}
 reaction(){this.vocals.reaction('win');}
 override tickets(){super.tickets();this.vocals.reaction('bonus');}
 override stopReel(col:number){this.cue('reel-stop');this.note(329.63*2**(col/12),.14,.016,0,'triangle');}
 override stopSpin(){super.stopSpin();}
 cancelVoices(){this.vocals.stop();}
 override pause(){super.pause();this.vocals?.pause();}
 override state(){return{...super.state(),vocal:{...this.vocals.state(),muted:gameAudio.getPreferences().muted||gameAudio.getPreferences().volume===0}};}
 setVoiceEnabled(value:boolean){this.vocals.setEnabled(value);}
 setVoiceLevel(value:number){this.vocals.setLevel(value);}
 previewVoice(){return this.vocals.preview();}
 onVoiceChange(listener:()=>void){this.vocals.addEventListener('change',listener);return()=>this.vocals.removeEventListener('change',listener);}
 override destroy(){this.vocals.destroy();super.destroy();}
}

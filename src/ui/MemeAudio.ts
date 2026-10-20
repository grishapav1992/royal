import {SlotAudio} from './slotKit/SlotAudio';
import {memeSlot} from './slotKit/nativeSlots';
import {gameAudio} from '../game/GameAudio';
import {MemeReactions,type MemeClip} from './MemeReactions';
/** Quiet frequent cues plus a single channel of original meme recordings. */
export class MemeAudio extends SlotAudio {
  readonly reactions=new MemeReactions(active=>this.duck(active));
  private synth?:GainNode;private ducked=false;private entryGeneration=0;
  constructor(){super(memeSlot.audio);}
  protected override audioOutput(){
    const c=gameAudio.context,output=gameAudio.output;if(!c||!output)return undefined;
    if(!this.synth||this.synth.context!==c){this.synth?.disconnect();this.synth=c.createGain();this.synth.gain.value=this.ducked?.16:1;this.synth.connect(output);}
    return this.synth;
  }
  private duck(active:boolean){this.ducked=active;if(this.synth&&this.synth.context.state!=='closed')this.synth.gain.setTargetAtTime(active?.16:1,this.synth.context.currentTime,.035);}
  override async enter(){const generation=this.entryGeneration;await super.enter();if(generation===this.entryGeneration)void this.reactions.enter();}
  newRound(key:string){this.reactions.newRound(key);}
  cancelReactions(){this.entryGeneration++;this.reactions.cancel();}
  confirmedResult(session:{id:string;state:string;spentUnits:string;returnedUnits:string}){this.reactions.result(session);}
  preview(clip:MemeClip){return this.reactions.preview(clip);}
  override stopReel(column:number){this.cue('reel-stop');this.note(330+column*35,.085,.014,0,'triangle');}
  override cascade(index:number){this.cue('cascade');[523.25,659.26,783.99].forEach((n,i)=>this.note(n*2**(Math.min(index,4)/12),.16,.012,i*.065,'triangle'));}
  gear(value:number){this.cue('gear');this.note(220+value*55,.19,.014,0,'triangle');this.note(660+value*30,.1,.009,.1);}
  boost(){this.cue('reconnect');this.note(440,.1,.008);this.reactions.reconnect();}
  override drop(){this.cue('drop');this.note(392,.1,.009,0,'triangle');}
  override tickets(retrigger=false){this.cue('tickets');if(!retrigger)this.reactions.bonus();[523.25,659.26].forEach((n,i)=>this.note(n,.16,.009,i*.08,'triangle'));}
  override outcome(won:boolean){this.cue(won?'win':'settle');if(won)[392,523.25,659.26].forEach((n,i)=>this.note(n,.28,.014,i*.08,'triangle'));else this.note(220,.09,.006);}
  override pause(){this.entryGeneration++;super.pause();this.reactions.pause();}
  override destroy(){this.reactions.destroy();super.destroy();this.synth?.disconnect();this.synth=undefined;}
}

import {SlotCascadeBoard,type SlotCascadeCallbacks} from '../../src/ui/slotKit/SlotCascadeBoard';
import {memeSymbol,memeSymbolName} from './MemeArtwork';
export class MemeBoard extends SlotCascadeBoard {
  constructor(private field:HTMLElement,callbacks:SlotCascadeCallbacks){super(field,callbacks,{symbol:memeSymbol,name:memeSymbolName,preview:Array.from({length:30},(_,i)=>(i+2*Math.floor(i/6))%6),strip:column=>[column%6,3,1,6,4,2,5,7,8]});}
  /** Confirmed winning cells stay bright, the rest of the field steps back. */
  override highlight(positions:readonly number[]){super.highlight(positions);this.field.classList.toggle('mo-has-win',positions.length>0);}
}

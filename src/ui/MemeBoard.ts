import {SlotCascadeBoard,type SlotCascadeCallbacks} from './slotKit/SlotCascadeBoard';
import {memeSymbol,memeSymbolName} from './MemeArtwork';
export class MemeBoard extends SlotCascadeBoard {
  constructor(host:HTMLElement,callbacks:SlotCascadeCallbacks){super(host,callbacks,{symbol:memeSymbol,name:memeSymbolName,preview:Array.from({length:30},(_,i)=>(i+2*Math.floor(i/6))%6),strip:column=>[column%6,3,1,6,4,2,5,7,8]});}
}

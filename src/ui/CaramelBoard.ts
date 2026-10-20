import {SlotCascadeBoard,type SlotCascadeCallbacks} from './slotKit/SlotCascadeBoard';
import {caramelSymbol,caramelSymbolName} from './CaramelArtwork';

/** Artwork adapter for the shared 6x5 cascade player. */
export class CaramelBoard extends SlotCascadeBoard {
  constructor(host:HTMLElement,callbacks:SlotCascadeCallbacks) {
    super(host,callbacks,{symbol:caramelSymbol,name:caramelSymbolName,
      preview:Array.from({length:30},(_,i)=>(i+2*Math.floor(i/6))%7),
      strip:column=>[column%7,3,1,6,4,2,5,7,8]});
  }
}

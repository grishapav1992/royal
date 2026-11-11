import '../../src/ui/active-game-viewport.css';
import {SlotCascadeBoard,type SlotCascadeCallbacks} from './slotKit/SlotCascadeBoard';
import {caramelSymbol,caramelSymbolName} from './CaramelArtwork';

/** Artwork adapter for the shared 6x5 cascade player. */
export class CaramelBoard extends SlotCascadeBoard {
  private field:HTMLElement;
  constructor(host:HTMLElement,callbacks:SlotCascadeCallbacks) {
    super(host,callbacks,{symbol:caramelSymbol,name:caramelSymbolName,
      preview:Array.from({length:30},(_,i)=>(i+2*Math.floor(i/6))%7),
      strip:column=>[column%7,3,1,6,4,2,5,7,8]});
    this.field=host;
  }
  /**
   * Win presentation: winning cells get the win border, spinning tops that charged energy get the
   * mint border, and every other cell is dimmed. Empty lists restore the plain field.
   */
  focus(winning:readonly number[],energy:readonly number[]=[]){
    this.highlight(winning);
    const tops=new Set(energy);
    this.field.querySelectorAll<HTMLElement>('[data-cc-cell]').forEach(cell=>cell.classList.toggle('cc-energy-cell',tops.has(Number(cell.dataset.ccCell))));
    this.field.dataset.focus=String(winning.length>0||tops.size>0);
  }
}

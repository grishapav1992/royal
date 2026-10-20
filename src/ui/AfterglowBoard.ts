import {SlotCascadeBoard,type SlotCascadeCallbacks,type SlotGravityFrame} from './slotKit/SlotCascadeBoard';
import {afterSymbol,afterSymbolName} from './AfterglowArtwork';
export class AfterglowBoard{
 private player:SlotCascadeBoard;private lights:HTMLElement;
 constructor(host:HTMLElement,callbacks:SlotCascadeCallbacks){this.player=new SlotCascadeBoard(host,callbacks,{symbol:afterSymbol,name:afterSymbolName,preview:Array.from({length:30},(_,i)=>(i+2*Math.floor(i/6))%6),strip:col=>[col%6,1,6,2,5,3,7,4,8]});this.lights=document.createElement('div');this.lights.className='ag-cell-lights';this.lights.setAttribute('aria-hidden','true');host.append(this.lights);this.features([],[]);}
 features(cells:readonly number[],pins:readonly number[]){this.lights.innerHTML=Array.from({length:30},(_,p)=>`<span class="${pins.includes(p)?'ag-pinned':''}" data-ag-cell="${p}">${pins.includes(p)?afterSymbol(6):''}${(cells[p]??1)>1?`<b>×${cells[p]}</b>`:''}</span>`).join('');}
 show(grid:readonly number[]){this.player.show(grid);}begin(token:string,motion:boolean,fast:boolean){this.player.begin(token,motion,fast);}settle(token:string,grid:readonly number[]){return this.player.settle(token,grid);}highlight(positions:readonly number[]){this.player.highlight(positions);}remove(positions:readonly number[]){this.player.remove(positions);}gravity(frame:SlotGravityFrame,fast:boolean){this.player.gravity(frame,fast);}clearOverlay(){this.player.clearOverlay();}cancel(){this.player.cancel();}destroy(){this.player.destroy();this.lights.remove();}
}

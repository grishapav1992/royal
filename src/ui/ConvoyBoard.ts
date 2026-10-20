import {SlotCascadeBoard,type SlotCascadeCallbacks} from './slotKit/SlotCascadeBoard';
import {convoySymbol,convoySymbolName} from './ConvoyArtwork';
import {slotLocalRect} from './slotKit/SlotGeometry';
export class ConvoyBoard extends SlotCascadeBoard {
 private pins:number[]=[];
 private pinLayer?:HTMLElement;
 constructor(private boardHost:HTMLElement,callbacks:SlotCascadeCallbacks){super(boardHost,callbacks,{symbol:convoySymbol,name:convoySymbolName,preview:Array.from({length:30},(_,i)=>(i+2*Math.floor(i/6))%7),strip:col=>[col%7,3,1,6,4,2,5,7,8]});this.pinLayer=document.createElement('div');this.pinLayer.className='cv-pin-layer';this.pinLayer.setAttribute('aria-hidden','true');boardHost.append(this.pinLayer);}
 setPins(pins:readonly number[]){this.pins=[...pins];}
 override begin(token:string,motion:boolean,fast=false){
  super.begin(token,motion,fast);if(!motion||!this.pinLayer)return;
  for(const pos of this.pins){const cell=this.boardHost.querySelector<HTMLElement>(`[data-cc-cell="${pos}"]`);if(!cell)continue;const rect=slotLocalRect(cell,this.pinLayer),pin=document.createElement('div');pin.className='cv-held';pin.dataset.cvHeld=String(pos);Object.assign(pin.style,{left:`${rect.left}px`,top:`${rect.top}px`,width:`${rect.width}px`,height:`${rect.height}px`});pin.innerHTML=convoySymbol(8);this.pinLayer.append(pin);}
 }
 override async settle(token:string,grid:readonly number[]){const result=await super.settle(token,grid);this.pinLayer?.replaceChildren();return result;}
 override cancel(){super.cancel();this.pinLayer?.replaceChildren();}
}

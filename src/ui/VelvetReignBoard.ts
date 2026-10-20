import { t as translateText, tr } from '../i18n/index';
import {SlotReelBoard} from './slotKit/SlotReelBoard';
import {luelonSlotCellMultiplier,type LuelonSlotInfo,type LuelonSlotFeatures,type LuelonSlotFrame,type LuelonSlotEvent} from '../shared/luelonSlots';
import type {LuelonTheme} from './LuelonArtwork';
import {VELVET_ASSETS} from './VelvetReignAssets';
import {VELVET_NAMES,VELVET_STARS} from '../shared/velvetReign';
export const velvetSymbolName=(id:number)=>VELVET_NAMES[id]??translateText('Пустая ячейка');
const ART_RECTS=[[1,8,363,337],[380,15,352,329],[762,14,326,329],[1090,15,358,321],[4,345,362,342],[368,342,361,345],[740,345,347,341],[1088,343,360,343],[0,689,405,389],[379,689,354,389],[724,689,363,389],[1086,688,362,391]];
let artSerial=0;
export function velvetArt(cell:number,ready=true){const clip="vr-art-"+(artSerial++),rect=ART_RECTS[cell]??ART_RECTS[0];return `<svg viewBox="${rect.join(' ')}" preserveAspectRatio="xMidYMid meet" aria-hidden="true" style="overflow:hidden"><defs><clipPath id="${clip}"><rect x="${rect[0]}" y="${rect[1]}" width="${rect[2]}" height="${rect[3]}"/></clipPath></defs><image clip-path="url(#${clip})" data-velvet-symbol-image${ready?` href="${VELVET_ASSETS.symbols}"`:''} width="1448" height="1086"/></svg>`;}
export function velvetSymbol(id:number,ready=true){if(id<0)return '';if(id<4)return `<span class="lg-symbol vr-letter vr-letter-${id}" aria-hidden="true">${['J','Q','K','A'][id]}<small>◆</small></span>`;const cell=id<8?id-4:id===8?5:4;return `<span class="lg-symbol vr-symbol" aria-hidden="true">${velvetArt(cell,ready)}${id===8?'<b>WILD</b>':''}</span>`;}
export class VelvetReignBoard extends SlotReelBoard {
  constructor(host:HTMLElement,info:LuelonSlotInfo,theme:LuelonTheme,onStop:(column:number)=>void,artworkReady=true) {
    super(host,info,theme,onStop,{symbol:velvetSymbol,name:velvetSymbolName},artworkReady,true);
  }
  async effect(event:LuelonSlotEvent,_after:readonly number[],fast:boolean,motion:boolean,current:()=>boolean){
    this.features.replaceChildren();if(!motion)return current();const promises:Promise<void>[]=[];
    if(event.kind==='collect'||event.kind==='scatter')for(const position of event.positions){const token=this.tokenAt(position,9);promises.push(this.animate(token,[{transform:'translate(-50%,-50%) scale(1)',opacity:1},{transform:'translate(-50%,-220%) scale(.25)',opacity:0}],fast?220:620));}
    else if(event.kind==='retrigger'){const badge=document.createElement('div');badge.className='vr-star-arrival';badge.textContent=tr`НОВАЯ ЗВЕЗДА · +${event.value} ВРАЩЕНИЯ`;this.features.append(badge);promises.push(this.animate(badge,[{opacity:0,transform:'translate(-50%,-50%) scale(.7)'},{opacity:1,transform:'translate(-50%,-50%) scale(1)',offset:.35},{opacity:1,transform:'translate(-50%,-50%) scale(1)'}],fast?400:1000));}
    await Promise.all(promises);this.features.replaceChildren();return current();
  }
  stars(wilds:readonly {column:number;factor:number}[],animate=false,from=0){this.heldLayer.replaceChildren();wilds.forEach((w,i)=>{const star=document.createElement('div');star.className='vr-held-star';star.dataset.star=String(i);star.style.left=`${w.column*20}%`;star.innerHTML=`${velvetArt(6+i,this.artworkReady)}<small>${VELVET_STARS[i]}</small><strong>×${w.factor}</strong>`;this.heldLayer.append(star);if(animate&&i>=from)void this.animate(star,[{opacity:0,transform:'translateY(-20%) scale(.8)'},{opacity:1,transform:'translateY(0) scale(1)'}],650);});}
}

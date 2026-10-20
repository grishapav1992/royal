import { t as translateText } from '../i18n/index';
import {MEME_NAMES} from '../shared/memeOverload';
import {MEME_ASSETS} from './MemeAssets';
const images=[MEME_ASSETS.doge,MEME_ASSETS.harold,MEME_ASSETS.grumpy,MEME_ASSETS.smudge,MEME_ASSETS.stonks,MEME_ASSETS.pepe];
/** Names are accessible descriptions; pictures have no visible name captions. */
export function memeSymbol(symbol:number):string {
  if(symbol>=0&&symbol<6)return `<span class="mo-symbol mo-picture mo-picture-${symbol}" aria-hidden="true"><img src="${images[symbol]}" alt="" draggable="false"></span>`;
  if(symbol===6)return '<span class="mo-symbol mo-wild" aria-hidden="true"><b>WILD</b><small>admin.exe</small></span>';
  if(symbol===7)return '<span class="mo-symbol mo-folder" aria-hidden="true"><i></i><b>BONUS</b></span>';
  return '<span class="mo-symbol mo-network" aria-hidden="true"><b>↻</b><small>CONNECT</small></span>';
}
export const memeSymbolName=(symbol:number)=>MEME_NAMES[symbol]??translateText('Мем');

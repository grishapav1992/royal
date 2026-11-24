import { t as translateText } from '../../src/i18n/index';
import {MEME_NAMES} from '../../src/shared/memeOverload';
import {MEME_ASSETS} from './MemeAssets';
const images=[MEME_ASSETS.doge,MEME_ASSETS.harold,MEME_ASSETS.grumpy,MEME_ASSETS.smudge,MEME_ASSETS.stonks,MEME_ASSETS.pepe];
const FOLDER='<svg viewBox="0 0 72 52" aria-hidden="true" focusable="false"><path d="M2 10V2h30v8" fill="#f2cb42" stroke="#b38c20" stroke-width="2.5"/><path d="M2 10h68v40H2z" fill="#f2cb42" stroke="#b38c20" stroke-width="2.5"/><path d="M4 13h64" stroke="#ffe98c" stroke-width="3"/></svg>';
export const MEME_RELOAD='<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false"><path d="M38 24a14 14 0 1 1-14-14h4" fill="none" stroke="currentColor" stroke-width="7"/><path d="M24 0l14 10-14 10z" fill="currentColor"/></svg>';
/** Names are accessible descriptions; pictures have no visible name captions. */
export function memeSymbol(symbol:number):string {
  if(symbol>=0&&symbol<6)return `<span class="mo-symbol mo-picture" aria-hidden="true"><img src="${images[symbol]}" alt="" draggable="false"></span>`;
  if(symbol===6)return '<span class="mo-symbol mo-wild" aria-hidden="true"><b>WILD</b><small>admin.exe</small></span>';
  if(symbol===7)return `<span class="mo-symbol mo-folder" aria-hidden="true">${FOLDER}<b>BONUS</b></span>`;
  return `<span class="mo-symbol mo-network" aria-hidden="true">${MEME_RELOAD}<small>CONNECT</small></span>`;
}
export const memeSymbolName=(symbol:number)=>MEME_NAMES[symbol]??translateText('Мем');

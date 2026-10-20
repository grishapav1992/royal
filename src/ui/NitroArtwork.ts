import { t as translateText } from '../i18n/index';
import {NITRO_NAMES} from '../shared/nitroRun';
import {NITRO_ASSETS} from './NitroRunAssets';
const crops=[[25,20,380,398],[430,30,400,390],[851,30,395,380],[18,430,390,375],[408,500,434,275],[833,505,414,265],[20,815,395,410],[410,825,432,398],[847,813,400,414]];
let next=0;
export function nitroSymbol(symbol:number){
 const [x,y,w,h]=crops[symbol]??crops[0],id=`nr-crop-${next++}`;
 return `<svg class="cc-symbol nr-symbol" viewBox="${x} ${y} ${w} ${h}" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><defs><clipPath id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath></defs><image href="${NITRO_ASSETS.symbols}" width="1280" height="1280" clip-path="url(#${id})"/></svg>`;
}
export const nitroSymbolName=(symbol:number)=>NITRO_NAMES[symbol]??translateText('Гоночный символ');

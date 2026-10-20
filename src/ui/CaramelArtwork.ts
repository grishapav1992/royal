import { t as translateText } from '../i18n/index';
import {CARAMEL_NAMES} from '../shared/caramelCarnival';
export function caramelSymbol(symbol:number){const i=Math.min(symbol,8),x=i%3*50,y=Math.floor(i/3)*50;return `<span class="cc-symbol" style="--cc-sx:${x}%;--cc-sy:${y}%" aria-hidden="true">${symbol>=8?`<b>+${[2,3,5,10][symbol-8]}</b>`:''}</span>`;}
export const caramelSymbolName=(symbol:number)=>CARAMEL_NAMES[symbol]??translateText('Конфета');

import { t as translateText } from '../i18n/index';
import {CONVOY_NAMES} from '../shared/lastConvoy';
let iconSerial=0;
export function convoySymbol(symbol:number) {
 const crops=['24 65 390 350','515 4 250 430','887 35 350 390','24 480 380 307','420 483 415 307','883 425 350 390','8 815 405 450','860 818 405 455','414 815 435 450'];
 const crop=crops[symbol]??crops[0],[x,y,width,height]=crop.split(' '),id=`cv-crop-${++iconSerial}`;
 return `<svg class="cc-symbol cv-symbol" viewBox="${crop}" aria-hidden="true" overflow="hidden"><defs><clipPath id="${id}"><rect x="${x}" y="${y}" width="${width}" height="${height}"/></clipPath></defs><image clip-path="url(#${id})" href="/assets/last-convoy/v1/symbols.webp" width="1280" height="1280"/></svg>`;
}
export const convoySymbolName=(symbol:number)=>CONVOY_NAMES[symbol]??translateText('Припасы');

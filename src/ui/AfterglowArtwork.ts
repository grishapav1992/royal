import { t as translateText } from '../i18n/index';
import {AFTER_NAMES} from '../shared/afterglow';
import {AFTER_ASSETS} from './AfterglowAssets';
let serial=0;
const crops=[[90,0,460,340],[590,0,380,340],[1090,0,350,340],[105,345,465,320],[580,345,410,320],[1090,345,360,320],[110,687,450,330],[625,663,340,350],[1050,662,450,356]];
export function afterSymbol(symbol:number){const [x,y,w,h]=crops[symbol]??crops[0],id=`ag-symbol-${serial++}`;return `<svg class="cc-symbol ag-symbol" viewBox="${x} ${y} ${w} ${h}" aria-hidden="true" overflow="hidden"><defs><clipPath id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath></defs><image href="${AFTER_ASSETS.symbols}" width="1536" height="1024" clip-path="url(#${id})"/></svg>`;}
export const afterSymbolName=(symbol:number)=>AFTER_NAMES[symbol]??translateText('Символ');
const characters=[{"base":{"url":"/assets/afterglow/v3/base-0.webp","width":1024,"height":1536,"frames":1,"bytes":67096},"look":{"url":"/assets/afterglow/v4/look-0-legendary.webp","width":2048,"height":2048,"frames":1,"bytes":166196}},{"base":{"url":"/assets/afterglow/v3/base-1.webp","width":1024,"height":1536,"frames":1,"bytes":63576},"look":{"url":"/assets/afterglow/v3/look-1-user.webp","width":2048,"height":2048,"frames":1,"bytes":111648}},{"base":{"url":"/assets/afterglow/v3/base-2.webp","width":1024,"height":1536,"frames":1,"bytes":66254},"look":{"url":"/assets/afterglow/v3/look-2-user.webp","width":2048,"height":2048,"frames":1,"bytes":129424}},{"base":{"url":"/assets/afterglow/v3/base-3.webp","width":1024,"height":1536,"frames":1,"bytes":57748},"look":{"url":"/assets/afterglow/v3/look-3-user.webp","width":2048,"height":2048,"frames":1,"bytes":144266}}];
export function afterGirl(index:number,look:0|1=0,animate=false,framing:'full'|'hero'='full'){
 const art=characters[index]??characters[0],a=look?art.look:art.base,w=a.width/a.frames,id=`ag-girl-${serial++}`,single=look&&a.frames===1,x=single?a.width*15/64:0,vw=single?a.width*17/32:w;
 return `<svg class="ag-girl${look&&animate?' ag-motion':''}${single?' ag-single':''}" data-girl="${index}" data-look="${look}" data-frame-count="${a.frames}" viewBox="${x} 0 ${vw} ${a.height}" preserveAspectRatio="${framing==='hero'?'xMidYMin slice':'xMidYMid meet'}" aria-hidden="true" overflow="hidden"><defs><clipPath id="${id}"><rect width="${w}" height="${a.height}"/></clipPath></defs><g clip-path="url(#${id})">${Array.from({length:a.frames},(_,i)=>`<image class="ag-character-frame ag-frame-${i}" href="${a.url}" x="${-i*w}" width="${a.width}" height="${a.height}"/>`).join('')}</g></svg>`;
}

/** Original photo bounds are preserved in the full-window viewer. */
export function afterPhoto(index:number,look:0|1=0){const art=characters[index]??characters[0];return (look?art.look:art.base).url;}

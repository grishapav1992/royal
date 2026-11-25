/** Two languages of the room. Money always keeps two decimals. */
export const lang={en:false};
export const t=(ru:string,en:string)=>lang.en?en:ru;
export const money=(n:number|string)=>(Number(n)/100).toLocaleString(lang.en?'en-US':'ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2});
export const signed=(n:number)=>(n>0?'+':n<0?'−':'')+money(Math.abs(n));
export const points=(n:number)=>{if(lang.en)return n===1?'point':'points';const a=n%10,b=n%100;return a===1&&b!==11?'очко':a>1&&a<5&&(b<12||b>14)?'очка':'очков';};
/** One dialog at a time: focus goes in, stays in and returns to the control that opened it. */
let back:HTMLElement|null=null;
const items=(el:HTMLElement)=>[...el.querySelectorAll<HTMLElement>('button:not(:disabled),input,select')].filter(x=>x.offsetParent!==null);
export function dialogOpen(el:HTMLElement,label:string,first?:HTMLElement|null){
  if(el.dataset.open!=='1'){const a=document.activeElement as HTMLElement|null;back=a&&a!==document.body&&!el.contains(a)?a:back;}
  el.dataset.open='1';el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');el.setAttribute('aria-label',label);el.tabIndex=-1;
  (first??items(el)[0]??el).focus({preventScroll:true});
  el.onkeydown=e=>{if(e.key!=='Tab')return;const l=items(el);if(!l.length)return;const i=l.indexOf(document.activeElement as HTMLElement);if(e.shiftKey&&i<=0){e.preventDefault();l[l.length-1].focus();}else if(!e.shiftKey&&i===l.length-1){e.preventDefault();l[0].focus();}};
}
export function dialogClose(el:HTMLElement){delete el.dataset.open;el.onkeydown=null;const b=back;back=null;if(b?.isConnected)b.focus({preventScroll:true});}

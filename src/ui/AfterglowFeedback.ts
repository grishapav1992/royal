import {afterTr as tr,afterText as t} from './AfterglowText';
import type {AfterFrame} from '../shared/afterglow';
import {slotCoins as coins} from './slotKit/SlotScreens';
import type {AfterglowAudio, AfterAccent} from './AfterglowAudio';

export type AfterTier='loss'|'partial'|'even'|'win'|'big'|'epic';
// Game-specific presentation choices, measured against the whole accepted paid round.
export function afterRoundTier(spent:string,returned:string):AfterTier {
 const stake=BigInt(spent),payout=BigInt(returned);
 return payout===0n?'loss':payout<stake?'partial':payout===stake?'even':stake>0n&&payout>=stake*25n?'epic':stake>0n&&payout>=stake*10n?'big':'win';
}

/** One visible result timeline. It never requests a stake or changes a settlement. */
export class AfterglowFeedback {
 private board:HTMLElement;private layer:HTMLElement;private award:HTMLElement;private result:HTMLElement;
 private request=0;private resolve?: (ok:boolean)=>void;private skip=false;private generation=0;
 private sync:Array<{cue:string;skewMs:number;mode:string}>=[];
 constructor(private root:HTMLElement,private audio:AfterglowAudio,private total:(units:number)=>void){
  this.board=root.querySelector('[data-cc-board]')!;
  this.layer=document.createElement('div');this.layer.className='ag-feedback-layer';this.layer.setAttribute('aria-hidden','true');
  this.award=document.createElement('div');this.award.className='ag-award';this.award.hidden=true;
  this.award.innerHTML='<small></small><strong></strong>';
  this.result=document.createElement('div');this.result.className='ag-result';this.result.hidden=true;
  this.result.innerHTML=`<div class="ag-result-rays" aria-hidden="true"></div><div class="ag-result-card"><small>${t('ВЫПЛАТА ЗА РАУНД')}</small><h3></h3><strong data-ag-result-amount></strong><span data-ag-net></span><button type="button" data-ag-skip>${t('Показать итог')}</button></div>`;
  this.result.querySelector('button')!.onclick=()=>{this.skip=true;};
  this.board.append(this.layer);this.root.querySelector('.cc-board-frame')!.append(this.award);this.root.append(this.result);
 }
 focusBoard(){
  const stage=this.root.closest<HTMLElement>('.mini-stage');
  if(!stage||!this.root.closest('#mini-dialog[data-game-viewport="flow"]'))return;
  const area=stage.getBoundingClientRect(),board=this.board.getBoundingClientRect();
  if(board.top<area.top||board.bottom>area.bottom)stage.scrollTop+=board.top-area.top-12;
 }
 private run(cue:AfterAccent,duration:number,reveal:()=>void,tick:(progress:number)=>void,valid:()=>boolean,variant=0){
  const generation=this.generation,ticket=this.audio.accent(cue,variant);let revealed=false;
  return new Promise<boolean>(resolve=>{
   this.resolve=resolve;
   const frame=(now:number)=>{
    if(generation!==this.generation||!valid()||document.hidden){this.cancel();return;}
    if(now>=ticket.visualAt&&!revealed){
     revealed=true;reveal();this.sync.push({cue,skewMs:now-ticket.visualAt,mode:ticket.mode});if(this.sync.length>40)this.sync.shift();
    }
    if(revealed){tick(this.skip?1:Math.min(1,(now-ticket.visualAt)/Math.max(1,duration)));}
    if(revealed&&(this.skip||now>=ticket.visualAt+duration)){
     this.request=0;this.resolve=undefined;if(this.skip)this.audio.stopAccents();resolve(true);
    }else this.request=requestAnimationFrame(frame);
   };
   this.request=requestAnimationFrame(frame);
  });
 }
 private lines(frame:AfterFrame){
  this.layer.replaceChildren();const rect=this.board.getBoundingClientRect();
  if(!rect.width||!rect.height)return;
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('ag-live-lines');svg.setAttribute('viewBox',`0 0 ${rect.width} ${rect.height}`);svg.setAttribute('preserveAspectRatio','none');
  for(const win of frame.wins){
   const path=document.createElementNS(svg.namespaceURI,'polyline');path.setAttribute('points',win.positions.map(position=>{
    const r=this.board.querySelector(`[data-cc-cell="${position}"]`)!.getBoundingClientRect();return `${r.left+r.width/2-rect.left},${r.top+r.height/2-rect.top}`;
   }).join(' '));svg.append(path);
  }
  this.layer.append(svg);
 }
 async combination(frame:AfterFrame,from:number,to:number,motion:boolean,fast:boolean,valid:()=>boolean){
  this.skip=false;if(motion)this.lines(frame);
  this.award.querySelector('small')!.textContent=tr`КАСКАД ${frame.index+1} · ${frame.wins.length} ЛИНИЙ`;
  const count=this.award.querySelector('strong')!;
  const ok=await this.run('line',motion?(fast?220:540):100,()=>{
   this.root.dataset.agFeedback='line';this.award.hidden=false;
  },progress=>{
   const p=motion?1-(1-progress)**3:1;this.total(from+Math.floor((to-from)*p));count.textContent=`+${coins(Math.floor((to-from)*p))}`;
  },valid,frame.index);
  if(ok)this.total(to);this.clearBoard();return ok;
 }
 async feature(kind:'charge'|'pin'|'bonus',positions:readonly number[],motion:boolean,fast:boolean,valid:()=>boolean,reveal:()=>void){
  this.skip=false;
  const ok=await this.run(kind,motion?(fast?180:420):100,()=>{
   this.root.dataset.agFeedback=kind;
   for(const position of positions)this.board.querySelector(`[data-ag-cell="${position}"]`)?.classList.add('ag-feature-cell');
   reveal();
  },()=>{},valid);
  this.clearBoard();return ok;
 }
 async finish(spent:string,returned:string,motion:boolean,fast:boolean,valid:()=>boolean,voice:()=>void){
  this.clearBoard();this.skip=false;const tier=afterRoundTier(spent,returned),payout=Number(returned),net=payout-Number(spent);
  this.root.dataset.agOutcome=tier;
  const message=this.root.querySelector<HTMLElement>('[data-cc-message]')!;
  if(tier==='loss'||tier==='partial'||tier==='even'){
   this.total(payout);message.textContent=tier==='loss'?t('РАУНД ЗАВЕРШЁН'):tier==='even'?t('СТАВКА ВОЗВРАЩЕНА'):tr`ВЫПЛАТА ${coins(returned)} · ИТОГ −${coins(-net)}`;
   return this.run('settle',100,()=>{},()=>{},valid);
  }
  this.result.dataset.tier=tier;this.result.dataset.revealed='false';
  this.result.querySelector('h3')!.textContent=t(tier==='epic'?'ГРАНДИОЗНЫЙ ВЫИГРЫШ':tier==='big'?'КРУПНЫЙ ВЫИГРЫШ':'ВЫИГРЫШ');
  this.result.querySelector('[data-ag-net]')!.textContent=tr`ИТОГ РАУНДА +${coins(net)}`;
  const amount=this.result.querySelector('[data-ag-result-amount]')!;amount.textContent=coins(0);
  const button=this.result.querySelector<HTMLButtonElement>('button')!;button.hidden=!motion;
  const frame=this.root.querySelector('.cc-board-frame')!.getBoundingClientRect(),root=this.root.getBoundingClientRect(),scaleX=root.width/this.root.offsetWidth||1,scaleY=root.height/this.root.offsetHeight||1;
  for(const [name,value]of Object.entries({left:(frame.left-root.left)/scaleX,top:(frame.top-root.top)/scaleY,width:frame.width/scaleX,height:frame.height/scaleY}))this.result.style.setProperty(`--ag-result-${name}`,`${value}px`);
  this.result.hidden=false;
  const duration=motion?(tier==='epic'?1800:tier==='big'?1350:850)*(fast?.65:1):160,hold=motion?(fast?100:250):0;
  const ok=await this.run(tier,duration+hold,()=>{
   this.root.dataset.agFeedback=tier;this.result.dataset.revealed='true';voice();
   if(motion)this.particles(tier==='win'?8:tier==='big'?16:24);
  },progress=>{const p=Math.min(1,progress*(duration+hold)/duration);amount.textContent=coins(Math.floor(payout*(motion?1-(1-p)**3:1)));},valid);
  if(ok){amount.textContent=coins(payout);this.total(payout);message.textContent=tr`ВЫПЛАТА ${coins(payout)} · ИТОГ +${coins(net)}`;}
  this.result.hidden=true;this.clearBoard();return ok;
 }
 private particles(count:number){
  for(let i=0;i<count;i++){
   const particle=document.createElement('i');particle.className='ag-spark';
   particle.style.setProperty('--ag-x',`${(i*37%101)}%`);particle.style.setProperty('--ag-drift',`${(i%2?1:-1)*(18+i%5*12)}px`);particle.style.setProperty('--ag-delay',`${i%6*35}ms`);this.layer.append(particle);
  }
 }
 private clearBoard(){
  this.award.hidden=true;this.layer.replaceChildren();delete this.root.dataset.agFeedback;
  this.board.querySelectorAll('.ag-feature-cell').forEach(cell=>cell.classList.remove('ag-feature-cell'));
 }
 cancel(){this.generation++;cancelAnimationFrame(this.request);this.request=0;this.resolve?.(false);this.resolve=undefined;this.result.hidden=true;this.skip=false;this.clearBoard();this.audio.stopAccents();delete this.root.dataset.agOutcome;}
 state(){return{active:!!this.request,sync:[...this.sync],outcome:this.root.dataset.agOutcome??null};}
 destroy(){this.cancel();this.result.remove();this.award.remove();this.layer.remove();}
}

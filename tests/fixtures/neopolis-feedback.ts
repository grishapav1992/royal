import '../../games/neopolis/neopolis.css';
import { NeopolisAudio } from '../../games/neopolis/NeopolisAudio';
import { NeopolisFeedback } from '../../games/neopolis/NeopolisFeedback';
import { NeopolisEffects } from '../../games/neopolis/NeopolisEffects';
import { NeopolisReels, dissolveNeopolisSymbols, dropNeopolisSymbols } from '../../games/neopolis/NeopolisReels';
import { waitMotion } from '../../games/neopolis/NeopolisMotion';
import { symbolArt, skyline } from '../../games/neopolis/art';
import { neopolisCopy } from '../../games/neopolis/copy';
import { gameAudio, type GameAudio } from '../../src/game/GameAudio';
import { evaluateLines, type Frame } from '../../src/shared/neopolisMath';

// Deterministic presentation-only fixture. It has no wallet, accounts or outcome API.
const language=new URLSearchParams(location.search).get('lang')==='ru' ? 'ru' : 'en',copy=neopolisCopy(language);
const root=document.createElement('section'); root.className='np'; root.lang=language;
root.innerHTML=skyline+'<header class="np-top"><span class="np-brand">ROYAL ORIGINALS</span><span class="np-prototype">'+(language==='ru' ? 'Проверка эффектов · Без ставок и кошелька' : 'Feedback review · No stakes or wallet')+'</span></header><div class="np-title"><h1>'+copy.title+'</h1></div><nav class="review-controls">'+['reels','combination','cascade','loss','partial','even','win','big','epic','pause','mute','cancel'].map(action=>'<button data-review="'+action+'">'+action+'</button>').join('')+'</nav><div class="np-layout"><section class="np-machine"><div class="np-board-shell"><div class="np-board" role="grid"></div></div><div class="np-transmission"><p>Deterministic presentation preview</p></div></section></div><footer class="np-controls"><div class="np-value np-win"><span>'+copy.payout+'</span><strong data-review-amount>0</strong></div><span class="review-note">'+(language==='ru' ? 'Подготовленные события для сравнения оформления' : 'Prepared events for presentation comparison')+'</span></footer>';
document.querySelector('#feedback-review')!.append(root);
const board=root.querySelector<HTMLElement>('.np-board')!;
let controller=new AbortController(),paused=false,busy=false,reels:NeopolisReels|undefined;
const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
let outputBus:GainNode|undefined,delay:DelayNode|undefined,extraDelay=0,restoreClock:(()=>void)|undefined;
const hostAudio:Pick<GameAudio,'context'|'output'|'unlock'|'getPreferences'|'onPreferences'>={
  get context(){return gameAudio.context;},get output(){return outputBus;},
  async unlock(){
    await gameAudio.unlock();
    if(!outputBus && gameAudio.context && gameAudio.output) {
      const context=gameAudio.context;outputBus=context.createGain();delay=context.createDelay(1);
      outputBus.connect(delay);delay.connect(gameAudio.output);
      const original=context.getOutputTimestamp.bind(context);
      context.getOutputTimestamp=()=>{const stamp=original();return {...stamp,performanceTime:(stamp.performanceTime??performance.now())+extraDelay};};
      restoreClock=()=>{context.getOutputTimestamp=original;};
    }
  },
  getPreferences:()=>gameAudio.getPreferences(),onPreferences:listener=>gameAudio.onPreferences(listener),
};
const audio=new NeopolisAudio(hostAudio,document),effects=new NeopolisEffects(root.querySelector('.np-layout')!,()=>paused||document.hidden,reduced);
const number=(n:number)=>n.toLocaleString(language==='ru' ? 'ru-RU' : 'en-US',{maximumFractionDigits:2});
const feedback=new NeopolisFeedback(root,copy,number,units=>{root.querySelector('[data-review-amount]')!.textContent=number(units/100);},reduced,(kind,cells)=>effects.play(kind==='win' ? 'win' : 'celebrate',cells));
const options=()=>({signal:controller.signal,paused:()=>paused||document.hidden,fast:false,audio});
const base=[0,0,0,3,4, 1,2,3,4,5, 2,3,4,5,0, 3,4,5,0,1];
const replacement=[1,2,3,3,4, 1,2,3,4,5, 2,3,4,5,0, 3,4,5,0,1];
const cell=(symbol:number)=>'<div class="np-cell" role="gridcell" data-symbol="'+symbol+'">'+symbolArt(symbol)+'</div>';
const draw=(grid:number[])=>{board.innerHTML=Array.from({length:4},(_,row)=>'<div role="row" class="np-row">'+grid.slice(row*5,row*5+5).map(cell).join('')+'</div>').join('');};
const wins=evaluateLines(base);
const frame:Frame={kind:'win',grid:base,emblems:Array(20).fill(-1),cells:[...new Set(wins.flatMap(win=>win.cells))],wins,points:wins.reduce((sum,win)=>sum+win.points,0),battle:null};
function cancel() {controller.abort();controller=new AbortController();reels?.destroy();reels=undefined;audio.cancelEffects();effects.clear();feedback.clear();paused=false;root.dataset.paused='false';audio.pause(false);busy=false;draw(base);}
async function run(action:string) {
  if(action==='pause') {paused=!paused;root.dataset.paused=String(paused);audio.pause(paused);return;}
  if(action==='mute') {gameAudio.setMuted(!gameAudio.getPreferences().muted);return;}
  if(action==='cancel') {cancel();return;}
  cancel();busy=true;await audio.start();
  const current=controller;
  try {
    if(action==='reels') {
      const motor=new NeopolisReels(board,options(),()=>{});reels=motor;audio.spinning(true);
      await waitMotion(board,300,options());
      await motor.finish(Array.from({length:5},(_,col)=>Array.from({length:4},(_,row)=>cell(base[row*5+col]))));
      motor.destroy();if(reels===motor)reels=undefined;if(current===controller)audio.spinning(false);
    } else if(action==='combination') {
      feedback.setAmount(1000);await feedback.win(frame,1000,123450,options(),0);
    } else if(action==='cascade') {
      await dissolveNeopolisSymbols(board,[0,1,2,5,6,7],options());
      if(current.signal.aborted)return;
      draw(replacement);await dropNeopolisSymbols(board,[0,1,2,5,6,7],options());
    } else {
      feedback.setAmount(0);
      const payout=({loss:0,partial:4000,even:10000,win:25000,big:150000,epic:300000} as Record<string,number>)[action];
      await feedback.finish(payout,10000,options());
    }
  } finally {if(current===controller)busy=false;}
}
root.querySelectorAll<HTMLButtonElement>('[data-review]').forEach(button=>button.addEventListener('click',()=>{void run(button.dataset.review!);}));
gameAudio.install();draw(base);
(window as any).neopolisFeedbackReview={run,state:()=>({busy,paused,audio:audio.getState(),feedback:feedback.getState()}),
  setOutputDelay:(milliseconds:number)=>{extraDelay=milliseconds;delay!.delayTime.setValueAtTime(milliseconds/1000,gameAudio.context!.currentTime);},
  destroy:()=>{cancel();audio.destroy();effects.destroy();feedback.destroy();outputBus?.disconnect();delay?.disconnect();restoreClock?.();}};

import {t as translateText,tr} from '../i18n/index';
import {confirmedPayout} from '../shared/roundPrecision';
import type {ConvoyView} from '../shared/lastConvoy';
import {convoySymbol} from './ConvoyArtwork';
import type {ConvoyBoard} from './ConvoyBoard';
import type {LastConvoyAudio} from './LastConvoyAudio';
import {slotCoins as coins} from './slotKit/SlotScreens';
import type {SlotOperation} from './slotKit/SlotPlayback';
import type {NativeSlotSession} from './slotKit/SlotSessions';

export type ConvoyMotionOperation=SlotOperation&{motion:boolean;fast:boolean};
type Session=NativeSlotSession<'convoy'>;
export type ConvoyMotionOptions={
 root:HTMLElement;
 board:Pick<ConvoyBoard,'setPins'|'begin'|'settle'|'clearOverlay'|'show'|'highlight'|'remove'|'gravity'|'cancel'>;
 audio:Pick<LastConvoyAudio,'begin'|'stopSpin'|'stopReel'|'feature'|'cascade'|'drop'|'tickets'|'outcome'>;
 current(operation:SlotOperation):boolean;
 delay(ms:number,operation:SlotOperation):Promise<boolean>;
 total(value:string|number):void;
 factor(value:number):void;
 tickets(count:number,free:boolean):void;
 features(view:ConvoyView):void;
};
export interface ConvoyMotionPort{
 begin(operation:ConvoyMotionOperation,pins:readonly number[]):void;
 phase(value:'accelerating'|'spinning'|'stopping'):void;
 land(column:number):void;
 present(session:Session,operation:ConvoyMotionOperation):Promise<boolean>;
 finish(operation:ConvoyMotionOperation):void;
 cancel():void;
 destroy():void;
}
export type ConvoyMotionFactory=(options:ConvoyMotionOptions)=>ConvoyMotionPort;

/** Owns presentation of existing convoy actions. Transport and settlement stay in the host. */
export class ConvoyMotion implements ConvoyMotionPort{
 private active?:ConvoyMotionOperation;
 private presented='';
 private destroyed=false;
 constructor(private options:ConvoyMotionOptions){}
 private current(operation:ConvoyMotionOperation){return !this.destroyed&&this.active===operation&&this.options.current(operation);}
 private find(selector:string){return this.options.root.querySelector<HTMLElement>(selector)!;}
 private async wait(ms:number,operation:ConvoyMotionOperation){
  return this.current(operation)&&await this.options.delay(ms,operation)&&this.current(operation);
 }
 begin(operation:ConvoyMotionOperation,pins:readonly number[]){
  if(this.destroyed||!this.options.current(operation))return;
  this.cancel();this.active=operation;
  const {root,board,audio}=this.options;
  root.dataset.animationToken=operation.token;root.dataset.phase='spinning';
  this.find('[data-cc-groups]').replaceChildren();board.highlight([]);board.setPins(pins);
  board.begin(operation.token,operation.motion,operation.fast);void audio.begin(operation.token);
 }
 phase(value:'accelerating'|'spinning'|'stopping'){
  if(this.active&&this.current(this.active))this.options.root.dataset.phase=value;
 }
 land(column:number){if(this.active&&this.current(this.active))this.options.audio.stopReel(column);}
 async present(session:Session,operation:ConvoyMotionOperation):Promise<boolean>{
  if(!this.current(operation))return false;
  const {root,board,audio,total,factor,tickets,features}=this.options;
  const view=session.view.convoy,spin=view.spin,key=`${operation.account}:${session.id}:${view.revision}`;
  if(this.presented===key)return false;
  this.presented=key;root.dataset.sessionId=session.id;root.dataset.revision=String(view.revision);
  if(!spin){audio.stopSpin();features(view);return true;}
  let paid=BigInt(view.totalPayoutUnits)-BigInt(spin.payoutUnits);
  total(String(paid));factor(spin.multiplierBefore);
  if(!await board.settle(operation.token,spin.initialGrid)||!this.current(operation))return false;
  audio.stopSpin();tickets(spin.initialGrid.filter(n=>n===7).length,spin.kind==='free');
  for(const frame of spin.frames){
   if(!this.current(operation))return false;
   board.clearOverlay();board.show(frame.before);board.highlight(frame.wins.flatMap(win=>win.positions));
   if(frame.addedPins.length){
    root.dataset.phase='energy';root.dataset.charging='true';
    this.find('[data-cc-message]').textContent=tr`Баррикады добавляют +${frame.addedPins.length} к защите`;
    audio.feature('barricade');
    if(operation.motion&&!await this.wait(operation.fast?220:550,operation))return false;
    factor(frame.multiplierAfter);root.dataset.charging='false';
   }
   if(!frame.wins.length)break;
   root.dataset.phase='winning';
   this.find('[data-cc-message]').textContent=tr`КАСКАД ${frame.index+1} · МНОЖИТЕЛЬ ×${frame.multiplierAfter}`;
   this.find('[data-cc-groups]').innerHTML=frame.wins.map(win=>`<span>${convoySymbol(win.symbol)}<b>${coins(win.payoutUnits)}</b></span>`).join('');
   paid+=BigInt(frame.payoutUnits);total(String(paid));audio.cascade(frame.index);
   if(operation.motion&&!await this.wait(operation.fast?120:380,operation))return false;
   if(frame.removed.length){
    root.dataset.phase='bursting';board.remove(frame.removed);
    if(operation.motion&&!await this.wait(operation.fast?100:230,operation))return false;
    root.dataset.phase='falling';audio.drop();
    if(operation.motion){board.gravity(frame,operation.fast);if(!await this.wait(operation.fast?260:560,operation))return false;}
    board.clearOverlay();board.show(frame.after);board.highlight([]);
    tickets(frame.after.filter(n=>n===7).length,spin.kind==='free');
   }
  }
  if(!this.current(operation))return false;
  board.clearOverlay();board.show(spin.finalGrid);board.highlight([]);features(view);total(confirmedPayout(session,view.totalPayoutUnits));
  if(spin.freeAward){
   root.dataset.phase='tickets';
   this.find('[data-cc-message]').textContent=spin.kind==='free'?tr`ЕЩЁ ${spin.freeAward} БЕСПЛАТНЫХ ВРАЩЕНИЯ`:translateText('СИГНАЛ ПРИНЯТ · КОНВОЙ В ПУТИ');
   audio.tickets();if(operation.motion&&!await this.wait(operation.fast?250:850,operation))return false;
  }else this.find('[data-cc-message]').textContent=view.capped?translateText('ДОСТИГНУТ ПРЕДЕЛ ВЫИГРЫША'):spin.frames.at(-1)?.stop==='cascade-limit'?translateText('20 КАСКАДОВ · ВЫИГРЫШ СОХРАНЁН'):BigInt(spin.payoutUnits)>0n?translateText('ВЫИГРЫШ ПРИНЯТ'):session.state==='active'?translateText('ЭВАКУАЦИЯ ПРОДОЛЖАЕТСЯ'):translateText('ПРОДОЛЖАЕМ ПОИСК ПРИПАСОВ');
  audio.outcome(BigInt(spin.payoutUnits)>0n);
  return operation.motion?this.wait(operation.fast?100:300,operation):this.current(operation);
 }
 finish(operation:ConvoyMotionOperation){
  if(!this.current(operation))return;
  this.active=undefined;this.reset();
 }
 private reset(){const {root}=this.options;root.dataset.phase='idle';root.dataset.charging='false';root.dataset.animationToken='';}
 cancel(){this.active=undefined;this.options.board.cancel();this.options.audio.stopSpin();this.reset();}
 destroy(){if(this.destroyed)return;this.cancel();this.destroyed=true;}
}

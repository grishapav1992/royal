import { isExpansionGame, validExpansionRulesVersion, validExpansionAction, type ExpansionAction, type ExpansionSession } from '../shared/casinoExpansion';
import { isVariantGame, validVariantView } from '../shared/casinoVariants';
import { isBatchVariantGame, validBatchVariantSettlement } from '../shared/casinoBatchVariants';
import { isStudioGame, validStudioSettings, validStudioSettlement, validStudioEnvelope, studioSamePayload } from '../shared/studioGames';
import { WALLET_ACCOUNT_HEADER } from '../shared/walletAccount';
import type { DemoWallet } from '../shared/demoWallet';
import { demoWallet } from './WalletClient';
export type NewExpansionAction = ExpansionAction extends infer T ? T extends ExpansionAction ? Omit<T,'id'> : never : never;
type Reply={wallet:DemoWallet;sessions:ExpansionSession[];session?:ExpansionSession;replayed?:boolean};
function validSession(s:ExpansionSession){return !!s&&isExpansionGame(s.gameId)&&validExpansionRulesVersion(s.gameId,s.rulesVersion)&&['active','settled'].includes(s.state)
  &&typeof s.id==='string'&&/^[a-f0-9-]{36}$/i.test(s.id)&&[s.stakeUnits,s.spentUnits,s.returnedUnits].every(n=>typeof n==='string'&&/^[0-9]{1,15}$/.test(n))
  &&!!s.view&&[s.view.player,s.view.dealer,s.view.community].every(a=>Array.isArray(a)&&a.every(c=>typeof c==='string'))
  &&Array.isArray(s.view.actions)&&s.view.actions.every(a=>typeof a.move==='string'&&typeof a.label==='string'&&Number.isSafeInteger(a.cost)&&a.cost>=0&&[a.perPick,a.minPicks,a.maxPicks].every(n=>n===undefined||Number.isSafeInteger(n)&&n>=0))
  &&(s.view.hands===undefined||Array.isArray(s.view.hands)&&s.view.hands.every(h=>Array.isArray(h.cards)&&h.cards.every(c=>typeof c==='string')&&typeof h.label==='string'&&typeof h.active==='boolean'&&Number.isSafeInteger(h.score)))
  &&(isVariantGame(s.gameId)?validVariantView(s.view.variant,s.gameId,s.state==='settled'):s.view.variant===undefined)
  &&(!isBatchVariantGame(s.gameId)||validBatchVariantSettlement(s.gameId,s.state,s.stakeUnits,s.spentUnits,s.returnedUnits,s.view.variant))
  &&(isStudioGame(s.gameId)?validStudioSettlement(s.gameId,s.state,s.stakeUnits,s.spentUnits,s.returnedUnits,s.view.studio)&&validStudioEnvelope(s.gameId,s.state,s.view):s.view.studio===undefined)
  &&typeof s.view.message==='string';}
function validStudioStart(s:ExpansionSession,op:ExpansionAction){
  if(op.action!=='start'||!isStudioGame(op.gameId))return true;
  if(s.stakeUnits!==op.stakeUnits||!validStudioSettings(op.gameId,op.settings)||!s.view.studio)return false;
  const choice=op.settings.studio as Record<string,unknown>,view=s.view.studio;
  switch(view.kind){
    case 'keno':return Array.isArray(choice.numbers)&&studioSamePayload(view.numbers,[...choice.numbers].sort((a,b)=>a-b))&&view.target===choice.target;
    case 'plinko':return view.risk===choice.risk;
    case 'dice':return view.chance===choice.chance&&view.direction===choice.direction;
    case 'wheel':return view.target===choice.target;
    default:return true;
  }
}
export class ExpansionClient extends EventTarget {
  accountId:string|null=null;sessions:ExpansionSession[]=[];wallet?:DemoWallet;pending?:ExpansionAction;busy=false;loading=false;error='';private epoch=0;private version=0;
  private key(){return 'royal-expansion:'+this.accountId;}
  private notify(){this.dispatchEvent(new Event('change'));}
  private lock(){demoWallet.setExternalBusy('expansion',!!this.pending);}
  setAccount(id:string|null){
    if(id===this.accountId)return;this.epoch++;this.version++;this.accountId=id;this.wallet=undefined;this.sessions=[];this.pending=undefined;this.busy=false;this.loading=false;this.error='';
    if(id){try{const saved=sessionStorage.getItem(this.key());if(saved){const op=JSON.parse(saved);if(!validExpansionAction(op))throw Error();this.pending=op;}}catch{this.error='Не удалось восстановить ход. Проверь баланс.';}}
    this.lock();this.notify();if(id)void this.refresh();
  }
  private valid(r:Reply,op?:ExpansionAction){return !!r&&!!r.wallet&&Number.isFinite(r.wallet.balance)&&r.wallet.balance>=0&&Array.isArray(r.wallet.entries)
    &&Array.isArray(r.sessions)&&r.sessions.every(validSession)&&new Set(r.sessions.map(s=>s.gameId)).size===r.sessions.length
    &&(!op||!!r.session&&validSession(r.session)&&r.session.gameId===op.gameId&&r.session.id===(op.action==='start'?op.id:op.sessionId)&&typeof r.replayed==='boolean'
      &&(!isStudioGame(op.gameId)||validStudioStart(r.session,op)&&r.sessions.some(s=>s.gameId===op.gameId)&&(r.replayed===true||r.sessions.some(s=>s.gameId===op.gameId&&s.id===r.session!.id))&&r.sessions.every(s=>s.id!==r.session!.id||s.gameId!==r.session!.gameId||studioSamePayload(s,r.session))));}
  private accept(r:Reply){this.wallet=r.wallet;this.sessions=r.sessions;demoWallet.acceptExternalWallet(this.accountId!,r.wallet);}
  private message(e:unknown){return e instanceof Error&&/[а-я]/i.test(e.message)?e.message:'Ответ не получен. Нажми «Проверить ход», чтобы подтвердить ту же операцию.';}
  async refresh(){
    if(!this.accountId||this.busy||this.loading)return;const epoch=this.epoch,version=++this.version,account=this.accountId;this.loading=true;
    try{const response=await fetch('/api/demo-wallet/expansion',{credentials:'same-origin',cache:'no-store',headers:{[WALLET_ACCOUNT_HEADER]:account},signal:AbortSignal.timeout(10000)});const r=await response.json();
      if(!response.ok)throw Error(r.error);if(!this.valid(r))throw Error('Баланс и партия не подтверждены.');if(epoch!==this.epoch||version!==this.version)return;this.accept(r);this.error='';
    }catch(e){if(epoch===this.epoch&&version===this.version)this.error=this.message(e);}
    finally{if(epoch===this.epoch&&version===this.version){this.loading=false;this.notify();}}
  }
  async act(action:NewExpansionAction){if(this.pending)throw Error('Сначала проверь предыдущий ход.');return this.send({...action,id:crypto.randomUUID()} as ExpansionAction);}
  async retry(){if(this.pending)return this.send(this.pending);}
  private async send(op:ExpansionAction){
    if(!this.accountId||this.busy)throw Error('Войди в аккаунт и дождись завершения хода.');
    if(demoWallet.busy||demoWallet.pending||demoWallet.hasExternalBusy('expansion'))throw Error('Сначала проверь предыдущую операцию кошелька.');
    const epoch=this.epoch,account=this.accountId,key=this.key();try{sessionStorage.setItem(key,JSON.stringify(op));}catch{throw Error('Разреши хранилище браузера для сохранения хода.');}
    this.pending=op;this.busy=true;this.loading=false;this.version++;this.error='';this.lock();this.notify();
    try{const response=await fetch('/api/demo-wallet/expansion',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json',[WALLET_ACCOUNT_HEADER]:account,'X-Royal-Card-Rules':'2'},body:JSON.stringify(op),signal:AbortSignal.timeout(15000)});const r=await response.json();
      if(epoch!==this.epoch)return;if(!response.ok){if([400,403,404,409].includes(response.status)){this.pending=undefined;sessionStorage.removeItem(key);}throw Error(r.error);}
      if(!this.valid(r,op))throw Error('Ход не подтверждён. Проверь ту же операцию.');this.accept(r);this.pending=undefined;sessionStorage.removeItem(key);this.version++;
    }catch(e){if(epoch===this.epoch){this.error=this.message(e);throw Error(this.error);}}
    finally{if(epoch===this.epoch){this.busy=false;this.lock();this.notify();if(!this.pending&&this.error)void this.refresh();}}
  }
}
export const expansionClient=new ExpansionClient();
demoWallet.addEventListener('change',()=>expansionClient.setAccount(demoWallet.accountId));

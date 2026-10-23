import { NEOPOLIS_GAME, NEOPOLIS_HEADER, validNeopolisSession, validNeopolisSettings } from '../shared/neopolis';
import {DRACONA_GAME,DRACONA_CLIENT_HEADER,validDraconaSession,validDraconaSettings} from '../shared/dracona';
import { PENALTY_CLIENT_HEADER, PENALTY_GAME, validPenaltySession, validPenaltySettings } from '../shared/crLeo';
import { isUserMessage, t as translateText } from '../i18n/index';
import {AFTER_PROGRESS_HEADER,AFTER_PROGRESS_VERSION} from '../shared/afterglowWardrobe';
import {MEME_CLIENT_HEADER,MEME_GAME,isNitroFamily,validMemeSession} from '../shared/memeOverload';
import {AFTER_GAME,AFTER_CLIENT_HEADER,validAfterSettings,validAfterSession} from '../shared/afterglow';
import {NITRO_GAME,NITRO_CLIENT_HEADER,validNitroSettings,validNitroSession} from '../shared/nitroRun';
import {CONVOY_GAME,CONVOY_CLIENT_HEADER,validConvoySettings,validConvoySettlement,validConvoyEnvelope} from '../shared/lastConvoy';
import {VELVET_CLIENT_HEADER} from '../shared/velvetReign';
import {CARAMEL_GAME,CARAMEL_CLIENT_HEADER,validCaramelSettings,validCaramelSettlement,validCaramelEnvelope} from '../shared/caramelCarnival';
import {isLuelonSlotGame,validLuelonSlotSettings,validLuelonSlotSettlement,validLuelonSlotEnvelope,LUELON_SLOT_INFO} from '../shared/luelonSlots';
import { isExpansionGame, validExpansionRulesVersion, validExpansionAction, type ExpansionAction, type ExpansionSession } from '../shared/casinoExpansion';
import { isVariantGame, validVariantView } from '../shared/casinoVariants';
import { isBatchVariantGame, validBatchVariantSettlement } from '../shared/casinoBatchVariants';
import { isStudioGame, validStudioSettings, validStudioSettlement, validStudioEnvelope, studioSamePayload } from '../shared/studioGames';
import { WALLET_ACCOUNT_HEADER } from '../shared/walletAccount';
import type { DemoWallet } from '../shared/demoWallet';
import { demoWallet } from './WalletClient';
export type NewExpansionAction = ExpansionAction extends infer T ? T extends ExpansionAction ? Omit<T,'id'> : never : never;
type Reply={wallet:DemoWallet;sessions:ExpansionSession[];session?:ExpansionSession;replayed?:boolean};
function validSession(s:ExpansionSession){if(s?.gameId===NEOPOLIS_GAME)return validNeopolisSession(s);if(s?.gameId===DRACONA_GAME)return validDraconaSession(s);if(s?.gameId===PENALTY_GAME)return validPenaltySession(s);if(s?.gameId===AFTER_GAME)return validAfterSession(s);if(s?.gameId===MEME_GAME)return validMemeSession(s);if(s?.gameId===NITRO_GAME)return validNitroSession(s);return !!s&&isExpansionGame(s.gameId)&&validExpansionRulesVersion(s.gameId,s.rulesVersion)&&['active','settled'].includes(s.state)
  &&typeof s.id==='string'&&/^[a-f0-9-]{36}$/i.test(s.id)&&[s.stakeUnits,s.spentUnits,s.returnedUnits].every(n=>typeof n==='string'&&/^[0-9]{1,15}$/.test(n))
  &&!!s.view&&[s.view.player,s.view.dealer,s.view.community].every(a=>Array.isArray(a)&&a.every(c=>typeof c==='string'))
  &&Array.isArray(s.view.actions)&&s.view.actions.every(a=>typeof a.move==='string'&&typeof a.label==='string'&&Number.isSafeInteger(a.cost)&&a.cost>=0&&[a.perPick,a.minPicks,a.maxPicks].every(n=>n===undefined||Number.isSafeInteger(n)&&n>=0))
  &&(s.view.hands===undefined||Array.isArray(s.view.hands)&&s.view.hands.every(h=>Array.isArray(h.cards)&&h.cards.every(c=>typeof c==='string')&&typeof h.label==='string'&&typeof h.active==='boolean'&&Number.isSafeInteger(h.score)))
  &&(isVariantGame(s.gameId)?validVariantView(s.view.variant,s.gameId,s.state==='settled'):s.view.variant===undefined)
  &&(!isBatchVariantGame(s.gameId)||validBatchVariantSettlement(s.gameId,s.state,s.stakeUnits,s.spentUnits,s.returnedUnits,s.view.variant))
  &&(s.gameId===CONVOY_GAME
    ?s.rulesVersion===2&&Object.keys(s).sort().join(',')==='gameId,id,returnedUnits,rulesVersion,spentUnits,stakeUnits,state,view'&&validConvoySettlement(s.state,s.stakeUnits,s.spentUnits,s.returnedUnits,s.view.convoy)&&validConvoyEnvelope(s.state,s.view)
    :s.view.convoy===undefined&&(s.gameId===CARAMEL_GAME&&s.rulesVersion===2
    ?Object.keys(s).sort().join(',')==='gameId,id,returnedUnits,rulesVersion,spentUnits,stakeUnits,state,view'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s.id)&&s.view.studio===undefined&&s.view.luelon===undefined&&validCaramelSettlement(s.state,s.stakeUnits,s.spentUnits,s.returnedUnits,s.view.caramel)&&validCaramelEnvelope(s.state,s.view)
    :s.view.caramel===undefined&&(s.rulesVersion===2&&isLuelonSlotGame(s.gameId)
    ?Object.keys(s).sort().join(',')==='gameId,id,returnedUnits,rulesVersion,spentUnits,stakeUnits,state,view'
      &&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s.id)&&s.view.studio===undefined
      &&validLuelonSlotSettlement(s.gameId,s.state,s.stakeUnits,s.spentUnits,s.returnedUnits,s.view.luelon)&&validLuelonSlotEnvelope(s.gameId,s.state,s.view)
    :s.view.luelon===undefined&&(isStudioGame(s.gameId)?validStudioSettlement(s.gameId,s.state,s.stakeUnits,s.spentUnits,s.returnedUnits,s.view.studio)&&validStudioEnvelope(s.gameId,s.state,s.view):s.view.studio===undefined)))
   )&&s.view.neopolis===undefined&&s.view.dracona===undefined&&s.view.afterglow===undefined&&s.view.nitro===undefined&&typeof s.view.message==='string';}
function validStudioStart(s:ExpansionSession,op:ExpansionAction){
  if(op.action!=='start'||!isStudioGame(op.gameId))return true;
  if(op.gameId===NEOPOLIS_GAME)return [1,2].includes(s.rulesVersion)&&s.stakeUnits===op.stakeUnits&&validNeopolisSettings(op.settings)&&s.view.neopolis?.origin.starter===op.settings.neopolis.hero;
  if(op.gameId===DRACONA_GAME)return s.rulesVersion===2&&s.stakeUnits===op.stakeUnits&&validDraconaSettings(op.settings);
  if(op.gameId===AFTER_GAME)return s.rulesVersion===2&&s.stakeUnits===op.stakeUnits&&validAfterSettings(op.settings);
  if(isNitroFamily(op.gameId))return s.rulesVersion===2&&s.stakeUnits===op.stakeUnits&&validNitroSettings(op.settings);
  if(op.gameId===CONVOY_GAME)return s.rulesVersion===2&&s.stakeUnits===op.stakeUnits&&validConvoySettings(op.settings);
  if(s.rulesVersion===2&&op.gameId===CARAMEL_GAME)return s.stakeUnits===op.stakeUnits&&validCaramelSettings(op.settings)&&s.view.caramel?.mode===op.settings.caramel.mode;
  if(s.rulesVersion===2&&isLuelonSlotGame(op.gameId))return s.stakeUnits===op.stakeUnits&&validLuelonSlotSettings(op.gameId,op.settings)&&s.view.luelon?.mode===op.settings.luelon.mode;
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
function validAfterReply(s:ExpansionSession,op:ExpansionAction,replayed:boolean){
 if(op.gameId!==AFTER_GAME)return true;const v=s.view.afterglow;if(s.rulesVersion!==2||!v)return false;
 return op.action==='start'?validAfterSettings(op.settings)&&(replayed||v.revision===1):typeof op.revision==='number'&&v.revision>op.revision&&(replayed||v.revision===op.revision+1);
}
function validNitroReply(s:ExpansionSession,op:ExpansionAction,replayed:boolean){
 if(!isNitroFamily(op.gameId))return true;const v=s.view.nitro;if(s.rulesVersion!==2||!v)return false;
 return op.action==='start'?validNitroSettings(op.settings)&&(replayed||v.revision===1):typeof op.revision==='number'&&v.revision>op.revision&&(replayed||v.revision===op.revision+1);
}
function validConvoyReply(s:ExpansionSession,op:ExpansionAction,replayed:boolean){
  if(op.gameId!==CONVOY_GAME)return true;const v=s.view.convoy;if(s.rulesVersion!==2||!v)return false;
  return op.action==='start'?validConvoySettings(op.settings)&&(replayed||v.revision===1):typeof op.revision==='number'&&v.revision>op.revision&&(replayed||v.revision===op.revision+1);
}
function validCaramelReply(s:ExpansionSession,op:ExpansionAction,replayed:boolean){
  if(op.gameId!==CARAMEL_GAME||s.rulesVersion!==2)return true;
  const v=s.view.caramel;if(!v)return false;
  return op.action==='start'?validCaramelSettings(op.settings)&&(replayed||v.revision===(op.settings.caramel.mode==='festival'?0:1)):typeof op.revision==='number'&&v.revision>op.revision&&(replayed||v.revision===op.revision+1);
}
function validLuelonReply(s:ExpansionSession,op:ExpansionAction,replayed:boolean){
  if(!isLuelonSlotGame(op.gameId))return true;
  if(s.rulesVersion!==2)return op.action==='move'?op.revision===undefined:('studio' in op.settings);
  if(!s.view.luelon)return false;
  if(op.action==='start'){
    if(!isLuelonSlotGame(op.gameId)||!validLuelonSlotSettings(op.gameId,op.settings))return false;const selected=op.settings.luelon.mode;const mode=LUELON_SLOT_INFO[op.gameId]!.modes.find(m=>m.id===selected);return !!mode&&(replayed||s.view.luelon.revision===(mode.initialSpin?1:mode.bonus?0:1));}
  return isLuelonSlotGame(op.gameId)&&typeof op.revision==='number'&&s.view.luelon.revision>op.revision&&(replayed||s.view.luelon.revision===op.revision+1);
}
function validNeopolisReply(s:ExpansionSession,op:ExpansionAction,replayed:boolean){
 if(op.gameId!==NEOPOLIS_GAME)return true;const view=s.view.neopolis;if(!view)return false;
 return op.action==='start'?(replayed||view.revision===1):typeof op.revision==='number'&&view.revision>op.revision&&(replayed||view.revision===op.revision+1);
}
function validDraconaReply(s:ExpansionSession,op:ExpansionAction,replayed:boolean){
 if(op.gameId!==DRACONA_GAME)return true;const view=s.view.dracona;if(s.rulesVersion!==2||!view)return false;
 return op.action==='start'?validDraconaSettings(op.settings)&&(replayed||view.revision===1):typeof op.revision==='number'&&view.revision>op.revision&&(replayed||view.revision===op.revision+1);
}
export class ExpansionClient extends EventTarget {
  accountId:string|null=null;sessions:ExpansionSession[]=[];wallet?:DemoWallet;pending?:ExpansionAction;busy=false;loading=false;error='';private epoch=0;private version=0;
  private validatedSessions=new Map<string,string>();
  private checkedSession(s:ExpansionSession){
    if(!s||!isExpansionGame(s.gameId))return false;
    try{
      let cacheable=true;
      const serialized=JSON.stringify(s,function(key,value){
        const raw=this[key];
        if(raw===undefined||typeof raw==='function'||typeof raw==='symbol'||typeof raw==='number'&&!Number.isFinite(raw)
          ||raw!==null&&typeof raw==='object'&&(Object.hasOwn(raw,'toJSON')||Object.hasOwn(Object.prototype,'toJSON')||Array.isArray(raw)&&Object.hasOwn(Array.prototype,'toJSON')
            ||Object.getPrototypeOf(raw)!==(Array.isArray(raw)?Array.prototype:Object.prototype)||Object.values(Object.getOwnPropertyDescriptors(raw)).some(d=>!('value' in d))))cacheable=false;
        return value;
      });
      if(cacheable&&this.validatedSessions.get(s.gameId)===serialized)return true;
      if(!validSession(s))return false;
      if(cacheable)this.validatedSessions.set(s.gameId,serialized);
      return true;
    }catch{return false;}
  }
  private key(){return 'royal-nile-expansion:'+this.accountId;}
  private notify(){this.dispatchEvent(new Event('change'));}
  private lock(){demoWallet.setExternalBusy('expansion',!!this.pending);}
  setAccount(id:string|null){
    if(id===this.accountId)return;this.epoch++;this.version++;this.validatedSessions.clear();this.accountId=id;this.wallet=undefined;this.sessions=[];this.pending=undefined;this.busy=false;this.loading=false;this.error='';
    if(id){try{const saved=sessionStorage.getItem(this.key());if(saved){const op=JSON.parse(saved);if(!validExpansionAction(op))throw Error();this.pending=op;}}catch{this.error=translateText('Не удалось восстановить ход. Проверь баланс.');}}
    this.lock();this.notify();if(id)void this.refresh();
  }
  private valid(r:Reply,op?:ExpansionAction){return !!r&&!!r.wallet&&Number.isFinite(r.wallet.balance)&&r.wallet.balance>=0&&Array.isArray(r.wallet.entries)
    &&Array.isArray(r.sessions)&&r.sessions.every(s=>this.checkedSession(s))&&new Set(r.sessions.map(s=>s.gameId)).size===r.sessions.length
    &&(!op||!!r.session&&this.checkedSession(r.session)&&r.session.gameId===op.gameId&&r.session.id===(op.action==='start'?op.id:op.sessionId)&&typeof r.replayed==='boolean'
      &&(op.gameId!==PENALTY_GAME||(op.action==='start'?validPenaltySettings(op.settings)&&r.session.stakeUnits===op.stakeUnits&&r.session.view.penalty?.hero===op.settings.penalty.hero&&(r.session.view.penalty?.shots[0].risk??r.session.view.penalty?.risk)===op.settings.penalty.risk:r.session.view.penalty!.revision>op.revision!&&(r.replayed===true||r.session.view.penalty!.revision===op.revision!+1)&&(op.penaltyRisk===undefined||r.session.view.penalty!.shots[op.revision!]?.risk===op.penaltyRisk)))
      &&validNeopolisReply(r.session,op,r.replayed===true)&&validDraconaReply(r.session,op,r.replayed===true)&&validAfterReply(r.session,op,r.replayed===true)&&validNitroReply(r.session,op,r.replayed===true)&&validConvoyReply(r.session,op,r.replayed===true)&&validLuelonReply(r.session,op,r.replayed===true)&&validCaramelReply(r.session,op,r.replayed===true)
      &&(!isStudioGame(op.gameId)||validStudioStart(r.session,op)&&r.sessions.some(s=>s.gameId===op.gameId)&&(r.replayed===true||r.sessions.some(s=>s.gameId===op.gameId&&s.id===r.session!.id))&&r.sessions.every(s=>s.id!==r.session!.id||s.gameId!==r.session!.gameId||studioSamePayload(s,r.session))));}
  private accept(r:Reply){this.wallet=r.wallet;this.sessions=r.sessions;demoWallet.acceptExternalWallet(this.accountId!,r.wallet);}
  private message(e:unknown){return e instanceof Error&&isUserMessage(e.message)?translateText(e.message):translateText('Ответ не получен. Нажми «Проверить ход», чтобы подтвердить ту же операцию.');}
  async refresh(){
    if(!this.accountId||this.busy||this.loading)return;const epoch=this.epoch,version=++this.version,account=this.accountId;this.loading=true;
    try{const response=await fetch('/api/game-wallet/expansion',{credentials:'same-origin',cache:'no-store',headers:{[WALLET_ACCOUNT_HEADER]:account,[CARAMEL_CLIENT_HEADER]:'1',[VELVET_CLIENT_HEADER]:'1',[CONVOY_CLIENT_HEADER]:'1',[AFTER_CLIENT_HEADER]:'1',[AFTER_PROGRESS_HEADER]:AFTER_PROGRESS_VERSION,[NITRO_CLIENT_HEADER]:'1',[MEME_CLIENT_HEADER]:'1',[NEOPOLIS_HEADER]:'2',[DRACONA_CLIENT_HEADER]:'1',[PENALTY_CLIENT_HEADER]:'1'},signal:AbortSignal.timeout(10000)});const r=await response.json();
      if(epoch!==this.epoch||version!==this.version)return;if(!response.ok)throw Error(r.error);if(!this.valid(r))throw Error(translateText('Баланс и партия не подтверждены.'));this.accept(r);this.error='';
    }catch(e){if(epoch===this.epoch&&version===this.version)this.error=this.message(e);}
    finally{if(epoch===this.epoch&&version===this.version){this.loading=false;this.notify();}}
  }
  async act(action:NewExpansionAction){if(this.pending)throw Error(translateText('Сначала проверь предыдущий ход.'));return this.send({...action,id:crypto.randomUUID()} as ExpansionAction);}
  async retry(){if(this.pending)return this.send(this.pending);}
  private async send(op:ExpansionAction){
    if(!this.accountId||this.busy)throw Error(translateText('Войди в аккаунт и дождись завершения хода.'));
    if(demoWallet.busy||demoWallet.pending||demoWallet.hasExternalBusy('expansion'))throw Error(translateText('Сначала проверь предыдущую операцию кошелька.'));
    const epoch=this.epoch,account=this.accountId,key=this.key();try{sessionStorage.setItem(key,JSON.stringify(op));}catch{throw Error(translateText('Разреши хранилище браузера для сохранения хода.'));}
    this.pending=op;this.busy=true;this.loading=false;this.version++;this.error='';this.lock();this.notify();
    try{const response=await fetch('/api/game-wallet/expansion',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json',[WALLET_ACCOUNT_HEADER]:account,'X-Royal-Card-Rules':'2',[CARAMEL_CLIENT_HEADER]:'1',[VELVET_CLIENT_HEADER]:'1',[CONVOY_CLIENT_HEADER]:'1',[AFTER_CLIENT_HEADER]:'1',[AFTER_PROGRESS_HEADER]:AFTER_PROGRESS_VERSION,[NITRO_CLIENT_HEADER]:'1',[MEME_CLIENT_HEADER]:'1',[NEOPOLIS_HEADER]:'2',[DRACONA_CLIENT_HEADER]:'1',[PENALTY_CLIENT_HEADER]:'1'},body:JSON.stringify(op),signal:AbortSignal.timeout(15000)});const r=await response.json();
      if(epoch!==this.epoch)return;if(!response.ok){if([400,403,404,409].includes(response.status)){this.pending=undefined;sessionStorage.removeItem(key);}throw Error(r.error);}
      if(!this.valid(r,op))throw Error(translateText('Ход не подтверждён. Проверь ту же операцию.'));this.accept(r);this.pending=undefined;sessionStorage.removeItem(key);this.version++;
    }catch(e){if(epoch===this.epoch){this.error=this.message(e);throw Error(this.error);}}
    finally{if(epoch===this.epoch){this.busy=false;this.lock();this.notify();if(!this.pending&&this.error)void this.refresh();}}
  }
}
export const expansionClient=new ExpansionClient();
demoWallet.addEventListener('change',()=>expansionClient.setAccount(demoWallet.accountId));

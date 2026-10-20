import {DEMO_BETS} from './demoWallet';
import {exactPayoutUnits} from './originalGames';
import {rollLimboFromInteger,LIMBO_OUTCOME_COUNT} from '../../server/games/vfair/limbo/limbo-roll';

export type LimboPresentationGame='royal-limbo'|'variant-limbo';
export type LimboOutcome='loss'|'return'|'win'|'bigwin';
export type LimboPresentationTicket=Readonly<{
 ticketIndex:0|1;
 targetMultiplier:number;
 stakeUnits:string;
 won:boolean;
 returnedUnits:string;
}>;
type Common=Readonly<{
 outcomeId:string;
 stakeUnits:string;
 returnedUnits:string;
 rolledMultiplier:number;
 rolledCents:number;
 unallocatedStakeUnits:string;
 outcomeKind:LimboOutcome;
}>;
export type RoyalLimboPresentation=Common&Readonly<{
 gameId:'royal-limbo';
 targetMultiplier:number;
 paidMultiplier:number;
 won:boolean;
 tickets:readonly[LimboPresentationTicket];
}>;
export type VariantLimboPresentation=Common&Readonly<{
 gameId:'variant-limbo';
 target:3|5|10;
 tickets:readonly[LimboPresentationTicket,LimboPresentationTicket];
}>;
export type LimboPresentation=RoyalLimboPresentation|VariantLimboPresentation;

// Read data descriptors into a new record; rejected accessors are never invoked.
function data(value:unknown):Record<string,unknown>|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const prototype=Object.getPrototypeOf(value);
 if(prototype!==Object.prototype&&prototype!==null)return null;
 const row:Record<string,unknown>=Object.create(null);
 for(const key of Reflect.ownKeys(value)){
  if(typeof key!=='string')return null;
  const descriptor=Object.getOwnPropertyDescriptor(value,key);
  if(!descriptor||!Object.hasOwn(descriptor,'value'))return null;
  row[key]=descriptor.value;
 }
 return row;
}
const fields=(value:Record<string,unknown>,expected:string)=>Object.keys(value).sort().join(',')===expected.split(',').sort().join(',');
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const units=(value:unknown):value is string=>typeof value==='string'&&/^(0|[1-9][0-9]{0,14})$/.test(value);
const stake=(value:unknown):value is string=>units(value)&&DEMO_BETS.some(n=>String(n*100)===value);
function cents(value:unknown,min:number,max:number):number|null{
 if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max||!/^\d+(?:\.\d{1,2})?$/.test(String(value)))return null;
 const[whole,fraction='']=String(value).split('.');
 const result=Number(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')));
 return Number.isSafeInteger(result)?result:null;
}
function dense(value:unknown,length:number):unknown[]|null{
 if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype)return null;
 const keys=Reflect.ownKeys(value),len=Object.getOwnPropertyDescriptor(value,'length');
 if(!len||!Object.hasOwn(len,'value')||len.value!==length||keys.length!==length+1)return null;
 const result:unknown[]=[];
 for(let i=0;i<length;i++){
  const descriptor=Object.getOwnPropertyDescriptor(value,String(i));
  if(!descriptor||!Object.hasOwn(descriptor,'value'))return null;
  result.push(descriptor.value);
 }
 return keys.every(key=>key==='length'||typeof key==='string'&&/^(0|[1-9][0-9]*)$/.test(key)&&Number(key)<length)?result:null;
}
// A deterministic lookup validates this current public value. It draws no RNG and exposes no seed or future result.
function reachableRoll(value:number):boolean{
 let lo=0,hi=LIMBO_OUTCOME_COUNT;
 while(lo<hi){const mid=Math.floor((lo+hi)/2);if(rollLimboFromInteger(mid,.98)>value)lo=mid+1;else hi=mid;}
 return lo<LIMBO_OUTCOME_COUNT&&rollLimboFromInteger(lo,.98)===value;
}
function kind(stakeUnits:string,returnedUnits:string):LimboOutcome{
 const total=BigInt(returnedUnits),amount=BigInt(stakeUnits);
 return total===0n?'loss':total<=amount?'return':total>=amount*4n?'bigwin':'win';
}
function ticket(index:0|1,target:number,allocated:string,roll:number):LimboPresentationTicket{
 const won=roll>=target,returnedUnits=won?exactPayoutUnits(BigInt(allocated),target).toString():'0';
 return Object.freeze({ticketIndex:index,targetMultiplier:target,stakeUnits:allocated,won,returnedUnits});
}

/** Cold Royal wallet/ledger data cannot supply a roll. The caller must bind an actual captured play response and current account. */
export function royalLimboPresentation(capturedOperation:unknown,gameRound:unknown):RoyalLimboPresentation|null{
 try{
  const op=data(capturedOperation),round=data(gameRound);
  if(!op||!round||!fields(op,'id,kind,amount,gameId,rulesVersion,input')||!uuid(op.id)||op.kind!=='play'||op.gameId!=='royal-limbo'||op.rulesVersion!==1||!(DEMO_BETS as readonly unknown[]).includes(op.amount)
   ||!fields(round,'gameId,rulesVersion,stakeUnits,payoutUnits,input,outcome,multiplier')||round.gameId!=='royal-limbo'||round.rulesVersion!==1||!stake(round.stakeUnits)||!units(round.payoutUnits)||round.stakeUnits!==String(Number(op.amount)*100))return null;
  const capture=data(op.input),input=data(round.input),outcome=data(round.outcome);
  if(!capture||!input||!outcome||!fields(capture,'targetMultiplier')||!fields(input,'targetMultiplier')||!fields(outcome,'rolledMultiplier,won')||capture.targetMultiplier!==input.targetMultiplier||typeof outcome.won!=='boolean')return null;
  const targetCents=cents(input.targetMultiplier,1.01,1000000),rolledCents=cents(outcome.rolledMultiplier,1,1000000);
  if(targetCents===null||rolledCents===null||!reachableRoll(outcome.rolledMultiplier as number))return null;
  const target=input.targetMultiplier as number,rolled=outcome.rolledMultiplier as number,award=ticket(0,target,round.stakeUnits,rolled),paidMultiplier=award.won?target:0;
  if(outcome.won!==award.won||round.multiplier!==paidMultiplier||round.payoutUnits!==award.returnedUnits)return null;
  return Object.freeze({gameId:'royal-limbo',outcomeId:op.id,stakeUnits:round.stakeUnits,returnedUnits:award.returnedUnits,rolledMultiplier:rolled,rolledCents,targetMultiplier:target,paidMultiplier,won:award.won,unallocatedStakeUnits:'0',outcomeKind:kind(round.stakeUnits,award.returnedUnits),tickets:Object.freeze([award] as const)});
 }catch{return null;}
}

/** Omit a captured start only for an already confirmed static canonical session. Live provenance remains caller-owned. */
export function variantLimboPresentation(canonicalSession:unknown,capturedStart?:unknown):VariantLimboPresentation|null{
 try{
  const s=data(canonicalSession);
  if(!s||!fields(s,'id,gameId,rulesVersion,state,stakeUnits,spentUnits,returnedUnits,view')||!uuid(s.id)||s.gameId!=='variant-limbo'||s.rulesVersion!==1||s.state!=='settled'||!stake(s.stakeUnits)||s.spentUnits!==s.stakeUnits||!units(s.returnedUnits))return null;
  const view=data(s.view);
  if(!view||!fields(view,'player,dealer,community,actions,phase,ended,message,variant')||view.phase!==1||view.ended!==true||typeof view.message!=='string'||![view.player,view.dealer,view.community,view.actions].every(a=>dense(a,0)!==null))return null;
  const result=data(view.variant);
  if(!result||!fields(result,'kind,target,rolled,tickets')||result.kind!=='limbo'||(result.target!==3&&result.target!==5&&result.target!==10))return null;
  const rolledCents=cents(result.rolled,1,1000000),savedTickets=dense(result.tickets,2);
  if(rolledCents===null||!savedTickets||!reachableRoll(result.rolled as number))return null;
  if(capturedStart!==undefined){
   const op=data(capturedStart);
   if(!op||!fields(op,'id,gameId,action,stakeUnits,settings')||op.id!==s.id||op.gameId!==s.gameId||op.action!=='start'||op.stakeUnits!==s.stakeUnits)return null;
   const settings=data(op.settings),input=settings&&data(settings.variant);
   if(!settings||!fields(settings,'variant')||!input||!fields(input,'target')||input.target!==result.target)return null;
  }
  const whole=BigInt(s.stakeUnits),half=(whole/2n).toString(),rolled=result.rolled as number,first=ticket(0,1.5,half,rolled),second=ticket(1,result.target,half,rolled),tickets=Object.freeze([first,second] as const);
  for(let i=0;i<2;i++){
   const saved=data(savedTickets[i]),award=tickets[i];
   if(!saved||!fields(saved,'target,won,returnedUnits')||saved.target!==award.targetMultiplier||saved.won!==award.won||saved.returnedUnits!==award.returnedUnits)return null;
  }
  const total=(BigInt(first.returnedUnits)+BigInt(second.returnedUnits)).toString();
  if(s.returnedUnits!==total)return null;
  return Object.freeze({gameId:'variant-limbo',outcomeId:s.id,stakeUnits:s.stakeUnits,returnedUnits:total,rolledMultiplier:rolled,rolledCents,target:result.target,unallocatedStakeUnits:(whole-2n*BigInt(half)).toString(),outcomeKind:kind(s.stakeUnits,total),tickets});
 }catch{return null;}
}

import {DEMO_BETS} from './demoWallet';
import {studioWheelSegments,studioWheelMultiplier} from './studioGames';

export type WheelSpinPresentationGameId = 'studio-saffron-spin'|'studio-lucky-spotlight';
export type WheelSpinTarget = 0|1|2|3;
export type WheelSpinPresentation = Readonly<{
  gameId:WheelSpinPresentationGameId;
  outcomeId:string;
  target:WheelSpinTarget;
  sector:number;
  segments:readonly WheelSpinTarget[];
  sectorValue:WheelSpinTarget;
  won:boolean;
  multiplier:number;
  fixedMultiplier:number;
  stakeUnits:string;
  returnedUnits:string;
  targetProbability:Readonly<{count:number;length:12|16}>;
}>;

const record=(value:unknown):value is Record<string,unknown>=>{
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const prototype=Object.getPrototypeOf(value);
  return(prototype===Object.prototype||prototype===null)&&Reflect.ownKeys(value).every(key=>
    typeof key==='string'&&Object.hasOwn(Object.getOwnPropertyDescriptor(value,key)!,'value'));
};
const fields=(value:Record<string,unknown>,expected:string)=>Reflect.ownKeys(value).sort().join(',')===expected.split(',').sort().join(',');
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const units=(value:unknown):value is string=>typeof value==='string'&&/^(0|[1-9][0-9]{0,14})$/.test(value);
const dense=(value:unknown,length:number):value is unknown[]=>Array.isArray(value)&&Object.getPrototypeOf(value)===Array.prototype&&value.length===length
  &&Reflect.ownKeys(value).length===length+1&&Array.from({length},(_,index)=>Object.hasOwn(value,index)
    &&Object.hasOwn(Object.getOwnPropertyDescriptor(value,String(index))!,'value')).every(Boolean);
const game=(value:unknown):value is WheelSpinPresentationGameId=>value==='studio-saffron-spin'||value==='studio-lucky-spotlight';
const target=(value:unknown):value is WheelSpinTarget=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=3;

function binding(request:unknown,session:Record<string,unknown>,selected:WheelSpinTarget):boolean{
  if(!record(request)||!fields(request,'id,action,gameId,stakeUnits,settings')||request.action!=='start'||request.id!==session.id
    ||request.gameId!==session.gameId||request.stakeUnits!==session.stakeUnits||!record(request.settings)||!fields(request.settings,'studio')
    ||!record(request.settings.studio)||!fields(request.settings.studio,'target'))return false;
  return request.settings.studio.target===selected;
}

/** Omit capturedStart only for a separately confirmed static receipt; the caller binds its account and epoch. */
export function wheelSpinPresentation(session:unknown,capturedStart?:unknown):WheelSpinPresentation|null{
  try{
    if(!record(session)||!fields(session,'id,gameId,rulesVersion,state,stakeUnits,spentUnits,returnedUnits,view')||!uuid(session.id)
      ||!game(session.gameId)||session.rulesVersion!==1||session.state!=='settled'||!units(session.stakeUnits)
      ||!DEMO_BETS.some(bet=>String(bet*100)===session.stakeUnits)||session.spentUnits!==session.stakeUnits||!units(session.returnedUnits)
      ||!record(session.view))return null;
    const view=session.view;
    if(!fields(view,'player,dealer,community,actions,phase,ended,message,studio')||view.phase!==1||view.ended!==true||typeof view.message!=='string'
      ||![view.player,view.dealer,view.community,view.actions].every(value=>dense(value,0))||!record(view.studio))return null;
    const current=view.studio,segments=studioWheelSegments(session.gameId),length=segments.length as 12|16;
    if(!fields(current,'kind,target,sector,segments,won,multiplier')||current.kind!=='wheel'||!target(current.target)||typeof current.sector!=='number'
      ||!Number.isSafeInteger(current.sector)||current.sector<0||current.sector>=length||!dense(current.segments,length)
      ||!current.segments.every((value,index)=>value===segments[index])||typeof current.won!=='boolean')return null;
    const multiplier=studioWheelMultiplier(session.gameId,current.target),fixedMultiplier=Math.round(multiplier*10000),sectorValue=segments[current.sector] as WheelSpinTarget;
    if(!Number.isFinite(multiplier)||!Number.isSafeInteger(fixedMultiplier)||fixedMultiplier<=0||Math.abs(multiplier*10000-fixedMultiplier)>0.000001
      ||current.multiplier!==multiplier||current.won!==(sectorValue===current.target)
      ||session.returnedUnits!==(current.won?(BigInt(session.stakeUnits)*BigInt(fixedMultiplier)/10000n).toString():'0')
      ||capturedStart!==undefined&&!binding(capturedStart,session,current.target))return null;
    return Object.freeze({gameId:session.gameId,outcomeId:session.id,target:current.target,sector:current.sector,
      segments:Object.freeze([...segments]) as readonly WheelSpinTarget[],sectorValue,won:current.won,multiplier,fixedMultiplier,
      stakeUnits:session.stakeUnits,returnedUnits:session.returnedUnits,
      targetProbability:Object.freeze({count:segments.filter(value=>value===current.target).length,length})});
  }catch{return null;}
}

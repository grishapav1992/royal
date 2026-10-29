import {
  TEMPLE_GAME,TEMPLE_MAX_WIN,TEMPLE_DATA,templeBaseMap,templeBonusMap,exploreTempleBase,startTempleBonus,applyTempleAction,templeLegalActions,
  validTempleBaseCase,validTempleBonusCase,validTempleMathAction,
  type TempleMap,type TempleBaseCase,type TempleBonusCase,type TempleAction,type TempleBaseResult,type TempleBonusState,
} from './floodedTempleMath';
export {TEMPLE_GAME,TEMPLE_MAX_WIN};
export const TEMPLE_CLIENT_HEADER='X-Royal-Temple-Rules';
export const TEMPLE_RULES_VERSION=1;
export type TempleSettings={temple:{mode:'normal'}};
export type TempleView={kind:'flooded-temple';version:1;stakeUnits:string;revision:number;phase:'bonus'|'complete';baseCase:TempleBaseCase;bonusCase:TempleBonusCase|null;baseMap:TempleMap;baseResult:TempleBaseResult;bonusMap:TempleMap|null;bonusState:TempleBonusState|null;history:TempleAction[];totalPayoutUnits:string};
export type TempleResult={view:TempleView;ended:boolean;credit:number;message:string;actions:{move:string;label:string;cost:number}[]};
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
export const validTempleStake=(stake:unknown):stake is string=>typeof stake==='string'&&TEMPLE_DATA.stakes.some(n=>String(n)===stake);
export function validTempleSettings(value:unknown):value is TempleSettings {
  return record(value)&&Object.keys(value).join(',')==='temple'&&record(value.temple)&&Object.keys(value.temple).join(',')==='mode'&&value.temple.mode==='normal';
}
export function rebuildTempleView(baseCase:TempleBaseCase,bonusCase:TempleBonusCase|null,stake:string,history:TempleAction[]=[]):TempleView {
  if(!validTempleStake(stake)||!validTempleBaseCase(baseCase)||!Array.isArray(history)||history.length>6||!history.every(validTempleMathAction))throw Error('Invalid temple round');
  const baseMap=templeBaseMap(baseCase),baseResult=exploreTempleBase(baseMap,stake);
  if(baseResult.bonus?!validTempleBonusCase(bonusCase):bonusCase!==null)throw Error('Invalid temple bonus selection');
  const bonusMap=bonusCase?templeBonusMap(bonusCase):null;
  let bonusState=bonusMap?startTempleBonus(bonusMap):null;
  if(!bonusMap&&history.length)throw Error('Temple round has no bonus');
  for(const action of history)bonusState=applyTempleAction(bonusMap!,bonusState!,action,stake,baseResult.payoutUnits);
  const phase=bonusState&&!bonusState.done?'bonus':'complete';
  return {kind:'flooded-temple',version:1,stakeUnits:stake,revision:1+history.length,phase,baseCase:structuredClone(baseCase),bonusCase:structuredClone(bonusCase),baseMap,baseResult,bonusMap,bonusState,history:structuredClone(history),totalPayoutUnits:String(BigInt(baseResult.payoutUnits)+BigInt(bonusState?.payoutUnits??'0'))};
}
const canonical=(value:unknown):string=>JSON.stringify(value,(_key,item)=>record(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
export function validTempleView(stake:unknown,value:unknown):value is TempleView {
  if(!validTempleStake(stake)||!record(value)||Object.keys(value).sort().join(',')!=='baseCase,baseMap,baseResult,bonusCase,bonusMap,bonusState,history,kind,phase,revision,stakeUnits,totalPayoutUnits,version')return false;
  if(value.kind!=='flooded-temple'||value.version!==1||!validTempleBaseCase(value.baseCase)||!(value.bonusCase===null||validTempleBonusCase(value.bonusCase))||!Array.isArray(value.history)||value.history.length>6||!value.history.every(validTempleMathAction))return false;
  try{return canonical(value)===canonical(rebuildTempleView(value.baseCase,value.bonusCase,stake,value.history));}catch{return false;}
}
export function validTempleSettlement(state:unknown,stake:unknown,spent:unknown,returned:unknown,value:unknown):value is TempleView {
  return validTempleView(stake,value)&&spent===stake&&(state==='active'?value.phase==='bonus'&&returned==='0':state==='settled'&&value.phase==='complete'&&returned===value.totalPayoutUnits);
}
export function validTempleSession(value:unknown):boolean {
  return record(value)&&value.gameId===TEMPLE_GAME&&value.rulesVersion===1&&record(value.view)&&validTempleSettlement(value.state,value.stakeUnits,value.spentUnits,value.returnedUnits,value.view.temple);
}
export function templeResult(view:TempleView):TempleResult {
  const ended=view.phase==='complete',kinds=new Set(view.bonusState&&view.bonusMap?templeLegalActions(view.bonusMap,view.bonusState).map(a=>a.kind):[]);
  return {view,ended,credit:ended?Number(view.totalPayoutUnits):0,message:ended?'Раунд завершён. Выплата начислена в общий кошелёк.':'Экспедиция сохранена. Продолжение без новой ставки.',actions:ended?[]:[
    ...(kinds.has('step')?[{move:'temple-step',label:'Перейти в комнату',cost:0}]:[]),
    ...(kinds.has('rope')?[{move:'temple-rope',label:'Пересечь провал',cost:0}]:[]),
    {move:'temple-finish',label:'Закончить поход',cost:0},
  ]};
}

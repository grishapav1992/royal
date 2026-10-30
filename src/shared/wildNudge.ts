import {WILD_NUDGE_GAME,WILD_NUDGE_RULES_VERSION,WILD_NUDGE_STAKES,WILD_NUDGE_DATA,drawWildNudgeSpin,wildNudgeSpin,settleWildNudgePoints,type NudgeSpin,type WildNudgeRandom} from './wildNudgeMath';
export {WILD_NUDGE_GAME};
export const WILD_NUDGE_CLIENT_HEADER='X-Royal-Wild-Nudge';
export const WILD_NUDGE_RESERVE_MULTIPLIER=8608;
export interface WildNudgeSettings {wildNudge:{mode:'normal'}}
export interface WildNudgeView {kind:'wild-nudge';version:1;stakeUnits:string;stage:'bonus'|'settled';revision:number;remaining:number;spins:NudgeSpin[];totalPayoutUnits:string}
export interface WildNudgeResult {view:WildNudgeView;ended:boolean;creditUnits:string;actions:{move:'wild-nudge-spin';label:string;cost:0}[];message:string}
export class WildNudgeMoveError extends Error {}
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const keys=(v:object)=>Object.keys(v).sort().join(',');
const canonical=(v:unknown):string=>JSON.stringify(v,(_key,value)=>object(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])):value);
export const validWildNudgeStake=(v:unknown):v is string=>typeof v==='string'&&WILD_NUDGE_STAKES.some(stake=>stake===v);
export function validWildNudgeSettings(v:unknown):v is WildNudgeSettings {return object(v)&&keys(v)==='wildNudge'&&object(v.wildNudge)&&keys(v.wildNudge)==='mode'&&v.wildNudge.mode==='normal';}
function makeView(stakeUnits:string,spins:NudgeSpin[]):WildNudgeView {
  const awarded=spins[0].awardedSpins,remaining=awarded-(spins.length-1);
  if(remaining<0)throw new WildNudgeMoveError('Too many bonus spins');
  return {kind:'wild-nudge',version:1,stakeUnits,stage:remaining?'bonus':'settled',revision:spins.length,remaining,spins,
    totalPayoutUnits:String(spins.reduce((n,spin)=>n+BigInt(settleWildNudgePoints(spin.points,stakeUnits)),0n))};
}
export function wildNudgeResult(view:WildNudgeView):WildNudgeResult {
  const ended=view.stage==='settled';
  return {view,ended,creditUnits:ended?view.totalPayoutUnits:'0',actions:ended?[]:[{move:'wild-nudge-spin',label:'Продолжить бесплатный бонус',cost:0}],message:ended?'Раунд завершён. Выплата подтверждена.':'Бонус сохранён. Продолжение бесплатно.'};
}
export function startWildNudgeRound(settings:unknown,stakeUnits:unknown,random:WildNudgeRandom):WildNudgeResult {
  if(!validWildNudgeSettings(settings)||!validWildNudgeStake(stakeUnits))throw new WildNudgeMoveError('Invalid Galactic Reactor start');
  return wildNudgeResult(makeView(stakeUnits,[drawWildNudgeSpin('base',random)]));
}
export function validWildNudgeView(value:unknown):value is WildNudgeView {
  try{
    if(!object(value)||value.version!==1||!validWildNudgeStake(value.stakeUnits)||!Array.isArray(value.spins)||value.spins.length<1||value.spins.length>9)return false;
    const spins=value.spins.map((spin:any,i:number)=>{
      if(!object(spin)||!Array.isArray(spin.reels)||spin.reels.length!==5)throw new WildNudgeMoveError('Invalid saved stops');
      return wildNudgeSpin(spin.reels.map((reel:any)=>reel?.stop),i?'bonus':'base');
    });
    return canonical(value)===canonical(makeView(value.stakeUnits,spins));
  }catch{return false;}
}
export function moveWildNudgeRound(value:unknown,stakeUnits:string,revision:unknown,move:unknown,random:WildNudgeRandom):WildNudgeResult {
  if(!validWildNudgeView(value)||value.stakeUnits!==stakeUnits||value.stage!=='bonus'||revision!==value.revision||move!=='wild-nudge-spin')throw new WildNudgeMoveError('Сохранённый этап изменился. Обнови раунд.');
  return wildNudgeResult(makeView(stakeUnits,[...structuredClone(value.spins),drawWildNudgeSpin('bonus',random)]));
}
export function wildNudgeExpansionView(view:WildNudgeView){
  const result=wildNudgeResult(view);
  return {player:[],dealer:[],community:[],wildNudge:view,actions:result.actions,phase:view.revision+1,ended:result.ended,message:result.message};
}
export function validWildNudgeSession(value:unknown):boolean {
  try{
    if(!object(value)||keys(value)!=='gameId,id,returnedUnits,rulesVersion,spentUnits,stakeUnits,state,view'||value.gameId!==WILD_NUDGE_GAME||value.rulesVersion!==WILD_NUDGE_RULES_VERSION||typeof value.id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.id)||!object(value.view)||!validWildNudgeView(value.view.wildNudge))return false;
    const view=value.view.wildNudge;
    return value.stakeUnits===view.stakeUnits&&value.spentUnits===view.stakeUnits&&value.state===(view.stage==='settled'?'settled':'active')&&value.returnedUnits===(value.state==='settled'?view.totalPayoutUnits:'0')&&canonical(value.view)===canonical(wildNudgeExpansionView(view));
  }catch{return false;}
}
export function validWildNudgeReply(session:any,op:any,replayed:boolean):boolean {
  if(op?.gameId!==WILD_NUDGE_GAME)return true;
  if(!validWildNudgeSession(session))return false;
  const view=session.view.wildNudge as WildNudgeView;
  return op.action==='start'?session.id===op.id&&session.stakeUnits===op.stakeUnits&&validWildNudgeSettings(op.settings)&&(replayed||view.revision===1):session.id===op.sessionId&&op.move==='wild-nudge-spin'&&Number.isSafeInteger(op.revision)&&view.revision>op.revision&&(replayed||view.revision===op.revision+1);
}
export const WILD_NUDGE_BONUS_SPINS=WILD_NUDGE_DATA.bonusSpins;

/** Common-stake rules 2. Historical rules 1 stay in wildNudge.ts unchanged. */
import {GAME_STAKE_UNITS,validGameStake} from './gameStakes';
import {precisionBaseSession} from './roundPrecision';
import {WILD_NUDGE_DATA,drawWildNudgeSpin,wildNudgeSpin,type NudgeSpin,type WildNudgeRandom} from './wildNudgeMath';
import {validWildNudgeSettings,validWildNudgeSession as validLegacySession,validWildNudgeStake as validLegacyStake,WildNudgeMoveError,type WildNudgeView as LegacyView,type WildNudgeResult as LegacyResult} from './wildNudge';
export {WILD_NUDGE_GAME,WILD_NUDGE_CLIENT_HEADER,WILD_NUDGE_RESERVE_MULTIPLIER,WildNudgeMoveError,validWildNudgeSettings} from './wildNudge';
export type {WildNudgeSettings} from './wildNudge';
export const STAR_SPIN_STAKES=GAME_STAKE_UNITS;
export type StarSpinView=Omit<LegacyView,'version'>&{version:2};
export type WildNudgeView=LegacyView|StarSpinView;
export type WildNudgeResult=Omit<LegacyResult,'view'>&{view:WildNudgeView};
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const canonical=(v:unknown):string=>JSON.stringify(v,(_key,value)=>object(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])):value);
export const validWildNudgeStake=(v:unknown):v is string=>validGameStake(v)||validLegacyStake(v);
function makeView(stakeUnits:string,spins:NudgeSpin[]):StarSpinView{
 const remaining=spins[0].awardedSpins-(spins.length-1);if(remaining<0)throw new WildNudgeMoveError('Too many bonus spins');
 const points=spins.reduce((n,spin)=>n+BigInt(spin.points),0n),denominator=BigInt(WILD_NUDGE_DATA.lines.length*WILD_NUDGE_DATA.payDenominator);
 return {kind:'wild-nudge',version:2,stakeUnits,stage:remaining?'bonus':'settled',revision:spins.length,remaining,spins,totalPayoutUnits:String(BigInt(stakeUnits)*points/denominator)};
}
export function wildNudgeResult(view:WildNudgeView):WildNudgeResult{const ended=view.stage==='settled';return{view,ended,creditUnits:ended?view.totalPayoutUnits:'0',actions:ended?[]:[{move:'wild-nudge-spin',label:'Продолжить бесплатный бонус',cost:0}],message:ended?'Раунд завершён. Выплата подтверждена.':'Бонус сохранён. Продолжение бесплатно.'};}
export function startStarSpin(settings:unknown,stakeUnits:unknown,draw:WildNudgeRandom):WildNudgeResult{if(!validWildNudgeSettings(settings)||!validGameStake(stakeUnits))throw new WildNudgeMoveError('Invalid Star Spin start');return wildNudgeResult(makeView(stakeUnits,[drawWildNudgeSpin('base',draw)]));}
export function validStarSpinView(v:unknown):v is StarSpinView{
 try{if(!object(v)||v.version!==2||!validGameStake(v.stakeUnits)||!Array.isArray(v.spins)||v.spins.length<1||v.spins.length>9)return false;
 const spins=v.spins.map((spin:any,i:number)=>{if(!object(spin)||!Array.isArray(spin.reels)||spin.reels.length!==5)throw Error('Invalid stops');return wildNudgeSpin(spin.reels.map((r:any)=>r?.stop),i?'bonus':'base');});return canonical(v)===canonical(makeView(v.stakeUnits,spins));}catch{return false;}
}
export function moveStarSpin(value:unknown,stakeUnits:string,revision:unknown,move:unknown,draw:WildNudgeRandom):WildNudgeResult{if(!validStarSpinView(value)||value.stakeUnits!==stakeUnits||value.stage!=='bonus'||revision!==value.revision||move!=='wild-nudge-spin')throw new WildNudgeMoveError('Сохранённый этап изменился. Обнови раунд.');return wildNudgeResult(makeView(stakeUnits,[...structuredClone(value.spins),drawWildNudgeSpin('bonus',draw)]));}
export function wildNudgeExpansionView(view:WildNudgeView){const result=wildNudgeResult(view);return{player:[],dealer:[],community:[],wildNudge:view,actions:result.actions,phase:view.revision+1,ended:result.ended,message:result.message};}
export function validWildNudgeSession(value:unknown):boolean{
 try{const v=precisionBaseSession(value);if(!object(v))return false;if(v.rulesVersion===1)return validLegacySession(v);
 if(Object.keys(v).sort().join(',')!=='gameId,id,returnedUnits,rulesVersion,spentUnits,stakeUnits,state,view'||v.gameId!=='studio-wild-nudge'||v.rulesVersion!==2||typeof v.id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v.id)||!object(v.view)||!validStarSpinView(v.view.wildNudge))return false;
 const view=v.view.wildNudge;return v.stakeUnits===view.stakeUnits&&v.spentUnits===view.stakeUnits&&v.state===(view.stage==='settled'?'settled':'active')&&v.returnedUnits===(v.state==='settled'?view.totalPayoutUnits:'0')&&canonical(v.view)===canonical(wildNudgeExpansionView(view));}catch{return false;}
}
export function validWildNudgeReply(session:any,op:any,replayed:boolean):boolean{if(op?.gameId!=='studio-wild-nudge')return true;if(!validWildNudgeSession(session))return false;const view=session.view.wildNudge as WildNudgeView;return op.action==='start'?session.id===op.id&&session.stakeUnits===op.stakeUnits&&validWildNudgeSettings(op.settings)&&(replayed||view.revision===1):session.id===op.sessionId&&op.move==='wild-nudge-spin'&&Number.isSafeInteger(op.revision)&&view.revision>op.revision&&(replayed||view.revision===op.revision+1);}

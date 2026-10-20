import {randomInt} from 'node:crypto';
import {NITRO_MAX_WIN,NITRO_MAX_FREE,NITRO_MAX_FRAMES,nitroDecision,nitroSurvivors,nitroFreeAward,validNitroSettings,validNitroStake,validNitroSettlement,type NitroView,type NitroFrame,type NitroSettings,type NitroResult} from '../../src/shared/nitroRun';
export class NitroMoveError extends Error {}
export type NitroDraw=(max:number)=>number;
export const NITRO_MATH={version:1,weights:[24,20,16,12,10,8,1,1,2]} as const;
export function nitroRandomSymbol(draw:NitroDraw):number{
 const total=NITRO_MATH.weights.reduce((sum,n)=>sum+n,0);let value=draw(total);
 if(!Number.isSafeInteger(value)||value<0||value>=total)throw Error('Invalid Nitro random sample');
 for(let i=0;i<NITRO_MATH.weights.length;i++){if(value<NITRO_MATH.weights[i])return i;value-=NITRO_MATH.weights[i];}throw Error('Invalid Nitro symbol weights');
}
/** The generator only samples symbols. Decisions and settlement replay never use randomness. */
export function nitroNext(value:Omit<NitroView,'spin'>&{spin:NitroView['spin']|null},stake:string,draw:NitroDraw):NitroView{
 const v=structuredClone(value),free=!!v.bonus,initial=Array.from({length:30},()=>nitroRandomSymbol(draw)),frames:NitroFrame[]=[],cap=BigInt(stake)*BigInt(NITRO_MAX_WIN);
 let grid=initial,gear=free?2:1,charge=0,used=false,paid=0n,raw=0n;
 for(let index=0;index<NITRO_MAX_FRAMES;index++){
  const expected=nitroDecision(grid,gear,charge,used,index,stake,cap-BigInt(v.totalPayoutUnits)-paid);let after=[...grid],drops:NitroFrame['drops']=[],refills:NitroFrame['refills']=[];
  if(expected.stop==='continue'||expected.stop==='nitro'){const g=nitroSurvivors(grid,expected.removed);drops=g.drops;refills=g.empty.map(position=>({position,symbol:nitroRandomSymbol(draw)}));after=Array<number>(30).fill(-1);for(const d of drops)after[d.to]=d.symbol;for(const r of refills)after[r.position]=r.symbol;}
  frames.push({index,before:[...grid],after,wins:expected.wins,energy:expected.energy,nitroBefore:charge,nitroAfter:expected.charge,nitroUsedBefore:used,nitroUsedAfter:expected.used,multiplierBefore:gear,multiplierAfter:expected.gear,removed:expected.removed,drops,refills,payoutUnits:String(expected.paid),uncappedPayoutUnits:String(expected.raw),stop:expected.stop});
  paid+=expected.paid;raw+=expected.raw;gear=expected.gear;charge=expected.charge;used=expected.used;grid=after;if(expected.stop!=='continue'&&expected.stop!=='nitro')break;
 }
 const total=BigInt(v.totalPayoutUnits)+paid,capped=total===cap,flags=grid.filter(n=>n===7).length;let freeAward=0;
 if(v.bonus){v.bonus.played++;v.bonus.remaining--;if(!capped&&flags>=3){freeAward=Math.min(2,NITRO_MAX_FREE-v.bonus.awarded);v.bonus.awarded+=freeAward;v.bonus.remaining+=freeAward;}if(capped)v.bonus.remaining=0;}
 else if(!capped&&(freeAward=nitroFreeAward(flags)))v.bonus={awarded:freeAward,played:0,remaining:freeAward};
 const spin={index:v.history.length,kind:free?'free' as const:'base' as const,initialGrid:initial,frames,finalGrid:grid,multiplierBefore:free?2:1,multiplierAfter:gear,flags,freeAward,payoutUnits:String(paid),uncappedPayoutUnits:String(raw)};
 v.history.push(spin);return {...v,spin,revision:v.history.length,totalPayoutUnits:String(total),capped};
}
function finish(view:NitroView,stake:string):NitroResult{
 const ended=!view.bonus?.remaining||view.capped;
 if(!validNitroSettlement(ended?'settled':'active',stake,stake,ended?view.totalPayoutUnits:'0',view))throw Error('Invalid generated Nitro settlement');
 return {view,ended,credit:ended?Number(view.totalPayoutUnits):0,message:ended?'Заезд завершён. Выплата в тестовом кошельке.':'Бонусная гонка сохранена. Продолжение бесплатно.',actions:ended?[]:[{move:'nitro-spin',label:'Продолжить бесплатную гонку',cost:0}]};
}
export function startNitro(settings:NitroSettings,stake:string,draw:NitroDraw=randomInt):NitroResult{
 if(!validNitroSettings(settings)||!validNitroStake(stake))throw new NitroMoveError('Недопустимая ставка или режим гонки.');
 return finish(nitroNext({kind:'nitro-run',version:1,mode:'normal',revision:0,history:[],spin:null,bonus:null,totalPayoutUnits:'0',capped:false},stake,draw),stake);
}
export function moveNitro(value:NitroView,stake:string,revision:unknown,draw:NitroDraw=randomInt):NitroResult{
 if(!value||revision!==value.revision||!validNitroSettlement('active',stake,stake,'0',value))throw new NitroMoveError('Гонка уже изменилась. Проверь сохранённый ход.');
 return finish(nitroNext(value,stake,draw),stake);
}

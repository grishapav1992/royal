import {randomInt} from 'node:crypto';
import {CARAMEL_MAX_WIN,caramelCost,caramelPayout,caramelSurvivors,validCaramelSettings,validCaramelStake,validCaramelSettlement,type CaramelView,type CaramelFrame,type CaramelSettings,type CaramelResult,type CaramelSpin} from '../../src/shared/caramelCarnival';
export class CaramelMoveError extends Error {}
type Draw=(max:number)=>number;
// Original Royal probability profile. Every value is fixed before a paid round.
export const CARAMEL_MATH={version:1,ordinaryWeights:[1,1,1,1,1,1,1],baseSpinnerPerMillion:15450,freeSpinnerPerMillion:68500,baseTicketPerMillion:22000,freeTicketPerMillion:12000,energyWeights:[52,25,18,5]} as const;
function weighted(weights:readonly number[],draw:Draw){let n=draw(weights.reduce((a,b)=>a+b,0));for(let i=0;i<weights.length;i++){n-=weights[i];if(n<0)return i;}throw Error('Invalid random draw');}
export function caramelSymbol(free:boolean,draw:Draw):number{
 const roll=draw(1000000),ticket=free?CARAMEL_MATH.freeTicketPerMillion:CARAMEL_MATH.baseTicketPerMillion,spinner=free?CARAMEL_MATH.freeSpinnerPerMillion:CARAMEL_MATH.baseSpinnerPerMillion;
 return roll<ticket?7:roll<ticket+spinner?8+weighted(CARAMEL_MATH.energyWeights,draw):weighted(CARAMEL_MATH.ordinaryWeights,draw);
}
function finish(view:CaramelView,stake:string):CaramelResult{
 const ended=!view.bonus?.remaining||view.capped,credit=ended?Number(view.totalPayoutUnits):0;
 if(!validCaramelSettlement(ended?'settled':'active',stake,String(BigInt(stake)*BigInt(view.mode==='festival'?35:1)),ended?String(credit):'0',view))throw Error('Invalid generated Caramel settlement');
 return {view,ended,credit,message:ended?'Раунд завершён, выплата зачислена':'Фестиваль сохранён. Продолжение бесплатно.',actions:ended?[]:[{move:'caramel-spin',label:'Продолжить фестиваль',cost:0}]};
}
export function advanceCaramelSpin(value:CaramelView,stake:string,draw:Draw):CaramelView{
 const view=structuredClone(value),free=!!view.bonus,initial=Array.from({length:30},()=>caramelSymbol(free,draw)),frames:CaramelFrame[]=[],cap=BigInt(stake)*BigInt(CARAMEL_MAX_WIN);let multiplier=view.bonus?.multiplier??1,grid=initial,paid=0n,raw=0n;
 const multiplierBefore=multiplier;
 for(let step=0;step<20;step++){
  const payment=caramelPayout(grid,multiplier,stake,cap-BigInt(view.totalPayoutUnits)-paid),before=multiplier;multiplier=payment.multiplier;paid+=payment.paid;raw+=payment.raw;
  const capped=BigInt(view.totalPayoutUnits)+paid===cap,stop=capped?'win-cap':!payment.wins.length?'no-win':step===19?'cascade-limit':'continue';let after=[...grid],removed:number[]=[],drops:CaramelFrame['drops']=[],refills:CaramelFrame['refills']=[];
  if(!capped&&payment.wins.length){removed=[...new Set([...payment.wins.flatMap(w=>w.positions),...grid.flatMap((v,i)=>v>=8?[i]:[])])].sort((a,b)=>a-b);const gravity=caramelSurvivors(grid,removed);drops=gravity.drops;refills=gravity.empty.map(position=>({position,symbol:caramelSymbol(free,draw)}));after=Array<number>(30).fill(-1);for(const drop of drops)after[drop.to]=drop.symbol;for(const refill of refills)after[refill.position]=refill.symbol;}
  frames.push({index:step,before:[...grid],after,wins:payment.wins,energy:payment.energy,multiplierBefore:before,multiplierAfter:multiplier,removed,drops,refills,payoutUnits:String(payment.paid),uncappedPayoutUnits:String(payment.raw),stop});grid=after;if(stop!=='continue')break;
 }
 const tickets=grid.filter(v=>v===7).length,capped=BigInt(view.totalPayoutUnits)+paid===cap;let freeAward=0;
 if(view.bonus){view.bonus.played++;view.bonus.remaining--;view.bonus.multiplier=multiplier;if(!capped&&tickets>=3){freeAward=Math.min(3,30-view.bonus.awarded);view.bonus.awarded+=freeAward;view.bonus.remaining+=freeAward;}if(capped)view.bonus.remaining=0;}
 else if(!capped&&tickets>=4){freeAward=10;view.bonus={awarded:10,played:0,remaining:10,multiplier:1};}
 const current:CaramelSpin={index:view.history.length,kind:free?'free':'base',initialGrid:initial,frames,finalGrid:grid,multiplierBefore,multiplierAfter:multiplier,tickets,freeAward,payoutUnits:String(paid),uncappedPayoutUnits:String(raw)};
 view.history.push(current);view.spin=current;view.revision=view.history.length;view.totalPayoutUnits=String(BigInt(view.totalPayoutUnits)+paid);view.capped=capped;return view;
}
export function startCaramel(settings:CaramelSettings,stake:string,draw:Draw=randomInt):CaramelResult{
 if(!validCaramelSettings(settings)||!validCaramelStake(stake))throw new CaramelMoveError('Недопустимая ставка или режим фестиваля.');
 const purchased=caramelCost(settings)>1,view:CaramelView={kind:'caramel-carnival',version:1,mode:settings.caramel.mode,revision:0,history:[],spin:null,bonus:purchased?{awarded:10,played:0,remaining:10,multiplier:1}:null,totalPayoutUnits:'0',capped:false};
 return finish(purchased?view:advanceCaramelSpin(view,stake,draw),stake);
}
export function moveCaramel(value:CaramelView,stake:string,revision:unknown,draw:Draw=randomInt):CaramelResult{
 if(!value||revision!==value.revision||!value.bonus?.remaining||value.capped||!validCaramelSettlement('active',stake,String(BigInt(stake)*BigInt(value.mode==='festival'?35:1)),'0',value))throw new CaramelMoveError('Фестиваль уже изменился. Покажи сохранённый ход.');
 return finish(advanceCaramelSpin(value,stake,draw),stake);
}

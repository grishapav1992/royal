import {randomInt} from 'node:crypto';
import {convoyPins,convoyPayout,convoySurvivors,convoyFreeAward,validConvoySettings,validConvoyStake,validConvoySettlement,type ConvoyView,type ConvoyFrame,type ConvoySettings,type ConvoyResult} from '../../src/shared/lastConvoy';
export class ConvoyMoveError extends Error {}
type Draw=(max:number)=>number;
export const CONVOY_MATH={version:1,baseBeacon:15000,freeBeacon:6000,baseBarrier:12000,freeBarrier:25000,ordinarySymbols:7} as const;
function finish(view:ConvoyView,stake:string):ConvoyResult {
 const ended=!view.bonus?.remaining||view.capped;
 if(!validConvoySettlement(ended?'settled':'active',stake,stake,ended?view.totalPayoutUnits:'0',view))throw Error('Invalid generated Convoy settlement');
 return {view,ended,credit:ended?Number(view.totalPayoutUnits):0,message:ended?'Раунд завершён. Выплата в тестовом кошельке.':'Эвакуация сохранена. Продолжение бесплатно.',actions:ended?[]:[{move:'convoy-spin',label:'Продолжить эвакуацию',cost:0}]};
}
export function advanceConvoySpin(value:Omit<ConvoyView,'spin'>&{spin:ConvoyView['spin']|null},stake:string,draw:Draw):ConvoyView {
 const v=structuredClone(value),free=!!v.bonus,pinsBefore=[...(v.bonus?.pins??[])];let pinCount=pinsBefore.length;
 const symbol=()=>{const r=draw(1000000),beacon=free?CONVOY_MATH.freeBeacon:CONVOY_MATH.baseBeacon,barrier=free?CONVOY_MATH.freeBarrier:CONVOY_MATH.baseBarrier;if(r<beacon)return 7;if(pinCount<6&&r<beacon+barrier){pinCount++;return 8;}return draw(7);};
 const initial=Array.from({length:30},(_,i)=>pinsBefore.includes(i)?8:symbol()),frames:ConvoyFrame[]=[],cap=BigInt(stake)*5000n;let grid=initial,pins=[...pinsBefore],multiplier=1+pinsBefore.length,paid=0n,raw=0n;
 for(let step=0;step<20;step++) {
  const payment=convoyPayout(grid,stake,cap-BigInt(v.totalPayoutUnits)-paid),nextPins=convoyPins(grid),addedPins=nextPins.filter(p=>!pins.includes(p)),before=multiplier;
  multiplier=payment.multiplier;pins=nextPins;paid+=payment.paid;raw+=payment.raw;
  const stop=BigInt(v.totalPayoutUnits)+paid===cap?'win-cap':!payment.wins.length?'no-win':step===19?'cascade-limit':'continue';let after=[...grid],removed:number[]=[],drops:ConvoyFrame['drops']=[],refills:ConvoyFrame['refills']=[];
  if(stop==='continue') {removed=payment.wins.flatMap(w=>w.positions).sort((a,b)=>a-b);const g=convoySurvivors(grid,removed);drops=g.drops;refills=g.empty.map(position=>({position,symbol:symbol()}));after=Array(30).fill(-1);for(const d of drops)after[d.to]=d.symbol;for(const r of refills)after[r.position]=r.symbol;}
  frames.push({index:step,before:[...grid],after,wins:payment.wins,addedPins,multiplierBefore:before,multiplierAfter:multiplier,removed,drops,refills,payoutUnits:String(payment.paid),uncappedPayoutUnits:String(payment.raw),stop});grid=after;if(stop!=='continue')break;
 }
 const beacons=grid.filter(n=>n===7).length,capped=BigInt(v.totalPayoutUnits)+paid===cap;let freeAward=0;
 if(v.bonus){v.bonus.played++;v.bonus.remaining--;v.bonus.pins=pins;v.bonus.multiplier=multiplier;if(!capped&&beacons>=3){freeAward=Math.min(2,20-v.bonus.awarded);v.bonus.awarded+=freeAward;v.bonus.remaining+=freeAward;}if(capped)v.bonus.remaining=0;}
 else if(!capped&&(freeAward=convoyFreeAward(beacons)))v.bonus={awarded:freeAward,played:0,remaining:freeAward,pins:[],multiplier:1};
 const current={index:v.history.length,kind:free?'free' as const:'base' as const,initialGrid:initial,frames,finalGrid:grid,pinsBefore,pinsAfter:pins,multiplierBefore:1+pinsBefore.length,multiplierAfter:multiplier,beacons,freeAward,payoutUnits:String(paid),uncappedPayoutUnits:String(raw)};
 v.history.push(current);return {...v,spin:current,revision:v.history.length,totalPayoutUnits:String(BigInt(v.totalPayoutUnits)+paid),capped};
}
export function startConvoy(settings:ConvoySettings,stake:string,draw:Draw=randomInt):ConvoyResult {
 if(!validConvoySettings(settings)||!validConvoyStake(stake))throw new ConvoyMoveError('Недопустимая ставка или режим конвоя.');
 return finish(advanceConvoySpin({kind:'last-convoy',version:1,mode:'normal',revision:0,history:[],spin:null,bonus:null,totalPayoutUnits:'0',capped:false},stake,draw),stake);
}
export function moveConvoy(value:ConvoyView,stake:string,revision:unknown,draw:Draw=randomInt):ConvoyResult {
 if(!value||revision!==value.revision||!validConvoySettlement('active',stake,stake,'0',value))throw new ConvoyMoveError('Эвакуация уже изменилась. Покажи сохранённый ход.');
 return finish(advanceConvoySpin(value,stake,draw),stake);
}

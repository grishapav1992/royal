import {
  FOREST_HEART_GAME,FOREST_HEART_RULES,FOREST_HEART_ROTORS,FOREST_HEART_STAKES,
  forestHeartBase,forestHeartBonus,forestHeartHeld,forestHeartFlowerPayout,
} from './forestHeartMath';

export {FOREST_HEART_GAME};
export const FOREST_HEART_CLIENT_HEADER='X-Royal-Forest-Heart-Rules';
/** Conservative integer coverage for the exact 946.5x mathematical maximum. */
export const FOREST_HEART_RESERVE_MULTIPLIER=947;
export type ForestHeartSettings={forestHeart:{mode:'normal'}};
export type ForestHeartBase={bits:number;energy:number;ability:boolean;bonusAwarded:boolean;rotation:number|null;choiceDone:boolean};
export type ForestHeartSpin={bits:number;energy:number;receiverMask:number;heldState:number;payoutUnits:string};
export type ForestHeartView={kind:'forest-heart';version:1;revision:number;stage:'choice'|'bonus'|'settled';
  base:ForestHeartBase;bonus:ForestHeartSpin[];heldState:number;remaining:number;totalPayoutUnits:string};
export type ForestHeartResult={view:ForestHeartView;ended:boolean;credit:number;message:string;actions:{move:string;label:string;cost:number}[]};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const keys=(v:Record<string,unknown>,expected:string)=>Object.keys(v).sort().join(',')===expected;
const integer=(v:unknown,min:number,max:number):v is number=>Number.isSafeInteger(v)&&Number(v)>=min&&Number(v)<=max;
const units=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v);
export const validForestHeartStake=(stake:unknown):stake is string=>typeof stake==='string'&&FOREST_HEART_STAKES.some(n=>String(n)===stake);
export function validForestHeartSettings(value:unknown):value is ForestHeartSettings{
  return object(value)&&keys(value,'forestHeart')&&object(value.forestHeart)&&keys(value.forestHeart,'mode')&&value.forestHeart.mode==='normal';
}
export const validForestHeartMove=(move:unknown):move is string=>typeof move==='string'&&
  (move==='forest-pass'||move==='forest-spin'||/^forest-turn-([0-9]|1[01])$/.test(move));
export function forestHeartActions(view:ForestHeartView):ForestHeartResult['actions']{
  if(view.stage==='choice')return [{move:'forest-pass',label:'Оставить корни',cost:0},
    ...FOREST_HEART_ROTORS.map((cell,i)=>({move:'forest-turn-'+i,label:'Повернуть корень '+(cell+1),cost:0}))];
  return view.stage==='bonus'?[{move:'forest-spin',label:'Бесплатный импульс',cost:0}]:[];
}
export function validForestHeartView(value:unknown,stake:string):value is ForestHeartView{
  if(!validForestHeartStake(stake)||!object(value)||!keys(value,'base,bonus,heldState,kind,remaining,revision,stage,totalPayoutUnits,version')||
    value.kind!=='forest-heart'||value.version!==1||!integer(value.revision,1,6)||!integer(value.heldState,0,242)||
    !integer(value.remaining,0,4)||!units(value.totalPayoutUnits)||!Array.isArray(value.bonus)||value.bonus.length>4)return false;
  const base=value.base;
  if(!object(base)||!keys(base,'ability,bits,bonusAwarded,choiceDone,energy,rotation')||!integer(base.bits,0,4095)||
    typeof base.ability!=='boolean'||typeof base.bonusAwarded!=='boolean'||typeof base.choiceDone!=='boolean'||
    !FOREST_HEART_RULES.energy.some(row=>row.value===base.energy)||base.rotation!==null&&!integer(base.rotation,0,11))return false;
  if(!base.ability&&(!base.choiceDone||base.rotation!==null)||!base.choiceDone&&(base.rotation!==null||value.bonus.length!==0)||
    !base.bonusAwarded&&value.bonus.length!==0)return false;
  try{
    const initial=forestHeartBase(base.bits,base.ability,base.rotation as number|null);
    let total=forestHeartFlowerPayout(Number(stake),Number(base.energy))*BigInt(initial.flowers),held=0;
    for(const entry of value.bonus){
      if(!object(entry)||!keys(entry,'bits,energy,heldState,payoutUnits,receiverMask')||!integer(entry.bits,0,4095)||
        !FOREST_HEART_RULES.energy.some(row=>row.value===entry.energy)||!units(entry.payoutUnits))return false;
      const previous=forestHeartHeld(held);
      if((entry.bits&previous.mask)!==previous.values)return false;
      const spin=forestHeartBonus(held,entry.bits),payout=forestHeartFlowerPayout(Number(stake),Number(entry.energy))*BigInt(spin.flowers);
      if(entry.receiverMask!==spin.receiverMask||entry.heldState!==spin.nextState||entry.payoutUnits!==String(payout))return false;
      held=spin.nextState;total+=payout;
    }
    const remaining=base.bonusAwarded?4-value.bonus.length:0;
    const stage=!base.choiceDone?'choice':remaining?'bonus':'settled';
    return value.stage===stage&&value.remaining===remaining&&value.heldState===held&&value.totalPayoutUnits===String(total)&&
      value.revision===1+Number(base.ability&&base.choiceDone)+value.bonus.length&&
      total*2n<=BigInt(stake)*1893n;
  }catch{return false;}
}
export function validForestHeartSettlement(state:unknown,stake:unknown,spent:unknown,returned:unknown,view:unknown):view is ForestHeartView{
  return (state==='active'||state==='settled')&&validForestHeartStake(stake)&&spent===stake&&units(returned)&&
    validForestHeartView(view,stake)&&(state==='settled')===(view.stage==='settled')&&
    returned===(state==='settled'?view.totalPayoutUnits:'0');
}
export function validForestHeartSession(value:unknown):boolean{
  if(!object(value)||value.gameId!==FOREST_HEART_GAME||value.rulesVersion!==1||!object(value.view))return false;
  const view=value.view.forestHeart;
  if(!validForestHeartSettlement(value.state,value.stakeUnits,value.spentUnits,value.returnedUnits,view))return false;
  return value.view.ended===(value.state==='settled')&&value.view.phase===view.revision+1&&
    JSON.stringify(value.view.actions)===JSON.stringify(forestHeartActions(view));
}

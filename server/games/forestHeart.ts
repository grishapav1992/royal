import {randomInt} from 'node:crypto';
import {FOREST_HEART_RULES,forestHeartBase,forestHeartBonus,forestHeartFlowerPayout} from '../../src/shared/forestHeartMath';
import {forestHeartActions,validForestHeartSettings,validForestHeartStake,validForestHeartSettlement,
  type ForestHeartBase,type ForestHeartView,type ForestHeartSettings,type ForestHeartResult} from '../../src/shared/forestHeart';
export class ForestHeartMoveError extends Error{}
type Draw=(max:number)=>number;
function entropy(draw:Draw,max:number){
  const value=draw(max);
  if(!Number.isSafeInteger(value)||value<0||value>=max)throw new Error('Invalid Forest Heart entropy');
  return value;
}
export function forestHeartEnergy(ticket:number):number{
  if(!Number.isSafeInteger(ticket)||ticket<0||ticket>=10000)throw new Error('Invalid Forest Heart energy ticket');
  let boundary=0;
  for(const row of FOREST_HEART_RULES.energy){boundary+=row.weight;if(ticket<boundary)return row.value;}
  throw new Error('Invalid Forest Heart energy table');
}
function result(base:ForestHeartBase,draws:{bits:number;energy:number}[],stake:string):ForestHeartResult{
  const first=forestHeartBase(base.bits,base.ability,base.rotation);
  let total=forestHeartFlowerPayout(Number(stake),base.energy)*BigInt(first.flowers),heldState=0;
  const bonus=draws.map(draw=>{
    const spin=forestHeartBonus(heldState,draw.bits);
    const payout=forestHeartFlowerPayout(Number(stake),draw.energy)*BigInt(spin.flowers);
    heldState=spin.nextState;total+=payout;
    return {bits:spin.bits,energy:draw.energy,receiverMask:spin.receiverMask,heldState,payoutUnits:String(payout)};
  });
  const remaining=base.bonusAwarded?4-bonus.length:0;
  const stage=!base.choiceDone?'choice':remaining?'bonus':'settled',ended=stage==='settled';
  const view:ForestHeartView={kind:'forest-heart',version:1,revision:1+Number(base.ability&&base.choiceDone)+bonus.length,
    stage,base,bonus,heldState,remaining,totalPayoutUnits:String(total)};
  const credit=ended?Number(total):0;
  if(!Number.isSafeInteger(credit)||!validForestHeartSettlement(ended?'settled':'active',stake,stake,String(credit),view))
    throw new Error('Invalid Forest Heart settlement');
  return {view,ended,credit,actions:forestHeartActions(view),message:ended?'Серия завершена. Выплата начислена в общий кошелек.':
    stage==='choice'?'Выбери один поворот или оставь корни. Новая ставка не нужна.':'Пробуждение леса сохранено. Следующий импульс бесплатный.'};
}
export function startForestHeart(settings:ForestHeartSettings,stake:string,draw:Draw=randomInt):ForestHeartResult{
  if(!validForestHeartSettings(settings)||!validForestHeartStake(stake))throw new ForestHeartMoveError('Недопустимая ставка или режим Сердца леса.');
  const bits=entropy(draw,4096),energy=forestHeartEnergy(entropy(draw,10000));
  const ability=entropy(draw,32)===0,bonusAwarded=entropy(draw,64)===0;
  return result({bits,energy,ability,bonusAwarded,rotation:null,choiceDone:!ability},[],stake);
}
export function moveForestHeart(value:ForestHeartView,stake:string,revision:unknown,move:string,draw:Draw=randomInt):ForestHeartResult{
  if(!validForestHeartSettlement('active',stake,stake,'0',value)||revision!==value.revision||
    !forestHeartActions(value).some(action=>action.move===move))throw new ForestHeartMoveError('Этап Сердца леса изменился. Покажи сохраненную серию.');
  const base=structuredClone(value.base),bonus=value.bonus.map(spin=>({bits:spin.bits,energy:spin.energy}));
  if(value.stage==='choice'){
    base.rotation=move==='forest-pass'?null:Number(move.slice('forest-turn-'.length));base.choiceDone=true;
  }else bonus.push({bits:entropy(draw,4096),energy:forestHeartEnergy(entropy(draw,10000))});
  return result(base,bonus,stake);
}

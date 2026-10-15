import { randomInt } from 'node:crypto';
import { NEXT_CARD_LABELS } from '../../src/shared/casinoNextVariants';
import {
  BATCH_GEM_WEIGHTS, plinkoTargetMatches, plinkoTargetMultiplier, pokerTargetMatches, pokerTargetMultiplier, blackjackTripleTotal, blackjackTargetMatches, blackjackTargetMultiplier, collectionMultiplier, doubleMinesMultiplier, streakMultiplier,
  type BatchVariantGameId, type BatchVariantSettings, type BatchVariantView, type PlinkoTarget, type PokerTarget, type BlackjackTarget, type StreakHistory, type StreakThreshold,
} from '../../src/shared/casinoBatchVariants';

export type DoubleMinesState={kind:'double-mines';mines:number[];picks:number[][]};
export type DiceStreakState={kind:'dice-streak';dice:number[];history:StreakHistory;mines?:never};
export type BatchVariantState=DoubleMinesState|DiceStreakState;
export type BatchVariantResult={engine?:BatchVariantState;variant:BatchVariantView;ended:boolean;credit:number;message:string};
export class BatchVariantMoveError extends Error {}
function payout(stakeUnits:string,multiplier:number):number {
  const fixed=Math.round(multiplier*10000);if(!Number.isSafeInteger(fixed)||fixed<0)throw Error('Invalid batch variant multiplier');
  const amount=Number(BigInt(stakeUnits)*BigInt(fixed)/10000n);if(!Number.isSafeInteger(amount)||amount<0)throw Error('Invalid batch variant payout');return amount;
}
function drawValue(draw:(max:number)=>number,max:number):number {const value=draw(max);if(!Number.isSafeInteger(value)||value<0||value>=max)throw Error('Invalid batch variant random value');return value;}
function drawPool(length:number,count:number,random:(max:number)=>number):number[] {const pool=Array.from({length},(_,i)=>i);return Array.from({length:count},()=>pool.splice(random(pool.length),1)[0]);}
function doubleMinesView(engine:DoubleMinesState,stakeUnits:string,ended:boolean):Extract<BatchVariantView,{kind:'double-mines'}> {
  const lost=engine.picks.some(pair=>pair.some(cell=>engine.mines.includes(cell))),steps=engine.picks.length-Number(lost),opened=engine.picks.flat(),multiplier=lost?0:doubleMinesMultiplier(steps);
  return {kind:'double-mines',cells:Array.from({length:16},(_,cell)=>ended?(engine.mines.includes(cell)?'mine':'safe'):opened.includes(cell)?'safe':'hidden'),picks:structuredClone(engine.picks),steps,maxSteps:5,multiplier,cashoutUnits:String(payout(stakeUnits,multiplier))};
}
function streakView(engine:DiceStreakState,stakeUnits:string):Extract<BatchVariantView,{kind:'dice-streak'}> {
  const multiplier=streakMultiplier(engine.history);return {kind:'dice-streak',history:structuredClone(engine.history),steps:engine.history.filter(item=>item.won).length,maxSteps:5,multiplier,cashoutUnits:String(payout(stakeUnits,multiplier))};
}
export function startBatchVariant(game:BatchVariantGameId,settings:BatchVariantSettings,stakeUnits:string,draw:(max:number)=>number=randomInt):BatchVariantResult {
  const input=settings.variant,random=(max:number)=>drawValue(draw,max);
  switch(game){
    case 'variant-target-plinko':{
      const {target}=input as {target:PlinkoTarget},path=Array.from({length:12},()=>random(2)),bucket=path.reduce((a,b)=>a+b,0),won=plinkoTargetMatches(target,bucket),multiplier=plinkoTargetMultiplier(target);
      return {variant:{kind:'target-plinko',target,path,bucket,won,multiplier},ended:true,credit:won?payout(stakeUnits,multiplier):0,message:won?'Шарик попал в выбранную область':'Шарик приземлился в лунку '+bucket};
    }
    case 'variant-triple-poker':{
      const {target}=input as {target:PokerTarget},ids=drawPool(52,3,random),cards=ids.map(id=>NEXT_CARD_LABELS[id]),won=pokerTargetMatches(target,ids),multiplier=pokerTargetMultiplier(target);
      return {variant:{kind:'triple-poker',target,cards,won,multiplier},ended:true,credit:won?payout(stakeUnits,multiplier):0,message:won?'Выбранная комбинация найдена':'Выбранная комбинация не сложилась'};
    }
    case 'variant-blackjack-target':{
      const {target}=input as {target:BlackjackTarget},ids=drawPool(52,3,random),cards=ids.map(id=>NEXT_CARD_LABELS[id]),total=blackjackTripleTotal(ids),won=blackjackTargetMatches(target,total),multiplier=blackjackTargetMultiplier(target);
      return {variant:{kind:'blackjack-target',target,cards,total,won,multiplier},ended:true,credit:won?payout(stakeUnits,multiplier):0,message:won?'Сумма совпала с выбранной целью':'Сумма трёх карт: '+total};
    }
    case 'variant-gem-collection':{
      const {gems}=input as {gems:number[]},hand=Array.from({length:5},()=>{let stop=random(100);for(let gem=0;gem<6;gem++){if(stop<BATCH_GEM_WEIGHTS[gem])return gem;stop-=BATCH_GEM_WEIGHTS[gem];}throw Error('Invalid collection gem weights');}),matches=gems.map(gem=>hand.filter(item=>item===gem).length),won=matches.every(count=>count>0),multiplier=collectionMultiplier(gems);
      return {variant:{kind:'gem-collection',gems:[...gems],hand,matches,won,multiplier},ended:true,credit:won?payout(stakeUnits,multiplier):0,message:won?'Коллекция собрана':'Найдено выбранных видов: '+matches.filter(count=>count>0).length+' из 3'};
    }
    case 'variant-double-mines':{
      const engine:DoubleMinesState={kind:'double-mines',mines:drawPool(16,4,random),picks:[]};return {engine,variant:doubleMinesView(engine,stakeUnits,false),ended:false,credit:0,message:'Выбери две закрытые ячейки'};
    }
    case 'variant-dice-streak':{
      const engine:DiceStreakState={kind:'dice-streak',dice:Array.from({length:5},()=>random(6)+1),history:[]};return {engine,variant:streakView(engine,stakeUnits),ended:false,credit:0,message:'Выбери порог первого броска'};
    }
  }
}
const integer=(value:unknown,min:number,max:number)=>typeof value==='number'&&Number.isInteger(value)&&value>=min&&value<=max;
function validDoubleMinesState(value:unknown):value is DoubleMinesState {
  if(!value||typeof value!=='object')return false;const v=value as DoubleMinesState;
  if(v.kind!=='double-mines'||!Array.isArray(v.mines)||v.mines.length!==4||new Set(v.mines).size!==4||v.mines.some(cell=>!integer(cell,0,15))||!Array.isArray(v.picks)||v.picks.length>=5)return false;
  const opened:number[]=[];for(const pair of v.picks){if(!Array.isArray(pair)||pair.length!==2||new Set(pair).size!==2||pair.some(cell=>!integer(cell,0,15)||v.mines.includes(cell)||opened.includes(cell)))return false;opened.push(...pair);}return true;
}
function validDiceStreakState(value:unknown):value is DiceStreakState {
  if(!value||typeof value!=='object')return false;const v=value as DiceStreakState;
  return v.kind==='dice-streak'&&Array.isArray(v.dice)&&v.dice.length===5&&v.dice.every(die=>integer(die,1,6))&&Array.isArray(v.history)&&v.history.length<5&&v.history.every((item,index)=>item&&item.die===v.dice[index]&&[2,3,4].includes(item.threshold)&&item.won===true&&item.die>=item.threshold);
}
export function moveBatchVariant(game:BatchVariantGameId,payload:unknown,move:string,picks:number[]|undefined,stakeUnits:string):BatchVariantResult {
  if(game==='variant-double-mines'){
    if(!validDoubleMinesState(payload))throw Error('Invalid private paired mines state');const engine=structuredClone(payload);
    if(move==='cashout'){if(!engine.picks.length||picks!==undefined)throw new BatchVariantMoveError('Сначала открой безопасную пару.');const variant=doubleMinesView(engine,stakeUnits,true);return {engine,variant,ended:true,credit:Number(variant.cashoutUnits),message:'Выплата за безопасные пары получена'};}
    if(move!=='reveal'||!picks||picks.length!==2||new Set(picks).size!==2||picks.some(cell=>!integer(cell,0,15)||engine.picks.flat().includes(cell)))throw new BatchVariantMoveError('Выбери две разные закрытые ячейки.');
    engine.picks.push([...picks].sort((a,b)=>a-b));const lost=picks.some(cell=>engine.mines.includes(cell)),ended=lost||engine.picks.length===5,variant=doubleMinesView(engine,stakeUnits,ended);
    return {engine,variant,ended,credit:ended?Number(variant.cashoutUnits):0,message:lost?'Ловушка: ставка потеряна':ended?'Пять безопасных пар: выплата получена':'Обе ячейки безопасны: продолжай или забери выплату'};
  }
  if(game==='variant-dice-streak'){
    if(!validDiceStreakState(payload))throw Error('Invalid private dice streak state');const engine=structuredClone(payload);
    if(move==='cashout'){if(!engine.history.length||picks!==undefined)throw new BatchVariantMoveError('Сначала выполни успешный бросок.');const variant=streakView(engine,stakeUnits);return {engine,variant,ended:true,credit:Number(variant.cashoutUnits),message:'Выплата за серию получена'};}
    if(move!=='roll'||!picks||picks.length!==1||![2,3,4].includes(picks[0]))throw new BatchVariantMoveError('Выбери порог 2+, 3+ или 4+.');
    const threshold=picks[0] as StreakThreshold,die=engine.dice[engine.history.length],won=die>=threshold;engine.history.push({die,threshold,won});const ended=!won||engine.history.length===5,variant=streakView(engine,stakeUnits);
    return {engine,variant,ended,credit:ended?Number(variant.cashoutUnits):0,message:!won?'Порог не достигнут: ставка потеряна':ended?'Пять успешных бросков: выплата получена':'Порог достигнут: продолжай или забери выплату'};
  }
  throw new BatchVariantMoveError('Эта партия уже завершена.');
}

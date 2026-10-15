import { randomInt } from 'node:crypto';
import {
  diceMultiplier, gemMultiplier, plinkoTable, sicBoMultiplier, vaultMultiplier, VARIANT_GEMS,
  type VariantGameId, type VariantSettings, type VariantView, type VariantRisk, type VariantGem,
} from '../../src/shared/casinoVariants';
import { rollLimboFromInteger } from './vfair/limbo/limbo-roll';
import { deal } from './rush/diamonds';
import { isNextVariantGame, type NextVariantSettings } from '../../src/shared/casinoNextVariants';
import { startNextVariant, moveNextVariant, NextVariantMoveError, type NextVariantState } from './casinoNextVariants';
import { isBatchVariantGame, type BatchVariantSettings } from '../../src/shared/casinoBatchVariants';
import { startBatchVariant, moveBatchVariant, BatchVariantMoveError, type BatchVariantState } from './casinoBatchVariants';

export type VaultState = {mines:number[];opened:number[]};
export type VariantResult = {engine?:VaultState|NextVariantState|BatchVariantState;variant:VariantView;ended:boolean;credit:number;message:string};
export class VariantMoveError extends Error {}

function drawValue(draw:(max:number)=>number,max:number):number {
  const value=draw(max);if(!Number.isSafeInteger(value)||value<0||value>=max)throw new Error('Invalid variant random value');return value;
}
export function variantPayout(stakeUnits:string,multiplier:number):number {
  const fixed=Math.round(multiplier*10000);if(!Number.isSafeInteger(fixed)||fixed<0)throw new Error('Invalid variant multiplier');
  const amount=Number(BigInt(stakeUnits)*BigInt(fixed)/10000n);
  if(!Number.isSafeInteger(amount)||amount<0)throw new Error('Invalid variant payout');return amount;
}
function vaultView(state:VaultState,stakeUnits:string,ended:boolean):Extract<VariantView,{kind:'mines'}> {
  const multiplier=vaultMultiplier(state.opened.length);
  return {kind:'mines',cells:Array.from({length:16},(_,i)=>ended?(state.mines.includes(i)?'mine':'safe'):state.opened.includes(i)?'safe':'hidden'),
    opened:[...state.opened],maxSafe:6,multiplier,cashoutUnits:String(variantPayout(stakeUnits,multiplier))};
}

export function startVariant(game:VariantGameId,settings:VariantSettings,stakeUnits:string,draw:(max:number)=>number=randomInt):VariantResult {
  if(isBatchVariantGame(game))return startBatchVariant(game,settings as BatchVariantSettings,stakeUnits,draw);
  if(isNextVariantGame(game))return startNextVariant(game,settings as NextVariantSettings,stakeUnits,draw);
  // settings have already passed the shared validator before entering a wallet transaction.
  const input=settings.variant;
  const random=(max:number)=>drawValue(draw,max);
  switch(game){
    case 'variant-dice':{
      const {width}=input as {width:30|50|70},integer=random(10000),low=(100-width)*50,high=low+width*100;
      const won=integer>=low&&integer<high,multiplier=diceMultiplier(width);
      return {variant:{kind:'dice',width,low:low/100,high:high/100,roll:integer/100,won,multiplier},ended:true,
        credit:won?variantPayout(stakeUnits,multiplier):0,message:won?'Попадание в коридор':'Результат за пределами коридора'};
    }
    case 'variant-plinko':{
      const {risk}=input as {risk:VariantRisk},table=plinkoTable(risk),half=String(BigInt(stakeUnits)/2n);
      const balls=Array.from({length:2},()=>{const path=Array.from({length:12},()=>random(2)),bucket=path.reduce((a,b)=>a+b,0);return {path,bucket,multiplier:table[bucket]};});
      const credit=balls.reduce((sum,ball)=>sum+variantPayout(half,ball.multiplier),0);
      return {variant:{kind:'plinko',risk,rows:12,balls,table},ended:true,credit,message:'Оба потока завершены'};
    }
    case 'variant-limbo':{
      const {target}=input as {target:3|5|10},rolled=rollLimboFromInteger(random(2**32),0.98),half=String(BigInt(stakeUnits)/2n);
      const tickets=[1.5,target].map(mark=>({target:mark,won:rolled>=mark,returnedUnits:String(rolled>=mark?variantPayout(half,mark):0)}));
      const credit=tickets.reduce((sum,ticket)=>sum+Number(ticket.returnedUnits),0);
      return {variant:{kind:'limbo',target,rolled,tickets},ended:true,credit,message:tickets[1].won?'Оба рубежа достигнуты':tickets[0].won?'Первый рубеж достигнут':'Рубежи не достигнуты'};
    }
    case 'variant-mines':{
      const pool=Array.from({length:16},(_,i)=>i),mines=Array.from({length:3},()=>pool.splice(random(pool.length),1)[0]);
      const engine:VaultState={mines,opened:[]};return {engine,variant:vaultView(engine,stakeUnits,false),ended:false,credit:0,message:'Выбери первую ячейку'};
    }
    case 'variant-sic-bo':{
      const {sum}=input as {sum:number},dice=Array.from({length:3},()=>random(6)+1),total=dice.reduce((a,b)=>a+b,0),won=total===sum,multiplier=sicBoMultiplier(sum);
      return {variant:{kind:'sic-bo',sum,dice,total,won,multiplier},ended:true,credit:won?variantPayout(stakeUnits,multiplier):0,message:won?'Точная сумма совпала':'Сумма костей: '+total};
    }
    case 'variant-diamonds':{
      const {gem}=input as {gem:VariantGem},hand=deal(random).hand,matches=hand.filter(symbol=>symbol===VARIANT_GEMS[gem]).length,won=matches>=2,multiplier=gemMultiplier(gem);
      return {variant:{kind:'diamonds',gem,hand,matches,won,multiplier},ended:true,credit:won?variantPayout(stakeUnits,multiplier):0,message:won?'Самоцветы найдены: '+matches:'Найдено самоцветов: '+matches};
    }
  }
}
export function moveVariant(game:VariantGameId,payload:unknown,move:string,picks:number[]|undefined,stakeUnits:string):VariantResult {
  if(isBatchVariantGame(game)){try{return moveBatchVariant(game,payload,move,picks,stakeUnits);}catch(error){if(error instanceof BatchVariantMoveError)throw new VariantMoveError(error.message);throw error;}}
  if(isNextVariantGame(game)){try{return moveNextVariant(game,payload,move,picks,stakeUnits);}catch(error){if(error instanceof NextVariantMoveError)throw new VariantMoveError(error.message);throw error;}}
  if(game!=='variant-mines')throw new VariantMoveError('Эта партия уже завершена.');
  const engine=structuredClone(payload) as VaultState;
  if(!engine||!Array.isArray(engine.mines)||engine.mines.length!==3||new Set(engine.mines).size!==3||engine.mines.some(i=>!Number.isInteger(i)||i<0||i>15)
    ||!Array.isArray(engine.opened)||engine.opened.length>=6||new Set(engine.opened).size!==engine.opened.length||engine.opened.some(i=>!Number.isInteger(i)||i<0||i>15||engine.mines.includes(i)))throw new Error('Invalid private vault state');
  if(move==='cashout'){
    if(!engine.opened.length||picks!==undefined)throw new VariantMoveError('Сначала открой безопасную ячейку.');
    const variant=vaultView(engine,stakeUnits,true);return {engine,variant,ended:true,credit:Number(variant.cashoutUnits),message:'Выплата из хранилища получена'};
  }
  if(move!=='reveal'||!picks||picks.length!==1||!Number.isInteger(picks[0])||picks[0]<0||picks[0]>15||engine.opened.includes(picks[0]))throw new VariantMoveError('Выбери закрытую ячейку.');
  if(engine.mines.includes(picks[0]))return {engine,variant:{...vaultView(engine,stakeUnits,true),multiplier:0,cashoutUnits:'0'},ended:true,credit:0,message:'Ловушка: ставка потеряна'};
  engine.opened.push(picks[0]);const ended=engine.opened.length===6,variant=vaultView(engine,stakeUnits,ended);
  return {engine,variant,ended,credit:ended?Number(variant.cashoutUnits):0,message:ended?'Шесть ячеек открыты: выплата получена':'Безопасная ячейка: можно забрать выплату'};
}

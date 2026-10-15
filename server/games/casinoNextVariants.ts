import { randomInt } from 'node:crypto';
import { FRUITS_REEL_SIZE, fruitsMultiplier, fruitsSymbolForStop } from '../../src/shared/gameCore';
import {
  NEXT_CARD_LABELS, cardColor, cardRank, colorMultiplier, duelMatches, duelMultiplier, kenoMultiplier, keysMultiplier, splitStakeUnits, warMultiplier, warResult,
  type CardColor, type ColorHistory, type DuelBand, type NextVariantGameId, type NextVariantSettings, type NextVariantView, type WarMode,
} from '../../src/shared/casinoNextVariants';

export type ColorState={kind:'color';deck:number[];history:ColorHistory;mines?:never};
export type KeysState={kind:'keys';traps:number[];picks:number[][];mines?:never};
export type NextVariantState=ColorState|KeysState;
export type NextVariantResult={engine?:NextVariantState;variant:NextVariantView;ended:boolean;credit:number;message:string};
export class NextVariantMoveError extends Error {}
function payout(stakeUnits:string,multiplier:number):number {
  const fixed=Math.round(multiplier*10000);if(!Number.isSafeInteger(fixed)||fixed<0)throw Error('Invalid next variant multiplier');
  const amount=Number(BigInt(stakeUnits)*BigInt(fixed)/10000n);if(!Number.isSafeInteger(amount)||amount<0)throw Error('Invalid next variant payout');return amount;
}
function drawValue(draw:(max:number)=>number,max:number):number {const value=draw(max);if(!Number.isSafeInteger(value)||value<0||value>=max)throw Error('Invalid next variant random value');return value;}
function drawPool(length:number,count:number,random:(max:number)=>number):number[] {const pool=Array.from({length},(_,i)=>i);return Array.from({length:count},()=>pool.splice(random(pool.length),1)[0]);}
function colorView(engine:ColorState,stakeUnits:string):Extract<NextVariantView,{kind:'color'}> {
  const redRemaining=26-engine.history.filter(item=>item.color==='red').length,blackRemaining=26-engine.history.filter(item=>item.color==='black').length;
  const steps=engine.history.filter(item=>item.won).length,multiplier=colorMultiplier(engine.history);
  return {kind:'color',history:structuredClone(engine.history),redRemaining,blackRemaining,steps,maxSteps:6,multiplier,cashoutUnits:String(payout(stakeUnits,multiplier))};
}
function keysView(engine:KeysState,stakeUnits:string,ended:boolean):Extract<NextVariantView,{kind:'keys'}> {
  const lost=engine.picks.some((picks,i)=>picks.includes(engine.traps[i])),steps=engine.picks.length-Number(lost),multiplier=lost?0:keysMultiplier(steps);
  return {kind:'keys',rows:engine.traps.map((trap,row)=>Array.from({length:4},(_,cell)=>ended?(cell===trap?'trap':'safe'):engine.picks[row]?.includes(cell)?'safe':'hidden')),
    picks:structuredClone(engine.picks),steps,maxSteps:6,multiplier,cashoutUnits:String(payout(stakeUnits,multiplier))};
}
export function startNextVariant(game:NextVariantGameId,settings:NextVariantSettings,stakeUnits:string,draw:(max:number)=>number=randomInt):NextVariantResult {
  const input=settings.variant,random=(max:number)=>drawValue(draw,max);
  switch(game){
    case 'variant-keno':{
      const {numbers,target}=input as {numbers:number[];target:2|3},drawn=drawPool(20,5,random).map(n=>n+1),hits=drawn.filter(n=>numbers.includes(n)).length,won=hits>=target,multiplier=kenoMultiplier(target);
      return {variant:{kind:'keno',numbers:[...numbers].sort((a,b)=>a-b),drawn,hits,target,won,multiplier},ended:true,credit:won?payout(stakeUnits,multiplier):0,message:won?'Билет выиграл: совпадений '+hits:'Совпадений: '+hits};
    }
    case 'variant-color':{
      const engine:ColorState={kind:'color',deck:drawPool(52,52,random),history:[]};return {engine,variant:colorView(engine,stakeUnits),ended:false,credit:0,message:'Предскажи цвет первой карты'};
    }
    case 'variant-keys':{
      const engine:KeysState={kind:'keys',traps:Array.from({length:6},()=>random(4)),picks:[]};return {engine,variant:keysView(engine,stakeUnits,false),ended:false,credit:0,message:'Выбери два замка первой ступени'};
    }
    case 'variant-fruits':{
      const {lines}=input as {lines:2|3},stakes=splitStakeUnits(stakeUnits,lines),rows=stakes.map(stake=>{const symbols=Array.from({length:3},()=>fruitsSymbolForStop(random(FRUITS_REEL_SIZE))),multiplier=fruitsMultiplier(symbols);return {symbols,stakeUnits:stake,multiplier,returnedUnits:String(payout(stake,multiplier))};});
      return {variant:{kind:'fruits',lines,rows},ended:true,credit:rows.reduce((sum,row)=>sum+Number(row.returnedUnits),0),message:'Линии завершены: выигрышных '+rows.filter(row=>row.multiplier>0).length};
    }
    case 'variant-duel':{
      const {band}=input as {band:DuelBand},cards=drawPool(52,2,random).map(id=>NEXT_CARD_LABELS[id]),gap=Math.abs(cardRank(cards[0])-cardRank(cards[1])),won=duelMatches(band,gap),multiplier=duelMultiplier(band);
      return {variant:{kind:'duel',band,dragon:cards[0],tiger:cards[1],gap,won,multiplier},ended:true,credit:won?payout(stakeUnits,multiplier):0,message:won?'Разрыв совпал: '+gap:'Разрыв между картами: '+gap};
    }
    case 'variant-war':{
      const {mode}=input as {mode:WarMode},fronts=splitStakeUnits(stakeUnits,2).map(stake=>{const [player,dealer]=drawPool(52,2,random).map(id=>NEXT_CARD_LABELS[id]),result=warResult(player,dealer),multiplier=warMultiplier(mode,result);return {player,dealer,result,stakeUnits:stake,multiplier,returnedUnits:String(payout(stake,multiplier))};});
      return {variant:{kind:'war',mode,fronts},ended:true,credit:fronts.reduce((sum,front)=>sum+Number(front.returnedUnits),0),message:'Оба фронта завершены'};
    }
  }
}
function validColorState(value:unknown):value is ColorState {
  if(!value||typeof value!=='object')return false;const v=value as ColorState;
  if(v.kind!=='color'||!Array.isArray(v.deck)||v.deck.length!==52||new Set(v.deck).size!==52||v.deck.some(n=>!Number.isInteger(n)||n<0||n>=52)||!Array.isArray(v.history)||v.history.length>=6)return false;
  return v.history.every((item,i)=>item&&item.card===NEXT_CARD_LABELS[v.deck[i]]&&['red','black'].includes(item.prediction)&&item.color===cardColor(item.card)&&item.won===true&&item.color===item.prediction);
}
function validKeysState(value:unknown):value is KeysState {
  if(!value||typeof value!=='object')return false;const v=value as KeysState;
  return v.kind==='keys'&&Array.isArray(v.traps)&&v.traps.length===6&&v.traps.every(n=>Number.isInteger(n)&&n>=0&&n<4)&&Array.isArray(v.picks)&&v.picks.length<6&&v.picks.every((picks,i)=>Array.isArray(picks)&&picks.length===2&&new Set(picks).size===2&&picks.every(n=>Number.isInteger(n)&&n>=0&&n<4&&n!==v.traps[i]));
}
export function moveNextVariant(game:NextVariantGameId,payload:unknown,move:string,picks:number[]|undefined,stakeUnits:string):NextVariantResult {
  if(game==='variant-color'){
    if(!validColorState(payload))throw Error('Invalid private color state');const engine=structuredClone(payload);
    if(picks!==undefined)throw new NextVariantMoveError('Выбор ячеек недоступен в этой игре.');
    if(move==='cashout'){if(!engine.history.length)throw new NextVariantMoveError('Сначала угадай цвет карты.');const variant=colorView(engine,stakeUnits);return {engine,variant,ended:true,credit:Number(variant.cashoutUnits),message:'Выплата за серию получена'};}
    if(move!=='red'&&move!=='black')throw new NextVariantMoveError('Выбери красный или чёрный цвет.');
    const card=NEXT_CARD_LABELS[engine.deck[engine.history.length]],color=cardColor(card),won=color===move;engine.history.push({card,prediction:move as CardColor,color,won});
    const ended=!won||engine.history.length===6,variant=colorView(engine,stakeUnits);
    return {engine,variant,ended,credit:ended?Number(variant.cashoutUnits):0,message:!won?'Цвет не совпал: ставка потеряна':ended?'Шесть цветов угаданы: выплата получена':'Цвет угадан: продолжай или забери выплату'};
  }
  if(game==='variant-keys'){
    if(!validKeysState(payload))throw Error('Invalid private keys state');const engine=structuredClone(payload);
    if(move==='cashout'){if(!engine.picks.length||picks!==undefined)throw new NextVariantMoveError('Сначала открой одну ступень.');const variant=keysView(engine,stakeUnits,true);return {engine,variant,ended:true,credit:Number(variant.cashoutUnits),message:'Выплата с лестницы получена'};}
    if(move!=='unlock'||!picks||picks.length!==2||new Set(picks).size!==2||picks.some(n=>!Number.isInteger(n)||n<0||n>3))throw new NextVariantMoveError('Выбери два разных замка текущей ступени.');
    engine.picks.push([...picks].sort((a,b)=>a-b));const lost=picks.includes(engine.traps[engine.picks.length-1]),ended=lost||engine.picks.length===6,variant=keysView(engine,stakeUnits,ended);
    return {engine,variant,ended,credit:ended?Number(variant.cashoutUnits):0,message:lost?'Ловушка: ставка потеряна':ended?'Шесть ступеней пройдены: выплата получена':'Оба замка безопасны: можно забрать выплату'};
  }
  throw new NextVariantMoveError('Эта партия уже завершена.');
}

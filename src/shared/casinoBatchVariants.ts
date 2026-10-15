import { combinations, NEXT_CARD_LABELS } from './casinoNextVariants';
import { DEMO_BETS } from './demoWallet';

export const BATCH_VARIANT_GAMES = ['variant-target-plinko','variant-triple-poker','variant-blackjack-target','variant-gem-collection','variant-double-mines','variant-dice-streak'] as const;
export type BatchVariantGameId = typeof BATCH_VARIANT_GAMES[number];
export type PlinkoTarget = 'center'|'corridor'|'edges';
export type PokerTarget = 'pair'|'flush'|'straight';
export type BlackjackTarget = '17-18'|'19-20'|'21';
export type StreakThreshold = 2|3|4;
export type StreakHistory = {die:number;threshold:StreakThreshold;won:boolean}[];
export type BatchVariantSettings = {variant:{target:PlinkoTarget|PokerTarget|BlackjackTarget}|{gems:number[]}|Record<string,never>};
export type BatchVariantView =
  | {kind:'target-plinko';target:PlinkoTarget;path:number[];bucket:number;won:boolean;multiplier:number}
  | {kind:'triple-poker';target:PokerTarget;cards:string[];won:boolean;multiplier:number}
  | {kind:'blackjack-target';target:BlackjackTarget;cards:string[];total:number;won:boolean;multiplier:number}
  | {kind:'gem-collection';gems:number[];hand:number[];matches:number[];won:boolean;multiplier:number}
  | {kind:'double-mines';cells:('hidden'|'safe'|'mine')[];picks:number[][];steps:number;maxSteps:5;multiplier:number;cashoutUnits:string}
  | {kind:'dice-streak';history:StreakHistory;steps:number;maxSteps:5;multiplier:number;cashoutUnits:string};

export const BATCH_GEM_WEIGHTS = [30,25,20,15,8,2] as const;
export const BATCH_VARIANT_NAMES:Record<BatchVariantGameId,string> = {
  'variant-target-plinko':'Плинко: мишень','variant-triple-poker':'Три карты: комбинация','variant-blackjack-target':'21: тройной расклад',
  'variant-gem-collection':'Самоцветы: коллекция','variant-double-mines':'Мины: парный поиск','variant-dice-streak':'Кости: серия',
};
export const BATCH_VARIANT_RULES:Record<BatchVariantGameId,string> = {
  'variant-target-plinko':'Один шарик проходит 12 рядов. Выбери центральную лунку 6, коридор 4-8 или края 0-2 и 10-12. Любой поворот равновероятен. Попадание в выбранную область даёт выплату. Расчётный возврат до округления: 98%.',
  'variant-triple-poker':'Три разные карты из колоды 52 карт. До раздачи выбери пару (включая тройку), три карты одной масти или три последовательных ранга. Туз участвует в А-2-3 и Д-К-А. Стрит и флеш могут пересекаться. Расчётный возврат до округления: 98%.',
  'variant-blackjack-target':'Три разные карты из колоды 52 карт. До раздачи выбери сумму 17-18, 19-20 или ровно 21. Картинки стоят 10; туз стоит 11 и снижается до 1, если сумма больше 21. Добора нет. Расчётный возврат до округления: 98%.',
  'variant-gem-collection':'Выбери три разных самоцвета и открой пять символов. Для выигрыша каждый выбранный самоцвет должен встретиться хотя бы один раз. Редкие коллекции платят больше. Расчётный возврат до округления: 98%.',
  'variant-double-mines':'В поле 16 ячеек и 4 ловушки. За ход открой две разные закрытые ячейки: обе должны быть безопасными. Можно забрать выплату после первой безопасной пары. Пятая завершает игру автоматически. Ловушки сохраняются на сервере. Расчётный возврат до округления: 98%.',
  'variant-dice-streak':'Перед каждым броском выбери порог 2+, 3+ или 4+. Кость от 1 до 6 должна достичь порога. Можно забрать выплату после первого успеха; пятый завершает серию автоматически. Ошибка теряет ставку. Будущие броски сохраняются на сервере. Расчётный возврат до округления: 98%.',
};
export const BATCH_VARIANT_DEFAULTS:Record<BatchVariantGameId,BatchVariantSettings> = {
  'variant-target-plinko':{variant:{target:'center'}},'variant-triple-poker':{variant:{target:'pair'}},'variant-blackjack-target':{variant:{target:'21'}},
  'variant-gem-collection':{variant:{gems:[0,1,2]}},'variant-double-mines':{variant:{}},'variant-dice-streak':{variant:{}},
};
export const BATCH_VARIANT_BASES:Record<BatchVariantGameId,string> = {
  'variant-target-plinko':'royal-plinko','variant-triple-poker':'github-three-card','variant-blackjack-target':'github-blackjack',
  'variant-gem-collection':'github-diamonds','variant-double-mines':'royal-mines','variant-dice-streak':'royal-dice',
};
export const BATCH_VARIANT_INFO:Record<BatchVariantGameId,{name:string;base:string;tagline:string;theme:string}> = {
  'variant-target-plinko':{name:BATCH_VARIANT_NAMES['variant-target-plinko'],base:BATCH_VARIANT_BASES['variant-target-plinko'],tagline:'Поставь на область приземления',theme:'target'},
  'variant-triple-poker':{name:BATCH_VARIANT_NAMES['variant-triple-poker'],base:BATCH_VARIANT_BASES['variant-triple-poker'],tagline:'Три карты, три цели',theme:'combination'},
  'variant-blackjack-target':{name:BATCH_VARIANT_NAMES['variant-blackjack-target'],base:BATCH_VARIANT_BASES['variant-blackjack-target'],tagline:'Выбери итог трёх карт',theme:'twenty-one'},
  'variant-gem-collection':{name:BATCH_VARIANT_NAMES['variant-gem-collection'],base:BATCH_VARIANT_BASES['variant-gem-collection'],tagline:'Собери три разных самоцвета',theme:'collection'},
  'variant-double-mines':{name:BATCH_VARIANT_NAMES['variant-double-mines'],base:BATCH_VARIANT_BASES['variant-double-mines'],tagline:'Две ячейки за один ход',theme:'paired'},
  'variant-dice-streak':{name:BATCH_VARIANT_NAMES['variant-dice-streak'],base:BATCH_VARIANT_BASES['variant-dice-streak'],tagline:'Меняй порог каждого броска',theme:'streak'},
};
export const isBatchVariantGame=(value:unknown):value is BatchVariantGameId=>(BATCH_VARIANT_GAMES as readonly unknown[]).includes(value);
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const fields=(value:Record<string,unknown>,expected:string)=>Object.keys(value).sort().join(',')===expected.split(',').sort().join(',');
const integer=(value:unknown,min:number,max:number):value is number=>typeof value==='number'&&Number.isInteger(value)&&value>=min&&value<=max;
const units=(value:unknown):value is string=>typeof value==='string'&&/^(0|[1-9][0-9]{0,14})$/.test(value);
const numberSet=(value:unknown,length:number,min:number,max:number):value is number[]=>Array.isArray(value)&&value.length===length&&new Set(value).size===length&&value.every(n=>integer(n,min,max));
export function validBatchVariantSettings(game:BatchVariantGameId,value:unknown):value is BatchVariantSettings {
  if(!record(value)||!fields(value,'variant')||!record(value.variant))return false;const v=value.variant;
  switch(game){
    case 'variant-target-plinko':return fields(v,'target')&&['center','corridor','edges'].includes(v.target as string);
    case 'variant-triple-poker':return fields(v,'target')&&['pair','flush','straight'].includes(v.target as string);
    case 'variant-blackjack-target':return fields(v,'target')&&['17-18','19-20','21'].includes(v.target as string);
    case 'variant-gem-collection':return fields(v,'gems')&&numberSet(v.gems,3,0,5);
    case 'variant-double-mines':case 'variant-dice-streak':return Object.keys(v).length===0;
  }
}
const floorRatio=(numerator:bigint,denominator:bigint)=>Number(numerator*10000n/denominator)/10000;
export const plinkoTargetMatches=(target:PlinkoTarget,bucket:number)=>target==='center'?bucket===6:target==='corridor'?bucket>=4&&bucket<=8:bucket<=2||bucket>=10;
export const plinkoTargetWinningCount=(target:PlinkoTarget):bigint=>Array.from({length:13},(_,bucket)=>plinkoTargetMatches(target,bucket)?combinations(12,bucket):0n).reduce((a,b)=>a+b,0n);
export const plinkoTargetMultiplier=(target:PlinkoTarget)=>floorRatio(98n*4096n,100n*plinkoTargetWinningCount(target));
export const pokerTargetMatches=(target:PokerTarget,ids:number[]):boolean=>{
  const ranks=ids.map(id=>id%13+1).sort((a,b)=>a-b);
  if(target==='pair')return new Set(ranks).size<3;
  if(target==='flush')return ids.every(id=>Math.floor(id/13)===Math.floor(ids[0]/13));
  return ranks[2]-ranks[0]===2&&new Set(ranks).size===3||ranks.join(',')==='1,12,13';
};
export const POKER_TARGET_COUNTS:Record<PokerTarget,number>={pair:3796,flush:1144,straight:768};
export const pokerTargetMultiplier=(target:PokerTarget)=>floorRatio(98n*combinations(52,3),100n*BigInt(POKER_TARGET_COUNTS[target]));
export function blackjackTripleTotal(ids:number[]):number {const ranks=ids.map(id=>id%13+1);let total=ranks.reduce((sum,rank)=>sum+(rank===1?11:Math.min(rank,10)),0),aces=ranks.filter(rank=>rank===1).length;while(total>21&&aces-->0)total-=10;return total;}
export const blackjackTargetMatches=(target:BlackjackTarget,total:number)=>target==='21'?total===21:target==='17-18'?total===17||total===18:total===19||total===20;
export const BLACKJACK_TARGET_COUNTS:Record<BlackjackTarget,number>=(()=>{const result={'17-18':0,'19-20':0,'21':0};for(let a=0;a<50;a++)for(let b=a+1;b<51;b++)for(let c=b+1;c<52;c++){const total=blackjackTripleTotal([a,b,c]);for(const target of ['17-18','19-20','21'] as const)if(blackjackTargetMatches(target,total))result[target]++;}return result;})();
export const blackjackTargetMultiplier=(target:BlackjackTarget)=>floorRatio(98n*combinations(52,3),100n*BigInt(BLACKJACK_TARGET_COUNTS[target]));
export function collectionWinningCount(gems:number[]):bigint {
  if(!numberSet(gems,3,0,5))throw new RangeError('Invalid gem collection');let count=0n;
  for(let subset=0;subset<8;subset++){let missing=0,bits=0;for(let index=0;index<3;index++)if(subset>>index&1){missing+=BATCH_GEM_WEIGHTS[gems[index]];bits++;}count+=(bits%2?-1n:1n)*BigInt(100-missing)**5n;}
  return count;
}
export const collectionMultiplier=(gems:number[])=>floorRatio(98n*100n**5n,100n*collectionWinningCount(gems));
export const doubleMinesMultiplier=(steps:number)=>{if(!integer(steps,0,5))throw new RangeError('Invalid paired mines step');return steps?floorRatio(98n*combinations(16,2*steps),100n*combinations(12,2*steps)):0;};
export function streakMultiplier(history:StreakHistory):number {if(!history.length)return 0;let numerator=98n,denominator=100n;for(const item of history){if(!item.won)return 0;numerator*=6n;denominator*=BigInt(7-item.threshold);}return floorRatio(numerator,denominator);}
export const BATCH_VARIANT_MAX:Record<BatchVariantGameId,number>={
  'variant-target-plinko':Math.ceil(plinkoTargetMultiplier('edges')),'variant-triple-poker':Math.ceil(pokerTargetMultiplier('straight')),'variant-blackjack-target':Math.ceil(blackjackTargetMultiplier('21')),
  'variant-gem-collection':Math.ceil(collectionMultiplier([3,4,5])),'variant-double-mines':Math.ceil(doubleMinesMultiplier(5)),'variant-dice-streak':32,
};
export const batchVariantKindForGame=(game:BatchVariantGameId):BatchVariantView['kind']=>game.slice('variant-'.length) as BatchVariantView['kind'];
const cardIds=(value:unknown):number[]|undefined=>{if(!Array.isArray(value)||value.length!==3||new Set(value).size!==3||value.some(card=>typeof card!=='string'||!NEXT_CARD_LABELS.includes(card)))return;return value.map(card=>NEXT_CARD_LABELS.indexOf(card));};
export function validBatchVariantView(value:unknown,game?:BatchVariantGameId,ended?:boolean):value is BatchVariantView {
  if(!record(value)||typeof value.kind!=='string'||game!==undefined&&value.kind!==batchVariantKindForGame(game))return false;
  switch(value.kind){
    case 'target-plinko':{
      if(!fields(value,'kind,target,path,bucket,won,multiplier')||!['center','corridor','edges'].includes(value.target as string)||!Array.isArray(value.path)||value.path.length!==12||value.path.some(n=>!integer(n,0,1))||typeof value.won!=='boolean'||ended===false)return false;
      const target=value.target as PlinkoTarget,bucket=value.path.reduce((a,b)=>a+b,0);return value.bucket===bucket&&value.won===plinkoTargetMatches(target,bucket)&&value.multiplier===plinkoTargetMultiplier(target);
    }
    case 'triple-poker':{
      if(!fields(value,'kind,target,cards,won,multiplier')||!['pair','flush','straight'].includes(value.target as string)||typeof value.won!=='boolean'||ended===false)return false;const ids=cardIds(value.cards);if(!ids)return false;const target=value.target as PokerTarget;return value.won===pokerTargetMatches(target,ids)&&value.multiplier===pokerTargetMultiplier(target);
    }
    case 'blackjack-target':{
      if(!fields(value,'kind,target,cards,total,won,multiplier')||!['17-18','19-20','21'].includes(value.target as string)||typeof value.won!=='boolean'||ended===false)return false;const ids=cardIds(value.cards);if(!ids)return false;const target=value.target as BlackjackTarget,total=blackjackTripleTotal(ids);return value.total===total&&value.won===blackjackTargetMatches(target,total)&&value.multiplier===blackjackTargetMultiplier(target);
    }
    case 'gem-collection':{
      if(!fields(value,'kind,gems,hand,matches,won,multiplier')||!numberSet(value.gems,3,0,5)||!Array.isArray(value.hand)||value.hand.length!==5||value.hand.some(n=>!integer(n,0,5))||!Array.isArray(value.matches)||value.matches.length!==3||typeof value.won!=='boolean'||ended===false)return false;
      const matches=value.gems.map(gem=>(value.hand as number[]).filter(n=>n===gem).length);return value.matches.every((n,i)=>n===matches[i])&&value.won===matches.every(n=>n>0)&&value.multiplier===collectionMultiplier(value.gems);
    }
    case 'double-mines':{
      if(!fields(value,'kind,cells,picks,steps,maxSteps,multiplier,cashoutUnits')||value.maxSteps!==5||!integer(value.steps,0,5)||!Array.isArray(value.cells)||value.cells.length!==16||value.cells.some(cell=>!['hidden','safe','mine'].includes(cell))||!Array.isArray(value.picks)||value.picks.length>5||!units(value.cashoutUnits))return false;
      const picked:number[]=[];let wins=0,lost=false;for(const pair of value.picks){if(!numberSet(pair,2,0,15)||lost||pair.some(cell=>picked.includes(cell)))return false;picked.push(...pair);if(pair.some(cell=>(value.cells as string[])[cell]==='mine'))lost=true;else {if(pair.some(cell=>(value.cells as string[])[cell]!=='safe'))return false;wins++;}}
      if(value.steps!==wins||value.picks.length!==wins+Number(lost)||ended===false&&(lost||wins===5||value.cells.some((cell,index)=>cell!==(picked.includes(index)?'safe':'hidden')))||ended===true&&(value.cells.includes('hidden')||value.cells.filter(cell=>cell==='mine').length!==4||!wins&&!lost))return false;
      return value.multiplier===(lost?0:doubleMinesMultiplier(wins))&&(!(lost||!wins)||value.cashoutUnits==='0');
    }
    case 'dice-streak':{
      if(!fields(value,'kind,history,steps,maxSteps,multiplier,cashoutUnits')||value.maxSteps!==5||!integer(value.steps,0,5)||!Array.isArray(value.history)||value.history.length>5||!units(value.cashoutUnits))return false;let wins=0,lost=false;
      for(const item of value.history){if(!record(item)||!fields(item,'die,threshold,won')||!integer(item.die,1,6)||![2,3,4].includes(item.threshold as number)||item.won!==(item.die>=Number(item.threshold))||lost)return false;if(item.won)wins++;else lost=true;}
      if(value.steps!==wins||ended===false&&(lost||wins===5)||ended===true&&!wins&&!lost)return false;return value.multiplier===streakMultiplier(value.history as StreakHistory)&&(!(lost||!wins)||value.cashoutUnits==='0');
    }
    default:return false;
  }
}
export function validBatchVariantSettlement(game:BatchVariantGameId,state:'active'|'settled',stakeUnits:string,spentUnits:string,returnedUnits:string,view:unknown):boolean {
  if(!['active','settled'].includes(state)||!units(stakeUnits)||!units(spentUnits)||!units(returnedUnits)||!(DEMO_BETS as readonly number[]).some(bet=>String(bet*100)===stakeUnits)||spentUnits!==stakeUnits||!validBatchVariantView(view,game,state==='settled'))return false;
  const paid=(multiplier:number)=>(BigInt(stakeUnits)*BigInt(Math.round(multiplier*10000))/10000n).toString();
  if(view.kind==='double-mines'||view.kind==='dice-streak'){
    if(view.cashoutUnits!==paid(view.multiplier))return false;
    return returnedUnits===(state==='active'?'0':view.cashoutUnits);
  }
  return state==='settled'&&returnedUnits===(view.won?paid(view.multiplier):'0');
}

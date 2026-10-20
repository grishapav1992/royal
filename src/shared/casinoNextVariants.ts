import { t as translateText } from '../i18n/index';
import { FRUITS_MAX_MULTIPLIER, fruitsMultiplier } from './gameCore';

export const NEXT_VARIANT_GAMES = ['variant-keno','variant-color','variant-keys','variant-fruits','variant-duel','variant-war'] as const;
export type NextVariantGameId = typeof NEXT_VARIANT_GAMES[number];
export type CardColor = 'red' | 'black';
export type DuelBand = 'tie' | 'near' | 'middle' | 'far';
export type WarMode = 'shield' | 'attack';
export type WarOutcome = 'win' | 'tie' | 'loss';
export type ColorHistory = {card:string;prediction:CardColor;color:CardColor;won:boolean}[];
export type NextVariantInput = {numbers:number[];target:2|3} | Record<string,never> | {lines:2|3} | {band:DuelBand} | {mode:WarMode};
export type NextVariantSettings = {variant:NextVariantInput};
export type NextVariantView =
  | {kind:'keno';numbers:number[];drawn:number[];hits:number;target:2|3;won:boolean;multiplier:number}
  | {kind:'color';history:ColorHistory;redRemaining:number;blackRemaining:number;steps:number;maxSteps:6;multiplier:number;cashoutUnits:string}
  | {kind:'keys';rows:('hidden'|'safe'|'trap')[][];picks:number[][];steps:number;maxSteps:6;multiplier:number;cashoutUnits:string}
  | {kind:'fruits';lines:2|3;rows:{symbols:number[];stakeUnits:string;multiplier:number;returnedUnits:string}[]}
  | {kind:'duel';band:DuelBand;dragon:string;tiger:string;gap:number;won:boolean;multiplier:number}
  | {kind:'war';mode:WarMode;fronts:{player:string;dealer:string;result:WarOutcome;stakeUnits:string;multiplier:number;returnedUnits:string}[]};

export const NEXT_VARIANT_NAMES:Record<NextVariantGameId,string> = {
  'variant-keno':translateText('Кено: мини-билет'),'variant-color':translateText('Красное / чёрное'),'variant-keys':translateText('Лестница: два ключа'),
  'variant-fruits':translateText('Фрукты: три линии'),'variant-duel':translateText('Дракон: точный разрыв'),'variant-war':translateText('Война: два фронта'),
};
export const NEXT_VARIANT_RULES:Record<NextVariantGameId,string> = {
  'variant-keno':translateText('Выбери пять чисел от 1 до 20. Из двадцати чисел выпадут пять разных. Билет выигрывает при двух или трёх совпадениях, в зависимости от выбранной цели. Более трудная цель платит больше. Расчётный возврат до округления: 98%.'),
  'variant-color':translateText('Предсказывай красный или чёрный цвет следующей карты. Карты выходят из одной колоды без возвращения; оставшиеся количества цветов видны. Можно забрать выплату после первого успеха, шестой завершает серию автоматически. Ошибка теряет ставку. Будущие карты сохраняются на сервере. Расчётный возврат до округления: 98%.'),
  'variant-keys':translateText('На каждой из шести ступеней четыре замка, один с ловушкой. Выбери два замка одновременно: оба должны быть безопасными. После успешной ступени можно забрать выплату, шестая завершает игру автоматически. Ловушки сохраняются на сервере. Расчётный возврат до округления: 98%.'),
  'variant-fruits':translateText('Ставка делится между двумя или тремя независимыми горизонтальными линиями. На каждой три барабана и исходная таблица Royal Fruits: три вишни 5×, лимона 10×, винограда 30×, семёрки 140×. Смешанные линии не платят. Выплата каждой линии считается отдельно. Расчётный возврат до округления: 97%.'),
  'variant-duel':translateText('Две разные карты выходят из одной колоды. Выбери разрыв между рангами: ничья, 1-3, 4-7 или 8-12. Туз считается единицей. Направление разрыва не важно. Редкие интервалы платят больше. Расчётный возврат до округления: 98%.'),
  'variant-war':translateText('Ставка делится между двумя независимыми фронтами, каждый получает пару разных карт из своей колоды. Туз старший. В режиме «Щит» победа платит 1,96× доли ставки, ничья 0,98×. В режиме «Атака» победа платит 2,0825×, ничья теряет долю. Поражение всегда теряет долю. Расчётный возврат до округления: 98%.'),
};
export const NEXT_VARIANT_DEFAULTS:Record<NextVariantGameId,NextVariantSettings> = {
  'variant-keno':{variant:{numbers:[1,5,9,13,17],target:2}},'variant-color':{variant:{}},'variant-keys':{variant:{}},
  'variant-fruits':{variant:{lines:3}},'variant-duel':{variant:{band:'near'}},'variant-war':{variant:{mode:'shield'}},
};
export const NEXT_VARIANT_BASES:Record<NextVariantGameId,string> = {
  'variant-keno':'royal-keno','variant-color':'github-hilo','variant-keys':'github-tower',
  'variant-fruits':'royal-fruits','variant-duel':'github-dragon-tiger','variant-war':'github-war',
};
export const NEXT_VARIANT_INFO:Record<NextVariantGameId,{name:string;base:string;tagline:string;theme:string}> = {
  'variant-keno':{name:NEXT_VARIANT_NAMES['variant-keno'],base:NEXT_VARIANT_BASES['variant-keno'],tagline:translateText('Пять чисел, две цели'),theme:'tickets'},
  'variant-color':{name:NEXT_VARIANT_NAMES['variant-color'],base:NEXT_VARIANT_BASES['variant-color'],tagline:translateText('Угадай цвет, сохрани серию'),theme:'contrast'},
  'variant-keys':{name:NEXT_VARIANT_NAMES['variant-keys'],base:NEXT_VARIANT_BASES['variant-keys'],tagline:translateText('Два ключа на каждой ступени'),theme:'keys'},
  'variant-fruits':{name:NEXT_VARIANT_NAMES['variant-fruits'],base:NEXT_VARIANT_BASES['variant-fruits'],tagline:translateText('Несколько линий на одну ставку'),theme:'orchard'},
  'variant-duel':{name:NEXT_VARIANT_NAMES['variant-duel'],base:NEXT_VARIANT_BASES['variant-duel'],tagline:translateText('Угадай расстояние между картами'),theme:'duel'},
  'variant-war':{name:NEXT_VARIANT_NAMES['variant-war'],base:NEXT_VARIANT_BASES['variant-war'],tagline:translateText('Два фронта, щит или атака'),theme:'fronts'},
};
export const isNextVariantGame = (value:unknown):value is NextVariantGameId => (NEXT_VARIANT_GAMES as readonly unknown[]).includes(value);
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const fields=(v:Record<string,unknown>,expected:string)=>Object.keys(v).sort().join(',')===expected.split(',').sort().join(',');
const integer=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isInteger(v)&&v>=min&&v<=max;
const units=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,14})$/.test(v);
const numberSet=(v:unknown,length:number,min:number,max:number):v is number[]=>Array.isArray(v)&&v.length===length&&new Set(v).size===length&&v.every(n=>integer(n,min,max));
export function validNextVariantSettings(game:NextVariantGameId,value:unknown):value is NextVariantSettings {
  if(!record(value)||!fields(value,'variant')||!record(value.variant))return false;
  const v=value.variant;
  switch(game){
    case 'variant-keno':return fields(v,'numbers,target')&&numberSet(v.numbers,5,1,20)&&[2,3].includes(v.target as number);
    case 'variant-color':case 'variant-keys':return Object.keys(v).length===0;
    case 'variant-fruits':return fields(v,'lines')&&[2,3].includes(v.lines as number);
    case 'variant-duel':return fields(v,'band')&&['tie','near','middle','far'].includes(v.band as string);
    case 'variant-war':return fields(v,'mode')&&['shield','attack'].includes(v.mode as string);
  }
}
export const NEXT_CARD_LABELS=Array.from({length:52},(_,id)=>['A','2','3','4','5','6','7','8','9','10','J','Q','K'][id%13]+['♠','♥','♦','♣'][Math.floor(id/13)]);
export const cardRank=(card:string):number=>NEXT_CARD_LABELS.indexOf(card)%13+1;
export const cardColor=(card:string):CardColor=>card.endsWith('♥')||card.endsWith('♦')?'red':'black';
const isCard=(v:unknown):v is string=>typeof v==='string'&&NEXT_CARD_LABELS.includes(v);
const ratioMultiplier=(numerator:bigint,denominator:bigint):number=>Number(numerator*10000n/denominator)/10000;
export function combinations(n:number,k:number):bigint {
  if(!integer(n,0,52)||!integer(k,0,n))return 0n;
  let result=1n;for(let i=1;i<=k;i++)result=result*BigInt(n-i+1)/BigInt(i);return result;
}
export function kenoWinningCount(target:2|3):bigint {let count=0n;for(let hits=target;hits<=5;hits++)count+=combinations(5,hits)*combinations(15,5-hits);return count;}
export const kenoWinChance=(target:2|3):number=>Number(kenoWinningCount(target))/Number(combinations(20,5));
export const kenoMultiplier=(target:2|3):number=>ratioMultiplier(98n*combinations(20,5),100n*kenoWinningCount(target));
export function colorMultiplier(history:ColorHistory):number {
  if(!history.length)return 0;
  let red=26,black=26,numerator=98n,denominator=100n;
  for(const item of history){if(!item.won)return 0;const remaining=item.prediction==='red'?red:black;if(!remaining)throw new RangeError('Invalid color history');numerator*=BigInt(red+black);denominator*=BigInt(remaining);if(item.color==='red')red--;else black--;}
  return ratioMultiplier(numerator,denominator);
}
export const keysMultiplier=(steps:number):number=>{if(!integer(steps,0,6))throw new RangeError('Invalid keys step');return steps?ratioMultiplier(98n*2n**BigInt(steps),100n):0;};
export const duelMatches=(band:DuelBand,gap:number):boolean=>band==='tie'?gap===0:band==='near'?gap>=1&&gap<=3:band==='middle'?gap>=4&&gap<=7:gap>=8&&gap<=12;
export const duelWinningCount=(band:DuelBand):number=>{let count=0;for(let a=0;a<52;a++)for(let b=0;b<52;b++)if(a!==b&&duelMatches(band,Math.abs(a%13-b%13)))count++;return count;};
export const duelWinChance=(band:DuelBand):number=>duelWinningCount(band)/(52*51);
export const duelMultiplier=(band:DuelBand):number=>ratioMultiplier(98n*52n*51n,100n*BigInt(duelWinningCount(band)));
export const warMultiplier=(mode:WarMode,result:WarOutcome):number=>result==='loss'?0:mode==='attack'?result==='win'?2.0825:0:result==='win'?1.96:.98;
export const warResult=(player:string,dealer:string):WarOutcome=>{const rank=(card:string)=>cardRank(card)===1?14:cardRank(card);return rank(player)>rank(dealer)?'win':rank(player)===rank(dealer)?'tie':'loss';};
export function splitStakeUnits(stakeUnits:string,count:2|3):string[] {const stake=BigInt(stakeUnits),share=stake/BigInt(count),remainder=Number(stake%BigInt(count));return Array.from({length:count},(_,i)=>(share+BigInt(i<remainder?1:0)).toString());}
export const NEXT_VARIANT_MAX:Record<NextVariantGameId,number> = {
  'variant-keno':Math.ceil(kenoMultiplier(3)),'variant-color':Math.ceil(colorMultiplier(Array.from({length:6},()=>({card:'A♥',prediction:'red',color:'red',won:true})))),
  'variant-keys':63,'variant-fruits':FRUITS_MAX_MULTIPLIER,'variant-duel':Math.ceil(duelMultiplier('tie')),'variant-war':3,
};
export const nextVariantKindForGame=(game:NextVariantGameId):NextVariantView['kind']=>game.slice('variant-'.length) as NextVariantView['kind'];
const paid=(stake:string,multiplier:number):string=>(BigInt(stake)*BigInt(Math.round(multiplier*10000))/10000n).toString();
export function validNextVariantView(value:unknown,game?:NextVariantGameId,ended?:boolean):value is NextVariantView {
  if(!record(value)||typeof value.kind!=='string'||game!==undefined&&value.kind!==nextVariantKindForGame(game))return false;
  switch(value.kind){
    case 'keno':{
      if(!fields(value,'kind,numbers,drawn,hits,target,won,multiplier')||!numberSet(value.numbers,5,1,20)||!numberSet(value.drawn,5,1,20)||![2,3].includes(value.target as number)||typeof value.won!=='boolean'||ended===false)return false;
      const hits=value.drawn.filter(n=>(value.numbers as number[]).includes(n)).length;return value.hits===hits&&value.won===(hits>=Number(value.target))&&value.multiplier===kenoMultiplier(value.target as 2|3);
    }
    case 'color':{
      if(!fields(value,'kind,history,redRemaining,blackRemaining,steps,maxSteps,multiplier,cashoutUnits')||value.maxSteps!==6||!integer(value.steps,0,6)||!Array.isArray(value.history)||value.history.length>6||!units(value.cashoutUnits))return false;
      const cards:string[]=[];let red=26,black=26,wins=0,lost=false;
      for(const item of value.history){if(!record(item)||!fields(item,'card,prediction,color,won')||!isCard(item.card)||cards.includes(item.card)||!['red','black'].includes(item.prediction as string)||item.color!==cardColor(item.card)||item.won!==(item.color===item.prediction)||lost)return false;cards.push(item.card);if(item.color==='red')red--;else black--;if(item.won)wins++;else lost=true;}
      if(value.redRemaining!==red||value.blackRemaining!==black||value.steps!==wins||ended===false&&(lost||wins===6))return false;
      if(ended===true&&!lost&&!wins)return false;
      return value.multiplier===colorMultiplier(value.history as ColorHistory)&&(!(lost||!wins)||value.cashoutUnits==='0');
    }
    case 'keys':{
      if(!fields(value,'kind,rows,picks,steps,maxSteps,multiplier,cashoutUnits')||value.maxSteps!==6||!integer(value.steps,0,6)||!Array.isArray(value.rows)||value.rows.length!==6||!Array.isArray(value.picks)||value.picks.length>6||!units(value.cashoutUnits))return false;
      let wins=0,lost=false;
      for(let i=0;i<6;i++){const row=value.rows[i];if(!Array.isArray(row)||row.length!==4||row.some(c=>!['hidden','safe','trap'].includes(c)))return false;const picks=value.picks[i];if(picks!==undefined){if(!numberSet(picks,2,0,3)||lost)return false;const failed=picks.some(p=>row[p]==='trap');if(failed)lost=true;else{if(picks.some(p=>row[p]!=='safe'))return false;wins++;}}if(ended===false&&(row.includes('trap')||row.some((c,index)=>c!==(picks?.includes(index)?'safe':'hidden'))))return false;if(ended===true&&(row.includes('hidden')||row.filter(c=>c==='trap').length!==1))return false;}
      if(value.steps!==wins||value.picks.length!==wins+Number(lost)||ended===false&&(lost||wins===6)||ended===true&&!lost&&!wins)return false;
      return value.multiplier===(lost?0:keysMultiplier(wins))&&(!(lost||!wins)||value.cashoutUnits==='0');
    }
    case 'fruits':{
      if(!fields(value,'kind,lines,rows')||![2,3].includes(value.lines as number)||!Array.isArray(value.rows)||value.rows.length!==value.lines||ended===false)return false;
      return value.rows.every(row=>record(row)&&fields(row,'symbols,stakeUnits,multiplier,returnedUnits')&&Array.isArray(row.symbols)&&row.symbols.length===3&&row.symbols.every(n=>integer(n,0,3))&&units(row.stakeUnits)&&row.stakeUnits!=='0'&&units(row.returnedUnits)&&row.multiplier===fruitsMultiplier(row.symbols)&&row.returnedUnits===paid(row.stakeUnits,row.multiplier as number));
    }
    case 'duel':{
      if(!fields(value,'kind,band,dragon,tiger,gap,won,multiplier')||!['tie','near','middle','far'].includes(value.band as string)||!isCard(value.dragon)||!isCard(value.tiger)||value.dragon===value.tiger||typeof value.won!=='boolean'||ended===false)return false;
      const gap=Math.abs(cardRank(value.dragon)-cardRank(value.tiger)),band=value.band as DuelBand;return value.gap===gap&&value.won===duelMatches(band,gap)&&value.multiplier===duelMultiplier(band);
    }
    case 'war':{
      if(!fields(value,'kind,mode,fronts')||!['shield','attack'].includes(value.mode as string)||!Array.isArray(value.fronts)||value.fronts.length!==2||ended===false)return false;
      return value.fronts.every(front=>{if(!record(front)||!fields(front,'player,dealer,result,stakeUnits,multiplier,returnedUnits')||!isCard(front.player)||!isCard(front.dealer)||front.player===front.dealer||!units(front.stakeUnits)||front.stakeUnits==='0'||!units(front.returnedUnits))return false;return front.result===warResult(front.player,front.dealer)&&front.multiplier===warMultiplier(value.mode as WarMode,front.result as WarOutcome)&&front.returnedUnits===paid(front.stakeUnits,front.multiplier as number);});
    }
    default:return false;
  }
}

import { getPlinkoMultipliers } from './originalGames';
import { NEXT_VARIANT_GAMES, NEXT_VARIANT_NAMES, NEXT_VARIANT_RULES, NEXT_VARIANT_DEFAULTS, NEXT_VARIANT_BASES, NEXT_VARIANT_INFO, NEXT_VARIANT_MAX, isNextVariantGame, validNextVariantSettings, validNextVariantView, nextVariantKindForGame, type NextVariantSettings, type NextVariantView } from './casinoNextVariants';
import { BATCH_VARIANT_GAMES, BATCH_VARIANT_NAMES, BATCH_VARIANT_RULES, BATCH_VARIANT_DEFAULTS, BATCH_VARIANT_BASES, BATCH_VARIANT_INFO, BATCH_VARIANT_MAX, isBatchVariantGame, validBatchVariantSettings, validBatchVariantView, batchVariantKindForGame, type BatchVariantSettings, type BatchVariantView } from './casinoBatchVariants';

export const BASE_VARIANT_GAMES = ['variant-dice','variant-plinko','variant-limbo','variant-mines','variant-sic-bo','variant-diamonds'] as const;
export type BaseVariantGameId = typeof BASE_VARIANT_GAMES[number];
export const VARIANT_GAMES = [...BASE_VARIANT_GAMES,...NEXT_VARIANT_GAMES,...BATCH_VARIANT_GAMES] as const;
export type VariantGameId = typeof VARIANT_GAMES[number];
export type VariantRisk = 'low' | 'medium' | 'high';
export type VariantGem = 0 | 1 | 2 | 3 | 4 | 5;
export type VariantInput = {width:30|50|70} | {risk:VariantRisk} | {target:3|5|10} | Record<string,never> | {sum:number} | {gem:VariantGem};
export type BaseVariantSettings = {variant:VariantInput};
export type VariantSettings = BaseVariantSettings | NextVariantSettings | BatchVariantSettings;
export type BaseVariantView =
  | {kind:'dice';width:30|50|70;low:number;high:number;roll:number;won:boolean;multiplier:number}
  | {kind:'plinko';risk:VariantRisk;rows:12;balls:{path:number[];bucket:number;multiplier:number}[];table:number[]}
  | {kind:'limbo';target:3|5|10;rolled:number;tickets:{target:number;won:boolean;returnedUnits:string}[]}
  | {kind:'mines';cells:('hidden'|'safe'|'mine')[];opened:number[];maxSafe:6;multiplier:number;cashoutUnits:string}
  | {kind:'sic-bo';sum:number;dice:number[];total:number;won:boolean;multiplier:number}
  | {kind:'diamonds';gem:VariantGem;hand:string[];matches:number;won:boolean;multiplier:number};
export type VariantView = BaseVariantView | NextVariantView | BatchVariantView;

export const VARIANT_NAMES:Record<VariantGameId,string> = {
  ...BATCH_VARIANT_NAMES,
  ...NEXT_VARIANT_NAMES,
  'variant-dice':'Неоновый коридор','variant-plinko':'Плинко: два потока','variant-limbo':'Лимбо: два рубежа',
  'variant-mines':'Хранилище','variant-sic-bo':'Сик Бо: точная сумма','variant-diamonds':'Самоцветы: охота',
};
export const VARIANT_RULES:Record<VariantGameId,string> = {
  ...BATCH_VARIANT_RULES,
  ...NEXT_VARIANT_RULES,
  'variant-dice':'Выбери коридор шириной 30%, 50% или 70% вокруг отметки 50. Результат от 0 до 99,99 должен попасть внутрь: нижняя граница включена, верхняя исключена. Чем уже коридор, тем выше выплата. Расчётный возврат до округления: 98%.',
  'variant-plinko':'Одна ставка делится поровну между двумя шариками. Каждый независимо проходит 12 рядов. Выбери риск и получи сумму обеих выплат по исходной таблице Плинко. Два пути меняют разброс результатов, сохраняя таблицу выплат.',
  'variant-limbo':'Одна ставка делится поровну: первый рубеж 1,5×, второй 3×, 5× или 10×. Один общий результат определяет обе выплаты. Каждый достигнутый рубеж выплачивает свою половину ставки отдельно. Расчётный возврат: около 98%.',
  'variant-mines':'В хранилище 16 ячеек и 3 ловушки. Открывай безопасные ячейки и забирай выплату после первой. Ловушка теряет ставку, шестая безопасная ячейка завершает игру автоматически. Ловушки сохраняются на сервере при закрытии окна. Расчётный возврат до округления: 98%.',
  'variant-sic-bo':'Выбери точную сумму трёх костей от 3 до 18. Триплеты тоже участвуют. Редкие суммы платят больше; сумма должна совпасть с выбором. Расчётный возврат до округления: 98%.',
  'variant-diamonds':'Выбери самоцвет перед раскрытием пяти символов. Два или больше выбранных самоцветов дают выплату. Редкие самоцветы встречаются реже и платят больше. Частоты взяты из Diamonds; расчётный возврат до округления: 98%.',
};
export const VARIANT_DEFAULTS:Record<VariantGameId,VariantSettings> = {
  ...BATCH_VARIANT_DEFAULTS,
  ...NEXT_VARIANT_DEFAULTS,
  'variant-dice':{variant:{width:50}},'variant-plinko':{variant:{risk:'medium'}},'variant-limbo':{variant:{target:5}},
  'variant-mines':{variant:{}},'variant-sic-bo':{variant:{sum:10}},'variant-diamonds':{variant:{gem:0}},
};
export const VARIANT_BASES:Record<VariantGameId,string> = {
  ...BATCH_VARIANT_BASES,
  ...NEXT_VARIANT_BASES,
  'variant-dice':'royal-dice','variant-plinko':'royal-plinko','variant-limbo':'royal-limbo','variant-mines':'royal-mines',
  'variant-sic-bo':'github-sic-bo','variant-diamonds':'github-diamonds',
};
export const VARIANT_INFO:Record<VariantGameId,{name:string;base:string;tagline:string;theme:string}> = {
  ...BATCH_VARIANT_INFO,
  ...NEXT_VARIANT_INFO,
  'variant-dice':{name:VARIANT_NAMES['variant-dice'],base:'royal-dice',tagline:'Попади в светящийся коридор',theme:'neon'},
  'variant-plinko':{name:VARIANT_NAMES['variant-plinko'],base:'royal-plinko',tagline:'Два шарика на одну ставку',theme:'streams'},
  'variant-limbo':{name:VARIANT_NAMES['variant-limbo'],base:'royal-limbo',tagline:'Один результат, два рубежа',theme:'orbit'},
  'variant-mines':{name:VARIANT_NAMES['variant-mines'],base:'royal-mines',tagline:'Открой шесть ячеек хранилища',theme:'vault'},
  'variant-sic-bo':{name:VARIANT_NAMES['variant-sic-bo'],base:'github-sic-bo',tagline:'Угадай точную сумму трёх костей',theme:'jade'},
  'variant-diamonds':{name:VARIANT_NAMES['variant-diamonds'],base:'github-diamonds',tagline:'Найди два выбранных самоцвета',theme:'gems'},
};
export const variantForBase = (base:string):VariantGameId|undefined => VARIANT_GAMES.find(id=>VARIANT_BASES[id]===base);
export const VARIANT_GEMS = ['🟡','🟢','🔵','🟣','🟠','💎'] as const;
export const VARIANT_GEM_NAMES = ['Цитрин','Изумруд','Сапфир','Аметист','Янтарь','Алмаз'] as const;
export const VARIANT_GEM_WEIGHTS = [30,25,20,15,8,2] as const;
export const isVariantGame = (value:unknown):value is VariantGameId => (VARIANT_GAMES as readonly unknown[]).includes(value);
function record(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value);}
export function validVariantSettings(game:VariantGameId,value:unknown):value is VariantSettings {
  if(isBatchVariantGame(game))return validBatchVariantSettings(game,value);
  if(isNextVariantGame(game))return validNextVariantSettings(game,value);
  if(!record(value)||Object.keys(value).join(',')!=='variant'||!record(value.variant))return false;
  const input=value.variant,keys=Object.keys(input).join(',');
  switch(game){
    case 'variant-dice':return keys==='width'&&[30,50,70].includes(input.width as number);
    case 'variant-plinko':return keys==='risk'&&['low','medium','high'].includes(input.risk as string);
    case 'variant-limbo':return keys==='target'&&[3,5,10].includes(input.target as number);
    case 'variant-mines':return keys==='';
    case 'variant-sic-bo':return keys==='sum'&&Number.isInteger(input.sum)&&Number(input.sum)>=3&&Number(input.sum)<=18;
    case 'variant-diamonds':return keys==='gem'&&Number.isInteger(input.gem)&&Number(input.gem)>=0&&Number(input.gem)<=5;
  }
}

// Multipliers are integer units of 0.0001. Money is rounded down only at settlement.
export const floorMultiplier = (numerator:bigint,denominator:bigint):number => Number(numerator*10000n/denominator)/10000;
export const diceMultiplier = (width:30|50|70):number => floorMultiplier(98n,BigInt(width));
export const plinkoTable = (risk:VariantRisk):number[] => getPlinkoMultipliers(12,risk==='low'?'easy':risk==='high'?'hard':'medium');
export const sicBoCount = (sum:number):number => {let count=0;for(let a=1;a<=6;a++)for(let b=1;b<=6;b++)for(let c=1;c<=6;c++)if(a+b+c===sum)count++;return count;};
export const sicBoMultiplier = (sum:number):number => {const count=sicBoCount(sum);if(!count)throw new RangeError('Invalid Sic Bo sum');return floorMultiplier(98n*216n,100n*BigInt(count));};
export const gemWinningCount = (gem:VariantGem):bigint => {
  const p=BigInt(VARIANT_GEM_WEIGHTS[gem]),q=100n-p;
  return 100n**5n-q**5n-5n*p*q**4n;
};
export const gemWinChance = (gem:VariantGem):number => Number(gemWinningCount(gem))/100**5;
export const gemMultiplier = (gem:VariantGem):number => floorMultiplier(98n*100n**5n,100n*gemWinningCount(gem));
export const vaultMultiplier = (opened:number):number => {
  if(!Number.isInteger(opened)||opened<0||opened>6)throw new RangeError('Invalid vault step');
  if(!opened)return 0;
  let safe=1n,total=1n;for(let i=0;i<opened;i++){safe*=BigInt(13-i);total*=BigInt(16-i);}
  return floorMultiplier(98n*total,100n*safe);
};
export const VARIANT_MAX:Record<VariantGameId,number> = {
  ...BATCH_VARIANT_MAX,
  ...NEXT_VARIANT_MAX,
  'variant-dice':4,'variant-plinko':170,'variant-limbo':6,'variant-mines':5,'variant-sic-bo':212,'variant-diamonds':Math.ceil(gemMultiplier(5)),
};

export const variantKindForGame = (game:VariantGameId):VariantView['kind'] => isBatchVariantGame(game)?batchVariantKindForGame(game):isNextVariantGame(game)?nextVariantKindForGame(game):game.slice('variant-'.length) as BaseVariantView['kind'];
const finite=(n:unknown,min:number,max:number):n is number => typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
const integer=(n:unknown,min:number,max:number):n is number => finite(n,min,max)&&Number.isInteger(n);
const unitString=(s:unknown):s is string => typeof s==='string'&&/^(0|[1-9][0-9]{0,14})$/.test(s);
const fields=(value:Record<string,unknown>,expected:string):boolean => Object.keys(value).sort().join(',')===expected.split(',').sort().join(',');
function numberArray(value:unknown,length:number,min:number,max:number):value is number[] {return Array.isArray(value)&&value.length===length&&value.every(n=>integer(n,min,max));}
export function validVariantView(value:unknown,game?:VariantGameId,ended?:boolean):value is VariantView {
  if(game!==undefined&&isBatchVariantGame(game))return validBatchVariantView(value,game,ended);
  if(game!==undefined&&isNextVariantGame(game))return validNextVariantView(value,game,ended);
  if(!record(value)||typeof value.kind!=='string'||game!==undefined&&value.kind!==variantKindForGame(game))return false;
  if(['keno','color','keys','fruits','duel','war'].includes(value.kind))return validNextVariantView(value,undefined,ended);
  if(['target-plinko','triple-poker','blackjack-target','gem-collection','double-mines','dice-streak'].includes(value.kind))return validBatchVariantView(value,undefined,ended);
  switch(value.kind){
    case 'dice':{
      if(!fields(value,'kind,width,low,high,roll,won,multiplier')||![30,50,70].includes(value.width as number)||!finite(value.roll,0,99.99)||typeof value.won!=='boolean')return false;
      const width=value.width as 30|50|70,low=(100-width)/2,high=low+width;
      return value.low===low&&value.high===high&&value.multiplier===diceMultiplier(width)&&value.won===(value.roll>=low&&value.roll<high);
    }
    case 'plinko':{
      if(!fields(value,'kind,risk,rows,balls,table')||!['low','medium','high'].includes(value.risk as string)||value.rows!==12||!Array.isArray(value.balls)||value.balls.length!==2)return false;
      const table=plinkoTable(value.risk as VariantRisk);
      if(!Array.isArray(value.table)||value.table.length!==13||value.table.some((n,i)=>n!==table[i]))return false;
      return value.balls.every(ball=>record(ball)&&fields(ball,'path,bucket,multiplier')&&numberArray(ball.path,12,0,1)&&integer(ball.bucket,0,12)&&ball.bucket===ball.path.reduce((a,b)=>a+b,0)&&ball.multiplier===table[ball.bucket]);
    }
    case 'limbo':{
      if(!fields(value,'kind,target,rolled,tickets')||![3,5,10].includes(value.target as number)||!finite(value.rolled,1,1000000)||!Array.isArray(value.tickets)||value.tickets.length!==2)return false;
      const rolled=value.rolled;
      return value.tickets.every((ticket,i)=>record(ticket)&&fields(ticket,'target,won,returnedUnits')&&ticket.target===(i?value.target:1.5)&&typeof ticket.won==='boolean'&&ticket.won===(rolled>=Number(ticket.target))&&unitString(ticket.returnedUnits)&&(!ticket.won?ticket.returnedUnits==='0':true));
    }
    case 'mines':{
      if(!fields(value,'kind,cells,opened,maxSafe,multiplier,cashoutUnits')||value.maxSafe!==6||!Array.isArray(value.opened)||value.opened.length>6||!numberArray(value.opened,value.opened.length,0,15)||new Set(value.opened).size!==value.opened.length
        ||!Array.isArray(value.cells)||value.cells.length!==16||value.cells.some(c=>!['hidden','safe','mine'].includes(c))||!finite(value.multiplier,0,VARIANT_MAX['variant-mines'])||!unitString(value.cashoutUnits))return false;
      const cells=value.cells;if(value.opened.some(i=>cells[i]!=='safe'))return false;
      if(ended===false&&(cells.includes('mine')||cells.filter(c=>c==='safe').length!==value.opened.length))return false;
      if(ended===true&&(cells.includes('hidden')||cells.filter(c=>c==='mine').length!==3))return false;
      if(ended===false&&value.multiplier!==vaultMultiplier(value.opened.length))return false;
      return (value.multiplier===0&&value.cashoutUnits==='0')||value.multiplier===vaultMultiplier(value.opened.length);
    }
    case 'sic-bo':{
      if(!fields(value,'kind,sum,dice,total,won,multiplier')||!integer(value.sum,3,18)||!numberArray(value.dice,3,1,6)||typeof value.won!=='boolean')return false;
      const total=value.dice.reduce((a,b)=>a+b,0);return value.total===total&&value.won===(total===value.sum)&&value.multiplier===sicBoMultiplier(value.sum);
    }
    case 'diamonds':{
      if(!fields(value,'kind,gem,hand,matches,won,multiplier')||!integer(value.gem,0,5)||!Array.isArray(value.hand)||value.hand.length!==5||value.hand.some(s=>!(VARIANT_GEMS as readonly unknown[]).includes(s))||typeof value.won!=='boolean')return false;
      const gem=value.gem as VariantGem,matches=value.hand.filter(s=>s===VARIANT_GEMS[gem]).length;return value.matches===matches&&value.won===(matches>=2)&&value.multiplier===gemMultiplier(gem);
    }
    default:return false;
  }
}

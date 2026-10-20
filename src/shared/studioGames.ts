import { t as translateText, tr } from '../i18n/index';
import {AFTER_LINES} from './afterglow';
import { DEMO_BETS } from './demoWallet';
import {NITRO_LINES} from './nitroRun';

export const STUDIO_REFERENCE_IDS = ['cosmic-escape','caramel-carnival','orbit','velvet-reign','deep-current','ember-vault','lumen-grove','neon-crown','sky-lanterns','stormforge-duel','copperline-express','saffron-cipher','prism-atelier','midnight-market','pulse-district','rivet-rally','petal-parlor','frostline-courier','beacon-bay','sunbird-trails','gale-riders','dune-hopper','canopy-crossing','aurora-lift','tidal-relay','mosaic-muse','obsidian-drop','signal-fox','saffron-spin','fossil-trail','blazing-orchard','jade-koi','moonlit-mint','starfall-oracle','lucky-spotlight','last-convoy','nitro-run','afterglow','meme-overload'] as const;
export type StudioGameId = `studio-${typeof STUDIO_REFERENCE_IDS[number]}`;
export const STUDIO_GAMES = STUDIO_REFERENCE_IDS.map(id => `studio-${id}` as StudioGameId);
export type StudioKind = 'slot'|'crash'|'flight'|'keno'|'plinko'|'dice'|'wheel'|'mines';
export type StudioTheme = 'space'|'candy'|'ocean'|'forge'|'garden';
export type StudioFeature = 'expand'|'tumble'|'multiplier-wild'|'collect'|'hold'|'cluster'|'ways'|'sticky'|'chosen'|'cell-multipliers'|'walking'|'synced'|'wheels'|'mystery'|'beam'|'trail'|'wish'|'orbs';
export type StudioInfo = {id:StudioGameId;sourceReferenceId:string;name:string;category:StudioKind;kind:StudioKind;cols:number;rows:number;grid:{cols:number;rows:number};paylines:number[][];ways:number;features:StudioFeature[];theme:StudioTheme;palette:string[];color:number;subtitle:string;description:string};
const titles = [translateText('Звёздный побег'),translateText('Карамельный праздник'),translateText('Орбитальный рейс'),translateText('Бархатная корона'),translateText('Сокровища глубин'),translateText('Огненный сейф'),translateText('Светящийся лес'),translateText('Неоновый трон'),translateText('Небесные фонари'),translateText('Кузница стихий'),translateText('Медный экспресс'),translateText('Золотой шифр'),translateText('Мастерская призм'),translateText('Ночной базар'),translateText('Пульс мегаполиса'),translateText('Механический ралли'),translateText('Цветочная гостиная'),translateText('Полярная доставка'),translateText('Маяк удачи'),translateText('Тропа жар-птицы'),translateText('На крыльях ветра'),translateText('Прыжок через дюны'),translateText('Лесной переход'),translateText('Северный подъём'),translateText('Морской маршрут'),translateText('Мозаика чисел'),translateText('Обсидиановый шар'),translateText('Лисий сигнал'),translateText('Золотое вращение'),translateText('Тропа ископаемых'),translateText('Огненный сад 40'),translateText('Нефритовый карп'),translateText('Лунный монетный двор'),translateText('Звёздный оракул'),translateText('Колесо прожекторов'),translateText('Последний конвой'),translateText('Нитро-заезд'),'GIRLHUB','MEME OVERLOAD'];
const themes:StudioTheme[] = ['space','candy','space','space','ocean','forge','garden','space','garden','forge','forge','forge','space','forge','space','forge','garden','ocean','ocean','garden','ocean','forge','garden','space','ocean','space','forge','space','forge','garden','candy','garden','forge','space','candy','forge','forge','forge','space'];
const category:Record<string,StudioKind> = {orbit:'flight','gale-riders':'crash','dune-hopper':'crash','canopy-crossing':'crash','aurora-lift':'crash','tidal-relay':'crash','mosaic-muse':'keno','obsidian-drop':'plinko','signal-fox':'dice','saffron-spin':'wheel','fossil-trail':'mines','lucky-spotlight':'wheel'};
const features:Record<string,StudioFeature[]> = {'meme-overload':['tumble','collect'],'afterglow':['tumble','sticky','cell-multipliers','collect'],'nitro-run':['tumble','collect'],'last-convoy':['tumble','sticky'],'cosmic-escape':['expand'],'caramel-carnival':['tumble'],'velvet-reign':['multiplier-wild','sticky'],'deep-current':['collect'],'ember-vault':['hold'],'lumen-grove':['cluster','collect'],'neon-crown':[],'sky-lanterns':['ways'],'stormforge-duel':['expand','multiplier-wild'],'copperline-express':['sticky','multiplier-wild'],'saffron-cipher':['chosen'],'prism-atelier':['cluster','cell-multipliers'],'midnight-market':['collect','hold'],'pulse-district':['walking'],'rivet-rally':['ways','synced'],'petal-parlor':['wheels'],'frostline-courier':['ways','mystery'],'beacon-bay':['beam'],'sunbird-trails':['trail'],'blazing-orchard':['expand','collect'],'jade-koi':['wish'],'moonlit-mint':['hold'],'starfall-oracle':['tumble','orbs']};
const dimensions:Record<string,[number,number]> = {'meme-overload':[6,5],'afterglow':[6,5],'nitro-run':[6,5],'last-convoy':[6,5],'caramel-carnival':[6,5],'velvet-reign':[5,4],'ember-vault':[5,4],'lumen-grove':[6,5],'neon-crown':[3,3],'sky-lanterns':[6,4],'prism-atelier':[6,6],'rivet-rally':[5,3],'frostline-courier':[5,3],'blazing-orchard':[5,4],'jade-koi':[3,3],'moonlit-mint':[3,3],'starfall-oracle':[6,5]};
const lineCounts:Record<string,number> = {'cosmic-escape':20,'velvet-reign':14,'neon-crown':5,'stormforge-duel':16,'copperline-express':20,'saffron-cipher':15,'midnight-market':10,'pulse-district':10,'petal-parlor':10,'beacon-bay':20,'sunbird-trails':10,'blazing-orchard':40,'jade-koi':5,'moonlit-mint':5};
const palettes:Record<StudioTheme,string[]> = {space:['#161d44','#83c7ff','#e7bdff'],candy:['#4c183d','#ff97c4','#f5ce65'],ocean:['#082c40','#48d5d8','#efd6a1'],forge:['#301c16','#e69248','#eed27e'],garden:['#14382f','#7ce0a2','#e9c783']};
export function makeStudioLines(cols:number,rows:number,count:number):number[][] {
  const lines:number[][]=[];const add=(line:number[])=>{if(!lines.some(old=>old.join()===line.join()))lines.push(line);};
  add(Array(cols).fill(Math.floor(rows/2)));for(let row=0;row<rows;row++)add(Array(cols).fill(row));
  add(Array.from({length:cols},(_,col)=>col%rows));add(Array.from({length:cols},(_,col)=>rows-1-col%rows));
  for(let seed=0;lines.length<count;seed++){let n=seed;const line=Array.from({length:cols},()=>{const row=n%rows;n=Math.floor(n/rows);return row;});add(line);}
  return lines.slice(0,count);
}
export const STUDIO_INFO = Object.fromEntries(STUDIO_REFERENCE_IDS.map((sourceReferenceId,i)=>{
  const id=`studio-${sourceReferenceId}` as StudioGameId,kind=category[sourceReferenceId]??'slot',theme=themes[i],f=features[sourceReferenceId]??[],[cols,rows]=kind==='slot'?(dimensions[sourceReferenceId]??[5,3]):[0,0],ways=f.includes('ways')?rows**cols:0;
  const paylines=sourceReferenceId==='afterglow'?AFTER_LINES.map(line=>[...line]):(sourceReferenceId==='nitro-run'||sourceReferenceId==='meme-overload')?NITRO_LINES.map(line=>[...line]):kind==='slot'&&!ways&&!f.includes('cluster')&&!f.includes('tumble')?makeStudioLines(cols,rows,lineCounts[sourceReferenceId]??20):[];
  const description=sourceReferenceId==='meme-overload'?translateText('Каскады · Разгон до ×5 · Вирусный режим'):sourceReferenceId==='afterglow'?translateText('14 линий · Фотосессия · Альбом героинь'):sourceReferenceId==='nitro-run'?translateText('20 линий · Передачи · Нитро-рывок'):sourceReferenceId==='last-convoy'?translateText('Каскады · Баррикады до ×7 · Эвакуация'):kind==='slot'?(f.includes('tumble')?translateText('Совпадения от восьми символов · До двух каскадов'):f.includes('cluster')?translateText('Соседние группы от пяти символов'):ways?tr`${ways} способов · Совпадения слева направо`:tr`${paylines.length} линий · WILD и совпадения от трёх`):({crash:translateText('Шаги риска · Забери выплату вовремя'),flight:translateText('Пять этапов полёта · Общий кошелёк'),keno:translateText('Пять чисел · Две цели'),plinko:translateText('Двенадцать рядов · Три уровня риска'),dice:translateText('Порог и направление · Числа 0-99'),wheel:translateText('Секторы удачи · Серверный исход'),mines:translateText('Шестнадцать ячеек · Четыре ловушки')} as Record<string,string>)[kind];
  return [id,{id,sourceReferenceId,name:titles[i],category:kind,kind,cols,rows,grid:{cols,rows},paylines,ways,features:f,theme,palette:palettes[theme],color:parseInt(palettes[theme][1].slice(1),16),subtitle:description,description} satisfies StudioInfo];
})) as Record<StudioGameId,StudioInfo>;
export type StudioSettings = {studio:Record<string,never>|{numbers:number[];target:2|3}|{risk:'low'|'medium'|'high'}|{chance:25|50|75;direction:'under'|'over'}|{target:0|1|2|3}};
export type StudioWin = {kind:'line'|'ways'|'cluster'|'anywhere'|'collect'|'coin'|'wheel';symbol:number;positions:number[];count:number;line?:number;raw:number;multiplier:number;payoutUnits:string};
export type StudioSlotFrame = {stage:'base'|'free-spin'|'tumble'|'hold';grid:number[];wins:StudioWin[];raw:number;payoutUnits:string;held:number[]};
export type StudioSlotView = {kind:'slot';cols:number;rows:number;grid:number[];wins:StudioWin[];history:StudioSlotFrame[];stage:StudioSlotFrame['stage'];step:number;remaining:number;maxSteps:3;held:number[];totalPayoutUnits:string};
export type StudioCascadePresentationGameId = 'studio-caramel-carnival'|'studio-starfall-oracle';
export type StudioClusterPresentationGameId = 'studio-lumen-grove'|'studio-prism-atelier';
export type StudioElementPresentationGameId = 'studio-stormforge-duel'|'studio-saffron-cipher'|'studio-beacon-bay';
export type StudioJourneyPresentationGameId = 'studio-copperline-express'|'studio-pulse-district'|'studio-jade-koi';
export type StudioWaysPresentationGameId = 'studio-sky-lanterns'|'studio-rivet-rally'|'studio-frostline-courier';
export type StudioWaysPresentationAward = {winIndex:number;symbol:0|1|2|3;count:number;columns:number[][];paths:number;excludedFullyWildPaths:number;paidWays:number};
export type StudioWaysPresentation = {awards:StudioWaysPresentationAward[]};
export type StudioSyncedPresentation = {sourceColumn:0;columns:number[]};
export type StudioMysteryPresentation = {sourcePosition:0;sourceSymbol:number;symbol:0|1|2;positions:number[]};
export type StudioCollectPresentationGameId = 'studio-deep-current'|'studio-blazing-orchard';
export type StudioCollectionPresentationAward = {winIndex:number;collector:number;coins:{position:number;rawValue:number}[]};
export type StudioCollectionPresentation = {awards:StudioCollectionPresentationAward[]};
export type StudioHoldPresentationGameId = 'studio-ember-vault'|'studio-midnight-market'|'studio-moonlit-mint';
export type StudioHeldCoinPresentation = {position:number;rawValue:number};
export type StudioHoldPresentationAward = StudioHeldCoinPresentation & {winIndex:number};
export type StudioHoldPresentation = {coinValues:StudioHeldCoinPresentation[];newPositions:number[];awards:StudioHoldPresentationAward[]};
export type StudioWheelTrailPresentationGameId = 'studio-petal-parlor'|'studio-sunbird-trails';
export type StudioWheelPresentationAward = {winIndex:number;position:number;count:number;rawValue:number};
export type StudioWheelPresentation = {awards:StudioWheelPresentationAward[]};
export type StudioTrailPresentationAward = {winIndex:number;line:number;positions:number[];factor:number};
export type StudioTrailPresentation = {coinPositions:number[];factor:number;awards:StudioTrailPresentationAward[]};
export type StudioPresentationGameId = 'studio-cosmic-escape'|'studio-velvet-reign'|StudioCascadePresentationGameId|StudioClusterPresentationGameId|StudioElementPresentationGameId|StudioJourneyPresentationGameId|StudioWaysPresentationGameId|StudioCollectPresentationGameId|StudioHoldPresentationGameId|StudioWheelTrailPresentationGameId;
export type StudioSlotPresentationEvent = {kind:'expand-wild'|'chosen-wild'|'beam-wild';column:number;positions:number[];sourcePositions:number[]}|{kind:'sticky-wild';positions:number[]};
export type StudioSlotPresentationMultiplier = {winIndex:number;line:number;factor:2|3|4;positions:number[]};
export type StudioChosenPresentation = {symbol:0|1|2;sourcePosition:0;sourceSymbol:number;matchingColumns:number[];active:boolean};
export type StudioWalkingPresentation = {forcedColumn:number|null;positions:number[];previousForcedColumn:number|null};
export type StudioWishPin = {position:number;symbol:0|1|2};
export type StudioWishPresentation = {symbol:0|1|2|null;pinsBefore:StudioWishPin[];pinsAfter:StudioWishPin[];newPins:StudioWishPin[];completed:boolean};
export type StudioCascadePresentation = {fromStep:number|null;removedPositions:number[];drops:{from:number;to:number;symbol:number}[];refills:{position:number;symbol:number}[];groups:{winIndex:number;symbol:number;count:number;positions:number[]}[];orbPositions:number[];orbFactor:number;orbFactorBefore:number;addedOrbPositions:number[]};
export type StudioClusterPresentation = {groups:{winIndex:number;symbol:number;count:number;positions:number[]}[];collects:{winIndex:number;collector:number;coins:{position:number;rawValue:number}[]}[];cellValues:{position:number;value:1|2|3}[];groupFactors:{winIndex:number;factor:number}[]};
export type StudioSlotPresentationFrame = {gameId:StudioPresentationGameId;step:number;stage:StudioSlotFrame['stage'];beforeGrid:number[];afterGrid:number[];heldBefore:number[];heldAfter:number[];events:StudioSlotPresentationEvent[];multipliers:StudioSlotPresentationMultiplier[];cascade?:StudioCascadePresentation;cluster?:StudioClusterPresentation;chosen?:StudioChosenPresentation;walking?:StudioWalkingPresentation;wish?:StudioWishPresentation;ways?:StudioWaysPresentation;synced?:StudioSyncedPresentation;mystery?:StudioMysteryPresentation;collection?:StudioCollectionPresentation;hold?:StudioHoldPresentation;wheels?:StudioWheelPresentation;trail?:StudioTrailPresentation};
export type StudioSlotPresentation = StudioSlotPresentationFrame & {version:1;sessionId:string;phase:number};
export const isStudioCascadePresentationGame = (game:unknown):game is StudioCascadePresentationGameId => game==='studio-caramel-carnival'||game==='studio-starfall-oracle';
export const isStudioClusterPresentationGame = (game:unknown):game is StudioClusterPresentationGameId => game==='studio-lumen-grove'||game==='studio-prism-atelier';
export const isStudioElementPresentationGame = (game:unknown):game is StudioElementPresentationGameId => game==='studio-stormforge-duel'||game==='studio-saffron-cipher'||game==='studio-beacon-bay';
export const isStudioJourneyPresentationGame = (game:unknown):game is StudioJourneyPresentationGameId => game==='studio-copperline-express'||game==='studio-pulse-district'||game==='studio-jade-koi';
export const isStudioWaysPresentationGame = (game:unknown):game is StudioWaysPresentationGameId => game==='studio-sky-lanterns'||game==='studio-rivet-rally'||game==='studio-frostline-courier';
export const isStudioCollectPresentationGame = (game:unknown):game is StudioCollectPresentationGameId => game==='studio-deep-current'||game==='studio-blazing-orchard';
export const isStudioHoldPresentationGame = (game:unknown):game is StudioHoldPresentationGameId => game==='studio-ember-vault'||game==='studio-midnight-market'||game==='studio-moonlit-mint';
export const isStudioWheelTrailPresentationGame = (game:unknown):game is StudioWheelTrailPresentationGameId => game==='studio-petal-parlor'||game==='studio-sunbird-trails';
export const isStudioPresentationGame = (game:unknown):game is StudioPresentationGameId => game==='studio-cosmic-escape'||game==='studio-velvet-reign'||isStudioCascadePresentationGame(game)||isStudioClusterPresentationGame(game)||isStudioElementPresentationGame(game)||isStudioJourneyPresentationGame(game)||isStudioWaysPresentationGame(game)||isStudioCollectPresentationGame(game)||isStudioHoldPresentationGame(game)||isStudioWheelTrailPresentationGame(game);
export type StudioRiskView = {kind:'crash'|'flight';history:{safe:boolean;threshold:number}[];steps:number;maxSteps:number;multiplier:number;cashoutUnits:string};
export type StudioView = StudioSlotView|StudioRiskView
  |{kind:'keno';numbers:number[];drawn:number[];target:2|3;hits:number;won:boolean;multiplier:number}
  |{kind:'plinko';risk:'low'|'medium'|'high';path:number[];bucket:number;table:number[];multiplier:number}
  |{kind:'dice';chance:25|50|75;direction:'under'|'over';roll:number;won:boolean;multiplier:number}
  |{kind:'wheel';target:0|1|2|3;sector:number;segments:number[];won:boolean;multiplier:number}
  |{kind:'mines';cells:('hidden'|'safe'|'mine')[];opened:number[];steps:number;maxSteps:6;multiplier:number;cashoutUnits:string};
export const isStudioGame=(value:unknown):value is StudioGameId=>(STUDIO_GAMES as readonly unknown[]).includes(value);
export const STUDIO_DEFAULTS=Object.fromEntries(STUDIO_GAMES.map(id=>[id,{studio:STUDIO_INFO[id].kind==='keno'?{numbers:[1,5,9,13,17],target:2}:STUDIO_INFO[id].kind==='plinko'?{risk:'medium'}:STUDIO_INFO[id].kind==='dice'?{chance:50,direction:'under'}:STUDIO_INFO[id].kind==='wheel'?{target:0}:{}}])) as Record<StudioGameId,StudioSettings>;
export const STUDIO_SYMBOLS=[{id:0,name:translateText('Символ I'),label:'◆'},{id:1,name:translateText('Символ II'),label:'●'},{id:2,name:translateText('Символ III'),label:'▲'},{id:3,name:'WILD',label:'W'},{id:4,name:translateText('SCATTER / сборщик'),label:'S'},{id:5,name:translateText('Монета'),label:'₿'}] as const;
export const STUDIO_STRIPS = [[0,1,2,3,4,5],[1,0,2,4,3,5],[2,1,0,5,4,3],[0,2,1,3,5,4],[1,2,0,4,5,3],[2,0,1,5,3,4]] as const;
export function studioStrip(game:StudioGameId,col:number):readonly number[] {const f=STUDIO_INFO[game].features;if(f.includes('tumble'))return [0,0,1,1,2,5].map((_,i)=>[0,0,1,1,2,5][(i+col*2)%6]);if(f.includes('cluster'))return [0,0,1,2,4,5].map((_,i)=>[0,0,1,2,4,5][(i+col)%6]);return STUDIO_STRIPS[col];}
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const fields=(value:Record<string,unknown>,keys:string)=>Object.keys(value).sort().join()===keys.split(',').sort().join();
const integer=(value:unknown,min:number,max:number):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=min&&value<=max;
const units=(value:unknown):value is string=>typeof value==='string'&&/^(0|[1-9][0-9]{0,14})$/.test(value);
const unique=(value:unknown,n:number,min:number,max:number):value is number[]=>Array.isArray(value)&&value.length===n&&new Set(value).size===n&&value.every(v=>integer(v,min,max));
export function validStudioSettings(game:StudioGameId,value:unknown):value is StudioSettings {
  if(!record(value)||!fields(value,'studio')||!record(value.studio))return false;const v=value.studio;
  switch(STUDIO_INFO[game].kind){case 'keno':return fields(v,'numbers,target')&&unique(v.numbers,5,1,20)&&[2,3].includes(v.target as number);case 'plinko':return fields(v,'risk')&&['low','medium','high'].includes(v.risk as string);case 'dice':return fields(v,'chance,direction')&&[25,50,75].includes(v.chance as number)&&['under','over'].includes(v.direction as string);case 'wheel':return fields(v,'target')&&integer(v.target,0,3);default:return Object.keys(v).length===0;}
}
export const studioRatio=(numerator:bigint,denominator:bigint)=>Number(numerator*10000n/denominator)/10000;
export const studioPaid=(stake:string,multiplier:number)=>(BigInt(stake)*BigInt(Math.round(multiplier*10000))/10000n).toString();
export function studioChoose(n:number,k:number):bigint {let out=1n;for(let i=1;i<=k;i++)out=out*BigInt(n-i+1)/BigInt(i);return out;}
export const studioKenoCount=(target:2|3)=>Array.from({length:6-target},(_,i)=>studioChoose(5,i+target)*studioChoose(15,5-i-target)).reduce((a,b)=>a+b,0n);
export const studioKenoMultiplier=(target:2|3)=>studioRatio(98n*studioChoose(20,5),100n*studioKenoCount(target));
export const studioDiceMultiplier=(chance:25|50|75)=>studioRatio(98n,BigInt(chance));
export function studioPlinkoTable(risk:'low'|'medium'|'high'):number[] {const raw=Array.from({length:13},(_,i)=>risk==='low'?1+Math.abs(6-i):risk==='medium'?1+Math.abs(6-i)**3:1+Math.abs(6-i)**6),total=raw.reduce((sum,n,i)=>sum+studioChoose(12,i)*BigInt(n),0n);return raw.map(n=>studioRatio(98n*4096n*BigInt(n),100n*total));}
export const studioWheelSegments=(game:StudioGameId):number[]=>game==='studio-lucky-spotlight'?[0,1,0,2,0,1,0,3,0,1,0,2,0,1,0,3]:[0,1,0,2,0,1,0,3,0,1,0,2];
export const studioWheelMultiplier=(game:StudioGameId,target:number)=>{const segments=studioWheelSegments(game);return studioRatio(98n*BigInt(segments.length),100n*BigInt(segments.filter(n=>n===target).length));};
export const studioRiskThreshold=(game:StudioGameId):number=>game==='studio-dune-hopper'?3:game==='studio-canopy-crossing'?4:game==='studio-tidal-relay'?3:2;
export const studioRiskMax=(game:StudioGameId):number=>game==='studio-canopy-crossing'?3:game==='studio-tidal-relay'?4:5;
export const studioRiskMultiplier=(game:StudioGameId,steps:number)=>steps?studioRatio(98n*6n**BigInt(steps),100n*BigInt(7-studioRiskThreshold(game))**BigInt(steps)):0;
export const studioMinesMultiplier=(steps:number)=>steps?studioRatio(98n*studioChoose(16,steps),100n*studioChoose(12,steps)):0;

export type StudioRawWin = Omit<StudioWin,'multiplier'|'payoutUnits'>;
export type StudioRawFrame = Omit<StudioSlotFrame,'wins'|'payoutUnits'> & {wins:StudioRawWin[]};
const lengthPay=(length:number)=>length===3?2:length===4?6:length===5?18:45;
export function studioGrid(game:StudioGameId,stops:number[]):number[] {
  const info=STUDIO_INFO[game],actual=[...stops],linked=info.features.includes('synced')?Math.min(info.cols,2+stops[0]%4):0;
  for(let col=1;col<linked;col++)actual[col]=actual[0];
  const grid=Array.from({length:info.cols*info.rows},(_,i)=>{const col=i%info.cols,row=Math.floor(i/info.cols);return studioStrip(game,col<linked?0:col)[(actual[col]+row)%6];});
  return studioTransformGrid(game,grid,0,[]);
}
export function studioTransformGrid(game:StudioGameId,input:number[],step:number,held:number[]):number[] {
  const info=STUDIO_INFO[game],grid=[...input],f=info.features;
  if(f.includes('mystery')){const replacement=grid[0]%3;for(let i=0;i<grid.length;i++)if(grid[i]===4)grid[i]=replacement;}
  if(f.includes('expand'))for(let col=0;col<info.cols;col++){if(game==='studio-blazing-orchard'&&(col===0||col===info.cols-1))continue;if(Array.from({length:info.rows},(_,row)=>grid[row*info.cols+col]).includes(3))for(let row=0;row<info.rows;row++)grid[row*info.cols+col]=3;}
  if(f.includes('chosen')){const chosen=grid[0]<3?grid[0]:0,columns=Array.from({length:info.cols},(_,col)=>Array.from({length:info.rows},(_,row)=>grid[row*info.cols+col]).includes(chosen));if(columns.filter(Boolean).length>=3)for(let col=0;col<info.cols;col++)if(columns[col])for(let row=0;row<info.rows;row++)grid[row*info.cols+col]=3;}
  if(f.includes('beam')){for(let col=0;col<info.cols;col++)if(input[Math.floor(info.rows/2)*info.cols+col]===3)for(let row=0;row<info.rows;row++)grid[row*info.cols+col]=3;}
  if(step&&f.includes('walking'))for(let row=0;row<info.rows;row++)grid[row*info.cols+(info.cols-step)%info.cols]=3;
  if(step&&f.includes('sticky'))for(const position of held)grid[position]=3;
  return grid;
}
export function studioScore(game:StudioGameId,grid:number[],step=0,wheelSeed?:number):StudioRawWin[] {
  const info=STUDIO_INFO[game],wins:StudioRawWin[]=[],f=info.features;
  const push=(kind:StudioRawWin['kind'],symbol:number,positions:number[],raw:number,line?:number,count=positions.length)=>{if(raw>0)wins.push({kind,symbol,positions,count,...(line===undefined?{}:{line}),raw});};
  if(f.includes('tumble')){
    for(let symbol=0;symbol<3;symbol++){const positions=grid.flatMap((value,i)=>value===symbol?[i]:[]);if(positions.length>=8)push('anywhere',symbol,positions,(positions.length-7)*(symbol+2)*4*(f.includes('orbs')?1+grid.filter(value=>value===5).length:1));}
  }else if(f.includes('cluster')){
    const seen=new Set<number>();for(let first=0;first<grid.length;first++){if(seen.has(first)||grid[first]>3)continue;const symbol=grid[first],positions=[first];seen.add(first);for(let at=0;at<positions.length;at++){const i=positions[at],col=i%info.cols,row=Math.floor(i/info.cols),neighbors=[...(col?[i-1]:[]),...(col+1<info.cols?[i+1]:[]),...(row?[i-info.cols]:[]),...(row+1<info.rows?[i+info.cols]:[])];for(const n of neighbors)if(!seen.has(n)&&grid[n]===symbol){seen.add(n);positions.push(n);}}
      if(positions.length>=5){const factor=f.includes('cell-multipliers')?positions.reduce((sum,i)=>sum+1+(i+step)%3,0):positions.length;push('cluster',symbol,positions,(positions.length-4)*(symbol+2)*2*factor);}}
  }else if(info.ways){
    for(let symbol=0;symbol<3;symbol++){let count=0,paths=1,wildPaths=1;const positions:number[]=[];for(let col=0;col<info.cols;col++){const matches=Array.from({length:info.rows},(_,row)=>row*info.cols+col).filter(i=>grid[i]===symbol||grid[i]===3);if(!matches.length)break;count++;paths*=matches.length;wildPaths*=matches.filter(i=>grid[i]===3).length;positions.push(...matches);}if(count>=3)push('ways',symbol,positions,(paths-wildPaths)*(symbol+2)*lengthPay(count),undefined,count);}
    let count=0,paths=1;const positions:number[]=[];for(let col=0;col<info.cols;col++){const matches=Array.from({length:info.rows},(_,row)=>row*info.cols+col).filter(i=>grid[i]===3);if(!matches.length)break;count++;paths*=matches.length;positions.push(...matches);}if(count>=3)push('ways',3,positions,paths*6*lengthPay(count),undefined,count);
  }else{
    info.paylines.forEach((line,index)=>{const positions=line.map((row,col)=>row*info.cols+col);let best:{symbol:number;count:number;raw:number}|undefined;for(let symbol=0;symbol<3;symbol++){let count=0;while(count<positions.length&&[symbol,3].includes(grid[positions[count]]))count++;if(count<3)continue;const wilds=positions.slice(0,count).filter(i=>grid[i]===3).length,raw=(symbol+2)*lengthPay(count)*(f.includes('multiplier-wild')&&wilds?1+Math.min(3,wilds):1)*(f.includes('trail')?Math.min(8,1+step+grid.filter(v=>v===5).length):1);if(!best||raw>best.raw)best={symbol,count,raw};}if(best)push('line',best.symbol,positions.slice(0,best.count),best.raw,index,best.count);});
  }
  if(f.includes('collect')){const coins=grid.flatMap((value,i)=>value===5?[i]:[]),collectors=grid.flatMap((value,i)=>value===4?[i]:[]).slice(0,2);if(coins.length)for(const collector of collectors)push('collect',5,[collector,...coins],coins.reduce((sum,i)=>sum+2+i%4,0));}
  if(step&&f.includes('wheels')&&wheelSeed!==undefined)push('wheel',5,[Math.floor(info.rows/2)*info.cols+[0,2,4][step-1]],(wheelSeed+1)*10,undefined,wheelSeed+1);
  if(f.includes('wish')&&grid.every(value=>value===grid[0]&&value<3))push('collect',grid[0],grid.map((_,i)=>i),200);
  return wins;
}
export function studioHeld(game:StudioGameId,grid:number[],previous:number[]=[]):number[] {const f=STUDIO_INFO[game].features;if(f.includes('hold'))return grid.flatMap((value,i)=>value===5?[i]:[]);if(f.includes('sticky'))return [...new Set([...previous,...grid.flatMap((value,i)=>value===3?[i]:[])])].sort((a,b)=>a-b);if(f.includes('wish'))return [...new Set([...previous,...grid.flatMap((value,i)=>value===grid[0]&&value<3?[i]:[])])].sort((a,b)=>a-b);return [];}
export function studioSlotHasBonus(game:StudioGameId,frame:StudioRawFrame):boolean {const info=STUDIO_INFO[game];if(['studio-neon-crown','studio-rivet-rally','studio-blazing-orchard'].includes(game))return false;if(info.features.includes('hold'))return frame.grid.filter(value=>value===5).length>=3;if(info.features.includes('tumble'))return frame.wins.length>0;return frame.grid.filter(value=>value===4).length>=3||info.features.includes('mystery')&&frame.grid.filter(value=>value===5).length>=3;}
export function studioBaseFrame(game:StudioGameId,stops:number[]):StudioRawFrame {const grid=studioGrid(game,stops),held=studioHeld(game,grid),wins=studioScore(game,grid);if(STUDIO_INFO[game].features.includes('hold')&&grid.filter(value=>value===5).length>=3){for(const i of held)wins.push({kind:'coin',symbol:5,positions:[i],count:1,raw:2+i%4});}return {stage:'base',grid,wins,raw:wins.reduce((sum,win)=>sum+win.raw,0),held};}
export function studioBonusFrame(game:StudioGameId,previous:StudioRawFrame,seed:number,step:number):StudioRawFrame {
  const info=STUDIO_INFO[game],f=info.features;let grid:number[],stage:StudioRawFrame['stage']='free-spin';
  if(f.includes('tumble')){stage='tumble';const removed=new Set(previous.wins.flatMap(win=>win.positions));grid=Array(previous.grid.length).fill(0);for(let col=0;col<info.cols;col++){const survivors=Array.from({length:info.rows},(_,row)=>row*info.cols+col).filter(i=>!removed.has(i)).map(i=>previous.grid[i]);const fill=info.rows-survivors.length;for(let row=0;row<fill;row++)grid[row*info.cols+col]=studioStrip(game,col)[(seed+row+col+step)%6];for(let row=fill;row<info.rows;row++)grid[row*info.cols+col]=survivors[row-fill];}}
  else{grid=Array.from({length:info.cols*info.rows},(_,i)=>{const col=i%info.cols,row=Math.floor(i/info.cols);return studioStrip(game,col)[(seed*(col+1)+row+step+col)%6];});if(f.includes('hold')){stage='hold';for(const i of previous.held)grid[i]=5;}else{grid=studioTransformGrid(game,grid,step,previous.held);if(f.includes('wish'))for(const i of previous.held)grid[i]=previous.grid[i];}}
  const held=studioHeld(game,grid,previous.held),wins=f.includes('hold')?held.filter(i=>!previous.held.includes(i)).map(i=>({kind:'coin' as const,symbol:5,positions:[i],count:1,raw:2+i%4})):studioScore(game,grid,step,seed);
  return {stage,grid,wins,raw:wins.reduce((sum,win)=>sum+win.raw,0),held};
}
export function studioSlotProgram(game:StudioGameId,stops:number[],seeds:number[]):StudioRawFrame[] {const base=studioBaseFrame(game,stops),frames=[base];if(studioSlotHasBonus(game,base))for(let step=1;step<=2;step++){const frame=studioBonusFrame(game,frames[frames.length-1],seeds[step-1],step);frames.push(frame);if(STUDIO_INFO[game].features.includes('tumble')&&!frame.wins.length)break;}return frames;}

/** Describes transformations of one confirmed frame, without changing its scoring. */
export function studioSlotPresentationDetails(game:StudioPresentationGameId,beforeGrid:number[],frame:StudioRawFrame|StudioSlotFrame,step:number,heldBefore:number[]):StudioSlotPresentationFrame {
  const info=STUDIO_INFO[game],events:StudioSlotPresentationEvent[]=[],multipliers:StudioSlotPresentationMultiplier[]=[];
  let chosen:StudioChosenPresentation|undefined;
  if(game==='studio-cosmic-escape'||game==='studio-stormforge-duel')for(let column=0;column<info.cols;column++){
    const positions=Array.from({length:info.rows},(_,row)=>row*info.cols+column),sourcePositions=positions.filter(position=>beforeGrid[position]===3);
    if(sourcePositions.length)events.push({kind:'expand-wild',column,positions,sourcePositions});
  }
  if(game==='studio-saffron-cipher'){
    const symbol=(beforeGrid[0]<3?beforeGrid[0]:0) as 0|1|2,matchingColumns=Array.from({length:info.cols},(_,column)=>column).filter(column=>Array.from({length:info.rows},(_,row)=>beforeGrid[row*info.cols+column]).includes(symbol));
    chosen={symbol,sourcePosition:0,sourceSymbol:beforeGrid[0],matchingColumns,active:matchingColumns.length>=3};
    if(chosen.active)for(const column of matchingColumns){const positions=Array.from({length:info.rows},(_,row)=>row*info.cols+column);events.push({kind:'chosen-wild',column,positions,sourcePositions:positions.filter(position=>beforeGrid[position]===symbol)});}
  }
  if(game==='studio-beacon-bay')for(let column=0;column<info.cols;column++){
    const sourcePosition=Math.floor(info.rows/2)*info.cols+column;
    if(beforeGrid[sourcePosition]===3)events.push({kind:'beam-wild',column,positions:Array.from({length:info.rows},(_,row)=>row*info.cols+column),sourcePositions:[sourcePosition]});
  }
  if(game==='studio-velvet-reign'||game==='studio-stormforge-duel'){
    if(game==='studio-velvet-reign'&&heldBefore.length)events.push({kind:'sticky-wild',positions:[...heldBefore]});
    frame.wins.forEach((win,winIndex)=>{if(win.kind!=='line'||win.line===undefined)return;const positions=win.positions.filter(position=>frame.grid[position]===3);
      if(positions.length)multipliers.push({winIndex,line:win.line,factor:(1+Math.min(3,positions.length)) as 2|3|4,positions});
    });
  }
  return {gameId:game,step,stage:frame.stage,beforeGrid:[...beforeGrid],afterGrid:[...frame.grid],heldBefore:[...heldBefore],heldAfter:[...frame.held],events,multipliers,...(chosen?{chosen}:{})};
}

/** Facts of current pins and forced columns, using only confirmed frames. */
export function studioJourneyPresentationDetails(game:StudioJourneyPresentationGameId,beforeGrid:number[],previous:StudioRawFrame|StudioSlotFrame|null,frame:StudioRawFrame|StudioSlotFrame,step:number):StudioSlotPresentationFrame {
  const info=STUDIO_INFO[game],heldBefore=previous?.held??[],events:StudioSlotPresentationEvent[]=[],multipliers:StudioSlotPresentationMultiplier[]=[];
  if(game==='studio-copperline-express'){
    const positions=frame.held.filter(position=>!heldBefore.includes(position));
    if(positions.length)events.push({kind:'sticky-wild',positions});
    frame.wins.forEach((win,winIndex)=>{
      if(win.kind!=='line'||win.line===undefined)return;
      const positions=win.positions.filter(position=>frame.grid[position]===3);
      if(positions.length)multipliers.push({winIndex,line:win.line,factor:(1+Math.min(3,positions.length)) as 2|3|4,positions});
    });
  }
  const base:StudioSlotPresentationFrame={gameId:game,step,stage:frame.stage,beforeGrid:[...beforeGrid],afterGrid:[...frame.grid],heldBefore:[...heldBefore],heldAfter:[...frame.held],events,multipliers};
  if(game==='studio-pulse-district'){
    const forcedColumn=step?(info.cols-step)%info.cols:null;
    return {...base,walking:{forcedColumn,positions:forcedColumn===null?[]:Array.from({length:info.rows},(_,row)=>row*info.cols+forcedColumn),previousForcedColumn:step>1?(info.cols-step+1)%info.cols:null}};
  }
  if(game==='studio-jade-koi'){
    const pinsBefore:StudioWishPin[]=heldBefore.map(position=>({position,symbol:previous!.grid[position] as 0|1|2}));
    const pinsAfter:StudioWishPin[]=frame.held.map(position=>({position,symbol:frame.grid[position] as 0|1|2}));
    const symbol=frame.grid[0]<3?frame.grid[0] as 0|1|2:null;
    return {...base,wish:{symbol,pinsBefore,pinsAfter,newPins:pinsAfter.filter(pin=>!heldBefore.includes(pin.position)),completed:symbol!==null&&frame.grid.every(value=>value===symbol)}};
  }
  return base;
}

/** Current ways awards and effective synchronized or revealed symbols, without future outcomes. */
export function studioWaysPresentationDetails(game:StudioWaysPresentationGameId,beforeGrid:number[],frame:StudioRawFrame|StudioSlotFrame,step:number):StudioSlotPresentationFrame {
  const info=STUDIO_INFO[game],awards:StudioWaysPresentationAward[]=frame.wins.map((win,winIndex)=>{
    const columns=Array.from({length:win.count},(_,column)=>win.positions.filter(position=>position%info.cols===column));
    const paths=columns.reduce((product,positions)=>product*positions.length,1);
    const excludedFullyWildPaths=win.symbol===3?0:columns.reduce((product,positions)=>product*positions.filter(position=>frame.grid[position]===3).length,1);
    return {winIndex,symbol:win.symbol as 0|1|2|3,count:win.count,columns,paths,excludedFullyWildPaths,paidWays:paths-excludedFullyWildPaths};
  });
  const base:StudioSlotPresentationFrame={gameId:game,step,stage:frame.stage,beforeGrid:[...beforeGrid],afterGrid:[...frame.grid],heldBefore:[],heldAfter:[],events:[],multipliers:[],ways:{awards}};
  if(game==='studio-rivet-rally'){
    const first=studioStrip(game,0).indexOf(frame.grid[0]),count=Math.min(info.cols,2+first%4);
    return {...base,beforeGrid:[...frame.grid],synced:{sourceColumn:0,columns:Array.from({length:count},(_,column)=>column)}};
  }
  if(game==='studio-frostline-courier')return {...base,mystery:{sourcePosition:0,sourceSymbol:beforeGrid[0],symbol:beforeGrid[0]%3 as 0|1|2,positions:beforeGrid.flatMap((symbol,position)=>symbol===4?[position]:[])}};
  return base;
}

/** Describes current expansion and already-scored collections from confirmed canonical awards. */
export function studioCollectPresentationDetails(game:StudioCollectPresentationGameId,beforeGrid:number[],frame:StudioRawFrame|StudioSlotFrame,step:number):StudioSlotPresentationFrame {
  const info=STUDIO_INFO[game],events:StudioSlotPresentationEvent[]=[],awards:StudioCollectionPresentationAward[]=[];
  if(game==='studio-blazing-orchard')for(let column=1;column<info.cols-1;column++){
    const positions=Array.from({length:info.rows},(_,row)=>row*info.cols+column),sourcePositions=positions.filter(position=>beforeGrid[position]===3);
    if(sourcePositions.length)events.push({kind:'expand-wild',column,positions,sourcePositions});
  }
  frame.wins.forEach((win,winIndex)=>{if(win.kind==='collect')awards.push({winIndex,collector:win.positions[0],coins:win.positions.slice(1).map(position=>({position,rawValue:2+position%4}))});});
  return {gameId:game,step,stage:frame.stage,beforeGrid:[...beforeGrid],afterGrid:[...frame.grid],heldBefore:[],heldAfter:[],events,multipliers:[],collection:{awards}};
}

/** The current paid grid supplies refills; no unplayed seed is read or exposed. */
export function studioCascadePresentationDetails(game:StudioCascadePresentationGameId,previous:StudioRawFrame|StudioSlotFrame|null,frame:StudioRawFrame|StudioSlotFrame,step:number):StudioSlotPresentationFrame {
  const info=STUDIO_INFO[game],beforeGrid=previous?.grid??frame.grid,removedPositions=previous?[...new Set(previous.wins.flatMap(win=>win.positions))].sort((a,b)=>a-b):[],removed=new Set(removedPositions),drops:StudioCascadePresentation['drops']=[],refills:StudioCascadePresentation['refills']=[];
  if(previous)for(let column=0;column<info.cols;column++){
    const survivors=Array.from({length:info.rows},(_,row)=>row*info.cols+column).filter(position=>!removed.has(position)),fill=info.rows-survivors.length;
    survivors.forEach((from,index)=>drops.push({from,to:(fill+index)*info.cols+column,symbol:previous.grid[from]}));
    for(let row=0;row<fill;row++){const position=row*info.cols+column;refills.push({position,symbol:frame.grid[position]});}
  }
  const orbs=game==='studio-starfall-oracle',orbPositions=orbs?frame.grid.flatMap((symbol,position)=>symbol===5?[position]:[]):[],orbFactorBefore=orbs?1+beforeGrid.filter(symbol=>symbol===5).length:1;
  return {gameId:game,step,stage:frame.stage,beforeGrid:[...beforeGrid],afterGrid:[...frame.grid],heldBefore:[],heldAfter:[],events:[],multipliers:[],cascade:{fromStep:previous?step-1:null,removedPositions,drops,refills,groups:frame.wins.map((win,winIndex)=>({winIndex,symbol:win.symbol,count:win.count,positions:[...win.positions]})),orbPositions,orbFactor:1+orbPositions.length,orbFactorBefore,addedOrbPositions:orbs?refills.filter(item=>item.symbol===5).map(item=>item.position):[]}};
}

/** Current connected groups and their already-scored collection or cell values. */
export function studioClusterPresentationDetails(game:StudioClusterPresentationGameId,frame:StudioRawFrame|StudioSlotFrame,step:number):StudioSlotPresentationFrame {
  const groups:StudioClusterPresentation['groups']=[],collects:StudioClusterPresentation['collects']=[],cellValues:StudioClusterPresentation['cellValues']=[],groupFactors:StudioClusterPresentation['groupFactors']=[];
  frame.wins.forEach((win,winIndex)=>{
    if(win.kind==='cluster')groups.push({winIndex,symbol:win.symbol,count:win.count,positions:[...win.positions]});
    if(game==='studio-lumen-grove'&&win.kind==='collect')collects.push({winIndex,collector:win.positions[0],coins:win.positions.slice(1).map(position=>({position,rawValue:2+position%4}))});
  });
  if(game==='studio-prism-atelier'){
    frame.grid.forEach((_,position)=>cellValues.push({position,value:(1+(position+step)%3) as 1|2|3}));
    groups.forEach(group=>groupFactors.push({winIndex:group.winIndex,factor:group.positions.reduce((sum,position)=>sum+cellValues[position].value,0)}));
  }
  return {gameId:game,step,stage:frame.stage,beforeGrid:[...frame.grid],afterGrid:[...frame.grid],heldBefore:[],heldAfter:[],events:[],multipliers:[],cluster:{groups,collects,cellValues,groupFactors}};
}

/** Confirmed coin retention and actual current awards, with no future bonus roll. */
export function studioHoldPresentationDetails(game:StudioHoldPresentationGameId,beforeGrid:number[],previous:StudioRawFrame|StudioSlotFrame|null,frame:StudioRawFrame|StudioSlotFrame,step:number):StudioSlotPresentationFrame {
  const heldBefore=previous?.held??[],awards:StudioHoldPresentationAward[]=[],collections:StudioCollectionPresentationAward[]=[];
  frame.wins.forEach((win,winIndex)=>{
    if(win.kind==='coin')awards.push({winIndex,position:win.positions[0],rawValue:2+win.positions[0]%4});
    if(game==='studio-midnight-market'&&step===0&&win.kind==='collect')collections.push({winIndex,collector:win.positions[0],coins:win.positions.slice(1).map(position=>({position,rawValue:2+position%4}))});
  });
  return {gameId:game,step,stage:frame.stage,beforeGrid:[...beforeGrid],afterGrid:[...frame.grid],heldBefore:[...heldBefore],heldAfter:[...frame.held],events:[],multipliers:[],hold:{coinValues:frame.held.map(position=>({position,rawValue:2+position%4})),newPositions:frame.held.filter(position=>!heldBefore.includes(position)),awards},collection:{awards:collections}};
}

/** Current independent wheel award or already-included line factor, without a future result. */
export function studioWheelTrailPresentationDetails(game:StudioWheelTrailPresentationGameId,frame:StudioRawFrame|StudioSlotFrame,step:number):StudioSlotPresentationFrame {
  const base:StudioSlotPresentationFrame={gameId:game,step,stage:frame.stage,beforeGrid:[...frame.grid],afterGrid:[...frame.grid],heldBefore:[],heldAfter:[],events:[],multipliers:[]};
  if(game==='studio-petal-parlor')return {...base,wheels:{awards:frame.wins.flatMap((win,winIndex)=>win.kind==='wheel'?[{winIndex,position:win.positions[0],count:win.count,rawValue:win.raw}]:[])}};
  const coinPositions=frame.grid.flatMap((symbol,position)=>symbol===5?[position]:[]),factor=Math.min(8,1+step+coinPositions.length);
  return {...base,trail:{coinPositions,factor,awards:frame.wins.flatMap((win,winIndex)=>win.kind==='line'&&win.line!==undefined?[{winIndex,line:win.line,positions:[...win.positions],factor}]:[])}};
}

/** Separate from strict legacy Studio view validation because this is a read-only response. */
export function validStudioSlotPresentation(value:unknown,game:StudioPresentationGameId,sessionId:string,phase:number,view:StudioSlotView):value is StudioSlotPresentation {
  try{
    const cascade=isStudioCascadePresentationGame(game),cluster=isStudioClusterPresentationGame(game),element=isStudioElementPresentationGame(game),journey=isStudioJourneyPresentationGame(game),ways=isStudioWaysPresentationGame(game),collect=isStudioCollectPresentationGame(game),hold=isStudioHoldPresentationGame(game),wheelTrail=isStudioWheelTrailPresentationGame(game);
    if(!isStudioPresentationGame(game)||!record(value)||!fields(value,'version,sessionId,gameId,phase,step,stage,beforeGrid,afterGrid,heldBefore,heldAfter,events,multipliers'+(cascade?',cascade':'')+(cluster?',cluster':'')+(game==='studio-saffron-cipher'?',chosen':'')+(game==='studio-pulse-district'?',walking':'')+(game==='studio-jade-koi'?',wish':'')+(ways?',ways':'')+(game==='studio-rivet-rally'?',synced':'')+(game==='studio-frostline-courier'?',mystery':'')+(collect||hold?',collection':'')+(hold?',hold':'')+(game==='studio-petal-parlor'?',wheels':'')+(game==='studio-sunbird-trails'?',trail':''))||value.version!==1||value.sessionId!==sessionId||value.gameId!==game||value.phase!==phase||value.step!==view.step||value.stage!==view.stage)return false;
    const info=STUDIO_INFO[game];if(view.kind!=='slot'||view.cols!==info.cols||view.rows!==info.rows||!integer(view.step,0,2)||!Array.isArray(view.history)||view.history.length!==view.step+1||!Array.isArray(value.beforeGrid)||value.beforeGrid.length!==info.cols*info.rows||!value.beforeGrid.every(symbol=>integer(symbol,0,5)))return false;
    const before=value.beforeGrid as number[],last=view.history[view.step],heldBefore=view.step?view.history[view.step-1].held:[];
    if(wheelTrail){
      if(last.stage!==(view.step?'free-spin':'base')||!same(before,view.grid)||!same(last.grid,view.grid)||!same(last.wins,view.wins)||!same(last.held,view.held)||view.held.length||heldBefore.length)return false;
      const first=view.history[0],baseWins=studioScore(game,first.grid),base:StudioRawFrame={stage:'base',grid:first.grid,held:[],wins:baseWins,raw:baseWins.reduce((sum,win)=>sum+win.raw,0)};
      if(!studioBaseGridReachable(game,first.grid)||!same(rawFrame(first),base)||view.step>0&&!studioSlotHasBonus(game,base))return false;
      const remaining=studioSlotHasBonus(game,base)?2-view.step:0;
      if(view.remaining!==remaining||view.maxSteps!==3||phase!==(remaining?view.step+1:1))return false;
      for(let step=1;step<=view.step;step++)if(!Array.from({length:6},(_,seed)=>seed).some(seed=>same(rawFrame(view.history[step]),studioBonusFrame(game,rawFrame(view.history[step-1]),seed,step))))return false;
      return same(value,{version:1,sessionId,phase,...studioWheelTrailPresentationDetails(game,last,view.step)});
    }
    if(hold){
      if(last.stage!==(view.step?'hold':'base')||!same(last.grid,view.grid)||!same(last.wins,view.wins)||!same(last.held,view.held))return false;
      const first=view.history[0],baseHeld=studioHeld(game,first.grid),baseWins=studioScore(game,first.grid);
      if(baseHeld.length>=3)for(const position of baseHeld)baseWins.push({kind:'coin',symbol:5,positions:[position],count:1,raw:2+position%4});
      const base:StudioRawFrame={stage:'base',grid:first.grid,held:baseHeld,wins:baseWins,raw:baseWins.reduce((sum,win)=>sum+win.raw,0)};
      if(!studioBaseGridReachable(game,first.grid)||!same(rawFrame(first),base)||view.step>0&&!studioSlotHasBonus(game,base))return false;
      const remaining=studioSlotHasBonus(game,base)?2-view.step:0;
      if(view.remaining!==remaining||view.maxSteps!==3||phase!==(remaining?view.step+1:1))return false;
      for(let step=1;step<=view.step;step++)if(!Array.from({length:6},(_,seed)=>seed).some(seed=>same(rawFrame(view.history[step]),studioBonusFrame(game,rawFrame(view.history[step-1]),seed,step))))return false;
      if(view.step===0){if(!same(before,view.grid))return false;}
      else{
        if(!Array.from({length:6},(_,seed)=>seed).some(seed=>before.every((symbol,i)=>symbol===studioStrip(game,i%info.cols)[(seed*(i%info.cols+1)+Math.floor(i/info.cols)+view.step+i%info.cols)%6])))return false;
        const grid=[...before];for(const position of heldBefore)grid[position]=5;
        if(!same(grid,view.grid))return false;
      }
      return same(value,{version:1,sessionId,phase,...studioHoldPresentationDetails(game,before,view.step?view.history[view.step-1]:null,last,view.step)});
    }
    if(element&&(view.held.length||heldBefore.length||last.stage!==(view.step?'free-spin':'base')||view.step>0&&!studioSlotHasBonus(game,view.history[0])||!same(last.wins.map(({kind,symbol,positions,count,raw,line})=>({kind,symbol,positions,count,...(line===undefined?{}:{line}),raw})),studioScore(game,view.grid,view.step))))return false;
    if(cluster){
      if(!same(before,view.grid)||!same(last.grid,view.grid)||!same(last.wins,view.wins)||!same(last.held,view.held)||view.held.length||last.stage!==(view.step?'free-spin':'base'))return false;
      if(view.step===0){
        for(let column=0;column<info.cols;column++)if(!Array.from({length:6},(_,stop)=>stop).some(stop=>Array.from({length:info.rows},(_,row)=>before[row*info.cols+column]===studioStrip(game,column)[(stop+row)%6]).every(Boolean)))return false;
      }else{
        if(!studioSlotHasBonus(game,view.history[0])||!Array.from({length:6},(_,seed)=>seed).some(seed=>same(studioBonusFrame(game,view.history[view.step-1],seed,view.step).grid,view.grid)))return false;
      }
      if(!same(last.wins.map(({kind,symbol,positions,count,raw,..._})=>({kind,symbol,positions,count,raw})),studioScore(game,view.grid,view.step)))return false;
      return same(value,{version:1,sessionId,phase,...studioClusterPresentationDetails(game,last,view.step)});
    }
    if(cascade){
      if(!same(last.grid,view.grid)||!same(last.wins,view.wins)||!same(last.held,view.held)||view.held.length||last.stage!==(view.step?'tumble':'base'))return false;
      const previous=view.step?view.history[view.step-1]:null;
      if(previous){
        if(!previous.wins.length||!same(before,previous.grid)||!Array.from({length:6},(_,seed)=>seed).some(seed=>same(studioBonusFrame(game,previous,seed,view.step).grid,view.grid)))return false;
      }else{
        if(!same(before,view.grid))return false;
        for(let column=0;column<info.cols;column++)if(!Array.from({length:6},(_,stop)=>stop).some(stop=>Array.from({length:info.rows},(_,row)=>before[row*info.cols+column]===studioStrip(game,column)[(stop+row)%6]).every(Boolean)))return false;
      }
      if(!same(last.wins.map(({kind,symbol,positions,count,raw,..._})=>({kind,symbol,positions,count,raw})),studioScore(game,view.grid,view.step)))return false;
      return same(value,{version:1,sessionId,phase,...studioCascadePresentationDetails(game,previous,last,view.step)});
    }
    if(collect){
      if(last.stage!==(view.step?'free-spin':'base')||!same(last.grid,view.grid)||!same(last.wins,view.wins)||!same(last.held,view.held)||view.held.length||heldBefore.length)return false;
      if(view.step===0){
        for(let column=0;column<info.cols;column++)if(!Array.from({length:6},(_,stop)=>stop).some(stop=>Array.from({length:info.rows},(_,row)=>before[row*info.cols+column]===studioStrip(game,column)[(stop+row)%6]).every(Boolean)))return false;
      }else if(!studioSlotHasBonus(game,view.history[0])||!Array.from({length:6},(_,seed)=>seed).some(seed=>before.every((symbol,i)=>symbol===studioStrip(game,i%info.cols)[(seed*(i%info.cols+1)+Math.floor(i/info.cols)+view.step+i%info.cols)%6])))return false;
      if(!same(studioTransformGrid(game,before,view.step,[]),view.grid)||!same(last.wins.map(({kind,symbol,positions,count,raw,line})=>({kind,symbol,positions,count,...(line===undefined?{}:{line}),raw})),studioScore(game,view.grid,view.step)))return false;
      return same(value,{version:1,sessionId,phase,...studioCollectPresentationDetails(game,before,last,view.step)});
    }
    if(ways){
      if(last.stage!==(view.step?'free-spin':'base')||!same(last.grid,view.grid)||!same(last.wins,view.wins)||!same(last.held,view.held)||view.held.length||heldBefore.length)return false;
      if(game==='studio-rivet-rally'){
        if(view.step!==0||!same(before,view.grid))return false;
        const first=studioStrip(game,0).indexOf(before[0]);if(first<0)return false;
        const linked=Math.min(info.cols,2+first%4);
        for(let column=0;column<info.cols;column++){
          if(column<linked){if(!Array.from({length:info.rows},(_,row)=>before[row*info.cols+column]===studioStrip(game,0)[(first+row)%6]).every(Boolean))return false;}
          else if(!Array.from({length:6},(_,stop)=>stop).some(stop=>Array.from({length:info.rows},(_,row)=>before[row*info.cols+column]===studioStrip(game,column)[(stop+row)%6]).every(Boolean)))return false;
        }
      }else{
        if(view.step===0){
          for(let column=0;column<info.cols;column++)if(!Array.from({length:6},(_,stop)=>stop).some(stop=>Array.from({length:info.rows},(_,row)=>before[row*info.cols+column]===studioStrip(game,column)[(stop+row)%6]).every(Boolean)))return false;
        }else if(!studioSlotHasBonus(game,view.history[0])||!Array.from({length:6},(_,seed)=>seed).some(seed=>before.every((symbol,i)=>symbol===studioStrip(game,i%info.cols)[(seed*(i%info.cols+1)+Math.floor(i/info.cols)+view.step+i%info.cols)%6])))return false;
        if(!same(studioTransformGrid(game,before,view.step,[]),view.grid))return false;
      }
      if(!same(last.wins.map(({kind,symbol,positions,count,raw,line})=>({kind,symbol,positions,count,...(line===undefined?{}:{line}),raw})),studioScore(game,view.grid,view.step)))return false;
      return same(value,{version:1,sessionId,phase,...studioWaysPresentationDetails(game,before,last,view.step)});
    }
    if(view.step===0){
      for(let column=0;column<info.cols;column++)if(!Array.from({length:6},(_,stop)=>stop).some(stop=>Array.from({length:info.rows},(_,row)=>before[row*info.cols+column]===studioStrip(game,column)[(stop+row)%6]).every(Boolean)))return false;
    }else if(!Array.from({length:6},(_,seed)=>seed).some(seed=>before.every((symbol,i)=>symbol===studioStrip(game,i%info.cols)[(seed*(i%info.cols+1)+Math.floor(i/info.cols)+view.step+i%info.cols)%6])))return false;
    if(journey){
      const previous=view.step?view.history[view.step-1]:null;
      if(last.stage!==(view.step?'free-spin':'base')||view.step>0&&!studioSlotHasBonus(game,view.history[0])||!same(last.grid,view.grid)||!same(last.wins,view.wins)||!same(last.held,view.held))return false;
      if(!unique(view.held,view.held.length,0,info.cols*info.rows-1)||!unique(heldBefore,heldBefore.length,0,info.cols*info.rows-1))return false;
      const grid=studioTransformGrid(game,before,view.step,heldBefore);
      if(game==='studio-jade-koi')for(const position of heldBefore){if(!integer(previous!.grid[position],0,2))return false;grid[position]=previous!.grid[position];}
      if(!same(grid,view.grid)||!same(studioHeld(game,grid,heldBefore),view.held)||!same(last.wins.map(({kind,symbol,positions,count,raw,line})=>({kind,symbol,positions,count,...(line===undefined?{}:{line}),raw})),studioScore(game,grid,view.step)))return false;
      return same(value,{version:1,sessionId,phase,...studioJourneyPresentationDetails(game,before,previous,last,view.step)});
    }
    if(!same(studioTransformGrid(game,before,view.step,heldBefore),view.grid)||!same(studioHeld(game,view.grid,heldBefore),view.held)||!same(last.grid,view.grid)||!same(last.wins,view.wins)||!same(last.held,view.held))return false;
    return same(value,{version:1,sessionId,phase,...studioSlotPresentationDetails(game,before,last,view.step,heldBefore)});
  }catch{return false;}
}

export type StudioSlotMath = {total:number;sum:number;max:number};
// GENERATED_STUDIO_MATH_START
export const STUDIO_SLOT_MATH:Partial<Record<StudioGameId,StudioSlotMath>> = {
  "studio-cosmic-escape": {
    "total": 279936,
    "sum": 88525296,
    "max": 1596
  },
  "studio-caramel-carnival": {
    "total": 1679616,
    "sum": 219381528,
    "max": 292
  },
  "studio-velvet-reign": {
    "total": 279936,
    "sum": 144510604,
    "max": 5356
  },
  "studio-deep-current": {
    "total": 279936,
    "sum": 24578964,
    "max": 663
  },
  "studio-ember-vault": {
    "total": 279936,
    "sum": 15208032,
    "max": 414
  },
  "studio-lumen-grove": {
    "total": 1679616,
    "sum": 626604132,
    "max": 1656
  },
  "studio-neon-crown": {
    "total": 7776,
    "sum": 24120,
    "max": 22
  },
  "studio-sky-lanterns": {
    "total": 1679616,
    "sum": 9003571200,
    "max": 22743
  },
  "studio-stormforge-duel": {
    "total": 279936,
    "sum": 275795640,
    "max": 5256
  },
  "studio-copperline-express": {
    "total": 279936,
    "sum": 147637134,
    "max": 8304
  },
  "studio-saffron-cipher": {
    "total": 279936,
    "sum": 116289468,
    "max": 1896
  },
  "studio-prism-atelier": {
    "total": 1679616,
    "sum": 1205642304,
    "max": 3312
  },
  "studio-midnight-market": {
    "total": 279936,
    "sum": 11861802,
    "max": 282
  },
  "studio-pulse-district": {
    "total": 279936,
    "sum": 14171760,
    "max": 376
  },
  "studio-rivet-rally": {
    "total": 279936,
    "sum": 133164000,
    "max": 4014
  },
  "studio-petal-parlor": {
    "total": 279936,
    "sum": 17997552,
    "max": 342
  },
  "studio-frostline-courier": {
    "total": 279936,
    "sum": 296856576,
    "max": 8796
  },
  "studio-beacon-bay": {
    "total": 279936,
    "sum": 36851112,
    "max": 1440
  },
  "studio-sunbird-trails": {
    "total": 279936,
    "sum": 35549064,
    "max": 1046
  },
  "studio-blazing-orchard": {
    "total": 279936,
    "sum": 119530224,
    "max": 2268
  },
  "studio-jade-koi": {
    "total": 7776,
    "sum": 37860,
    "max": 72
  },
  "studio-moonlit-mint": {
    "total": 7776,
    "sum": 40122,
    "max": 34
  },
  "studio-starfall-oracle": {
    "total": 1679616,
    "sum": 1780644528,
    "max": 1704
  }
};
// GENERATED_STUDIO_MATH_END
export const studioSlotMultiplier=(game:StudioGameId,raw:number)=>{const math=STUDIO_SLOT_MATH[game];if(!math)throw Error('Missing studio slot math');return studioRatio(98n*BigInt(math.total)*BigInt(raw),100n*BigInt(math.sum));};
export function studioSlotPaytable(game:StudioGameId){const info=STUDIO_INFO[game],cluster=info.features.includes('cluster'),tumble=info.features.includes('tumble'),symbols=info.ways||cluster?[0,1,2,3]:[0,1,2],counts=cluster?[5,6,8,10,12]:tumble?[8,10,12,15,20]:Array.from({length:info.cols-2},(_,i)=>i+3);return symbols.map(symbol=>({symbol,pays:counts.map(count=>{const raw=cluster?(count-4)*(symbol+2)*2*count:tumble?(count-7)*(symbol+2)*4:(symbol===3?6:symbol+2)*lengthPay(count);return {count,raw,multiplier:studioSlotMultiplier(game,raw)};})}));}
export function studioPayFrame(game:StudioGameId,frame:StudioRawFrame,stake:string):StudioSlotFrame {const wins=frame.wins.map(win=>{const multiplier=studioSlotMultiplier(game,win.raw);return {...win,multiplier,payoutUnits:studioPaid(stake,multiplier)};});return {...frame,wins,payoutUnits:wins.reduce((sum,win)=>sum+BigInt(win.payoutUnits),0n).toString()};}
export const STUDIO_MAX=Object.fromEntries(STUDIO_GAMES.map(game=>{if(game==='studio-afterglow')return [game,5000];if(game==='studio-nitro-run'||game==='studio-meme-overload')return [game,3000];if(game==='studio-last-convoy')return [game,5000];const kind=STUDIO_INFO[game].kind;let max:number;if(kind==='slot'){const math=STUDIO_SLOT_MATH[game];max=math?Math.ceil(studioSlotMultiplier(game,math.max)):100000;}else if(kind==='crash'||kind==='flight')max=Math.ceil(studioRiskMultiplier(game,studioRiskMax(game)));else if(kind==='keno')max=Math.ceil(studioKenoMultiplier(3));else if(kind==='plinko')max=Math.ceil(Math.max(...studioPlinkoTable('high')));else if(kind==='dice')max=4;else if(kind==='wheel')max=Math.ceil(Math.max(...[0,1,2,3].map(target=>studioWheelMultiplier(game,target))));else max=Math.ceil(studioMinesMultiplier(6));return [game,max];})) as Record<StudioGameId,number>;
export const STUDIO_RULES=Object.fromEntries(STUDIO_GAMES.map(game=>{const info=STUDIO_INFO[game];const featureText=info.features.map(f=>({expand:translateText('WILD расширяется на барабан'),tumble:translateText('выигравшие символы исчезают, остальные падают'),sticky:translateText('WILD остаются на следующих вращениях'),hold:translateText('монеты закрепляются на двух бесплатных повторных вращениях'),collect:translateText('сборщики суммируют монеты'),cluster:translateText('оплачиваются соседние группы от пяти символов'),ways:translateText('совпадения считаются слева направо по всем способам'),chosen:translateText('выбранный первым символом знак расширяется при появлении на трёх барабанах'),walking:translateText('бонусная WILD-колонна движется влево'),synced:translateText('от двух до пяти барабанов синхронизируются'),mystery:translateText('все тайные символы раскрываются одним знаком'),'multiplier-wild':translateText('WILD усиливает выигрышную линию'),'cell-multipliers':translateText('ячейки усиливают соседние группы'),wheels:translateText('бонусные колёса дают дополнительные награды'),beam:translateText('WILD-луч превращает свой барабан'),trail:translateText('монеты и этап бонуса усиливают выплату'),wish:translateText('желанные символы остаются на бесплатных вращениях'),orbs:translateText('монеты усиливают выплату каскада')} as Record<StudioFeature,string>)[f]).join('; ');return [game,info.kind==='slot'?tr`${info.cols}×${info.rows}. ${info.description}. ${featureText?featureText+'. ':''}Линии оплачиваются от трёх совпадений, группы от пяти, россыпь от восьми. WILD заменяет обычные знаки в линиях и способах. Бонус содержит максимум два бесплатных этапа, без продления. Наша самостоятельная математика: расчётный возврат 98% до округления; каждая награда округляется вниз до 0,01 монеты.`:info.kind==='crash'||info.kind==='flight'?tr`Дискретная серия до ${studioRiskMax(game)} этапов. На каждом скрытый бросок должен достичь ${studioRiskThreshold(game)} из шести. После первого успеха можно забрать выплату. Ошибка теряет ставку, последний этап оплачивается автоматически. Возврат 98% до округления.`:info.kind==='mines'?translateText('Шестнадцать ячеек и четыре скрытые ловушки. Забери выплату после первой безопасной ячейки; шестая оплачивается автоматически. Возврат 98% до округления.'):tr`${info.description}. Ставка и выплата проходят через общий тестовый кошелёк. Возврат 98% до округления.`];})) as Record<StudioGameId,string>;
for(const game of STUDIO_GAMES)if(STUDIO_INFO[game].ways)STUDIO_RULES[game]+=translateText(' Полностью WILD-цепочка оплачивается отдельно. Более короткая WILD-цепочка может дать дополнительную награду рядом с более длинной обычной комбинацией.');

function same(a:unknown,b:unknown):boolean {if(a===b)return true;if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((value,i)=>same(value,b[i]));if(!record(a)||!record(b))return false;const keys=Object.keys(a).sort();return keys.join()===Object.keys(b).sort().join()&&keys.every(key=>same(a[key],b[key]));}
export const studioSamePayload=(a:unknown,b:unknown):boolean=>same(a,b);
export function studioBaseGridReachable(game:StudioGameId,grid:readonly number[]):boolean {
  const info=STUDIO_INFO[game],f=info.features;if(grid.length!==info.cols*info.rows)return false;
  for(let first=0;first<6;first++){
    const initial=studioStrip(game,0)[first],replacement=initial%3,firstShown=f.includes('mystery')&&initial===4?replacement:initial,chosen=firstShown<3?firstShown:0,linked=f.includes('synced')?Math.min(info.cols,2+first%4):0;
    for(const active of f.includes('chosen')?[false,true]:[false]){let possible=true,minChosen=0,maxChosen=0;
      for(let col=0;col<info.cols;col++){const candidates:number[]=[],stops=col===0||col<linked?[first]:[0,1,2,3,4,5];
        for(const stop of stops){let values=Array.from({length:info.rows},(_,row)=>studioStrip(game,col<linked?0:col)[(stop+row)%6]);const original=[...values];
          if(f.includes('mystery'))values=values.map(v=>v===4?replacement:v);
          if(f.includes('expand')&&!(game==='studio-blazing-orchard'&&(col===0||col===info.cols-1))&&values.includes(3))values=values.map(()=>3);
          if(f.includes('beam')&&original[Math.floor(info.rows/2)]===3)values=values.map(()=>3);
          const hasChosen=Number(values.includes(chosen));if(active&&hasChosen)values=values.map(()=>3);
          if(values.every((v,row)=>v===grid[row*info.cols+col]))candidates.push(hasChosen);
        }
        if(!candidates.length){possible=false;break;}minChosen+=Math.min(...candidates);maxChosen+=Math.max(...candidates);
      }
      if(possible&&(!f.includes('chosen')||(active?maxChosen>=3:minChosen<3)))return true;
    }
  }
  return false;
}
function rawFrame(frame:StudioSlotFrame):StudioRawFrame {return {stage:frame.stage,grid:frame.grid,held:frame.held,raw:frame.raw,wins:frame.wins.map(({multiplier:_,payoutUnits:__,...win})=>win)};}
function validSlotShape(value:Record<string,unknown>,game:StudioGameId,ended:boolean):value is Record<string,unknown>&StudioSlotView {
  const info=STUDIO_INFO[game];if(!fields(value,'kind,cols,rows,grid,wins,history,stage,step,remaining,maxSteps,held,totalPayoutUnits')||value.cols!==info.cols||value.rows!==info.rows||value.maxSteps!==3||!integer(value.step,0,2)||!integer(value.remaining,0,2)||!Array.isArray(value.history)||value.history.length!==value.step+1||ended!==(value.remaining===0)||!units(value.totalPayoutUnits))return false;
  for(const frame of value.history){if(!record(frame)||!fields(frame,'stage,grid,wins,raw,payoutUnits,held')||!['base','free-spin','tumble','hold'].includes(frame.stage as string)||!Array.isArray(frame.grid)||frame.grid.length!==info.cols*info.rows||!frame.grid.every(n=>integer(n,0,5))||!Array.isArray(frame.wins)||!integer(frame.raw,0,10000000)||!units(frame.payoutUnits)||!unique(frame.held,(frame.held as unknown[])?.length??-1,0,info.cols*info.rows-1))return false;
    for(const win of frame.wins){if(!record(win)||!fields(win,win.line===undefined?'kind,symbol,positions,count,raw,multiplier,payoutUnits':'kind,symbol,positions,count,line,raw,multiplier,payoutUnits')||!['line','ways','cluster','anywhere','collect','coin','wheel'].includes(win.kind as string)||!integer(win.symbol,0,5)||!unique(win.positions,(win.positions as unknown[])?.length??-1,0,info.cols*info.rows-1)||!integer(win.count,1,100000)||!integer(win.raw,1,10000000)||typeof win.multiplier!=='number'||!Number.isFinite(win.multiplier)||win.multiplier<0||!units(win.payoutUnits)||win.line!==undefined&&!integer(win.line,0,info.paylines.length-1))return false;}
  }
  const last=value.history[value.history.length-1] as StudioSlotFrame;return value.stage===last.stage&&same(value.grid,last.grid)&&same(value.wins,last.wins)&&same(value.held,last.held);
}
export function validStudioView(value:unknown,game:StudioGameId,ended:boolean):value is StudioView {
  if(!record(value)||value.kind!==STUDIO_INFO[game].kind)return false;
  switch(value.kind){
    case 'slot':return validSlotShape(value,game,ended);
    case 'crash':case 'flight':{if(!fields(value,'kind,history,steps,maxSteps,multiplier,cashoutUnits')||value.maxSteps!==studioRiskMax(game)||!integer(value.steps,0,value.maxSteps as number)||!Array.isArray(value.history)||!units(value.cashoutUnits))return false;let wins=0,lost=false;for(const item of value.history){if(!record(item)||!fields(item,'safe,threshold')||typeof item.safe!=='boolean'||item.threshold!==studioRiskThreshold(game)||lost)return false;if(item.safe)wins++;else lost=true;}return wins===value.steps&&value.history.length===wins+Number(lost)&&value.multiplier===(lost?0:studioRiskMultiplier(game,wins))&&(!ended?!lost&&wins<studioRiskMax(game):lost||wins>0);}
    case 'keno':{if(!fields(value,'kind,numbers,drawn,target,hits,won,multiplier')||!unique(value.numbers,5,1,20)||!unique(value.drawn,5,1,20)||![2,3].includes(value.target as number)||!ended)return false;const hits=value.drawn.filter(n=>(value.numbers as number[]).includes(n)).length;return value.hits===hits&&value.won===(hits>=Number(value.target))&&value.multiplier===studioKenoMultiplier(value.target as 2|3);}
    case 'plinko':{if(!fields(value,'kind,risk,path,bucket,table,multiplier')||!['low','medium','high'].includes(value.risk as string)||!Array.isArray(value.path)||value.path.length!==12||!value.path.every(n=>n===0||n===1)||!ended)return false;const bucket=value.path.reduce((a,b)=>a+b,0),table=studioPlinkoTable(value.risk as 'low'|'medium'|'high');return value.bucket===bucket&&same(value.table,table)&&value.multiplier===table[bucket];}
    case 'dice':{if(!fields(value,'kind,chance,direction,roll,won,multiplier')||![25,50,75].includes(value.chance as number)||!['under','over'].includes(value.direction as string)||!integer(value.roll,0,99)||!ended)return false;return value.won===(value.direction==='under'?value.roll<Number(value.chance):value.roll>=100-Number(value.chance))&&value.multiplier===studioDiceMultiplier(value.chance as 25|50|75);}
    case 'wheel':{if(!fields(value,'kind,target,sector,segments,won,multiplier')||!integer(value.target,0,3)||!integer(value.sector,0,studioWheelSegments(game).length-1)||!ended)return false;return same(value.segments,studioWheelSegments(game))&&value.won===(studioWheelSegments(game)[value.sector]===value.target)&&value.multiplier===studioWheelMultiplier(game,value.target);}
    case 'mines':{if(!fields(value,'kind,cells,opened,steps,maxSteps,multiplier,cashoutUnits')||value.maxSteps!==6||!integer(value.steps,0,6)||!Array.isArray(value.opened)||!unique(value.opened,value.opened.length,0,15)||!Array.isArray(value.cells)||value.cells.length!==16||!value.cells.every(n=>['hidden','safe','mine'].includes(n))||!units(value.cashoutUnits))return false;const cells=value.cells,failed=value.opened.filter(i=>cells[i]==='mine');if(failed.length>1||failed.length&&failed[0]!==value.opened[value.opened.length-1]||value.opened.some(i=>cells[i]==='hidden')||value.steps!==value.opened.length-failed.length)return false;if(ended){if(cells.includes('hidden')||cells.filter(n=>n==='mine').length!==4||!failed.length&&!value.steps)return false;}else if(failed.length||value.steps===6||cells.some((n,i)=>n!==((value.opened as number[]).includes(i)?'safe':'hidden')))return false;return value.multiplier===(failed.length?0:studioMinesMultiplier(value.steps));}
    default:return false;
  }
}
export function validStudioSettlement(game:StudioGameId,state:'active'|'settled',stake:string,spent:string,returned:string,value:unknown):boolean {
  try{if(!units(stake)||!(DEMO_BETS as readonly number[]).some(n=>String(n*100)===stake)||spent!==stake||!units(returned)||!validStudioView(value,game,state==='settled'))return false;
    if(value.kind==='slot'){
      const info=STUDIO_INFO[game],frames=value.history,first=rawFrame(frames[0]);if(first.stage!=='base'||!studioBaseGridReachable(game,first.grid))return false;const baseWins=studioScore(game,first.grid);if(info.features.includes('hold')&&first.grid.filter(v=>v===5).length>=3)for(const i of studioHeld(game,first.grid))baseWins.push({kind:'coin',symbol:5,positions:[i],count:1,raw:2+i%4});const expectedBase:StudioRawFrame={stage:'base',grid:first.grid,held:studioHeld(game,first.grid),wins:baseWins,raw:baseWins.reduce((sum,win)=>sum+win.raw,0)};
      if(!same(frames[0],studioPayFrame(game,expectedBase,stake)))return false;let remaining=studioSlotHasBonus(game,expectedBase)?2:0;
      for(let step=1;step<frames.length;step++){if(!remaining)return false;let valid=false;for(let seed=0;seed<6;seed++)if(same(frames[step],studioPayFrame(game,studioBonusFrame(game,rawFrame(frames[step-1]),seed,step),stake)))valid=true;if(!valid)return false;remaining=2-step;if(info.features.includes('tumble')&&!frames[step].wins.length)remaining=0;}
      const total=frames.reduce((sum,frame)=>sum+BigInt(frame.payoutUnits),0n).toString();return BigInt(total)<=BigInt(stake)*BigInt(STUDIO_MAX[game])&&frames.reduce((sum,frame)=>sum+frame.raw,0)<=STUDIO_SLOT_MATH[game]!.max&&value.remaining===remaining&&value.totalPayoutUnits===total&&returned===(state==='settled'?total:'0');
    }
    let multiplier=value.multiplier;if('won' in value&&!value.won)multiplier=0;if('cashoutUnits' in value&&value.cashoutUnits!==studioPaid(stake,multiplier))return false;return returned===(state==='settled'?studioPaid(stake,multiplier):'0');
  }catch{return false;}
}
export function validStudioEnvelope(game:StudioGameId,state:'active'|'settled',value:unknown):boolean {
  if(!record(value)||!fields(value,'studio,player,dealer,community,actions,phase,ended,message')||value.ended!==(state==='settled')||typeof value.message!=='string'||![value.player,value.dealer,value.community].every(a=>Array.isArray(a)&&a.length===0)||!Array.isArray(value.actions)||!record(value.studio))return false;
  const studio=value.studio as unknown as StudioView,active=state==='active';if(studio.kind!==STUDIO_INFO[game].kind)return false;let phase=1,expected:{move:string;minPicks?:number;maxPicks?:number}[]=[];
  if(active){if(studio.kind==='slot'){phase=studio.step+1;expected=[{move:'studio-spin'}];}else if(studio.kind==='crash'||studio.kind==='flight'){phase=studio.steps+1;expected=[{move:'studio-advance'},...(studio.steps?[{move:'cashout'}]:[])];}else if(studio.kind==='mines'){phase=studio.steps+1;expected=[{move:'reveal',minPicks:1,maxPicks:1},...(studio.steps?[{move:'cashout'}]:[])];}else return false;}
  return value.phase===phase&&value.actions.length===expected.length&&value.actions.every((action,i)=>{const offer=expected[i];return record(action)&&fields(action,offer.minPicks===undefined?'move,label,cost':'move,label,cost,minPicks,maxPicks')&&action.move===offer.move&&typeof action.label==='string'&&action.label.length>0&&action.label.length<=120&&action.cost===0&&action.minPicks===offer.minPicks&&action.maxPicks===offer.maxPicks;});
}

// Exact paid return from the independent complete finite-outcome audit.
export const STUDIO_SLOT_RTP:Partial<Record<StudioGameId,Record<string,number>>> = {
  "studio-cosmic-escape": {
    "1000": 97.44603909,
    "5000": 97.80177983,
    "10000": 97.9171682,
    "50000": 97.9171682
  },
  "studio-caramel-carnival": {
    "1000": 97.96057313,
    "5000": 97.96194056,
    "10000": 97.97532296,
    "50000": 97.97532296
  },
  "studio-velvet-reign": {
    "1000": 97.72641282,
    "5000": 97.91063107,
    "10000": 97.9609256,
    "50000": 97.9609256
  },
  "studio-deep-current": {
    "1000": 97.50262345,
    "5000": 97.92502572,
    "10000": 97.96029963,
    "50000": 97.96029963
  },
  "studio-ember-vault": {
    "1000": 97.82865226,
    "5000": 97.88451646,
    "10000": 97.95065329,
    "50000": 97.95065329
  },
  "studio-lumen-grove": {
    "1000": 97.68678269,
    "5000": 97.93418367,
    "10000": 97.96827053,
    "50000": 97.96827053
  },
  "studio-neon-crown": {
    "1000": 97.96759259,
    "5000": 97.99444444,
    "10000": 97.99791666,
    "50000": 97.99791666
  },
  "studio-sky-lanterns": {
    "1000": 97.54194101,
    "5000": 97.93461591,
    "10000": 97.96848651,
    "50000": 97.96848651
  },
  "studio-stormforge-duel": {
    "1000": 97.37035751,
    "5000": 97.93007458,
    "10000": 97.95872942,
    "50000": 97.95872942
  },
  "studio-copperline-express": {
    "1000": 97.65015574,
    "5000": 97.90367155,
    "10000": 97.94645326,
    "50000": 97.94645326
  },
  "studio-saffron-cipher": {
    "1000": 97.37041538,
    "5000": 97.93782407,
    "10000": 97.95582754,
    "50000": 97.95582754
  },
  "studio-prism-atelier": {
    "1000": 97.89549897,
    "5000": 97.97070258,
    "10000": 97.98751907,
    "50000": 97.98751907
  },
  "studio-midnight-market": {
    "1000": 97.72411908,
    "5000": 97.93772376,
    "10000": 97.97130979,
    "50000": 97.97130979
  },
  "studio-pulse-district": {
    "1000": 97.87435699,
    "5000": 97.97912551,
    "10000": 97.98622685,
    "50000": 97.98622685
  },
  "studio-rivet-rally": {
    "1000": 97.91604938,
    "5000": 97.97166666,
    "10000": 97.98570987,
    "50000": 97.98570987
  },
  "studio-petal-parlor": {
    "1000": 97.78876028,
    "5000": 97.96467078,
    "10000": 97.98481995,
    "50000": 97.98481995
  },
  "studio-frostline-courier": {
    "1000": 97.81494341,
    "5000": 97.96167952,
    "10000": 97.97614454,
    "50000": 97.97614454
  },
  "studio-beacon-bay": {
    "1000": 97.71876286,
    "5000": 97.93993312,
    "10000": 97.97148276,
    "50000": 97.97148276
  },
  "studio-sunbird-trails": {
    "1000": 97.89915123,
    "5000": 97.9865252,
    "10000": 97.9922788,
    "50000": 97.9922788
  },
  "studio-blazing-orchard": {
    "1000": 97.20236625,
    "5000": 97.77925411,
    "10000": 97.901268,
    "50000": 97.901268
  },
  "studio-jade-koi": {
    "1000": 97.97476851,
    "5000": 97.99385802,
    "10000": 97.99628086,
    "50000": 97.99628086
  },
  "studio-moonlit-mint": {
    "1000": 97.92199074,
    "5000": 97.98708333,
    "10000": 97.99293981,
    "50000": 97.99293981
  },
  "studio-starfall-oracle": {
    "1000": 97.75378872,
    "5000": 97.9554069,
    "10000": 97.97901389,
    "50000": 97.97901389
  }
};
export const studioSlotRtp=(game:StudioGameId,stakeUnits:string):number|undefined=>STUDIO_SLOT_RTP[game]?.[stakeUnits];

STUDIO_RULES['studio-last-convoy']=translateText('Поле 6×5, 8+ одинаковых припасов в любом месте, до 20 каскадов. Каждая закреплённая баррикада добавляет +1 к множителю, максимум ×7. 3/4/5+ маяков на конечном поле дают 10/12/15 бесплатных вращений. В эвакуации баррикады сохраняются, 3 маяка добавляют 2 вращения, до 20 всего. Предел 5000 ставок. Одна ставка и одна итоговая выплата в тестовый кошелёк.');

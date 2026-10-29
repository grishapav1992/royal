import {JACKIE_GAME} from './jackieChan';
import { t as translateText, language } from '../i18n/index';
export type Cabinet = { id: string; name: string; subtitle: string; x: number; y: number; color: number; playable: boolean; hall?: 'arcade' | 'tables' | 'github'; demo?: boolean; wallet?: boolean; provider?: boolean; github?: boolean; defaultGameId?: string; collection?: CabinetCollection | 'luelon' };

import { PENALTY_GAME } from './crLeo';
import { CARIBBEAN_GAME } from './caribbeanTreasures';
import { BASE_EXPANSION_GAMES, EXPANSION_NAMES } from './casinoExpansion';
import { STUDIO_GAMES, STUDIO_INFO } from './studioGames';
import { CARD_GAME_IDS, CARD_GAME_NAMES, isCardGame, isRetiredCardGame, cardTableBounds } from './cardTables';
import type { Obstacle } from '../game/navigation';
import { LUELON_NEW_ZONE } from './clubLayout';
import {ARCADE_CABINET_SPECS, type CabinetCollection} from './arcadeCatalog';
const expansionPositions=BASE_EXPANSION_GAMES.map((_,i)=>i===0?[240,600]:i===1?[480,810]:i===10?[240,1180]:i===11?[480,1180]:[1200,1060]);
// Shared positions keep rendering, collisions and server play status aligned.
export const CABINETS: Cabinet[] = [
  { id: 'casinoapipro', name: 'Casino Api Pro', subtitle: translateText('14 казино-игр · Общий демобаланс'), x: 240, y: 267, color: 0x72e3ee, playable: true, provider: true },
  { id: 'royal-fruits', name: 'Royal Fruits', subtitle: translateText('Три барабана · Одна линия'), x: 500, y: 267, color: 0xf5bc64, playable: true, wallet: true },
  { id: 'royal-dice', name: 'Royal Dice', subtitle: translateText('Выбери число и шанс выигрыша'), x: 1200, y: 320, color: 0x75cbd9, playable: true, wallet: true },
  { id: 'royal-limbo', name: 'Royal Limbo', subtitle: translateText('Задай свой множитель'), x: 1430, y: 320, color: 0xc6a0ed, playable: true, wallet: true },
  { id: 'royal-mines', name: 'Royal Mines', subtitle: translateText('Открывай клетки · Забирай выигрыш'), x: 1660, y: 320, color: 0x7bcaa1, playable: true, wallet: true },
  { id: 'royal-plinko', name: language === 'en' ? 'Veil of Night · Plinko' : 'Завеса ночи · Plinko', subtitle: language === 'en' ? 'Night magic · 12 rows · Three risks' : 'Магия ночи · 12 рядов · Три риска', x: 1890, y: 320, color: 0xeb91af, playable: true, wallet: true },
  { id: 'royal-keno', name: 'Royal Keno', subtitle: translateText('Выбирай числа от 1 до 40'), x: 1890, y: 620, color: 0x9babec, playable: true, wallet: true },
  { id: 'luelon', name: 'Luelon Play', subtitle: translateText('Каталог демоигр · Кредиты Luelon'), x: 780, y: 810, color: 0xd6aaef, playable: true, hall: 'arcade', demo: true },
  { id: 'github-blackjack', name: translateText('Блэкджек'), subtitle: translateText('Карты · Дилер · 21'), x: 1200, y: 570, color: 0x79c9bb, playable: true, hall: 'arcade', github: true },
  { id: 'github-poker', name: translateText('Покер'), subtitle: translateText('Холдем · Соперник за столом'), x: 1430, y: 570, color: 0xd6aaef, playable: true, hall: 'arcade', github: true },
  { id: 'github-video-poker', name: translateText('Видеопокер'), subtitle: translateText('Пять карт · Удержание · Джокер'), x: 1660, y: 570, color: 0xf5bc64, playable: true, hall: 'arcade', github: true },
  { id: 'github-baccarat', name: translateText('Баккара'), subtitle: translateText('Игрок · Банкир · Ничья'), x: 1200, y: 810, color: 0xeb91af, playable: true, hall: 'arcade', github: true },
  { id: 'github-craps', name: 'Craps', subtitle: translateText('Две кости · Pass Line · Field'), x: 1430, y: 810, color: 0x75cbd9, playable: true, hall: 'arcade', github: true },
  { id: 'github-hilo', name: 'Hi-Lo', subtitle: translateText('Выше или ниже · USDT · Nile'), x: 1660, y: 810, color: 0xe2c484, playable: true, hall: 'arcade', github: true },
  { id: 'github-tower', name: 'Dragon Tower', subtitle: translateText('Девять уровней · USDT · Nile'), x: 1890, y: 810, color: 0x8ecba2, playable: true, hall: 'arcade', github: true },
  ...BASE_EXPANSION_GAMES.map((id,i):Cabinet=>({id,name:id==='github-crash'?'LAST EXIT':EXPANSION_NAMES[id],subtitle:id==='github-crash'?(language==='en'?'Car chase · Take the exit':'Погоня · Успей уйти'):translateText('Общий тестовый кошелёк · Ставки и выплаты'),x:expansionPositions[i][0],y:expansionPositions[i][1],color:id==='github-crash'?0xd3b477:[0xe2c484,0x8ecba2,0xc6a0ed,0x75cbd9][i%4],playable:true,hall:'arcade',github:true})),
];

CABINETS.push({id:JACKIE_GAME,name:translateText('Гонконгский воин'),subtitle:translateText('Кунг-фу кино · Коллекция костюмов'),x:1560,y:1050,color:0xd9a356,playable:true,wallet:true,hall:'arcade'});
CABINETS.push({id:PENALTY_GAME,name:'CR vs. Leo',subtitle:translateText('Серия ударов · Пенальти и штрафные'),x:1380,y:1050,color:0xdce6ca,playable:true,wallet:true,hall:'arcade'});

const leftCabinets=new Set(['casinoapipro','royal-fruits','luelon','github-diamonds','github-crash','github-deuces','github-sic-bo']);
let tableIndex=0;
for(const cabinet of CABINETS){if(leftCabinets.has(cabinet.id))continue;const i=tableIndex++;cabinet.x=1200+(i%5)*180;cabinet.y=[270,410,550,790,930,1070,1210][Math.floor(i/5)];}

// The new wing has separate cabinets, leaving the original club routes intact.
const annexGames = [
  { id:'variant-target-plinko', name:translateText('Плинко: мишень'), subtitle:translateText('Один шарик · Выбери зону приземления'), color:0x75cbd9 },
  { id:'variant-triple-poker', name:translateText('Три карты: комбинация'), subtitle:translateText('Пара, флеш или стрит · Один расклад'), color:0xd6aaef },
  { id:'variant-dice-streak', name:translateText('Кости: серия'), subtitle:translateText('Пять бросков · Собери серию'), color:0xf5bc64 },
  { id:'variant-gem-collection', name:translateText('Самоцветы: коллекция'), subtitle:translateText('Выбери три цвета · Найди их среди пяти'), color:0x86d8b0 },
  { id:'variant-double-mines', name:translateText('Мины: парный поиск'), subtitle:translateText('Открывай пары · Забирай выигрыш'), color:0x7bba95 },
  { id:'variant-blackjack-target', name:translateText('21: тройной расклад'), subtitle:translateText('Три карты · Выбери сумму'), color:0xf3ca77 },
];
CABINETS.push(...annexGames.map((game,index):Cabinet=>({...game,x:2250+index%3*180,y:410+Math.floor(index/3)*520,playable:true,wallet:true,hall:'arcade'})));

const studioOrder = [...STUDIO_GAMES.filter(id=>id!=='studio-last-convoy'&&STUDIO_INFO[id].kind==='slot'),...STUDIO_GAMES.filter(id=>STUDIO_INFO[id].kind!=='slot')];
const studioRows = [300,470,640,980,1150];
CABINETS.push(...studioOrder.map((id,index):Cabinet=>({id,name:id==='studio-velvet-reign'?'Velvet Reign':id==='studio-cosmic-escape'?'Cosmic Escape':id==='studio-caramel-carnival'?'Caramel Carnival':STUDIO_INFO[id].name,subtitle:id==='studio-caramel-carnival'?translateText('8+ в любом месте · Билеты и фестиваль'):STUDIO_INFO[id].subtitle,x:id==='studio-velvet-reign'?LUELON_NEW_ZONE.velvet.x:id==='studio-cosmic-escape'?LUELON_NEW_ZONE.cosmic.x:id==='studio-caramel-carnival'?LUELON_NEW_ZONE.caramel.x:3000+index%7*180,y:id==='studio-velvet-reign'?LUELON_NEW_ZONE.velvet.y:id==='studio-cosmic-escape'?LUELON_NEW_ZONE.cosmic.y:id==='studio-caramel-carnival'?LUELON_NEW_ZONE.caramel.y:studioRows[Math.floor(index/7)],color:STUDIO_INFO[id].color,playable:true,wallet:true,hall:'arcade'})));

CABINETS.push({id:'studio-last-convoy',name:translateText('Последний конвой'),subtitle:translateText('Каскады · Баррикады · Эвакуация'),x:4520,y:410,color:0x9ec6a0,playable:true,wallet:true,hall:'arcade'});
CABINETS.push({id:'flag-battle',name:translateText('Флажочки'),subtitle:translateText('12 / 24 / 48 стран · Один победитель'),x:1380,y:1050,color:0x78e5bc,playable:true,wallet:true,hall:'arcade'});
CABINETS.push({id:'studio-forest-heart',name:language==='en'?'Forest Heart':'Сердце леса',subtitle:language==='en'?'Living roots · One free turn · Four bonus pulses':'Живые корни · Один поворот · Четыре бонусных импульса',x:0,y:0,color:0x87d7bc,playable:true,wallet:true,hall:'arcade'});

// Every card variation has its own table and dealer on the card floor.
CABINETS.push(
  {id:'variant-color',name:CARD_GAME_NAMES['variant-color'],subtitle:translateText('Угадай цвет · Собери серию'),x:0,y:0,color:0xe2c484,playable:true,wallet:true,hall:'github'},
  {id:'variant-duel',name:CARD_GAME_NAMES['variant-duel'],subtitle:translateText('Две карты · Выбери расстояние между рангами'),x:0,y:0,color:0x8ecba2,playable:true,wallet:true,hall:'github'},
  {id:'variant-war',name:CARD_GAME_NAMES['variant-war'],subtitle:translateText('Два фронта · Щит или атака'),x:0,y:0,color:0xc6a0ed,playable:true,wallet:true,hall:'github'},
);
const cardRows = [340,540,740,1000,1200];
CARD_GAME_IDS.forEach((id,index)=>{
  const cabinet=CABINETS.find(item=>item.id===id)!;
  cabinet.hall='github';cabinet.x=1120+index%7*460;cabinet.y=cardRows[Math.floor(index/7)];
});

for (let index = CABINETS.length - 1; index >= 0; index--) {
  if (isRetiredCardGame(CABINETS[index].id)) CABINETS.splice(index, 1);
}

CABINETS.push({id:CARIBBEAN_GAME,name:'Карибские сокровища',subtitle:'Гигантские символы · Капитанский залп · Две тактики',x:0,y:0,color:0xd7a04a,playable:true,wallet:true,hall:'arcade'});

// Keep game descriptions available even when their game has no dedicated physical seat.
CABINETS.push({id:'royal-roulette',name:translateText('Рулетка'),subtitle:translateText('Европейская рулетка · Одно зеро'),x:0,y:0,color:0xd7b472,playable:true,wallet:true,hall:'arcade'});
export const GAME_CABINETS: readonly Cabinet[] = CABINETS.map(c=>({...c}));
for (let index = CABINETS.length - 1; index >= 0; index--) {
  if ((CABINETS[index].hall ?? 'arcade') === 'arcade') CABINETS.splice(index, 1);
}
const collectionNames = {royal:'Royal',github:'GitHub',casinoapipro:'Casino API PRO',luelon:'Luelon'};
const collectionCounts = {royal:0,github:0,casinoapipro:0,luelon:0};
for (const spec of ARCADE_CABINET_SPECS) {
  const definition=GAME_CABINETS.find(c=>c.id===(spec.defaultGameId??spec.id))!;
  const number=++collectionCounts[spec.collection];
  CABINETS.push({...definition,...spec,hall:'arcade',playable:true,
    name:spec.collection==='luelon'?'Luelon Play':`${collectionNames[spec.collection]} ${String(number).padStart(2,'0')}`,
    subtitle:spec.collection==='luelon'?translateText('Каталог демоигр · Кредиты Luelon'):translateText('Выбери игру в каталоге'),
    demo:spec.collection==='luelon',provider:spec.collection==='casinoapipro',
  });
}

export const cabinetHall = (cabinet: Cabinet): 'arcade' | 'tables' | 'github' => cabinet.hall ?? 'arcade';
export const cabinetsInHall = (hall: string): Cabinet[] => CABINETS.filter(cabinet => cabinetHall(cabinet) === hall);
export const cabinetBounds = (cabinet: Cabinet): Obstacle => isCardGame(cabinet.id) ? cardTableBounds(cabinet) : {x:cabinet.x-47,y:cabinet.y-51,w:94,h:51};

export type Cabinet = { id: string; name: string; subtitle: string; x: number; y: number; color: number; playable: boolean; hall?: 'arcade' | 'tables' | 'github'; demo?: boolean; wallet?: boolean; provider?: boolean; github?: boolean };

import { BASE_EXPANSION_GAMES, EXPANSION_NAMES } from './casinoExpansion';
import { STUDIO_GAMES, STUDIO_INFO } from './studioGames';
const expansionPositions=BASE_EXPANSION_GAMES.map((_,i)=>i===0?[240,600]:i===1?[480,810]:i===10?[240,1180]:i===11?[480,1180]:[1200,1060]);
// Shared positions keep rendering, collisions and server play status aligned.
export const CABINETS: Cabinet[] = [
  { id: 'casinoapipro', name: 'Casino Api Pro', subtitle: '14 казино-игр · Общий демобаланс', x: 240, y: 267, color: 0x72e3ee, playable: true, provider: true },
  { id: 'royal-fruits', name: 'Royal Fruits', subtitle: 'Три барабана · Одна линия', x: 500, y: 267, color: 0xf5bc64, playable: true, wallet: true },
  { id: 'royal-dice', name: 'Royal Dice', subtitle: 'Выбери число и шанс выигрыша', x: 1200, y: 320, color: 0x75cbd9, playable: true, wallet: true },
  { id: 'royal-limbo', name: 'Royal Limbo', subtitle: 'Задай свой множитель', x: 1430, y: 320, color: 0xc6a0ed, playable: true, wallet: true },
  { id: 'royal-mines', name: 'Royal Mines', subtitle: 'Открывай клетки · Забирай выигрыш', x: 1660, y: 320, color: 0x7bcaa1, playable: true, wallet: true },
  { id: 'royal-plinko', name: 'Royal Plinko', subtitle: 'Шарик · Пирамидка · Множители', x: 1890, y: 320, color: 0xeb91af, playable: true, wallet: true },
  { id: 'royal-keno', name: 'Royal Keno', subtitle: 'Выбирай числа от 1 до 40', x: 1890, y: 620, color: 0x9babec, playable: true, wallet: true },
  { id: 'luelon', name: 'Luelon Play', subtitle: 'Каталог демоигр · Кредиты Luelon', x: 780, y: 810, color: 0xd6aaef, playable: true, hall: 'arcade', demo: true },
  { id: 'github-blackjack', name: 'Блэкджек', subtitle: 'Карты · Дилер · 21', x: 1200, y: 570, color: 0x79c9bb, playable: true, hall: 'arcade', github: true },
  { id: 'github-poker', name: 'Покер', subtitle: 'Холдем · Соперник за столом', x: 1430, y: 570, color: 0xd6aaef, playable: true, hall: 'arcade', github: true },
  { id: 'github-video-poker', name: 'Видеопокер', subtitle: 'Пять карт · Удержание · Джокер', x: 1660, y: 570, color: 0xf5bc64, playable: true, hall: 'arcade', github: true },
  { id: 'github-baccarat', name: 'Баккара', subtitle: 'Игрок · Банкир · Ничья', x: 1200, y: 810, color: 0xeb91af, playable: true, hall: 'arcade', github: true },
  { id: 'github-craps', name: 'Craps', subtitle: 'Две кости · Pass Line · Field', x: 1430, y: 810, color: 0x75cbd9, playable: true, hall: 'arcade', github: true },
  { id: 'github-hilo', name: 'Hi-Lo', subtitle: 'Выше или ниже · Демомонеты / USDT', x: 1660, y: 810, color: 0xe2c484, playable: true, hall: 'arcade', github: true },
  { id: 'github-tower', name: 'Dragon Tower', subtitle: 'Девять уровней · Демомонеты / USDT', x: 1890, y: 810, color: 0x8ecba2, playable: true, hall: 'arcade', github: true },
  ...BASE_EXPANSION_GAMES.map((id,i):Cabinet=>({id,name:EXPANSION_NAMES[id],subtitle:'Общий тестовый кошелёк · Ставки и выплаты',x:expansionPositions[i][0],y:expansionPositions[i][1],color:[0xe2c484,0x8ecba2,0xc6a0ed,0x75cbd9][i%4],playable:true,hall:'arcade',github:true})),
];

const leftCabinets=new Set(['casinoapipro','royal-fruits','luelon','github-diamonds','github-crash','github-deuces','github-sic-bo']);
let tableIndex=0;
for(const cabinet of CABINETS){if(leftCabinets.has(cabinet.id))continue;const i=tableIndex++;cabinet.x=1200+(i%5)*180;cabinet.y=[270,410,550,790,930,1070,1210][Math.floor(i/5)];}

// The new wing has separate cabinets, leaving the original club routes intact.
const annexGames = [
  { id:'variant-target-plinko', name:'Плинко: мишень', subtitle:'Один шарик · Выбери зону приземления', color:0x75cbd9 },
  { id:'variant-triple-poker', name:'Три карты: комбинация', subtitle:'Пара, флеш или стрит · Один расклад', color:0xd6aaef },
  { id:'variant-dice-streak', name:'Кости: серия', subtitle:'Пять бросков · Собери серию', color:0xf5bc64 },
  { id:'variant-gem-collection', name:'Самоцветы: коллекция', subtitle:'Выбери три цвета · Найди их среди пяти', color:0x86d8b0 },
  { id:'variant-double-mines', name:'Мины: парный поиск', subtitle:'Открывай пары · Забирай выигрыш', color:0x7bba95 },
  { id:'variant-blackjack-target', name:'21: тройной расклад', subtitle:'Три карты · Выбери сумму', color:0xf3ca77 },
];
CABINETS.push(...annexGames.map((game,index):Cabinet=>({...game,x:2250+index%3*180,y:410+Math.floor(index/3)*520,playable:true,wallet:true,hall:'arcade'})));

const studioOrder = [...STUDIO_GAMES.filter(id=>STUDIO_INFO[id].kind==='slot'),...STUDIO_GAMES.filter(id=>STUDIO_INFO[id].kind!=='slot')];
const studioRows = [300,470,640,980,1150];
CABINETS.push(...studioOrder.map((id,index):Cabinet=>({id,name:STUDIO_INFO[id].name,subtitle:STUDIO_INFO[id].subtitle,x:3000+index%7*180,y:studioRows[Math.floor(index/7)],color:STUDIO_INFO[id].color,playable:true,wallet:true,hall:'arcade'})));

export const cabinetHall = (cabinet: Cabinet): 'arcade' | 'tables' | 'github' => cabinet.hall ?? 'arcade';
export const cabinetsInHall = (hall: string): Cabinet[] => CABINETS.filter(cabinet => cabinetHall(cabinet) === hall);

import type { HallId } from './world';
import type { Obstacle } from '../game/navigation';

export type ClubZone = { name: string; x: number; y: number; w: number; h: number; color: number };
export const CLUB_ZONES: Record<HallId, ClubZone[]> = {
  arcade: [
    {name:'МУЗЫКАЛЬНЫЙ САЛОН',x:90,y:270,w:250,h:180,color:0x443042},
    {name:'БАР МИРЫ',x:710,y:300,w:330,h:350,color:0x352b38},
    {name:'ГАЛЕРЕЯ АВТОМАТОВ',x:1130,y:245,w:890,h:430,color:0x303441},
    {name:'ГОСТИНАЯ',x:170,y:780,w:470,h:370,color:0x453141},
    {name:'КАРТЫ И КОСТИ',x:1130,y:720,w:890,h:170,color:0x244639},
    {name:'КАТАЛОГ ДЕМОИГР',x:700,y:735,w:300,h:220,color:0x3d3447},
    {name:'КАЗИНО-СТОЛЫ',x:1170,y:985,w:790,h:300,color:0x293d3a},
    {name:'НОВЫЕ ИГРЫ',x:2150,y:255,w:520,h:320,color:0x3d3447},
    {name:'ЗАЛ УДАЧИ',x:2150,y:775,w:520,h:320,color:0x293d3a},
    {name:'ROYAL STUDIO · ЛИНИИ И БОНУСЫ',x:2880,y:240,w:1260,h:425,color:0x29384e},
    {name:'ПУТЕШЕСТВИЯ И ПРИЗОВЫЕ МИРЫ',x:2880,y:880,w:1260,h:355,color:0x383144},
  ],
  tables: [
    {name:'БИЛЬЯРДНЫЙ ЗАЛ',x:330,y:285,w:440,h:370,color:0x2d4c3f},
    {name:'АЭРОХОККЕЙ',x:1050,y:300,w:350,h:310,color:0x334653},
    {name:'ЗОНА ОТДЫХА',x:1500,y:245,w:480,h:380,color:0x3d3447},
    {name:'ТИХАЯ БИБЛИОТЕКА',x:1240,y:730,w:730,h:400,color:0x414237},
    {name:'ГОСТИНАЯ НАВЕРХУ',x:170,y:780,w:640,h:370,color:0x3b4844},
  ],
  github: [
    {name:'ПРИВЕТСТВИЕ И ПРАВИЛА',x:170,y:245,w:650,h:360,color:0x383345},
    {name:'КАРТОЧНЫЙ САЛОН',x:980,y:235,w:3120,h:615,color:0x244639},
    {name:'ПОКЕР И АВТОРСКИЕ РАЗДАЧИ',x:980,y:875,w:3120,h:435,color:0x293e47},
    {name:'ГОСТИНАЯ КАРТОЧНОГО ЭТАЖА',x:170,y:780,w:640,h:510,color:0x453344},
  ],
};
export type Lounge = { hall: HallId; x: number; y: number; color: number };
export const LOUNGES: Lounge[] = [
  {hall:'arcade',x:350,y:900,color:0x895064}, {hall:'arcade',x:770,y:1050,color:0x527a70}, {hall:'arcade',x:770,y:1220,color:0x895064},
  {hall:'tables',x:350,y:900,color:0x527a70}, {hall:'tables',x:680,y:1010,color:0x527a70}, {hall:'tables',x:1800,y:820,color:0x895064},
  {hall:'github',x:350,y:900,color:0x895064}, {hall:'github',x:670,y:1020,color:0x527a70}, {hall:'github',x:670,y:1190,color:0x527a70},
];
export const CLUB_PLANTS = [ {x:1110,y:440}, {x:2020,y:460}, {x:1080,y:900}, {x:2020,y:1120}, {x:110,y:1180}, {x:2670,y:610}, {x:2670,y:1160}, {x:2810,y:560}, {x:2810,y:1080}, {x:4160,y:520}, {x:4160,y:1050} ];
const CARD_FLOOR_PLANTS = [{x:110,y:350},{x:110,y:1180},{x:940,y:400},{x:940,y:1100},{x:4160,y:520},{x:4160,y:1050}];
export const clubPlants = (hall: HallId) => hall === 'github' ? CARD_FLOOR_PLANTS : CLUB_PLANTS;
export const loungeBounds = (lounge: Lounge): Obstacle => ({x:lounge.x-94,y:lounge.y-80,w:188,h:60});
export const clubObstacles = (hall: HallId): Obstacle[] => [
  ...[220,750,1140,2000].map(x=>({x:x-19,y:670,w:38,h:63})),
  ...LOUNGES.filter(lounge=>lounge.hall===hall).map(loungeBounds),
  ...LOUNGES.filter(lounge=>lounge.hall===hall).map(lounge=>({x:lounge.x-47,y:lounge.y+76,w:94,h:36})),
  ...clubPlants(hall).map(plant=>({x:plant.x-18,y:plant.y-32,w:36,h:26})),
];

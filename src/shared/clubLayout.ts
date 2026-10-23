import { t as translateText } from '../i18n/index';
import type { HallId } from './world';
import type { Obstacle } from '../game/navigation';

export type ClubZone = { name: string; x: number; y: number; w: number; h: number; color: number };
// Frame the occupied first-floor area without changing the other floors' world bounds.
export const ARCADE_OVERVIEW_SIZE = {width:2760,height:1380} as const;
export const LUELON_NEW_ZONE = {
  name: translateText('ROYAL · НАШИ ИГРЫ'),
  x: 1100, y: 245, w: 720, h: 575, color: 0x263653,
  entrance: {x: 1060, y: 580},
  cosmic: {x: 1200, y: 430},
  caramel: {x: 1335, y: 430},
  velvet: {x: 1470, y: 430},
  convoy: {x: 1605, y: 430},
} as const;
// The collection now shares the main hall without a distant gateway.
export const LUELON_NEW_ZONE_OBSTACLES: Obstacle[] = [];
export const CLUB_ZONES: Record<HallId, ClubZone[]> = {
  arcade: [
    {name:translateText('БАР МИРЫ'),x:100,y:285,w:350,h:360,color:0x352b38},
    {name:translateText('МУЗЫКАЛЬНЫЙ САЛОН'),x:620,y:285,w:400,h:360,color:0x443042},
    LUELON_NEW_ZONE,
    {name:translateText('LUELON · ДЕМОИГРЫ'),x:1870,y:245,w:350,h:305,color:0x42334f},
    {name:'CASINO API PRO',x:2240,y:245,w:350,h:305,color:0x2e454b},
    {name:translateText('ИГРЫ С GITHUB'),x:1870,y:580,w:720,h:520,color:0x293d3a},
    {name:translateText('ГОСТИНАЯ'),x:150,y:800,w:800,h:370,color:0x453141},
  ],
  tables: [
    {name:translateText('БИЛЬЯРДНЫЙ ЗАЛ'),x:330,y:285,w:440,h:370,color:0x2d4c3f},
    {name:translateText('АЭРОХОККЕЙ'),x:1050,y:300,w:350,h:310,color:0x334653},
    {name:translateText('ЗОНА ОТДЫХА'),x:1500,y:245,w:480,h:380,color:0x3d3447},
    {name:translateText('ТИХАЯ БИБЛИОТЕКА'),x:1240,y:730,w:730,h:400,color:0x414237},
    {name:translateText('ГОСТИНАЯ НАВЕРХУ'),x:170,y:780,w:640,h:370,color:0x3b4844},
  ],
  github: [
    {name:translateText('ПРИВЕТСТВИЕ И ПРАВИЛА'),x:170,y:245,w:650,h:360,color:0x383345},
    {name:translateText('КАРТОЧНЫЙ САЛОН'),x:980,y:235,w:3120,h:615,color:0x244639},
    {name:translateText('ПОКЕР И АВТОРСКИЕ РАЗДАЧИ'),x:980,y:875,w:3120,h:435,color:0x293e47},
    {name:translateText('ГОСТИНАЯ КАРТОЧНОГО ЭТАЖА'),x:170,y:780,w:640,h:510,color:0x453344},
  ],
};
export type Lounge = { hall: HallId; x: number; y: number; color: number };
export const LOUNGES: Lounge[] = [
  {hall:'arcade',x:350,y:950,color:0x895064}, {hall:'arcade',x:750,y:950,color:0x895064},
  {hall:'tables',x:350,y:900,color:0x527a70}, {hall:'tables',x:680,y:1010,color:0x527a70}, {hall:'tables',x:1800,y:820,color:0x895064},
  {hall:'github',x:350,y:900,color:0x895064}, {hall:'github',x:670,y:1020,color:0x527a70}, {hall:'github',x:670,y:1190,color:0x527a70},
];
export const CLUB_PLANTS = [ {x:1110,y:440}, {x:2020,y:460}, {x:1080,y:900}, {x:2020,y:1120}, {x:110,y:1180}, {x:2670,y:610}, {x:2670,y:1160}, {x:2810,y:560}, {x:2810,y:1080}, {x:4160,y:520}, {x:4160,y:1050} ];
const CARD_FLOOR_PLANTS = [{x:110,y:350},{x:110,y:1180},{x:940,y:400},{x:940,y:1100},{x:4160,y:520},{x:4160,y:1050}];
const ARCADE_PLANTS = [{x:1100,y:850},{x:1780,y:850},{x:2650,y:450},{x:2650,y:1120},{x:110,y:1180}];
export const clubPlants = (hall: HallId) => hall === 'github' ? CARD_FLOOR_PLANTS : hall === 'arcade' ? ARCADE_PLANTS : CLUB_PLANTS;
export const clubColumns = (hall: HallId): readonly number[] => hall === 'arcade' ? [220,750] : [220,750,1140,2000];
export const loungeBounds = (lounge: Lounge): Obstacle => ({x:lounge.x-94,y:lounge.y-80,w:188,h:60});
export const clubObstacles = (hall: HallId): Obstacle[] => [
  ...(hall==='arcade'?LUELON_NEW_ZONE_OBSTACLES:[]),
  ...clubColumns(hall).map(x=>({x:x-19,y:670,w:38,h:63})),
  ...LOUNGES.filter(lounge=>lounge.hall===hall).map(loungeBounds),
  ...LOUNGES.filter(lounge=>lounge.hall===hall).map(lounge=>({x:lounge.x-47,y:lounge.y+76,w:94,h:36})),
  ...clubPlants(hall).map(plant=>({x:plant.x-18,y:plant.y-32,w:36,h:26})),
];

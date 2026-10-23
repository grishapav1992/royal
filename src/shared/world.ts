import { t as translateText } from '../i18n/index';
import { clubObstacles, LOUNGES } from './clubLayout';
import type { Obstacle } from '../game/navigation';
import type { Facing, MovementInput } from './movement';
import { FURNITURE, furnitureBounds, BAR_SOLID, BAR_SERVICE, barPoint, PLANTS, plantBounds } from './furniture';
import { ACTIVITIES } from './activities';
import { CABINETS, cabinetsInHall, cabinetBounds } from './cabinets';
import type { GameReaction } from './cabinetSeating';
import type { CatAction } from './cat';
import { CAT_CARE } from './catCare';
export const PLAYER_SPEED = 155;
export const PLAYER_SPRINT_SPEED = PLAYER_SPEED * 1.75;
export const ROOM_CAPACITY = 30;
export const NPC_SPAWNS = [[350,300],[875,610],[365,531],[711,563],[100,350]] as const;
export type Seat = { hall?: HallId; id: string; kind: 'sofa' | 'bar'; x: number; y: number; entry: { x: number; y: number }; facing: Facing };
export const SEATS: readonly Seat[] = [
  ...[49,134,214].map((x,i)=>({id:'bar-'+i,hall:'arcade' as const,kind:'bar' as const,...barPoint(x,211),entry:barPoint(x,253),facing:'up' as const})),
  ...LOUNGES.filter(lounge=>lounge.hall==='arcade').map((lounge,i)=>({id:i===0?'arcade-lounge':'arcade-lounge-'+(i+1),hall:lounge.hall,kind:'sofa' as const,x:lounge.x-30,y:lounge.y+10,entry:{x:lounge.x-30,y:lounge.y+40},facing:'down' as const})),
  ...(['tables','github'] as const).map(hall=>({id:hall+'-lounge',hall,kind:'sofa' as const,x:320,y:910,entry:{x:320,y:950},facing:'down' as const})),
];
export const BAR_APPROACH = barPoint(125,241);
export const ROOM_OBSTACLES: Obstacle[] = [
  ...CABINETS.map(cabinetBounds),
  ...Object.entries(FURNITURE).filter(([key])=>key!=='sofa').map(([,item])=>furnitureBounds(item)),
  ...PLANTS.map(plantBounds),
  BAR_SOLID,
  ACTIVITIES.hockey.bounds, ACTIVITIES.piano.bounds,
  ...SEATS.filter(s => s.kind === 'bar').map(s => ({x:s.x-18,y:s.y-15,w:36,h:30})),
];
export type HallId = 'arcade' | 'tables' | 'github';
export const HALLS = {
  arcade: { floor:1, name: translateText('Казино и бар'), number: '01', spawn: { x: 540, y: 590 } },
  tables: { floor:2, name: translateText('Игры на двоих'), number: '02', spawn: { x: 540, y: 590 } },
  github: { floor:3, name: translateText('Карточный салон'), number: '03', spawn: { x: 540, y: 590 } },
} as const;
export const HALL_DOORS = {
  arcade: { entry: { x: 900, y: 240 }, arrival: { x: 900, y: 290 }, facing: 'down', click: { x: 900, y: 107 }, left: 860, right: 940, top: 225, bottom: 247 },
  tables: { entry: { x: 900, y: 1300 }, arrival: { x: 900, y: 1250 }, facing: 'up', click: { x: 900, y: 1307 }, left: 860, right: 940, top: 1293, bottom: 1310 },
  github: { entry: { x: 900, y: 1300 }, arrival: { x: 900, y: 1250 }, facing: 'up', click: { x: 900, y: 1307 }, left: 860, right: 940, top: 1293, bottom: 1310 },
} as const;
export type HallDoor = typeof HALL_DOORS[HallId];
export const GITHUB_ROOM_DOOR = { entry: { x: 800, y: 240 }, arrival: { x: 800, y: 290 }, facing: 'down', click: { x: 800, y: 107 }, left: 760, right: 840, top: 225, bottom: 247 } as const;
export type ConnectedHallDoor = HallDoor | typeof GITHUB_ROOM_DOOR;
export type HallLink = { target: HallId; door: ConnectedHallDoor; arrival: ConnectedHallDoor };
export function hallLinks(hall: HallId): HallLink[] {
  if (hall === 'arcade') return [{ target: 'tables', door: HALL_DOORS.arcade, arrival: HALL_DOORS.tables }];
  if (hall === 'github') return [{ target: 'tables', door: HALL_DOORS.github, arrival: GITHUB_ROOM_DOOR }];
  return [
    { target: 'arcade', door: HALL_DOORS.tables, arrival: HALL_DOORS.arcade },
    { target: 'github', door: GITHUB_ROOM_DOOR, arrival: HALL_DOORS.github },
  ];
}
export function hallLinkAt(p: { x: number; y: number; hall: string }): HallLink | undefined {
  if (!Object.hasOwn(HALLS, p.hall)) return;
  return hallLinks(p.hall as HallId).find(({ door }) => p.x >= door.left && p.x <= door.right && p.y >= door.top && p.y <= door.bottom);
}
export const inHallDoor = (p: {x:number;y:number;hall:string}) => {
  return Boolean(hallLinkAt(p));
};
export const otherHall = (hall:string): HallId => hall==='arcade'||hall==='github'?'tables':'arcade';
export const activityHall = (id: string): HallId => id === 'piano' ? 'arcade' : ['durak','transfer-durak','crazy-eights'].includes(id) ? 'github' : 'tables';
export const hallObstacles = (hall?: string): Obstacle[] => hall === 'arcade' ? ARCADE_OBSTACLES : hall === 'tables' ? TABLE_OBSTACLES : hall === 'github' ? GITHUB_OBSTACLES : ROOM_OBSTACLES;
const GITHUB_OBSTACLES = [...clubObstacles('github'), ...cabinetsInHall('github').map(cabinetBounds), ACTIVITIES.durak.bounds, ACTIVITIES['transfer-durak'].bounds, ACTIVITIES['crazy-eights'].bounds];
const ARCADE_OBSTACLES = [
  ...clubObstacles('arcade'),
  ...cabinetsInHall('arcade').map(cabinetBounds),
  BAR_SOLID, ACTIVITIES.piano.bounds, CAT_CARE.scratcher.bounds,
];
const TABLE_OBSTACLES = [
  ...clubObstacles('tables'),
  ...cabinetsInHall('tables').map(cabinetBounds),
  furnitureBounds(FURNITURE.pool), furnitureBounds(FURNITURE.table), ACTIVITIES.hockey.bounds, ...PLANTS.map(plantBounds),
];
export const DRINKS = [
  { id: 'lemonade', name: translateText('Лимонад'), description: translateText('Лимон, мята и пузырьки · без алкоголя'), color: '#d6ed88', strength: 0 },
  { id: 'coffee', name: translateText('Кофе'), description: translateText('Горячий кофе · без алкоголя'), color: '#d5af8a', strength: 0 },
  { id: 'berry', name: translateText('Ягодный микс'), description: translateText('Ягодный напиток со льдом · без алкоголя'), color: '#e39bb8', strength: 0 },
  { id: 'beer', name: translateText('Пиво'), description: translateText('Холодное светлое · лёгкое опьянение'), color: '#e7bb5b', strength: .18 },
  { id: 'wine', name: translateText('Вино'), description: translateText('Красное сухое · средняя крепость'), color: '#b74f71', strength: .26 },
  { id: 'whisky', name: translateText('Виски'), description: translateText('Янтарный виски со льдом · крепкий'), color: '#ce884a', strength: .38 },
  { id: 'cocktail', name: translateText('Коктейль «Рояль»'), description: translateText('Цитрус, ром и лёд · средняя крепость'), color: '#cc81b4', strength: .30 },
] as const;
export const atBar = (p: { x: number; y: number }) => p.x >= BAR_SERVICE.x && p.x <= BAR_SERVICE.x+BAR_SERVICE.w && p.y >= BAR_SERVICE.y && p.y <= BAR_SERVICE.y+BAR_SERVICE.h;
export type PlayerAction = 'idle' | 'sit' | 'drink';
export type PlayerView = { security?: string; id: string; hall: HallId; hallRevision: number; name: string; x: number; y: number; skin: number; appearance?: string; facing: 'up' | 'down' | 'left' | 'right'; moving: boolean; connected: boolean; playing: boolean; cabinet?: string; gameReaction?: string; gameReactionUntil?: number; activity?: string; ears?: boolean; seat: string; action: PlayerAction; drink: string; actionUntil: number; soberAt: number; inputSeq: number };
export type ChatMessage = { id: string; senderId: string; name: string; text: string; time: number; system?: boolean; requestId?: string };
export type NetworkCommands = { cat?: (action: CatAction) => void; inputs: (inputs: MovementInput[]) => void; move: (x: number, y: number) => void; target: (x: number, y: number) => void; stop: () => void; sit: (seat: string) => void; stand: () => void; drink: (drink: string) => void; cabinetPlay?: (id: string) => Promise<boolean>; cabinetLeave?: () => void; cabinetReaction?: (id: string, reaction: GameReaction) => void };

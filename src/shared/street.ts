import type { Obstacle, Point } from '../game/navigation';
import { WORLD } from './clubGeometry';

// The exterior footprint is independent of the number of casino floors.
export const STREET = {
  width: 2760, height: 1380,
  building: { x: 620, y: 500, w: 1480, h: 420 },
  entrance: { x: 840, y: 940 },
  spawn: { x: 840, y: 1030 },
  loop: [{ x: 480, y: 1050 }, { x: 2320, y: 1050 }, { x: 2320, y: 360 }, { x: 480, y: 360 }],
  benches: [{ x: 1180, y: 1130 }, { x: 1890, y: 1130 }, { x: 1170, y: 270 }, { x: 1880, y: 270 }],
  trees: [180,2580].flatMap(x=>[330,690,1100].map(y=>({x,y}))),
  lamps: [350,2470].flatMap(x=>[290,750,1160].map(y=>({x,y}))),
} as const;

export const STREET_OBSTACLES: Obstacle[] = [
  STREET.building,
  { x: STREET.width - 65, y: 0, w: WORLD.width - STREET.width + 65, h: STREET.height },
  { x: 0, y: 1210, w: STREET.width, h: 170 },
  ...STREET.benches.map(p => ({ x: p.x - 57, y: p.y - 32, w: 114, h: 40 })),
  ...STREET.trees.map(p=>({x:p.x-17,y:p.y-10,w:34,h:30})),
  ...STREET.lamps.map(p=>({x:p.x-16,y:p.y,w:32,h:9})),
  ...[-126,126].map(offset=>({x:STREET.entrance.x+offset-28,y:906,w:56,h:28})),
];

export const STREET_DOOR = {
  entry: STREET.entrance, arrival: STREET.spawn, facing: 'down', click: { x: 840, y: 840 },
  left: 798, right: 882, top: 932, bottom: 952,
} as const;
export const CASINO_EXIT = {
  entry: { x: 180, y: 1300 }, arrival: { x: 180, y: 1230 }, facing: 'up', click: { x: 180, y: 1280 },
  left: 138, right: 222, top: 1290, bottom: 1310,
} as const;

export function streetFacadeAlpha(player: Point) {
  const b = STREET.building;
  return player.x > b.x - 32 && player.x < b.x + b.w + 32 && player.y < b.y + b.h ? .16 : 1;
}

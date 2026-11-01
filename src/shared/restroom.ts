import type { Obstacle } from '../game/navigation';
import { WORLD } from './clubGeometry';

export const RESTROOM = {
  size: { width: 1440, height: 1120 },
  bounds: { left: 70, right: 1370, top: 225, bottom: 1040 },
  entrance: { entry: { x: 800, y: 240 }, arrival: { x: 800, y: 290 }, facing: 'down', click: { x: 800, y: 107 }, left: 760, right: 840, top: 225, bottom: 247 },
  exit: { entry: { x: 900, y: 1040 }, arrival: { x: 900, y: 980 }, facing: 'up', click: { x: 900, y: 1047 }, left: 860, right: 940, top: 1033, bottom: 1050 },
  stalls: [250, 470, 690],
  sinks: [370, 570, 770],
} as const;

// The client and server use the same walls, partitions and fixture collisions.
export const RESTROOM_OBSTACLES: Obstacle[] = [
  { x: RESTROOM.bounds.right + 16, y: 175, w: WORLD.width, h: WORLD.height },
  { x: 55, y: RESTROOM.bounds.bottom + 16, w: WORLD.width, h: WORLD.height },
  ...[140, 360, 580, 800].map(x => ({ x, y: 225, w: 14, h: 290 })),
  ...RESTROOM.stalls.map(x => ({ x: x - 35, y: 225, w: 70, h: 100 })),
  ...RESTROOM.stalls.map(x => ({ x: x - 93, y: 454, w: 58, h: 60 })),
  ...RESTROOM.sinks.map(y => ({ x: 1200, y: y - 65, w: 160, h: 130 })),
];

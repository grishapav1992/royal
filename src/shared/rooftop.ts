import type { Obstacle } from '../game/navigation';
import { WORLD } from './clubGeometry';

// Roof access is a location, independent of the casino's numbered floors.
export const ROOF = {
  width: 2240, height: 1380,
  deck: { x: 140, y: 300, w: 1960, h: 900 },
  spawn: { x: 530, y: 700 },
  hatch: { x: 440, y: 410, w: 180, h: 170 },
  vents: [{ x: 1080, y: 475, w: 160, h: 110 }, { x: 1390, y: 475, w: 160, h: 110 }, { x: 1460, y: 900, w: 140, h: 90 }],
  benches: [{ x: 800, y: 930, w: 190, h: 52 }, { x: 1080, y: 930, w: 190, h: 52 }],
  antenna: { x: 1870, y: 410, w: 100, h: 85 },
  loop: [{ x: 320, y: 700 }, { x: 320, y: 1080 }, { x: 1920, y: 1080 }, { x: 1920, y: 700 }, { x: 1740, y: 360 }, { x: 750, y: 360 }],
} as const;

export const STREET_ROOF_STAIRS = {
  foot: { x: 1660, y: 480 },
  entry: { x: 1660, y: 400 }, arrival: { x: 1660, y: 470 }, facing: 'up', click: { x: 1660, y: 392 },
  left: 1638, right: 1682, top: 390, bottom: 410,
} as const;
export const ROOF_STAIRS = {
  entry: { x: 530, y: 620 }, arrival: ROOF.spawn, facing: 'down', click: { x: 530, y: 515 },
  left: 502, right: 558, top: 608, bottom: 632,
} as const;

export const ROOF_OBSTACLES: Obstacle[] = [
  { x: 0, y: 0, w: WORLD.width, h: 330 },
  { x: 0, y: 0, w: 170, h: ROOF.height },
  { x: 2070, y: 0, w: WORLD.width - 2070, h: ROOF.height },
  { x: 0, y: 1170, w: WORLD.width, h: ROOF.height - 1170 },
  ROOF.hatch, ...ROOF.vents, ...ROOF.benches, ROOF.antenna,
];

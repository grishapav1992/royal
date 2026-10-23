import { BAR_POSITION, barPoint } from './furniture';

// The cat reaches elevated furniture only through these dedicated approaches.
export const CAT_CARE = {
  hall: 'arcade',
  bar: {
    approach: barPoint(297,153),
    perch: barPoint(224,112),
    mug: barPoint(254,114),
    depth: BAR_POSITION.y+171,
  },
  food: {
    bowl: { x: 2280, y: 223 },
    approach: { x: 2253, y: 227 },
  },
  scratcher: {
    post: { x: 2412, y: 226 },
    approach: { x: 2380, y: 238 },
    bounds: { x: 2400, y: 214, w: 24, h: 22 },
  },
} as const;

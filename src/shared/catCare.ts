import { BAR_OFFSET } from './furniture';

// The cat reaches elevated furniture only through these dedicated approaches.
export const CAT_CARE = {
  hall: 'arcade',
  bar: {
    approach: { x: 1038, y: 490 },
    perch: { x: 965, y: 419 + BAR_OFFSET },
    mug: { x: 995, y: 421 + BAR_OFFSET },
    depth: 478 + BAR_OFFSET,
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

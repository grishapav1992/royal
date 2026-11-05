import { BAR_POSITION, barPoint } from './furniture';
import { CAT_HOME } from './catHome';

const windowX = CAT_HOME.window.x;

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
    bowl: { x: windowX - 50, y: 223 },
    approach: { x: windowX - 77, y: 227 },
  },
  scratcher: {
    post: { x: windowX + 82, y: 226 },
    approach: { x: windowX + 50, y: 238 },
    bounds: { x: windowX + 70, y: 214, w: 24, h: 22 },
  },
} as const;

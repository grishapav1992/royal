import type { DragonPathBelt } from '../../src/shared/dragonPathBelt';

/**
 * Позы мастера для каждого пояса. Все позы нарисованы в одном стиле и в одном кадре,
 * поэтому переход между ними не ломает образ.
 */
export const heroImages = {
  green: {
    idle: '/assets/panda-dragon/panda-green-idle.webp',
    spin: '/assets/panda-dragon/panda-green-spin.webp',
    charge: '/assets/panda-dragon/panda-green-charge.webp',
    strike: '/assets/panda-dragon/panda-green-strike.webp',
    reach: '/assets/panda-dragon/panda-green-reach.webp',
    cheer: '/assets/panda-dragon/panda-green-cheer.webp',
  },
  blue: {
    idle: '/assets/panda-dragon/panda-blue-idle.webp',
    spin: '/assets/panda-dragon/panda-blue-spin.webp',
    charge: '/assets/panda-dragon/panda-blue-charge.webp',
    strike: '/assets/panda-dragon/panda-blue-strike.webp',
    reach: '/assets/panda-dragon/panda-blue-reach.webp',
    cheer: '/assets/panda-dragon/panda-blue-cheer.webp',
  },
  red: {
    idle: '/assets/panda-dragon/panda-red-idle.webp',
    spin: '/assets/panda-dragon/panda-red-spin.webp',
    charge: '/assets/panda-dragon/panda-red-charge.webp',
    strike: '/assets/panda-dragon/panda-red-strike.webp',
    reach: '/assets/panda-dragon/panda-red-reach.webp',
    cheer: '/assets/panda-dragon/panda-red-cheer.webp',
  },
  black: {
    idle: '/assets/panda-dragon/panda-black-idle.webp',
    spin: '/assets/panda-dragon/panda-black-spin.webp',
    charge: '/assets/panda-dragon/panda-black-charge.webp',
    strike: '/assets/panda-dragon/panda-black-strike.webp',
    reach: '/assets/panda-dragon/panda-black-reach.webp',
    cheer: '/assets/panda-dragon/panda-black-cheer.webp',
  },
} as const satisfies Record<DragonPathBelt, {
  idle: string;
  spin: string;
  charge: string;
  strike: string;
  reach: string;
  cheer: string;
}>;

export const symbolImages: readonly string[] = [
  '/assets/panda-dragon/sym-scroll.v3.webp',
  '/assets/panda-dragon/sym-panda.v3.webp',
  '/assets/panda-dragon/sym-peach.v3.webp',
  '/assets/panda-dragon/sym-dumplings.v3.webp',
  '/assets/panda-dragon/sym-tiger.v3.webp',
  '/assets/panda-dragon/sym-crane.v3.webp',
  '/assets/panda-dragon/sym-monkey.v3.webp',
  '/assets/panda-dragon/sym-mantis.v3.webp',
  '/assets/panda-dragon/sym-snake.v3.webp',
];

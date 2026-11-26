import type { DragonPathBelt } from '../../src/shared/dragonPathBelt';

export const heroImages = {
  green: {
    idle: '/assets/panda-dragon/panda-hero-green.webp',
    strike: '/assets/panda-dragon/panda-strike-green.webp',
    run: '/assets/panda-dragon/panda-tiptoe-fast.webp',
  },
  blue: {
    idle: '/assets/panda-dragon/panda-hero-blue.webp',
    strike: '/assets/panda-dragon/panda-strike-blue.webp',
    run: '/assets/panda-dragon/panda-tiptoe-blue.webp',
  },
  red: {
    idle: '/assets/panda-dragon/panda-hero.v3.webp',
    strike: '/assets/panda-dragon/panda-strike.v3.webp',
    run: '/assets/panda-dragon/panda-tiptoe-red.webp',
  },
  black: {
    idle: '/assets/panda-dragon/panda-hero-black.webp',
    strike: '/assets/panda-dragon/panda-strike-black.webp',
    run: '/assets/panda-dragon/panda-tiptoe-black.webp',
  },
} as const satisfies Record<DragonPathBelt, { idle: string; strike: string; run: string }>;

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

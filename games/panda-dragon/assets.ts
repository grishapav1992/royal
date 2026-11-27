import type { DragonPathBelt } from '../../src/shared/dragonPathBelt';

/**
 * Прежний образ мастера-панды, к которому вернулся игрок.
 * Кадр 336x440 с прозрачностью, по три позы на пояс:
 * hero - исходная стойка, strike - удар посохом, tiptoe - шаг с посохом.
 */
export const heroImages = {
  green: {
    idle: '/assets/panda-dragon/panda-hero-green.webp',
    strike: '/assets/panda-dragon/panda-strike-green.webp',
    spin: '/assets/panda-dragon/panda-tiptoe-fast.webp',
  },
  blue: {
    idle: '/assets/panda-dragon/panda-hero-blue.webp',
    strike: '/assets/panda-dragon/panda-strike-blue.webp',
    spin: '/assets/panda-dragon/panda-tiptoe-blue.webp',
  },
  red: {
    idle: '/assets/panda-dragon/panda-hero.v3.webp',
    strike: '/assets/panda-dragon/panda-strike.v3.webp',
    spin: '/assets/panda-dragon/panda-tiptoe-red.webp',
  },
  black: {
    idle: '/assets/panda-dragon/panda-hero-black.webp',
    strike: '/assets/panda-dragon/panda-strike-black.webp',
    spin: '/assets/panda-dragon/panda-tiptoe-black.webp',
  },
} as const satisfies Record<DragonPathBelt, { idle: string; strike: string; spin: string }>;

/**
 * Какие позы прежнего образа соответствуют экшнам.
 * Для экшнов без отдельного файла показывается исходная стойка.
 */
export const heroActionPose = {
  idle: 'idle',
  spin: 'spin',
  charge: 'idle',
  strike: 'strike',
  reach: 'idle',
  cheer: 'idle',
} as const satisfies Record<string, 'idle' | 'spin' | 'strike'>;

/**
 * Анимированные клипы экшнов: прозрачные animated WebP с циклом около двух секунд.
 * Ключ - действие мастера, значение - путь к клипу.
 * Пустая карта означает, что мастер остаётся на статичных позах.
 */
export const heroClips: Partial<Record<DragonPathBelt, Partial<Record<string, string>>>> = {};

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

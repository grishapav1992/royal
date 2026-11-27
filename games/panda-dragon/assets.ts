import type { DragonPathBelt } from '../../src/shared/dragonPathBelt';

/**
 * Образ мастера-панды, к которому вернулся игрок, плюс дорисованные позы.
 * Прежние кадры: покой (hero), удар (strike) и бег (tiptoe, анимированный WebP на 120 кадров).
 * Новые кадры нарисованы по образу пояса: замах, протянутая лапа и победный прыжок.
 * Все кадры одного размера 336x440 с прозрачностью, персонаж стоит на нижней линии.
 */
export const heroImages = {
  green: {
    idle: '/assets/panda-dragon/panda-hero-green.webp',
    spin: '/assets/panda-dragon/panda-tiptoe-fast.webp',
    strike: '/assets/panda-dragon/panda-strike-green.webp',
    charge: '/assets/panda-dragon/panda-green-charge.webp',
    reach: '/assets/panda-dragon/panda-green-reach.webp',
    cheer: '/assets/panda-dragon/panda-green-cheer.webp',
  },
  blue: {
    idle: '/assets/panda-dragon/panda-hero-blue.webp',
    spin: '/assets/panda-dragon/panda-tiptoe-blue.webp',
    strike: '/assets/panda-dragon/panda-strike-blue.webp',
    charge: '/assets/panda-dragon/panda-blue-charge.webp',
    reach: '/assets/panda-dragon/panda-blue-reach.webp',
    cheer: '/assets/panda-dragon/panda-blue-cheer.webp',
  },
  red: {
    idle: '/assets/panda-dragon/panda-hero.v3.webp',
    spin: '/assets/panda-dragon/panda-tiptoe-red.webp',
    strike: '/assets/panda-dragon/panda-strike.v3.webp',
    charge: '/assets/panda-dragon/panda-red-charge.webp',
    reach: '/assets/panda-dragon/panda-red-reach.webp',
    cheer: '/assets/panda-dragon/panda-red-cheer.webp',
  },
  black: {
    idle: '/assets/panda-dragon/panda-hero-black.webp',
    spin: '/assets/panda-dragon/panda-tiptoe-black.webp',
    strike: '/assets/panda-dragon/panda-strike-black.webp',
    charge: '/assets/panda-dragon/panda-black-charge.webp',
    reach: '/assets/panda-dragon/panda-black-reach.webp',
    cheer: '/assets/panda-dragon/panda-black-cheer.webp',
  },
} as const satisfies Record<DragonPathBelt, {
  idle: string;
  spin: string;
  strike: string;
  charge: string;
  reach: string;
  cheer: string;
}>;

/**
 * Анимированные клипы экшнов: прозрачные animated WebP с коротким циклом.
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

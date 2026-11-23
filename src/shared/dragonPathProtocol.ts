import type { DragonPathWin } from './dragonPathMath.ts';

export const DRAGON_PATH_GAME = 'panda-dragon-preview';
export const DRAGON_PATH_TITLE = 'Путь дракона';
export const DRAGON_PATH_RULES_VERSION = 1;
export const DRAGON_PATH_CLIENT_HEADER = 'X-Royal-Dragon-Path';
export const DRAGON_PATH_FREE_SPIN = 'dragon-path-free-spin';
export const DRAGON_PATH_CHOOSE_REWARD = 'dragon-path-choose-reward';
export const DRAGON_PATH_REWARDS = [2, 3] as const;
export const DRAGON_PATH_REWARD_LABELS = { 2: 'Персик Мудрости', 3: 'Пельмени Мастера' } as const;
export type DragonPathReward = typeof DRAGON_PATH_REWARDS[number];

export type DragonPathRound = Readonly<{
  version: typeof DRAGON_PATH_RULES_VERSION;
  stakeUnits: string;
  phase: 'free-spin' | 'reward' | 'complete';
  revision: 1 | 2 | 3;
  base: readonly number[];
  free: readonly number[] | null;
  reward: DragonPathReward | null;
}>;

export type DragonPathView = Readonly<{
  round: DragonPathRound;
  wins: readonly DragonPathWin[];
  scatterPositions: readonly number[];
}>;

export const validDragonPathReward = (value: unknown): value is DragonPathReward => value === 2 || value === 3;

export function validDragonPathSettings(value: unknown): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0;
}

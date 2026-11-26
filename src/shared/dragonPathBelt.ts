export const DRAGON_PATH_BELTS = [
  { id: 'green', rounds: 0, label: 'Зелёный пояс' },
  { id: 'blue', rounds: 10, label: 'Синий пояс' },
  { id: 'red', rounds: 25, label: 'Красный пояс' },
  { id: 'black', rounds: 50, label: 'Чёрный пояс' },
] as const;

export type DragonPathBelt = typeof DRAGON_PATH_BELTS[number]['id'];
export const DRAGON_PATH_BELT_MAX = DRAGON_PATH_BELTS[3].rounds;
export const DRAGON_PATH_BELT_PATH = '/api/dragon-path-progress';

export function dragonPathBeltProgress(completedRounds: number) {
  const nextIndex = DRAGON_PATH_BELTS.findIndex(belt => completedRounds < belt.rounds);
  const current = DRAGON_PATH_BELTS[nextIndex < 0 ? 3 : Math.max(0, nextIndex - 1)];
  return { current, remaining: nextIndex < 0 ? null : DRAGON_PATH_BELTS[nextIndex].rounds - completedRounds };
}

export function readDragonPathBeltRounds(value: unknown): number | undefined {
  if (!value || typeof value !== 'object' || !('completedRounds' in value)) return;
  const rounds = value.completedRounds;
  if (typeof rounds === 'number' && Number.isInteger(rounds) && rounds >= 0 && rounds <= DRAGON_PATH_BELT_MAX) return rounds;
}

import { validGameStake } from './gameStakes.ts';
import {
  DRAGON_PATH_FREE_MULTIPLIER, DRAGON_PATH_POINT_SCALE, DRAGON_PATH_SCATTER, DRAGON_PATH_TRIGGER,
  scoreDragonPathGrid, validDragonPathGrid,
} from './dragonPathMath.ts';
import {
  DRAGON_PATH_CHOOSE_REWARD, DRAGON_PATH_FREE_SPIN, DRAGON_PATH_REWARDS, DRAGON_PATH_RULES_VERSION,
  validDragonPathReward, type DragonPathRound,
} from './dragonPathProtocol.ts';

export class DragonPathMoveError extends Error {}

export function triggersDragonPathBonus(grid: readonly number[]): boolean {
  return grid.filter(symbol => symbol === DRAGON_PATH_SCATTER).length >= DRAGON_PATH_TRIGGER;
}

export function validDragonPathRound(value: unknown): value is DragonPathRound {
  if (!value || typeof value !== 'object' || Object.keys(value).sort().join(',') !== 'base,free,phase,revision,reward,stakeUnits,version') return false;
  const r = value as Partial<DragonPathRound>;
  if (r.version !== DRAGON_PATH_RULES_VERSION || !validGameStake(r.stakeUnits) || !validDragonPathGrid(r.base)) return false;
  if (!triggersDragonPathBonus(r.base)) return r.phase === 'complete' && r.revision === 1 && r.free === null && r.reward === null;
  if (r.phase === 'free-spin') return r.revision === 1 && r.free === null && r.reward === null;
  if (!validDragonPathGrid(r.free)) return false;
  if (r.phase === 'reward') return r.revision === 2 && r.reward === null;
  return r.phase === 'complete' && r.revision === 3 && validDragonPathReward(r.reward);
}

type DragonPathAction =
  | Readonly<{ move: typeof DRAGON_PATH_FREE_SPIN; cost: 0 }>
  | Readonly<{ move: typeof DRAGON_PATH_CHOOSE_REWARD; cost: 0; minPicks: 1; maxPicks: 1; choices: typeof DRAGON_PATH_REWARDS }>;

export function readDragonPath(value: unknown) {
  if (!validDragonPathRound(value)) throw new DragonPathMoveError('Сохранённый раунд несовместим с правилами «Пути дракона».');
  const round = value;
  const base = scoreDragonPathGrid(round.base);
  const free = round.free === null ? null : scoreDragonPathGrid(round.free);
  const points = base.points + (free?.points ?? 0) * DRAGON_PATH_FREE_MULTIPLIER;
  const ended = round.phase === 'complete';
  const actions: readonly DragonPathAction[] = round.phase === 'free-spin' ? [{ move: DRAGON_PATH_FREE_SPIN, cost: 0 }]
    : round.phase === 'reward' ? [{ move: DRAGON_PATH_CHOOSE_REWARD, cost: 0, minPicks: 1, maxPicks: 1, choices: DRAGON_PATH_REWARDS }] : [];
  const baseCreditUnits = ended ? String(BigInt(round.stakeUnits) * BigInt(points) / BigInt(DRAGON_PATH_POINT_SCALE)) : '0';
  return { round, base, free, points, actions, ended, baseCreditUnits } as const;
}

export type DragonPathResult = ReturnType<typeof readDragonPath>;

export function dragonPathAwardParts(round: unknown) {
  const result = readDragonPath(round);
  if (!result.ended) throw new DragonPathMoveError('Раунд ещё не завершён.');
  return { numerator: BigInt(result.round.stakeUnits) * BigInt(result.points), denominator: BigInt(DRAGON_PATH_POINT_SCALE) };
}

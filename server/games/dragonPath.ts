import { randomInt } from 'node:crypto';
import { validGameStake } from '../../src/shared/gameStakes.ts';
import { drawDragonPathGrid } from '../../src/shared/dragonPathMath.ts';
import {
  DRAGON_PATH_CHOOSE_REWARD, DRAGON_PATH_FREE_SPIN, DRAGON_PATH_RULES_VERSION, validDragonPathReward,
} from '../../src/shared/dragonPathProtocol.ts';
import {
  DragonPathMoveError, dragonPathAwardParts, readDragonPath, triggersDragonPathBonus, validDragonPathRound, type DragonPathResult,
} from '../../src/shared/dragonPathRound.ts';
import { exactAward } from '../../src/shared/roundPrecision.ts';

export { DRAGON_PATH_CHOOSE_REWARD, DRAGON_PATH_FREE_SPIN, DRAGON_PATH_REWARDS } from '../../src/shared/dragonPathProtocol.ts';
export { readDragonPath, validDragonPathRound } from '../../src/shared/dragonPathRound.ts';
type Draw = (exclusiveMaximum: number) => number;

export function dragonPathFinalAward(round: unknown) {
  const { numerator, denominator } = dragonPathAwardParts(round);
  return exactAward(numerator, denominator);
}

export function startDragonPath(stakeUnits: string, draw: Draw = randomInt): DragonPathResult {
  if (!validGameStake(stakeUnits)) throw new DragonPathMoveError('Недопустимая ставка за раунд.');
  const base = drawDragonPathGrid(draw);
  return readDragonPath({ version: DRAGON_PATH_RULES_VERSION, stakeUnits, phase: triggersDragonPathBonus(base) ? 'free-spin' : 'complete',
    revision: 1, base, free: null, reward: null });
}

export function moveDragonPath(saved: unknown, revision: unknown, move: string, picks?: readonly number[], draw: Draw = randomInt): DragonPathResult {
  if (!validDragonPathRound(saved) || revision !== saved.revision) throw new DragonPathMoveError('Раунд уже изменился. Обнови результат.');
  if (saved.phase === 'free-spin' && move === DRAGON_PATH_FREE_SPIN && picks === undefined) {
    const free = drawDragonPathGrid(draw);
    return readDragonPath({ ...saved, phase: 'reward', revision: 2, free });
  }
  if (saved.phase === 'reward' && move === DRAGON_PATH_CHOOSE_REWARD && Array.isArray(picks) && picks.length === 1 && validDragonPathReward(picks[0])) {
    return readDragonPath({ ...saved, phase: 'complete', revision: 3, reward: picks[0] });
  }
  throw new DragonPathMoveError('Ход недоступен на этом этапе раунда.');
}

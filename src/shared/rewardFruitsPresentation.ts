import { validRewardSpinRequest, validRewardSpinResult } from './progression';
import type { FruitsPresentation, FruitsSymbol } from './fruitsPresentation';

/** Free rounds keep the captured grant, chosen game and UUID, with no paid-stake whitelist. */
export function rewardFruitsPresentation(operation: unknown, result: unknown): FruitsPresentation | null {
  if (!validRewardSpinRequest(operation) || !validRewardSpinResult(result) || result.id !== operation.id
    || result.grantId !== operation.grantId || result.gameId !== operation.gameId
    || result.gameRound.gameId !== 'royal-fruits' || operation.gameId && operation.gameId !== 'royal-fruits') return null;
  const round = result.gameRound;
  if (!('symbols' in round.outcome)) return null;
  const symbols = Object.freeze([...round.outcome.symbols]) as readonly [FruitsSymbol,FruitsSymbol,FruitsSymbol];
  return Object.freeze({gameId:'royal-fruits',outcomeId:operation.id,stakeUnits:round.stakeUnits,returnedUnits:round.payoutUnits,
    rows:Object.freeze([Object.freeze({lineIndex:0,symbols,stakeUnits:round.stakeUnits,multiplier:round.multiplier,returnedUnits:round.payoutUnits})])});
}

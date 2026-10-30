import { isValidCoinsOutcome, isValidFruitsOutcome, type GameRound } from './gameCore';
import type { DemoWallet } from './demoWallet';
import { validNilePlayWallet, type NilePlayWallet } from './nilePlay';

export const PROGRESSION_LOCATION = 'south-park';
export const PROGRESSION_CURRENCY = 'VIRTUAL_USD';
export type ExperienceSource = 'paid-game' | 'pvp';
export type RewardGame = 'royal-coins' | 'royal-fruits';
export type FreeSpinReward = { kind: 'free_spins'; gameId: RewardGame; count: number; stakeUnits: string };
export type ProgressionLevel = { level: number; xp: string; reward?: FreeSpinReward };
export type ProgressionGrant = { id: string; gameId: RewardGame; count: number; remaining: number; stakeUnits: string; level: number; currency: string };
export type ProgressionSnapshot = { accountId: string; locationId: string; policyVersion: string; currency: string; xp: string; level: number;
  levels: ProgressionLevel[]; grants: ProgressionGrant[]; enabled: boolean };
export type RewardSpinRequest = { id: string; grantId: string };
export type RewardSpinResult = RewardSpinRequest & { gameRound: GameRound; payoutUnits: string; remaining: number;
  wallet: DemoWallet | NilePlayWallet; replayed: boolean };
export type ProgressionPolicy = { version: string; levels: ProgressionLevel[];
  coefficients: Record<ExperienceSource, { numerator: number; denominator: number }> };

const integer = (value: unknown): value is string => typeof value === 'string' && /^(0|[1-9]\d{0,29})$/.test(value);
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
export const validProgressionAccount = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
const game = (value: unknown): value is RewardGame => value === 'royal-coins' || value === 'royal-fruits';
const count = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 10000;
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
export function validRewardSpinRequest(value: unknown): value is RewardSpinRequest {
  return object(value) && Object.keys(value).sort().join(',') === 'grantId,id' && uuid(value.id) && uuid(value.grantId);
}
export function validProgressionSnapshot(value: unknown): value is ProgressionSnapshot {
  if (!object(value) || !validProgressionAccount(value.accountId) || !/^[a-z0-9-]{1,64}$/.test(value.locationId) || typeof value.policyVersion !== 'string'
    || !/^[a-z0-9-]{1,64}$/.test(value.policyVersion) || typeof value.currency !== 'string' || !integer(value.xp) || !Number.isInteger(value.level) || value.level < 1 || value.level > 100
    || typeof value.enabled !== 'boolean' || !Array.isArray(value.levels) || value.levels.length !== 100 || !Array.isArray(value.grants) || value.grants.length > 100) return false;
  let previous = -1n;
  for (const [i, row] of value.levels.entries()) {
    if (!object(row) || row.level !== i + 1 || !integer(row.xp) || BigInt(row.xp) <= previous) return false;
    previous = BigInt(row.xp);
    if (row.reward && (!object(row.reward) || row.reward.kind !== 'free_spins' || !game(row.reward.gameId) || !count(row.reward.count)
      || row.reward.count < 1 || !integer(row.reward.stakeUnits) || BigInt(row.reward.stakeUnits) < 1n)) return false;
  }
  if(value.levels[0].xp!=='0'||value.level!==value.levels.filter((l:any)=>BigInt(l.xp)<=BigInt(value.xp)).at(-1)?.level)return false;
  return value.grants.every((row: any) => object(row) && uuid(row.id) && game(row.gameId) && count(row.count) && row.count > 0
    && count(row.remaining) && row.remaining <= row.count && integer(row.stakeUnits) && Number.isInteger(row.level) && row.level >= 1 && row.level <= 100 && row.currency === value.currency);
}
export function validRewardSpinResult(value: unknown): value is RewardSpinResult {
  if (!object(value) || !uuid(value.id) || !uuid(value.grantId) || !count(value.remaining) || typeof value.replayed !== 'boolean'
    || !integer(value.payoutUnits) || !object(value.gameRound) || !object(value.wallet)) return false;
  const round = value.gameRound;
  if (!game(round.gameId) || round.rulesVersion !== 1 || !integer(round.stakeUnits) || BigInt(round.stakeUnits) <= 0n
    || !integer(round.payoutUnits) || !object(round.outcome) || !Number.isInteger(round.multiplier) || round.multiplier < 0) return false;
  if (!(round.gameId === 'royal-coins' ? isValidCoinsOutcome(round.outcome.symbols, round.multiplier) : isValidFruitsOutcome(round.outcome.symbols, round.multiplier))) return false;
  if (BigInt(round.payoutUnits) !== BigInt(round.stakeUnits) * BigInt(round.multiplier) || BigInt(value.payoutUnits) !== BigInt(round.payoutUnits) * 10000n) return false;
  return validNilePlayWallet(value.wallet) || (value.wallet.asset === undefined && Number.isFinite(value.wallet.balance) && value.wallet.balance >= 0 && Array.isArray(value.wallet.entries));
}

/** XP uses cents of qualified turnover. Level 100 requires 1,000,000 units at coefficient 1. */
export const DEFAULT_PROGRESSION_POLICY: ProgressionPolicy = {
  version: 'location-levels-v1', coefficients: { 'paid-game': { numerator: 1, denominator: 1 }, pvp: { numerator: 1, denominator: 1 } },
  levels: Array.from({ length: 100 }, (_, i): ProgressionLevel => {
    const xp = (100000000n * BigInt(i) ** 3n + 99n ** 3n - 1n) / (99n ** 3n);
    const level = i + 1;
    const tier = level >= 100 ? 4 : level >= 75 ? 3 : level >= 50 ? 2 : level >= 25 ? 1 : 0;
    const counts = [5, 8, 12, 20, 40], stakes = ['100000', '200000', '500000', '1000000', '2000000'];
    return { level, xp: String(xp), ...(level % 5 === 0 ? { reward: { kind: 'free_spins', gameId: level % 10 === 0 ? 'royal-fruits' : 'royal-coins', count: counts[tier], stakeUnits: stakes[tier] } as FreeSpinReward } : {}) };
  }),
};

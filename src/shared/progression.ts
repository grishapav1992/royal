import { isValidCoinsOutcome, isValidFruitsOutcome, type GameRound } from './gameCore';
import type { DemoWallet } from './demoWallet';
import { validNilePlayWallet, type NilePlayWallet } from './nilePlay';

export const PROGRESSION_LOCATION = 'south-park';
export const PROGRESSION_CURRENCY = 'VIRTUAL_USD';
export type ExperienceSource = 'paid-game' | 'pvp';
export type RewardGame = 'royal-coins' | 'royal-fruits';
export const FREE_SPIN_NOMINAL_UNITS = ['100000','200000','500000','1000000','2000000','3000000','5000000','10000000','20000000','50000000'] as const;
export type ProgressionReward = { kind: string };
export type FreeSpinReward = { kind: 'free_spins'; gameId: RewardGame; count: number; stakeUnits: string };
export type SkinGenerationReward = { kind: 'skin_generation'; count: number; theme: string; variantCount: 2 };
export type RewardBundle = { kind: 'bundle'; rewards: (FreeSpinReward | SkinGenerationReward)[] };
export type LevelReward = FreeSpinReward | SkinGenerationReward | RewardBundle;
export type SkinGenerationGrant = { id: string; count: number; remaining: number; level: number; theme: string; variantCount: 2; currency: string };
export const rewardLeaves = (r: LevelReward): (FreeSpinReward | SkinGenerationReward)[] => r.kind === 'bundle' ? r.rewards : [r];
export type ProgressionLevel<R extends ProgressionReward = LevelReward> = { level: number; xp: string; reward?: R };
export type ProgressionGrant = { id: string; gameId: RewardGame; count: number; remaining: number; stakeUnits: string; level: number; currency: string };
export type ProgressionSnapshot<R extends ProgressionReward = LevelReward> = { accountId: string; locationId: string; policyVersion: string; currency: string; xp: string; level: number;
  levels: ProgressionLevel<R>[]; grants: ProgressionGrant[]; skinGrants?: SkinGenerationGrant[]; enabled: boolean };
export type RewardSpinRequest = { id: string; grantId: string };
export type RewardSpinResult = RewardSpinRequest & { gameRound: GameRound; payoutUnits: string; remaining: number;
  wallet: DemoWallet | NilePlayWallet; replayed: boolean };
export type ProgressionPolicy<S extends string = ExperienceSource, R extends ProgressionReward = LevelReward> = { version: string; levels: ProgressionLevel<R>[];
  coefficients: Record<S, { numerator: number; denominator: number }> };

const integer = (value: unknown): value is string => typeof value === 'string' && /^(0|[1-9]\d{0,29})$/.test(value);
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
export const validProgressionAccount = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
const game = (value: unknown): value is RewardGame => value === 'royal-coins' || value === 'royal-fruits';
const count = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 10000;
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
export function validLevelReward(value: unknown): value is LevelReward {
  if (!object(value)) return false;
  if (value.kind === 'bundle') return Array.isArray(value.rewards) && value.rewards.length >= 1 && value.rewards.length <= 2
    && value.rewards.every((r: any) => r?.kind !== 'bundle' && validLevelReward(r))
    && new Set(value.rewards.map((r: any) => r.kind)).size === value.rewards.length;
  if (value.kind === 'skin_generation') return count(value.count) && value.count > 0 && value.variantCount === 2
    && typeof value.theme === 'string' && /^[a-z0-9-]{1,64}$/.test(value.theme);
  return value.kind === 'free_spins' && game(value.gameId) && count(value.count) && value.count > 0
    && integer(value.stakeUnits) && BigInt(value.stakeUnits) > 0n;
}
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
    if (row.reward && !validLevelReward(row.reward)) return false;
  }
  if(value.levels[0].xp!=='0'||value.level!==value.levels.filter((l:any)=>BigInt(l.xp)<=BigInt(value.xp)).at(-1)?.level)return false;
  if (value.skinGrants !== undefined && (!Array.isArray(value.skinGrants) || value.skinGrants.length > 100
    || !value.skinGrants.every((r: any) => object(r) && uuid(r.id) && validLevelReward({ ...r, kind: 'skin_generation' })
      && count(r.remaining) && r.remaining <= r.count && Number.isInteger(r.level) && r.level >= 1 && r.level <= 100 && r.currency === value.currency))) return false;
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
export const LEGACY_PROGRESSION_POLICY: ProgressionPolicy<ExperienceSource, FreeSpinReward> = {
  version: 'location-levels-v1', coefficients: { 'paid-game': { numerator: 1, denominator: 1 }, pvp: { numerator: 1, denominator: 1 } },
  levels: Array.from({ length: 100 }, (_, i): ProgressionLevel<FreeSpinReward> => {
    const xp = (100000000n * BigInt(i) ** 3n + 99n ** 3n - 1n) / (99n ** 3n);
    const level = i + 1;
    const tier = level >= 100 ? 4 : level >= 75 ? 3 : level >= 50 ? 2 : level >= 25 ? 1 : 0;
    const counts = [5, 8, 12, 20, 40], stakes = ['100000', '200000', '500000', '1000000', '2000000'];
    return { level, xp: String(xp), ...(level % 5 === 0 ? { reward: { kind: 'free_spins', gameId: level % 10 === 0 ? 'royal-fruits' : 'royal-coins', count: counts[tier], stakeUnits: stakes[tier] } as FreeSpinReward } : {}) };
  }),
};

export const DEFAULT_PROGRESSION_POLICY: ProgressionPolicy = {
  version: 'location-levels-v2', coefficients: structuredClone(LEGACY_PROGRESSION_POLICY.coefficients),
  levels: LEGACY_PROGRESSION_POLICY.levels.map(row => {
    if (!row.reward) return { level: row.level, xp: row.xp };
    const stake = row.level === 100 ? '50000000' : row.level >= 75 ? '20000000' : row.level >= 50 ? '10000000'
      : row.level >= 25 ? '5000000' : row.level === 20 ? '3000000' : row.level === 15 ? '2000000' : row.level === 10 ? '1000000' : '500000';
    return { level: row.level, xp: row.xp, reward: { kind: 'bundle', rewards: [
      { ...row.reward, stakeUnits: stake }, { kind: 'skin_generation', count: 1, theme: PROGRESSION_LOCATION, variantCount: 2 },
    ] } as RewardBundle };
  }),
};

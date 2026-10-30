import type { PostgresDatabase } from '../database';
import type { ExperienceSource, FreeSpinReward, ProgressionReward } from '../../src/shared/progression';
import type { RoundContext, SettledExperience } from './store';

/** Source handlers normalize domain facts into fixed units: 10,000 units are one unweighted XP. */
export interface ExperienceHandler<S extends string> {
  eligible(context: RoundContext<S>): boolean;
  valid(event: SettledExperience<S>): boolean;
  basisUnits(event: SettledExperience<S>): bigint;
  identity(event: SettledExperience<S>): string;
}
export type MilestoneClaim = { id: string; accountId: string; locationId: string; environment: string;
  milestoneId: string; policyVersion: string; level: number; createdAt: number };
/** Handlers write only transactional database resources; external fulfilment needs its own durable job. */
export interface RewardHandler<R extends ProgressionReward> {
  valid(definition: R): boolean;
  issue(db: PostgresDatabase, claim: MilestoneClaim, definition: R): Promise<void>;
  audit(db: PostgresDatabase, claim: MilestoneClaim, definition: R): Promise<boolean>;
}
export type ProgressionHandlers<S extends string, R extends ProgressionReward> = {
  sources: { [K in S]: ExperienceHandler<K> };
  rewards: { [K in R['kind']]: RewardHandler<Extract<R, { kind: K }>> };
};
const units = (v: unknown): v is string => typeof v === 'string' && /^(0|[1-9]\d{0,29})$/.test(v);
const cash: ExperienceHandler<ExperienceSource> = {
  eligible: context => context.fundingSource === 'cash',
  valid: event => units(event.paidUnits) && units(event.refundedUnits) && BigInt(event.refundedUnits) <= BigInt(event.paidUnits),
  basisUnits: event => event.outcome === 'refunded' ? 0n : BigInt(event.paidUnits) - BigInt(event.refundedUnits),
  identity: event => JSON.stringify([event.paidUnits, event.refundedUnits, event.outcome]),
};
export const freeSpinRewardHandler: RewardHandler<FreeSpinReward> = {
  valid: r => r.kind === 'free_spins' && ['royal-coins', 'royal-fruits'].includes(r.gameId) && Number.isInteger(r.count) && r.count >= 1 && r.count <= 10000
    && units(r.stakeUnits) && BigInt(r.stakeUnits) >= 100000n && BigInt(r.stakeUnits) <= 2000000n && BigInt(r.stakeUnits) % 10000n === 0n,
  async issue(db, c, r) {
    await db.prepare('INSERT INTO progression_rewards VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(c.id, c.accountId, c.locationId,
      c.milestoneId, c.policyVersion, 'free_spins', c.level, r.gameId, r.count, r.count, r.stakeUnits, c.environment, 1, c.createdAt);
  },
  async audit(db, c, r) {
    const grant = await db.prepare('SELECT * FROM progression_rewards WHERE id=?').get(c.id);
    return !!grant && grant.account_id === c.accountId && grant.location_id === c.locationId && grant.currency === c.environment
      && grant.milestone_id === c.milestoneId && grant.policy_version === c.policyVersion && Number(grant.level) === c.level
      && grant.type === 'free_spins' && grant.game_id === r.gameId && Number(grant.count) === r.count && grant.nominal_units === r.stakeUnits && Number(grant.rules_version) === 1;
  },
};
/** Existing registered handlers retain their semantics; new domains add named handlers explicitly. */
export const DEFAULT_PROGRESSION_HANDLERS: ProgressionHandlers<ExperienceSource, FreeSpinReward> = {
  sources: { 'paid-game': cash, pvp: cash }, rewards: { free_spins: freeSpinRewardHandler },
};

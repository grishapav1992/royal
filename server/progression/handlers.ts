import type { PostgresDatabase } from '../database';
import type { ExperienceSource, FreeSpinReward, ProgressionReward, SkinGenerationReward, RewardBundle, LevelReward } from '../../src/shared/progression';
import type { RoundContext, SettledExperience } from './store';
import { FREE_SPIN_NOMINAL_UNITS } from '../../src/shared/progression';

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
    && units(r.stakeUnits) && (FREE_SPIN_NOMINAL_UNITS as readonly string[]).includes(r.stakeUnits),
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
export const skinGenerationRewardHandler: RewardHandler<SkinGenerationReward> = {
  valid: r => r.kind === 'skin_generation' && Number.isInteger(r.count) && r.count >= 1 && r.count <= 10000
    && r.theme === 'south-park' && r.variantCount === 2,
  async issue(db, c, r) {
    await db.prepare('INSERT INTO progression_skin_rewards VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(c.id,c.accountId,c.locationId,
      c.milestoneId,c.policyVersion,c.level,r.theme,r.variantCount,r.count,r.count,c.environment,c.createdAt);
  },
  async audit(db, c, r) {
    const grant=await db.prepare('SELECT * FROM progression_skin_rewards WHERE id=?').get(c.id);
    return !!grant && grant.account_id===c.accountId && grant.location_id===c.locationId && grant.currency===c.environment
      && grant.milestone_id===c.milestoneId && grant.policy_version===c.policyVersion && Number(grant.level)===c.level
      && grant.theme===r.theme && Number(grant.variant_count)===r.variantCount && Number(grant.count)===r.count;
  },
};
const leafHandler = (r: FreeSpinReward | SkinGenerationReward): RewardHandler<any> => r.kind === 'free_spins' ? freeSpinRewardHandler : skinGenerationRewardHandler;
const bundleHandler: RewardHandler<RewardBundle> = {
  valid: r => r.kind==='bundle' && Array.isArray(r.rewards) && r.rewards.length>=1 && r.rewards.length<=2
    && new Set(r.rewards.map(v=>v.kind)).size===r.rewards.length
    && r.rewards.every(v=>!!v && ['free_spins','skin_generation'].includes(v.kind) && leafHandler(v).valid(v)),
  async issue(db,c,r) { for(const reward of r.rewards)await leafHandler(reward).issue(db,c,reward); },
  async audit(db,c,r) { for(const reward of r.rewards)if(!await leafHandler(reward).audit(db,c,reward))return false;return true; },
};
/** Existing registered handlers retain their semantics; new domains add named handlers explicitly. */
export const DEFAULT_PROGRESSION_HANDLERS: ProgressionHandlers<ExperienceSource, LevelReward> = {
  sources: { 'paid-game': cash, pvp: cash }, rewards: { free_spins: freeSpinRewardHandler, skin_generation: skinGenerationRewardHandler, bundle: bundleHandler },
};

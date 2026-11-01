import { createHash, randomInt } from 'node:crypto';
import { gameAccountId, nileUnits } from '../../src/shared/nileWallet';
import { FREE_SPIN_NOMINAL_UNITS, REWARD_SPIN_POOLS, validProgressionAccount, type RewardSpinRequest, type RewardSpinResult } from '../../src/shared/progression';
import { demoBalanceUnits, demoReservedUnits, MAX_DEMO_UNITS, recordDemoUnits, saveDemoUnits } from '../demoWalletAmounts';
import type { PostgresDatabase } from '../database';
import type { DemoWalletStore } from '../demoWallet';
import { NilePlayError } from '../finance/nile-play-error';
import type { NilePlayLedger } from '../finance/nile-play-ledger';
import { prepareGame, verifyGameRound } from '../games/core';
import type { ProgressionStore } from './store';

const fail = (code: string, status = 409): never => { throw new NilePlayError(code, status); };
const unitsPerCent = 10_000n;
type StoredSpin = Omit<RewardSpinResult, 'wallet' | 'replayed'>;
type SpinRequest = RewardSpinRequest;

function requestFor(accountId: string, value: unknown): SpinRequest {
  const request = value as SpinRequest;
  if (!validProgressionAccount(accountId) || !request || typeof request !== 'object' || Array.isArray(request)
    || !['grantId,id','gameId,grantId,id'].includes(Object.keys(request).sort().join(',')) || !gameAccountId(request.id)
    || request.gameId !== undefined && !['royal-coins','royal-fruits'].includes(request.gameId)
    || typeof request.grantId !== 'string' || request.grantId.length < 1 || request.grantId.length > 256
    || /[\u0000-\u001f]/.test(request.grantId)) return fail('invalid_reward_spin_request', 400);
  return request;
}

async function useSchema(db: PostgresDatabase) {
  await db.exec(`CREATE TABLE IF NOT EXISTS progression_spin_uses (
    account_id TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    grant_id TEXT NOT NULL REFERENCES progression_rewards(id),
    result_json TEXT NOT NULL CHECK(jsonb_typeof(result_json::jsonb)='object'),
    money_request_hash TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    PRIMARY KEY(account_id,operation_id));
    CREATE INDEX IF NOT EXISTS progression_spin_uses_grant ON progression_spin_uses(grant_id);
    CREATE INDEX IF NOT EXISTS progression_spin_uses_account_time ON progression_spin_uses(account_id,created_at);`);
}

async function previousSpin(db: PostgresDatabase, accountId: string, request: SpinRequest): Promise<StoredSpin | null> {
  const previous = await db.prepare('SELECT grant_id,result_json FROM progression_spin_uses WHERE account_id=? AND operation_id=?')
    .get(accountId, request.id);
  if (!previous) return null;
  if (previous.grant_id !== request.grantId) return fail('play_idempotency_conflict');
  const saved = JSON.parse(String(previous.result_json)) as StoredSpin;
  if (saved.gameId !== request.gameId) return fail('play_idempotency_conflict');
  if (saved.id !== request.id || saved.grantId !== request.grantId || !verifyGameRound(saved.gameRound)
    || !nileUnits(saved.payoutUnits) || BigInt(saved.payoutUnits) !== BigInt(saved.gameRound.payoutUnits) * unitsPerCent)
    throw Error('Invalid stored reward spin');
  return saved;
}

async function gameForGrant(db: PostgresDatabase, accountId: string, request: SpinRequest, currency: string) {
  const grant = await db.prepare('SELECT * FROM progression_rewards WHERE id=? AND account_id=?').get(request.grantId, accountId);
  if (!grant || grant.type !== 'free_spins') return fail('reward_unavailable', 404);
  if (Number(grant.remaining) < 1) return fail('reward_spins_exhausted');
  const pool = grant.pool_id && Object.hasOwn(REWARD_SPIN_POOLS, String(grant.pool_id))
    ? REWARD_SPIN_POOLS[grant.pool_id as keyof typeof REWARD_SPIN_POOLS] : undefined;
  const choice = pool?.find(g => g.gameId === request.gameId);
  if (grant.pool_id && (!choice || grant.game_id !== '')) return fail('reward_game_unavailable');
  if (!grant.pool_id && (!['royal-coins', 'royal-fruits'].includes(String(grant.game_id))
    || request.gameId !== undefined && request.gameId !== grant.game_id)) return fail('reward_game_unavailable');
  if (grant.currency !== currency
    || Number(grant.rules_version) !== 1 || !nileUnits(grant.nominal_units)) return fail('reward_rules_unavailable');
  const nominal = BigInt(String(grant.nominal_units));
  if (!(FREE_SPIN_NOMINAL_UNITS as readonly string[]).includes(String(nominal))) return fail('reward_rules_unavailable');
  return { grant, nominal, game: prepareGame(choice?.gameId ?? String(grant.game_id), choice?.rulesVersion ?? Number(grant.rules_version), {}) };
}

/** Durable per-account rate bound, shared by games, tabs and backend instances. Replays bypass it. */
async function rateLimit(db: PostgresDatabase, accountId: string, now: number) {
  const recent = await db.prepare('SELECT count(*) AS n FROM progression_spin_uses WHERE account_id=? AND created_at>?').get(accountId, now - 60000);
  if (Number(recent?.n) >= 120) return fail('reward_spin_rate_limit', 429);
}

async function consume(db: PostgresDatabase, accountId: string, request: SpinRequest) {
  const changed = await db.prepare('UPDATE progression_rewards SET remaining=remaining-1 WHERE id=? AND account_id=? AND remaining>0')
    .run(request.grantId, accountId);
  if (changed.changes !== 1) return fail('reward_spins_exhausted');
}

async function saveUse(db: PostgresDatabase, accountId: string, result: StoredSpin, requestHash: string, now: number) {
  await db.prepare('INSERT INTO progression_spin_uses(account_id,operation_id,grant_id,result_json,money_request_hash,created_at) VALUES(?,?,?,?,?,?)')
    .run(accountId, result.id, result.grantId, JSON.stringify(result), requestHash, now);
}

/** Reward rights are consumed with their result and the existing financial journal, never a separate balance. */
export class FreeSpinService {
  readonly ready: Promise<void>;
  constructor(private ledger: NilePlayLedger, private progression: Pick<ProgressionStore, 'ready' | 'spinsEnabled'>,
    private draw: (max: number) => number = randomInt, private now = Date.now) {
    this.ready = Promise.all([ledger.ready, progression.ready]).then(() => ledger.db.transaction(() => useSchema(ledger.db)));
  }

  async spin(accountId: string, value: unknown): Promise<RewardSpinResult> {
    const request = requestFor(accountId, value);
    await this.ready;
    return this.ledger.nativeTransaction(accountId, async context => {
      // Check the original operation before grant exhaustion, feature switches or reserve freshness.
      const previous = await previousSpin(this.ledger.db, accountId, request);
      if (previous) return { ...previous, wallet: await this.ledger.wallet(accountId), replayed: true };
      await rateLimit(this.ledger.db, accountId, this.now());
      if (!await this.progression.spinsEnabled()) return fail('reward_spins_paused');
      if (!context.ready) return fail('play_source_not_ready', 503);
      const { grant, nominal, game } = await gameForGrant(this.ledger.db, accountId, request, 'USDT_NILE_TEST');
      const maximumPayout = nominal * BigInt(game.maxMultiplier);
      // With a promotional stake the whole payout is funded by the house, including its nominal part.
      if (context.house < maximumPayout) return fail('play_reserve_insufficient');
      if (context.available + context.reserved + maximumPayout > BigInt(MAX_DEMO_UNITS) * unitsPerCent)
        return fail('reward_wallet_capacity');
      const gameRound = game.play(nominal / unitsPerCent, this.draw);
      if (!verifyGameRound(gameRound)) throw Error('Invalid reward game result');
      const payoutUnits = BigInt(gameRound.payoutUnits) * unitsPerCent;
      const remaining = Number(grant.remaining) - 1;
      const result: StoredSpin = { ...request, gameRound, payoutUnits: String(payoutUnits), remaining };
      await consume(this.ledger.db, accountId, request);
      const requestHash = createHash('sha256').update(JSON.stringify({ fundingSource: 'reward', accountId, ...result })).digest('hex');
      // A zero payout is journalled too, linking every consumed right to a financial operation.
      await context.post(context.available + payoutUnits, context.reserved, requestHash);
      await saveUse(this.ledger.db, accountId, result, requestHash, this.now());
      return { ...result, wallet: await this.ledger.wallet(accountId), replayed: false };
    }, this.now());
  }
}

/** The live site's virtual USD wallet remains the single authority for cash and reward payouts. */
export class LiveFreeSpinService {
  readonly ready: Promise<void>;
  constructor(private db: PostgresDatabase, private common: DemoWalletStore,
    private progression: Pick<ProgressionStore, 'ready' | 'spinsEnabled'>,
    private draw: (max: number) => number = randomInt, private now = Date.now,
    private beforeNewSpin?: (accountId: string) => Promise<void>) {
    this.ready = Promise.all([common.ready, progression.ready]).then(() => db.transaction(() => useSchema(db)));
  }

  async spin(accountId: string, value: unknown): Promise<RewardSpinResult> {
    const request = requestFor(accountId, value);
    await this.ready;
    return this.db.transaction(async () => {
      const previous = await previousSpin(this.db, accountId, request);
      if (previous) return { ...previous, wallet: await this.common.snapshotInTransaction(accountId), replayed: true };
      await rateLimit(this.db, accountId, this.now());
      await this.beforeNewSpin?.(accountId);
      if (!await this.progression.spinsEnabled()) return fail('reward_spins_paused');
      const { grant, nominal, game } = await gameForGrant(this.db, accountId, request, 'VIRTUAL_USD');
      const balance = await demoBalanceUnits(this.db, accountId), reserved = await demoReservedUnits(this.db, accountId);
      const maximumPayout = nominal / unitsPerCent * BigInt(game.maxMultiplier);
      if (BigInt(balance) + BigInt(reserved) + maximumPayout > BigInt(MAX_DEMO_UNITS)) return fail('reward_wallet_capacity');
      const gameRound = game.play(nominal / unitsPerCent, this.draw);
      if (!verifyGameRound(gameRound)) throw Error('Invalid reward game result');
      const payout = Number(BigInt(gameRound.payoutUnits));
      const result: StoredSpin = { ...request, gameRound,
        payoutUnits: String(BigInt(gameRound.payoutUnits) * unitsPerCent), remaining: Number(grant.remaining) - 1 };
      await consume(this.db, accountId, request);
      await saveDemoUnits(this.db, accountId, balance + payout);
      await recordDemoUnits(this.db, accountId, 'reward:' + request.id, 'win', payout, balance + payout,
        'reward:' + gameRound.gameId, gameRound.gameId === 'royal-coins' ? 'Royal Coins' : 'Royal Fruits');
      const requestHash = createHash('sha256').update(JSON.stringify({ fundingSource: 'reward', accountId, ...result })).digest('hex');
      await saveUse(this.db, accountId, result, requestHash, this.now());
      return { ...result, wallet: await this.common.snapshotInTransaction(accountId), replayed: false };
    }, { lockKey: 'account:' + accountId });
  }
}

import type { Pool, PoolClient } from 'pg';
import { amountUnits, FinanceError, SIMULATED_ASSET } from './amount';
import { FINANCE_SCHEMA, FINANCE_SCHEMA_VERSION } from './schema';
import { FINANCE_DEPOSIT_MIGRATION } from './deposit-schema';
import { FINANCE_HARDENING_MIGRATION } from './hardening-schema';
import { ROLE_SAFETY_SQL, roleViolations } from './role-safety';

export type OperationKind = 'simulate_deposit' | 'simulate_capital' | 'transfer' | 'reserve_withdrawal'
  | 'cancel_withdrawal' | 'simulate_withdrawal_unknown' | 'simulate_withdrawal_confirm'
  | 'reserve_game' | 'settle_game' | 'cancel_game';
export type OperationResult = { operationId: string; journalId: string | null; kind: OperationKind; asset: typeof SIMULATED_ASSET; environment: 'simulation' };
export type WalletSnapshot = {
  userId: string; asset: typeof SIMULATED_ASSET; environment: 'simulation'; scale: number;
  availableUnits: string; withdrawalReservedUnits: string; gameReservedUnits: string;
};
const fields: Record<OperationKind, readonly string[]> = {
  simulate_deposit: ['userId', 'eventId', 'amountUnits'],
  simulate_capital: ['amountUnits'], transfer: ['recipientId', 'amountUnits'],
  reserve_withdrawal: ['withdrawalId', 'destination', 'amountUnits', 'feeUnits'],
  cancel_withdrawal: ['withdrawalId'], simulate_withdrawal_unknown: ['withdrawalId'],
  simulate_withdrawal_confirm: ['withdrawalId'], reserve_game: ['roundId', 'stakeUnits', 'maxPayoutUnits'],
  settle_game: ['roundId', 'payoutUnits'], cancel_game: ['roundId'],
};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function financeIdentity(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) {
    throw new FinanceError(400, 'invalid_identity', 'Некорректный идентификатор.');
  }
  return value;
}
function validate(kind: OperationKind, body: unknown): Record<string, string> {
  if (!Object.hasOwn(fields, kind) || !body || typeof body !== 'object' || Array.isArray(body)) {
    throw new FinanceError(400, 'invalid_operation', 'Некорректная операция.');
  }
  const input = body as Record<string, unknown>, keys = Object.keys(input), expected = fields[kind];
  if (keys.length !== expected.length || keys.some(key => !expected.includes(key)) || expected.some(key => typeof input[key] !== 'string')) {
    throw new FinanceError(400, 'invalid_fields', 'Некорректные поля операции.');
  }
  const result: Record<string, string> = {};
  for (const key of expected) {
    const value = input[key] as string;
    if (key.endsWith('Units')) result[key] = amountUnits(value, key === 'feeUnits' || key === 'payoutUnits');
    else if (['roundId', 'withdrawalId', 'eventId'].includes(key)) {
      if (!uuid.test(value)) throw new FinanceError(400, 'invalid_id', 'Идентификатор операции должен быть UUID.');
      result[key] = value.toLowerCase();
    } else if (key === 'destination') {
      if (!/^simulation:[a-zA-Z0-9_-]{1,100}$/.test(value)) {
        throw new FinanceError(400, 'simulation_only', 'Разрешены только адреса simulation:имя.');
      }
      result[key] = value;
    } else result[key] = financeIdentity(value);
  }
  return result;
}
export function databaseError(error: unknown): Error {
  if (error instanceof FinanceError) return error;
  const code = (error as { code?: string })?.code;
  const messages: Record<string, [number, string, string]> = {
    P4000: [400, 'invalid_operation', 'Некорректные параметры операции.'],
    '22P02': [400, 'invalid_operation', 'Некорректные параметры операции.'],
    P4030: [403, 'forbidden', 'Операция не разрешена.'],
    P4040: [404, 'not_found', 'Финансовый счёт или операция не найдены.'],
    P4090: [409, 'conflict', 'Недостаточно средств, превышен лимит или операция конфликтует с сохранённым состоянием.'],
    '23505': [409, 'duplicate_source', 'Источник операции или её идентификатор уже использован.'],
    '23514': [400, 'constraint_violation', 'Операция нарушает ограничения финансового учёта.'],
    '23503': [404, 'not_found', 'Связанный финансовый счёт не найден.'],
    '40P01': [503, 'retry_later', 'Операцию можно повторить с тем же ключом.'],
    '40001': [503, 'retry_later', 'Операцию можно повторить с тем же ключом.'],
    '57014': [503, 'retry_later', 'Результат не подтверждён. Повтори запрос с тем же ключом.'],
    '55P03': [503, 'retry_later', 'Операцию можно повторить с тем же ключом.'],
  };
  const match = code && messages[code];
  return match ? new FinanceError(...match) : new FinanceError(503, 'unconfirmed', 'Результат не подтверждён. Проверь операцию или повтори с тем же ключом.');
}

export async function migrateFinance(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('royal-finance-migration',0))");
    const exists = await client.query("SELECT to_regclass('royal_finance.meta') AS name");
    if (!exists.rows[0].name) await client.query(FINANCE_SCHEMA);
    let meta = await client.query('SELECT * FROM royal_finance.meta');
    if (meta.rows.length === 1 && meta.rows[0].version === 1 && meta.rows[0].environment === 'simulation'
      && meta.rows[0].asset === SIMULATED_ASSET && meta.rows[0].scale === 6) {
      await client.query(FINANCE_DEPOSIT_MIGRATION);
      meta = await client.query('SELECT * FROM royal_finance.meta');
    }
    if (meta.rows.length === 1 && meta.rows[0].version === 2 && meta.rows[0].environment === 'simulation'
      && meta.rows[0].asset === SIMULATED_ASSET && meta.rows[0].scale === 6) {
      await client.query(FINANCE_HARDENING_MIGRATION);
      await client.query(ROLE_SAFETY_SQL);
      meta = await client.query('SELECT * FROM royal_finance.meta');
    }
    if (meta.rows.length !== 1 || meta.rows[0].version !== FINANCE_SCHEMA_VERSION || meta.rows[0].environment !== 'simulation') {
      throw new Error('Unsupported financial schema');
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export class FinanceStore {
  constructor(readonly pool: Pool) {}

  async checkRuntimeRole() {
    const meta = await this.pool.query('SELECT * FROM royal_finance.meta');
    if (await roleViolations(this.pool, 'runtime') !== 0) {
      throw new Error('Financial runtime requires a restricted database role');
    }
    if (meta.rows.length !== 1 || meta.rows[0].version !== FINANCE_SCHEMA_VERSION || meta.rows[0].asset !== SIMULATED_ASSET || meta.rows[0].environment !== 'simulation') {
      throw new Error('Financial runtime requires the simulation schema');
    }
  }

  async createUser(userId: unknown) {
    const id = financeIdentity(userId);
    if (['system', 'simulator', 'game-simulator'].includes(id)) throw new FinanceError(400, 'invalid_identity', 'Идентификатор зарезервирован.');
    try { await this.pool.query('SELECT royal_finance.create_user($1)', [id]); }
    catch (error) { throw databaseError(error); }
    return this.snapshot(id);
  }

  async execute(actor: unknown, key: unknown, kind: OperationKind, body: unknown): Promise<OperationResult> {
    const identity = financeIdentity(actor);
    if (typeof key !== 'string' || !uuid.test(key)) throw new FinanceError(400, 'invalid_key', 'Нужен UUID ключа идемпотентности.');
    const normalized = validate(kind, body);
    for (let attempt = 0; ; attempt++) {
      try {
        const { rows } = await this.pool.query('SELECT royal_finance.execute($1,$2::uuid,$3,$4::jsonb) AS result', [identity, key, kind, JSON.stringify(normalized)]);
        return rows[0].result;
      } catch (error) {
        if (attempt < 2 && ['40P01', '40001'].includes((error as { code?: string }).code ?? '')) continue;
        throw databaseError(error);
      }
    }
  }

  async snapshot(userId: unknown): Promise<WalletSnapshot> {
    const id = financeIdentity(userId);
    const { rows } = await this.pool.query('SELECT bucket,balance::text FROM royal_finance.accounts WHERE owner_id=$1', [id]);
    if (rows.length !== 3 || rows.some(row => !['available', 'withdrawal_reserved', 'game_reserved'].includes(row.bucket))) {
      throw new FinanceError(404, 'not_found', 'Финансовый пользователь не найден.');
    }
    const balances = Object.fromEntries(rows.map(row => [row.bucket, row.balance]));
    return { userId: id, asset: SIMULATED_ASSET, environment: 'simulation', scale: 6,
      availableUnits: balances.available, withdrawalReservedUnits: balances.withdrawal_reserved, gameReservedUnits: balances.game_reserved };
  }

  async depositAddress(userId: unknown) {
    const id = financeIdentity(userId);
    try {
      const { rows } = await this.pool.query('SELECT royal_finance.deposit_address($1) AS address', [id]);
      return rows[0].address as { network: 'tron-sim-v1'; address: string; asset: 'USDT_SIM'; token: string; scale: 6; environment: 'simulation' };
    } catch (error) { throw databaseError(error); }
  }

  async operation(actor: unknown, key: unknown) {
    const identity = financeIdentity(actor);
    if (typeof key !== 'string' || !uuid.test(key)) throw new FinanceError(400, 'invalid_key', 'Нужен UUID ключа идемпотентности.');
    const { rows } = await this.pool.query('SELECT result FROM royal_finance.requests WHERE actor=$1 AND key=$2::uuid', [identity, key]);
    if (!rows.length) throw new FinanceError(404, 'not_found', 'Операция не найдена.');
    return rows[0].result as OperationResult;
  }

  async history(userId: unknown, limit = 50) {
    const id = financeIdentity(userId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new FinanceError(400, 'invalid_limit', 'Некорректный лимит.');
    await this.snapshot(id);
    const { rows } = await this.pool.query(`SELECT j.id,j.kind,j.created_at,a.bucket,e.delta::text
      FROM royal_finance.entries e JOIN royal_finance.journals j ON j.id=e.journal_id
      JOIN royal_finance.accounts a ON a.id=e.account_id WHERE a.owner_id=$1
      ORDER BY j.created_at DESC,j.id,e.position LIMIT $2`, [id, limit]);
    return rows;
  }

  async reconcile() {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const { rows } = await client.query(`WITH ledger_totals AS MATERIALIZED
        (SELECT account_id,sum(delta) AS total FROM royal_finance.entries GROUP BY account_id),
        journal_totals AS (SELECT journal_id,sum(delta) AS total,count(*) AS n FROM royal_finance.entries GROUP BY journal_id)
        SELECT
        (SELECT count(*) FROM royal_finance.accounts a LEFT JOIN ledger_totals e ON e.account_id=a.id
          WHERE a.balance<>coalesce(e.total,0))::int AS mismatched_accounts,
        (SELECT count(*) FROM royal_finance.account_totals t FULL JOIN royal_finance.accounts a ON a.id=t.account_id
          LEFT JOIN ledger_totals e ON e.account_id=t.account_id
          WHERE a.id IS NULL OR t.account_id IS NULL OR a.balance IS DISTINCT FROM t.balance
          OR t.balance IS DISTINCT FROM coalesce(e.total,0))::int AS mismatched_totals,
        royal_finance.role_safety(current_user,'runtime') AS unsafe_runtime_roles,
        (SELECT count(*) FROM royal_finance.journals j LEFT JOIN journal_totals e ON e.journal_id=j.id
          WHERE e.n IS NULL OR e.n<2 OR e.total<>0)::int AS unbalanced_journals,
        (SELECT count(*) FROM royal_finance.accounts WHERE bucket <> 'assets' AND balance < 0)::int AS negative_accounts,
        (SELECT coalesce(sum(balance),0)::text FROM royal_finance.accounts) AS net_units,
        (SELECT (-balance)::text FROM royal_finance.accounts WHERE bucket='assets') AS assets_units,
        (SELECT coalesce(sum(balance),0)::text FROM royal_finance.accounts WHERE owner_id <> 'system') AS user_liabilities_units,
        (SELECT balance::text FROM royal_finance.accounts WHERE bucket='house_available') AS house_available_units,
        (SELECT balance::text FROM royal_finance.accounts WHERE bucket='house_reserved') AS house_reserved_units,
        (SELECT count(*) FROM royal_finance.requests q LEFT JOIN royal_finance.outbox o ON o.actor=q.actor AND o.request_key=q.key WHERE o.id IS NULL)::int AS missing_outbox,
        (SELECT count(*) FROM royal_finance.deposit_events e LEFT JOIN royal_finance.requests r ON r.actor='simulator' AND r.key=e.request_key
          WHERE e.disposition='credited' AND (r.key IS NULL OR r.kind<>'simulate_deposit'
            OR r.body->>'eventId' IS DISTINCT FROM e.event_id::text OR r.body->>'userId' IS DISTINCT FROM e.user_id
            OR r.body->>'amountUnits' IS DISTINCT FROM e.amount::text))::int AS deposit_credit_mismatches,
        (SELECT count(*) FROM royal_finance.deposit_streams s WHERE
          s.cursor_height<>(SELECT count(*) FROM royal_finance.deposit_blocks b WHERE b.network=s.network)
          OR s.cursor_height<>(SELECT coalesce(max(height),0) FROM royal_finance.deposit_blocks b WHERE b.network=s.network)
          OR s.cursor_hash IS DISTINCT FROM coalesce((SELECT hash FROM royal_finance.deposit_blocks b
            WHERE b.network=s.network AND b.height=s.cursor_height),repeat('0',64)))::int AS deposit_cursor_mismatches,
        (SELECT count(*) FROM royal_finance.deposit_streams WHERE halted_reason IS NOT NULL)::int AS deposit_halted_streams`);
      const reservationMismatches = await this.reservationMismatches(client);
      await client.query('COMMIT');
      const state = rows[0];
      return { environment: 'simulation' as const, asset: SIMULATED_ASSET,
        ok: state.mismatched_accounts === 0 && state.unbalanced_journals === 0 && state.negative_accounts === 0
          && state.missing_outbox === 0 && state.net_units === '0' && reservationMismatches === 0
          && state.deposit_credit_mismatches === 0 && state.deposit_cursor_mismatches === 0
          && state.mismatched_totals === 0 && state.unsafe_runtime_roles === 0,
        ...state, reservation_mismatches: reservationMismatches };
    } catch (error) { await client.query('ROLLBACK'); throw databaseError(error); }
    finally { client.release(); }
  }

  private async reservationMismatches(client: PoolClient): Promise<number> {
    const { rows } = await client.query(`WITH withdrawal_totals AS
      (SELECT user_id,sum(amount+fee) AS units FROM royal_finance.withdrawals WHERE status IN ('reserved','unknown') GROUP BY user_id),
      round_totals AS (SELECT user_id,sum(stake) AS units,sum(max_payout) AS max_units FROM royal_finance.rounds WHERE status='reserved' GROUP BY user_id)
      SELECT count(*)::int AS n FROM royal_finance.accounts a
      LEFT JOIN withdrawal_totals w ON w.user_id=a.owner_id LEFT JOIN round_totals r ON r.user_id=a.owner_id WHERE
      (a.bucket='withdrawal_reserved' AND a.balance<>coalesce(w.units,0)) OR
      (a.bucket='game_reserved' AND a.balance<>coalesce(r.units,0)) OR
      (a.bucket='house_reserved' AND a.balance<>(SELECT coalesce(sum(max_units),0) FROM round_totals))`);
    return rows[0].n;
  }
}

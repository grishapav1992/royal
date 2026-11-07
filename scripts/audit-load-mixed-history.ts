import { randomUUID } from 'node:crypto';
import { AUDIT_SUMMARY_SCAN_CAP, type SummaryReport } from '../server/audit/report-summary-source';
import type { PostgresDatabase } from '../server/database';
import { MAX_DEMO_UNITS } from '../server/demoWalletAmounts';
import { drawToteOrder } from '../server/flagTote';
import { prepareGame, verifyGameRound } from '../server/games/core';
import { settleFlagTote, TOTE_TIMING } from '../src/shared/flagTote';
import { pvpPayout } from '../src/shared/pvp';
import { coreExactAward, makeRoundPrecision } from '../src/shared/roundPrecision';

export const mixedHistoryAccountCount = 17;
export const auditReportMonthMs = 30 * 24 * 60 * 60 * 1000;
const poolRounds = 320;

export function auditMixedHistoryPeriod(startedAtMs: number, month = false) {
  const sentinelAt = Math.floor(startedAtMs / TOTE_TIMING.period) * TOTE_TIMING.period;
  return { fromMs: month ? sentinelAt + 1 - auditReportMonthMs : sentinelAt - poolRounds * TOTE_TIMING.period,
    toMs: sentinelAt + 1 };
}

type Category = 'casino' | 'pvp' | 'totalizator';
type Movement = 'deposit' | 'stake' | 'reserve' | 'payout' | 'refund';
type Posting = {
  account_id: string; operation_id: string; created_at: number; source: string;
  entry_type: 'deposit' | 'bet' | 'win' | 'refund'; amount_units: number; category: Category | null; movement: Movement;
};
export type MixedHistoryPosting = Posting & { balance_units: number };
type Total = { category: Category | null; movement: Movement | 'fee'; count: number; amountUnits: number | null; feeUnits: number | null };
type FinalState = 'settled' | 'refunded';
type Bank = { match_id: string; game_id: string; stake_units: number; state: FinalState; winner_id: string | null;
  reason: 'win' | 'draw'; fee_units: number; created_at: number; updated_at: number };
type Hold = { match_id: string; account_id: string; stake_units: number; reserved_units: number; state: FinalState };
type Pool = { id: string; rules_version: number; opened_at: number; closes_at: number; finishes_at: number;
  state: FinalState; outcome: string | null; settlement: string };
type Ticket = { round_id: string; sequence: number; account_id: string; id: string; country: string;
  stake_units: number; payout_units: number };

function totalsFor(postings: readonly Posting[], fees: ReadonlyMap<Category, number>): Total[] {
  const totals = new Map<string, Total>();
  for (const row of postings) {
    const key = `${row.category}/${row.movement}`;
    const total = totals.get(key) ?? { category: row.category, movement: row.movement, count: 0, amountUnits: 0, feeUnits: null };
    total.count++;
    total.amountUnits = (total.amountUnits ?? 0) + row.amount_units;
    totals.set(key, total);
  }
  return [...totals.values(), ...[...fees].map(([category, feeUnits]): Total =>
    ({ category, movement: 'fee', count: 0, amountUnits: null, feeUnits }))];
}

export function matchesMixedHistoryTotals(report: SummaryReport, totals: readonly Total[]) {
  const expected = new Map(totals.map(row => [`${row.category}/${row.movement}`, row]));
  const units = (value: number | null) => value === null ? null : String(value);
  return report.scanned === AUDIT_SUMMARY_SCAN_CAP && report.environment === 'test' &&
    Object.values(report.gaps).every(gap => !gap) && report.rows.every(row => {
      const key = `${row.category}/${row.movement_type}`, total = expected.get(key);
      if (!total || row.posting_count !== String(total.count) || row.amount_units !== units(total.amountUnits) ||
          row.fee_units !== units(total.feeUnits) || row.contour !== 'virtual' || row.asset !== 'VIRTUAL_USD' || row.scale !== '2' ||
          row.reserved_delta_units !== null || row.pending_delta_units !== null || row.confirmed_withdrawal_units !== null ||
          row.coverage_status !== 'complete') return false;
      expected.delete(key);
      return true;
    }) && expected.size === 0;
}

/** Synthetic source rows for an isolated load test. The regular source trigger captures every posting. */
export async function seedMixedAuditHistory(db: PostgresDatabase, accounts: readonly string[], startedAtMs: number,
  playerRows: number, openingUnits: number, retained?: { fromMs: number; playerEndingUnits: number }) {
  const [player, ...others] = accounts;
  if (accounts.length !== mixedHistoryAccountCount) throw new Error('Unexpected mixed audit history accounts');
  const pvpRounds = 1000;
  const { fromMs, toMs } = auditMixedHistoryPeriod(startedAtMs, !!retained);
  const sentinelAt = toMs - 1;
  const spreadAt = (index: number, count: number) => fromMs + Math.floor(index * (sentinelAt - fromMs - 10_000) / count);
  const other = (index: number) => others[index % others.length];
  let entropy = 0x726b131a;
  const draw = (limit: number) => {
    entropy ^= entropy << 13;
    entropy ^= entropy >>> 17;
    entropy ^= entropy << 5;
    return (entropy >>> 0) % limit;
  };
  const postings: Posting[] = [];
  const post = (account_id: string, operation_id: string, created_at: number, source: string, entry_type: Posting['entry_type'],
    amount_units: number, category: Category | null, movement: Movement) => {
    postings.push({ account_id, operation_id, created_at, source, entry_type, amount_units, category, movement });
  };
  const deposit = (accountId: string, at: number, amount: number) =>
    post(accountId, randomUUID(), at, 'royal-coins', 'deposit', amount, null, 'deposit');
  const fees = new Map<Category, number>();
  const fee = (category: Category, units: number) => fees.set(category, (fees.get(category) ?? 0) + units);

  const casino = prepareGame('royal-plinko', 1, { rows: 12, risk: 'easy' });
  const operations: { account_id: string; operation_id: string; amount_units: number; result: string; request_key: string }[] = [];
  for (const { count, account } of [{ count: 3300, account: () => player }, { count: 3000, account: other }]) {
    for (let index = 0; index < count; index++) {
      const accountId = account(index), id = randomUUID(), at = spreadAt(index, count);
      const stake = index % 5 === 0 ? 200 : 100;
      const round = casino.play(BigInt(stake), draw);
      const precision = makeRoundPrecision(coreExactAward(round), round.payoutUnits, draw);
      const gameRound = { ...round, precision, payoutUnits: precision.creditedUnits };
      if (!verifyGameRound(gameRound)) throw new Error('Invalid mixed audit history casino round');
      post(accountId, id, at, casino.gameId, 'bet', -stake, 'casino', 'stake');
      post(accountId, id, at, casino.gameId, 'win', Number(gameRound.payoutUnits), 'casino', 'payout');
      operations.push({ account_id: accountId, operation_id: id, amount_units: stake, result: JSON.stringify({ gameRound }),
        request_key: JSON.stringify(['play', stake / 100, casino.gameId, casino.rulesVersion, casino.input, 1]) });
    }
  }

  const banks: Bank[] = [], holds: Hold[] = [];
  for (let index = 0; index < pvpRounds; index++) {
    const match = randomUUID(), opponent = other(index), at = spreadAt(index, pvpRounds), finalAt = at + 3000 + index % 1000;
    const stake = index % 2 === 0 ? 100 : 200;
    const terms = pvpPayout(String(stake * 10_000));
    const payout = Number(terms.payoutUnits) / 10_000;
    const winner = index % 5 === 0 ? null : index % 5 === 1 ? opponent : player;
    const state = winner ? 'settled' : 'refunded';
    const feeUnits = winner ? Number(terms.feeUnits) / 10_000 : 0;
    banks.push({ match_id: match, game_id: 'chess', stake_units: stake, state, winner_id: winner,
      reason: winner ? 'win' : 'draw', fee_units: feeUnits, created_at: at, updated_at: finalAt });
    for (const accountId of [player, opponent]) {
      holds.push({ match_id: match, account_id: accountId, stake_units: stake, reserved_units: payout, state });
      post(accountId, `pvp:${match}:hold`, at, 'pvp:chess', 'bet', -stake, 'pvp', 'reserve');
      if (winner === null) post(accountId, `pvp:${match}:final`, finalAt, 'pvp:chess', 'refund', stake, 'pvp', 'refund');
    }
    if (winner) {
      post(winner, `pvp:${match}:final`, finalAt, 'pvp:chess', 'win', payout, 'pvp', 'payout');
      fee('pvp', feeUnits);
    }
  }

  const pools: Pool[] = [], tickets: Ticket[] = [];
  const firstPoolAt = Math.ceil(fromMs / TOTE_TIMING.period) * TOTE_TIMING.period;
  const availablePoolPeriods = (sentinelAt - firstPoolAt) / TOTE_TIMING.period;
  for (let index = 0; index < poolRounds; index++) {
    const openedAt = firstPoolAt + Math.floor(index * availablePoolPeriods / poolRounds) * TOTE_TIMING.period;
    const closesAt = openedAt + TOTE_TIMING.betting;
    const finishesAt = closesAt + TOTE_TIMING.race, id = 'ft1-' + openedAt;
    const outcome = drawToteOrder(draw), countries = outcome.order.slice(-4, -1);
    if (index % 5 === 0) countries[2] = countries[0];
    const bets = [player, other(index), other(index + 1)].map((accountId, sequence) =>
      ({ id: randomUUID(), accountId, country: countries[sequence], stakeUnits: ['100', '200', '500'][(index + sequence) % 3] }));
    const settlement = settleFlagTote(bets, outcome.order), paid = settlement.state === 'settled';
    pools.push({ id, rules_version: 1, opened_at: openedAt, closes_at: closesAt, finishes_at: finishesAt, state: settlement.state,
      outcome: paid ? JSON.stringify(outcome) : null, settlement: JSON.stringify({ ...settlement, payouts: [] }) });
    for (const [sequence, bet] of bets.entries()) {
      const payout = Number(settlement.payouts.find(row => row.id === bet.id)?.units);
      if (!Number.isSafeInteger(payout) || payout <= 0) throw new Error('Invalid mixed audit history pool payout');
      tickets.push({ round_id: id, sequence: sequence + 1, account_id: bet.accountId, id: bet.id,
        country: bet.country, stake_units: Number(bet.stakeUnits), payout_units: payout });
      post(bet.accountId, 'flag-tote:' + bet.id, openedAt + 1000 + sequence, 'flag-tote', 'bet', -Number(bet.stakeUnits), 'totalizator', 'stake');
      post(bet.accountId, 'flag-tote:' + id + ':final', paid ? finishesAt : closesAt,
        'flag-tote', paid ? 'win' : 'refund', payout, 'totalizator', paid ? 'payout' : 'refund');
    }
    if (paid) fee('totalizator', Number(settlement.feeUnits));
  }

  const playerCount = postings.filter(row => row.account_id === player).length;
  const deposits = playerRows - playerCount;
  const otherDeposits = AUDIT_SUMMARY_SCAN_CAP - postings.length - deposits;
  if (deposits <= 0 || otherDeposits <= 0) throw new Error('Mixed audit history exceeds the fixture caps');
  for (let index = 0; index < deposits; index++) deposit(player, spreadAt(index, deposits), 500 + (index % 4) * 100);
  for (let index = 0; index < otherDeposits; index++) deposit(other(index), spreadAt(index, otherDeposits), 500 + (index % 3) * 100);
  const totals = totalsFor(postings, fees);
  deposit(other(0), sentinelAt, 100);

  const balances = new Map(accounts.map(accountId => [accountId, openingUnits]));
  if (retained) balances.set(player, retained.playerEndingUnits);
  const ledger = postings.sort((a, b) => a.created_at - b.created_at).map((row, ordinal) => {
    const balance = (balances.get(row.account_id) ?? 0) + row.amount_units;
    if (balance < 0 || balance > MAX_DEMO_UNITS) throw new Error('Mixed audit history balance outside wallet limits');
    balances.set(row.account_id, balance);
    return { ...row, balance_units: balance, ordinal };
  });
  await db.transaction(async () => {
    // Opening funding predates the synthetic event clock. It was recorded before capture was enabled.
    await db.prepare('UPDATE demo_ledger SET created_at=? WHERE account_id=ANY(?::text[]) AND created_at>=?')
      .run((retained?.fromMs ?? fromMs) - 1, accounts, fromMs);
    await db.prepare(`INSERT INTO demo_operations(account_id,operation_id,kind,amount,amount_units,result,request_key)
      SELECT account_id,operation_id,'play',amount_units/100,amount_units,result,request_key
      FROM jsonb_to_recordset(?::jsonb) AS t(account_id text,operation_id text,amount_units integer,result text,request_key text)`)
      .run(JSON.stringify(operations));
    await db.prepare(`INSERT INTO virtual_pvp_banks(match_id,game_id,stake_units,state,winner_id,reason,fee_units,created_at,updated_at)
      SELECT match_id,game_id,stake_units,state,winner_id,reason,fee_units,created_at,updated_at
      FROM jsonb_to_recordset(?::jsonb) AS t(match_id text,game_id text,stake_units bigint,state text,winner_id text,reason text,
        fee_units bigint,created_at bigint,updated_at bigint)`).run(JSON.stringify(banks));
    await db.prepare(`INSERT INTO virtual_pvp_holds(match_id,account_id,stake_units,reserved_units,state)
      SELECT match_id,account_id,stake_units,reserved_units,state
      FROM jsonb_to_recordset(?::jsonb) AS t(match_id text,account_id text,stake_units bigint,reserved_units bigint,state text)`)
      .run(JSON.stringify(holds));
    await db.prepare(`INSERT INTO flag_tote_rounds(id,rules_version,opened_at,closes_at,finishes_at,state,outcome,settlement)
      SELECT id,rules_version,opened_at,closes_at,finishes_at,state,outcome,settlement
      FROM jsonb_to_recordset(?::jsonb) AS t(id text,rules_version integer,opened_at bigint,closes_at bigint,finishes_at bigint,
        state text,outcome text,settlement text)`).run(JSON.stringify(pools));
    await db.prepare(`INSERT INTO flag_tote_tickets(round_id,sequence,account_id,id,country,stake_units,payout_units)
      SELECT round_id,sequence,account_id,id,country,stake_units,payout_units
      FROM jsonb_to_recordset(?::jsonb) AS t(round_id text,sequence integer,account_id text,id text,country text,
        stake_units bigint,payout_units bigint)`).run(JSON.stringify(tickets));
    await db.prepare(`INSERT INTO demo_ledger(account_id,operation_id,kind,amount,balance,created_at,amount_units,balance_units,entry_type,source)
      SELECT account_id,operation_id,CASE WHEN entry_type='refund' THEN 'win' ELSE entry_type END,
        (amount_units/100)::integer,(balance_units/100)::integer,created_at,amount_units,balance_units,entry_type,source
      FROM jsonb_to_recordset(?::jsonb) AS t(account_id text,operation_id text,entry_type text,created_at bigint,
        amount_units bigint,balance_units bigint,source text,ordinal integer) ORDER BY ordinal`).run(JSON.stringify(ledger));
    await db.prepare(`UPDATE demo_wallets w SET balance=(t.units/100)::integer,fraction_units=(t.units%100)::integer
      FROM jsonb_to_recordset(?::jsonb) AS t(account_id text,units bigint) WHERE w.account_id=t.account_id`)
      .run(JSON.stringify([...balances].map(([account_id, units]) => ({ account_id, units }))));
  });
  return { fromMs, toMs, totals, accountCount: accounts.length,
    timestampCount: new Set(ledger.map(row => row.created_at)).size, playerPostings: ledger.filter(row => row.account_id === player) };
}

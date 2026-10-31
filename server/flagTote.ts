import { randomInt } from 'node:crypto';
import type { PostgresDatabase } from './database';
import { WalletError } from './demoWallet';
import { demoBalanceUnits, demoReservedUnits, saveDemoUnits, recordDemoUnits, MAX_DEMO_UNITS } from './demoWalletAmounts';
import { FLAG_COUNTRIES, type FlagCountry } from '../src/shared/flagBattle';
import { TOTE_LIMITS, TOTE_TIMING, settleFlagTote, toteEligible, validToteBet, type ToteMathTicket, type ToteRound, type ToteReply, type ToteSettlement } from '../src/shared/flagTote';
import type { DemoWallet } from '../src/shared/demoWallet';

export function drawToteOrder(draw: (max: number) => number = randomInt) {
  const take = (max: number) => { const n = draw(max); if (!Number.isSafeInteger(n) || n < 0 || n >= max) throw Error('Invalid pool entropy'); return n; };
  const order: FlagCountry[] = FLAG_COUNTRIES.map(c => c.id);
  for (let i = order.length - 1; i > 0; i--) { const j = take(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  return { order, seed: take(2147483648) };
}
export class FlagToteStore {
  readonly ready: Promise<void>;
  constructor(private db: PostgresDatabase, private wallet: (id: string) => Promise<DemoWallet>, prerequisite: Promise<void>, private now: () => number = Date.now, private draw: (max: number) => number = randomInt) { this.ready = prerequisite; }
  private async accountLocks(ids: string[]) {
    for (const id of [...new Set(ids)].sort()) await this.db.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?,0))').get(this.db.schema + ':key:account:' + id);
  }
  private tickets(id: string) { return this.db.prepare('SELECT id,account_id AS "accountId",country,stake_units::text AS "stakeUnits" FROM flag_tote_tickets WHERE round_id=? ORDER BY sequence').all(id) as Promise<ToteMathTicket[]>; }
  private async advanceInTransaction(now: number) {
    const openedAt = Math.floor(now / TOTE_TIMING.period) * TOTE_TIMING.period;
    await this.db.prepare("INSERT INTO flag_tote_rounds(id,rules_version,opened_at,closes_at,finishes_at,state) VALUES(?,1,?,?,?,'open') ON CONFLICT(id) DO NOTHING")
      .run('ft1-' + openedAt, openedAt, openedAt + TOTE_TIMING.betting, openedAt + TOTE_TIMING.betting + TOTE_TIMING.race);
    // Startup may create the current slot after its cutoff. A later tick closes that empty slot.
    const due = await this.db.prepare("SELECT * FROM flag_tote_rounds WHERE state IN ('open','racing') AND closes_at<=? ORDER BY opened_at").all(now);
    for (const round of due) {
      if (Number(round.rules_version) !== 1) throw Error('Unsupported retained pool rules');
      const tickets = await this.tickets(round.id);
      let outcome = round.outcome ? JSON.parse(round.outcome) as { order: FlagCountry[]; seed: number } : undefined;
      if (round.state === 'open' && toteEligible(tickets)) {
        outcome = drawToteOrder(this.draw);
        await this.db.prepare("UPDATE flag_tote_rounds SET state='racing',outcome=? WHERE id=?").run(JSON.stringify(outcome), round.id);
      }
      if (toteEligible(tickets) && now < Number(round.finishes_at)) continue;
      // Insufficient rounds do not consume entropy or charge a fee.
      const result = settleFlagTote(tickets, outcome?.order ?? FLAG_COUNTRIES.map(c => c.id));
      await this.accountLocks(tickets.map(t => t.accountId));
      await this.db.prepare('UPDATE flag_tote_rounds SET state=?,settlement=? WHERE id=?').run(result.state, JSON.stringify({ ...result, payouts: [] }), round.id);
      await this.db.prepare('DELETE FROM flag_tote_reservations WHERE round_id=?').run(round.id);
      for (const accountId of [...new Set(tickets.map(t => t.accountId))].sort()) {
        const mine = tickets.filter(t => t.accountId === accountId);
        const credit = result.payouts.filter(p => mine.some(t => t.id === p.id)).reduce((sum, p) => sum + Number(p.units), 0);
        for (const t of mine) await this.db.prepare('UPDATE flag_tote_tickets SET payout_units=? WHERE round_id=? AND id=?').run(result.payouts.find(p => p.id === t.id)!.units, round.id, t.id);
        if (credit) {
          const balance = await demoBalanceUnits(this.db, accountId) + credit;
          await saveDemoUnits(this.db, accountId, balance);
          await recordDemoUnits(this.db, accountId, 'flag-tote:' + round.id + ':final', result.state === 'refunded' ? 'refund' : 'win', credit, balance, 'flag-tote', 'Флаговый тотализатор');
        }
      }
    }

  }
  async advance() {
    await this.ready;
    await this.db.transaction(() => this.advanceInTransaction(this.now()), { lockKey: 'flag-tote' });
  }
  private async publicRound(row: Record<string, any>): Promise<ToteRound> {
    const totals = await this.db.prepare('SELECT country,sum(stake_units) AS units FROM flag_tote_tickets WHERE round_id=? GROUP BY country').all(row.id);
    const count = await this.db.prepare('SELECT count(*) AS tickets,count(DISTINCT account_id) AS accounts FROM flag_tote_tickets WHERE round_id=?').get(row.id);
    const settlement = row.settlement ? JSON.parse(row.settlement) as ToteSettlement : undefined;
    return { id: row.id, rulesVersion: 1, openedAt: Number(row.opened_at), closesAt: Number(row.closes_at), finishesAt: Number(row.finishes_at), state: row.state,
      potUnits: String(totals.reduce((n, r) => n + Number(r.units), 0)), participants: Number(count!.accounts), ticketCount: Number(count!.tickets),
      totals: FLAG_COUNTRIES.map(c => ({ country: c.id, units: String(totals.find(t => t.country === c.id)?.units ?? 0) })),
      ...(row.outcome ? JSON.parse(row.outcome) : {}), ...(settlement ? { settlement } : {}) };
  }
  private async snapshotInTransaction(accountId: string): Promise<ToteReply> {
    const rows = await this.db.prepare('SELECT * FROM flag_tote_rounds ORDER BY opened_at DESC LIMIT 4').all();
    const rounds = await Promise.all(rows.map(r => this.publicRound(r)));
    const tickets = await this.db.prepare('SELECT id,round_id AS "roundId",country,stake_units::text AS "stakeUnits",payout_units::text AS "payoutUnits" FROM flag_tote_tickets WHERE account_id=? AND round_id IN (SELECT id FROM flag_tote_rounds ORDER BY opened_at DESC LIMIT 4) ORDER BY round_id,sequence').all(accountId);
    return { serverNow: this.now(), round: rounds[0], history: rounds.slice(1), tickets: tickets as ToteReply['tickets'], wallet: await this.wallet(accountId) };
  }
  async snapshot(accountId: string) {
    await this.advance();
    return this.db.transaction(async () => { await this.accountLocks([accountId]); return this.snapshotInTransaction(accountId); }, { lockKey: 'flag-tote' });
  }
  async bet(accountId: string, value: unknown): Promise<ToteReply> {
    if (!validToteBet(value)) throw new WalletError(400, 'Некорректная ставка тотализатора.');
    await this.advance();
    return this.db.transaction(async () => {
      const previous = await this.db.prepare('SELECT * FROM flag_tote_tickets WHERE id=?').get(value.id);
      await this.accountLocks([accountId]);
      if (previous) {
        if (previous.account_id !== accountId || previous.round_id !== value.roundId || previous.country !== value.country || String(previous.stake_units) !== value.stakeUnits) throw new WalletError(409, 'Нельзя изменить принятую ставку.');
        return { ...await this.snapshotInTransaction(accountId), replayed: true };
      }
      const round = await this.db.prepare('SELECT * FROM flag_tote_rounds WHERE id=?').get(value.roundId);
      if (!round || Number(round.rules_version) !== value.rulesVersion || round.state !== 'open' || this.now() >= Number(round.closes_at) || this.now() < Number(round.opened_at)) throw new WalletError(409, 'Ставки на этот раунд закрыты. Обнови раунд.');
      const counts = await this.db.prepare('SELECT count(*) AS tickets,coalesce(sum(stake_units),0) AS pot,coalesce(sum(CASE WHEN account_id=? THEN stake_units ELSE 0 END),0) AS mine FROM flag_tote_tickets WHERE round_id=?').get(accountId, value.roundId);
      const stake = Number(value.stakeUnits);
      if (Number(counts!.tickets) >= TOTE_LIMITS.maxTickets || Number(counts!.pot) + stake > TOTE_LIMITS.maxBank || Number(counts!.mine) + stake > TOTE_LIMITS.maxAccount) throw new WalletError(409, 'Достигнут лимит ставок этого раунда.');
      const balance = await demoBalanceUnits(this.db, accountId);
      if (balance < stake) throw new WalletError(400, 'Недостаточно средств для ставки.');
      const held = await this.db.prepare('SELECT 1 FROM flag_tote_reservations WHERE round_id=? AND account_id=?').get(value.roundId, accountId);
      if (balance - stake + await demoReservedUnits(this.db, accountId) + (held ? 0 : TOTE_LIMITS.maxBank) > MAX_DEMO_UNITS) throw new WalletError(409, 'Недостаточно места на балансе для возможной выплаты.');
      await this.db.prepare('INSERT INTO flag_tote_reservations(round_id,account_id,reserved_units) VALUES(?,?,?) ON CONFLICT DO NOTHING').run(value.roundId, accountId, TOTE_LIMITS.maxBank);
      await this.db.prepare('INSERT INTO flag_tote_tickets(round_id,sequence,account_id,id,country,stake_units) VALUES(?,?,?,?,?,?)').run(value.roundId, Number(counts!.tickets) + 1, accountId, value.id, value.country, stake);
      await saveDemoUnits(this.db, accountId, balance - stake);
      await recordDemoUnits(this.db, accountId, 'flag-tote:' + value.id, 'bet', -stake, balance - stake, 'flag-tote', 'Флаговый тотализатор');
      return { ...await this.snapshotInTransaction(accountId), replayed: false };
    }, { lockKey: 'flag-tote' });
  }
}

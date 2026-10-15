import { randomInt } from 'node:crypto';
import type { PostgresDatabase } from './database';
import { DEMO_BETS, type DemoWallet } from '../src/shared/demoWallet';
import type { MinesOperation, MinesResult, MinesSession } from '../src/shared/minesGame';
import { exactPayoutUnits, minesOdds } from '../src/shared/originalGames';
import { WalletError } from './demoWallet';
import { demoBalanceUnits, MAX_DEMO_UNITS, recordDemoUnits, saveDemoUnits } from './demoWalletAmounts';
import { inputRecord } from './games/types';
import { isMineHit } from './games/vfair/mines/mines-math';
import { applyMinesSchemaMigrations } from './game-database-migrations';

type StoredSession = {
  id: string; account_id: string; state: MinesSession['state']; amount: number; mine_count: number;
  mine_cells: string; revealed: string; payout_units: number; reserved_units: number;
};
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value);

function operation(value: unknown): MinesOperation {
  try {
    const row = inputRecord(value);
    if (!uuid(row.id)) throw new Error();
    const expected = row.action === 'start' ? 'action,amount,id,mineCount' : row.action === 'reveal' ? 'action,cell,id,sessionId' : row.action === 'cashout' ? 'action,id,sessionId' : '';
    if (!expected || Object.keys(row).sort().join(',') !== expected || Reflect.ownKeys(row).length !== expected.split(',').length) throw new Error();
    if (row.action === 'start') {
      if (!Number.isSafeInteger(row.amount) || !(DEMO_BETS as readonly unknown[]).includes(row.amount)
        || typeof row.mineCount !== 'number' || Object.keys(minesOdds.validate({ mineCount: row.mineCount })).length) throw new Error();
      return { id: row.id, action: 'start', amount: row.amount as number, mineCount: row.mineCount };
    }
    if (!uuid(row.sessionId)) throw new Error();
    if (row.action === 'cashout') return { id: row.id, action: 'cashout', sessionId: row.sessionId };
    if (typeof row.cell !== 'number' || !Number.isSafeInteger(row.cell) || row.cell < 0 || row.cell >= 25) throw new Error();
    return { id: row.id, action: 'reveal', sessionId: row.sessionId, cell: row.cell };
  } catch { throw new WalletError(400, 'Некорректное действие Mines.'); }
}

export class DemoMinesStore {
  readonly ready: Promise<void>;
  constructor(private db: PostgresDatabase, private snapshot: (accountId: string) => Promise<DemoWallet>, private draw: (max: number) => number = randomInt,
    private otherReserved: (accountId: string) => Promise<number> = async () => 0, private settleOther: (accountId: string) => Promise<void> = async () => {}, prerequisite: Promise<void> = Promise.resolve()) {
    this.ready = prerequisite.then(() => db.transaction(async () => db.exec(`CREATE TABLE IF NOT EXISTS demo_mines_sessions (
      id TEXT NOT NULL, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      state TEXT NOT NULL CHECK(state IN ('active','lost','cashed_out')), amount INTEGER NOT NULL,
      mine_count INTEGER NOT NULL CHECK(mine_count BETWEEN 1 AND 24), mine_cells TEXT NOT NULL,
      revealed TEXT NOT NULL, payout_units INTEGER NOT NULL DEFAULT 0, reserved_units INTEGER NOT NULL,
      created_at INTEGER NOT NULL, PRIMARY KEY(account_id,id));
      CREATE UNIQUE INDEX IF NOT EXISTS demo_mines_active ON demo_mines_sessions(account_id) WHERE state='active';
      CREATE TABLE IF NOT EXISTS demo_mines_requests (
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, id TEXT NOT NULL,
      request_key TEXT NOT NULL, result TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(account_id,id));`))).then(() => applyMinesSchemaMigrations(db));
  }
  async reservedUnits(accountId: string): Promise<number> {
    await this.ready;
    return Number((await this.db.prepare("SELECT reserved_units AS units FROM demo_mines_sessions WHERE account_id=? AND state='active'").get(accountId))?.units ?? 0);
  }
  private publicSession(row: StoredSession): MinesSession {
    const revealed = JSON.parse(row.revealed) as number[];
    const count = row.state === 'lost' ? revealed.length - 1 : revealed.length;
    const multiplier = row.state === 'lost' ? 0 : minesOdds.getMultiplier(row.mine_count, count);
    return {
      id: row.id, state: row.state, amount: row.amount, mineCount: row.mine_count, revealed,
      ...(row.state === 'active' ? {} : { mineCells: JSON.parse(row.mine_cells) as number[] }),
      multiplier,
      nextMultiplier: row.state === 'active' && count < 25 - row.mine_count ? minesOdds.getMultiplier(row.mine_count, count + 1) : null,
      payout: row.state === 'active' ? Number(exactPayoutUnits(BigInt(row.amount * 100), multiplier)) / 100 : row.payout_units / 100,
    };
  }
  async active(accountId: string): Promise<MinesResult> {
    await this.ready;
    return this.db.transaction(async () => {
      await this.settleOther(accountId);
      const row = (await this.db.prepare("SELECT * FROM demo_mines_sessions WHERE account_id=? AND state='active'").get(accountId)) as StoredSession | undefined;
      return { wallet: await this.snapshot(accountId), session: row ? this.publicSession(row) : null };
    }, { lockKey: 'account:' + accountId });
  }
  async operate(accountId: string, value: unknown): Promise<MinesResult> {
    await this.ready;
    const op = operation(value), requestKey = JSON.stringify(op);
    await this.settleOther(accountId);
    return this.db.transaction(async () => {
      if(await this.db.prepare('SELECT 1 FROM demo_casino_requests WHERE account_id=? AND id=?').get(accountId,op.id))throw new WalletError(409,'Этот номер операции уже использован в казино.');
      const previous = (await this.db.prepare('SELECT request_key,result FROM demo_mines_requests WHERE account_id=? AND id=?').get(accountId, op.id));
      if (previous) {
        if (previous.request_key !== requestKey) throw new WalletError(409, 'Нельзя изменить отправленное действие Mines.');
        const saved = JSON.parse(String(previous.result)) as MinesSession;
        const current = (await this.db.prepare('SELECT * FROM demo_mines_sessions WHERE account_id=? AND id=?').get(accountId, saved.id)) as StoredSession | undefined;
        if (!current) throw new Error('Missing saved Mines session');
        const result = { wallet: await this.snapshot(accountId), session: this.publicSession(current) };
        return result;
      }
      if ((await this.db.prepare('SELECT 1 FROM demo_operations WHERE account_id=? AND operation_id=?').get(accountId, op.id))) throw new WalletError(409, 'Этот идентификатор уже использован.');
      if ((await this.db.prepare('SELECT 1 FROM demo_flight_requests WHERE account_id=? AND id=?').get(accountId, op.id))) throw new WalletError(409, 'Этот идентификатор уже использован.');
      const recent = (await this.db.prepare('SELECT COUNT(*) AS n FROM (SELECT 1 FROM demo_mines_requests WHERE account_id=? AND created_at>? LIMIT 120) recent').get(accountId, Date.now() - 60000));
      if (Number(recent!.n) >= 120) throw new WalletError(429, 'Слишком много действий. Подожди минуту.');
      let row: StoredSession;
      let balance = await demoBalanceUnits(this.db, accountId);
      if (op.action === 'start') {
        if ((await this.db.prepare("SELECT 1 FROM demo_mines_sessions WHERE account_id=? AND state='active'").get(accountId))) throw new WalletError(409, 'Сначала заверши текущую игру Mines.');
        const stake = op.amount * 100;
        if (balance < stake) throw new WalletError(400, 'Недостаточно демомонет.');
        const maxMultiplier = minesOdds.getMultiplier(op.mineCount, 25 - op.mineCount);
        const reserved = exactPayoutUnits(BigInt(stake), maxMultiplier);
        if (BigInt(balance - stake) + reserved + BigInt(await this.otherReserved(accountId)) > BigInt(MAX_DEMO_UNITS)) throw new WalletError(400, 'Уменьши ставку или число мин: возможная выплата превышает лимит демобаланса.');
        const pool = Array.from({ length: 25 }, (_, i) => i);
        const cells: number[] = [];
        for (let i = 0; i < op.mineCount; i++) {
          const index = this.draw(pool.length);
          if (!Number.isSafeInteger(index) || index < 0 || index >= pool.length) throw new Error('Invalid Mines randomness');
          cells.push(pool.splice(index, 1)[0]);
        }
        cells.sort((a, b) => a - b);
        row = { id: op.id, account_id: accountId, state: 'active', amount: op.amount, mine_count: op.mineCount,
          mine_cells: JSON.stringify(cells), revealed: '[]', payout_units: 0, reserved_units: Number(reserved) };
        balance -= stake;
        await recordDemoUnits(this.db, accountId, op.id, 'bet', -stake, balance, 'royal-mines', 'Royal Mines');
        (await this.db.prepare('INSERT INTO demo_mines_sessions(id,account_id,state,amount,mine_count,mine_cells,revealed,payout_units,reserved_units,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
          .run(row.id, accountId, row.state, row.amount, row.mine_count, row.mine_cells, row.revealed, 0, row.reserved_units, Date.now()));
      } else {
        const found = (await this.db.prepare('SELECT * FROM demo_mines_sessions WHERE account_id=? AND id=?').get(accountId, op.sessionId)) as StoredSession | undefined;
        if (!found) throw new WalletError(404, 'Игра Mines не найдена.');
        if (found.state !== 'active') throw new WalletError(409, 'Эта игра Mines уже завершена.');
        row = { ...found };
        const revealed = JSON.parse(row.revealed) as number[];
        if (op.action === 'reveal') {
          if (revealed.includes(op.cell)) throw new WalletError(409, 'Эта клетка уже открыта.');
          revealed.push(op.cell); row.revealed = JSON.stringify(revealed);
          if (isMineHit(op.cell, JSON.parse(row.mine_cells))) row.state = 'lost';
          else if (revealed.length === 25 - row.mine_count) row.state = 'cashed_out';
        } else {
          if (revealed.length === 0) throw new WalletError(400, 'Открой хотя бы одну безопасную клетку перед получением выигрыша.');
          row.state = 'cashed_out';
        }
        if (row.state !== 'active') {
          const multiplier = row.state === 'lost' ? 0 : minesOdds.getMultiplier(row.mine_count, revealed.length);
          row.payout_units = Number(exactPayoutUnits(BigInt(row.amount * 100), multiplier));
          row.reserved_units = 0;
          balance += row.payout_units;
          if (!Number.isSafeInteger(balance) || balance + await this.otherReserved(accountId) > MAX_DEMO_UNITS) throw new WalletError(400, 'Выплата превышает лимит демобаланса.');
          await recordDemoUnits(this.db, accountId, row.id, 'win', row.payout_units, balance, 'royal-mines', 'Royal Mines');
        }
        (await this.db.prepare('UPDATE demo_mines_sessions SET state=?,revealed=?,payout_units=?,reserved_units=? WHERE account_id=? AND id=?')
          .run(row.state, row.revealed, row.payout_units, row.reserved_units, accountId, row.id));
      }
      await saveDemoUnits(this.db, accountId, balance);
      const session = this.publicSession(row);
      (await this.db.prepare('INSERT INTO demo_mines_requests(account_id,id,request_key,result,created_at) VALUES (?,?,?,?,?)').run(accountId, op.id, requestKey, JSON.stringify(session), Date.now()));
      const result = { wallet: await this.snapshot(accountId), session };
      return result;
    }, { lockKey: 'account:' + accountId });
  }
}

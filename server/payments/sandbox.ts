import type { PostgresDatabase, DatabaseRow } from '../database';
import { applySchemaMigration } from '../database-migrations';
import { CryptoError } from '../crypto/config';
import { validIpn, providerId } from '../crypto/nowpayments';
import { gameAccountId } from '../../src/shared/nileWallet';
import { units } from '../crypto/amounts';
import { validSandboxCase, type SandboxSnapshot, type SandboxDeposit } from '../../src/shared/nowpaymentsSandbox';
import { demoBalanceUnits, demoReservedUnits, MAX_DEMO_UNITS, recordDemoUnits, saveDemoUnits } from '../demoWalletAmounts';
import type { SandboxConfig, SandboxProvider } from './sandbox-provider';

const fail = (status: number, text: string): never => { throw new CryptoError(status, text); };
const states = new Set(['waiting', 'confirming', 'confirmed', 'sending', 'partially_paid', 'finished', 'failed', 'refunded', 'expired']);
function decimalUnits(value: unknown): bigint {
  try { return units(value, 18); } catch { return fail(503, 'Sandbox вернул некорректную сумму.'); }
}
export class SandboxPaymentStore {
  readonly ready: Promise<void>;
  private sweeping?: Promise<void>;
  constructor(private db: PostgresDatabase, readonly config: SandboxConfig, private provider: SandboxProvider,
    prerequisite: Promise<void> = Promise.resolve()) {
    this.ready = !config.enabled ? Promise.resolve() : prerequisite.then(() => applySchemaMigration(db, {
      id: 'nowpayments-sandbox-deposits-v1', statements: [
        `CREATE TABLE IF NOT EXISTS nowpayments_sandbox_deposits(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),
          request_key TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount BETWEEN 1 AND 100000),scenario TEXT NOT NULL,
          currency TEXT NOT NULL,payment_id TEXT UNIQUE,state TEXT NOT NULL,credited_units BIGINT NOT NULL DEFAULT 0 CHECK(credited_units>=0),
          created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL,CHECK(credited_units<=amount*100))`,
        `CREATE INDEX IF NOT EXISTS nowpayments_sandbox_pending ON nowpayments_sandbox_deposits(state,updated_at)`,
      ],
    }));
  }
  private enabled() { if (!this.config.enabled) fail(503, 'Sandbox NOWPayments пока не подключён.'); }
  private view(row: DatabaseRow): SandboxDeposit {
    return { id: String(row.id), amount: Number(row.amount), scenario: row.scenario, status: String(row.state),
      creditedAmount: Number(row.credited_units) / 100, createdAt: Number(row.created_at), paymentId: row.payment_id ?? null };
  }
  async snapshot(accountId: string): Promise<SandboxSnapshot> {
    if (!this.config.enabled) return { enabled: false };
    await this.ready;
    const rows = await this.db.prepare('SELECT * FROM nowpayments_sandbox_deposits WHERE account_id=? ORDER BY created_at DESC,id DESC LIMIT 20').all(accountId);
    return { enabled: true, environment: 'sandbox', currency: this.config.currency, operations: rows.map(row => this.view(row)) };
  }
  async create(accountId: string, value: unknown) {
    this.enabled(); await this.ready;
    const op = value as Record<string, unknown>;
    if (!op || Object.keys(op).sort().join(',') !== 'amount,id,scenario' || !gameAccountId(op.id)
      || !Number.isInteger(op.amount) || Number(op.amount) < 1 || Number(op.amount) > 100000 || !validSandboxCase(op.scenario)) {
      return fail(400, 'Некорректное тестовое пополнение.');
    }
    const key = JSON.stringify([accountId, op.amount, op.scenario, this.config.currency]);
    const claimed = await this.db.transaction(async () => {
      const old = await this.db.prepare('SELECT * FROM nowpayments_sandbox_deposits WHERE id=?').get(op.id);
      if (old) {
        if (old.request_key !== key) fail(409, 'Нельзя изменить отправленное тестовое пополнение.');
        return { created: false, row: old };
      }
      const count = await this.db.prepare('SELECT count(*) AS n FROM nowpayments_sandbox_deposits WHERE account_id=? AND created_at>?').get(accountId, Date.now() - 60000);
      if (Number(count?.n) >= 5) fail(429, 'Подожди минуту перед новым тестовым пополнением.');
      const now = Date.now();
      const row = await this.db.prepare(`INSERT INTO nowpayments_sandbox_deposits(id,account_id,request_key,amount,scenario,currency,state,created_at,updated_at)
        VALUES (?,?,?,?,?,?,'creating',?,?) ON CONFLICT DO NOTHING RETURNING *`).get(op.id, accountId, key, op.amount, op.scenario, this.config.currency, now, now);
      if (!row) fail(409, 'Этот номер тестового пополнения уже использован.');
      return { created: true, row: row! };
    }, { lockKey: 'account:' + accountId });
    if (!claimed.created) return this.view(claimed.row);
    try {
      const reply = await this.provider.create(String(op.id), Number(op.amount), op.scenario);
      // Create never credits. A separate authenticated GET must confirm identity and settlement.
      const id = providerId(reply.payment_id);
      if (reply.order_id !== op.id) fail(503, 'Sandbox вернул другое тестовое пополнение.');
      await this.db.transaction(async () => {
        const row = (await this.db.prepare('SELECT * FROM nowpayments_sandbox_deposits WHERE id=?').get(op.id))!;
        if (row.payment_id && row.payment_id !== id) fail(409, 'У тестового пополнения изменился номер провайдера.');
        await this.db.prepare("UPDATE nowpayments_sandbox_deposits SET payment_id=?,state=CASE WHEN state='creating' THEN 'waiting' ELSE state END,updated_at=? WHERE id=?")
          .run(id, Date.now(), op.id);
      }, { lockKey: 'account:' + accountId });
    } catch {
      await this.db.prepare("UPDATE nowpayments_sandbox_deposits SET state='review',updated_at=? WHERE id=? AND state='creating'").run(Date.now(), op.id);
      throw new CryptoError(503, 'Создание тестового платежа не подтверждено. Не создавай замену: проверь сохранённую операцию.');
    }
    return this.view((await this.db.prepare('SELECT * FROM nowpayments_sandbox_deposits WHERE id=?').get(op.id))!);
  }
  private confirmedCredit(payment: Record<string, unknown>, row: DatabaseRow) {
    if (String(payment.payment_id) !== String(row.payment_id) || payment.order_id !== row.id || payment.price_currency !== 'usd'
      || payment.pay_currency !== row.currency || decimalUnits(payment.price_amount) !== decimalUnits(row.amount)
      || typeof payment.payment_status !== 'string' || !states.has(payment.payment_status)) {
      return fail(503, 'Sandbox не подтвердил принадлежность и параметры пополнения.');
    }
    if (!['finished', 'partially_paid'].includes(payment.payment_status)) return 0;
    const due = decimalUnits(payment.pay_amount), paid = decimalUnits(payment.actually_paid);
    if (due <= 0n || paid <= 0n) return fail(503, 'Sandbox не подтвердил фактически оплаченную сумму.');
    const promised = BigInt(row.amount) * 100n;
    return Number(promised * (paid > due ? due : paid) / due);
  }
  private async apply(payment: Record<string, unknown>, row: DatabaseRow) {
    const credit = this.confirmedCredit(payment, row);
    return this.db.transaction(async () => {
      const current = (await this.db.prepare('SELECT * FROM nowpayments_sandbox_deposits WHERE id=?').get(row.id))!;
      if (current.payment_id && current.payment_id !== row.payment_id) fail(409, 'Номер Sandbox-платежа изменился.');
      const already = Number(current.credited_units), delta = credit - already;
      let state = String(payment.payment_status);
      if (delta < 0) return this.view(current);
      if (delta > 0) {
        const balance = await demoBalanceUnits(this.db, row.account_id);
        if (balance + delta + await demoReservedUnits(this.db, row.account_id) > MAX_DEMO_UNITS) state = 'credit_pending';
        else {
          await saveDemoUnits(this.db, row.account_id, balance + delta);
          await recordDemoUnits(this.db, row.account_id, 'nowpayments-sandbox:' + row.id, 'deposit', delta, balance + delta, 'nowpayments-sandbox', 'NOWPayments Sandbox');
        }
      }
      await this.db.prepare('UPDATE nowpayments_sandbox_deposits SET payment_id=?,state=?,credited_units=?,updated_at=? WHERE id=?')
        .run(row.payment_id, state, state === 'credit_pending' ? already : credit, Date.now(), row.id);
      return this.view((await this.db.prepare('SELECT * FROM nowpayments_sandbox_deposits WHERE id=?').get(row.id))!);
    }, { lockKey: 'account:' + row.account_id });
  }
  async refresh(accountId: string, id: string) {
    this.enabled(); await this.ready;
    if (!gameAccountId(id)) fail(400, 'Некорректный номер тестового пополнения.');
    const row = await this.db.prepare('SELECT * FROM nowpayments_sandbox_deposits WHERE id=? AND account_id=?').get(id, accountId);
    if (!row) return fail(404, 'Тестовое пополнение не найдено.');
    if (!row.payment_id) return fail(409, 'Ожидаем подтверждение номера платежа от Sandbox. Не создавай новую операцию взамен.');
    return this.apply(await this.provider.payment(row.payment_id), row);
  }
  async receiveIpn(body: unknown, signature: unknown) {
    this.enabled(); await this.ready;
    if (!validIpn(body, signature, this.config.ipnSecret)) fail(401, 'Некорректная подпись Sandbox.');
    const value = body as Record<string, unknown>;
    if (!gameAccountId(value.order_id)) fail(400, 'Некорректный номер тестового пополнения.');
    const id = providerId(value.payment_id);
    const row = await this.db.prepare('SELECT * FROM nowpayments_sandbox_deposits WHERE id=?').get(value.order_id);
    if (!row || row.payment_id && row.payment_id !== id) return fail(404, 'Тестовое пополнение не найдено.');
    // A signed callback is a trigger to read the provider, never a source of credited amounts.
    await this.apply(await this.provider.payment(id), { ...row, payment_id: id });
    return { ok: true };
  }
  async sweep() {
    if (!this.config.enabled) return;
    if (this.sweeping) return this.sweeping;
    this.sweeping = (async () => {
      await this.ready;
      const rows = await this.db.prepare("SELECT id,account_id FROM nowpayments_sandbox_deposits WHERE payment_id IS NOT NULL AND state IN ('waiting','confirming','confirmed','sending','credit_pending') ORDER BY updated_at LIMIT 5").all();
      for (const row of rows) try { await this.refresh(row.account_id, row.id); } catch { /* Saved deposits remain available for a later refresh. */ }
    })().finally(() => { this.sweeping = undefined; });
    return this.sweeping;
  }
}

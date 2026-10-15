import express, { type Application } from 'express';
import { PostgresDatabase } from '../database';
import { applySchemaMigration } from '../database-migrations';
import { CryptoError } from '../crypto/config';
import { validPaymentEvent, verifyServiceSignature } from './protocol';

export class PaymentCredits {
  readonly ready: Promise<void>;
  constructor(private db: PostgresDatabase, prerequisite: Promise<void> = Promise.resolve()) {
    this.ready = prerequisite.then(() => applySchemaMigration(db, { id: 'payment-credits-v1', statements: [
      `CREATE TABLE IF NOT EXISTS payment_credit_wallets(user_id TEXT PRIMARY KEY REFERENCES accounts(id),
        available_units BIGINT NOT NULL DEFAULT 0 CHECK(available_units>=0), reserved_units BIGINT NOT NULL DEFAULT 0 CHECK(reserved_units>=0),
        CHECK(available_units+reserved_units<=1000000000000))`,
      `CREATE TABLE IF NOT EXISTS payment_credit_events(event_id TEXT PRIMARY KEY,payment_id TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES accounts(id),
        body TEXT NOT NULL,created_at BIGINT NOT NULL,applied_at BIGINT NOT NULL)`,
    ] }));
  }
  async apply(value: unknown) {
    if (!validPaymentEvent(value)) throw new CryptoError(400, 'Некорректное событие платежного сервиса.');
    await this.ready;
    const body = JSON.stringify(value);
    return this.db.transaction(async () => {
      const previous = await this.db.prepare('SELECT body FROM payment_credit_events WHERE event_id=?').get(value.event_id);
      if (previous) {
        if (previous.body !== body) throw new CryptoError(409, 'Нельзя изменить уже принятое событие.');
        return { ok: true, event_id: value.event_id, replayed: true };
      }
      if (!await this.db.prepare('SELECT id FROM accounts WHERE id=?').get(value.user_id)) throw new CryptoError(404, 'Игрок не найден.');
      await this.db.prepare('INSERT INTO payment_credit_wallets(user_id) VALUES (?) ON CONFLICT DO NOTHING').run(value.user_id);
      const row = (await this.db.prepare('SELECT * FROM payment_credit_wallets WHERE user_id=?').get(value.user_id))!;
      const available = BigInt(row.available_units) + BigInt(value.available_delta_units), reserved = BigInt(row.reserved_units) + BigInt(value.reserved_delta_units);
      if (available < 0n || reserved < 0n || available + reserved > 1000000000000n) throw new CryptoError(409, 'Событие нарушает порядок или лимит баланса.');
      await this.db.prepare('UPDATE payment_credit_wallets SET available_units=?,reserved_units=? WHERE user_id=?').run(String(available), String(reserved), value.user_id);
      await this.db.prepare('INSERT INTO payment_credit_events(event_id,payment_id,user_id,body,created_at,applied_at) VALUES (?,?,?,?,?,?)')
        .run(value.event_id, value.payment_id, value.user_id, body, value.created_at, Date.now());
      return { ok: true, event_id: value.event_id, replayed: false };
    }, { lockKey: 'payment-credits' });
  }
  async snapshot(userId: string) {
    await this.ready;
    const row = await this.db.prepare('SELECT available_units,reserved_units FROM payment_credit_wallets WHERE user_id=?').get(userId);
    return { balanceUnits: String(row?.available_units ?? 0), reservedUnits: String(row?.reserved_units ?? 0) };
  }
}
export function installPaymentCredits(app: Application, credits: PaymentCredits, secret: string) {
  app.post('/internal/payments/events', express.raw({ type: 'application/json', limit: '4kb', inflate: false }), async (req, res) => {
    const body = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    if (!secret || req.get('origin') || !verifyServiceSignature(secret, 'event', req.get('x-royal-payments-timestamp'), req.get('x-royal-payments-signature'), req.method, req.originalUrl, body)) {
      res.status(401).json({ ok: false }); return;
    }
    try { res.json(await credits.apply(JSON.parse(body))); }
    catch (error) { res.status(error instanceof CryptoError ? error.status : 503).json({ ok: false }); }
  });
}

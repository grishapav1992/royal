import { CryptoError } from '../crypto/config';
import type { CryptoStore } from '../crypto/store';
import { applySchemaMigration } from '../database-migrations';
import type { DatabaseRow } from '../database';
import { gameAccountId } from '../../src/shared/nileWallet';
import { amount } from '../crypto/amounts';
import type { TelegramStarsConfig, TelegramProvider } from './telegram-provider';

const fail = (status: number, message: string): never => { throw new CryptoError(status, message); };
const userId = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
export class TelegramStarsStore {
  readonly ready: Promise<void>;
  constructor(private wallet: CryptoStore, readonly config: TelegramStarsConfig, private bot: TelegramProvider,
    private now = Date.now) {
    this.ready = wallet.ready.then(() => applySchemaMigration(wallet.db, { id: 'telegram-stars-v1', statements: [
      `CREATE TABLE telegram_stars_orders(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),bot_id TEXT NOT NULL,
        stars INTEGER NOT NULL CHECK(stars BETWEEN 100 AND 10000),amount_units BIGINT NOT NULL CHECK(amount_units>0),
        state TEXT NOT NULL DEFAULT 'waiting',telegram_user_id BIGINT,checkout_id TEXT,charge_id TEXT UNIQUE,
        terms_url TEXT NOT NULL,created_at BIGINT NOT NULL,expires_at BIGINT NOT NULL,updated_at BIGINT NOT NULL)`,
      `CREATE INDEX telegram_stars_orders_account ON telegram_stars_orders(account_id,created_at DESC)`,
    ] }));
  }
  private get botId() { return this.config.token.split(':')[0]; }
  private view(row: DatabaseRow) {
    return { id: row.id, stars: Number(row.stars), amountUnits: String(row.amount_units), status: row.state,
      createdAt: Number(row.created_at), expiresAt: Number(row.expires_at),
      botUrl: 'https://t.me/' + this.config.username + '?start=pay_' + row.id };
  }
  async snapshot(accountId: string) {
    await this.ready;
    const rows = await this.wallet.db.prepare('SELECT * FROM telegram_stars_orders WHERE account_id=? AND bot_id=? ORDER BY created_at DESC,id DESC LIMIT 20').all(accountId, this.botId);
    return { enabled: this.config.enabled && this.wallet.config.enabled, unitsPerStar: this.config.unitsPerStar,
      termsUrl: this.config.termsUrl, operations: rows.map(row => this.view(row)) };
  }
  async create(accountId: string, value: unknown) {
    await this.ready;
    const op = value as { id: string; stars: number; termsAccepted: boolean };
    if (!gameAccountId(accountId) || !op || Object.keys(op).sort().join(',') !== 'id,stars,termsAccepted'
      || !gameAccountId(op.id) || !Number.isSafeInteger(op.stars) || op.stars < 100 || op.stars > 10000 || op.termsAccepted !== true) {
      fail(400, 'Укажи от 100 до 10 000 Stars и прими условия оплаты.');
    }
    return this.wallet.db.transaction(async () => {
      const old = await this.wallet.db.prepare('SELECT * FROM telegram_stars_orders WHERE id=?').get(op.id);
      if (old) {
        if (old.account_id !== accountId || Number(old.stars) !== op.stars || old.bot_id !== this.botId) fail(409, 'Нельзя изменить сохранённый платёж Stars.');
        return this.view(old);
      }
      if (!this.config.enabled || !this.wallet.config.enabled) fail(503, 'Оплата Telegram Stars пока не подключена.');
      const recent = await this.wallet.db.prepare('SELECT count(*) AS n FROM telegram_stars_orders WHERE account_id=? AND created_at>?').get(accountId, this.now() - 60000);
      if (Number(recent?.n) >= 5) fail(429, 'Подожди минуту перед новым платежом Stars.');
      await this.wallet.db.prepare('INSERT INTO accounts(id) VALUES (?) ON CONFLICT DO NOTHING').run(accountId);
      const row = await this.wallet.db.prepare(`INSERT INTO telegram_stars_orders(id,account_id,bot_id,stars,amount_units,terms_url,created_at,expires_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?) RETURNING *`).get(op.id, accountId, this.botId, op.stars,
        String(BigInt(op.stars) * BigInt(this.config.unitsPerStar)), this.config.termsUrl, this.now(), this.now() + 1800000, this.now());
      return this.view(row!);
    }, { lockKey: 'crypto-ledger' });
  }
  private async order(payload: unknown) {
    if (!gameAccountId(payload)) return fail(400, 'Некорректный платёж Stars.');
    const row = await this.wallet.db.prepare('SELECT * FROM telegram_stars_orders WHERE id=? AND bot_id=?').get(payload, this.botId);
    if (!row) return fail(404, 'Платёж Stars не найден.');
    return row;
  }
  private async start(chatId: number, id: string) {
    const row = await this.wallet.db.transaction(async () => {
      const row = await this.order(id);
      if (row.state !== 'waiting' || Number(row.expires_at) <= this.now()) fail(409, 'Этот счёт уже оплачен, проверяется или истёк. Проверь баланс на сайте.');
      if (row.telegram_user_id && Number(row.telegram_user_id) !== chatId) fail(409, 'Этот счёт открыт другим пользователем Telegram.');
      await this.wallet.db.prepare('UPDATE telegram_stars_orders SET telegram_user_id=?,updated_at=? WHERE id=?').run(chatId, this.now(), id);
      return row;
    }, { lockKey: 'crypto-ledger' });
    await this.bot.call('sendMessage', { chat_id: chatId, text: 'Счёт для аккаунта ' + String(row.account_id).slice(0, 8)
      + '. Не пересылай ссылку. Условия: ' + row.terms_url + '. Помощь с оплатой: /paysupport' });
    await this.bot.call('sendInvoice', { chat_id: chatId, title: 'Пополнение баланса Рояль',
      description: amount(BigInt(row.amount_units)) + ' USDT на баланс аккаунта ' + String(row.account_id).slice(0, 8),
      payload: row.id, provider_token: '', currency: 'XTR', prices: [{ label: 'Пополнение', amount: Number(row.stars) }],
      start_parameter: 'pay_' + row.id });
  }
  private async preCheckout(query: Record<string, any>) {
    let accepted = false;
    try {
      await this.wallet.db.transaction(async () => {
        const row = await this.order(query.invoice_payload);
        if (!this.config.enabled || !this.wallet.config.enabled || !userId(query.from?.id) || row.telegram_user_id == null
          || Number(row.telegram_user_id) !== query.from.id || query.currency !== 'XTR' || query.total_amount !== Number(row.stars)
          || Number(row.expires_at) <= this.now() || !['waiting', 'checkout'].includes(row.state)
          || row.checkout_id && row.checkout_id !== query.id) fail(409, 'Счёт не может быть оплачен. Проверь пополнение на сайте.');
        if (row.state === 'waiting') {
          const pending = BigInt((await this.wallet.db.prepare("SELECT coalesce(sum(amount_units),0)::text AS n FROM telegram_stars_orders WHERE state='checkout'").get())!.n);
          const ownPending = BigInt((await this.wallet.db.prepare("SELECT coalesce(sum(amount_units),0)::text AS n FROM telegram_stars_orders WHERE account_id=? AND state='checkout'").get(row.account_id))!.n);
          const balance = await this.wallet.db.prepare('SELECT balance_units,reserved_units FROM crypto_wallets WHERE account_id=?').get(row.account_id);
          if (BigInt(balance?.balance_units ?? 0) + BigInt(balance?.reserved_units ?? 0) + ownPending + BigInt(row.amount_units) > 1000000000000n)
            fail(409, 'Платёж превышает лимит денежного баланса.');
          if (!await this.wallet.starsReserveAvailable(pending + BigInt(row.amount_units))) fail(503, 'Резерв для оплаты временно недоступен.');
        }
        await this.wallet.db.prepare("UPDATE telegram_stars_orders SET state='checkout',checkout_id=?,updated_at=? WHERE id=?").run(query.id, this.now(), row.id);
      }, { lockKey: 'crypto-ledger' });
      accepted = true;
    } catch (error) { if (!(error instanceof CryptoError)) throw error; }
    await this.bot.call('answerPreCheckoutQuery', { pre_checkout_query_id: query.id, ok: accepted,
      ...(!accepted ? { error_message: 'Счёт не может быть оплачен. Проверь пополнение на сайте.' } : {}) });
  }
  private async payment(message: Record<string, any>, refunded: boolean) {
    const receipt = refunded ? message.refunded_payment : message.successful_payment;
    await this.wallet.db.transaction(async () => {
      const row = await this.order(receipt.invoice_payload);
      if (receipt.currency !== 'XTR' || receipt.total_amount !== Number(row.stars) || receipt.is_recurring
        || !userId(message.from?.id) || Number(row.telegram_user_id) !== message.from.id || !row.checkout_id
        || typeof receipt.telegram_payment_charge_id !== 'string' || !/^[!-~]{1,256}$/.test(receipt.telegram_payment_charge_id)
        || row.charge_id && row.charge_id !== receipt.telegram_payment_charge_id) fail(409, 'Telegram не подтвердил параметры платежа Stars.');
      if (refunded) {
        // A refund may arrive before its successful-payment update. It must prevent later credit.
        if (row.state === 'paid') await this.wallet.holdStarsRefund(row.account_id, row.id);
        await this.wallet.db.prepare("UPDATE telegram_stars_orders SET state='refunded',charge_id=?,updated_at=? WHERE id=?")
          .run(receipt.telegram_payment_charge_id, this.now(), row.id);
      } else if (row.state !== 'refunded') {
        await this.wallet.creditStarsDeposit(row.account_id, row.id, String(row.amount_units), receipt.telegram_payment_charge_id, Number(row.stars));
        await this.wallet.db.prepare("UPDATE telegram_stars_orders SET state='paid',charge_id=?,updated_at=? WHERE id=?")
          .run(receipt.telegram_payment_charge_id, this.now(), row.id);
      }
    }, { lockKey: 'crypto-ledger' });
  }
  async receive(update: unknown) {
    await this.ready;
    const value = update as Record<string, any>;
    if (!value || !Number.isSafeInteger(value.update_id)) fail(400, 'Некорректное уведомление Telegram.');
    if (value.pre_checkout_query) {
      if (typeof value.pre_checkout_query.id !== 'string' || value.pre_checkout_query.id.length > 256) fail(400, 'Некорректная проверка платежа.');
      await this.preCheckout(value.pre_checkout_query);
    } else if (value.message) {
      const message = value.message;
      if (message.chat?.type !== 'private' || !userId(message.chat.id) || message.chat.id !== message.from?.id) return { ok: true };
      if (message.successful_payment || message.refunded_payment) await this.payment(message, !!message.refunded_payment);
      else if (typeof message.text === 'string') {
        const match = /^\/start pay_([a-f0-9-]{36})$/.exec(message.text);
        if (match) {
          try { await this.start(message.chat.id, match[1]); }
          catch (error) { if (!(error instanceof CryptoError) || error.status >= 500) throw error;
            await this.bot.call('sendMessage', { chat_id: message.chat.id, text: error.message }); }
        } else await this.bot.call('sendMessage', { chat_id: message.chat.id,
          text: /^\/(paysupport|support)(?:\s|$)/.test(message.text) ? 'Помощь с оплатой: ' + this.config.supportUrl
            : /^\/terms(?:\s|$)/.test(message.text) ? 'Условия оплаты: ' + this.config.termsUrl
              : 'Создай пополнение в кошельке на сайте Рояль, затем открой ссылку на оплату. Помощь: /paysupport. Условия: /terms.' });
      }
    }
    return { ok: true };
  }
}

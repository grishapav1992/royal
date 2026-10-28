import { readFileSync } from 'node:fs';
import { PostgresDatabase } from '../database';
import { CryptoStore } from '../crypto/store';
import { cryptoConfig } from '../crypto/config';
import { NowPayments } from '../crypto/nowpayments';
import { PaymentOutbox } from './outbox';
import { validateServiceSecret } from './protocol';
import { telegramStarsConfig, TelegramBot } from './telegram-provider';
import { TelegramStarsStore } from './telegram-stars';

export function createPaymentRuntime(env: NodeJS.ProcessEnv = process.env) {
  const secret = (name: string) => env[name + '_FILE'] ? readFileSync(env[name + '_FILE']!, 'utf8').trim() : env[name] ?? '';
  const requestSecret = validateServiceSecret(secret('PAYMENTS_REQUEST_SECRET')), eventSecret = validateServiceSecret(secret('PAYMENTS_EVENT_SECRET'));
  const starsConfig = telegramStarsConfig(env);
  const config = cryptoConfig(env);
  if (config.games) throw new Error('NOWPAYMENTS_GAMES_ENABLED must remain false in the separate payment service');
  const destination = env.PAYMENTS_GAME_EVENTS_URL ?? 'http://game:2567/internal/payments/events';
  const url = new URL(destination);
  if (url.protocol !== 'http:' || url.username || url.password || url.search || url.hash || url.pathname !== '/internal/payments/events') throw new Error('Invalid game payment-event URL');
  const db = new PostgresDatabase('royal_payments', { existingSchema: true });
  const ready = db.exec('CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY)');
  const outbox = new PaymentOutbox(db, destination, eventSecret, ready);
  const store = new CryptoStore(db, config, new NowPayments(config), outbox.ready, undefined, undefined,
    change => outbox.record(change), starsConfig.token
      ? id => !starsConfig.trialAccountIds || starsConfig.trialAccountIds.includes(id) : false);
  const stars = new TelegramStarsStore(store, starsConfig, new TelegramBot(starsConfig));
  return { db, store, outbox, requestSecret, stars };
}

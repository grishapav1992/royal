import { readFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { CryptoError } from '../crypto/config';
import { gameAccountId } from '../../src/shared/nileWallet';

export type TelegramStarsConfig = { enabled: boolean; token: string; username: string; webhookSecret: string;
  unitsPerStar: string; termsUrl: string; supportUrl: string; trialAccountIds?: readonly string[] };
export function telegramStarsConfig(env: NodeJS.ProcessEnv = process.env): TelegramStarsConfig {
  const secret = (name: string) => env[name + '_FILE'] ? readFileSync(env[name + '_FILE']!, 'utf8').trim() : env[name] ?? '';
  const trial = env.TELEGRAM_STARS_TRIAL === 'true';
  const trialAccountIds = (env.TELEGRAM_STARS_TRIAL_ACCOUNT_IDS ?? '').split(',').filter(Boolean);
  if (trial && (!trialAccountIds.length || !trialAccountIds.every(gameAccountId))) throw new Error('Configure trial account IDs');
  if (!trial && trialAccountIds.length) throw new Error('Trial account IDs require trial mode');
  const config: TelegramStarsConfig = { enabled: env.TELEGRAM_STARS_ENABLED === 'true', token: secret('TELEGRAM_BOT_TOKEN'),
    username: env.TELEGRAM_BOT_USERNAME ?? '', webhookSecret: secret('TELEGRAM_WEBHOOK_SECRET'),
    unitsPerStar: env.TELEGRAM_STARS_USDT_UNITS_PER_STAR ?? '10000',
    termsUrl: env.TELEGRAM_STARS_TERMS_URL ?? '', supportUrl: env.TELEGRAM_STARS_SUPPORT_URL ?? '',
    ...(trial ? { trialAccountIds } : {}) };
  if (!/^[1-9]\d{0,6}$/.test(config.unitsPerStar)) throw new Error('Invalid USDT micro-units per Star');
  if (trial && config.unitsPerStar !== '10000') throw new Error('Trial rate must be 100 Stars for 1 USDT');
  // Keep credentials when closing new sales: pending payments still need their callbacks.
  if (config.enabled || config.token || config.webhookSecret) {
    if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(config.token) || !/^[A-Za-z][A-Za-z0-9_]{1,28}bot$/i.test(config.username)
      || !/^[A-Za-z0-9_-]{32,256}$/.test(config.webhookSecret)) throw new Error('Configure Telegram bot credentials and webhook secret');
    for (const value of [config.termsUrl, config.supportUrl]) {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Telegram terms and support require public HTTPS URLs');
    }
  }
  return config;
}
export function validTelegramSecret(value: unknown, secret: string) {
  return typeof value === 'string' && secret.length >= 32 && Buffer.byteLength(value) === Buffer.byteLength(secret)
    && timingSafeEqual(Buffer.from(value), Buffer.from(secret));
}
export interface TelegramProvider { call(method: string, body: Record<string, unknown>): Promise<unknown> }
export class TelegramBot implements TelegramProvider {
  constructor(private config: TelegramStarsConfig, private fetcher: typeof fetch = fetch) {}
  async call(method: string, body: Record<string, unknown>) {
    try {
      const response = await this.fetcher('https://api.telegram.org/bot' + this.config.token + '/' + method, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(6500),
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const value = await response.json() as { ok?: boolean; result?: unknown };
      if (!response.ok || value.ok !== true) throw new Error();
      return value.result;
    } catch { throw new CryptoError(503, 'Telegram не подтвердил операцию. Проверь тот же платёж позже.'); }
  }
}

import { readFileSync } from 'node:fs';

export type CryptoConfig = { enabled: boolean; sandbox: boolean; apiKey: string; ipnSecret: string; origin: string;
  withdrawals: boolean; games: boolean; combat?:boolean; email: string; password: string; twoFactorSecret: string; conversionMarginBps: number };
export class CryptoError extends Error { constructor(readonly status: number, message: string) { super(message); } }
export function cryptoConfig(env: NodeJS.ProcessEnv = process.env): CryptoConfig {
  const secret = (name: string) => env[name + '_FILE'] ? readFileSync(env[name + '_FILE']!, 'utf8').trim() : env[name]?.trim() ?? '';
  const flag = (name: string) => {
    if (env[name] && !['true', 'false'].includes(env[name]!)) throw new Error('Invalid ' + name);
    return env[name] === 'true';
  };
  const config: CryptoConfig = { enabled: flag('NOWPAYMENTS_ENABLED'), sandbox: flag('NOWPAYMENTS_SANDBOX'),
    apiKey: secret('NOWPAYMENTS_API_KEY'), ipnSecret: secret('NOWPAYMENTS_IPN_SECRET'), origin: env.PUBLIC_ORIGIN ?? '',
    withdrawals: flag('NOWPAYMENTS_WITHDRAWALS_ENABLED'), games: flag('NOWPAYMENTS_GAMES_ENABLED'), combat: flag('NOWPAYMENTS_COMBAT_ENABLED'),
    email: secret('NOWPAYMENTS_EMAIL'), password: secret('NOWPAYMENTS_PASSWORD'), twoFactorSecret: secret('NOWPAYMENTS_2FA_SECRET'),
    conversionMarginBps: Number(env.NOWPAYMENTS_CONVERSION_MARGIN_BPS ?? '100') };
  if (!Number.isInteger(config.conversionMarginBps) || config.conversionMarginBps < 50 || config.conversionMarginBps > 500) throw new Error('Invalid NOWPAYMENTS_CONVERSION_MARGIN_BPS');
  if (config.enabled) {
    const url = new URL(config.origin);
    if (url.protocol !== 'https:' || url.origin !== config.origin || !config.apiKey || config.ipnSecret.length < 16) throw new Error('Configure NOWPayments credentials and HTTPS PUBLIC_ORIGIN');
    if (config.withdrawals && (!config.email || !config.password || !/^[A-Z2-7]{16,128}=*$/i.test(config.twoFactorSecret))) throw new Error('Configure NOWPayments payout credentials and application 2FA');
    // Sandbox balances never enter the real-money ledger.
    if (config.sandbox) throw new Error('Use isolated provider mocks for tests; NOWPayments sandbox cannot fund the real wallet');
  }
  return config;
}

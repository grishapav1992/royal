import { TelegramBot, telegramStarsConfig } from '../server/payments/telegram-provider';

// Run only on the payment service with its own environment. Never print tokens or raw API replies.
const config = telegramStarsConfig();
if (!config.token) throw new Error('Configure the Telegram bot in the private payment-service environment first');
const bot = new TelegramBot(config);
const identity = await bot.call('getMe', {}) as { id: number; username: string };
if (identity.username.toLowerCase() !== config.username.toLowerCase() || String(identity.id) !== config.token.split(':')[0])
  throw new Error('Telegram bot identity differs from the configured bot');
const current = await bot.call('getWebhookInfo', {}) as { url: string; pending_update_count: number };
if (process.argv.includes('--set-webhook')) {
  const origin = new URL(process.env.TELEGRAM_STARS_PUBLIC_ORIGIN ?? '');
  if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password)
    throw new Error('Configure a public HTTPS origin without a path');
  const url = new URL('/api/telegram-stars/webhook', origin).href;
  if (current.url && current.url !== url) throw new Error('This bot already has another webhook; preserve its existing integration');
  await bot.call('setWebhook', { url, secret_token: config.webhookSecret, allowed_updates: ['message', 'pre_checkout_query'], drop_pending_updates: false });
}
const result = await bot.call('getWebhookInfo', {}) as { url: string; pending_update_count: number; last_error_date?: number };
console.log(JSON.stringify({ bot: identity.username, webhookConfigured: !!result.url,
  pendingUpdates: result.pending_update_count, lastErrorAt: result.last_error_date ?? null, acceptingNewOrders: config.enabled }));

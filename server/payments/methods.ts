import type { Application } from 'express';
import { PAYMENT_METHODS, RETIRED_PAYMENT_MESSAGE } from '../../src/shared/paymentMethods';

export function installPaymentMethods(app: Application) {
  app.get('/api/payment-methods', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ methods: PAYMENT_METHODS });
  });
  // Keep historical ledgers outside the active application; old URLs cannot fund a wallet.
  app.use(['/api/nile-wallet', '/api/nile-play', '/api/game-wallet', '/api/usdt-wallet'], (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.status(410).json({ code: 'PAYMENT_METHOD_RETIRED', error: RETIRED_PAYMENT_MESSAGE });
  });
}

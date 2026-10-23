import type { CryptoStore } from '../crypto/store';
import type { PaymentOutbox } from './outbox';

export function startPaymentWorkers(store: Pick<CryptoStore, 'config' | 'reconcile'>, outbox: Pick<PaymentOutbox, 'flush'>) {
  let delivery: Promise<void> | undefined, reconciliation: Promise<void> | undefined, lastReconcile = 0;
  const timer = setInterval(() => {
    if (!delivery) {
      delivery = outbox.flush().catch(() => {
        console.error('Payment event delivery failed; persisted events will be retried.');
      }).finally(() => { delivery = undefined; });
    }
    if (store.config.enabled && !reconciliation && Date.now() - lastReconcile >= 15000) {
      lastReconcile = Date.now();
      reconciliation = store.reconcile().catch(() => {
        console.error('Payment reconciliation failed; pending operations will be retried.');
      }).finally(() => { reconciliation = undefined; });
    }
  }, 1000);
  return async () => {
    clearInterval(timer);
    await Promise.allSettled([delivery, reconciliation]);
  };
}

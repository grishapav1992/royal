import { createPaymentRuntime } from '../server/payments/runtime';
import { gameAccountId } from '../src/shared/nileWallet';
import { providerId } from '../server/crypto/nowpayments';

const args = process.argv.slice(2);
const { db, store, outbox } = createPaymentRuntime();
try {
  await store.ready;
  if (args[0] === 'attach-conversion' && args.length === 3 && gameAccountId(args[1])) {
    await store.recoverConversion(args[1], providerId(args[2]));
    console.log(JSON.stringify({ ok: true, operationId: args[1], conversionAttached: true }));
  } else if (args[0] === 'attach-payment' && args.length === 2) {
    await store.applyPayment(await store.provider.payment(providerId(args[1])));
    console.log(JSON.stringify({ ok: true, paymentAttached: true }));
  } else if (args[0] === 'attach-payout' && args.length === 2) {
    await store.applyPayout(await store.provider.payout(providerId(args[1])));
    console.log(JSON.stringify({ ok: true, payoutAttached: true }));
  } else if (!args.length || args[0] === 'audit') {
    const report = await store.audit(); console.log(JSON.stringify(report)); if (!report.ok) process.exitCode = 1;
  } else throw new Error('Use audit, attach-conversion <operation UUID> <provider ID>, or attach-payout <provider ID>');
  await outbox.flush();
} catch { console.error('Crypto reconciliation failed. Check the selected operation and provider dashboard.'); process.exitCode = 1; }
finally { await db.close(); }

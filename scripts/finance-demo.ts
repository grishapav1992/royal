import { randomUUID } from 'node:crypto';
import { temporaryFinanceDatabase } from './finance-postgres';
import { parseUsdt } from '../server/finance/amount';

const db = await temporaryFinanceDatabase();
try {
  const { store } = db;
  await store.createUser('alice'); await store.createUser('bob');
  await store.execute('simulator', randomUUID(), 'simulate_capital', { amountUnits: parseUsdt('1000') });
  await store.execute('simulator', randomUUID(), 'simulate_deposit', { userId: 'alice', eventId: randomUUID(), amountUnits: parseUsdt('100') });
  await store.execute('alice', randomUUID(), 'transfer', { recipientId: 'bob', amountUnits: parseUsdt('20') });
  const roundId = randomUUID();
  await store.execute('bob', randomUUID(), 'reserve_game', { roundId, stakeUnits: parseUsdt('5'), maxPayoutUnits: parseUsdt('10') });
  await store.execute('game-simulator', randomUUID(), 'settle_game', { roundId, payoutUnits: parseUsdt('10') });
  const withdrawalId = randomUUID();
  await store.execute('bob', randomUUID(), 'reserve_withdrawal', { withdrawalId, destination: 'simulation:bob', amountUnits: parseUsdt('10'), feeUnits: '0' });
  await store.execute('simulator', randomUUID(), 'simulate_withdrawal_unknown', { withdrawalId });
  await store.execute('simulator', randomUUID(), 'simulate_withdrawal_confirm', { withdrawalId });
  console.log(JSON.stringify({ alice: await store.snapshot('alice'), bob: await store.snapshot('bob'), reconciliation: await store.reconcile() }, null, 2));
} finally { await db.cleanup(); }

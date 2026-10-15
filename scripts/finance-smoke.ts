import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { financeSecret, requireFinanceSimulation } from '../server/finance/config';
import { parseUsdt } from '../server/finance/amount';

requireFinanceSimulation();
const base = process.env.FINANCE_API_URL ?? 'http://127.0.0.1:2570';
const token = financeSecret('FINANCE_SANDBOX_TOKEN');
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
async function request(path: string, body?: unknown, key?: string, expectedStatus = 200) {
  const response = await fetch(`${base}${path}`, { method: body ? 'POST' : 'GET',
    headers: { ...headers, ...(key ? { 'Idempotency-Key': key } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
  const result = await response.json();
  assert.equal(response.status, expectedStatus, `Unexpected status for ${path}`);
  return result;
}
async function operation(actor: string, kind: string, body: Record<string, string>, key = randomUUID(), status = 200) {
  return request('/sandbox/operations', { actor, kind, body }, key, status);
}

const a = `servercheck_${randomUUID()}`, b = `servercheck_${randomUUID()}`;
await request('/sandbox/users', { userId: a }, undefined, 201);
await request('/sandbox/users', { userId: b }, undefined, 201);
await operation('simulator', 'simulate_capital', { amountUnits: parseUsdt('100') });
const depositKey = randomUUID(), depositBody = { userId: a, eventId: randomUUID(), amountUnits: parseUsdt('100') };
const first = await operation('simulator', 'simulate_deposit', depositBody, depositKey);
assert.deepEqual(await operation('simulator', 'simulate_deposit', depositBody, depositKey), first);
await operation(a, 'transfer', { recipientId: b, amountUnits: parseUsdt('20') });
const roundId = randomUUID();
await operation(b, 'reserve_game', { roundId, stakeUnits: parseUsdt('5'), maxPayoutUnits: parseUsdt('10') });
await operation('game-simulator', 'settle_game', { roundId, payoutUnits: parseUsdt('10') });
const withdrawalId = randomUUID();
await operation(b, 'reserve_withdrawal', { withdrawalId, destination: 'simulation:servercheck', amountUnits: parseUsdt('10'), feeUnits: '0' });
await operation('simulator', 'simulate_withdrawal_unknown', { withdrawalId });
await operation(b, 'cancel_withdrawal', { withdrawalId }, randomUUID(), 409);
const confirmKey = randomUUID();
const confirmed = await operation('simulator', 'simulate_withdrawal_confirm', { withdrawalId }, confirmKey);
assert.deepEqual(await operation('simulator', 'simulate_withdrawal_confirm', { withdrawalId }, confirmKey), confirmed);
const alice = await request(`/sandbox/wallets/${a}`), bob = await request(`/sandbox/wallets/${b}`);
assert.equal(alice.availableUnits, parseUsdt('80'));
assert.equal(bob.availableUnits, parseUsdt('15'));
assert.equal(bob.withdrawalReservedUnits, '0');
assert.equal(bob.gameReservedUnits, '0');
const reconciliation = await request('/sandbox/reconciliation');
assert.equal(reconciliation.ok, true);
assert.equal((await fetch(`${base}/sandbox/reconciliation`)).status, 401);
console.log(JSON.stringify({ environment: 'simulation', checks: 'deposit, duplicate, transfer, game, unknown withdrawal, confirmation, authentication, reconciliation',
  alice, bob, reconciliation }, null, 2));

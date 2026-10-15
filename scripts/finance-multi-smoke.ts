import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { financeSecret, requireFinanceSimulation } from '../server/finance/config';
import { parseUsdt } from '../server/finance/amount';
requireFinanceSimulation();
const base = 'http://finance-gateway:2570';
const headers = { Authorization: `Bearer ${financeSecret('FINANCE_SANDBOX_TOKEN')}`, 'Content-Type': 'application/json' };
async function request(path: string, body?: unknown, key?: string, expected = 200) {
    const response = await fetch(base + path, { method: body ? 'POST' : 'GET',
        headers: { ...headers, ...(key ? { 'Idempotency-Key': key } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
    assert.equal(response.status, expected, `Unexpected status for ${path}`);
    return { body: await response.json(), backend: response.headers.get('X-Finance-Backend') };
}
const operation = async (actor: string, kind: string, body: Record<string, string>, key: string, expected = 200) => await request('/sandbox/operations', { actor, kind, body }, key, expected);
const wallet = async (userId: string) => await request(`/sandbox/wallets/${userId}`);
type Fixture = {
    alice: string;
    bob: string;
    deposit: {
        key: string;
        body: Record<string, string>;
        result?: unknown;
    };
    withdrawal: {
        id: string;
        key: string;
        body: Record<string, string>;
        result?: unknown;
    };
    transfer: {
        key: string;
        body: Record<string, string>;
        result?: unknown;
    };
    extraDeposit: {
        key: string;
        body: Record<string, string>;
        result?: unknown;
    };
    confirmKey: string;
};
async function backends(userId: string, expected: number) {
    const deadline = Date.now() + 40000;
    while (true) {
        try {
            const responses = await Promise.all(Array.from({ length: 12 }, async () => await wallet(userId)));
            const seen = new Set(responses.map(response => response.backend));
            assert.ok(!seen.has(null));
            assert.equal(seen.size, expected);
            return [...seen].sort();
        }
        catch (error) {
            if (Date.now() > deadline)
                throw error;
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
}
async function checkWallet(fixture: Fixture, available: string, reserved: string, bob: string) {
    const a = (await wallet(fixture.alice)).body, b = (await wallet(fixture.bob)).body;
    assert.equal(a.availableUnits, parseUsdt(available));
    assert.equal(a.withdrawalReservedUnits, reserved === '0' ? '0' : parseUsdt(reserved));
    assert.equal(b.availableUnits, bob === '0' ? '0' : parseUsdt(bob));
    assert.equal((await request('/sandbox/reconciliation')).body.ok, true);
}
const stage = process.argv[2];
let fixture: Fixture;
if (stage === 'prepare') {
    const alice = `multicheck_${randomUUID()}`, bob = `multicheck_${randomUUID()}`, withdrawalId = randomUUID();
    fixture = { alice, bob,
        deposit: { key: randomUUID(), body: { userId: alice, eventId: randomUUID(), amountUnits: parseUsdt('100') } },
        withdrawal: { id: withdrawalId, key: randomUUID(), body: { withdrawalId, destination: 'simulation:multicheck', amountUnits: parseUsdt('20'), feeUnits: '0' } },
        transfer: { key: randomUUID(), body: { recipientId: bob, amountUnits: parseUsdt('10') } },
        extraDeposit: { key: randomUUID(), body: { userId: bob, eventId: randomUUID(), amountUnits: parseUsdt('5') } }, confirmKey: randomUUID() };
    await request('/sandbox/users', { userId: alice }, undefined, 201);
    await request('/sandbox/users', { userId: bob }, undefined, 201);
    const seen = await backends(alice, 2);
    const replies = await Promise.all(Array.from({ length: 16 }, async () => await operation('simulator', 'simulate_deposit', fixture.deposit.body, fixture.deposit.key)));
    fixture.deposit.result = replies[0].body;
    for (const reply of replies)
        assert.deepEqual(reply.body, fixture.deposit.result);
    assert.equal(new Set(replies.map(reply => reply.backend)).size, 2);
    assert.equal((await request(`/sandbox/wallets/${alice}/history`)).body.length, 1);
    await operation('simulator', 'simulate_deposit', { ...fixture.deposit.body, amountUnits: parseUsdt('101') }, fixture.deposit.key, 409);
    fixture.withdrawal.result = (await operation(alice, 'reserve_withdrawal', fixture.withdrawal.body, fixture.withdrawal.key)).body;
    await operation('simulator', 'simulate_withdrawal_unknown', { withdrawalId }, randomUUID());
    // Commit the transfer and discard its response body, then recover its result after node failure.
    const discarded = await fetch(base + '/sandbox/operations', { method: 'POST',
        headers: { ...headers, 'Idempotency-Key': fixture.transfer.key },
        body: JSON.stringify({ actor: alice, kind: 'transfer', body: fixture.transfer.body }), signal: AbortSignal.timeout(15000) });
    assert.equal(discarded.status, 200);
    await discarded.body?.cancel();
    await checkWallet(fixture, '70', '20', '10');
    console.log(JSON.stringify({ fixture, checks: { concurrent_replay: true, conflicting_body_rejected: true,
            backends: seen, discarded_transfer_response: true, unknown_withdrawal_preserved: true } }));
}
else {
    assert.ok(stage === 'after-failure' || stage === 'after-recovery');
    fixture = JSON.parse(readFileSync(0, 'utf8')) as Fixture;
    const seen = await backends(fixture.alice, stage === 'after-failure' ? 1 : 2);
    assert.deepEqual((await operation('simulator', 'simulate_deposit', fixture.deposit.body, fixture.deposit.key)).body, fixture.deposit.result);
    assert.deepEqual((await operation(fixture.alice, 'reserve_withdrawal', fixture.withdrawal.body, fixture.withdrawal.key)).body, fixture.withdrawal.result);
    await operation(fixture.alice, 'cancel_withdrawal', { withdrawalId: fixture.withdrawal.id }, randomUUID(), 409);
    const transfer = (await operation(fixture.alice, 'transfer', fixture.transfer.body, fixture.transfer.key)).body;
    const lookup = (await request(`/sandbox/operations/${fixture.alice}/${fixture.transfer.key}`)).body;
    assert.deepEqual(transfer, lookup);
    if (fixture.transfer.result)
        assert.deepEqual(transfer, fixture.transfer.result);
    fixture.transfer.result = transfer;
    const extra = (await operation('simulator', 'simulate_deposit', fixture.extraDeposit.body, fixture.extraDeposit.key)).body;
    if (fixture.extraDeposit.result)
        assert.deepEqual(extra, fixture.extraDeposit.result);
    fixture.extraDeposit.result = extra;
    if (stage === 'after-recovery') {
        const confirmed = await operation('simulator', 'simulate_withdrawal_confirm', { withdrawalId: fixture.withdrawal.id }, fixture.confirmKey);
        assert.deepEqual((await operation('simulator', 'simulate_withdrawal_confirm', { withdrawalId: fixture.withdrawal.id }, fixture.confirmKey)).body, confirmed.body);
    }
    await checkWallet(fixture, '70', stage === 'after-failure' ? '20' : '0', '15');
    console.log(JSON.stringify({ fixture, checks: { backends: seen, replay_after_process_change: true,
            discarded_response_recovered: true, new_payment_after_failure: true, reconciliation: true,
            withdrawal_finalized: stage === 'after-recovery' } }));
}

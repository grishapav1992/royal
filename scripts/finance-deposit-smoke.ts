import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { financeDatabaseConfig, financeSecret, requireFinanceSimulation } from '../server/finance/config';
import { FinanceStore } from '../server/finance/store';
import { DEPOSIT_GENESIS, DEPOSIT_NETWORK, DEPOSIT_TOKEN, simulationBlock,
  type DepositBlock, type DepositEvent, type SimulationManifest } from '../server/finance/deposits';

requireFinanceSimulation();
const base = 'http://finance-gateway:2570', token = financeSecret('FINANCE_SANDBOX_TOKEN');
async function request(path: string, body?: unknown) {
  const response = await fetch(base + path, { method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
  assert.ok(response.ok, `Unexpected HTTP status for ${path}`);
  return response.json();
}
type Fixture = { alice: string; bob: string; initialCursor: number; blocks: DepositBlock[]; conflicting: DepositBlock[] };
const pool = new pg.Pool(financeDatabaseConfig());
try {
  await new FinanceStore(pool).checkRuntimeRole();
  if (process.argv[2] === 'prepare') {
    const alice = `depositcheck_${randomUUID()}`, bob = `depositcheck_${randomUUID()}`;
    await request('/sandbox/users', { userId: alice }); await request('/sandbox/users', { userId: bob });
    const a = await request(`/sandbox/wallets/${alice}/deposit-address`, { network: DEPOSIT_NETWORK });
    const b = await request(`/sandbox/wallets/${bob}/deposit-address`, { network: DEPOSIT_NETWORK });
    assert.deepEqual(await request(`/sandbox/wallets/${alice}/deposit-address`, { network: DEPOSIT_NETWORK }), a);
    const stream = (await pool.query('SELECT * FROM royal_finance.deposit_streams')).rows[0];
    assert.equal(stream.halted_reason, null);
    const prior = (await pool.query('SELECT payload FROM royal_finance.deposit_blocks ORDER BY height')).rows.map(row => row.payload) as DepositBlock[];
    const initialCursor = Number(stream.cursor_height);
    assert.equal(prior.length, initialCursor);
    const log = (to: string, fields: Partial<DepositEvent> = {}): DepositEvent => ({
      txId: createHash('sha256').update(randomUUID()).digest('hex'), logIndex: 0, contract: DEPOSIT_TOKEN,
      from: 'simulation:external', to, amountUnits: '10000000', scale: 6, success: true, symbol: 'USDT', ...fields });
    const deposit = log(a.address);
    const first = simulationBlock(initialCursor + 1, stream.cursor_hash ?? DEPOSIT_GENESIS,
      [deposit, deposit, log(a.address, { contract: 'simulation:fake-usdt' }), log(a.address, { success: false }),
        log('simulation:unknown'), log(a.address, { from: b.address })]);
    const second = simulationBlock(initialCursor + 2, first.hash, [log(a.address, { amountUnits: '5000000' })]);
    const third = simulationBlock(initialCursor + 3, second.hash, [log(b.address, { amountUnits: '7000000' })]);
    const conflictingFirst = simulationBlock(first.height, first.parentHash, first.events.map(event =>
      event.txId === deposit.txId ? { ...event, amountUnits: '11000000' } : event));
    const fixture: Fixture = { alice, bob, initialCursor, blocks: [...prior, first, second, third], conflicting: [...prior, conflictingFirst] };
    const manifests = (blocks: DepositBlock[], finalizedHeight: number): [SimulationManifest, SimulationManifest] => [
      { network: DEPOSIT_NETWORK, sourceId: 'lab_source_a', finalizedHeight, blocks },
      { network: DEPOSIT_NETWORK, sourceId: 'lab_source_b', finalizedHeight, blocks }];
    const disagreement = manifests(fixture.blocks.slice(0, initialCursor + 1), initialCursor + 1);
    disagreement[1].blocks = fixture.conflicting;
    console.log(JSON.stringify({ fixture, pending: manifests(fixture.blocks, initialCursor), disagreement,
      first: manifests(fixture.blocks, initialCursor + 1), second: manifests(fixture.blocks, initialCursor + 2),
      third: manifests(fixture.blocks, initialCursor + 3) }));
  } else {
    const fixture = JSON.parse(readFileSync(0, 'utf8')) as Fixture, stage = process.argv[2];
    const expected = { pending: ['0', '0', 0], rejected: ['0', '0', 0], first: ['10000000', '0', 1],
      crashed: ['15000000', '0', 2], recovered: ['15000000', '0', 2], concurrent: ['15000000', '7000000', 3] } as const;
    assert.ok(Object.hasOwn(expected, stage));
    const [aliceUnits, bobUnits, delta] = expected[stage as keyof typeof expected];
    const a = await request(`/sandbox/wallets/${fixture.alice}`), b = await request(`/sandbox/wallets/${fixture.bob}`);
    assert.equal(a.availableUnits, aliceUnits); assert.equal(b.availableUnits, bobUnits);
    const cursor = Number((await pool.query('SELECT cursor_height FROM royal_finance.deposit_streams')).rows[0].cursor_height);
    assert.equal(cursor, fixture.initialCursor + delta);
    const reconciliation = await request('/sandbox/reconciliation');
    assert.equal(reconciliation.ok, true); assert.equal(reconciliation.deposit_halted_streams, 0);
    if (stage === 'concurrent') {
      assert.equal((await request(`/sandbox/wallets/${fixture.alice}/history`)).length, 2);
      assert.equal((await request(`/sandbox/wallets/${fixture.bob}/history`)).length, 1);
    }
    console.log(JSON.stringify({ stage, ok: true, cursor, alice_available_units: aliceUnits, bob_available_units: bobUnits, reconciliation: true }));
  }
} finally { await pool.end(); }

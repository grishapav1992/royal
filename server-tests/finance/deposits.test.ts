import { after, afterEach, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { temporaryFinanceDatabase } from '../../scripts/finance-postgres';
import { FinanceStore, migrateFinance } from '../../server/finance/store';
import { FINANCE_SCHEMA } from '../../server/finance/schema';
import { DEPOSIT_GENESIS, DEPOSIT_NETWORK, DEPOSIT_TOKEN, DepositScanError, checkDepositObserverRole, scanSimulatedDeposits, simulationBlock, simulationSource, type DepositEvent, type SimulationManifest } from '../../server/finance/deposits';
let db: Awaited<ReturnType<typeof temporaryFinanceDatabase>>, observer: pg.Pool;
before(async () => {
    db = await temporaryFinanceDatabase();
    await db.admin.query(`CREATE ROLE finance_ingest LOGIN PASSWORD ${pg.escapeLiteral(db.runtime.options.password as string)}`);
    await db.admin.query('GRANT royal_finance_observer TO finance_ingest');
    observer = new pg.Pool({ ...db.runtime.options, password: db.runtime.options.password, user: 'finance_ingest', max: 4 });
}, { timeout: 60000 });
beforeEach(async () => {
    await db.admin.query('DROP SCHEMA royal_finance CASCADE');
    await migrateFinance(db.admin);
});
afterEach(async () => { assert.equal((await db.store.reconcile()).ok, true); });
after(async () => { await observer?.end(); await db?.cleanup(); });
const code = (expected: string) => (error: unknown) => error instanceof DepositScanError && error.code === expected;
async function user() {
    const id = `deposit_${randomUUID()}`;
    await db.store.createUser(id);
    const address = await db.store.depositAddress(id);
    return { id, address: address.address };
}
function event(to: string, fields: Partial<DepositEvent> = {}): DepositEvent {
    return { txId: createHash('sha256').update(randomUUID()).digest('hex'), logIndex: 0, contract: DEPOSIT_TOKEN,
        from: 'simulation:external', to, amountUnits: '10000000', scale: 6, success: true, symbol: 'USDT', ...fields };
}
function manifest(events: DepositEvent[][], finalizedHeight = events.length): SimulationManifest {
    let parentHash = DEPOSIT_GENESIS;
    const blocks = events.map((logs, n) => {
        const block = simulationBlock(n + 1, parentHash, logs);
        parentHash = block.hash;
        return block;
    });
    return { network: DEPOSIT_NETWORK, sourceId: 'source_a', finalizedHeight, blocks };
}
const sources = (a: SimulationManifest, b: SimulationManifest = a) => [simulationSource(a), simulationSource({ ...b, sourceId: 'source_b' })];
const cursor = async () => Number((await observer.query('SELECT cursor_height FROM royal_finance.deposit_streams')).rows[0].cursor_height);
test('v1 migration preserves prior money, history and retry results', async () => {
    await db.admin.query('DROP SCHEMA royal_finance CASCADE');
    await db.admin.query(FINANCE_SCHEMA);
    const id = `migration_${randomUUID()}`, key = randomUUID();
    await db.store.createUser(id);
    const original = await db.store.execute('simulator', key, 'simulate_deposit', { userId: id, eventId: key, amountUnits: '123' });
    const history = await db.store.history(id);
    await migrateFinance(db.admin);
    await migrateFinance(db.admin);
    assert.deepEqual(await db.store.history(id), history);
    assert.deepEqual(await db.store.operation('simulator', key), original);
    assert.equal((await db.store.snapshot(id)).availableUnits, '123');
    await db.store.checkRuntimeRole();
    await checkDepositObserverRole(observer);
});
test('deposit address is stable under concurrent assignment and cannot be reassigned', async () => {
    const a = await user(), b = await user();
    const addresses = await Promise.all(Array.from({ length: 8 }, async () => await db.store.depositAddress(a.id)));
    assert.ok(addresses.every(value => value.address === a.address));
    assert.notEqual(a.address, b.address);
    await assert.rejects(db.admin.query('UPDATE royal_finance.deposit_addresses SET user_id=$1 WHERE address=$2', [b.id, a.address]));
    await assert.rejects(db.store.depositAddress('missing'));
});
test('unfinalized blocks cannot credit and can change before finality', async () => {
    const a = await user(), pending = manifest([[event(a.address)]], 0);
    assert.equal((await scanSimulatedDeposits(observer, sources(pending))).credited, 0);
    assert.equal(await cursor(), 0);
    assert.equal((await db.store.snapshot(a.id)).availableUnits, '0');
    const canonical = manifest([[event(a.address, { amountUnits: '5000000' })]]);
    assert.equal((await scanSimulatedDeposits(observer, sources(canonical))).credited, 1);
    assert.equal((await db.store.snapshot(a.id)).availableUnits, '5000000');
});
test('only supported successful external deposits credit; duplicates and dust use exact units', async () => {
    const a = await user(), own = await user(), valid = event(a.address, { amountUnits: '9007199254740993' });
    const logs = [valid, valid, event(a.address, { amountUnits: '1' }),
        event(a.address, { contract: 'simulation:fake-usdt', symbol: 'USDT' }),
        event(a.address, { success: false }), event(a.address, { scale: 18 }),
        event('simulation:unknown'), event(a.address, { from: own.address }),
        event(a.address, { from: 'simulation:tron-hot' }), event(a.address, { amountUnits: '01' }),
        event(a.address, { amountUnits: '0' }), event(a.address, { amountUnits: '1000000000000000000000000000001' })];
    const result = await scanSimulatedDeposits(observer, sources(manifest([logs])));
    assert.equal(result.credited, 2);
    assert.equal(result.ignored, 9);
    assert.equal((await db.store.snapshot(a.id)).availableUnits, '9007199254740994');
    const dispositions = (await db.runtime.query('SELECT DISTINCT disposition FROM royal_finance.deposit_events')).rows.map(row => row.disposition);
    assert.equal(dispositions.length, 7);
    assert.equal((await db.store.history(a.id)).length, 2);
    const retry = await scanSimulatedDeposits(observer, sources(manifest([logs])));
    assert.equal(retry.credited, 0);
    assert.equal((await db.store.snapshot(a.id)).availableUnits, '9007199254740994');
});
test('disagreeing sources, wrong network and malformed amounts cannot advance the cursor', async () => {
    const a = await user(), log = event(a.address), left = manifest([[log]]);
    const right = manifest([[{ ...log, amountUnits: '11000000' }]]);
    await assert.rejects(scanSimulatedDeposits(observer, sources(left, right)), code('source_disagreement'));
    const wrong = sources(left);
    wrong[1].finalizedTip = async () => ({ network: 'tron-mainnet', height: 1, hash: left.blocks[0].hash });
    await assert.rejects(scanSimulatedDeposits(observer, wrong), code('invalid_simulation_source'));
    assert.throws(() => simulationSource({ ...left, blocks: [{ ...left.blocks[0], events: [{ ...log, amountUnits: 10 }] }] }));
    assert.equal(await cursor(), 0);
    assert.equal((await db.store.snapshot(a.id)).availableUnits, '0');
    assert.equal((await scanSimulatedDeposits(observer, sources(left))).credited, 1);
});
test('a failure after commit recovers the cursor and never credits twice', async () => {
    const a = await user(), chain = manifest([[event(a.address)], [event(a.address, { amountUnits: '5000000' })]]);
    await assert.rejects(scanSimulatedDeposits(observer, sources(chain), { afterCommit: async () => { throw new Error('lost reply'); } }));
    assert.equal(await cursor(), 1);
    assert.equal((await db.store.snapshot(a.id)).availableUnits, '10000000');
    const fresh = new pg.Pool({ ...observer.options, password: observer.options.password });
    try {
        assert.equal((await scanSimulatedDeposits(fresh, sources(chain))).credited, 1);
    }
    finally {
        await fresh.end();
    }
    assert.equal(await cursor(), 2);
    assert.equal((await db.store.snapshot(a.id)).availableUnits, '15000000');
    assert.equal((await db.store.history(a.id)).length, 2);
});
test('failure between credit and cursor storage rolls back every financial and chain record', async () => {
    const a = await user(), chain = manifest([[event(a.address)]]);
    await db.admin.query(`CREATE FUNCTION royal_finance.fail_block() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'injected'; END $$;
    REVOKE ALL ON FUNCTION royal_finance.fail_block() FROM PUBLIC;
    CREATE TRIGGER fail_block BEFORE INSERT ON royal_finance.deposit_blocks FOR EACH ROW EXECUTE FUNCTION royal_finance.fail_block();`);
    try {
        await assert.rejects(scanSimulatedDeposits(observer, sources(chain)));
        assert.equal(await cursor(), 0);
        assert.equal((await db.store.snapshot(a.id)).availableUnits, '0');
        assert.equal((await db.runtime.query('SELECT count(*)::int AS n FROM royal_finance.deposit_events')).rows[0].n, 0);
        assert.equal((await db.store.history(a.id)).length, 0);
    }
    finally {
        await db.admin.query('DROP TRIGGER fail_block ON royal_finance.deposit_blocks; DROP FUNCTION royal_finance.fail_block()');
    }
    assert.equal((await scanSimulatedDeposits(observer, sources(chain))).credited, 1);
});
test('missing blocks stop advancement and a confirmed reorganization durably halts the stream', async () => {
    const a = await user(), chain = manifest([[event(a.address)], [], []]);
    await assert.rejects(scanSimulatedDeposits(observer, sources({ ...chain, blocks: chain.blocks.filter(block => block.height !== 2) })), code('source_block_missing'));
    assert.equal(await cursor(), 1);
    const changed = manifest([[event(a.address, { amountUnits: '8000000' })], [], []]);
    await assert.rejects(scanSimulatedDeposits(observer, sources(changed)), code('finalized_block_changed'));
    assert.equal(await cursor(), 1);
    assert.equal((await db.store.snapshot(a.id)).availableUnits, '10000000');
    await assert.rejects(scanSimulatedDeposits(observer, sources(chain)), code('deposit_stream_halted'));
});
test('new tip disagreement cannot hide a shared change to an already credited block', async () => {
    const a = await user(), initial = manifest([[event(a.address)]]);
    await scanSimulatedDeposits(observer, sources(initial));
    const changed = manifest([[{ ...initial.blocks[0].events[0], amountUnits: '20000000' }], []]);
    const divergent = { ...changed, blocks: [changed.blocks[0], simulationBlock(2, changed.blocks[0].hash, [event(a.address)])] };
    await assert.rejects(scanSimulatedDeposits(observer, sources(changed, divergent)), code('finalized_block_changed'));
    assert.equal((await observer.query('SELECT halted_reason FROM royal_finance.deposit_streams')).rows[0].halted_reason, 'finalized_block_changed');
    assert.equal((await db.store.snapshot(a.id)).availableUnits, '10000000');
    await assert.rejects(scanSimulatedDeposits(observer, sources(initial)), code('deposit_stream_halted'));
});
test('duplicate transaction and log identities in later blocks reject all writes of that block', async () => {
    const a = await user(), log = event(a.address), chain = manifest([[log], [event(a.address), log]]);
    await assert.rejects(scanSimulatedDeposits(observer, sources(chain)));
    assert.equal(await cursor(), 1);
    assert.equal((await db.store.snapshot(a.id)).availableUnits, '10000000');
    assert.equal((await db.store.history(a.id)).length, 1);
});
test('concurrent observers serialize without keeping local ownership after a failure', async () => {
    const a = await user(), chain = manifest([[event(a.address)]]);
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const slow = sources(chain), tip = slow[0].finalizedTip;
    slow[0].finalizedTip = async () => { entered(); await gate; return tip(); };
    const first = scanSimulatedDeposits(observer, slow);
    await ready;
    try {
        assert.equal((await scanSimulatedDeposits(observer, sources(chain))).busy, true);
    }
    finally {
        release();
    }
    assert.equal((await first).credited, 1);
    assert.equal((await scanSimulatedDeposits(observer, sources(chain))).credited, 0);
});
test('observer cannot transfer, withdraw, assign addresses, alter rows or call private posting', async () => {
    await checkDepositObserverRole(observer);
    for (const sql of [
        "SELECT royal_finance.execute('simulator',gen_random_uuid(),'simulate_capital','{}')",
        "SELECT royal_finance.deposit_address('user')", "SELECT royal_finance.create_user('user')",
        "UPDATE royal_finance.deposit_streams SET cursor_height=99", "TRUNCATE royal_finance.deposit_events",
        "SELECT royal_finance.post_journal(gen_random_uuid(),'forged','forged',ARRAY[]::uuid[],ARRAY[]::numeric[])",
    ])
        await assert.rejects(observer.query(sql), error => (error as {
            code: string;
        }).code === '42501');
    await assert.rejects(db.runtime.query('SELECT royal_finance.ingest_deposit_block($1,$2)', [{}, ['a', 'b']]));
    await assert.rejects(checkDepositObserverRole(db.runtime), code('restricted_simulation_observer_required'));
    await assert.rejects(new FinanceStore(observer).checkRuntimeRole());
});
test('same source identity and corrupted simulation block hashes are rejected', async () => {
    const a = await user(), chain = manifest([[event(a.address)]]);
    await assert.rejects(scanSimulatedDeposits(observer, [simulationSource(chain), simulationSource(chain)]), code('two_distinct_sources_required'));
    assert.throws(() => simulationSource({ ...chain, blocks: [{ ...chain.blocks[0], hash: DEPOSIT_GENESIS }] }));
    assert.equal(await cursor(), 0);
});
test('non-inherited membership cannot conceal the ability to switch into a privileged role', async () => {
    await db.admin.query('GRANT royal_finance_runtime TO finance_ingest WITH INHERIT FALSE');
    try {
        await assert.rejects(checkDepositObserverRole(observer), code('restricted_simulation_observer_required'));
    }
    finally {
        await db.admin.query('REVOKE royal_finance_runtime FROM finance_ingest');
    }
    await db.admin.query('GRANT postgres TO finance_app WITH INHERIT FALSE');
    try {
        await assert.rejects(db.store.checkRuntimeRole());
    }
    finally {
        await db.admin.query('REVOKE postgres FROM finance_app');
    }
    await checkDepositObserverRole(observer);
    await db.store.checkRuntimeRole();
});
test('PostgreSQL restart preserves finality, processed events and deposit retry results', async () => {
    const a = await user(), chain = manifest([[event(a.address)]]);
    await scanSimulatedDeposits(observer, sources(chain));
    const history = await db.store.history(a.id), options = { ...observer.options, password: observer.options.password };
    await observer.end();
    db = await db.restart();
    observer = new pg.Pool(options);
    assert.equal((await scanSimulatedDeposits(observer, sources(chain))).credited, 0);
    assert.equal(await cursor(), 1);
    assert.deepEqual(await db.store.history(a.id), history);
    assert.equal((await db.store.depositAddress(a.id)).address, a.address);
});

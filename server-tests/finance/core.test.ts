import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { temporaryFinanceDatabase } from '../../scripts/finance-postgres';
import { amountUnits, parseUsdt, MAX_UNITS, FinanceError } from '../../server/finance/amount';
import { FinanceStore, migrateFinance } from '../../server/finance/store';
import { createFinanceSandboxApp } from '../../server/finance/app';
let db: Awaited<ReturnType<typeof temporaryFinanceDatabase>>;
before(async () => {
    db = await temporaryFinanceDatabase();
    await db.store.execute('simulator', randomUUID(), 'simulate_capital', { amountUnits: parseUsdt('10000') });
}, { timeout: 60000 });
after(async () => { await db?.cleanup(); });
afterEach(async () => {
    if (db)
        assert.equal((await db.store.reconcile()).ok, true);
});
const identity = () => `user_${randomUUID()}`;
const conflict = (error: unknown) => error instanceof FinanceError && error.status === 409;
const forbidden = (error: unknown) => error instanceof FinanceError && error.status === 403;
async function user(balance = '0') {
    const id = identity();
    await db.store.createUser(id);
    if (balance !== '0')
        await deposit(id, balance);
    return id;
}
async function deposit(userId: string, amount: string, key = randomUUID(), eventId = randomUUID()) {
    return db.store.execute('simulator', key, 'simulate_deposit', { userId, eventId, amountUnits: amount });
}
async function reserve(userId: string, amount: string, fee = '0') {
    const withdrawalId = randomUUID();
    await db.store.execute(userId, randomUUID(), 'reserve_withdrawal', { withdrawalId, destination: 'simulation:recipient', amountUnits: amount, feeUnits: fee });
    return withdrawalId;
}
test('money uses exact integer strings and rejects ambiguous or rounded input', () => {
    assert.equal(parseUsdt('9007199254.740993'), '9007199254740993');
    assert.equal(parseUsdt('0.000001'), '1');
    assert.equal(parseUsdt('20.1'), '20100000');
    assert.equal(amountUnits(MAX_UNITS.toString()), MAX_UNITS.toString());
    for (const invalid of [0, 1, NaN, Infinity, '0', '-1', '01', ' 1', '1 ', '1.0', '1e6', (MAX_UNITS + 1n).toString()]) {
        assert.throws(() => amountUnits(invalid));
    }
    for (const invalid of [1.2, '0', '01', '1.0000001', '1.', '+1', '1e2'])
        assert.throws(() => parseUsdt(invalid));
});
test('a read-only database connection is excluded by API readiness', async () => {
    const pool = new pg.Pool({ ...db.runtime.options, password: db.runtime.options.password,
        max: 1, options: '-c default_transaction_read_only=on' });
    const app = createFinanceSandboxApp(new FinanceStore(pool), 'a'.repeat(64));
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as {
        port: number;
    }).port}`;
    try {
        const response = await fetch(`${base}/healthz`);
        assert.equal(response.status, 503);
        assert.equal((await response.json()).database, 'read_only');
        const write = await fetch(`${base}/sandbox/users`, { method: 'POST',
            headers: { Authorization: `Bearer ${'a'.repeat(64)}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: identity() }) });
        assert.equal(write.status, 503);
    }
    finally {
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        await pool.end();
    }
});
test('complete deposit, transfer, funded game and withdrawal reconcile including fees', async () => {
    const alice = await user(parseUsdt('100')), bob = await user();
    await db.store.execute(alice, randomUUID(), 'transfer', { recipientId: bob, amountUnits: parseUsdt('20') });
    const roundId = randomUUID();
    await db.store.execute(bob, randomUUID(), 'reserve_game', { roundId, stakeUnits: parseUsdt('5'), maxPayoutUnits: parseUsdt('10') });
    await db.store.execute('game-simulator', randomUUID(), 'settle_game', { roundId, payoutUnits: parseUsdt('10') });
    const withdrawalId = await reserve(bob, parseUsdt('10'), parseUsdt('1'));
    await db.store.execute('simulator', randomUUID(), 'simulate_withdrawal_confirm', { withdrawalId });
    assert.equal((await db.store.snapshot(alice)).availableUnits, parseUsdt('80'));
    const b = await db.store.snapshot(bob);
    assert.equal(b.availableUnits, parseUsdt('14'));
    assert.equal(b.withdrawalReservedUnits, '0');
    assert.equal(b.gameReservedUnits, '0');
});
test('a deposit above JavaScript safe integer range stays exact', async () => {
    const alice = await user('9007199254740993'), bob = await user();
    await db.store.execute(alice, randomUUID(), 'transfer', { recipientId: bob, amountUnits: '1' });
    assert.equal((await db.store.snapshot(alice)).availableUnits, '9007199254740992');
    assert.equal((await db.store.snapshot(bob)).availableUnits, '1');
});
test('concurrent identical requests commit one journal and one outbox event', async () => {
    const id = await user(), key = randomUUID(), eventId = randomUUID();
    const results = await Promise.all(Array.from({ length: 16 }, async () => await deposit(id, '100', key, eventId)));
    assert.equal(new Set(results.map(result => result.operationId)).size, 1);
    assert.equal((await db.store.snapshot(id)).availableUnits, '100');
    const { rows } = await db.runtime.query('SELECT count(*)::int AS n FROM royal_finance.outbox WHERE actor=$1 AND request_key=$2', ['simulator', key]);
    assert.equal(rows[0].n, 1);
    assert.equal((await db.store.history(id)).length, 1);
    await assert.rejects(deposit(id, '200', key, eventId), conflict);
});
test('deposit source cannot be reused with another key, amount or user', async () => {
    const a = await user(), b = await user(), eventId = randomUUID();
    await deposit(a, '100', randomUUID(), eventId);
    await assert.rejects(deposit(a, '100', randomUUID(), eventId), conflict);
    await assert.rejects(deposit(b, '200', randomUUID(), eventId), conflict);
    assert.equal((await db.store.snapshot(a)).availableUnits, '100');
    assert.equal((await db.store.snapshot(b)).availableUnits, '0');
});
test('replay from a new service connection returns the original result', async () => {
    const id = await user(), key = randomUUID(), eventId = randomUUID();
    const result = await deposit(id, '100', key, eventId);
    const newPool = new pg.Pool(db.runtime.options);
    try {
        const restarted = new FinanceStore(newPool);
        await restarted.checkRuntimeRole();
        assert.deepEqual(await restarted.execute('simulator', key, 'simulate_deposit', { userId: id, eventId, amountUnits: '100' }), result);
        assert.deepEqual(await restarted.operation('simulator', key), result);
        assert.equal((await restarted.snapshot(id)).availableUnits, '100');
    }
    finally {
        await newPool.end();
    }
});
test('competing transfer, withdrawal and game cannot spend the same balance', async () => {
    const a = await user('100'), b = await user();
    const results = await Promise.allSettled([
        db.store.execute(a, randomUUID(), 'transfer', { recipientId: b, amountUnits: '100' }),
        db.store.execute(a, randomUUID(), 'reserve_withdrawal', { withdrawalId: randomUUID(), destination: 'simulation:a', amountUnits: '100', feeUnits: '0' }),
        db.store.execute(a, randomUUID(), 'reserve_game', { roundId: randomUUID(), stakeUnits: '100', maxPayoutUnits: '100' }),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected').length, 2);
    assert.equal((await db.store.snapshot(a)).availableUnits, '0');
});
test('opposite concurrent transfers use consistent account lock ordering', async () => {
    const a = await user('100'), b = await user('100');
    await Promise.all(Array.from({ length: 12 }, async (_, i) => await db.store.execute(i % 2 ? a : b, randomUUID(), 'transfer', {
        recipientId: i % 2 ? b : a, amountUnits: '1',
    })));
    assert.equal((await db.store.snapshot(a)).availableUnits, '100');
    assert.equal((await db.store.snapshot(b)).availableUnits, '100');
});
test('unknown withdrawal keeps its reservation and cannot be cancelled or repeated', async () => {
    const a = await user('100'), withdrawalId = await reserve(a, '80', '2');
    assert.equal((await db.store.snapshot(a)).availableUnits, '18');
    await db.store.execute('simulator', randomUUID(), 'simulate_withdrawal_unknown', { withdrawalId });
    await assert.rejects(db.store.execute(a, randomUUID(), 'cancel_withdrawal', { withdrawalId }), conflict);
    await assert.rejects(db.store.execute('simulator', randomUUID(), 'simulate_withdrawal_unknown', { withdrawalId }), conflict);
    assert.equal((await db.store.snapshot(a)).withdrawalReservedUnits, '82');
    const key = randomUUID();
    const result = await db.store.execute('simulator', key, 'simulate_withdrawal_confirm', { withdrawalId });
    assert.deepEqual(await db.store.execute('simulator', key, 'simulate_withdrawal_confirm', { withdrawalId }), result);
    await assert.rejects(db.store.execute('simulator', randomUUID(), 'simulate_withdrawal_confirm', { withdrawalId }), conflict);
    assert.equal((await db.store.snapshot(a)).withdrawalReservedUnits, '0');
});
test('withdrawal cancellation and confirmation have one final outcome under concurrency', async () => {
    const a = await user('100'), withdrawalId = await reserve(a, '50');
    const results = await Promise.allSettled([
        db.store.execute(a, randomUUID(), 'cancel_withdrawal', { withdrawalId }),
        db.store.execute('simulator', randomUUID(), 'simulate_withdrawal_confirm', { withdrawalId }),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal((await db.store.snapshot(a)).withdrawalReservedUnits, '0');
});
test('another user cannot cancel a withdrawal or impersonate settlement actors', async () => {
    const a = await user('100'), b = await user(), withdrawalId = await reserve(a, '50');
    await assert.rejects(db.store.execute(b, randomUUID(), 'cancel_withdrawal', { withdrawalId }), forbidden);
    await assert.rejects(db.store.execute(a, randomUUID(), 'simulate_withdrawal_confirm', { withdrawalId }), forbidden);
    await assert.rejects(deposit('missing_user', '1'), error => error instanceof FinanceError && error.status === 404);
    await db.store.execute(a, randomUUID(), 'cancel_withdrawal', { withdrawalId });
    await assert.rejects(db.store.execute('simulator', randomUUID(), 'simulate_withdrawal_confirm', { withdrawalId }), conflict);
    assert.equal((await db.store.snapshot(a)).availableUnits, '100');
});
test('failed outbox insertion rolls back balances, journal, state and request key', async () => {
    const a = await user('100'), key = randomUUID(), withdrawalId = randomUUID();
    await db.admin.query(`CREATE FUNCTION royal_finance.test_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.kind='reserve_withdrawal' THEN RAISE EXCEPTION 'injected failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER test_failure BEFORE INSERT ON royal_finance.outbox FOR EACH ROW EXECUTE FUNCTION royal_finance.test_failure()`);
    try {
        await assert.rejects(db.store.execute(a, key, 'reserve_withdrawal', { withdrawalId, destination: 'simulation:a', amountUnits: '80', feeUnits: '0' }));
        assert.equal((await db.store.snapshot(a)).availableUnits, '100');
        assert.equal((await db.store.snapshot(a)).withdrawalReservedUnits, '0');
        assert.equal((await db.runtime.query('SELECT count(*)::int AS n FROM royal_finance.requests WHERE actor=$1 AND key=$2', [a, key])).rows[0].n, 0);
        assert.equal((await db.runtime.query('SELECT count(*)::int AS n FROM royal_finance.withdrawals WHERE id=$1', [withdrawalId])).rows[0].n, 0);
    }
    finally {
        await db.admin.query('DROP TRIGGER test_failure ON royal_finance.outbox; DROP FUNCTION royal_finance.test_failure()');
    }
    await db.store.execute(a, key, 'reserve_withdrawal', { withdrawalId, destination: 'simulation:a', amountUnits: '80', feeUnits: '0' });
    await db.store.execute(a, randomUUID(), 'cancel_withdrawal', { withdrawalId });
});
test('duplicate reserve identifiers and invalid destinations leave no partial reserve', async () => {
    const a = await user('100'), b = await user('100'), withdrawalId = await reserve(a, '10');
    await assert.rejects(db.store.execute(b, randomUUID(), 'reserve_withdrawal', { withdrawalId, destination: 'simulation:b', amountUnits: '10', feeUnits: '0' }), conflict);
    await assert.rejects(db.store.execute(b, randomUUID(), 'reserve_withdrawal', { withdrawalId: randomUUID(), destination: 'TActualCryptoAddress', amountUnits: '10', feeUnits: '0' }));
    assert.equal((await db.store.snapshot(b)).availableUnits, '100');
    assert.equal((await db.store.snapshot(b)).withdrawalReservedUnits, '0');
});
test('games require operator capital and enforce maximum payout', async () => {
    const a = await user('100'), roundId = randomUUID();
    await assert.rejects(db.store.execute(a, randomUUID(), 'reserve_game', { roundId, stakeUnits: '10', maxPayoutUnits: MAX_UNITS.toString() }), conflict);
    assert.equal((await db.store.snapshot(a)).availableUnits, '100');
    await db.store.execute(a, randomUUID(), 'reserve_game', { roundId, stakeUnits: '10', maxPayoutUnits: '20' });
    await assert.rejects(db.store.execute('game-simulator', randomUUID(), 'settle_game', { roundId, payoutUnits: '21' }), conflict);
    await assert.rejects(db.store.execute(a, randomUUID(), 'settle_game', { roundId, payoutUnits: '20' }), forbidden);
    const key = randomUUID();
    const result = await db.store.execute('game-simulator', key, 'settle_game', { roundId, payoutUnits: '20' });
    assert.deepEqual(await db.store.execute('game-simulator', key, 'settle_game', { roundId, payoutUnits: '20' }), result);
    await assert.rejects(db.store.execute('game-simulator', key, 'settle_game', { roundId, payoutUnits: '0' }), conflict);
    assert.equal((await db.store.snapshot(a)).availableUnits, '110');
});
test('game cancellation racing settlement releases stake and coverage exactly once', async () => {
    const a = await user('100'), roundId = randomUUID();
    await db.store.execute(a, randomUUID(), 'reserve_game', { roundId, stakeUnits: '10', maxPayoutUnits: '20' });
    const results = await Promise.allSettled([
        db.store.execute('game-simulator', randomUUID(), 'cancel_game', { roundId }),
        db.store.execute('game-simulator', randomUUID(), 'settle_game', { roundId, payoutUnits: '0' }),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal((await db.store.snapshot(a)).gameReservedUnits, '0');
});
test('reserved funds are unavailable to transfers, and cancelled games return them', async () => {
    const a = await user('100'), b = await user(), roundId = randomUUID();
    await db.store.execute(a, randomUUID(), 'reserve_game', { roundId, stakeUnits: '100', maxPayoutUnits: '100' });
    await assert.rejects(db.store.execute(a, randomUUID(), 'transfer', { recipientId: b, amountUnits: '1' }), conflict);
    await db.store.execute('game-simulator', randomUUID(), 'cancel_game', { roundId });
    assert.equal((await db.store.snapshot(a)).availableUnits, '100');
});
test('runtime cannot write financial tables, call private posting or use elevated credentials', async () => {
    for (const sql of [
        "UPDATE royal_finance.accounts SET balance=balance+1",
        "DELETE FROM royal_finance.entries",
        "TRUNCATE royal_finance.requests CASCADE",
        "INSERT INTO royal_finance.journals(id,kind,source) VALUES (gen_random_uuid(),'forged','forged')",
        "SELECT royal_finance.post_journal(gen_random_uuid(),'forged','forged',ARRAY[]::uuid[],ARRAY[]::numeric[])",
        "CREATE FUNCTION royal_finance.forged() RETURNS int LANGUAGE sql AS 'SELECT 1'",
    ])
        await assert.rejects(db.runtime.query(sql), error => (error as {
            code: string;
        }).code === '42501');
    await assert.rejects(new FinanceStore(db.admin).checkRuntimeRole());
});
test('startup also rejects replication and RLS bypass privileges on the runtime role', async () => {
    for (const capability of ['REPLICATION', 'BYPASSRLS']) {
        await db.admin.query(`ALTER ROLE finance_app ${capability}`);
        try {
            await assert.rejects(db.store.checkRuntimeRole());
        }
        finally {
            await db.admin.query(`ALTER ROLE finance_app NO${capability}`);
        }
    }
    await db.store.checkRuntimeRole();
});
test('database validates direct function calls, blocking extra fields and imprecise amounts', async () => {
    const a = await user();
    for (const body of [
        { userId: a, eventId: randomUUID(), amountUnits: 100 },
        { userId: a, eventId: randomUUID(), amountUnits: '1.5' },
        { userId: a, eventId: randomUUID(), amountUnits: '100', payout: '999' },
    ])
        await assert.rejects(db.runtime.query('SELECT royal_finance.execute($1,$2,$3,$4)', ['simulator', randomUUID(), 'simulate_deposit', body]));
    assert.equal((await db.store.snapshot(a)).availableUnits, '0');
});
test('database constraints reject broken balance caches and incomplete journals even for owner', async () => {
    const a = await user('100');
    await assert.rejects(db.admin.query('UPDATE royal_finance.accounts SET balance=101 WHERE owner_id=$1 AND bucket=$2', [a, 'available']), error => (error as {
        code: string;
    }).code === '23514');
    await assert.rejects(db.admin.query("INSERT INTO royal_finance.journals(id,kind,source) VALUES (gen_random_uuid(),'broken',$1)", [randomUUID()]), error => (error as {
        code: string;
    }).code === '23514');
    const { rows } = await db.runtime.query('SELECT journal_id FROM royal_finance.entries LIMIT 1');
    await assert.rejects(db.admin.query('UPDATE royal_finance.entries SET delta=delta+1 WHERE journal_id=$1', [rows[0].journal_id]), error => (error as {
        code: string;
    }).code === '23514');
    await assert.rejects(db.admin.query(`INSERT INTO royal_finance.entries(journal_id,position,account_id,delta)
    SELECT $1,999,id,1 FROM royal_finance.accounts LIMIT 1`, [rows[0].journal_id]), error => (error as {
        code: string;
    }).code === '23514');
});
test('startup rejects accidentally granted write privileges', async () => {
    await db.admin.query('GRANT UPDATE ON royal_finance.withdrawals TO finance_app');
    try {
        await assert.rejects(db.store.checkRuntimeRole());
    }
    finally {
        await db.admin.query('REVOKE UPDATE ON royal_finance.withdrawals FROM finance_app');
    }
    await db.store.checkRuntimeRole();
});
test('database restart preserves a completed payment and an unknown reserved withdrawal', async () => {
    const id = await user(), key = randomUUID(), eventId = randomUUID();
    const first = await deposit(id, '100', key, eventId);
    const withdrawalId = await reserve(id, '80');
    await db.store.execute('simulator', randomUUID(), 'simulate_withdrawal_unknown', { withdrawalId });
    db = await db.restart();
    assert.deepEqual(await deposit(id, '100', key, eventId), first);
    assert.equal((await db.store.snapshot(id)).availableUnits, '20');
    assert.equal((await db.store.snapshot(id)).withdrawalReservedUnits, '80');
    await assert.rejects(db.store.execute(id, randomUUID(), 'cancel_withdrawal', { withdrawalId }), conflict);
    await db.store.execute('simulator', randomUUID(), 'simulate_withdrawal_confirm', { withdrawalId });
});
test('rerunning migrations preserves balances and operation history', async () => {
    const a = await user('100'), before = await db.store.history(a);
    await migrateFinance(db.admin);
    assert.deepEqual(await db.store.history(a), before);
    assert.equal((await db.store.snapshot(a)).availableUnits, '100');
});
test('service refuses production and an unspecified simulation mode before connecting', () => {
    for (const env of [{ NODE_ENV: 'production', FINANCE_MODE: 'simulation' }, { NODE_ENV: 'test', FINANCE_MODE: '' }]) {
        const result = spawnSync(process.execPath, ['--import', 'tsx', 'server/finance/index.ts'], {
            env: { ...process.env, ...env, FINANCE_DATABASE_URL: '', FINANCE_SANDBOX_TOKEN: '' }, encoding: 'utf8', timeout: 10000,
        });
        assert.equal(result.status, 1);
        assert.match(result.stderr, /Only an explicitly enabled non-production finance simulation/);
    }
});
test('HTTP sandbox requires service authentication, rejects browser access and keeps immutable operation results', async () => {
    const token = 'a'.repeat(64), app = createFinanceSandboxApp(db.store, token);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const origin = `http://127.0.0.1:${(server.address() as {
        port: number;
    }).port}`;
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    try {
        assert.equal((await fetch(`${origin}/sandbox/reconciliation`)).status, 401);
        assert.equal((await fetch(`${origin}/sandbox/reconciliation`, { headers: { ...headers, Origin: 'http://evil.example' } })).status, 403);
        const id = identity();
        assert.equal((await fetch(`${origin}/sandbox/users`, { method: 'POST', headers, body: JSON.stringify({ userId: id }) })).status, 201);
        const key = randomUUID(), payload = { actor: 'simulator', kind: 'simulate_deposit', body: { userId: id, eventId: randomUUID(), amountUnits: '100' } };
        const send = async () => await fetch(`${origin}/sandbox/operations`, { method: 'POST', headers: { ...headers, 'Idempotency-Key': key }, body: JSON.stringify(payload) });
        const first = await send();
        assert.equal(first.status, 200);
        const firstBody = await first.json();
        assert.deepEqual(await (await send()).json(), firstBody);
        assert.equal((await (await fetch(`${origin}/sandbox/wallets/${id}`, { headers })).json()).availableUnits, '100');
        const lookup = await fetch(`${origin}/sandbox/operations/simulator/${key}`, { headers });
        assert.deepEqual(await lookup.json(), firstBody);
        assert.equal((await fetch(`${origin}/sandbox/operations`, { method: 'POST', headers, body: JSON.stringify(payload) })).status, 400);
        assert.equal((await fetch(`${origin}/sandbox/users`, { method: 'POST', headers, body: '{bad' })).status, 400);
        assert.equal((await fetch(`${origin}/sandbox/users`, { method: 'POST', headers, body: JSON.stringify({ userId: identity(), extra: 'no' }) })).status, 400);
        assert.equal((await (await fetch(`${origin}/sandbox/reconciliation`, { headers })).json()).ok, true);
    }
    finally {
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
});

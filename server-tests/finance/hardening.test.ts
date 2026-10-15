import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { temporaryFinanceDatabase } from '../../scripts/finance-postgres';
import { FinanceStore, migrateFinance } from '../../server/finance/store';
import { FINANCE_SCHEMA } from '../../server/finance/schema';
import { FINANCE_DEPOSIT_MIGRATION } from '../../server/finance/deposit-schema';
import { createFinanceSandboxApp } from '../../server/finance/app';
let db: Awaited<ReturnType<typeof temporaryFinanceDatabase>>;
before(async () => { db = await temporaryFinanceDatabase(); }, { timeout: 60000 });
beforeEach(async () => { await db.admin.query('DROP SCHEMA royal_finance CASCADE'); await migrateFinance(db.admin); });
after(async () => { await db?.cleanup(); });
test('v2 upgrade preserves accounts, history and retry keys and derives independent entry totals', async () => {
    await db.admin.query('DROP SCHEMA royal_finance CASCADE');
    await db.admin.query(FINANCE_SCHEMA);
    await db.admin.query(FINANCE_DEPOSIT_MIGRATION);
    await db.store.createUser('upgrade');
    const key = randomUUID(), result = await db.store.execute('simulator', key, 'simulate_deposit', { userId: 'upgrade', eventId: key, amountUnits: '1234567' });
    const address = await db.store.depositAddress('upgrade'), history = await db.store.history('upgrade');
    await migrateFinance(db.admin);
    await migrateFinance(db.admin);
    assert.deepEqual(await db.store.history('upgrade'), history);
    assert.deepEqual(await db.store.operation('simulator', key), result);
    assert.deepEqual(await db.store.depositAddress('upgrade'), address);
    assert.equal((await db.store.reconcile()).ok, true);
    assert.equal((await db.runtime.query('SELECT count(*)::int AS n FROM royal_finance.account_totals')).rows[0].n, 6);
});
test('entry totals reject direct alteration and reject balanced entries without corresponding balances', async () => {
    await db.store.createUser('integrity');
    for (const statement of ['UPDATE royal_finance.account_totals SET balance=balance+1', 'DELETE FROM royal_finance.account_totals', 'TRUNCATE royal_finance.account_totals']) {
        await assert.rejects(db.admin.query(statement), error => (error as {
            code: string;
        }).code === '23514');
    }
    const journal = randomUUID(), client = await db.admin.connect();
    try {
        await client.query('BEGIN');
        await client.query("INSERT INTO royal_finance.journals(id,kind,source) VALUES ($1::uuid,'forged',$1::uuid::text)", [journal]);
        await client.query(`INSERT INTO royal_finance.entries(journal_id,position,account_id,delta)
      SELECT $1::uuid,0,id,-1 FROM royal_finance.accounts WHERE bucket='assets' UNION ALL
      SELECT $1::uuid,1,id,1 FROM royal_finance.accounts WHERE owner_id='integrity' AND bucket='available'`, [journal]);
        await assert.rejects(client.query('COMMIT'), error => (error as {
            code: string;
        }).code === '23514');
        await client.query('ROLLBACK');
    }
    finally {
        await client.query('ROLLBACK');
        client.release();
    }
    assert.equal((await db.store.snapshot('integrity')).availableUnits, '0');
    assert.equal((await db.store.reconcile()).ok, true);
});
test('readiness and authenticated operations reject privilege drift after startup and recover after revocation', async () => {
    const token = randomBytes(32).toString('hex'), app = createFinanceSandboxApp(db.store, token);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as {
        port: number;
    }).port}`;
    const request = async () => await fetch(base + '/sandbox/users', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: '{"userId":"drift"}' });
    try {
        assert.equal((await fetch(base + '/healthz')).status, 200);
        for (const [grant, revoke] of [
            ['GRANT UPDATE(balance) ON royal_finance.accounts TO finance_app', 'REVOKE UPDATE(balance) ON royal_finance.accounts FROM finance_app'],
            ['GRANT postgres TO finance_app WITH INHERIT FALSE', 'REVOKE postgres FROM finance_app'],
            ['GRANT pg_execute_server_program TO finance_app WITH INHERIT FALSE', 'REVOKE pg_execute_server_program FROM finance_app'],
        ]) {
            await db.admin.query(grant);
            try {
                assert.equal((await fetch(base + '/healthz')).status, 503);
                assert.equal((await request()).status, 503);
                assert.equal((await db.store.reconcile()).ok, false);
            }
            finally {
                await db.admin.query(revoke);
            }
            assert.equal((await fetch(base + '/healthz')).status, 200);
        }
        assert.equal((await request()).status, 201);
    }
    finally {
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
});
test('function overloads cannot bypass the restricted role profile', async () => {
    await db.admin.query('CREATE FUNCTION royal_finance.execute() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$');
    try {
        await assert.rejects(db.store.checkRuntimeRole());
    }
    finally {
        await db.admin.query('DROP FUNCTION royal_finance.execute()');
    }
    await db.store.checkRuntimeRole();
});
test('transaction timeout includes deferred commit work and rolls back journals, totals and request keys', async () => {
    await db.store.createUser('bounded');
    await db.admin.query(`CREATE FUNCTION royal_finance.slow_commit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN PERFORM pg_sleep(0.4); RETURN NULL; END $$;
    REVOKE ALL ON FUNCTION royal_finance.slow_commit() FROM PUBLIC;
    CREATE CONSTRAINT TRIGGER slow_commit AFTER INSERT ON royal_finance.journals
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION royal_finance.slow_commit();`);
    const pool = new pg.Pool({ ...db.runtime.options, password: db.runtime.options.password, options: '-c transaction_timeout=150' });
    pool.on('error', () => { });
    const store = new FinanceStore(pool), key = randomUUID();
    try {
        assert.equal((await pool.query('SHOW transaction_timeout')).rows[0].transaction_timeout, '150ms');
        await assert.rejects(store.execute('simulator', key, 'simulate_deposit', { userId: 'bounded', eventId: key, amountUnits: '10' }));
        assert.equal((await db.store.snapshot('bounded')).availableUnits, '0');
        assert.equal((await db.store.reconcile()).ok, true);
        await assert.rejects(db.store.operation('simulator', key));
    }
    finally {
        await pool.end();
    }
});

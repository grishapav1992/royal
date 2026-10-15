import assert from 'node:assert/strict';
import pg from 'pg';
import { financeDatabaseConfig, requireFinanceSimulation } from '../server/finance/config';
requireFinanceSimulation();
assert.equal(process.env.FINANCE_TLS_TEST, 'isolated-container');
const config = financeDatabaseConfig();
const pool = new pg.Pool(config);
try {
    const { rows } = await pool.query('SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()');
    assert.equal(rows[0].ssl, true);
}
finally {
    await pool.end();
}
for (const [name, modified, expected] of [
    ['untrusted_certificate', { ...process.env, FINANCE_DB_CA_FILE: '' }, 'DEPTH_ZERO_SELF_SIGNED_CERT'],
    ['wrong_hostname', { ...process.env, FINANCE_DB_HOST: 'wrong-finance-db' }, 'ERR_TLS_CERT_ALTNAME_INVALID'],
] as const) {
    const client = new pg.Client(financeDatabaseConfig(false, modified));
    try {
        await assert.rejects(client.connect(), error => (error as {
            code?: string;
        }).code === expected);
        console.log(JSON.stringify({ check: name, rejected: true }));
    }
    finally {
        await client.end();
    }
}
console.log(JSON.stringify({ check: 'verified_postgres_tls', ok: true }));

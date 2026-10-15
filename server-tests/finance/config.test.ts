import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { financeBindHost, financeDatabaseConfig, financeSecret, requireFinanceSimulation } from '../../server/finance/config';
test('container configuration reads secret files without requiring secrets in environment values', () => {
    const dir = mkdtempSync(join(tmpdir(), 'royal-finance-config-'));
    const file = join(dir, 'secret');
    writeFileSync(file, 'a'.repeat(64) + '\n', { mode: 0o600 });
    const env = { FINANCE_DB_HOST: 'finance-db', FINANCE_DB_NAME: 'royal_finance_sim', FINANCE_DB_USER: 'finance_app',
        FINANCE_DB_PASSWORD_FILE: file, FINANCE_SANDBOX_TOKEN_FILE: file };
    try {
        const config = financeDatabaseConfig(false, env);
        assert.equal(config.host, 'finance-db');
        assert.equal(config.user, 'finance_app');
        assert.equal(config.password, 'a'.repeat(64));
        assert.equal(config.options, '-c transaction_timeout=15000');
        assert.equal(financeSecret('FINANCE_SANDBOX_TOKEN', env), 'a'.repeat(64));
        assert.throws(() => financeDatabaseConfig(false, { ...env, FINANCE_DB_PORT: '0' }));
        assert.throws(() => financeSecret('MISSING', {}));
    }
    finally {
        rmSync(dir, { recursive: true });
    }
});
test('external database TLS verifies certificates and rejects URL options that can weaken verification', () => {
    const dir = mkdtempSync(join(tmpdir(), 'royal-finance-tls-config-'));
    const file = join(dir, 'database-url'), ca = join(dir, 'ca.pem');
    const url = 'postgres://finance_app:local-test-password@db.example.com/finance';
    writeFileSync(file, url, { mode: 0o600 });
    writeFileSync(ca, 'test-ca');
    const env = { FINANCE_DATABASE_URL_FILE: file, FINANCE_DB_TLS: 'verify-full', FINANCE_DB_CA_FILE: ca, FINANCE_DB_POOL_MAX: '5' };
    try {
        const config = financeDatabaseConfig(false, env);
        assert.equal(config.connectionString, url);
        assert.deepEqual(config.ssl, { rejectUnauthorized: true, ca: 'test-ca' });
        assert.equal(config.max, 5);
        for (const query of ['sslmode=no-verify', 'ssl=0', 'sslrootcert=/wrong', 'sslnegotiation=direct', 'uselibpqcompat=true', 'options=-c%20transaction_timeout=0']) {
            assert.throws(() => financeDatabaseConfig(false, { ...env, FINANCE_DATABASE_URL_FILE: '', FINANCE_DATABASE_URL: url + '?' + query }), /TLS/);
        }
        assert.throws(() => financeDatabaseConfig(false, { ...env, FINANCE_DB_TLS: 'require' }));
        assert.throws(() => financeDatabaseConfig(false, { ...env, FINANCE_DB_TLS: 'disabled' }));
        assert.throws(() => financeDatabaseConfig(false, { ...env, FINANCE_DB_POOL_MAX: '100' }));
        const malformed = 'postgres://:secret-password@invalid host/finance';
        assert.throws(() => financeDatabaseConfig(false, { FINANCE_DATABASE_URL: malformed }), error => error instanceof Error && !error.message.includes('secret-password'));
    }
    finally {
        rmSync(dir, { recursive: true });
    }
});
test('binding to all interfaces requires an explicit private Docker scope and simulation stays mandatory', () => {
    assert.equal(financeBindHost({}), '127.0.0.1');
    assert.throws(() => financeBindHost({ FINANCE_BIND_HOST: '0.0.0.0' }));
    assert.equal(financeBindHost({ FINANCE_BIND_HOST: '0.0.0.0', FINANCE_NETWORK_SCOPE: 'private-docker' }), '0.0.0.0');
    assert.throws(() => requireFinanceSimulation({ NODE_ENV: 'production', FINANCE_MODE: 'simulation' }));
    requireFinanceSimulation({ NODE_ENV: 'development', FINANCE_MODE: 'simulation' });
});

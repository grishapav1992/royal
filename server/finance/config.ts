import { readFileSync } from 'node:fs';
import type { PoolConfig } from 'pg';

export function requireFinanceSimulation(env: NodeJS.ProcessEnv = process.env) {
  if (env.FINANCE_MODE !== 'simulation' || env.NODE_ENV === 'production') {
    throw new Error('Only an explicitly enabled non-production finance simulation is supported');
  }
}

export function financeSecret(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const path = env[`${name}_FILE`];
  const value = path ? readFileSync(path, 'utf8').trim() : env[name];
  if (!value) throw new Error(`Set ${name} or ${name}_FILE`);
  return value;
}

export function financeDatabaseConfig(migration = false, env: NodeJS.ProcessEnv = process.env): PoolConfig {
  const tlsMode = env.FINANCE_DB_TLS ?? 'disabled';
  if (tlsMode !== 'disabled' && tlsMode !== 'verify-full') throw new Error('Finance TLS must be disabled or verify-full');
  if (env.FINANCE_DB_CA_FILE && tlsMode !== 'verify-full') throw new Error('A finance CA file requires verify-full TLS');
  const max = Number(env.FINANCE_DB_POOL_MAX ?? (migration ? '1' : '10'));
  if (!Number.isInteger(max) || max < 1 || max > 50) throw new Error('Finance pool size must be between 1 and 50');
  const common: PoolConfig = { max, connectionTimeoutMillis: 5000, statement_timeout: 10000,
    options: '-c transaction_timeout=15000',
    ssl: tlsMode === 'verify-full' ? { rejectUnauthorized: true,
      ...(env.FINANCE_DB_CA_FILE ? { ca: readFileSync(env.FINANCE_DB_CA_FILE, 'utf8') } : {}) } : false };
  const urlName = migration ? 'FINANCE_MIGRATION_DATABASE_URL' : 'FINANCE_DATABASE_URL';
  const url = env[urlName] || env[`${urlName}_FILE`] ? financeSecret(urlName, env) : undefined;
  if (url) {
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new Error('Invalid finance database URL'); }
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw new Error('Finance URL must use PostgreSQL');
    if ([...parsed.searchParams.keys()].some(key => /^ssl/i.test(key) || ['uselibpqcompat','options'].includes(key.toLowerCase()))) {
      throw new Error('Set finance TLS separately; connection URL TLS options can override certificate verification');
    }
    return { ...common, connectionString: url };
  }
  const port = Number(env.FINANCE_DB_PORT ?? '5432');
  if (!env.FINANCE_DB_HOST || !env.FINANCE_DB_NAME || !env.FINANCE_DB_USER || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Set a finance database URL or FINANCE_DB_HOST, FINANCE_DB_NAME and FINANCE_DB_USER');
  }
  return { ...common, host: env.FINANCE_DB_HOST, database: env.FINANCE_DB_NAME, user: env.FINANCE_DB_USER, port,
    password: financeSecret('FINANCE_DB_PASSWORD', env) };
}

export function financeBindHost(env: NodeJS.ProcessEnv = process.env): string {
  const host = env.FINANCE_BIND_HOST ?? '127.0.0.1';
  if (host === '127.0.0.1') return host;
  if (host === '0.0.0.0' && env.FINANCE_NETWORK_SCOPE === 'private-docker') return host;
  throw new Error('Finance binding requires localhost or an explicitly configured private Docker network');
}

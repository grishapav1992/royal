import { randomUUID } from 'node:crypto';
import type { AccountStore } from '../server/accounts';

type Phase = 'environment' | 'import' | 'ready' | 'login' | 'select' | 'read' | 'close' | 'done';
let phase: Phase = 'environment', accounts: AccountStore | undefined;
const emit = (status: string | number, errorcode?: string) => process.stdout.write(JSON.stringify({ phase, status, ...(errorcode ? { errorcode } : {}) }) + '\n');
const bounded = async <T>(work: Promise<T>, milliseconds: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject({ code: 'probe-timeout' }), milliseconds); })]); }
  finally { if (timer) clearTimeout(timer); }
};
function reportError(error: unknown) {
  const value = error as { code?: unknown; status?: unknown } | null;
  const code = typeof value?.code === 'string' && /^(?:[0-9]{2}[0-9A-Z]{3}|ERR_CRYPTO_INVALID_SCRYPT_PARAMS|ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH|ERR_OUT_OF_RANGE|ECONNREFUSED|ECONNRESET|ETIMEDOUT|probe-timeout|probe-environment|probe-verification)$/.test(value.code)
    ? value.code : typeof value?.status === 'number' ? 'auth-error' : 'probe-error';
  emit(typeof value?.status === 'number' && Number.isInteger(value.status) && value.status >= 400 && value.status <= 599 ? value.status : 'failed', code);
}
async function run() {
  let passed = false;
  // Imported libraries cannot print account identifiers, tokens or raw errors.
  for (const key of ['log', 'info', 'debug', 'warn', 'error'] as const) console[key] = () => {};
  try {
    const port = Number(process.env.PGPORT);
    if (process.env.NODE_ENV !== 'test' || process.env.PGHOST !== '127.0.0.1' || process.env.PGDATABASE !== 'royal_test'
      || process.env.PGUSER !== 'postgres' || !process.env.PGPASSWORD || !Number.isInteger(port) || port < 1 || port > 65535
      || process.env.DATABASE_URL || process.env.DATABASE_URL_FILE || process.env.PGPASSWORD_FILE || process.env.PGSSLMODE !== 'disable') throw { code: 'probe-environment' };
    for (const key of Object.keys(process.env)) if (/^(?:NOWPAYMENTS_|CASINOAPIPRO_|NILE_|CODEX_SALE_)/.test(key)) delete process.env[key];
    Object.assign(process.env, { AUTH_DB_PATH: 'royal_websocket_load', PGPOOL_MAX: '10', NOWPAYMENTS_ENABLED: 'false', CASINOAPIPRO_ENABLED: 'false', CODEX_SALE_API_KEY: '' });
    await bounded((async () => {
      phase = 'import'; emit('started'); ({ accounts } = await import('../server/accounts'));
      phase = 'ready'; await accounts.ready; emit('passed');
      for (let index = 0; index < 6; index++) {
        phase = 'login'; emit('started');
        const login = await accounts.login(`cluster-load-${randomUUID()}@example.test`, 'Local-load-test-123!'); emit('passed');
        phase = 'select'; emit('started'); await accounts.select(login.account.id, index % 6); emit('passed');
        phase = 'read';
        const current = await accounts.currentAccount(login.account.id), session = await accounts.session(login.token);
        if (current?.skin !== index % 6 || session?.account.id !== login.account.id || session.account.skin !== index % 6) throw { code: 'probe-verification' };
        emit('passed');
      }
    })(), 45000);
    passed = true;
  } catch (error) { reportError(error); }
  finally {
    if (accounts) {
      phase = 'close';
      try { await bounded(accounts.close(), 6000); emit('passed'); }
      catch (error) { passed = false; reportError(error); }
    }
  }
  phase = 'done'; emit(passed ? 'passed' : 'failed'); process.exit(passed ? 0 : 1);
}
void run().catch(error => { reportError(error); process.exit(1); });

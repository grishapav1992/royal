import pg from 'pg';
import { createFinanceSandboxApp } from './app';
import { FinanceStore } from './store';
import { financeBindHost, financeDatabaseConfig, financeSecret, requireFinanceSimulation } from './config';

requireFinanceSimulation();
const token = financeSecret('FINANCE_SANDBOX_TOKEN');
const host = financeBindHost();
const port = Number(process.env.FINANCE_PORT ?? 2570);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('Set a valid FINANCE_PORT');
}
const pool = new pg.Pool(financeDatabaseConfig());
pool.on('error', () => { console.error('Financial database connection failed'); });
const store = new FinanceStore(pool);
try {
  await store.checkRuntimeRole();
  const app = createFinanceSandboxApp(store, token);
  const server = app.listen(port, host, () => { console.log(`Finance simulation listening on ${host}:${port}`); });
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    server.close(() => { void pool.end(); });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  server.on('error', () => { console.error('Finance simulation could not listen'); void pool.end(); process.exitCode = 1; });
} catch (error) { await pool.end(); throw error; }

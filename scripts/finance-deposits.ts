import pg from 'pg';
import { readFileSync, statSync, realpathSync } from 'node:fs';
import { financeDatabaseConfig, requireFinanceSimulation } from '../server/finance/config';
import { DEPOSIT_NETWORK, DepositScanError, scanSimulatedDeposits, simulationSource } from '../server/finance/deposits';

requireFinanceSimulation();
if (process.env.FINANCE_DEPOSIT_NETWORK !== DEPOSIT_NETWORK) throw new Error('Explicit simulation deposit network required');
const paths = [process.env.FINANCE_DEPOSIT_SOURCE_A_FILE, process.env.FINANCE_DEPOSIT_SOURCE_B_FILE];
if (paths.some(path => !path || statSync(path).size > 8 * 1024 * 1024)
  || realpathSync(paths[0]!) === realpathSync(paths[1]!)) throw new Error('Two separate bounded simulation source files required');
const sources = paths.map(path => simulationSource(JSON.parse(readFileSync(path!, 'utf8'))));
const pool = new pg.Pool(financeDatabaseConfig());
pool.on('error', () => { console.error('Deposit observer database connection failed'); });
try {
  const fault = process.env.FINANCE_DEPOSIT_TEST_FAULT === 'after-commit';
  const result = await scanSimulatedDeposits(pool, sources, { afterCommit: fault ? async () => {
    throw new DepositScanError('simulated_crash_after_commit');
  } : undefined });
  console.log(JSON.stringify({ environment: 'simulation', ok: true, ...result }));
} catch (error) {
  console.log(JSON.stringify({ environment: 'simulation', ok: false,
    code: error instanceof DepositScanError ? error.code : 'deposit_scan_unconfirmed' }));
  process.exitCode = 1;
} finally { await pool.end(); }

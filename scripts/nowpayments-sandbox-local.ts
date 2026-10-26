import { spawn } from 'node:child_process';
import { temporaryDatabase } from './database-test';

const database = await temporaryDatabase();
// This dedicated runner owns shutdown. A competing dependency hook exits before cleanup completes.
process.removeAllListeners('SIGINT'); process.removeAllListeners('SIGTERM');
const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/nowpayments-sandbox-fixture.ts'], {
  stdio: 'inherit', env: { ...process.env, ...database.env, PORT: process.env.ROYAL_SANDBOX_UI_PORT ?? '2579',
    AUTH_DB_PATH: 'royal_sandbox_e2e', PUBLIC_ORIGIN: 'https://sandbox.example.test',
    NOWPAYMENTS_SANDBOX_ENABLED: 'true', NOWPAYMENTS_SANDBOX_API_KEY: 'sandbox-fixture-api-key',
    NOWPAYMENTS_SANDBOX_IPN_SECRET: 'sandbox-fixture-ipn-secret', NOWPAYMENTS_ENABLED: 'false',
    NOWPAYMENTS_SANDBOX_API_KEY_FILE: '', NOWPAYMENTS_SANDBOX_IPN_SECRET_FILE: '', NOWPAYMENTS_SANDBOX_CURRENCY: 'btc',
    PAYMENTS_SERVICE_URL: '', PAYMENTS_REQUEST_SECRET: '', PAYMENTS_EVENT_SECRET: '', PAYMENTS_REQUEST_SECRET_FILE: '', PAYMENTS_EVENT_SECRET_FILE: '' },
});
let stopping = false;
async function stop(code = 0) {
  if (stopping) return; stopping = true;
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    await Promise.race([new Promise<void>(resolve => child.once('exit', () => resolve())), new Promise<void>(resolve => setTimeout(resolve, 5000))]);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
  await database.cleanup(); process.exit(code);
}
process.once('SIGINT', () => { void stop(); }); process.once('SIGTERM', () => { void stop(); });
process.stdin.setEncoding('utf8');
process.stdin.on('data', input => { if (String(input).trim() === 'stop') void stop(); });
console.log('Local Sandbox fixture: send stop on standard input to close and remove the temporary database.');
child.once('error', () => { void stop(1); }); child.once('exit', code => { void stop(code ?? 1); });

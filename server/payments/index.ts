import { createPaymentApp } from './app';
import { createPaymentRuntime } from './runtime';
import { startPaymentWorkers } from './workers';

const { db, store, outbox, requestSecret } = createPaymentRuntime();
await store.ready;
const role = (await db.prepare(`SELECT current_user AS role,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,
  has_schema_privilege(current_user,'royal_game','USAGE') AS game_access FROM pg_roles WHERE rolname=current_user`).get())!;
if (process.env.NODE_ENV === 'production' && (role.role !== 'royal_payments_app' || role.rolsuper || role.rolcreatedb || role.rolcreaterole
  || role.rolreplication || role.rolbypassrls || role.game_access)) throw new Error('Payment database role must be isolated from the game');
const port = Number(process.env.PORT ?? 2570);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid payment service port');
const server = createPaymentApp(store, requestSecret).listen(port, '0.0.0.0');
const stopWorkers = startPaymentWorkers(store, outbox);
async function stop() {
  const pending = stopWorkers();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await pending;
  await db.close();
}
process.once('SIGTERM', () => { void stop(); }); process.once('SIGINT', () => { void stop(); });

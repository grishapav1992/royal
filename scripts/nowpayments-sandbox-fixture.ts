import { SANDBOX_API } from '../server/payments/sandbox-provider';

if (process.env.NODE_ENV !== 'test' || process.env.PGDATABASE !== 'royal_test' || process.env.AUTH_DB_PATH !== 'royal_sandbox_e2e') {
  throw new Error('This fixture requires the isolated temporary test database');
}
const network = globalThis.fetch, payments = new Map<string, { body: Record<string, any>; created: number }>();
let next = 1000;
globalThis.fetch = (async (url, options) => {
  if (!String(url).startsWith(SANDBOX_API)) return network(url, options);
  const path = String(url).slice(SANDBOX_API.length);
  if (path === 'payment' && options?.method === 'POST') {
    const body = JSON.parse(String(options.body)), id = String(++next);
    payments.set(id, { body, created: Date.now() });
    return new Response(JSON.stringify({ payment_id: id, order_id: body.order_id, payment_status: 'waiting' }));
  }
  const id = path.match(/^payment\/(\d+)$/)?.[1], saved = id && payments.get(id);
  if (!saved) return new Response('{}', { status: 404 });
  const ready = Date.now() - saved.created >= 1000, scenario = saved.body.case;
  return new Response(JSON.stringify({ payment_id: id, order_id: saved.body.order_id, price_amount: saved.body.price_amount,
    price_currency: 'usd', pay_currency: saved.body.pay_currency, pay_amount: '0.01',
    payment_status: !ready ? 'waiting' : scenario === 'failed' ? 'failed' : scenario === 'partially_paid' ? 'partially_paid' : 'finished',
    actually_paid: !ready || scenario === 'failed' ? '0' : scenario === 'partially_paid' ? '0.005' : '0.01' }));
}) as typeof fetch;
console.log('TEST FIXTURE: NOWPayments responses are emulated; no provider payment or account is created.');
await import('../dist-server/index.js');

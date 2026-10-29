import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { randomUUID, createHmac } from 'node:crypto';
import { accounts } from '../server/accounts';
import { installDemoWallet } from '../server/demoWalletRoutes';
import { installPaymentMethods } from '../server/payments/methods';
import { installSandboxPayments } from '../server/payments/sandbox-routes';
import { SandboxPaymentStore } from '../server/payments/sandbox';
import type { SandboxProvider, SandboxConfig } from '../server/payments/sandbox-provider';
import type { PostgresDatabase } from '../server/database';
import { CommonSkinPayments } from '../server/skinPayments';
import { PVP_GAMES } from '../src/shared/pvp';

test.after(() => accounts.close());
const config: SandboxConfig = { enabled: true, apiKey: 'sandbox-fixture-only', ipnSecret: 'sandbox-fixture-ipn-secret',
  currency: 'btc', origin: 'https://royal.example.test' };

test('supported payment methods are listed; retired URLs cannot reach a legacy handler', async () => {
  const app = express(); installPaymentMethods(app);
  let legacyCalls = 0;
  app.use(['/api/nile-wallet', '/api/nile-play', '/api/game-wallet', '/api/usdt-wallet'], (_req, res) => { legacyCalls++; res.json({ unsafe: true }); });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address !== 'string'); const base = `http://127.0.0.1:${address.port}`;
  try {
    const methods = await (await fetch(base + '/api/payment-methods')).json();
    assert.deepEqual(methods.methods.map((m: any) => [m.id, m.environment]), [['nowpayments', 'live'], ['nowpayments-sandbox', 'sandbox'], ['telegram-stars', 'live']]);
    for (const path of ['/api/nile-wallet', '/api/nile-play/claim', '/api/nile-play/deposit', '/api/game-wallet/deposit',
      '/api/usdt-wallet/deposit', '/api/USDT-WALLET/deposit/', '/api/game-wallet/expansion']) {
      for (const method of ['GET', 'POST']) {
        const response = await fetch(base + path, { method }); assert.equal(response.status, 410, path);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.equal((await response.json()).code, 'PAYMENT_METHOD_RETIRED');
      }
    }
    assert.equal(legacyCalls, 0);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('direct top-ups are rejected; saved receipts replay without minting and Sandbox funds atelier, all PvP and combat', async () => {
  const db = Reflect.get(accounts, 'db') as PostgresDatabase;
  const rows = new Map<string, Record<string, unknown>>();
  const provider: SandboxProvider = {
    async create(id, amount) {
      const value = { payment_id: String(rows.size + 1), order_id: id, price_amount: amount, price_currency: 'usd',
        pay_currency: 'btc', pay_amount: '0.01', actually_paid: 0, payment_status: 'waiting' };
      rows.set(value.payment_id, value); return value;
    },
    async payment(id) { return structuredClone(rows.get(id)!); },
  };
  const store = new SandboxPaymentStore(db, config, provider, accounts.wallet.ready);
  const app = express(); installPaymentMethods(app); installDemoWallet(app); const stop = installSandboxPayments(app, store);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address !== 'string'); const base = `http://127.0.0.1:${address.port}`;
  try {
    const players = await Promise.all([0, 1].map(() => accounts.login('methods-' + randomUUID() + '@example.test', 'Methods-fixture-42!')));
    const headers = (index: number) => ({ Cookie: 'royal_session=' + players[index].token,
      'X-Royal-Account-Id': players[index].account.id, 'Content-Type': 'application/json' });
    const post = (path: string, body: unknown, index = 0) => fetch(base + path, { method: 'POST', headers: headers(index), body: JSON.stringify(body) });
    const alice = players[0].account.id, bob = players[1].account.id;
    const { installFinanceAdmin } = await import('../server/admin/routes');
    installFinanceAdmin(app, accounts, { FINANCE_ADMIN_ACCOUNT_IDS: alice });
    for (const source of ['nile', 'mainnet']) {
      const response = await fetch(base + '/api/admin/actions', { method: 'POST',
        headers: { ...headers(0), Origin: base, 'x-royal-admin-account': alice },
        body: JSON.stringify({ id: randomUUID(), source, action: 'adjust', playerId: alice,
          deltaUnits: '1000000', reason: 'Retired payment method check', password: 'Methods-fixture-42!' }) });
      assert.equal(response.status, 410, 'An archived source cannot create an administrative credit');
    }
    const pending = { id: randomUUID(), actorId: alice, playerId: alice, source: 'nile', action: 'adjust',
      reason: 'Historical pending correction', deltaUnits: '1000000' };
    await assert.rejects(accounts.financeAdmin.command(pending, async () => { throw new Error('Historical lost acknowledgement'); }));
    const replay = (deltaUnits: string) => fetch(base + '/api/admin/actions', { method: 'POST',
      headers: { ...headers(0), Origin: base, 'x-royal-admin-account': alice },
      body: JSON.stringify({ id: pending.id, source: pending.source, action: pending.action, playerId: alice,
        deltaUnits, reason: pending.reason, password: 'Methods-fixture-42!' }) });
    assert.equal((await replay(pending.deltaUnits)).status, 503, 'A saved command can still query its unavailable historical service');
    assert.equal((await replay('2000000')).status, 409, 'A saved command cannot authorize a changed correction');
    assert.equal((await fetch(base + '/api/demo-wallet/operations', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: randomUUID(), kind: 'deposit', amount: 1000 }) })).status, 401);
    const denied = await Promise.all(Array.from({ length: 4 }, () => post('/api/demo-wallet/operations', { id: randomUUID(), kind: 'deposit', amount: 1000 })));
    assert(denied.every(response => response.status === 410)); assert.equal((await accounts.wallet.snapshot(alice)).balance, 0);
    // Seed one historical receipt inside the test database. No public top-up is used.
    const old = { id: randomUUID(), kind: 'deposit' as const, amount: 10 };
    await accounts.wallet.operate(alice, old);
    assert.equal((await post('/api/demo-wallet/operations', old)).status, 200);
    assert.equal((await post('/api/demo-wallet/operations', { ...old, amount: 20 })).status, 409);
    assert.equal((await accounts.wallet.snapshot(alice)).balance, 10);
    for (let index = 0; index < players.length; index++) {
      const operation = { id: randomUUID(), amount: 1000, scenario: 'success' };
      const created = await post('/api/nowpayments-sandbox/deposits', operation, index); assert.equal(created.status, 200);
      const payment = await created.json(); rows.get(payment.paymentId)!.payment_status = 'finished';
      const ipn = { payment_id: payment.paymentId, order_id: operation.id };
      const signature = createHmac('sha512', config.ipnSecret).update(JSON.stringify(ipn, Object.keys(ipn).sort())).digest('hex');
      assert.equal((await fetch(base + '/api/nowpayments-sandbox/ipn', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-nowpayments-sig': signature }, body: JSON.stringify(ipn) })).status, 200);
      assert.equal((await accounts.wallet.snapshot(players[index].account.id)).balance, index === 0 ? 1010 : 1000);
    }
    const skins = new CommonSkinPayments(db, accounts.wallet.ready), purchase = randomUUID();
    await skins.skinPurchase(alice, purchase, 'reserve'); await skins.skinPurchase(alice, purchase, 'capture');
    await skins.skinPurchase(alice, purchase, 'capture'); assert.equal((await accounts.wallet.snapshot(alice)).balance, 1000);
    const cancelled = randomUUID(); await skins.skinPurchase(alice, cancelled, 'reserve');
    await skins.skinPurchase(alice, cancelled, 'refund'); await skins.skinPurchase(alice, cancelled, 'refund');
    assert.equal((await accounts.wallet.snapshot(alice)).balance, 1000);
    const ledger = Reflect.get(accounts.pvp, 'ledger'); assert(ledger);
    for (const gameId of Object.keys(PVP_GAMES)) {
      const match = { matchId: randomUUID(), gameId, stakeUnits: '10000000' };
      await ledger.pvpHold(alice, match); await ledger.pvpHold(bob, match);
      const finish = { matchId: match.matchId, winnerId: alice, reason: 'win' };
      await ledger.pvpFinish(alice, finish); await ledger.pvpFinish(alice, finish);
    }
    assert.equal((await accounts.wallet.snapshot(alice)).balance, 1054);
    assert.equal((await accounts.wallet.snapshot(bob)).balance, 940);
    const combat = { id: randomUUID(), accounts: [alice, bob], stakeUnits: '10000000' };
    await accounts.combat.fund(alice, combat); await accounts.combat.settle(alice, { ...combat, winner: alice });
    await accounts.combat.settle(alice, { ...combat, winner: alice });
    assert.equal((await accounts.wallet.snapshot(alice)).balance, 1063);
    assert.equal((await accounts.wallet.snapshot(bob)).balance, 930);
    assert.deepEqual(await accounts.paymentCredits.snapshot(alice), { balanceUnits: '0', reservedUnits: '0' });
    const creditCount = Number((await db.prepare("SELECT count(*) AS n FROM demo_ledger WHERE source='nowpayments-sandbox'").get())!.n);
    assert.equal(creditCount, 2);
  } finally { stop(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { WalletClient } from '../src/wallet/WalletClient';
import type { WalletResult } from '../src/shared/demoWallet';
import { WALLET_ACCOUNT_HEADER } from '../src/shared/walletAccount';

// Import the route singletons only after isolating their database from project data.
process.env.AUTH_DB_PATH = ':memory:';
const { accounts } = await import('../server/accounts');
const { installDemoWallet } = await import('../server/demoWalletRoutes');
const { installNilePlay } = await import('../server/nilePlayRoutes');
const nativeFetch = globalThis.fetch;
const accountHeader = WALLET_ACCOUNT_HEADER;

function storageFixture() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  } satisfies Storage;
}

async function initializeClient(client: EventTarget & { wallet?: unknown; error: string; setAccount(id: string): void }, id: string) {
  const refreshed = new Promise<void>(resolve => {
    const changed = () => {
      if (!client.wallet && !client.error) return;
      client.removeEventListener('change', changed);
      resolve();
    };
    client.addEventListener('change', changed);
  });
  client.setAccount(id);
  await refreshed;
}

test('wallet requests stay bound to the account that created them', { timeout: 20000 }, async t => {
  const app = express();
  installDemoWallet(app);
  installNilePlay(app, '');
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const alice = await accounts.login(`wallet-alice-${randomUUID()}@example.test`, 'Wallet-test-password!');
  const bob = await accounts.login(`wallet-bob-${randomUUID()}@example.test`, 'Wallet-test-password!');
  (await accounts.wallet.operate(alice.account.id, { id: randomUUID(), kind: 'deposit', amount: 1000 }));
  (await accounts.wallet.operate(bob.account.id, { id: randomUUID(), kind: 'deposit', amount: 2000 }));
  const storage = storageFixture();
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const locationDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { hash: '', pathname: '/', search: '' } });
  let cookieToken = alice.token;
  let loseNextSuccessfulOperation = false;
  let lostResult: WalletResult | undefined;
  const observed: { path: string; expectedAccount: string | null; status: number }[] = [];
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    const headers = new Headers(init?.headers);
    headers.set('Cookie', `royal_session=${cookieToken}`);
    const response = await nativeFetch(new URL(path, origin), { ...init, headers });
    observed.push({ path, expectedAccount: headers.get(accountHeader), status: response.status });
    if (loseNextSuccessfulOperation && path === '/api/demo-wallet/operations' && response.ok) {
      loseNextSuccessfulOperation = false;
      lostResult = await response.json() as WalletResult;
      throw new TypeError('Simulated response loss after the server committed');
    }
    return response;
  };

  try {
    await t.test('routes reject missing, mismatched and unauthenticated account claims before touching either wallet', async () => {
      const beforeAlice = (await accounts.wallet.snapshot(alice.account.id));
      const beforeBob = (await accounts.wallet.snapshot(bob.account.id));
      const routes = [
        { path: '/api/demo-wallet' },
        { path: '/api/demo-wallet/operations', body: { id: randomUUID(), kind: 'spin', amount: 100 } },
        { path: '/api/nile-play/wallet' },
        { path: '/api/nile-play/claim', body: { code: 'a'.repeat(43) } },
        { path: '/api/nile-play/rounds', body: { id: randomUUID(), stakeUnits: '1000000' } },
      ];
      const invalidHeaders: Record<string, string>[] = [
        { Cookie: `royal_session=${alice.token}` },
        { Cookie: `royal_session=${bob.token}`, [accountHeader]: alice.account.id },
        { [accountHeader]: alice.account.id },
        { Cookie: 'royal_session=invalid-session', [accountHeader]: alice.account.id },
      ];
      for (const route of routes) {
        for (const headers of invalidHeaders) {
          const response = await nativeFetch(origin + route.path, {
            method: route.body ? 'POST' : 'GET',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: route.body ? JSON.stringify(route.body) : undefined,
          });
          assert.equal(response.status, 401, `${route.path} must reject an unbound session`);
          await response.json();
        }
      }
      assert.deepEqual((await accounts.wallet.snapshot(alice.account.id)), beforeAlice);
      assert.deepEqual((await accounts.wallet.snapshot(bob.account.id)), beforeBob);
      const matching = { Cookie: `royal_session=${alice.token}`, [accountHeader]: alice.account.id, 'Content-Type': 'application/json' };
      const wallet = await nativeFetch(origin + '/api/demo-wallet', { headers: matching });
      assert.equal(wallet.status, 200);
      assert.deepEqual(await wallet.json(), JSON.parse(JSON.stringify(beforeAlice)));
      const nileWallet = await nativeFetch(origin + '/api/nile-play/wallet', { headers: matching });
      assert.equal(nileWallet.status, 200);
      assert.equal((await nileWallet.json()).state, 'disabled');
      for (const route of routes.slice(3)) {
        const response = await nativeFetch(origin + route.path, { method: 'POST', headers: matching, body: JSON.stringify(route.body) });
        assert.equal(response.status, 503, 'A matching session reaches the disabled Nile service');
        await response.json();
      }
    });

    await t.test('changing the cookie in another tab cannot debit the new account, and restoring the original account settles once', async () => {
      const client = new WalletClient();
      await initializeClient(client, alice.account.id);
      assert.equal(client.wallet?.balance, 1000);
      const beforeAlice = (await accounts.wallet.snapshot(alice.account.id));
      const beforeBob = (await accounts.wallet.snapshot(bob.account.id));
      cookieToken = bob.token;
      await client.refresh();
      assert(client.error);
      assert.notEqual(client.wallet?.balance, beforeBob.balance, 'A stale tab must not display the other account wallet');
      await assert.rejects(client.play('royal-coins', {}, 100));
      const pending = client.pending;
      assert(pending);
      assert.deepEqual(JSON.parse(storage.getItem(`royal-demo-operation:${alice.account.id}`)!), pending);
      assert.equal(storage.getItem(`royal-demo-operation:${bob.account.id}`), null);
      assert.deepEqual((await accounts.wallet.snapshot(alice.account.id)), beforeAlice);
      assert.deepEqual((await accounts.wallet.snapshot(bob.account.id)), beforeBob);
      cookieToken = alice.token;
      const reloaded = new WalletClient();
      await initializeClient(reloaded, alice.account.id);
      assert.deepEqual(reloaded.pending, pending);
      const settled = await reloaded.retry();
      assert(settled.gameRound);
      assert.equal(settled.wallet.entries.filter(entry => entry.kind === 'bet' && entry.operationId === pending.id).length, 1);
      assert.equal(settled.wallet.balance, beforeAlice.balance - 100 + Number(settled.gameRound.payoutUnits) / 100);
      assert.equal(reloaded.pending, undefined);
      assert.equal(storage.getItem(`royal-demo-operation:${alice.account.id}`), null);
      assert.deepEqual((await accounts.wallet.snapshot(bob.account.id)), beforeBob);
    });

    await t.test('a response lost after commit remains recoverable across a cookie change without another round', async () => {
      const client = new WalletClient();
      cookieToken = alice.token;
      await initializeClient(client, alice.account.id);
      const beforeBob = (await accounts.wallet.snapshot(bob.account.id));
      loseNextSuccessfulOperation = true;
      await assert.rejects(client.play('royal-roulette', { bet: 'red' }, 100));
      const pending = client.pending;
      assert(pending);
      assert(lostResult?.gameRound);
      const committed = (await accounts.wallet.snapshot(alice.account.id));
      assert.equal(committed.entries.filter(entry => entry.kind === 'bet' && entry.operationId === pending.id).length, 1);
      cookieToken = bob.token;
      await assert.rejects(client.retry());
      assert.deepEqual(client.pending, pending);
      assert.deepEqual(JSON.parse(storage.getItem(`royal-demo-operation:${alice.account.id}`)!), pending);
      assert.deepEqual((await accounts.wallet.snapshot(alice.account.id)), committed);
      assert.deepEqual((await accounts.wallet.snapshot(bob.account.id)), beforeBob);
      cookieToken = alice.token;
      const replay = await client.retry();
      assert.deepEqual(replay, lostResult);
      assert.deepEqual((await accounts.wallet.snapshot(alice.account.id)), committed);
      assert.equal(client.pending, undefined);
      assert.equal(storage.getItem(`royal-demo-operation:${alice.account.id}`), null);
    });

    await t.test('retired direct top-ups cannot debit or credit a wallet or overwrite a saved Nile request', async () => {
      cookieToken = alice.token;
      const nileKey = `royal-nile-game-operation:${alice.account.id}`;
      const nilePending = { id: randomUUID(), kind: 'spin', amount: 100 };
      storage.setItem(nileKey, JSON.stringify(nilePending));
      const client = new WalletClient();
      await initializeClient(client, alice.account.id);
      assert.equal(client.pending, undefined);
      const before = await accounts.wallet.snapshot(alice.account.id);
      const response = await fetch('/api/demo-wallet/operations', {
        method: 'POST', headers: { 'Content-Type': 'application/json', [accountHeader]: alice.account.id },
        body: JSON.stringify({ id: randomUUID(), kind: 'deposit', amount: 2375 }),
      });
      assert.equal(response.status, 410);
      assert.deepEqual(await accounts.wallet.snapshot(alice.account.id), before);
      assert.equal(storage.getItem(nileKey), JSON.stringify(nilePending));
      assert.equal(storage.getItem(`royal-demo-operation:${alice.account.id}`), null);
      const confirmed = client.wallet;
      assert.throws(() => client.acceptExternalWallet(alice.account.id, { balance: 999, entries: [], asset: 'USDT_NILE_TEST' }));
      assert.equal(client.wallet, confirmed);
      storage.removeItem(nileKey);
    });

    await t.test('Nile wallet, claim and round clients also keep the expected owner when cookies change', async () => {
      const { NilePlayClient } = await import('../src/wallet/NilePlayClient');
      const client = new NilePlayClient();
      cookieToken = alice.token;
      await initializeClient(client, alice.account.id);
      assert.equal(client.wallet?.state, 'disabled');
      const firstRequest = observed.length;
      cookieToken = bob.token;
      await client.refresh();
      assert.equal(client.wallet, undefined);
      assert(client.error);
      await assert.rejects(client.claim('a'.repeat(43)));
      await assert.rejects(client.spin('1000000'));
      const pending = client.pending;
      assert(pending);
      assert.deepEqual(JSON.parse(storage.getItem(`royal-nile-round:${alice.account.id}`)!), pending);
      assert.equal(storage.getItem(`royal-nile-round:${bob.account.id}`), null);
      const rejected = observed.slice(firstRequest);
      assert.deepEqual(rejected.map(request => request.path), ['/api/nile-play/wallet', '/api/nile-play/claim', '/api/nile-play/rounds']);
      assert(rejected.every(request => request.status === 401 && request.expectedAccount === alice.account.id));
      cookieToken = alice.token;
      await assert.rejects(client.spin('1000000'));
      assert.equal(observed.at(-1)?.status, 503, 'The original session must reach the disabled service with the same request');
      assert.deepEqual(client.pending, pending);
    });
    assert(observed.every(request => request.expectedAccount === alice.account.id), 'All client reads and writes carry the captured account');
  } finally {
    globalThis.fetch = nativeFetch;
    if (storageDescriptor) Object.defineProperty(globalThis, 'sessionStorage', storageDescriptor);
    else Reflect.deleteProperty(globalThis, 'sessionStorage');
    if (locationDescriptor) Object.defineProperty(globalThis, 'location', locationDescriptor);
    else Reflect.deleteProperty(globalThis, 'location');
    (await accounts.logout(alice.token));
    (await accounts.logout(bob.token));
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    (await accounts.close());
  }
});

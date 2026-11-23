import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import { DRAGON_PATH_WEIGHTS } from '../src/shared/dragonPathMath';
import {
  DRAGON_PATH_CHOOSE_REWARD, DRAGON_PATH_CLIENT_HEADER, DRAGON_PATH_FREE_SPIN, DRAGON_PATH_GAME, DRAGON_PATH_REWARDS,
} from '../src/shared/dragonPathProtocol';
import { ROYAL_STAKE_LIMIT_HEADER } from '../src/shared/gameStakes';
import { WALLET_ACCOUNT_HEADER } from '../src/shared/walletAccount';
import { ExpansionClient, expansionClient } from '../src/wallet/ExpansionClient';
import { demoWallet } from '../src/wallet/WalletClient';
import type { GameHostV1 } from '../src/modules/GameHostContract';
import { createDragonPathServices } from '../games/panda-dragon/wallet-binding';

process.env.AUTH_DB_PATH = ':memory:';
const { accounts } = await import('../server/accounts');
const { installDemoWallet } = await import('../server/demoWalletRoutes');

test.after(() => accounts.close());

test('виртуальный HTTP-кошелёк: списание один раз, два бесплатных хода и восстановление', async t => {
  async function login() {
    const identity = await accounts.login(`dragon-path-${randomUUID()}@example.test`, 'Royal-virtual-test-2026!');
    return {
      id: identity.account.id,
      headers: { Cookie: `royal_session=${identity.token}`, [WALLET_ACCOUNT_HEADER]: identity.account.id,
        'Content-Type': 'application/json', [DRAGON_PATH_CLIENT_HEADER]: '1', [ROYAL_STAKE_LIMIT_HEADER]: '1' },
    };
  }
  const player = await login(), other = await login();
  await accounts.wallet.operate(player.id, { id: randomUUID(), kind: 'deposit', amount: 50 });
  const app = express();
  installDemoWallet(app);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/api/demo-wallet/expansion`;
  const post = (value: unknown, headers = player.headers) => fetch(url, { method: 'POST', body: JSON.stringify(value), headers });
  const get = async (headers = player.headers) => {
    const res = await fetch(url, { headers });
    assert.equal(res.status, 200);
    return res.json();
  };
  const accept = async (value: unknown) => {
    const res = await post(value);
    assert.equal(res.status, 200, await res.clone().text());
    const reply = await res.json();
    const client = new ExpansionClient(2);
    assert(Reflect.get(client, 'valid').call(client, reply, value), 'Клиент обязан подтвердить тот же запрос и снимок');
    return reply;
  };
  const expansion = accounts.wallet.expansion, originalDraw = Reflect.get(expansion, 'draw');
  let draws = 0;
  let tickets: number[] = [];
  Reflect.set(expansion, 'draw', (max: number) => {
    draws++;
    const next = tickets.shift();
    assert(next !== undefined && next >= 0 && next < max);
    return next;
  });
  try {
    const compatible = player.headers;
    const old = { ...compatible, [DRAGON_PATH_CLIENT_HEADER]: '0' };
    const oldLimit = { ...compatible, [ROYAL_STAKE_LIMIT_HEADER]: '0' };
    for (const reward of DRAGON_PATH_REWARDS) {
      const stake = reward === 2 ? 10 : 15;
      const start = { id: randomUUID(), gameId: DRAGON_PATH_GAME, action: 'start', stakeUnits: String(stake), settings: {}, stakePolicyVersion: 1 };
      const before = Math.round((await get()).wallet.balance * 100), beforeDraws = draws;
      const { stakePolicyVersion: _policy, ...legacy } = start;
      assert.equal((await post(legacy)).status, 409);
      assert.equal((await post(start, old)).status, 409);
      assert.equal((await post({ ...start, stakeUnits: '10001' })).status, 400);
      assert.equal((await post({ ...start, stakeUnits: '10000' }, oldLimit)).status, 409);
      const atLimit = await post({ ...start, stakeUnits: '10000' });
      assert.equal(atLimit.status, 409);
      assert.match((await atLimit.json()).error, /недостаточно/i);
      assert.equal(Math.round((await get()).wallet.balance * 100), before);
      assert.equal(draws, beforeDraws);
      const ticket = (symbol: number) => DRAGON_PATH_WEIGHTS.slice(0, symbol).reduce((sum, w) => sum + w, 0);
      const base = Array.from({ length: 25 }, (_, i) => i < 3 ? 0 : 2 + i % 7);
      const free = Array.from({ length: 25 }, (_, i) => i >= 10 && i <= 12 ? 8 : 2 + i % 7);
      tickets = [...base.map(ticket), ...free.map(ticket), 0];
      const first = await accept(start);
      assert.equal(first.session.spentUnits, String(stake));
      assert.equal(first.session.returnedUnits, '0');
      assert.equal(first.session.view.dragonPath.round.free, null);
      assert.equal(draws, beforeDraws + 25);
      assert.equal(Math.round(first.wallet.balance * 100), before - stake);
      assert.deepEqual((await accept(start)).session, first.session);
      assert.equal(draws, beforeDraws + 25);
      assert.deepEqual((await get()).sessions.find((s: any) => s.id === start.id), first.session);
      assert.deepEqual((await get(old)).sessions, []);
      const spin = { id: randomUUID(), gameId: DRAGON_PATH_GAME, action: 'move', sessionId: start.id, move: DRAGON_PATH_FREE_SPIN, revision: 1 };
      assert.equal((await post(spin, other.headers)).status, 404);
      assert.equal((await post({ ...spin, revision: 2 })).status, 400);
      assert.equal((await post({ ...start, id: randomUUID() })).status, 409);
      assert.equal(draws, beforeDraws + 25);
      const second = await accept(spin);
      assert.equal(second.session.view.dragonPath.round.revision, 2);
      assert.equal(second.session.returnedUnits, '0');
      assert.equal(second.wallet.balance, first.wallet.balance);
      assert.equal(draws, beforeDraws + 50);
      assert.deepEqual((await accept(spin)).session, second.session);
      assert.equal((await post({ ...spin, id: randomUUID() })).status, 409);
      assert.equal(draws, beforeDraws + 50);
      const choice = { ...spin, id: randomUUID(), revision: 2, move: DRAGON_PATH_CHOOSE_REWARD, picks: [reward] };
      assert.equal((await post({ ...choice, picks: [1] })).status, 400);
      const final = await accept(choice);
      assert.equal(final.session.state, 'settled');
      assert.equal(final.session.view.dragonPath.round.reward, reward);
      assert.equal(final.session.spentUnits, String(stake));
      assert.equal(final.session.precision.creditedUnits, final.session.returnedUnits);
      assert.equal(Math.round(final.wallet.balance * 100), before - stake + Number(final.session.returnedUnits));
      const settledDraws = draws;
      assert.deepEqual((await accept(choice)).session, final.session);
      assert.deepEqual((await accept(spin)).session, final.session);
      assert.equal((await post({ ...choice, picks: [reward === 2 ? 3 : 2] })).status, 409);
      assert.equal(draws, settledDraws);
    }
    const entries = (await get()).wallet.entries.filter((entry: any) => entry.source === DRAGON_PATH_GAME);
    assert.deepEqual(entries.filter((entry: any) => entry.kind === 'bet').map((entry: any) => entry.amount).sort(), [-0.1, -0.15]);
    assert.equal(entries.filter((entry: any) => entry.kind === 'win').length, 2);

    const storage = new Map<string, string>();
    const priorStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    } });
    const actualFetch = fetch, startIds: string[] = [];
    t.mock.method(globalThis, 'fetch', async (path: string, init: RequestInit) => {
      const headers = new Headers(init.headers);
      headers.set('Cookie', player.headers.Cookie);
      const response = await actualFetch(new URL(path, url), { ...init, headers });
      if (init.method === 'POST') {
        const operation = JSON.parse(String(init.body));
        if (operation.action === 'start') {
          startIds.push(operation.id);
          if (startIds.length === 1) {
            assert.equal(response.status, 200, await response.clone().text());
            await response.arrayBuffer();
            throw new TypeError('Ответ потерян после фиксации сервером');
          }
        }
      }
      return response;
    });
    try {
      demoWallet.setAccount(player.id);
      while (expansionClient.loading) await once(expansionClient, 'change');
      const host = { manualStakes: 1, expansionClient, demoWallet, walletCoins: String } as GameHostV1;
      const balanceBefore = demoWallet.wallet!.balance;
      const slot = createDragonPathServices(host);
      tickets = [...Array.from({ length: 50 }, (_, i) => i < 3 ? 0 : 6), 0];
      await assert.rejects(slot.spin('0,10'));
      assert.equal(slot.read().status, 'recover');
      assert.equal(JSON.parse(storage.get('royal-expansion:' + player.id)!).id, startIds[0]);
      const reopened = createDragonPathServices(host);
      await reopened.refresh();
      await reopened.recover();
      assert.deepEqual(startIds, [startIds[0], startIds[0]]);
      assert.equal(storage.size, 0);
      assert.equal(reopened.read().round?.spentCents, '10');
      assert.equal(reopened.read().round?.view.symbols.length, 25);
      assert.equal(demoWallet.wallet!.balance, Math.round((balanceBefore - 0.10) * 100) / 100);
      const active = reopened.read();
      assert.equal(active.status, 'continue');
      const free = await reopened.playFree(active.round!, DRAGON_PATH_FREE_SPIN);
      assert.equal(free?.revision, 2);
      const selected = await reopened.playFree(free!, DRAGON_PATH_CHOOSE_REWARD, [3]);
      assert.equal(selected?.revision, 3);
      assert.equal(selected?.state, 'settled');
      assert.equal(demoWallet.wallet!.entries.filter(entry => entry.kind === 'bet' && entry.source === DRAGON_PATH_GAME).length, 3);
    } finally {
      demoWallet.setAccount(null);
      if (priorStorage) Object.defineProperty(globalThis, 'sessionStorage', priorStorage);
      else Reflect.deleteProperty(globalThis, 'sessionStorage');
    }
  } finally {
    Reflect.set(expansion, 'draw', originalDraw);
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

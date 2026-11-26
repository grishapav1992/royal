import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import { DRAGON_PATH_BELT_PATH, dragonPathBeltProgress, readDragonPathBeltRounds } from '../src/shared/dragonPathBelt';
import { DRAGON_PATH_WEIGHTS } from '../src/shared/dragonPathMath';
import { DRAGON_PATH_CHOOSE_REWARD, DRAGON_PATH_CLIENT_HEADER, DRAGON_PATH_FREE_SPIN, DRAGON_PATH_GAME } from '../src/shared/dragonPathProtocol';
import { ROYAL_STAKE_LIMIT_HEADER } from '../src/shared/gameStakes';
import { WALLET_ACCOUNT_HEADER } from '../src/shared/walletAccount';

process.env.AUTH_DB_PATH = ':memory:';
const { accounts } = await import('../server/accounts');
const { recordDemoUnits } = await import('../server/demoWalletAmounts');
const { installDemoWallet } = await import('../server/demoWalletRoutes');
const { installDragonPathProgress } = await import('../server/dragonPathProgressRoutes');

test.after(() => accounts.close());

test('пороги четырёх поясов и границы ответа', () => {
  assert.deepEqual([0, 9, 10, 24, 25, 49, 50].map(rounds => {
    const { current, remaining } = dragonPathBeltProgress(rounds);
    return [current.id, remaining];
  }), [['green', 10], ['green', 1], ['blue', 15], ['blue', 1], ['red', 25], ['red', 1], ['black', null]]);
  for (const invalid of [-1, 51, 1.2, '9', null]) assert.equal(readDragonPathBeltRounds({ completedRounds: invalid }), undefined);
  assert.equal(readDragonPathBeltRounds({ completedRounds: 0 }), 0);
});

test('пояс учитывает только завершённые оплаченные раунды текущего аккаунта', async () => {
  async function login() {
    const { account, token } = await accounts.login(`panda-belt-${randomUUID()}@example.test`, 'Royal-virtual-test-2026!');
    return { account: account.id, headers: { Cookie: `royal_session=${token}`, [WALLET_ACCOUNT_HEADER]: account.id,
      [DRAGON_PATH_CLIENT_HEADER]: '1', [ROYAL_STAKE_LIMIT_HEADER]: '1', 'Content-Type': 'application/json' } };
  }
  const player = await login(), other = await login();
  await accounts.wallet.operate(player.account, { id: randomUUID(), kind: 'deposit', amount: 50 });
  const app = express();
  installDemoWallet(app);
  installDragonPathProgress(app);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const progress = async (headers = player.headers) => {
    const reply = await fetch(base + DRAGON_PATH_BELT_PATH, { headers });
    assert.equal(reply.status, 200);
    assert.equal(reply.headers.get('Cache-Control'), 'private, no-store');
    return (await reply.json()).completedRounds;
  };
  const post = async (value: unknown) => {
    const reply = await fetch(base + '/api/demo-wallet/expansion', { method: 'POST', headers: player.headers, body: JSON.stringify(value) });
    assert.equal(reply.status, 200, await reply.clone().text());
    return (await reply.json()).session;
  };
  const db = accounts.progression.db;
  async function addHistory(count: number, kind: 'win' | 'refund' | 'unpaid' = 'win', gameId = DRAGON_PATH_GAME as string) {
    await db.transaction(async () => {
      for (let i = 0; i < count; i++) {
        const id = randomUUID();
        await db.prepare('INSERT INTO demo_casino_sessions VALUES(?,?,?,?,?,?)').run(player.account, id, gameId, 'settled', '{}', 0);
        if (kind === 'unpaid') continue;
        await db.prepare('INSERT INTO demo_casino_requests VALUES(?,?,?,?,?)').run(player.account, id, '', id, Date.now());
        await recordDemoUnits(db, player.account, id, 'bet', -10, 0, gameId);
        if (kind === 'refund') {
          const refundId = randomUUID();
          await db.prepare('INSERT INTO demo_casino_requests VALUES(?,?,?,?,?)').run(player.account, refundId, '', id, Date.now());
          await recordDemoUnits(db, player.account, refundId, 'refund', 10, 10, gameId);
        } else await recordDemoUnits(db, player.account, id, 'win', 10, 10, gameId);
      }
    });
  }
  const expansion = accounts.wallet.expansion;
  const originalDraw = Reflect.get(expansion, 'draw');
  try {
    assert.equal(await progress(), 0);
    assert.equal((await fetch(base + DRAGON_PATH_BELT_PATH)).status, 401);
    assert.equal((await fetch(base + DRAGON_PATH_BELT_PATH, { headers: { ...player.headers, [WALLET_ACCOUNT_HEADER]: other.account } })).status, 409);
    const ticket = (symbol: number) => DRAGON_PATH_WEIGHTS.slice(0, symbol).reduce((sum, weight) => sum + weight, 0);
    const tickets = [...Array.from({ length: 25 }, (_, i) => i < 3 ? ticket(0) : ticket(2 + i % 7)),
      ...Array.from({ length: 25 }, (_, i) => ticket(2 + i % 7)), 0];
    Reflect.set(expansion, 'draw', (max: number) => {
      const next = tickets.shift();
      assert(next !== undefined && next >= 0 && next < max);
      return next;
    });
    const id = randomUUID();
    const start = { id, gameId: DRAGON_PATH_GAME, action: 'start', settings: {}, stakeUnits: '10', stakePolicyVersion: 1 };
    assert.equal((await post(start)).state, 'active');
    assert.equal((await post(start)).state, 'active');
    assert.equal(await progress(), 0);
    const move = { gameId: DRAGON_PATH_GAME, action: 'move', sessionId: id };
    const free = { ...move, id: randomUUID(), revision: 1, move: DRAGON_PATH_FREE_SPIN };
    assert.equal((await post(free)).state, 'active');
    assert.equal(await progress(), 0);
    const choose = { ...move, id: randomUUID(), revision: 2, move: DRAGON_PATH_CHOOSE_REWARD, picks: [2] };
    assert.equal((await post(choose)).state, 'settled');
    assert.equal((await post(choose)).state, 'settled');
    assert.equal(await progress(), 1);
    await addHistory(3, 'refund');
    await addHistory(2, 'unpaid');
    await addHistory(60, 'win', 'studio-last-convoy');
    assert.equal(await progress(), 1);
    for (const [added, total] of [[8, 9], [1, 10], [14, 24], [1, 25], [24, 49], [1, 50], [500, 50]]) {
      await addHistory(added);
      assert.equal(await progress(), total);
    }
    assert.equal(await progress(other.headers), 0);
  } finally {
    Reflect.set(expansion, 'draw', originalDraw);
    server.close();
    await once(server, 'close');
  }
});

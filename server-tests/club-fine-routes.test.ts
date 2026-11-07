import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test, type TestContext } from 'node:test';
import type { Client } from '@colyseus/core';
import express from 'express';
import { accounts } from '../server/accounts';
import { installClubFineRoutes } from '../server/clubFineRoutes';
import type { DemoWalletRequestLimitOptions } from '../server/demoWalletRequestLimit';
import { installDemoWallet } from '../server/demoWalletRoutes';
import type { Guards } from '../server/guards';
import { LobbyRoom } from '../server/LobbyRoom';
import { CLUB_FINE_SOURCE, type ClubFineRequest, type ClubFineResponse, type ClubFineStatus, type ClubSanction } from '../src/shared/security';
import { STREET, STREET_DOOR } from '../src/shared/street';
import { WALLET_ACCOUNT_HEADER } from '../src/shared/walletAccount';

type Credentials = { token: string; accountId: string };
type Handler = (client: Client, value?: unknown) => void | Promise<void>;

async function serve(context: TestContext, options?: DemoWalletRequestLimitOptions) {
  const app = express();
  installDemoWallet(app, options);
  installClubFineRoutes(app);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => { server.close(() => resolve()); });
  });
  const address = server.address();
  assert(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  return (owner: Credentials, body?: unknown, extra: Record<string, string> = {}) => fetch(`${origin}/api/demo-wallet/club-fine`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Origin: origin, Cookie: `royal_session=${owner.token}`, [WALLET_ACCOUNT_HEADER]: owner.accountId,
      'Content-Type': 'application/json', ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function guest(context: TestContext, deposit = 0): Promise<Credentials> {
  const login = await accounts.login(`club-fine-routes-${randomUUID()}@example.test`, 'Club-fine-routes-password!');
  context.after(() => accounts.logout(login.token));
  await accounts.select(login.account.id, 0);
  if (deposit > 0) await accounts.wallet.operate(login.account.id, { id: randomUUID(), kind: 'deposit', amount: deposit });
  return { token: login.token, accountId: login.account.id };
}

async function mark(accountId: string) {
  const { outcome } = await accounts.clubSanctions.recordViolation(accountId, { id: randomUUID(), reason: 'spam' });
  return outcome.sanction;
}

function quote(sanction: ClubSanction): ClubFineRequest {
  return { id: randomUUID(), sanctionId: sanction.id, revision: sanction.revision, amountCents: sanction.amountCents };
}

async function body<T>(response: Response, status = 200): Promise<T> {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return response.json() as Promise<T>;
}

async function joinRoom(context: TestContext, { token }: Credentials, duringJoin?: () => Promise<void>) {
  const room = new LobbyRoom(), handlers = new Map<string, Handler>();
  context.mock.method(room, 'onMessage', (type: string, handler: Handler) => { handlers.set(type, handler); });
  context.mock.method(room, 'setPatchRate', () => {});
  context.mock.method(room, 'setSimulationInterval', () => {});
  context.mock.method(room, 'broadcast', () => {});
  context.mock.method(room.clock, 'setInterval', () => ({ clear() {} }));
  room.onCreate();
  context.after(() => { room.onDispose(); room.clock.clear(); });
  const packets: string[] = [];
  const client = { sessionId: randomUUID(), send(type: string) { packets.push(type); }, leave() {} } as unknown as Client;
  const auth = await room.onAuth(client, {}, { headers: new Headers({ Cookie: `royal_session=${token}` }), ip: '127.0.0.1' });
  client.auth = auth;
  room.clients.push(client);
  await Promise.all([room.onJoin(client, {}, auth), duringJoin?.()]);

  const player = room.state.players.get(client.sessionId)!;
  const enter = async () => {
    assert.equal(player.hall, 'street');
    Object.assign(player, STREET_DOOR.entry);
    await handlers.get('inputs')!(client, { revision: player.hallRevision, inputs: [{ seq: 1, x: 0, y: 0, ms: 0 }] });
    assert.equal(player.hall, 'arcade');
  };
  const guard = room.state.guards.get('security')!;
  const { guards } = room as unknown as { guards: Guards };
  const spot = (distance = 90) => {
    Object.assign(guard, { hall: player.hall, x: player.x, y: player.y - distance, facing: 'down', phase: 'idle' });
    guards.tick(0);
  };
  return { client, player, guard, guards, packets, spot, enter, refresh: () => (room as unknown as { refreshAccess(): Promise<void> }).refreshAccess() };
}

test('a room reconciles an episode closed by another process without a local payment event', async context => {
  const owner = await guest(context, 25);
  const sanction = await mark(owner.accountId);
  const room = await joinRoom(context, owner);
  await room.enter(); room.spot();
  assert.equal(room.guard.target, room.client.sessionId);

  // Call the durable store without the local HTTP route notification to represent a different process.
  assert.equal((await accounts.clubSanctions.pay(owner.accountId, quote(sanction))).status, 'paid');
  assert.equal(room.guard.target, room.client.sessionId);
  await room.refresh();
  assert.equal(room.guard.target, '');
  assert.equal(room.packets.filter(type => type === 'club-sanction-changed').length, 1);
  accounts.events.emit('club-sanction', owner.accountId, sanction);
  room.spot();
  assert.equal(room.guard.target, '', 'a delayed old mark cannot resurrect the closed pursuit');
});

test('fine routes inherit private wallet authorization, strict input and per-account limits', async context => {
  const request = await serve(context, { limit: 2 });
  const owner = await guest(context, 40), other = await guest(context);
  const sanction = await mark(owner.accountId);
  const payment = quote(sanction);
  for (const payload of [undefined, payment]) {
    await body(await request(owner, payload, { Cookie: '' }), 401);
    await body(await request(owner, payload, { [WALLET_ACCOUNT_HEADER]: other.accountId }), 401);
    await body(await request(owner, payload, { Origin: 'https://foreign.example' }), 403);
    await body(await request(owner, payload, { 'Sec-Fetch-Site': 'cross-site' }), 403);
  }

  const visible = await body<ClubFineStatus>(await request(owner));
  assert.deepEqual(visible.sanction, sanction);
  assert(Number.isSafeInteger(visible.serverNow) && visible.serverNow < sanction.until);
  assert.equal((await body<ClubFineStatus>(await request(other))).sanction, null);
  const foreign = await body<ClubFineResponse>(await request(other, payment));
  assert.equal(foreign.status, 'inactive');
  assert.equal(foreign.sanction, null);

  await body(await request(owner, { ...payment, balance: 40 }), 400);
  const limited = await request(owner);
  const retryAfter = Number(limited.headers.get('retry-after'));
  assert(Number.isSafeInteger(retryAfter) && retryAfter > 0 && retryAfter <= 60);
  await body(limited, 429);
  assert.deepEqual(await accounts.clubSanctions.active(owner.accountId), sanction);
  assert.equal((await accounts.wallet.snapshot(owner.accountId)).balance, 40);
});

test('paying the current fine stops matching pursuits in all rooms and lets a confirmed escort finish', async context => {
  const request = await serve(context);
  const owner = await guest(context, 40);
  const first = await mark(owner.accountId);
  const quoted = await body<ClubFineStatus>(await request(owner));
  assert.deepEqual(quoted.sanction, first);
  const stalePayment = quote(first);

  const chasing = [await joinRoom(context, owner), await joinRoom(context, owner)];
  for (const room of chasing) {
    await room.enter();
    room.spot();
    assert.equal(room.guard.target, room.client.sessionId);
  }
  const escort = await joinRoom(context, owner);
  await escort.enter();
  const captures = context.mock.method(accounts.clubSanctions, 'recordCapture');
  escort.spot(20);
  assert.equal(captures.mock.callCount(), 1);
  const captured = await captures.mock.calls[0].result;
  await new Promise<void>(resolve => setImmediate(resolve));
  const current = { ...first, until: first.until + 10 * 60_000, amountCents: 1500, revision: 2 };
  assert.deepEqual(captured, { outcome: { sanction: current, kind: 'repeat' }, replayed: false });
  assert(escort.packets.includes('club-capture'));
  assert.equal(escort.player.security, 'ejecting');

  const changed = await body<ClubFineResponse>(await request(owner, stalePayment));
  assert.equal(changed.status, 'changed');
  assert.deepEqual(changed.sanction, current);
  assert.deepEqual((await body<ClubFineStatus>(await request(owner))).sanction, current);
  assert.equal((await accounts.wallet.snapshot(owner.accountId)).balance, 40);
  for (const room of chasing) {
    assert.equal(room.guard.target, room.client.sessionId);
    room.packets.length = 0;
  }

  const payment = quote(current);
  const requestedAt = Date.now();
  const paid = await body<ClubFineResponse>(await request(owner, payment));
  assert.equal(paid.status, 'paid');
  assert.equal(paid.replayed, false);
  assert.equal(paid.sanction, null);
  assert.deepEqual(paid.receipt, { ...payment, paidAt: paid.receipt.paidAt });
  assert(paid.receipt.paidAt >= requestedAt && paid.receipt.paidAt <= paid.serverNow);
  assert.equal((await body<ClubFineStatus>(await request(owner))).sanction, null);

  for (const room of chasing) {
    assert.equal(room.guard.target, '');
    room.spot();
    assert.equal(room.guard.target, '', 'the paid account is no longer recognized on the floor');
    assert.equal(room.packets.filter(packet => packet === 'club-sanction-changed').length, 1);
  }
  assert.equal(escort.guard.target, escort.client.sessionId);
  assert.equal(escort.player.security, 'ejecting');
  for (let step = 0; step < 1200 && escort.player.hall !== 'street'; step++) escort.guards.tick(.05);
  assert.deepEqual({ hall: escort.player.hall, x: escort.player.x, y: escort.player.y }, { hall: 'street', ...STREET.spawn });
  assert.equal(escort.packets.filter(packet => packet === 'club-ejected').length, 1);

  const newer = await mark(owner.accountId);
  assert.notEqual(newer.id, current.id);
  const otherEpisode = await joinRoom(context, owner);
  await otherEpisode.enter();
  otherEpisode.spot();
  assert.equal(otherEpisode.guard.target, otherEpisode.client.sessionId);
  const replay = await body<ClubFineResponse>(await request(owner, payment));
  assert.equal(replay.status, 'paid');
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.receipt, paid.receipt);
  assert.deepEqual(replay.sanction, newer);
  otherEpisode.guards.tick(0);
  assert.equal(otherEpisode.guard.target, otherEpisode.client.sessionId, 'the previous receipt leaves the new pursuit active');
  assert.deepEqual((await body<ClubFineStatus>(await request(owner))).sanction, newer);

  const wallet = await accounts.wallet.snapshot(owner.accountId);
  assert.equal(wallet.balance, 25);
  assert.deepEqual(wallet.entries.filter(entry => entry.source === CLUB_FINE_SOURCE).map(entry => entry.amount), [-15]);
});

test('a join keeps its current sanction after an old payment retry and discards it after a real payment', { timeout: 15000 }, async context => {
  const request = await serve(context);
  const owner = await guest(context, 40);
  const oldPayment = quote(await mark(owner.accountId));
  const first = await body<ClubFineResponse>(await request(owner, oldPayment));
  assert.equal(first.status, 'paid');
  assert.equal(first.replayed, false);
  const current = await mark(owner.accountId);
  assert.notEqual(current.id, oldPayment.sanctionId);

  const lookup = accounts.clubSanctions.enforcement.bind(accounts.clubSanctions);
  const joinDuringPayment = async (payment: ClubFineRequest, replayed: boolean) => {
    const read = Promise.withResolvers<Awaited<ReturnType<typeof lookup>>>();
    const release = Promise.withResolvers<void>();
    const held = context.mock.method(accounts.clubSanctions, 'enforcement', async (id: string) => {
      const snapshot = await lookup(id);
      read.resolve(snapshot);
      await release.promise;
      return snapshot;
    });
    try {
      return await joinRoom(context, owner, async () => {
        try {
          assert.deepEqual(await read.promise, { sanction: current, disguiseSkinId: null });
          const result = await body<ClubFineResponse>(await request(owner, payment));
          assert.equal(result.status, 'paid');
          assert.equal(result.replayed, replayed);
          assert.deepEqual(result.sanction, replayed ? current : null);
        } finally { release.resolve(); }
      });
    } finally { held.mock.restore(); }
  };

  const marked = await joinDuringPayment(oldPayment, true);
  assert.deepEqual({ hall: marked.player.hall, x: marked.player.x, y: marked.player.y }, { hall: 'street', ...STREET.spawn });
  assert(!marked.packets.includes('club-sanction-changed'));
  await marked.enter();
  marked.spot();
  assert.equal(marked.guard.target, marked.client.sessionId);

  const cleared = await joinDuringPayment(quote(current), false);
  assert.equal(cleared.player.hall, 'arcade');
  assert.equal(marked.guard.target, '', 'the genuine payment also cancels the pursuit in the already joined room');
  assert.equal(cleared.packets.filter(packet => packet === 'club-sanction-changed').length, 1);
  assert.equal((await body<ClubFineStatus>(await request(owner))).sanction, null);
});

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import type { Client } from '@colyseus/core';
import { accounts } from '../server/accounts';
import { PostgresDatabase } from '../server/database';
import type { Guards } from '../server/guards';
import { LobbyRoom } from '../server/LobbyRoom';
import type { ChatResult } from '../src/shared/chat';
import { ROOF_STAIR_ROUTE } from '../src/shared/rooftop';
import { parseGeneratedAppearance, SKIN_OFFERS, SKIN_THEME, type SkinOfferId } from '../src/shared/skinStudio';
import { STREET } from '../src/shared/street';
import { hallLinks, type HallId } from '../src/shared/world';

type Handler = (client: Client, value?: unknown) => void | Promise<void>;
const disguiseOffer = 'Жора: Охрана тебя ищет? Могу подобрать маскировку.';
const disguiseExposed = 'Охрана раскрыла маскировку. Образ остался в гардеробе.';
const nextTurn = () => new Promise<void>(resolve => setImmediate(resolve));

async function readyOutfit(db: PostgresDatabase, accountId: string, offerId: SkinOfferId) {
  const jobId = randomUUID(), skinId = randomUUID();
  const offer = SKIN_OFFERS[offerId];
  // Start at the provider-independent boundary after generation and payment succeeded.
  // The public wardrobe operation still has to select and equip the owned skin.
  await db.transaction(async () => {
    await db.prepare(`INSERT INTO skin_jobs
      (id, account_id, theme, prompt, state, created_at, variant_count, payment_source, offer_id, price_units)
      VALUES (?, ?, ?, 'Fixture outfit', 'ready', ?, ?, 'virtual-usdt-v1', ?, ?)`)
      .run(jobId, accountId, SKIN_THEME.id, Date.now(), offer.variantCount, offerId, offer.priceUnits);
    await db.prepare('INSERT INTO generated_skins (id, job_id, variant, image) VALUES (?, ?, 0, ?)')
      .run(skinId, jobId, Buffer.from('fixture outfit'));
  });
  return { jobId, skinId };
}

async function roomVisit(context: TestContext, token: string, duringJoin?: () => Promise<void>) {
  const room = new LobbyRoom(), handlers = new Map<string, Handler>();
  context.mock.method(room, 'onMessage', (type: string, handler: Handler) => { handlers.set(type, handler); });
  context.mock.method(room, 'setPatchRate', () => {});
  context.mock.method(room, 'setSimulationInterval', () => {});
  context.mock.method(room, 'broadcast', () => {});
  context.mock.method(room.clock, 'setInterval', () => ({ clear() {} }));
  room.onCreate();
  context.after(() => { room.onDispose(); room.clock.clear(); });

  const packets: { type: string; value: unknown }[] = [];
  const client = {
    sessionId: randomUUID(),
    send(type: string, value: unknown) { packets.push({ type, value }); },
    leave() {},
  } as unknown as Client;
  const auth = (await accounts.session(token))!;
  client.auth = auth;
  room.clients.push(client);
  await Promise.all([room.onJoin(client, {}, auth), duringJoin?.()]);

  const player = room.state.players.get(client.sessionId)!;
  const guard = room.state.guards.get('security')!;
  const { guards } = room as unknown as { guards: Guards };
  let sequence = 0;
  const send = (type: string, value?: unknown) => handlers.get(type)!(client, value);
  const cross = async (hall: HallId) => {
    const link = hallLinks(player.hall as HallId).find(candidate => candidate.target === hall);
    assert(link, `no route from ${player.hall} to ${hall}`);
    Object.assign(player, link.door.entry);
    await send('inputs', { revision: player.hallRevision, inputs: [{ seq: ++sequence, x: 0, y: 0, ms: 0 }] });
    assert.equal(player.hall, hall);
  };
  const enterRestroom = async () => {
    player.stairStep = ROOF_STAIR_ROUTE.length - 1;
    await cross('roof');
    await cross('toilet');
  };
  const faceVisitor = (facing: 'up' | 'down', distance = 90) => {
    Object.assign(guard, { hall: player.hall, x: player.x, y: player.y + distance, facing, phase: 'idle' });
  };
  return { client, player, guard, guards, packets, send, cross, enterRestroom, faceVisitor };
}

async function markedAccount(context: TestContext) {
  const login = await accounts.login(`club-disguise-${randomUUID()}@example.test`, 'Club-disguise-test-password!');
  const accountId = login.account.id;
  context.after(() => accounts.logout(login.token));
  await accounts.select(accountId, 0);
  const db = new PostgresDatabase(accounts.schema, { existingSchema: true });
  context.after(() => db.close());
  await db.ready;

  const { outcome: { sanction } } = await accounts.clubSanctions.recordViolation(accountId, { id: randomUUID(), reason: 'spam' });
  return { token: login.token, accountId, db, sanction };
}

test('a marked restroom visitor can disguise, be exposed by new misconduct and replace the disguise', async context => {
  const { token, accountId, db, sanction } = await markedAccount(context);
  const usability = context.mock.method(accounts.clubSanctions, 'isUsableDisguise');
  const capture = context.mock.method(accounts.clubSanctions, 'recordCapture');
  const { client, player, guard, guards, packets, send, cross, enterRestroom, faceVisitor } = await roomVisit(context, token);

  const offers = () => packets.filter(packet => packet.type === 'notice' && packet.value === disguiseOffer);
  const chooseOutfit = async () => {
    const { jobId, skinId } = await readyOutfit(db, accountId, 'janitor');
    const before = usability.mock.callCount();
    await accounts.skinStudio.choose(accountId, jobId, skinId, 'janitor');
    await nextTurn();
    const refresh = usability.mock.calls.slice(before).find(call => call.arguments[0] === accountId && call.arguments[1] === skinId);
    assert(refresh, 'equipping a skin refreshes the live guard cache');
    await refresh.result;
    await nextTurn();
    assert.equal(parseGeneratedAppearance(player.appearance)?.skinId, skinId);
    return skinId;
  };

  assert.equal(player.hall, 'street');
  assert.equal(offers().length, 0);
  await enterRestroom();
  await nextTurn();
  assert.equal(offers().length, 1);
  await send('history');
  faceVisitor('up', 20);
  guards.tick(0);
  assert.equal(offers().length, 1, 'fetching history does not repeat the offer');
  assert.equal(guard.target, '', 'the guard leaves the marked visitor alone in the restroom');
  assert.equal(capture.mock.callCount(), 0);

  const firstSkin = await chooseOutfit();
  assert.deepEqual(await accounts.clubSanctions.enforcement(accountId), { sanction, disguiseSkinId: firstSkin });
  await cross('github');
  faceVisitor('up');
  guards.tick(0);
  assert.equal(guard.target, '', 'fresh sighting ignores an owned, equipped and unrevealed Janitor skin');
  await cross('toilet');
  await nextTurn();
  assert.equal(offers().length, 1, 'a visitor with a working disguise needs no replacement offer');
  await cross('github');

  const other = await roomVisit(context, token);
  await other.enterRestroom();
  await other.cross('github');
  other.faceVisitor('up');
  other.guards.tick(0);
  assert.equal(other.guard.target, '', 'a new room loads the active disguise from storage');

  faceVisitor('down');
  const id = randomUUID();
  await send('chat', { id, text: 'fuck shit Scheiße putain coño cazzo kurwa caralho klootzak idiot' });
  const results = packets.filter(packet => packet.type === 'chat-result').map(packet => packet.value as ChatResult);
  assert.equal(results.findLast(result => result.id === id)?.status, 'rejected');
  other.guards.tick(0);
  assert.equal(other.guard.target, other.client.sessionId, 'the other room drops its cached disguise immediately after exposure');
  assert.equal(other.packets.filter(packet => packet.type === 'notice' && packet.value === disguiseExposed).length, 1);
  assert.deepEqual(await accounts.clubSanctions.enforcement(accountId), { sanction, disguiseSkinId: null });
  assert.equal(parseGeneratedAppearance(player.appearance)?.skinId, firstSkin, 'exposure preserves the appearance');
  guards.tick(0);
  assert.equal(guard.target, client.sessionId, 'a confirmed violation launches direct pursuit even outside the guard’s field of view');
  assert.equal(capture.mock.callCount(), 0, 'the mark only grows after physical capture');

  Object.assign(guard, { x: player.x, y: player.y + 20 });
  guards.tick(0);
  assert.equal(capture.mock.callCount(), 1);
  await capture.mock.calls[0].result;
  await nextTurn();
  const extended = { ...sanction, until: sanction.until + 10 * 60_000, amountCents: sanction.amountCents + 500, revision: sanction.revision + 1 };
  assert.deepEqual(await accounts.clubSanctions.active(accountId), extended);
  for (let step = 0; step < 1200 && player.hall !== 'street'; step++) guards.tick(.05);
  assert.deepEqual({ hall: player.hall, x: player.x, y: player.y }, { hall: 'street', ...STREET.spawn });
  assert.equal(packets.filter(packet => packet.type === 'club-capture').length, 1);
  assert.equal(packets.filter(packet => packet.type === 'club-ejected').length, 1);

  await enterRestroom();
  await nextTurn();
  assert.equal(offers().length, 2, 'the next restroom visit offers a replacement after exposure');
  const wardrobe = await accounts.skinStudio.snapshot(accountId, 'janitor');
  assert.equal(wardrobe.equippedId, firstSkin);
  assert(wardrobe.wardrobe.some(skin => skin.id === firstSkin));
  await cross('github');
  faceVisitor('up');
  guards.tick(0);
  assert.equal(guard.target, client.sessionId, 'the exposed skin cannot block a later sighting');
  await cross('toilet');
  assert.equal(guard.target, '', 'the visitor can escape that pursuit into the restroom');

  const replacement = await chooseOutfit();
  assert.notEqual(replacement, firstSkin);
  assert.deepEqual(await accounts.clubSanctions.enforcement(accountId), { sanction: extended, disguiseSkinId: replacement });
  await cross('github');
  faceVisitor('up');
  guards.tick(0);
  assert.equal(guard.target, '', 'a different Janitor skin hides the account while the same mark remains active');
});

test('a pending outfit check holds fresh sighting once and an ordinary outfit cannot repeat the hold', async context => {
  const { token, accountId, db } = await markedAccount(context);
  const lookup = accounts.clubSanctions.isUsableDisguise.bind(accounts.clubSanctions);
  const release = new Map<string, () => void>();
  const checks = context.mock.method(accounts.clubSanctions, 'isUsableDisguise', async (id: string, skinId: string) => {
    await new Promise<void>(resolve => { release.set(skinId, resolve); });
    return lookup(id, skinId);
  });
  const visitor = await roomVisit(context, token);
  const finishCheck = async (skinId: string, usable: boolean) => {
    const call = checks.mock.calls.find(entry => entry.arguments[1] === skinId);
    const resume = release.get(skinId);
    assert(call && resume, 'the outfit check is awaiting its database lookup');
    resume();
    assert.equal(await call.result, usable);
    await nextTurn();
  };

  await visitor.enterRestroom();
  const disguise = await readyOutfit(db, accountId, 'janitor');
  await accounts.skinStudio.choose(accountId, disguise.jobId, disguise.skinId, 'janitor');
  await visitor.cross('github');
  visitor.faceVisitor('up');
  visitor.guards.tick(0);
  assert.equal(visitor.guard.target, '', 'an unchecked disguise can cross a floor before its lookup returns');
  await finishCheck(disguise.skinId, true);
  visitor.guards.tick(0);
  assert.equal(visitor.guard.target, '', 'an approved disguise continues to hide the visitor');

  const ordinary = await readyOutfit(db, accountId, 'atelier');
  await accounts.skinStudio.choose(accountId, ordinary.jobId, ordinary.skinId, 'atelier');
  await accounts.skinStudio.equip(accountId, ordinary.skinId, 'atelier');
  assert.equal(checks.mock.callCount(), 2, 're-equipping while pending shares the original check');
  visitor.guards.tick(0);
  assert.equal(visitor.guard.target, '', 'fresh recognition waits for the ordinary outfit check too');

  await finishCheck(ordinary.skinId, false);
  await accounts.skinStudio.equip(accountId, ordinary.skinId, 'atelier');
  assert.equal(checks.mock.callCount(), 2, 're-equipping an ordinary outfit reuses its negative result');
  visitor.guards.tick(0);
  assert.equal(visitor.guard.target, visitor.client.sessionId, 'the guard resumes visual recognition for an ordinary outfit');
});

test('equipping a disguise while joining validates it after the earlier sanction snapshot returns', { timeout: 15000 }, async context => {
  const { token, accountId, db, sanction } = await markedAccount(context);
  const outfit = await readyOutfit(db, accountId, 'janitor');
  const readEnforcement = accounts.clubSanctions.enforcement.bind(accounts.clubSanctions);
  const snapshotRead = Promise.withResolvers<Awaited<ReturnType<typeof readEnforcement>>>();
  const returnSnapshot = Promise.withResolvers<void>();
  context.mock.method(accounts.clubSanctions, 'enforcement', async (id: string) => {
    const snapshot = await readEnforcement(id);
    snapshotRead.resolve(snapshot);
    await returnSnapshot.promise;
    return snapshot;
  });
  const checks = context.mock.method(accounts.clubSanctions, 'isUsableDisguise');
  const visitor = await roomVisit(context, token, async () => {
    try {
      assert.deepEqual(await snapshotRead.promise, { sanction, disguiseSkinId: null });
      await accounts.skinStudio.choose(accountId, outfit.jobId, outfit.skinId, 'janitor');
      assert.equal(checks.mock.callCount(), 0, 'the join has not loaded the mark yet');
    } finally { returnSnapshot.resolve(); }
  });

  assert.equal(visitor.player.hall, 'street');
  assert.equal(parseGeneratedAppearance(visitor.player.appearance)?.skinId, outfit.skinId);
  assert.equal(checks.mock.callCount(), 1, 'joining schedules validation for the outfit equipped during the snapshot read');
  assert.deepEqual(checks.mock.calls[0].arguments, [accountId, outfit.skinId]);
  assert.equal(await checks.mock.calls[0].result, true);
  await nextTurn();
  await visitor.enterRestroom();
  await visitor.cross('github');
  visitor.faceVisitor('up');
  visitor.guards.tick(0);
  assert.equal(visitor.guard.target, '', 'a fresh sighting honors the new disguise after joining');
});

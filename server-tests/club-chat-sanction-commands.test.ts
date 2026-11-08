import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { createChatMessageId } from '../src/shared/chat';
import { SKIN_THEME } from '../src/shared/skinStudio';
import {
  ClubChatSanctionCommands, createClubChatSanctionCommand, fingerprintClubChatSanctionCommand,
} from '../server/clubChatSanctionCommands';
import { ClubSanctionStore } from '../server/clubSanctions';
import { PostgresDatabase } from '../server/database';

const epoch = '601c144d-7064-4e29-8ce0-91f0829946f0';
const initialAt = 1000;

function command(changes: Partial<Parameters<typeof createClubChatSanctionCommand>[0]> = {}) {
  return createClubChatSanctionCommand({
    accountId: 'alice', messageId: createChatMessageId(initialAt), roomEpoch: epoch, visitId: 4,
    location: 'arcade', reason: 'spam', clearanceGeneration: 0, equippedSkinId: null, ...changes,
  });
}

async function fixture(context: TestContext) {
  const db = new PostgresDatabase(':memory:');
  context.after(async () => {
    try { await db.dropSchema(); } finally { await db.close(); }
  });
  const setup = db.exec(`
    CREATE TABLE accounts (id TEXT PRIMARY KEY, appearance JSONB);
    INSERT INTO accounts(id) VALUES ('alice'), ('bob');
    CREATE TABLE skin_jobs (id TEXT PRIMARY KEY, selected_id TEXT, state TEXT, theme TEXT, offer_id TEXT, account_id TEXT);
    CREATE TABLE generated_skins (id TEXT PRIMARY KEY, job_id TEXT REFERENCES skin_jobs(id));
  `);
  const debits: { accountId: string; operationId: string; amountCents: number }[] = [];
  const sanctions = new ClubSanctionStore(db, setup, setup, async (accountId, operationId, amountCents) => {
    debits.push({ accountId, operationId, amountCents });
    return true;
  });
  let time = initialAt;
  const commands = new ClubChatSanctionCommands(db, sanctions, () => time);
  await commands.ready;
  return { db, sanctions, commands, debits, setTime: (at: number) => { time = at; } };
}

test('command identity follows account and source UUID while the digest binds all original fields', () => {
  const original = command(), messageId = original.messageId;
  assert(Object.isFrozen(original));
  const canonical = command({ messageId: messageId.toUpperCase(), roomEpoch: epoch.toUpperCase() });
  assert.deepEqual(canonical, original);
  assert.equal(fingerprintClubChatSanctionCommand(canonical), fingerprintClubChatSanctionCommand(original));

  for (const changes of [{ reason: 'profanity' }, { clearanceGeneration: 1 }, { visitId: 5 },
    { roomEpoch: randomUUID() }, { location: 'toilet' }, { equippedSkinId: randomUUID() }] as const) {
    const changed = command({ messageId, ...changes });
    assert.equal(changed.eventId, original.eventId);
    assert.notEqual(fingerprintClubChatSanctionCommand(changed), fingerprintClubChatSanctionCommand(original));
  }
  assert.notEqual(command({ accountId: 'bob', messageId }).eventId, original.eventId);
  assert.notEqual(command().eventId, original.eventId);
  assert.throws(() => command({ messageId: randomUUID() }), /Invalid club chat sanction command/);
  assert.throws(() => command({ equippedSkinId: undefined }), /Invalid club chat sanction command/);
});

test('concurrent retries persist one original outcome and return it after an expired mark without normalizing it', async context => {
  const { db, sanctions, commands, setTime } = await fixture(context);
  const input = command();
  const other = new PostgresDatabase(db.schema, { existingSchema: true });
  context.after(() => other.close());
  const second = new ClubChatSanctionCommands(other, new ClubSanctionStore(other), () => initialAt);
  const [first, replay] = await Promise.all([commands.apply(input), second.apply(input)]);
  assert.equal(first.status, 'applied');
  assert.deepEqual(replay, first);
  assert.deepEqual(first.state, { clearanceGeneration: 0, stateVersion: 1 });
  assert.equal(first.pursuitId, 'chat-v2:' + input.eventId);
  assert.deepEqual({ until: first.sanction.until, amountCents: first.sanction.amountCents, revision: first.sanction.revision },
    { until: initialAt + 20 * 60_000, amountCents: 1000, revision: 1 });
  assert.equal((await sanctions.recordCapture('alice', { sanctionId: first.sanction.id, pursuitId: first.pursuitId }, initialAt)).outcome?.kind, 'initial');

  setTime(first.sanction.until);
  assert.deepEqual(await commands.apply(input), first);
  assert.deepEqual(await commands.apply(command({ messageId: input.messageId, visitId: 5 })),
    { version: 1, eventId: input.eventId, status: 'id_conflict' });
  assert.equal((await db.prepare('SELECT episode_id FROM club_sanctions WHERE account_id=?').get('alice'))?.episode_id, first.sanction.id);
  assert.deepEqual(await db.prepare('SELECT clearance_generation,state_version FROM club_conduct_state WHERE account_id=?').get('alice'),
    { clearance_generation: 0, state_version: 1 });
  const pending = await db.prepare('SELECT payload FROM club_chat_room_outbox WHERE delivered_at IS NULL').all();
  assert.deepEqual(pending, [{ payload: { command: input, receipt: first } }]);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM club_sanction_events WHERE kind='violation'").get())?.n, 1);
});

test('expiry and payment make older commands obsolete without creating another mark or room event', async context => {
  const { db, sanctions, commands, setTime, debits } = await fixture(context);
  const original = command(), delayedBeforeExpiry = command();
  const first = await commands.apply(original);
  assert.equal(first.status, 'applied');
  setTime(first.sanction.until);
  const expired = await commands.apply(delayedBeforeExpiry);
  assert.deepEqual(expired, { version: 1, eventId: delayedBeforeExpiry.eventId, status: 'obsolete',
    state: { clearanceGeneration: 1, stateVersion: 2 } });
  assert.equal(await sanctions.active('alice', first.sanction.until), null);

  const current = command({ clearanceGeneration: 1 });
  const delayedBeforePay = command({ clearanceGeneration: 1 });
  const fresh = await commands.apply(current);
  assert.equal(fresh.status, 'applied');
  assert.equal(fresh.sanction.until, first.sanction.until + 20 * 60_000);
  assert.equal(fresh.state.stateVersion, 3);
  const pay = { id: randomUUID(), sanctionId: fresh.sanction.id, revision: fresh.sanction.revision, amountCents: fresh.sanction.amountCents };
  assert.equal((await sanctions.pay('alice', pay, first.sanction.until + 1)).status, 'paid');
  setTime(first.sanction.until + 2);
  const afterPay = await commands.apply(delayedBeforePay);
  assert.deepEqual(afterPay, { version: 1, eventId: delayedBeforePay.eventId, status: 'obsolete',
    state: { clearanceGeneration: 2, stateVersion: 4 } });
  assert.deepEqual(await commands.apply(delayedBeforeExpiry), expired);
  assert.deepEqual(await commands.apply(current), fresh);
  assert.deepEqual(debits, [{ accountId: 'alice', operationId: pay.id, amountCents: 1000 }]);
  assert.equal(await sanctions.active('alice', first.sanction.until + 2), null);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM club_chat_room_outbox').get())?.n, 2);
});

test('default command timing follows PostgreSQL when the Node clock is behind or ahead', async context => {
  const { db, sanctions } = await fixture(context);
  const commands = new ClubChatSanctionCommands(db, sanctions);
  await commands.ready;

  const clock = db.prepare('SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms');
  const databaseNow = (await clock.get())?.now_ms;
  assert.equal(typeof databaseNow, 'number');
  const minute = 60_000, duration = 20 * minute;
  const original = await sanctions.recordViolation('alice', { id: 'prior', reason: 'spam' }, databaseNow - duration - minute);
  let nodeNow = databaseNow - 60 * minute;
  context.mock.method(Date, 'now', () => nodeNow);

  assert(original.outcome.sanction.until < databaseNow);
  assert.equal(await sanctions.active('alice'), null);
  const stale = command();
  assert.deepEqual(await commands.apply(stale), { version: 1, eventId: stale.eventId, status: 'obsolete',
    state: { clearanceGeneration: 1, stateVersion: 2 } });
  assert.equal(await db.prepare('SELECT 1 FROM club_sanctions WHERE account_id=?').get('alice'), undefined);
  assert.equal(await db.prepare('SELECT 1 FROM club_chat_room_outbox WHERE event_id=?').get(stale.eventId), undefined);

  const fresh = command({ clearanceGeneration: 1 });
  const opened = await commands.apply(fresh);
  assert.equal(opened.status, 'applied');
  assert.equal(opened.opened, true);
  const createdAt = (await db.prepare('SELECT created_at FROM club_chat_room_outbox WHERE event_id=?').get(fresh.eventId))?.created_at;
  const after = (await clock.get())?.now_ms;
  assert(createdAt >= databaseNow && createdAt <= after);
  assert.equal(opened.sanction.until, createdAt + duration);

  nodeNow = databaseNow + 60 * minute;
  assert.deepEqual(await sanctions.active('alice'), opened.sanction);
  const current = await commands.apply(command({ clearanceGeneration: 1 }));
  assert.equal(current.status, 'applied');
  assert.equal(current.opened, false);
  assert.deepEqual(current.sanction, opened.sanction);
  assert.deepEqual(current.state, opened.state);
});

test('clock drift cannot charge an expired fine or close a current episode during capture', async context => {
  const { db, sanctions, debits } = await fixture(context);
  const clock = db.prepare('SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms');
  const databaseNow = (await clock.get())?.now_ms;
  assert.equal(typeof databaseNow, 'number');
  const minute = 60_000, duration = 20 * minute;
  let nodeNow = databaseNow - 60 * minute;
  context.mock.method(Date, 'now', () => nodeNow);

  const open = async (accountId: string, at?: number) => (await sanctions.recordViolation(accountId,
    { id: randomUUID(), reason: 'spam' }, at)).outcome.sanction;
  const quote = (sanction: Awaited<ReturnType<typeof open>>) => ({ id: randomUUID(), sanctionId: sanction.id,
    revision: sanction.revision, amountCents: sanction.amountCents });
  const state = (accountId: string) => db.prepare('SELECT clearance_generation,state_version FROM club_conduct_state WHERE account_id=?').get(accountId);

  const expired = await open('alice', databaseNow - duration - minute);
  assert.deepEqual(await sanctions.pay('alice', quote(expired)), { status: 'inactive', sanction: null });
  assert.deepEqual(debits, []);
  assert.deepEqual(await state('alice'), { clearance_generation: 1, state_version: 2 });

  const expiredAgain = await open('alice', databaseNow - duration - minute);
  assert.deepEqual(await sanctions.recordCapture('alice', { pursuitId: 'expired', sanctionId: expiredAgain.id }),
    { outcome: null, replayed: false });
  assert.deepEqual(await state('alice'), { clearance_generation: 2, state_version: 4 });

  const current = await open('bob');
  assert(current.until >= databaseNow + duration && current.until <= (await clock.get())?.now_ms + duration);
  nodeNow = databaseNow + 60 * minute;
  assert.deepEqual(await sanctions.enforcement('bob'), { sanction: current, disguiseSkinId: null });
  const capture = await sanctions.recordCapture('bob', { pursuitId: 'current', sanctionId: current.id });
  const extended = { ...current, until: current.until + 10 * minute, amountCents: 1500, revision: 2 };
  assert.deepEqual(capture, { outcome: { sanction: extended, kind: 'repeat' }, replayed: false });
  assert.deepEqual(await state('bob'), { clearance_generation: 0, state_version: 2 });

  const request = quote(extended);
  const paid = await sanctions.pay('bob', request);
  assert.equal(paid.status, 'paid');
  assert(paid.receipt.paidAt >= databaseNow && paid.receipt.paidAt <= (await clock.get())?.now_ms);
  assert.deepEqual(debits, [{ accountId: 'bob', operationId: request.id, amountCents: 1500 }]);
  assert.deepEqual(await state('bob'), { clearance_generation: 1, state_version: 3 });
});

test('a delayed toilet command exposes the observed skin and emits no pursuit', async context => {
  const { db, sanctions, commands } = await fixture(context);
  const observed = randomUUID(), currentlyEquipped = randomUUID();
  for (const skin of [observed, currentlyEquipped]) {
    const job = randomUUID();
    await db.prepare("INSERT INTO skin_jobs VALUES (?,?,'selected',?,'janitor','alice')").run(job, skin, SKIN_THEME.id);
    await db.prepare('INSERT INTO generated_skins VALUES (?,?)').run(skin, job);
  }
  await sanctions.recordViolation('alice', { id: 'initial', reason: 'spam', equippedSkinId: null }, initialAt);
  await db.prepare("UPDATE accounts SET appearance=?::jsonb WHERE id='alice'")
    .run(JSON.stringify({ version: 2, skinId: currentlyEquipped, theme: SKIN_THEME.id }));
  const input = command({ location: 'toilet', equippedSkinId: observed, reason: 'profanity' });
  const result = await commands.apply(input);
  assert.equal(result.status, 'applied');
  assert.equal(result.revealedSkinId, observed);
  assert.equal(result.pursuitId, null);
  assert.equal(result.opened, false);
  assert.deepEqual(result.state, { clearanceGeneration: 0, stateVersion: 2 });
  assert.deepEqual((await db.prepare('SELECT room_epoch,payload FROM club_chat_room_outbox WHERE event_id=?').get(input.eventId)),
    { room_epoch: epoch, payload: { command: input, receipt: result } });

  const unmasked = await commands.apply(command({ location: 'toilet', equippedSkinId: null }));
  assert.equal(unmasked.status, 'applied');
  assert.equal(unmasked.revealedSkinId, null);
  assert.deepEqual(await db.prepare('SELECT skin_id FROM club_disguise_exposures').all(), [{ skin_id: observed }]);
});

test('an outbox insert failure rolls back the sanction, generation and receipt together', async context => {
  const { db, sanctions, commands } = await fixture(context);
  const input = command();
  await db.exec("ALTER TABLE club_chat_room_outbox ADD CONSTRAINT test_refuse_room CHECK (room_epoch = 'excluded')");
  await assert.rejects(commands.apply(input), error => (error as { code?: string }).code === '23514');
  assert.equal(await sanctions.active('alice', initialAt), null);
  assert.equal(await db.prepare('SELECT 1 FROM club_conduct_state').get(), undefined);
  assert.equal(await db.prepare('SELECT 1 FROM club_sanction_events').get(), undefined);
  assert.equal(await db.prepare('SELECT 1 FROM club_chat_sanction_receipts').get(), undefined);
  await db.exec('ALTER TABLE club_chat_room_outbox DROP CONSTRAINT test_refuse_room');
  const retry = await commands.apply(input);
  assert.equal(retry.status, 'applied');
  assert.equal(retry.pursuitId, 'chat-v2:' + input.eventId);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM club_chat_room_outbox').get())?.n, 1);
});

test('tampered identities, ahead generations and different database instances fail closed', async context => {
  const { db, sanctions, commands } = await fixture(context);
  const input = command();
  await assert.rejects(commands.apply({ ...input, accountId: 'bob' }), /command identity/);
  await assert.rejects(commands.apply({ ...input, version: 2 }), /command identity/);
  await assert.rejects(commands.apply({ ...input, equippedSkinId: undefined }), /Invalid club chat sanction command/);
  await assert.rejects(commands.apply(command({ clearanceGeneration: 1 })), /ahead of game state/);
  assert.equal(await db.prepare('SELECT 1 FROM club_chat_sanction_receipts').get(), undefined);
  assert.equal(await db.prepare('SELECT 1 FROM club_chat_room_outbox').get(), undefined);
  const other = new PostgresDatabase(db.schema, { existingSchema: true });
  context.after(() => other.close());
  await other.ready;
  assert.throws(() => new ClubChatSanctionCommands(other, sanctions), /must share the sanction transaction/);
});

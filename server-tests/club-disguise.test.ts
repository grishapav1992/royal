import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { ClubSanctionStore } from '../server/clubSanctions';
import { PostgresDatabase } from '../server/database';
import { SkinStudioStore } from '../server/skinStudio';
import { SKIN_OFFERS, SKIN_THEME, type SkinOfferId } from '../src/shared/skinStudio';

const START = 1_000;

function skinStudio(db: PostgresDatabase) {
  return new SkinStudioStore(db,
    { skinPurchase: async () => assert.fail('wardrobe fixture must not charge the wallet') },
    { available: () => false, generate: async () => assert.fail('wardrobe fixture must not generate an image') },
    () => false, () => {});
}

async function fixture(context: TestContext) {
  const db = new PostgresDatabase(':memory:');
  context.after(() => db.close());
  await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY,skin INTEGER DEFAULT 0,appearance JSONB); INSERT INTO accounts(id) VALUES ('alice'),('bob')");
  const studio = skinStudio(db);
  const store = new ClubSanctionStore(db, Promise.resolve(), studio.ready);
  await store.ready;

  const outfit = async (accountId: string, offerId: SkinOfferId, select = true) => {
    const jobId = randomUUID(), skinId = randomUUID();
    const offer = SKIN_OFFERS[offerId];
    await db.prepare(`INSERT INTO skin_jobs
      (id,account_id,theme,prompt,state,created_at,variant_count,payment_source,offer_id,price_units)
      VALUES (?,?,?,?,'ready',?,?,'virtual-usdt-v1',?,?)`)
      .run(jobId, accountId, SKIN_THEME.id, 'Test outfit', START, offer.variantCount, offerId, offer.priceUnits);
    await db.prepare('INSERT INTO generated_skins(id,job_id,variant,image) VALUES (?,?,0,?)')
      .run(skinId, jobId, Buffer.from('test artwork'));
    if (select) await studio.choose(accountId, jobId, skinId, offerId);
    return skinId;
  };
  const forceAppearance = (skinId: string, theme: string = SKIN_THEME.id) => db.prepare('UPDATE accounts SET appearance=?::jsonb WHERE id=?')
    .run(JSON.stringify({ version: 2, skinId, theme }), 'alice');
  return { db, studio, store, outfit, forceAppearance };
}

test('only a marked visitor with an owned selected Janitor skin equipped gains a disguise', async context => {
  const { studio, store, outfit, forceAppearance } = await fixture(context);
  const janitor = await outfit('alice', 'janitor');
  assert.deepEqual(await store.enforcement('alice', START), { sanction: null, disguiseSkinId: null });
  const { outcome: { sanction, opened, revealedSkinId } } = await store.recordViolation('alice', {
    id: 'first', reason: 'spam',
  }, START);
  assert.equal(opened, true);
  assert.equal(revealedSkinId, undefined);
  assert.deepEqual(await store.enforcement('alice', START), { sanction, disguiseSkinId: janitor });

  await outfit('alice', 'atelier');
  assert.deepEqual(await store.enforcement('alice', START), { sanction, disguiseSkinId: null });
  const foreign = await outfit('bob', 'janitor');
  await assert.rejects(studio.equip('alice', foreign, 'janitor'), { status: 404 });
  await forceAppearance(foreign);
  assert.deepEqual(await store.enforcement('alice', START), { sanction, disguiseSkinId: null });

  const unselected = await outfit('alice', 'janitor', false);
  await forceAppearance(unselected);
  assert.deepEqual(await store.enforcement('alice', START), { sanction, disguiseSkinId: null });
  await forceAppearance(janitor, 'unknown-theme');
  assert.deepEqual(await store.enforcement('alice', START), { sanction, disguiseSkinId: null });
  await studio.equip('alice', janitor, 'janitor');
  assert.deepEqual(await store.enforcement('alice', START), { sanction, disguiseSkinId: janitor });
});

test('an active offense exposes only the worn Janitor skin across re-equipment, reopening and later episodes', async context => {
  const { db, studio, store, outfit } = await fixture(context);
  const firstSkin = await outfit('alice', 'janitor');
  const { outcome: { sanction } } = await store.recordViolation('alice', { id: 'initial', reason: 'spam' }, START);
  const repeat = { id: 'repeat', reason: 'profanity' } as const;
  const exposed = await store.recordViolation('alice', repeat, START + 1);
  assert.equal(exposed.replayed, false);
  assert.deepEqual(exposed.outcome, { sanction, opened: false, revealedSkinId: firstSkin });
  assert.deepEqual(await store.enforcement('alice', START + 1), { sanction, disguiseSkinId: null });
  const wardrobe = await studio.snapshot('alice', 'janitor');
  assert.equal(wardrobe.equippedId, firstSkin);
  assert(wardrobe.wardrobe.some(card => card.id === firstSkin), 'revealing an outfit must preserve the cosmetic');

  const replacement = await outfit('alice', 'janitor');
  assert.notEqual(replacement, firstSkin);
  assert.deepEqual(await store.enforcement('alice', START + 2), { sanction, disguiseSkinId: replacement });
  assert.deepEqual(await store.recordViolation('alice', repeat, START + 2), { outcome: exposed.outcome, replayed: true });
  assert.deepEqual(await store.enforcement('alice', START + 2), { sanction, disguiseSkinId: replacement });
  await studio.equip('alice', firstSkin, 'janitor');
  assert.deepEqual(await store.enforcement('alice', START + 2), { sanction, disguiseSkinId: null });
  await db.close();

  const reopened = new PostgresDatabase(db.schema, { existingSchema: true });
  context.after(() => reopened.close());
  const reopenedStudio = skinStudio(reopened);
  const restored = new ClubSanctionStore(reopened, Promise.resolve(), reopenedStudio.ready);
  assert.deepEqual(await restored.enforcement('alice', START + 3), { sanction, disguiseSkinId: null });
  const nextAt = sanction.until + 1;
  assert.deepEqual(await restored.enforcement('alice', nextAt), { sanction: null, disguiseSkinId: null });
  const { outcome: next } = await restored.recordViolation('alice', { id: 'next', reason: 'spam' }, nextAt);
  assert.equal(next.opened, true);
  assert.notEqual(next.sanction.id, sanction.id);
  assert.equal(next.revealedSkinId, undefined);
  assert.deepEqual(await restored.enforcement('alice', nextAt), { sanction: next.sanction, disguiseSkinId: null });
  await reopenedStudio.equip('alice', replacement, 'janitor');
  assert.deepEqual(await restored.enforcement('alice', nextAt), { sanction: next.sanction, disguiseSkinId: replacement });
});

test('concurrent offenses expose the same equipped disguise only once', async context => {
  const { db, store, outfit } = await fixture(context);
  const disguise = await outfit('alice', 'janitor');
  const { outcome: { sanction } } = await store.recordViolation('alice', { id: 'first', reason: 'spam' }, START);
  const secondWorker = new ClubSanctionStore(db, Promise.resolve(), Promise.resolve());
  const results = await Promise.all([
    store.recordViolation('alice', { id: 'spam', reason: 'spam' }, START + 1),
    secondWorker.recordViolation('alice', { id: 'profanity', reason: 'profanity' }, START + 1),
  ]);
  assert(results.every(result => !result.replayed && !result.outcome.opened));
  assert.deepEqual(results.flatMap(result => result.outcome.revealedSkinId ?? []), [disguise]);
  assert.deepEqual(await store.enforcement('alice', START + 1), { sanction, disguiseSkinId: null });
});

test('confirmation reveals the disguise recorded for the offense if the equipped outfit changes', async context => {
  const { studio, store, outfit } = await fixture(context);
  const atOffense = await outfit('alice', 'janitor');
  const { outcome: { sanction } } = await store.recordViolation('alice', { id: 'first', reason: 'spam' }, START);
  assert.equal((await store.enforcement('alice', START)).disguiseSkinId, atOffense);
  const afterOffense = await outfit('alice', 'janitor');

  const revealed = await store.recordViolation('alice', {
    id: 'delayed', reason: 'profanity', equippedSkinId: atOffense,
  }, START + 1);
  assert.equal(revealed.outcome.revealedSkinId, atOffense);
  assert.deepEqual(await store.enforcement('alice', START + 1), { sanction, disguiseSkinId: afterOffense });

  const unmasked = await store.recordViolation('alice', {
    id: 'without-disguise', reason: 'spam', equippedSkinId: null,
  }, START + 2);
  assert.equal(unmasked.outcome.revealedSkinId, undefined);
  assert.deepEqual(await store.enforcement('alice', START + 2), { sanction, disguiseSkinId: afterOffense });
  await studio.equip('alice', atOffense, 'janitor');
  assert.deepEqual(await store.enforcement('alice', START + 2), { sanction, disguiseSkinId: null });
});

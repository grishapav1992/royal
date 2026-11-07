import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { AccountStore } from '../server/accounts';
import { CryptoError } from '../server/crypto/config';
import { demoBalanceUnits, demoReservedUnits, saveDemoUnits } from '../server/demoWalletAmounts';
import { CommonSkinPayments } from '../server/skinPayments';
import type { ClubFineRequest, ClubSanction } from '../src/shared/security';
import { SKIN_OFFERS } from '../src/shared/skinStudio';

const START = 1_000;
const PAY_AT = START + 1;

async function fixture(context: TestContext, balanceCents: number) {
  let store = new AccountStore(':memory:');
  context.after(() => store.close());
  await store.ready;
  const { account } = await store.login('club-fine@example.test', 'test-password');
  const accountId = account.id;
  await saveDemoUnits(store.financeAdmin.db, accountId, balanceCents);
  return {
    store, accountId,
    async reopen() {
      const schema = store.schema;
      await store.close();
      store = new AccountStore(schema);
      await store.ready;
      return store;
    },
  };
}

async function mark(store: AccountStore, accountId: string, at = START) {
  const { outcome } = await store.clubSanctions.recordViolation(accountId, { id: randomUUID(), reason: 'spam' }, at);
  return outcome.sanction;
}

function quote(sanction: ClubSanction): ClubFineRequest {
  return { id: randomUUID(), sanctionId: sanction.id, revision: sanction.revision, amountCents: sanction.amountCents };
}

async function debits(store: AccountStore, accountId: string) {
  const rows = await store.financeAdmin.db.prepare(`SELECT operation_id,amount_units,balance_units FROM demo_ledger
    WHERE account_id=? AND source='club-fine' ORDER BY id`).all(accountId);
  return rows.map(row => ({ operationId: row.operation_id, amount: Number(row.amount_units), balance: Number(row.balance_units) }));
}

test('a concurrent fine retry records one exact debit and the receipt survives a store restart', async context => {
  const { store, accountId, reopen } = await fixture(context, 2275);
  const request = quote(await mark(store, accountId));
  await store.wallet.operate(accountId, { id: request.id, kind: 'deposit', amount: 1 });
  const expected = { status: 'paid', sanction: null, receipt: { ...request, paidAt: PAY_AT } } as const;
  const attempts = await Promise.all([
    store.clubSanctions.pay(accountId, request, PAY_AT),
    store.clubSanctions.pay(accountId, request, PAY_AT),
  ]);
  assert.equal(attempts.filter(result => result.status === 'paid' && !result.replayed).length, 1);
  for (const result of attempts) {
    assert.equal(result.status, 'paid');
    assert.deepEqual(result, { ...expected, replayed: result.replayed });
  }
  assert.equal(await store.clubSanctions.active(accountId, PAY_AT), null);

  const restored = await reopen();
  assert.deepEqual(await restored.clubSanctions.pay(accountId, request, PAY_AT + 1), { ...expected, replayed: true });
  assert.deepEqual(await restored.clubSanctions.pay(accountId, { ...request, amountCents: 1500 }, PAY_AT + 1),
    { status: 'id-conflict', sanction: null });
  const fresh = await mark(restored, accountId, PAY_AT + 1);
  assert.deepEqual(await restored.clubSanctions.pay(accountId, request, PAY_AT + 2), { ...expected, sanction: fresh, replayed: true });
  assert.deepEqual(await restored.clubSanctions.active(accountId, PAY_AT + 2), fresh);
  assert.deepEqual(await debits(restored, accountId), [{ operationId: `club-fine:${request.id}`, amount: -1000, balance: 1375 }]);
  const wallet = await restored.wallet.snapshot(accountId);
  assert.equal(wallet.balance, 13.75);
  assert(wallet.entries.some(entry => entry.operationId === request.id && entry.kind === 'deposit'));
  const fines = wallet.entries.filter(entry => entry.source === 'club-fine');
  assert.equal(fines.length, 1);
  assert.equal(fines[0].amount, -10);
});

test('competing fine payment IDs close the same sanction and charge the wallet once', async context => {
  const { store, accountId } = await fixture(context, 3000);
  const sanction = await mark(store, accountId);
  const requests = [quote(sanction), quote(sanction)];
  const attempts = await Promise.all(requests.map(request => store.clubSanctions.pay(accountId, request, PAY_AT)));
  const winner = attempts.find(result => result.status === 'paid');
  assert(winner);
  assert.equal(winner.replayed, false);
  assert.deepEqual(attempts.filter(result => result.status !== 'paid'), [{ status: 'inactive', sanction: null }]);
  assert.deepEqual(await debits(store, accountId), [{ operationId: `club-fine:${winner.receipt.id}`, amount: -1000, balance: 2000 }]);
});

test('a ten-dollar fine and a five-dollar Janitor reservation cannot overspend twelve dollars', async context => {
  const { store, accountId } = await fixture(context, 1200);
  const db = store.financeAdmin.db;
  const skinPayments = new CommonSkinPayments(db, store.wallet.ready);
  const sanction = await mark(store, accountId);
  const fineRequest = quote(sanction), skinId = randomUUID();
  const [fine, skin] = await Promise.allSettled([
    store.clubSanctions.pay(accountId, fineRequest, PAY_AT),
    skinPayments.skinPurchase(accountId, skinId, 'reserve', { offerId: 'janitor', priceUnits: SKIN_OFFERS.janitor.priceUnits }),
  ]);
  assert.equal(fine.status, 'fulfilled');
  const wallet = await store.wallet.snapshot(accountId);
  assert.equal(wallet.entries.length, 1);
  const [{ source, operationId, amount }] = wallet.entries;
  if (fine.value.status === 'paid') {
    assert.equal(skin.status, 'rejected');
    assert(skin.reason instanceof CryptoError && skin.reason.status === 409);
    assert.deepEqual({ source, operationId, amount }, { source: 'club-fine', operationId: `club-fine:${fineRequest.id}`, amount: -10 });
    assert.equal(await demoBalanceUnits(db, accountId), 200);
    assert.equal(await demoReservedUnits(db, accountId), 0);
    assert.equal(await store.clubSanctions.active(accountId, PAY_AT), null);
  } else {
    assert.deepEqual(fine.value, { status: 'insufficient', sanction });
    assert.equal(skin.status, 'fulfilled');
    assert.deepEqual(skin.value, { id: skinId, state: 'reserved', amountUnits: '5000000' });
    assert.deepEqual({ source, operationId, amount }, { source: 'janitor-skins', operationId: skinId, amount: -5 });
    assert.equal(await demoBalanceUnits(db, accountId), 700);
    assert.equal(await demoReservedUnits(db, accountId), 500);
    assert.deepEqual(await store.clubSanctions.active(accountId, PAY_AT), sanction);
  }
});

test('a failed fine receipt write rolls back the wallet and permits the same operation to retry', async context => {
  const { store, accountId } = await fixture(context, 1675);
  const db = store.financeAdmin.db;
  const sanctions = store.clubSanctions;
  const sanction = await mark(store, accountId);
  const request = quote(sanction);
  await db.exec(`CREATE FUNCTION reject_fine_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Injected fine receipt failure'; END; $$;
    CREATE TRIGGER reject_fine_receipt BEFORE INSERT ON club_fine_payments FOR EACH ROW EXECUTE FUNCTION reject_fine_receipt()`);
  await assert.rejects(() => sanctions.pay(accountId, request, PAY_AT), /Injected fine receipt failure/);
  assert.equal(await demoBalanceUnits(db, accountId), 1675);
  assert.deepEqual(await debits(store, accountId), []);
  assert.deepEqual(await sanctions.active(accountId, PAY_AT), sanction);

  await db.exec('DROP TRIGGER reject_fine_receipt ON club_fine_payments');
  assert.deepEqual(await sanctions.pay(accountId, request, PAY_AT + 1),
    { status: 'paid', sanction: null, receipt: { ...request, paidAt: PAY_AT + 1 }, replayed: false });
  assert.equal(await sanctions.active(accountId, PAY_AT + 1), null);
  assert.deepEqual(await debits(store, accountId), [{ operationId: `club-fine:${request.id}`, amount: -1000, balance: 675 }]);
});

test('capture before payment changes the quote and capture after payment cannot reopen the mark', async context => {
  const { store, accountId } = await fixture(context, 2050);
  const sanctions = store.clubSanctions;
  const first = await mark(store, accountId);
  const stale = quote(first);
  const capture = await sanctions.recordCapture(accountId, { pursuitId: randomUUID(), sanctionId: first.id }, PAY_AT);
  const updated = { ...first, revision: 2, amountCents: 1500, until: first.until + 10 * 60_000 };
  assert.deepEqual(capture, { outcome: { kind: 'repeat', sanction: updated }, replayed: false });
  assert.deepEqual(await sanctions.pay(accountId, stale, PAY_AT + 1), { status: 'changed', sanction: updated });
  assert.equal(await demoBalanceUnits(store.financeAdmin.db, accountId), 2050);
  assert.deepEqual(await debits(store, accountId), []);

  const request = quote(updated);
  assert.deepEqual(await sanctions.pay(accountId, request, PAY_AT + 2),
    { status: 'paid', sanction: null, receipt: { ...request, paidAt: PAY_AT + 2 }, replayed: false });
  assert.deepEqual(await sanctions.recordCapture(accountId, { pursuitId: randomUUID(), sanctionId: first.id }, PAY_AT + 3),
    { outcome: null, replayed: false });
  assert.equal(await sanctions.active(accountId, PAY_AT + 3), null);
  assert.deepEqual(await debits(store, accountId), [{ operationId: `club-fine:${request.id}`, amount: -1500, balance: 550 }]);
});

test('low funds, expiry, and a zero legacy fee leave the wallet untouched', async context => {
  const { store, accountId } = await fixture(context, 999);
  const sanctions = store.clubSanctions;
  const original = await mark(store, accountId);
  const request = quote(original);
  assert.deepEqual(await sanctions.pay(accountId, request, PAY_AT), { status: 'insufficient', sanction: original });
  assert.deepEqual(await sanctions.active(accountId, PAY_AT), original);
  assert.deepEqual(await sanctions.pay(accountId, request, original.until), { status: 'inactive', sanction: null });

  const imported = { ...await mark(store, accountId, original.until), amountCents: 0 };
  const db = store.financeAdmin.db;
  await db.prepare('UPDATE club_sanctions SET amount_cents=0 WHERE account_id=?').run(accountId);
  assert.deepEqual(await sanctions.pay(accountId, quote(imported), original.until), { status: 'inactive', sanction: imported });
  assert.deepEqual(await sanctions.active(accountId, original.until), imported);
  assert.equal(await demoBalanceUnits(db, accountId), 999);
  assert.deepEqual(await debits(store, accountId), []);
});

test('an account finance block rejects a new fine payment but allows reading a completed receipt', async context => {
  const { store, accountId } = await fixture(context, 3000);
  const sanctions = store.clubSanctions;
  const previous = quote(await mark(store, accountId));
  const paid = await sanctions.pay(accountId, previous, PAY_AT);
  assert.equal(paid.status, 'paid');
  const current = await mark(store, accountId, PAY_AT + 1);
  await store.financeAdmin.command({
    id: randomUUID(), actorId: 'finance-admin-test', playerId: accountId,
    source: 'play', action: 'block', reason: 'Verify blocked club fine payments',
  }, async () => assert.fail('the block is handled by the finance admin store'));

  await assert.rejects(() => sanctions.pay(accountId, quote(current), PAY_AT + 2),
    error => error instanceof CryptoError && error.status === 403);
  assert.deepEqual(await sanctions.pay(accountId, previous, PAY_AT + 2), { ...paid, sanction: current, replayed: true });
  assert.deepEqual(await sanctions.active(accountId, PAY_AT + 2), current);
  assert.deepEqual(await debits(store, accountId), [{ operationId: `club-fine:${previous.id}`, amount: -1000, balance: 2000 }]);
});

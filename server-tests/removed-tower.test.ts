import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { GAME_MODULES } from '../src/modules/GameModuleCatalog';
import { GAME_CABINETS } from '../src/shared/cabinets';
import { validCasinoAction, validCasinoSession, isSessionGame } from '../src/shared/casinoSessions';
import { legacyCasinoPayout, verifyLegacyCasinoTransition, verifyLegacyCasinoRetirement } from '../server/games/legacyCasinoSessions';
import { savedTower, seedDemoTower } from './helpers/removed-tower';

async function fixture() {
  const db = new PostgresDatabase(':memory:');
  await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY); INSERT INTO accounts VALUES('alice'),('bob')");
  const wallet = new DemoWalletStore(db, () => { throw Error('Removed game must never draw'); });
  await wallet.ready;
  await wallet.operate('alice', { id: randomUUID(), kind: 'deposit', amount: 1000 });
  return { db, wallet };
}

test('removed Tower has no module, cabinet or accepted live operation', () => {
  assert(!GAME_MODULES.some(module => String(module.gameId) === 'github-tower'));
  assert(!GAME_CABINETS.some(cabinet => cabinet.id === 'github-tower'));
  assert.equal(isSessionGame('github-tower'), false);
  const state = savedTower();
  for (const op of [
    { id: state.id, gameId: state.gameId, action: 'start', stakeUnits: state.stakeUnits, settings: state.settings },
    { id: randomUUID(), gameId: state.gameId, action: 'pick', sessionId: state.id, choice: 1 },
    { id: randomUUID(), gameId: state.gameId, action: 'cashout', sessionId: state.id },
  ]) assert.equal(validCasinoAction(op), false);
  assert.equal(validCasinoSession({ id: state.id, gameId: state.gameId, state: 'active' }), false);
});

for (const choices of [[], [1], [1, 2, 3]]) test(`removed saved Tower settles ${choices.length ? 'cashout' : 'refund'} exactly once after restart`, async () => {
  const { db, wallet } = await fixture();
  try {
    const state = await seedDemoTower(db, 'alice', savedTower(choices));
    const original = JSON.stringify(state), expected = 990 + Number(legacyCasinoPayout(state)) / 100;
    const reopened = new DemoWalletStore(db, () => { throw Error('must not redraw'); });
    const replies = await Promise.all([reopened.snapshot('alice'), wallet.snapshot('alice'), reopened.casino.active('alice')]);
    assert.equal(replies[0].balance, expected); assert.equal(replies[1].balance, expected);
    assert.equal(replies[2].wallet.balance, expected); assert.deepEqual(replies[2].sessions, []);
    assert.equal((await reopened.snapshot('bob')).balance, 0);
    const receipt = (await db.prepare('SELECT * FROM removed_casino_settlements').get())!;
    assert.equal(receipt.original_payload, original); assert.equal(receipt.reason, choices.length ? 'cashout' : 'refund');
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM removed_casino_settlements').get())!.n, 1);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM demo_ledger WHERE entry_type IN ('win','refund')").get())!.n, 1);
    assert.equal(await reopened.casino.reservedUnits('alice'), 0);
    const after = JSON.parse((await db.prepare('SELECT payload FROM demo_casino_sessions WHERE id=?').get(state.id))!.payload);
    assert(verifyLegacyCasinoRetirement(state, after));
    if (!choices.length) assert.equal(verifyLegacyCasinoTransition(state, { id: randomUUID(), gameId: state.gameId, action: 'cashout', sessionId: state.id }, after), false);
    await assert.rejects(reopened.casino.operate('alice', { id: randomUUID(), gameId: state.gameId, action: 'pick', sessionId: state.id, choice: 1 }));
  } finally { await db.close(); }
});

test('failed retirement credit rolls back state, receipt and money before a safe retry', async () => {
  const { db, wallet } = await fixture();
  try {
    const state = await seedDemoTower(db, 'alice');
    await db.exec("CREATE FUNCTION fail_removed_credit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entry_type='win' THEN RAISE EXCEPTION 'retirement interrupted'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_removed_credit BEFORE INSERT ON demo_ledger FOR EACH ROW EXECUTE FUNCTION fail_removed_credit()");
    await assert.rejects(wallet.snapshot('alice'), /retirement interrupted/);
    assert.equal((await db.prepare('SELECT state FROM demo_casino_sessions WHERE id=?').get(state.id))!.state, 'active');
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM removed_casino_settlements').get())!.n, 0);
    assert.equal((await db.prepare('SELECT balance FROM demo_wallets WHERE account_id=?').get('alice'))!.balance, 990);
    await db.exec('DROP TRIGGER fail_removed_credit ON demo_ledger');
    assert.equal((await wallet.snapshot('alice')).balance, 1003.2);
  } finally { await db.close(); }
});

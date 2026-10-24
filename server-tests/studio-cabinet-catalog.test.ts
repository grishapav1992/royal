import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { STUDIO_GAMES, STUDIO_DEFAULTS } from '../src/shared/studioGames';
import { STUDIO_CABINET_GAMES, ACTIVE_STUDIO_GAMES, isRetiredArcadeGame } from '../src/shared/arcadeCatalog';
import { CABINETS } from '../src/shared/cabinets';
import { gameModuleContract } from '../src/modules/GameModuleCatalog';
import { PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { DemoExpansionStore } from '../server/demoExpansion';

test('all copied games are available without adding physical machines', () => {
  assert.equal(ACTIVE_STUDIO_GAMES.length, 39);
  assert.equal(new Set(ACTIVE_STUDIO_GAMES).size, 39);
  assert.deepEqual(ACTIVE_STUDIO_GAMES, STUDIO_GAMES);
  assert.equal(CABINETS.filter(c => c.id.startsWith('studio-')).length, 7);
  for (const id of ACTIVE_STUDIO_GAMES) {
    assert.equal(isRetiredArcadeGame(id), false, id);
    assert.ok(gameModuleContract(id), id);
  }
  assert.equal(isRetiredArcadeGame('variant-double-mines'), true);
});

test('every restored catalogue game accepts a fresh wager and replays it without another debit', async () => {
  const db = new PostgresDatabase(':memory:');
  try {
    await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY);INSERT INTO accounts VALUES('catalog-player')");
    const draw = (max: number) => max - 1;
    const wallet = new DemoWalletStore(db, draw);
    await wallet.operate('catalog-player', { id: randomUUID(), kind: 'deposit', amount: 100000 });
    const store = new DemoExpansionStore(db, id => wallet.snapshot(id), wallet.ready, async () => {}, draw);
    const restored = STUDIO_GAMES.filter(id => !(STUDIO_CABINET_GAMES as readonly string[]).includes(id));
    assert.equal(restored.length, 32);
    for (const gameId of restored) {
      const op = { id: randomUUID(), gameId, action: 'start' as const, stakeUnits: '1000', settings: structuredClone(STUDIO_DEFAULTS[gameId]) };
      const first = await store.operate('catalog-player', op);
      const replay = await store.operate('catalog-player', op);
      assert.equal(first.session.gameId, gameId);
      assert.equal(first.session.spentUnits, '1000');
      assert.equal(replay.replayed, true);
      assert.equal(replay.session.id, first.session.id);
      assert.deepEqual(replay.wallet, first.wallet);
    }
  } finally { await db.close(); }
});

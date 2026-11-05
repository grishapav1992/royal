import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { PostgresDatabase } from '../../server/database';
import { DemoWalletStore } from '../../server/demoWallet';
import { VirtualPvpLedger } from '../../server/pvp/virtual-wallet';
import { PvpStore } from '../../server/pvp/store';
import type { PvpRequest } from '../../src/shared/pvp';
import { TSU_DUEL_STAKES } from '../../src/shared/tsuDuel';

export const choices = [
  'left-win', 'right-win', 'cancel', 'expired', 'server', 'both-disconnect',
  'disconnect-left', 'disconnect-right', 'resign-left', 'resign-right', 'timeout-left', 'timeout-right',
] as const;

const fleet = [0, 6, 20, 24, 28, 40, 44, 48, 60, 64].map(cell => ({ cell, vertical: false }));
const db = new PostgresDatabase(':memory:');
const hash = createHash('sha256');
let cases = 0;
try {
  await db.exec('CREATE TABLE accounts(id TEXT PRIMARY KEY)');
  const common = new DemoWalletStore(db);
  await common.ready;
  const ledger = new VirtualPvpLedger(db, common), store = new PvpStore(ledger);
  await store.ready;
  for (const choice of choices) for (const stakeUnits of TSU_DUEL_STAKES) {
    const ids = [randomUUID(), randomUUID()];
    const roomId = 'battleship-qualification-' + cases;
    const actors = ids.map((accountId, side) => ({ accountId, roomId, name: 'Player ' + side }));
    const people = actors.map(actor => ({ ...actor, connected: true, available: true }));
    const stake = Number(stakeUnits) / 10000;
    let now = Date.now();
    for (const id of ids) {
      await db.prepare('INSERT INTO accounts VALUES(?)').run(id);
      await common.operate(id, { id: randomUUID(), kind: 'deposit', amount: 1000 });
    }
    const step = async (ms: number) => {
      const end = now + ms;
      while (now < end) {
        now = Math.min(end, now + 10000);
        await store.syncRoom(roomId, people, now);
      }
    };
    await step(1);
    const offer: PvpRequest = { id: randomUUID(), action: 'create', gameId: 'battleship', stakeUnits, targetId: ids[1] };
    const id = (await store.command(actors[0], offer, now)).active!.id;
    assert.equal((await store.command(actors[0], offer, now)).active!.id, id);
    const action = async (side: number, kind: 'accept' | 'ready' | 'cancel' | 'resign') => {
      const request = { id: randomUUID(), action: kind, challengeId: id };
      await store.command(actors[side], request, now);
      await store.command(actors[side], request, now);
    };
    const view = async (side: number) => (await store.snapshot(actors[side], now)).battleship!;
    const move = async (side: number, move: Extract<PvpRequest, { action: 'move' }>['move']) => {
      const request = { id: randomUUID(), action: 'move', challengeId: id, revision: (await view(side)).revision, move };
      await store.command(actors[side], request, now);
      await store.command(actors[side], request, now);
    };
    const winner = choice.includes('win') || /^(disconnect|resign|timeout)-/.test(choice)
      ? (choice === 'right-win' || choice.endsWith('-right') ? 1 : 0)
      : null;
    if (choice === 'expired') {
      await step(120001);
    } else {
      await action(1, 'accept');
      if (choice === 'cancel') {
        await action(1, 'cancel');
      } else {
        await action(0, 'ready');
        await action(1, 'ready');
        const first = (await view(0)).actor;
        await move(first, { kind: 'deploy', fleet });
        const restored = new PvpStore(ledger);
        assert.equal((await restored.snapshot(actors[first], now)).battleship!.ownFleet.length, 10);
        assert.deepEqual((await restored.snapshot(actors[1 - first], now)).battleship!.ownFleet, []);
        await move(1 - first, { kind: 'deploy', fleet });
        if (choice === 'left-win' || choice === 'right-win') {
          // A miss hands the first shot to the other side. Hits retain the turn.
          if (first !== winner) await move(first, { kind: 'fire', cell: 99 });
          for (const cell of (await view(1 - winner!)).ownFleet.flat()) {
            await move(winner!, { kind: 'fire', cell });
          }
        } else if (choice.startsWith('resign')) {
          await action(1 - winner!, 'resign');
        } else if (choice.startsWith('timeout')) {
          if (first === winner) await move(first, { kind: 'fire', cell: 99 });
          await step(60001);
        } else if (choice === 'server') {
          now += 16000;
          await store.sweep(now);
        } else {
          for (const side of [0, 1]) if (side !== winner) people[side].connected = false;
          await step(1);
          await step(60001);
        }
      }
    }
    const restarted = new PvpStore(ledger);
    const final = (await restarted.snapshot(actors[0], now)).active!;
    assert.equal(final.winnerId, winner === null ? null : ids[winner]);
    assert.equal(final.status, winner === null ? 'cancelled' : 'finished');
    const balances = await Promise.all(ids.map(async id => Math.round((await common.snapshot(id)).balance * 100)));
    const credits = ids.map((_, side) => winner === null ? stake : winner === side ? stake * 19 / 10 : 0);
    assert.deepEqual(balances, credits.map(credit => 100000 - stake + credit));
    const entries = await db.prepare(
      "SELECT entry_type, count(*) AS n FROM demo_ledger WHERE account_id IN (?,?) GROUP BY entry_type",
    ).all(...ids);
    const counts = Object.fromEntries(entries.map(row => [row.entry_type, Number(row.n)]));
    assert.equal(counts.bet, choice === 'expired' ? 1 : 2);
    assert.equal(counts.win ?? 0, winner === null ? 0 : 1);
    assert.equal(counts.refund ?? 0, winner === null ? counts.bet : 0);
    const bank = await db.prepare('SELECT fee_units FROM virtual_pvp_banks WHERE match_id=?').get(id);
    const fee = winner === null ? 0 : stake / 10;
    assert.equal(Number(bank!.fee_units), fee);
    hash.update(JSON.stringify([choice, stake, credits, fee, counts.bet]) + '\n');
    cases++;
  }
  console.log('BATTLESHIP_WALLET ' + JSON.stringify({ cases, sha256: hash.digest('hex') }));
} finally {
  await db.close();
}

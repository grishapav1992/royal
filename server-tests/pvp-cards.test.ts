import test from 'node:test';
import assert from 'node:assert/strict';
import { createCardGame, cardMoves, playCardMove, publicCardGame, type CardState } from '../server/pvp/cards';
import { pvpPayout, validPvpRequest, validPvpStake, type PvpCardGameId } from '../src/shared/pvp';
import { randomUUID } from 'node:crypto';

const card = (rank: number, suit = 0) => suit * 13 + rank - 2;
function position(gameId: PvpCardGameId, a: number[], b: number[], stock: number[] = []): CardState {
  return { ...createCardGame(gameId, () => 0), hands: [a, b], stock, discard: [], table: [],
    actor: 0, attacker: 0, limit: Math.min(6, b.length), suit: 3, trump: card(6, 3), revision: 0 };
}
test('5 percent commission comes from the entire pot, with exact USDT units', () => {
  assert.deepEqual(pvpPayout('50000000'), { potUnits: '100000000', feeUnits: '5000000', payoutUnits: '95000000' });
  assert.deepEqual(pvpPayout('1010000'), { potUnits: '2020000', feeUnits: '101000', payoutUnits: '1919000' });
  for (const bad of ['0', '1', '-1', '1.00', '999999', '1000001', '500010000', 50000000, null]) assert.equal(validPvpStake(bad), false);
  assert(validPvpRequest({ id: randomUUID(), action: 'create', gameId: 'durak', stakeUnits: '50000000', targetId: null }));
  assert(!validPvpRequest({ id: randomUUID(), action: 'create', gameId: 'durak', stakeUnits: '50000000', targetId: null, winnerId: randomUUID() }));
});
test('durak rejects foreign cards, wrong turns, unsuitable defence and forged result fields', () => {
  const s = position('durak', [card(6), card(8)], [card(7), card(9)]);
  const original = structuredClone(s);
  for (const [side, move] of [[1, { kind: 'attack', card: card(7) }], [0, { kind: 'attack', card: card(14) }],
    [0, { kind: 'attack', card: card(6), winner: 0 }]] as const) assert.throws(() => playCardMove(s, side, move));
  assert.deepEqual(s, original);
  const attack = playCardMove(s, 0, { kind: 'attack', card: card(8) });
  assert.throws(() => playCardMove(attack, 1, { kind: 'defend', card: card(7), target: 0 }));
  assert.throws(() => playCardMove(attack, 1, { kind: 'defend', card: card(9), target: 5 }));
  const defended = playCardMove(attack, 1, { kind: 'defend', card: card(9), target: 0 });
  assert.equal(defended.attacker, 1); assert.equal(defended.table.length, 0);
});
test('taking allows legal throw-ins, preserves drawing order and does not skip the attacker', () => {
  let s = position('durak', [card(6), card(6, 1)], [card(8), card(9)], [card(14, 3), card(13, 3), card(12, 3)]);
  s = playCardMove(s, 0, { kind: 'attack', card: card(6) });
  s = playCardMove(s, 1, { kind: 'take' }); assert(s.collecting);
  s = playCardMove(s, 0, { kind: 'attack', card: card(6, 1) });
  assert.equal(s.attacker, 0); assert.equal(s.stock.length, 0);
  assert.deepEqual(s.hands[0], [card(12, 3), card(13, 3), card(14, 3)]);
  assert.deepEqual(s.hands[1], [card(8), card(9), card(6), card(6, 1)]);
});
test('transfer requires matching rank, no defence and enough cards in the next defender hand', () => {
  let s = position('transfer-durak', [card(9), card(12), card(13)], [card(9, 1), card(14), card(7)]);
  s = playCardMove(s, 0, { kind: 'attack', card: card(9) });
  assert(cardMoves(s, 1).some(move => move.kind === 'transfer'));
  s = playCardMove(s, 1, { kind: 'transfer', card: card(9, 1) });
  assert.equal(s.attacker, 1); assert.equal(s.actor, 0); assert.equal(s.table.length, 2);
  let short = position('transfer-durak', [card(9), card(12)], [card(9, 1), card(14)]);
  short = playCardMove(short, 0, { kind: 'attack', card: card(9) });
  assert(!cardMoves(short, 1).some(move => move.kind === 'transfer'));
});
test('the last defended cards can draw; taking the final card loses; no replenishment is invented', () => {
  let draw = position('durak', [card(6)], [card(7)]);
  draw = playCardMove(draw, 0, { kind: 'attack', card: card(6) });
  assert.equal(draw.phase, 'playing');
  draw = playCardMove(draw, 1, { kind: 'defend', card: card(7), target: 0 });
  assert.equal(draw.phase, 'finished'); assert.equal(draw.winner, null);
  let win = position('durak', [card(6)], [card(7)]);
  win = playCardMove(win, 0, { kind: 'attack', card: card(6) });
  win = playCardMove(win, 1, { kind: 'take' });
  assert.equal(win.phase, 'finished'); assert.equal(win.winner, 0);
});
test('eights change suit, regular cards match suit or rank, and a last card wins', () => {
  let s = position('crazy-eights', [card(8), card(7, 1)], [card(10, 2)]);
  s.discard = [card(14)]; s.suit = 0;
  assert.throws(() => playCardMove(s, 0, { kind: 'play', card: card(7, 1) }));
  assert.throws(() => playCardMove(s, 0, { kind: 'play', card: card(8) }));
  s = playCardMove(s, 0, { kind: 'play', card: card(8), suit: 2 });
  assert.equal(s.suit, 2); s = playCardMove(s, 1, { kind: 'play', card: card(10, 2) });
  assert.equal(s.winner, 1); assert.equal(s.phase, 'finished');
});
test('public snapshots contain only the owner hand, counts and legal actions', () => {
  for (const gameId of ['durak', 'transfer-durak', 'crazy-eights'] as const) {
    const s = createCardGame(gameId);
    for (const side of [0, 1]) {
      const view = publicCardGame(s, side);
      assert.deepEqual(view.hand, s.hands[side]);
      assert.equal(view.opponentCount, s.hands[1 - side].length);
      assert(!('hands' in view)); assert(!('stock' in view)); assert(!('discard' in view));
      assert.equal(view.stockCount, s.stock.length);
    }
    assert.throws(() => publicCardGame(s, 2));
  }
});
test('complete random games conserve every card across legal turns and serialization', () => {
  for (const gameId of ['durak', 'transfer-durak', 'crazy-eights'] as const) for (let run = 0; run < 30; run++) {
    let s = createCardGame(gameId), steps = 0;
    const expected = gameId === 'crazy-eights' ? 52 : 36;
    while (s.phase === 'playing' && steps++ < 4000) {
      const all = [...s.hands.flat(), ...s.stock, ...s.discard, ...s.table.flatMap(p => p.defense === undefined ? [p.attack] : [p.attack, p.defense])];
      assert.equal(all.length, expected); assert.equal(new Set(all).size, expected);
      const moves = cardMoves(s, s.actor); assert(moves.length, `${gameId} has a valid next move`);
      // Prefer playing over voluntary draws and finish a collecting attack promptly.
      const preferred = moves.filter(move => move.kind !== 'draw');
      const options = preferred.length ? preferred : moves;
      s = playCardMove(JSON.parse(JSON.stringify(s)), s.actor, options[Math.floor(Math.random() * options.length)]);
    }
    assert.equal(s.phase, 'finished', `${gameId} completed in ${steps} turns`);
    assert.deepEqual(cardMoves(s, 0), []); assert.deepEqual(cardMoves(s, 1), []);
  }
});

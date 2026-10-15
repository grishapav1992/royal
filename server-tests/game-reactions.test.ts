import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GAME_REACTION_EVENT, emitGameReaction, gameReactionForAmounts, observeGameOutcome, resetGameOutcomes, type GameReactionSnapshot } from '../src/ui/gameReactions';

function fixture() {
  const host = new EventTarget() as unknown as HTMLElement;
  const reactions: string[] = [];
  host.addEventListener(GAME_REACTION_EVENT, event => reactions.push((event as CustomEvent).detail.reaction));
  const base: GameReactionSnapshot = { gameId: 'studio-neon-crown', account: 'one', sessionId: '', active: false, busy: false, pending: false, spentUnits: '1000', returnedUnits: '0' };
  return { host, reactions, observe: (value: Partial<GameReactionSnapshot>) => observeGameOutcome(host, { ...base, ...value }) };
}

test('game reactions compare total return with stake, including partial returns and exact large values', () => {
  assert.equal(gameReactionForAmounts('1000', '2000'), 'win');
  assert.equal(gameReactionForAmounts('1000', '500'), 'lose');
  assert.equal(gameReactionForAmounts('1000', '0'), 'lose');
  assert.equal(gameReactionForAmounts('1000', '1000'), undefined);
  assert.equal(gameReactionForAmounts('9007199254740992', '9007199254740993'), 'win');
  assert.equal(gameReactionForAmounts('0', '100'), undefined);
  assert.equal(gameReactionForAmounts('NaN', '100'), undefined);
});

test('emitted reaction bubbles and exposes only the reaction', () => {
  const { host } = fixture();
  let result: Event | undefined;
  host.addEventListener(GAME_REACTION_EVENT, event => { result = event; });
  emitGameReaction(host, 'win');
  assert.equal(result?.bubbles, true);
  assert.deepEqual((result as CustomEvent).detail, { reaction: 'win' });
});

test('opening saved results and refreshing them does not replay emotions', () => {
  const { observe, reactions } = fixture();
  observe({});
  observe({ sessionId: 'saved', returnedUnits: '5000' });
  observe({ sessionId: 'saved', returnedUnits: '5000' });
  observe({ sessionId: 'another-saved', returnedUnits: '0' });
  assert.deepEqual(reactions, []);
});

test('active parties react once after confirmed settlement, with ties staying neutral', () => {
  const { observe, reactions } = fixture();
  observe({ sessionId: 'win', active: true });
  observe({ sessionId: 'win', returnedUnits: '2000' });
  observe({ sessionId: 'win', returnedUnits: '2000' });
  observe({ sessionId: 'tie', active: true });
  observe({ sessionId: 'tie', returnedUnits: '1000' });
  observe({ sessionId: 'loss', active: true });
  observe({ sessionId: 'loss', returnedUnits: '500' });
  assert.deepEqual(reactions, ['win', 'lose']);
});

test('instant rounds wait for pending operations to settle and ignore stale results during a retry', () => {
  const { observe, reactions } = fixture();
  observe({ sessionId: 'old', returnedUnits: '5000' });
  observe({ sessionId: 'old', busy: true, pending: true, returnedUnits: '5000' });
  observe({ sessionId: 'old', pending: true, returnedUnits: '5000' });
  assert.deepEqual(reactions, []);
  observe({ sessionId: 'new', returnedUnits: '0' });
  observe({ sessionId: 'new', returnedUnits: '0' });
  assert.deepEqual(reactions, ['lose']);
});

test('changing account discards pending reaction state', () => {
  const { observe, reactions } = fixture();
  observe({ sessionId: 'old', active: true });
  observe({ sessionId: 'old', busy: true, pending: true });
  observe({ account: 'two', sessionId: 'old', returnedUnits: '5000' });
  assert.deepEqual(reactions, []);
});

test('reopening a shared modal host does not react to a party completed while it was closed', () => {
  const { host, observe, reactions } = fixture();
  observe({ sessionId: 'saved-party', active: true });
  resetGameOutcomes(host);
  observe({ sessionId: 'saved-party', returnedUnits: '5000' });
  assert.deepEqual(reactions, []);
});

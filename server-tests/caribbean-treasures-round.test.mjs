import assert from 'node:assert/strict';
import test from 'node:test';
import { startCaribbean, moveCaribbean } from '../server/games/caribbeanTreasures.ts';
import { validCaribbeanView, validCaribbeanSettlement, caribbeanInitialCost } from '../src/shared/caribbeanTreasures.ts';
const zero = () => 0;
function finish(result, tactic = 'raid', draw = zero) {
  while (!result.ended) result = moveCaribbean(result.view, result.view.revision,
    result.view.phase === 'choice' ? 'choose-' + tactic : 'spin', draw);
  return result;
}
test('natural bonus preserves its accepted cost and credits only the complete round', () => {
  const start = startCaribbean({ lines: 20, mode: 'normal' }, '100', zero);
  assert.equal(start.view.phase, 'choice');
  assert.equal(start.costUnits, '2000');
  assert.equal(start.creditUnits, '0');
  assert.equal(start.view.mapPieces, 3);
  assert.equal(start.view.spins.length, 1);
  assert(validCaribbeanSettlement('active', '2000', '0', start.view));
  const end = finish(start, 'raid');
  assert(end.ended);
  assert.equal(end.view.spins.length, 15);
  assert.equal(end.view.revision, 16);
  assert.equal(end.costUnits, '2000');
  assert.equal(end.creditUnits, end.view.totalPayoutUnits);
  assert(validCaribbeanSettlement('settled', '2000', end.creditUnits, end.view));
});
test('flagship natural continuation lasts six free spins', () => {
  const result = finish(startCaribbean({ lines: 1, mode: 'normal' }, '200', zero), 'flagship');
  assert.equal(result.view.spins.length, 7);
  assert.equal(result.view.tactic, 'flagship');
  assert(validCaribbeanView(result.view));
});
test('purchased modes start directly and share the exact displayed price for a line selection', () => {
  for (const lines of [1,5,10,20]) for (const lineStake of ['100','200','500','1000']) {
    const a = startCaribbean({ lines, mode: 'buy-raid' }, lineStake, () => { throw Error('Buy must not pre-generate spins'); });
    const b = startCaribbean({ lines, mode: 'buy-flagship' }, lineStake, zero);
    assert.equal(a.costUnits, b.costUnits);
    assert.equal(a.costUnits, caribbeanInitialCost({ lines, mode: 'buy-raid' }, lineStake));
    assert.equal(a.view.spins.length, 0);
    assert.equal(a.view.remaining, 14);
    assert.equal(b.view.remaining, 6);
    assert(validCaribbeanView(a.view));
    assert(validCaribbeanView(b.view));
  }
  assert.equal(finish(startCaribbean({ lines: 10, mode: 'buy-raid' }, '100', zero)).view.spins.length, 14);
});
test('selection consumes no entropy and locks the tactic without modifying the input', () => {
  const start = startCaribbean({ lines: 5, mode: 'normal' }, '100', zero), before = JSON.stringify(start.view);
  const next = moveCaribbean(start.view, start.view.revision, 'choose-flagship', () => { throw Error('Choice should not draw'); });
  assert.equal(JSON.stringify(start.view), before);
  assert.equal(next.view.tactic, 'flagship');
  assert.throws(() => moveCaribbean(next.view, next.view.revision, 'choose-raid', zero));
});
test('stale moves and completed rounds cannot continue', () => {
  const start = startCaribbean({ lines: 5, mode: 'normal' }, '100', zero);
  assert.throws(() => moveCaribbean(start.view, 0, 'choose-raid', zero));
  assert.throws(() => moveCaribbean(start.view, 1, 'spin', zero));
  const end = finish(start);
  assert.throws(() => moveCaribbean(end.view, end.view.revision, 'spin', zero));
});
test('JSON save and reopen preserves every legal step', () => {
  let result = startCaribbean({ lines: 10, mode: 'normal' }, '500', zero);
  for (let i = 0; !result.ended; i++) {
    const reopened = JSON.parse(JSON.stringify(result.view));
    assert(validCaribbeanView(reopened));
    result = moveCaribbean(reopened, reopened.revision, reopened.phase === 'choice' ? 'choose-raid' : 'spin', zero);
  }
  assert(validCaribbeanView(result.view));
});
test('forged sums, grids, costs, settings, extra entropy and missing entropy fail replay', () => {
  const view = finish(startCaribbean({ lines: 1, mode: 'normal' }, '100', zero)).view;
  const changes = [
    v => { v.totalPayoutUnits = '999999999'; },
    v => { v.spins[0].frame.grid[0] = 5; },
    v => { v.costUnits = '1'; },
    v => { v.settings.lines = 20; },
    v => { v.lineStakeUnits = '1000'; },
    v => { v.operations[0].draws.push(0); },
    v => { v.operations[0].draws.pop(); },
    v => { v.remaining = 1; },
    v => { v.futureDraws = [1,2]; },
  ];
  for (const change of changes) {
    const bad = structuredClone(view); change(bad);
    assert(!validCaribbeanView(bad));
    assert.throws(() => moveCaribbean(bad, bad.revision, 'spin', zero));
  }
});
test('invalid start parameters and non-integer entropy are rejected', () => {
  for (const settings of [
    { lines: 2, mode: 'normal' }, { lines: 20, mode: 'other' }, { lines: 20, mode: 'normal', hidden: true },
    { lines: 20, mode: { toString() { return 'normal'; } } },
  ]) assert.throws(() => startCaribbean(settings, '100', zero));
  for (const stake of ['0','1','100.0','-100','01'])
    assert.throws(() => startCaribbean({ lines: 1, mode: 'normal' }, stake, zero));
  assert.throws(() => startCaribbean({ lines: 1, mode: 'normal' }, '100', () => NaN));
});
test('no natural entry settles immediately and settlement envelopes cannot change state or money', () => {
  const result = startCaribbean({ lines: 20, mode: 'normal' }, '100', max => max - 1);
  assert(result.ended);
  assert.equal(result.view.phase, 'complete');
  assert(result.view.mapPieces < 3);
  assert(validCaribbeanSettlement('settled', result.costUnits, result.creditUnits, result.view));
  assert(!validCaribbeanSettlement('active', result.costUnits, '0', result.view));
  assert(!validCaribbeanSettlement('settled', '1', result.creditUnits, result.view));
  assert(!validCaribbeanSettlement('settled', result.costUnits, '1', result.view));
});

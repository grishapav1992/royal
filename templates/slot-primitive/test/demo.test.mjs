import assert from 'node:assert/strict';
import test from 'node:test';
import { createDemoServices } from '../dist/demo-services.js';
import { formatCents } from '../dist/index.js';
import { parsePaylineLayout, paylineCells, validPaylineLayout } from '../dist/paylines.js';

test('the standalone demo recovers the same round then submits a legal choice', async () => {
  const demo = createDemoServices();
  assert.equal(demo.stakes.defaultCents, '10');
  assert.equal(formatCents('900719925474099312'), '9007199254740993.12');
  assert.equal(demo.stakes.parse('0,13'), '13');
  await assert.rejects(demo.spin('0.099'));
  assert.equal(demo.read().round, null);

  const statuses = [];
  const unsubscribe = demo.subscribe(() => statuses.push(demo.read().status));
  const started = demo.spin('0.13');
  await assert.rejects(demo.spin('0.13'));
  await started;
  assert.equal(demo.read().status, 'continue');
  const initial = demo.read().round;
  await demo.playFree(initial, 'free-spin');
  assert.equal(demo.read().status, 'recover');
  assert.equal(demo.read().round, initial);
  await assert.rejects(demo.spin('0.10'));
  await demo.recover();
  const restored = demo.read().round;
  assert.equal(restored.id, initial.id);
  assert.equal(restored.revision, initial.revision + 1);
  await assert.rejects(demo.playFree(initial, 'choose', [1]));
  await assert.rejects(demo.playFree(restored, 'choose', [3]));
  await demo.playFree(restored, 'choose', [1]);
  assert.equal(demo.read().round.spentCents, initial.spentCents);
  assert.equal(demo.read().round.returnedCents, '30');
  assert.equal(demo.read().round.state, 'settled');
  assert.deepEqual(statuses, ['busy', 'continue', 'busy', 'recover', 'busy', 'continue', 'busy', 'spin']);
  unsubscribe();
  await demo.refresh();
  assert.equal(statuses.length, 8);
});

test('payline geometry round trips and is read at the next mock spin', async () => {
  const layout = { columns: 5, rows: 3, paylines: [[0, 1, 2, 1, 0]] };
  assert.deepEqual(parsePaylineLayout(JSON.stringify(layout)), layout);
  assert.equal(validPaylineLayout({ ...layout, paylines: [[0, 0]] }), false);
  assert.equal(validPaylineLayout({ ...layout, paylines: [[0, 0, 3, 0, 0]] }), false);
  assert.equal(validPaylineLayout({ ...layout, paylines: [...layout.paylines, ...layout.paylines] }), false);
  assert.equal(validPaylineLayout({ ...layout, paylines: [Array(5)] }), false);
  assert.throws(() => parsePaylineLayout('{"columns":11}'));
  assert.deepEqual(paylineCells(5, layout.paylines[0]), [0, 6, 12, 8, 4]);

  let selected = { ...layout, paylines: [] };
  const demo = createDemoServices('lines', () => selected);
  await demo.spin('0.10');
  assert.deepEqual(demo.read().round.view.highlights, []);
  selected = layout;
  await demo.spin('0.10');
  assert.deepEqual(demo.read().round.view.highlights, [0, 6, 12, 8, 4]);
});

test('the local scenarios supply ways heights, cascade frames and unchanged held symbols', async () => {
  const ways = createDemoServices('ways');
  const cascade = createDemoServices('cascades');
  const hold = createDemoServices('hold');
  for (const demo of [ways, cascade, hold]) await demo.spin('0.10');
  assert.deepEqual(ways.read().round.view.heights, [3, 2, 3]);
  const [before, after] = cascade.read().round.view.stages;
  assert.deepEqual(before.symbolsAfter, after.symbols);
  for (const { from, to, symbol } of before.drops) {
    assert.equal(before.symbols[from], symbol);
    assert.equal(after.symbols[to], symbol);
  }
  const round = hold.read().round;
  await hold.playFree(round, 'respin');
  for (const position of round.view.held) assert.equal(hold.read().round.view.symbols[position], round.view.symbols[position]);
});

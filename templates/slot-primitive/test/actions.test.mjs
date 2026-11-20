import assert from 'node:assert/strict';
import test from 'node:test';
import { createSlotActions } from '../dist/actions.js';
import { createDemoServices } from '../dist/demo-services.js';

test('the facade distinguishes loss, partial return, stake return, win and large win by whole-round cost', async () => {
  for (const [scenario, draft, returned, kind] of [
    ['lines', '0.10', '0', 'loss'],
    ['ways', '0.10', '5', 'partial'],
    ['cascades', '3.00', '300', 'return'],
    ['cascades', '0.16', '300', 'win'],
    ['cascades', '0.15', '300', 'bigwin'],
  ]) {
    const actions = createSlotActions(createDemoServices(scenario), { bigWinMultiplier: 20 });
    const events = [];
    actions.subscribeFeedback(event => events.push(event));
    await actions.bet(draft);
    assert.equal(events.length, 2);
    assert.deepEqual(events.map(event => event.type), ['bet', kind]);
    assert.equal(events[1].round.returnedCents, returned);
    assert.equal(events[0].round, events[1].round);
  }
});

test('the facade does not announce an unconfirmed action, refresh, or recovery', async () => {
  const state = createDemoServices('bonus');
  const actions = createSlotActions(state);
  const events = [];
  actions.subscribeFeedback(event => events.push(event));
  await assert.rejects(actions.bet('0.001'));
  const bet = actions.bet('0.10');
  assert.deepEqual(events, []);
  await assert.rejects(actions.bet('0.10'));
  await bet;
  assert.deepEqual(events.map(event => event.type), ['bet']);
  const first = state.read().round;
  await actions.playFree(first, 'free-spin');
  assert.equal(state.read().status, 'recover');
  await actions.recover();
  await actions.refresh();
  const restored = state.read().round;
  assert.equal(restored.id, first.id);
  assert.deepEqual(events.map(event => event.type), ['bet']);
  await assert.rejects(actions.playFree(first, 'choose', [1]));
  await actions.playFree(restored, 'choose', [1]);
  assert.deepEqual(events.map(event => event.type), ['bet', 'free', 'win']);
  assert.equal(events[1].actionId, 'choose');
  assert.equal(events[2].round.spentCents, '10');
});

test('a failed asynchronous effect does not reject the accepted bet or stop other subscribers', async t => {
  const state = createDemoServices('cascades');
  const actions = createSlotActions(state);
  const failure = Error('Visual assets failed');
  const reported = [];
  t.mock.method(console, 'error', (...args) => { reported.push(args); });
  actions.subscribeFeedback(async event => { if (event.type === 'win') throw failure; });
  const shown = [];
  actions.subscribeFeedback(event => { shown.push(event.type); });
  await actions.bet('0.10');
  assert.deepEqual(shown, ['bet', 'win']);
  assert.equal(state.read().round.state, 'settled');
  assert.deepEqual(reported, [['Slot presentation feedback failed', failure]]);
});

test('an in-flight result is not replayed to a closed or newly subscribed visual', async () => {
  const actions = createSlotActions(createDemoServices('cascades'));
  const events = [];
  const listener = event => events.push(event.type);
  const stop = actions.subscribeFeedback(listener);
  const sent = actions.bet('0.10');
  stop();
  actions.subscribeFeedback(listener);
  await sent;
  assert.deepEqual(events, []);
  await actions.bet('0.10');
  assert.deepEqual(events, ['bet', 'win']);
});

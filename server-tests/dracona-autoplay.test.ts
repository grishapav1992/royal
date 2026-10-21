import test from 'node:test';
import assert from 'node:assert/strict';
import { Autoplay } from '../games/dracona/autoplay';

const deferred = () => {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>(done => { resolve = done; });
  return { promise, resolve };
};

test('a ten-spin series waits for every settlement and finishes exactly ten spins', async () => {
  const calls: ReturnType<typeof deferred>[] = [];
  const auto = new Autoplay(() => {
    const call = deferred(); calls.push(call); return call.promise;
  }, () => {});
  const series = auto.start(10);
  assert.equal(calls.length, 1);
  for (let i = 0; i < 10; i++) {
    assert.equal(calls.length, i + 1);
    assert.equal(auto.state.completed, i);
    calls[i].resolve(true);
    await Promise.resolve();
  }
  await series;
  assert.equal(calls.length, 10);
  assert.deepEqual(auto.state, { active: false, stopping: false, completed: 10, total: 10 });
});

test('stop settles the current spin and never starts another, even after a repeated start', async () => {
  const call = deferred(); let calls = 0;
  const auto = new Autoplay(() => { calls++; return call.promise; }, () => {});
  const series = auto.start(25);
  await auto.start(50);
  auto.stop(); auto.stop();
  assert.equal(auto.state.active, true);
  assert.equal(auto.state.stopping, true);
  assert.equal(calls, 1);
  call.resolve(true);
  await series;
  assert.equal(auto.state.completed, 1);
  assert.equal(auto.state.total, 25);
  assert.equal(auto.state.active, false);
  assert.equal(calls, 1);
});

test('a blocked spin stops the series without counting a spin or retrying', async () => {
  let calls = 0;
  const auto = new Autoplay(async () => ++calls < 3, () => {});
  await auto.start(10);
  assert.equal(calls, 3);
  assert.equal(auto.state.completed, 2);
  assert.equal(auto.state.active, false);
});

test('a bonus or dialog can stop the series from within the completed spin', async () => {
  let calls = 0;
  const auto = new Autoplay(async () => {
    calls++; auto.stop(); return true;
  }, () => {});
  await auto.start(10);
  assert.equal(calls, 1);
  assert.equal(auto.state.completed, 1);
  assert.equal(auto.state.active, false);
});

test('a failed spin releases the series and a new series resets its counter', async () => {
  let fail = true;
  const auto = new Autoplay(async () => { if (fail) throw new Error('Spin failed'); return true; }, () => {});
  await assert.rejects(auto.start(10), /Spin failed/);
  assert.equal(auto.state.active, false);
  assert.equal(auto.state.completed, 0);
  fail = false;
  await auto.start(25);
  assert.equal(auto.state.completed, 25);
  assert.equal(auto.state.total, 25);
});

test('invalid series lengths never start a spin', async () => {
  let calls = 0;
  const auto = new Autoplay(async () => { calls++; return true; }, () => {});
  for (const count of [0, -1, 1.5, NaN, Infinity, 101]) await assert.rejects(auto.start(count), RangeError);
  assert.equal(calls, 0);
  assert.equal(auto.state.active, false);
});

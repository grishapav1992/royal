import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChatQueue } from '../server/chatQueue';

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

test('chat checks preserve account order while other accounts proceed independently', async () => {
  const queue = new ChatQueue(), first = gate(), calls: string[] = [];
  const a = queue.enqueue('a', async () => { calls.push('a1'); await first.promise; });
  const next = queue.enqueue('a', async () => { calls.push('a2'); });
  await queue.enqueue('b', async () => { calls.push('b'); });
  assert.deepEqual(calls, ['a1', 'b']);
  first.release(); await Promise.all([a, next]);
  assert.deepEqual(calls, ['a1', 'b', 'a2']);
});

test('chat queues bound active accounts and waiting messages and release capacity', async () => {
  const queue = new ChatQueue(3, 2), hold = gate();
  const first = queue.enqueue('a', () => hold.promise);
  const second = queue.enqueue('a', async () => {});
  const third = queue.enqueue('a', async () => {});
  const other = queue.enqueue('b', () => hold.promise);
  assert.equal(queue.enqueue('a', async () => assert.fail('overflow ran')), undefined);
  assert.equal(queue.enqueue('c', async () => assert.fail('overflow ran')), undefined);
  hold.release(); await Promise.all([first, second, third, other]);
  assert(queue.enqueue('c', async () => {}));
});

test('a failed moderation task does not stall later messages', async () => {
  const queue = new ChatQueue(), calls: number[] = [];
  const failed = queue.enqueue('a', async () => { throw new Error('provider unavailable'); });
  const next = queue.enqueue('a', async () => { calls.push(2); });
  await assert.rejects(failed!, /provider unavailable/);
  await next;
  assert.deepEqual(calls, [2]);
});

test('cancellation releases queued jobs but keeps an in-flight provider lane reserved', async () => {
  const queue = new ChatQueue(3, 1), hold = gate(), owner = {}, cancelled: number[] = [], calls: number[] = [];
  const first = queue.enqueue('a', async wasCancelled => { calls.push(1); await hold.promise; assert.equal(wasCancelled(), true); }, () => cancelled.push(1), owner)!;
  const second = queue.enqueue('a', async () => { calls.push(2); }, () => cancelled.push(2), owner)!;
  await Promise.resolve(); queue.cancel('a', owner); await second;
  assert.deepEqual(cancelled, [1, 2]); assert.equal(queue.enqueue('b', async () => {}), undefined);
  hold.release(); await first; await new Promise(resolve => setImmediate(resolve));
  assert(queue.enqueue('b', async () => {})); assert.deepEqual(calls, [1]);
});

test('disconnecting one owner does not cancel another room for the same account', async () => {
  const queue = new ChatQueue(), hold = gate(), owner = {}, other = {}, calls: number[] = [];
  const first = queue.enqueue('a', () => hold.promise, undefined, owner)!;
  const cancelled = queue.enqueue('a', async () => { calls.push(2); }, undefined, owner)!;
  const retained = queue.enqueue('a', async () => { calls.push(3); }, undefined, other)!;
  await Promise.resolve(); queue.cancel('a', owner); await cancelled; hold.release(); await Promise.all([first, retained]);
  assert.deepEqual(calls, [3]);
});

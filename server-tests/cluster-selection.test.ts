import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchAvailableProcesses, selectRoomProcess, type RoomProcessStats } from '../server/clusterSelection';
import { READY_PROCESSES_KEY, parseReadyProcess, workerLeaseKey } from '../server/clusterRegistry';

const stat = (processId: string, roomCount = 0): RoomProcessStats => ({ processId, roomCount });
const choose = (selector: ReturnType<typeof selectRoomProcess>) => selector('lobby', {});

test('100 simultaneous creates cannot exceed any process limit with stale stats', async () => {
  const selector = selectRoomProcess(10, async () => ['a', 'b', 'c', 'd'].map(id => stat(id)));
  const results = await Promise.allSettled(Array.from({ length: 100 }, () => choose(selector)));
  const accepted = results.filter(result => result.status === 'fulfilled');
  const counts = new Map<string, number>();
  for (const result of accepted) counts.set(result.value, (counts.get(result.value) ?? 0) + 1);
  assert.deepEqual([...counts], [['a', 10], ['b', 10], ['c', 10], ['d', 10]]);
  for (const result of results) if (result.status === 'rejected') assert.equal(result.reason.code, 503);
  assert.equal(results.filter(result => result.status === 'rejected').length, 60);
});

test('selection uses least room count, rotates ties and excludes unavailable or invalid entries', async () => {
  const selector = selectRoomProcess(10, async () => [stat('full', 10), stat('busy', 8), stat('a', 2), stat('B', 2),
    { ...stat('stopping'), available: false }, stat('negative', -1), stat('nan', NaN), stat('fraction', .5), stat('')]);
  assert.deepEqual(await Promise.all(Array.from({ length: 4 }, () => choose(selector))), ['B', 'a', 'B', 'a']);
});

test('a native room count increase confirms provisional selections exactly once', async () => {
  let count = 0;
  const selector = selectRoomProcess(3, async () => [stat('a', count)]);
  assert.equal(await choose(selector), 'a');
  count = 1;
  assert.equal(await choose(selector), 'a');
  assert.equal(await choose(selector), 'a');
  await assert.rejects(choose(selector), { code: 503 });
  count = 3;
  await assert.rejects(choose(selector), { code: 503 });
  count = 2;
  assert.equal(await choose(selector), 'a');
  await assert.rejects(choose(selector), { code: 503 });
});

test('expired failed creations release provisional slots and keep native rooms counted', async () => {
  let at = 0;
  const selector = selectRoomProcess(2, async () => [stat('a', 1)], () => at);
  assert.equal(await choose(selector), 'a');
  at = 4999; await assert.rejects(choose(selector), { code: 503 });
  at = 5000; assert.equal(await choose(selector), 'a');
  await assert.rejects(choose(selector), { code: 503 });
});

test('removed processes discard their provisional state and empty clusters return busy', async () => {
  let stats = [stat('a')];
  const selector = selectRoomProcess(1, async () => stats);
  assert.equal(await choose(selector), 'a');
  stats = []; await assert.rejects(choose(selector), { code: 503 });
  stats = [stat('a')]; assert.equal(await choose(selector), 'a');
});

test('stats reads and choices are FIFO, and a rejected read does not block later calls', async () => {
  let release!: () => void, calls = 0;
  const held = new Promise<void>(resolve => { release = resolve; });
  const selector = selectRoomProcess(2, async () => {
    if (++calls === 1) { await held; throw new Error('Redis unavailable'); }
    return [stat('a')];
  });
  const first = choose(selector), second = choose(selector);
  const rejection = assert.rejects(first, /Redis unavailable/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  release(); await rejection; assert.equal(await second, 'a');
  assert.equal(await choose(selector), 'a');
  await assert.rejects(choose(selector), { code: 503 });
});

test('slow stats cap the FIFO at 128 selections and successful completion restores capacity', async () => {
  let release!: () => void, calls = 0;
  let held = new Promise<void>(resolve => { release = resolve; });
  const selector = selectRoomProcess(512, async () => { calls++; await held; return [stat('a')]; });
  for (let wave = 0; wave < 2; wave++) {
    if (wave) held = new Promise<void>(resolve => { release = resolve; });
    const accepted = Array.from({ length: 128 }, () => choose(selector));
    await assert.rejects(choose(selector), { code: 503 });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, wave * 128 + 1);
    release();
    assert.deepEqual(await Promise.all(accepted), Array(128).fill('a'));
    assert.equal(calls, (wave + 1) * 128);
  }
  assert.equal(await choose(selector), 'a');
});

test('failed stats release every queued permit and a later stalled burst keeps the same bound', async () => {
  let release!: () => void, calls = 0, failing = true;
  let held = new Promise<void>(resolve => { release = resolve; });
  const selector = selectRoomProcess(512, async () => {
    calls++; await held;
    if (failing) throw new Error('Redis unavailable');
    return [stat('a')];
  });
  const failed = Promise.allSettled(Array.from({ length: 128 }, () => choose(selector)));
  await assert.rejects(choose(selector), { code: 503 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  release();
  for (const result of await failed) {
    assert.equal(result.status, 'rejected');
    if (result.status === 'rejected') assert.equal(result.reason.message, 'Redis unavailable');
  }
  assert.equal(calls, 128);
  failing = false;
  held = new Promise<void>(resolve => { release = resolve; });
  const recovered = Array.from({ length: 128 }, () => choose(selector));
  await assert.rejects(choose(selector), { code: 503 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 129);
  release();
  assert.deepEqual(await Promise.all(recovered), Array(128).fill('a'));
  assert.equal(await choose(selector), 'a');
});

test('invalid process limits fail immediately', () => {
  for (const limit of [0, -1, .5, NaN, Infinity]) assert.throws(() => selectRoomProcess(limit), RangeError);
});

test('native discovery requires stats, a process subscription, readiness and the current worker lease', async () => {
  const ready: Record<string, string> = {
    alive: JSON.stringify({ workerId: 'w1', owner: 'owner-new' }),
    stale: JSON.stringify({ workerId: 'w1', owner: 'owner-old' }),
    expired: JSON.stringify({ workerId: 'w2', owner: 'owner-expired' }),
    absent: JSON.stringify({ workerId: 'w3', owner: 'owner-absent' }),
  };
  const reads: string[] = [];
  const presence = {
    channels: async (pattern?: string) => { assert.equal(pattern, 'p:*'); return ['p:booting', 'p:alive', 'p:stale', 'p:expired']; },
    hgetall: async (key: string) => { assert.equal(key, READY_PROCESSES_KEY); return ready; },
    get: async (key: string) => { reads.push(key); return key === workerLeaseKey('w1') ? 'owner-new' : null; },
  };
  const discovered = await fetchAvailableProcesses(presence, async () => ['booting', ...Object.keys(ready)].map(id => stat(id)));
  assert.deepEqual(discovered.map(process => process.processId), ['alive']);
  assert.deepEqual(reads, [workerLeaseKey('w1'), workerLeaseKey('w2')]);
  delete ready.alive;
  assert.deepEqual(await fetchAvailableProcesses(presence, async () => [stat('alive')]), []);
});

test('malformed readiness entries are bounded and never trigger worker lease reads', async () => {
  const invalid: unknown[] = [undefined, 'invalid JSON', 'null', '[]', '{}', JSON.stringify({ workerId: '../other', owner: 'owner' }),
    JSON.stringify({ workerId: 'w'.repeat(65), owner: 'owner' }), JSON.stringify({ workerId: 'w1', owner: '' }),
    JSON.stringify({ workerId: 'w1', owner: 'x'.repeat(129) }), JSON.stringify({ workerId: 'w1', owner: 'has space' }),
    JSON.stringify({ workerId: 'w1', owner: 'control\n' }), ' '.repeat(513)];
  for (const value of invalid) assert.equal(parseReadyProcess(value), undefined);
  assert.deepEqual(parseReadyProcess(JSON.stringify({ workerId: 'worker-1', owner: 'owner:uuid' })), { workerId: 'worker-1', owner: 'owner:uuid' });
  let reads = 0;
  const presence = {
    channels: async () => ['p:invalid'], hgetall: async () => ({ invalid: JSON.stringify({ workerId: '../other', owner: 'owner' }) }),
    get: async () => { reads++; return 'owner'; },
  };
  assert.deepEqual(await fetchAvailableProcesses(presence, async () => [stat('invalid')]), []);
  assert.equal(reads, 0);
});

test('registry and worker lease read failures propagate without choosing an unverified process', async () => {
  const ready = { alive: JSON.stringify({ workerId: 'w1', owner: 'owner' }) };
  const presence = { channels: async () => ['p:alive'], hgetall: async () => ready, get: async () => 'owner' };
  await assert.rejects(fetchAvailableProcesses({ ...presence, hgetall: async () => { throw new Error('Registry unavailable'); } }, async () => [stat('alive')]), /Registry unavailable/);
  await assert.rejects(fetchAvailableProcesses({ ...presence, get: async () => { throw new Error('Lease unavailable'); } }, async () => [stat('alive')]), /Lease unavailable/);
});

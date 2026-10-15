import test from 'node:test';
import assert from 'node:assert/strict';
import { CodexActivityTracker, RunProgress, initialProgress } from '../lib/progress.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const event = (type, id, itemType = 'command_execution', extra = {}) => ({ type, item: { id, type: itemType, ...extra } });

test('progress tracker deduplicates tool lifecycle updates without exposing tool content or IDs', () => {
  const tracker = new CodexActivityTracker();
  const updates = [
    event('item.started', 'private-token', 'command_execution', { command: 'Bearer private', text: 'sk-secretsecret' }),
    event('item.updated', 'private-token'), event('item.updated', 'private-token'),
    event('item.completed', 'private-token', 'command_execution', { aggregated_output: 'password=private' }),
    event('item.completed', 'private-token'), event('item.completed', 'second-tool', 'mcp_tool_call'),
  ].map(value => tracker.event(value));
  assert.equal(updates.reduce((total, update) => total + update.tool_calls_delta, 0), 2);
  assert.equal(updates.reduce((total, update) => total + update.tool_completed_delta, 0), 2);
  assert.deepEqual(updates[1], { activity_kind: 'tool_running', tool_calls_delta: 0, tool_completed_delta: 0 });
  assert.equal(updates.at(-1).activity_kind, 'tool_completed');
  assert.ok(!/private|password|secret|second-tool/.test(JSON.stringify(updates)));
  assert.equal(tracker.event({ type: 'error', message: 'secret' }), null);
  assert.equal(tracker.event(event('item.updated', 'x', 'untrusted_type')), null);
});

test('progress tracker has bounded item memory and ignores raw heartbeat lookalikes', () => {
  const tracker = new CodexActivityTracker();
  for (let i = 0; i < 10000; i++) tracker.event(event('item.started', String(i)));
  assert.equal(tracker.items.size, 8192);
  assert.deepEqual(tracker.event(event('item.completed', '0')), { activity_kind: 'tool_completed', tool_calls_delta: 0, tool_completed_delta: 1 });
  assert.equal(tracker.event({ type: 'heartbeat', item: { type: 'agent_message', text: 'pretend progress' } }), null);
});

test('phase updates do not invent model activity or consume model time during preparation and fixed checks', async () => {
  let time = Date.parse('2026-10-10T00:00:00.000Z');
  const writes = [];
  const progress = new RunProgress({ role: 'tester', now: () => time, write: async value => writes.push(value) });
  time += 300000; progress.phase('build'); await progress.flush();
  time += 600000; progress.phase('server_tests'); await progress.flush();
  time += 600000; progress.phase('browser_tests'); await progress.flush();
  assert.equal(writes.at(-1).phase, 'browser_tests');
  assert.equal(writes.at(-1).model_started_at, null);
  assert.equal(writes.at(-1).last_activity_at, null);
  progress.activity({ activity_kind: 'tool_running', tool_calls_delta: 1, tool_completed_delta: 0 });
  assert.equal(progress.state.tool_calls, 0);
  time += 600000; progress.phase('model'); await progress.flush();
  assert.equal(writes.at(-1).model_started_at, new Date(time).toISOString());
  assert.equal(writes.at(-1).timeout_ms, 30 * 60000);
  progress.activity({ activity_kind: 'thinking', tool_calls_delta: 0, tool_completed_delta: 0 });
  time += 10000; progress.phase('saving'); await progress.close();
  assert.equal(writes.at(-1).last_activity_at, new Date(time - 10000).toISOString());
  assert.equal(writes.at(-1).phase_started_at, new Date(time).toISOString());
});

test('progress event bursts coalesce into a bounded pending snapshot and flush in order', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const writes = []; let concurrency = 0, maximum = 0;
  let time = Date.parse('2026-10-10T00:00:00.000Z');
  const progress = new RunProgress({ role: 'developer', now: () => time, intervalMs: 2000, write: async value => {
    concurrency++; maximum = Math.max(maximum, concurrency); writes.push(value);
    if (writes.length === 1) await gate;
    concurrency--;
  } });
  progress.phase('model'); const first = progress.flush(); await tick();
  for (let i = 0; i < 1000; i++) {
    time++; progress.activity({ activity_kind: 'tool_running', tool_calls_delta: 1, tool_completed_delta: 0 });
  }
  progress.phase('saving');
  const closing = progress.close(); release(); await Promise.all([first, closing]);
  assert.equal(maximum, 1); assert.equal(writes.length, 2);
  assert.equal(writes[0].phase, 'model'); assert.equal(writes[0].tool_calls, 0);
  assert.equal(writes[1].phase, 'saving'); assert.equal(writes[1].tool_calls, 1000);
  progress.activity({ activity_kind: 'thinking', tool_calls_delta: 0, tool_completed_delta: 0 });
  progress.phase('model'); await tick(); assert.equal(writes.length, 2);
});

test('failed or revoked progress writes stop queued observers and surface failure to the controller', async () => {
  const error = Object.assign(new Error('stale lease'), { code: 'stale_lease' });
  let calls = 0, aborted = 0;
  const progress = new RunProgress({ role: 'developer', write: async () => { calls++; throw error; }, onError: () => { aborted++; } });
  progress.phase('model');
  await assert.rejects(progress.flush(), { code: 'stale_lease' });
  progress.activity({ activity_kind: 'tool_running', tool_calls_delta: 1, tool_completed_delta: 0 });
  await assert.rejects(progress.close(), { code: 'stale_lease' });
  await tick(); assert.equal(calls, 1); assert.equal(aborted, 1);
});

test('scheduled model events respect the write interval and preserve event timestamps', async () => {
  const writes = [];
  const progress = new RunProgress({ role: 'analyst', intervalMs: 50, write: async value => writes.push({ value, at: Date.now() }) });
  progress.phase('model'); await progress.flush();
  progress.activity({ activity_kind: 'thinking', tool_calls_delta: 0, tool_completed_delta: 0 });
  const activityAt = progress.state.last_activity_at;
  for (let i = 0; i < 30; i++) progress.activity({ activity_kind: 'tool_running', tool_calls_delta: 1, tool_completed_delta: 0 });
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(writes.length, 2);
  assert.ok(writes[1].at - writes[0].at >= 45);
  assert.equal(writes[1].value.tool_calls, 30);
  assert.ok(Date.parse(writes[1].value.last_activity_at) >= Date.parse(activityAt));
  await progress.close();
});

test('initial progress only contains public controller metadata', () => {
  const value = initialProgress('developer', '2026-10-10T00:00:00.000Z');
  assert.equal(value.timeout_ms, 45 * 60000); assert.equal(value.activity_kind, null);
  assert.equal(value.model_started_at, null); assert.equal(value.tool_calls, 0);
  assert.equal(value.phase, 'preparing');
});

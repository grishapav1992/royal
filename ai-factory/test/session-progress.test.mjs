import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseSessionProgress, readSessionProgress } from '../lib/session-progress.mjs';

const thread = '12345678-1234-4234-8234-123456789abc';
const start = '2026-10-09T22:07:23.470Z';
const sessionStart = '2026-10-09T22:07:24.468Z';
const options = { threadId: thread, workspace: '/workspaces/12345678-1234-4234-8234-123456789def',
  startedAt: start, model: 'gpt-6.1-sol', effort: 'high', role: 'developer', now: Date.parse('2026-10-09T22:08:00.000Z') };
const header = [{ timestamp: sessionStart, type: 'session_meta', payload: { id: thread, cwd: options.workspace, timestamp: sessionStart } },
  { timestamp: sessionStart, type: 'turn_context', payload: { cwd: options.workspace, model: options.model, effort: options.effort } }];
const item = (type, id, timestamp = '2026-10-09T22:07:30.000Z') => ({ timestamp, type: 'response_item',
  payload: { type, call_id: id, arguments: 'Bearer secret', output: 'password=secret', text: 'private reasoning' } });
const lines = events => events.map(event => JSON.stringify(event)).join('\n') + '\n';

test('native session activity preserves event timestamps, deduplicates tools, and omits all raw content and IDs', () => {
  const source = lines([...header, item('function_call', 'private-id'), item('function_call', 'private-id'),
    item('function_call_output', 'private-id'), item('function_call_output', 'private-id'),
    item('custom_tool_call', 'second-id'), item('custom_tool_call_output', 'second-id'),
    item('function_call_output', 'orphan-id'), { timestamp: '2026-10-09T22:07:40.000Z', type: 'response_item', payload: { type: 'reasoning', text: 'private reasoning' } }]);
  const result = parseSessionProgress(source, options);
  assert.deepEqual(result, { model_started_at: sessionStart, last_activity_at: '2026-10-09T22:07:40.000Z',
    activity_kind: 'thinking', tool_calls: 2, tool_completed: 2 });
  assert.ok(!/private|Bearer|password|secret|id/.test(JSON.stringify(result)));
  const later = parseSessionProgress(source, { ...options, now: options.now + 120000 });
  assert.deepEqual(later, result);
  assert.equal(options.now + 120000 - Date.parse(later.last_activity_at), 140000);
});

test('native session rejects another thread, workspace, model, effort, start, or duplicate metadata', () => {
  for (const change of [
    events => { events[0].payload.id = '12345678-1234-4234-8234-123456789def'; },
    events => { events[0].payload.cwd = '/workspaces/other'; },
    events => { events[1].payload.cwd = '/workspaces/other'; },
    events => { events[1].payload.model = 'different-model'; },
    events => { events[1].payload.effort = 'low'; },
    events => { events[0].payload.timestamp = '2026-10-09T22:06:00.000Z'; },
    events => { events.push(events[0]); },
  ]) {
    const events = structuredClone(header); change(events);
    assert.throws(() => parseSessionProgress(lines(events), options), /could not be verified/);
  }
});

test('future and pre-start native events cannot invent progress or tool counts', () => {
  const result = parseSessionProgress(lines([...header,
    item('function_call', 'before', '2026-10-09T22:07:23.000Z'),
    item('function_call', 'future', '2026-10-09T22:08:01.000Z'),
    { timestamp: options.startedAt, type: 'event_msg', payload: { type: 'heartbeat' } }]), options);
  assert.equal(result.last_activity_at, null); assert.equal(result.activity_kind, null);
  assert.equal(result.tool_calls, 0); assert.equal(result.tool_completed, 0);
});

test('trusted role preparation permits tester checks without accepting arbitrary delays, past sessions, or future headers', () => {
  const delayed = structuredClone(header);
  delayed[0].payload.timestamp = '2026-10-09T22:27:23.470Z';
  delayed[0].timestamp = delayed[0].payload.timestamp;
  delayed[1].timestamp = delayed[0].timestamp;
  const tester = { ...options, role: 'tester', now: Date.parse('2026-10-09T22:28:00.000Z') };
  assert.equal(parseSessionProgress(lines(delayed), tester).model_started_at, delayed[0].timestamp);
  assert.throws(() => parseSessionProgress(lines(delayed), { ...tester, role: 'developer' }));
  assert.throws(() => parseSessionProgress(lines(delayed), { ...tester, role: 'analyst' }));
  assert.throws(() => parseSessionProgress(lines(header), { ...options, role: 'caller-role' }));
  for (const time of ['2026-10-09T22:07:23.469Z', '2026-10-09T22:28:01.000Z', '2026-10-09T22:27:54.000Z']) {
    const changed = structuredClone(delayed); changed[0].payload.timestamp = time;
    assert.throws(() => parseSessionProgress(lines(changed), tester));
  }
});

test('native session file reader rejects symlinks, duplicate matches, and aliased directories', async t => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'royal-progress-session-')));
  t.after(() => rm(home, { recursive: true, force: true }));
  const directory = join(home, 'sessions', '2026', '10', '09');
  await mkdir(directory, { recursive: true });
  const filename = `rollout-2026-10-09T22-07-24-${thread}.jsonl`;
  const file = join(directory, filename);
  await writeFile(file, lines([...header, item('function_call', 'tool')]));
  assert.equal((await readSessionProgress({ ...options, codexHome: home })).tool_calls, 1);
  const second = join(directory, `rollout-other-${thread}.jsonl`);
  await writeFile(second, lines(header));
  await assert.rejects(readSessionProgress({ ...options, codexHome: home }), /could not be verified/);
  await rm(second); await rm(file);
  const target = join(home, 'target.jsonl'); await writeFile(target, lines(header));
  await symlink(target, file);
  await assert.rejects(readSessionProgress({ ...options, codexHome: home }));
  await rm(file); await rm(directory, { recursive: true });
  const targetDirectory = join(home, 'other'); await mkdir(targetDirectory);
  await symlink(targetDirectory, directory);
  await assert.rejects(readSessionProgress({ ...options, codexHome: home }), /could not be verified/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { observeCodexSession } from '../lib/codex-session.mjs';

const threadId = '11111111-1111-1111-1111-111111111111';
async function fixture(t, payload) {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'royal-session-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const startedAt = Date.UTC(2026, 9, 10);
  const date = join(directory, 'sessions/2026/10/10'); await mkdir(date, { recursive: true });
  const path = join(date, `rollout-2026-10-10T00-00-00-${threadId}.jsonl`);
  await writeFile(path, [
    { type: 'session_meta', payload: { id: threadId } },
    { type: 'response_item', payload: { private: 'secret-conversation-content' } },
    { type: 'turn_context', payload: { cwd: '/workspaces/test', model: 'gpt-6.1-sol', ...payload } },
  ].map(value => JSON.stringify(value)).join('\n') + '\n');
  return { path, directory, options: { codexHome: directory, threadId, workspace: '/workspaces/test', startedAt } };
}

test('observes model and nested effort without returning conversation content', async t => {
  const { options } = await fixture(t, { collaboration_mode: { settings: { reasoning_effort: 'high', developer_instructions: 'secret' } } });
  assert.deepEqual(await observeCodexSession(options), { actual_model: 'gpt-6.1-sol', actual_effort: 'high', observation_status: 'observed' });
});

test('keeps missing actual effort unknown, independent of requested defaults', async t => {
  const { options } = await fixture(t, {});
  assert.equal((await observeCodexSession(options)).actual_effort, null);
  assert.equal((await observeCodexSession({ ...options, threadId: 'invalid' })).observation_status, 'unavailable');
});

test('rejects a different workspace, unsafe model identifier and session identity', async t => {
  for (const payload of [{ cwd: '/workspaces/sibling' }, { model: 'secret\nunsafe' }]) {
    const { options } = await fixture(t, payload);
    assert.equal((await observeCodexSession(options)).observation_status, 'unavailable');
  }
  const { options, path } = await fixture(t, {});
  await writeFile(path, JSON.stringify({ type: 'turn_context', payload: { cwd: options.workspace, model: 'gpt-6.1-sol' } }) + '\n');
  assert.equal((await observeCodexSession(options)).observation_status, 'unavailable');
});

test('does not follow session file symlinks', async t => {
  const { options, path, directory } = await fixture(t, {});
  const outside = join(directory, 'outside.jsonl');
  await writeFile(outside, await readFile(path));
  await rm(path); await symlink(outside, path);
  assert.equal((await observeCodexSession(options)).observation_status, 'unavailable');
});

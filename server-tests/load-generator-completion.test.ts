import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { boundedCompletionRead, createGeneratorCompletionHold, generatorCompletionExitCode, generatorCompletionOptions } from '../scripts/load-generator-completion.ts';

const runId = '00000000-0000-4000-8000-000000000001', bundleSha256 = '0'.repeat(64);
const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));
test('bounded file reads tolerate short OS reads and reject growth beyond the limit', async () => {
  const source = Buffer.from('complete-report');
  const reader = (data: Buffer) => async (buffer: Buffer, offset: number, length: number, position: number) => {
    const bytesRead = Math.min(3, length, data.length - position);
    if (bytesRead > 0) data.copy(buffer, offset, position, position + bytesRead);
    return { bytesRead };
  };
  assert.deepEqual(await boundedCompletionRead(source.length, reader(source)), source);
  await assert.rejects(boundedCompletionRead(source.length - 1, reader(source)), /refused/);
});
async function fixture(t: TestContext, partial = false) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'royal-generator-hold-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const marker = join(directory, 'generator-completion.json'), manifest = join(directory, 'stand.json'), report = join(directory, 'generators.json');
  const hold = await createGeneratorCompletionHold(marker, manifest, { pollMs: 2, timeoutMs: 75 }); t.after(hold.close);
  const manifestBytes = JSON.stringify({ protocol: 1, role: 'isolated-test-stand', runId, bundleSha256, clients: 4, seconds: 5,
    secret: 'private-synthetic-secret', tokens: ['private-synthetic-token'] });
  if (partial) {
    await writeFile(manifest, '', { mode: 0o600 }); await sleep(10);
    await writeFile(manifest, manifestBytes.slice(0, 32), { mode: 0o600 }); await sleep(10);
  }
  await writeFile(manifest, manifestBytes, { mode: 0o600 });
  await sleep(20); await rm(manifest);
  const finish = async (generatorExitCode = 0, change = {}) => {
    const bytes = Buffer.from(JSON.stringify({ generatorOnly: true, productionTraffic: false, runId, bundleSha256,
      targetClients: 4, seconds: 5, ok: generatorExitCode === 0, cleanup: { passed: true, failures: [] } }));
    await writeFile(report, bytes, { mode: 0o600 });
    await writeFile(marker, JSON.stringify({ protocol: 1, purpose: 'isolated-generator-completion', runId, bundleSha256,
      generatorExitCode, reportSha256: createHash('sha256').update(bytes).digest('hex'), reportBytes: bytes.length, ...change }), { mode: 0o600 });
  };
  return { directory, marker, manifest, report, hold, finish };
}

test('opt-in flags are consumed without changing any cluster arguments', () => {
  const args = ['--clients', '600', '--stand-manifest', '/app/run/stand.json', '--generator-completion-file', '/app/run/generator-completion.json', '--seconds', '30'];
  assert.deepEqual(generatorCompletionOptions(args).args, ['--clients', '600', '--stand-manifest', '/app/run/stand.json', '--seconds', '30']);
  assert.deepEqual(generatorCompletionOptions(['--clients', '600']), { args: ['--clients', '600'] });
  for (const invalid of [args.concat('--generator-completion-file', '/app/run/generator-completion.json'),
    ['--generator-completion-file', '/app/run/generator-completion.json'],
    ['--stand-manifest', '/app/run/stand.json', '--generator-completion-file', '/other/generator-completion.json']]) {
    assert.throws(() => generatorCompletionOptions(invalid), /refused/);
  }
});

test('completion waits for external exec exit marker after stand manifest was removed', async t => {
  const value = await fixture(t); let settled = false;
  const waiting = value.hold.wait().then(result => { settled = true; return result; });
  await sleep(15); assert.equal(settled, false);
  await value.finish(); assert.deepEqual(await waiting, { generatorExitCode: 0 });
});

test('manifest creation may be empty or partial before its final publication', async t => {
  const value = await fixture(t, true); await value.finish();
  assert.deepEqual(await value.hold.wait(), { generatorExitCode: 0 });
});

test('incomplete manifest retries are bounded and bad owner policy does not become retryable', async t => {
  for (const wrongMode of [false, true]) {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'royal-generator-hold-partial-')));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const marker = join(directory, 'generator-completion.json'), manifest = join(directory, 'stand.json');
    const hold = await createGeneratorCompletionHold(marker, manifest, { pollMs: 2, timeoutMs: 25, manifestPartialTimeoutMs: 10 }); t.after(hold.close);
    await writeFile(manifest, '{', { mode: wrongMode ? 0o644 : 0o600 }); await sleep(30);
    await writeFile(manifest, JSON.stringify({ protocol: 1, role: 'isolated-test-stand', runId, bundleSha256, clients: 4, seconds: 5 }), { mode: 0o600 });
    if (wrongMode) await chmod(manifest, 0o600);
    await assert.rejects(hold.wait(), /refused/);
  }
});

test('valid failed workload report preserves the server failure without pretending success', async t => {
  const value = await fixture(t); await value.finish(1);
  assert.deepEqual(await value.hold.wait(), { generatorExitCode: 1 });
  assert.equal(generatorCompletionExitCode(1, 1), 1);
  assert.equal(generatorCompletionExitCode(7, 0), 7);
  assert.equal(generatorCompletionExitCode(0, 137), 137);
  assert.equal(generatorCompletionExitCode(0, 0), 0);
});

test('missing marker is bounded and interruption cancels the hold', async t => {
  const value = await fixture(t), started = performance.now();
  await assert.rejects(value.hold.wait(), /refused/);
  assert.ok(performance.now() - started < 1000);
  await assert.rejects(value.hold.wait(() => true), /refused/);
});

test('wrong UUID, report digest and unknown marker fields fail closed', async t => {
  for (const change of [{ runId: '00000000-0000-4000-8000-000000000002' }, { reportSha256: '1'.repeat(64) }, { extra: true }]) {
    const value = await fixture(t); await value.finish(0, change);
    await assert.rejects(value.hold.wait(), /refused/);
  }
});

test('report must be private and complete, never a snapshot or symlink', async t => {
  const value = await fixture(t); await value.finish();
  await chmod(value.report, 0o644); await assert.rejects(value.hold.wait(), /refused/);
  await chmod(value.report, 0o600);
  const bytes = await readFile(value.report); await rm(value.report); await writeFile(join(value.directory, 'actual.json'), bytes, { mode: 0o600 });
  await symlink(join(value.directory, 'actual.json'), value.report); await assert.rejects(value.hold.wait(), /refused/);
});

test('stale marker or manifest and nonprivate run directories are refused at startup', async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'royal-generator-hold-stale-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const marker = join(directory, 'generator-completion.json'), manifest = join(directory, 'stand.json');
  await writeFile(marker, '{}', { mode: 0o600 });
  await assert.rejects(createGeneratorCompletionHold(marker, manifest), /refused/);
  await rm(marker); await writeFile(manifest, '{}', { mode: 0o600 });
  await assert.rejects(createGeneratorCompletionHold(marker, manifest), /refused/);
  await rm(manifest); await chmod(directory, 0o755);
  await assert.rejects(createGeneratorCompletionHold(marker, manifest), /refused/);
});

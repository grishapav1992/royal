import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { MAX_SHARED_REQUEST, MAX_SHARED_RESPONSE, SHARED_BRAIN_COMMAND, parseSharedCommand,
  requestSharedBrain, formatSharedResponse } from '../scripts/shared-brain-client.mjs';
import { runGraphCommand } from '../scripts/graphify.mjs';

const commit = 'c'.repeat(40);
function response(changes = {}) {
  return { schemaVersion: 1, ok: true, provenance: { scope: 'production', snapshotId: 'a'.repeat(64),
    runtimeFingerprint: 'b'.repeat(64), releaseId: 'verified-release', verifiedAt: '2026-11-03T00:00:00.000Z',
    components: [{ scope: 'host', commit: 'd'.repeat(40) }] }, result: { text: 'Production answer' }, warnings: [], ...changes };
}
function fakeSsh(callback) {
  const calls = [];
  const spawnImpl = (...args) => {
    const child = new EventEmitter();
    Object.assign(child, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
      killed: false, kill() { this.killed = true; } });
    const input = [];
    child.stdin.on('data', chunk => input.push(chunk));
    const call = { args, child, input: () => Buffer.concat(input).toString('utf8') };
    calls.push(call);
    child.stdin.on('finish', () => setImmediate(() => callback(call)));
    return child;
  };
  return { calls, spawnImpl };
}
const reply = (call, envelope = response(), code = 0) => {
  call.child.stdout.end(JSON.stringify(envelope) + '\n'); call.child.emit('close', code);
};

test('supported commands map to typed protocol fields without raw arguments', () => {
  assert.deepEqual(parseSharedCommand('status', [], commit), { schemaVersion: 1, operation: 'status', clientCommit: commit });
  assert.deepEqual(parseSharedCommand('brain', ['wallet', 'recovery']), { schemaVersion: 1, operation: 'brain', question: 'wallet recovery' });
  assert.deepEqual(parseSharedCommand('query', ['wallet', '--budget=2000']), { schemaVersion: 1, operation: 'query', budget: 2000, question: 'wallet' });
  assert.deepEqual(parseSharedCommand('explain', ['src/wallet.ts']), { schemaVersion: 1, operation: 'explain', subject: 'src/wallet.ts' });
  assert.deepEqual(parseSharedCommand('path', ['Wallet', 'API', '--undirected']), { schemaVersion: 1, operation: 'path', directed: false, source: 'Wallet', target: 'API' });
  assert.deepEqual(parseSharedCommand('affected', ['Wallet', '--depth', '5', '--relation', 'calls', '--relation=imports']),
    { schemaVersion: 1, operation: 'affected', depth: 5, relations: ['calls', 'imports'], subject: 'Wallet' });
  assert.deepEqual(parseSharedCommand('god-nodes', ['--top', '50']), { schemaVersion: 1, operation: 'god-nodes', top: 50 });
});

test('unsupported flags, ambiguity, unsafe keys and out-of-range limits are rejected', () => {
  for (const [command, args] of [
    ['publish', []], ['build', []], ['status', ['extra']], ['brain', []], ['query', ['--graph', '/tmp/map']],
    ['query', ['wallet', '--seed', '1']], ['explain', ['wallet', '--all']], ['brain', ['--budget', '1000', 'wallet']],
    ['query', ['wallet', '--budget', '127']], ['query', ['wallet', '--budget=4001']],
    ['query', ['wallet', '--budget', '200', '--budget', '300']], ['query', ['--', '-wallet']],
    ['explain', [' -Wallet']], ['path', ['Wallet', '-API']], ['path', ['Wallet', 'API', '--directed', '--undirected']],
    ['path', ['Wallet', 'API', '--directed=true']], ['affected', ['Wallet', '--depth', '6']],
    ['affected', ['Wallet', '--relation', '--graph']], ['affected', ['Wallet', '--relation', 'bad/relation']],
    ['god-nodes', ['--top', '0']], ['query', ['я'.repeat(1025)]], ['query', ['wallet\n--graph']],
  ]) assert.throws(() => parseSharedCommand(command, args), { code: 'invalid_request' }, command + ' ' + args.join(' '));
  assert.throws(() => parseSharedCommand('status', [], 'not-a-commit'), { code: 'invalid_request' });
  assert.throws(() => parseSharedCommand('affected', ['Wallet', ...Array.from({ length: 11 }, () => ['--relation', 'calls']).flat()]), { code: 'invalid_request' });
});

test('SSH uses a fixed reader, strict host verification and JSON stdin with no provider secrets', async () => {
  const question = 'wallet; $(touch /tmp/not-executed) `id`';
  const transport = fakeSsh(call => reply(call));
  const result = await requestSharedBrain(parseSharedCommand('query', [question], commit), {
    spawnImpl: transport.spawnImpl,
    env: { PATH: '/usr/bin', HOME: '/home/test', SSH_AUTH_SOCK: '/tmp/agent', ROYAL_BRAIN_SSH_TARGET: 'reader@production.test',
      ROYAL_BRAIN_SSH_KEY: '/home/test/key with spaces', A6API_KEY: 'private-provider-value', DATABASE_URL: 'private-database-value' },
  });
  const call = transport.calls[0], [executable, args, options] = call.args;
  assert.equal(executable, 'ssh');
  assert.deepEqual(args, ['-T', '-i', '/home/test/key with spaces', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
    '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=2', 'reader@production.test', SHARED_BRAIN_COMMAND]);
  assert.equal(options.shell, undefined);
  assert.deepEqual(options.stdio, ['pipe', 'pipe', 'pipe']);
  assert.equal(options.windowsHide, true);
  assert.equal(options.env.SSH_AUTH_SOCK, '/tmp/agent');
  assert.equal(options.env.A6API_KEY, undefined);
  assert.equal(options.env.DATABASE_URL, undefined);
  assert.equal(options.env.ROYAL_BRAIN_SSH_KEY, undefined);
  assert.deepEqual(JSON.parse(call.input()), { schemaVersion: 1, operation: 'query', question, clientCommit: commit });
  assert.ok(Buffer.byteLength(call.input()) < MAX_SHARED_REQUEST);
  assert.equal(args.some(value => value.includes(question)), false);
  assert.equal(result.exitCode, 0);
  assert.equal(result.envelope.provenance.releaseId, 'verified-release');
});

test('SSH defaults are portable and invalid connection overrides fail before spawning', async () => {
  const transport = fakeSsh(call => reply(call));
  await requestSharedBrain(parseSharedCommand('status', []), { spawnImpl: transport.spawnImpl, env: {} });
  assert.equal(transport.calls[0].args[1][2], join(homedir(), '.ssh', 'royal_server_ed25519'));
  assert.equal(transport.calls[0].args[1].at(-2), 'root@45.192.12.242');
  for (const env of [{ ROYAL_BRAIN_SSH_TARGET: '-oProxyCommand=unsafe' }, { ROYAL_BRAIN_SSH_TARGET: 'host;id' }, { ROYAL_BRAIN_SSH_KEY: 'key\nunsafe' }]) {
    await assert.rejects(requestSharedBrain(parseSharedCommand('status', []), { spawnImpl: () => assert.fail('must not spawn'), env }), { code: 'invalid_request' });
  }
});

test('ambiguous and not-found results preserve the server exit codes', async () => {
  for (const [code, name] of [[3, 'ambiguous'], [4, 'not_found']]) {
    const transport = fakeSsh(call => reply(call, response({ ok: false, error: { code: name, message: 'Choose a precise key.' } }), code));
    const result = await requestSharedBrain(parseSharedCommand('explain', ['Wallet']), { spawnImpl: transport.spawnImpl, env: {} });
    assert.equal(result.exitCode, code);
    assert.equal(result.envelope.error.code, name);
  }
});

test('network failures, timeout and oversized responses have safe bounded errors', async () => {
  const network = fakeSsh(call => { call.child.stderr.end('PRIVATE-SECRET host details'); call.child.emit('close', 255); });
  await assert.rejects(requestSharedBrain(parseSharedCommand('status', []), { spawnImpl: network.spawnImpl, env: {} }), error => {
    assert.equal(error.code, 'shared_graph_unavailable'); assert.doesNotMatch(error.message, /PRIVATE-SECRET/); return true;
  });
  const spawnError = fakeSsh(call => call.child.emit('error', Error('PRIVATE-SECRET')));
  await assert.rejects(requestSharedBrain(parseSharedCommand('status', []), { spawnImpl: spawnError.spawnImpl, env: {} }), { code: 'shared_graph_unavailable' });
  const oversized = fakeSsh(call => call.child.stdout.write(Buffer.alloc(MAX_SHARED_RESPONSE + 1)));
  await assert.rejects(requestSharedBrain(parseSharedCommand('status', []), { spawnImpl: oversized.spawnImpl, env: {} }), { code: 'response_too_large' });
  assert.equal(oversized.calls[0].child.killed, true);
  const slow = fakeSsh(() => {});
  const keepAlive = setTimeout(() => {}, 100);
  try {
    await assert.rejects(requestSharedBrain(parseSharedCommand('status', []), { spawnImpl: slow.spawnImpl, env: {}, timeoutMs: 5 }), { code: 'shared_graph_timeout' });
    assert.equal(slow.calls[0].child.killed, true);
  } finally { clearTimeout(keepAlive); }
});

test('malformed responses and missing production provenance fail closed', async () => {
  for (const value of ['not json', Buffer.from([0xff]), JSON.stringify(response({ schemaVersion: 2 })),
    JSON.stringify(response({ provenance: null })), JSON.stringify(response({ warnings: ['warning'] })),
    JSON.stringify(response({ provenance: { ...response().provenance, runtimeFingerprint: 'bad' } }))]) {
    const transport = fakeSsh(call => { call.child.stdout.end(value); call.child.emit('close', 0); });
    await assert.rejects(requestSharedBrain(parseSharedCommand('query', ['wallet']), { spawnImpl: transport.spawnImpl, env: {} }), { code: 'invalid_response' });
  }
  const missing = response({ provenance: null, result: { state: 'missing', text: 'No shared graph yet.' } });
  const transport = fakeSsh(call => reply(call, missing));
  assert.equal((await requestSharedBrain(parseSharedCommand('status', []), { spawnImpl: transport.spawnImpl, env: {} })).envelope.result.state, 'missing');
});

test('requests cannot carry arbitrary arguments or invalid fields into transport', async () => {
  for (const request of [{ schemaVersion: 1, operation: 'query', question: 'wallet', args: ['--graph', '/private'] },
    { schemaVersion: 1, operation: 'status', output: '/private' }, { schemaVersion: 1, operation: 'status', clientCommit: 123 },
    { schemaVersion: 1, operation: 'query', question: 'x'.repeat(MAX_SHARED_REQUEST) }]) {
    await assert.rejects(requestSharedBrain(request, { spawnImpl: () => assert.fail('must not spawn') }), { code: 'invalid_request' });
  }
});

test('default reads use only the shared graph and identify deployed release versus PC HEAD', async () => {
  const requests = [], output = [];
  const options = { directory: '/working-copy', readCommit: async () => commit, write: value => output.push(value),
    remoteRequest: async request => { requests.push(request); return { envelope: response(), exitCode: 0 }; },
    localBuild: () => assert.fail('unexpected local build'), localStatus: () => assert.fail('unexpected local status'),
    localGraphify: () => assert.fail('unexpected local query') };
  assert.equal(await runGraphCommand([], options), 0);
  assert.equal(await runGraphCommand(['query', 'wallet', '--budget', '1000'], options), 0);
  assert.equal(requests[0].operation, 'status');
  assert.deepEqual(requests[1], { schemaVersion: 1, operation: 'query', budget: 1000, question: 'wallet', clientCommit: commit });
  assert.match(output[1], /выпуск verified-release/);
  assert.match(output[1], new RegExp('Рабочий коммит этого ПК: ' + commit));
  assert.match(output[1], /Production answer/);
  assert.equal(formatSharedResponse(response({ warnings: [{ code: 'local_checkout_differs_from_production' }] }), commit).includes('local_checkout_differs_from_production'), true);
});

test('shared graph failures never trigger a local build or fallback', async () => {
  let localCalls = 0;
  await assert.rejects(runGraphCommand(['brain', 'wallet'], { readCommit: async () => commit,
    remoteRequest: async () => { throw Error('Network unavailable'); }, localBuild: () => { localCalls++; },
    localStatus: () => { localCalls++; }, localGraphify: () => { localCalls++; } }), /Network unavailable/);
  assert.equal(localCalls, 0);
  const output = [];
  assert.equal(await runGraphCommand(['status'], { readCommit: async () => { throw Error('No Git'); }, write: value => output.push(value),
    remoteRequest: async request => { assert.equal(request.clientCommit, undefined); return { envelope: response(), exitCode: 0 }; } }), 0);
  assert.match(output[0], /verified-release/);
});

test('explicit local mode preserves local status, build and queries without a server request', async () => {
  const calls = [], output = [];
  const options = { directory: '/working-copy', remoteRequest: () => assert.fail('unexpected server request'),
    localStatus: async directory => { calls.push(['status', directory]); return { state: 'current' }; },
    localBuild: async directory => { calls.push(['build', directory]); },
    localGraphify: async (directory, args) => { calls.push(['query', directory, args]); return 4; }, write: value => output.push(value) };
  assert.equal(await runGraphCommand(['status', '--local'], options), 0);
  assert.equal(JSON.parse(output[0]).scope, 'local-working-copy');
  assert.equal(await runGraphCommand(['--local', 'build'], options), 0);
  assert.equal(await runGraphCommand(['query', 'Wallet', '--local'], options), 4);
  assert.deepEqual(calls.slice(0, 2), [['status', '/working-copy'], ['build', '/working-copy']]);
  assert.equal(calls.at(-1)[2].at(-2), '--graph');
  assert.equal(calls.at(-1)[2].at(-1), '/working-copy/graphify-out/graph.json');
  await assert.rejects(runGraphCommand(['build'], options), /build --local/);
  await assert.rejects(runGraphCommand(['status', '--local', '--local'], options), /only once/);
  await assert.rejects(runGraphCommand(['query', '--local', 'Wallet', '--graph', '/private'], options), /Use build/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { readCodexUsage } from '../lib/codex-limits.mjs';

const limitsResult = () => ({ rateLimits: { limitId: 'codex', planType: 'pro',
  primary: { usedPercent: 23, windowDurationMins: 300, resetsAt: 1_800_000_000 },
  secondary: { usedPercent: 51, windowDurationMins: 10080, resetsAt: null } } });

function fakeServer({ responses = {}, onMessage, start, ignoreTerm = false } = {}) {
  const calls = [];
  const spawn = (binary, args, options) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const call = { binary, args, options, messages: [], kills: [], child };
    calls.push(call);
    let closed = false;
    const close = () => {
      if (!closed) { closed = true; child.stdout.end(); child.stderr.end(); child.emit('close', 0); }
    };
    child.kill = signal => {
      call.kills.push(signal);
      if (signal === 'SIGKILL' || !ignoreTerm) setImmediate(close);
      return true;
    };
    let buffer = '';
    child.stdin.on('data', chunk => {
      buffer += chunk.toString();
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const request = JSON.parse(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        call.messages.push(request);
        onMessage?.(request, call, close);
        if (!Object.hasOwn(request, 'id')) continue;
        const value = Object.hasOwn(responses, request.method) ? responses[request.method]
          : request.method === 'initialize' ? { result: {} }
          : request.method === 'account/rateLimits/read' ? { result: limitsResult() }
          : { error: { code: -32601, message: 'Unsupported method' } };
        if (value !== null) child.stdout.write(`${JSON.stringify({ id: request.id, ...value })}\n`);
      }
    });
    setImmediate(() => start?.(call, close));
    return child;
  };
  return { spawn, calls };
}

test('reads subscription windows through a strictly read-only handshake and sanitizes the subprocess environment', async () => {
  const fake = fakeServer();
  const result = await readCodexUsage({ spawn: fake.spawn, env: { HOME: '/safe/home', PATH: '/safe/bin',
    CODEX_HOME: '/safe/auth', OPENAI_API_KEY: 'sk-private-api-secret', CODEX_SALE_API_KEY: 'private-sale-key',
    HTTP_PROXY: 'https://credential@example.test', TERM: 'xterm\ninvalid' } });
  assert.equal(result.status, 'ready');
  assert.equal(result.error, null);
  assert.deepEqual(result.limits, [{ id: 'codex', name: 'codex', plan_type: 'pro', windows: [
    { kind: 'primary', used_percent: 23, remaining_percent: 77, window_minutes: 300, resets_at: '2027-01-15T08:00:00.000Z' },
    { kind: 'secondary', used_percent: 51, remaining_percent: 49, window_minutes: 10080, resets_at: null },
  ] }]);
  assert.equal(result.account_usage, null);
  assert.ok(Number.isFinite(Date.parse(result.checked_at)));
  const call = fake.calls[0];
  assert.deepEqual(call.messages.map(message => message.method), ['initialize', 'initialized', 'account/rateLimits/read', 'account/usage/read']);
  assert.equal(call.messages[2].params.excludeResetCreditDetails, true);
  assert.equal(call.messages[2].params.supportsLunaReserve, false);
  assert.equal(call.options.shell, false);
  assert.equal(call.options.detached, process.platform !== 'win32');
  assert.deepEqual(call.options.env, { HOME: '/safe/home', PATH: '/safe/bin', CODEX_HOME: '/safe/auth' });
  assert.ok(call.args.includes('forced_login_method="chatgpt"'));
  assert.ok(call.args.includes('model_provider="openai"'));
  assert.ok(call.kills.includes('SIGTERM'));
});

test('prefers all metered buckets and does not duplicate the legacy mirror', async () => {
  const base = limitsResult().rateLimits;
  const fake = fakeServer({ responses: { 'account/rateLimits/read': { result: {
    rateLimits: base, rateLimitsByLimitId: { codex: base,
      fast: { limitId: 'fast', limitName: 'Fast models', primary: { usedPercent: 100 }, secondary: null } },
  } } } });
  const result = await readCodexUsage({ spawn: fake.spawn });
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.limits.map(value => value.id), ['codex', 'fast']);
  assert.deepEqual(result.limits[1].windows, [{ kind: 'primary', used_percent: 100, remaining_percent: 0,
    window_minutes: null, resets_at: null }]);
});

test('missing and null values stay unknown without invented zero usage', async () => {
  const fake = fakeServer({ responses: { 'account/rateLimits/read': { result: {
    rateLimitsByLimitId: null, rateLimits: { primary: null, secondary: null, planType: null },
  } } } });
  const result = await readCodexUsage({ spawn: fake.spawn });
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.limits, [{ id: 'codex', name: 'codex', plan_type: null, windows: [] }]);
  const empty = fakeServer({ responses: { 'account/rateLimits/read': { result: { rateLimits: null } } } });
  assert.equal((await readCodexUsage({ spawn: empty.spawn })).status, 'unavailable');
});

test('returns only allowlisted token statistics and discards private account and credit data', async () => {
  const fake = fakeServer({ responses: {
    'account/rateLimits/read': { result: { ...limitsResult(), accountId: 'private-account', email: 'secret@example.test',
      rateLimitResetCredits: { availableCount: 7 }, token: 'sk-private-secret',
      rateLimits: { ...limitsResult().rateLimits, limitName: 'email secret@example.test', credits: { balance: '500.00' } } } },
    'account/usage/read': { result: { summary: { lifetimeTokens: 1234567, currentStreakDays: 10, privateToken: 'private-auth' },
      dailyUsageBuckets: [{ startDate: '2026-10-10', tokens: 42 }, { startDate: '2026-10-09', tokens: 0 }],
      threadUsage: { threadId: 'private-thread', estimatedUsageCreditsMicros: 777 } } },
  }, start: call => call.child.stderr.write('Bearer private-token secret@example.test\n') });
  const result = await readCodexUsage({ spawn: fake.spawn });
  assert.deepEqual(result.account_usage, { lifetime_tokens: 1234567,
    daily_tokens: [{ date: '2026-10-09', tokens: 0 }, { date: '2026-10-10', tokens: 42 }] });
  assert.equal(result.limits[0].name, 'codex');
  assert.doesNotMatch(JSON.stringify(result), /private|secret|Bearer|example|balance|credits|accountId|threadId/);
});

test('sparse notifications cannot supply stale percentages instead of the requested snapshot', async () => {
  const fake = fakeServer({ onMessage(request, call) {
    if (request.method === 'account/rateLimits/read') call.child.stdout.write(JSON.stringify({
      method: 'account/rateLimits/updated', params: { rateLimits: { primary: { usedPercent: 99 } } },
    }) + '\n');
  } });
  assert.equal((await readCodexUsage({ spawn: fake.spawn })).limits[0].windows[0].used_percent, 23);
});

test('rejects invalid window values rather than coercing missing usage or percentages', async () => {
  for (const primary of [{ usedPercent: null }, { usedPercent: '10' }, { usedPercent: -1 },
    { usedPercent: 2_147_483_648 }, { usedPercent: 1.5 }, { usedPercent: 1, resetsAt: '1800000000' },
    { usedPercent: 1, windowDurationMins: 0 }, { usedPercent: 1, resetsAt: Number.MAX_SAFE_INTEGER }]) {
    const fake = fakeServer({ responses: { 'account/rateLimits/read': { result: { rateLimits: { primary } } } } });
    assert.equal((await readCodexUsage({ spawn: fake.spawn })).status, 'unavailable');
    assert.ok(fake.calls[0].kills.includes('SIGTERM'));
  }
});

test('preserves provider overshoot while clamping remaining quota to zero', async () => {
  const fake = fakeServer({ responses: { 'account/rateLimits/read': { result: {
    rateLimits: { primary: { usedPercent: 103 } },
  } } } });
  const result = await readCodexUsage({ spawn: fake.spawn });
  assert.equal(result.status, 'ready');
  assert.equal(result.limits[0].windows[0].used_percent, 103);
  assert.equal(result.limits[0].windows[0].remaining_percent, 0);
});

test('optional malformed or unavailable token statistics leave valid limits usable', async () => {
  for (const value of [{ error: { code: -32601, message: 'Secret private-token' } },
    { result: { summary: { lifetimeTokens: -1 } } },
    { result: { summary: {}, dailyUsageBuckets: [{ startDate: '2026-02-30', tokens: 1 }] } },
    { result: { summary: {}, dailyUsageBuckets: [{ startDate: '2026-10-10', tokens: 1 }, { startDate: '2026-10-10', tokens: 2 }] } }]) {
    const fake = fakeServer({ responses: { 'account/usage/read': value } });
    const result = await readCodexUsage({ spawn: fake.spawn });
    assert.equal(result.status, 'ready');
    assert.equal(result.account_usage, null);
    assert.doesNotMatch(JSON.stringify(result), /Secret|private-token/);
  }
});

test('errors from startup and RPC return generic unavailable data without raw diagnostics', async () => {
  const startup = await readCodexUsage({ spawn: () => { throw new Error('sk-sensitive-password'); } });
  assert.equal(startup.status, 'unavailable');
  const fake = fakeServer({ responses: { 'account/rateLimits/read': {
    error: { code: 401, message: 'Account secret@example.test password=private' },
  } } });
  const result = await readCodexUsage({ spawn: fake.spawn });
  assert.equal(result.status, 'unavailable');
  assert.deepEqual(result.limits, []);
  assert.doesNotMatch(JSON.stringify([startup, result]), /sensitive|password|example|private|401/);
});

test('bounded timeout kills an unresponsive subprocess even when it ignores termination', async () => {
  const fake = fakeServer({ responses: { initialize: null }, ignoreTerm: true });
  const started = Date.now();
  const result = await readCodexUsage({ spawn: fake.spawn, timeoutMs: 30 });
  assert.equal(result.status, 'unavailable');
  assert.ok(Date.now() - started < 1000);
  assert.deepEqual(fake.calls[0].kills, ['SIGTERM', 'SIGKILL']);
});

test('optional token statistics timing out preserve a successfully read snapshot', async () => {
  const fake = fakeServer({ responses: { 'account/usage/read': null } });
  const result = await readCodexUsage({ spawn: fake.spawn, timeoutMs: 30 });
  assert.equal(result.status, 'ready');
  assert.equal(result.account_usage, null);
  assert.ok(fake.calls[0].kills.includes('SIGTERM'));
});

test('early closure and malformed protocol never hang or expose output', async () => {
  for (const badOutput of ['not-json\n', '{"id":987,"result":{"secret":"raw"}}\n',
    '{"id":1,"result":{},"error":{"message":"private"}}\n']) {
    const fake = fakeServer({ responses: { initialize: null }, start: call => call.child.stdout.write(badOutput) });
    const result = await readCodexUsage({ spawn: fake.spawn, timeoutMs: 50 });
    assert.equal(result.status, 'unavailable');
    assert.doesNotMatch(JSON.stringify(result), /not-json|raw|private/);
  }
  const closed = fakeServer({ responses: { initialize: null }, start: (_call, close) => close() });
  assert.equal((await readCodexUsage({ spawn: closed.spawn, timeoutMs: 50 })).status, 'unavailable');
});

test('caps output bytes and notification count and rejects unsolicited requests', async () => {
  for (const output of ['x'.repeat(128 * 1024 + 1),
    `${JSON.stringify({ method: 'private/notification', params: {} })}\n`.repeat(513),
    '{"id":5,"method":"account/login/start","params":{"token":"private"}}\n']) {
    const fake = fakeServer({ responses: { initialize: null }, start: call => call.child.stdout.write(output) });
    const result = await readCodexUsage({ spawn: fake.spawn, timeoutMs: 50 });
    assert.equal(result.status, 'unavailable');
    assert.equal(fake.calls[0].messages.length, 1);
    assert.ok(fake.calls[0].kills.includes('SIGTERM'));
  }
});

test('aborting does not start a process, and a later abort stops the active read', async () => {
  const before = new AbortController();
  before.abort();
  const never = fakeServer();
  assert.equal((await readCodexUsage({ spawn: never.spawn, signal: before.signal })).status, 'unavailable');
  assert.equal(never.calls.length, 0);
  const during = new AbortController();
  const fake = fakeServer({ responses: { initialize: null }, start: () => during.abort() });
  assert.equal((await readCodexUsage({ spawn: fake.spawn, signal: during.signal })).status, 'unavailable');
  assert.ok(fake.calls[0].kills.includes('SIGTERM'));
});

test('does not leak credentials encoded in bucket identifiers or unrecognized plan types', async () => {
  const rejected = fakeServer({ responses: { 'account/rateLimits/read': { result: {
    rateLimits: { limitId: 'sk-privatecredential123', primary: { usedPercent: 0 } },
  } } } });
  assert.equal((await readCodexUsage({ spawn: rejected.spawn })).status, 'unavailable');
  const plan = fakeServer({ responses: { 'account/rateLimits/read': { result: {
    rateLimits: { planType: 'private-account', primary: { usedPercent: 0 } },
  } } } });
  assert.equal((await readCodexUsage({ spawn: plan.spawn })).limits[0].plan_type, null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexRunner, classifyCodexError, permissionArgs, rolePrompt, sanitizedEnv, validateRoleResult } from '../lib/codex.mjs';
import { BUG_SEVERITIES } from '../lib/roles.mjs';

const analystResult = () => ({ summary: 'Scoped task', spec: { acceptance: ['The language selection persists'],
  subtasks: [{ title: 'Persist language', description: 'Save selection', acceptance: ['Reload retains the choice'] }],
  scope: 'Interface language settings', priority: 'P1' }, questions: [] });
const developerResult = () => ({ summary: 'Implemented', artifact: { commit: 'a'.repeat(40), changed_files: ['src/lang.ts'],
  checks: [{ name: 'build', passed: true, detail: 'Completed' }], notes: '' } });
const testerResult = () => ({ summary: 'Verified', passed: true, bugs: [], artifact: { commit: 'a'.repeat(40),
  checks: [{ name: 'build', passed: true, detail: 'Completed' }] } });

test('awaits real token usage before the completed run returns and counts cache once', async t => {
  const { runner, workspace } = await fixture(t, { execution: { result: analystResult(), chunks: [
    JSON.stringify({type:'turn.completed',usage:{input_tokens:100,cached_input_tokens:60,output_tokens:10,reasoning_output_tokens:3,private_key:'hidden'}})+'\n',
  ] } });
  let persisted = false;
  await runner.run({role:'analyst',task:{},workspace,onUsage:async usage=>{
    assert.deepEqual(usage,{input_tokens:100,cached_input_tokens:60,output_tokens:10,reasoning_output_tokens:3,total_tokens:110});
    await new Promise(resolve=>setImmediate(resolve)); persisted=true;
  }});
  assert.equal(persisted,true);
});

test('preserves reported usage when the model result is invalid', async t => {
  const {runner,workspace}=await fixture(t,{execution:{result:{invalid:true},chunks:[
    JSON.stringify({type:'turn.completed',usage:{input_tokens:50,output_tokens:7}})+'\n',
  ]}});
  const reports=[];
  await assert.rejects(runner.run({role:'analyst',task:{},workspace,onUsage:usage=>reports.push(usage)}),{code:'invalid_output'});
  assert.equal(reports[0].total_tokens,57);
  assert.equal(reports[0].cached_input_tokens,null);
});

test('missing or inconsistent token counters stay unreported', async t => {
  for(const usage of [undefined,{}, {input_tokens:2,cached_input_tokens:3,output_tokens:1}]){
    const {runner,workspace}=await fixture(t,{execution:{result:analystResult(),chunks:[JSON.stringify({type:'turn.completed',usage})+'\n']}});
    const reports=[];
    await runner.run({role:'analyst',task:{},workspace,onUsage:report=>reports.push(report)});
    assert.deepEqual(reports,[]);
  }
});

test('identifies the pre-model sandbox helper failure without exposing private paths', () => {
  const error = classifyCodexError('Failed to load AGENTS.md: fs sandbox helper failed: bwrap: execvp /home/node/.codex/tmp/arg0/codex-arg0Ab12/codex-linux-sandbox: Permission denied');
  assert.equal(error.code, 'runner_sandbox');
  assert.match(error.message, /помощник изоляции/);
  assert.ok(!error.message.includes('/home/node'));
});

function fakeSpawn({ auth = 'Logged in using ChatGPT', authCode = 0, execution = {}, login = {} } = {}) {
  const calls = [];
  const spawn = (binary, args, options) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const call = { binary, args, options, input: '', kills: [] };
    calls.push(call);
    child.stdin.on('data', chunk => { call.input += chunk.toString(); });
    let closed = false;
    const close = code => {
      if (!closed) { closed = true; child.stdout.end(); child.stderr.end(); child.emit('close', code); }
    };
    child.kill = signal => {
      call.kills.push(signal);
      if (signal === 'SIGKILL' || !execution.ignoreTerm) setImmediate(() => close(null));
      return true;
    };
    setImmediate(async () => {
      try {
        if (args.includes('--version')) { child.stdout.write('codex-cli 0.162.0-alpha.2\n'); close(0); return; }
        if (args[0] === 'login' && args[1] === 'status') { child.stderr.write(`${auth}\n`); close(authCode); return; }
        const plan = args[0] === 'login' ? login : execution;
        if (plan.onStart) plan.onStart(call);
        if (plan.error) { child.emit('error', Object.assign(new Error('Private diagnostic'), { code: plan.error })); close(null); return; }
        if (plan.hang) return;
        if (plan.delayMs) await new Promise(resolve => setTimeout(resolve, plan.delayMs));
        if (Object.hasOwn(plan, 'result')) {
          const resultPath = args[args.indexOf('--output-last-message') + 1];
          await writeFile(resultPath, typeof plan.result === 'string' ? plan.result : JSON.stringify(plan.result));
        }
        const defaultEvents = args[0] === 'login' ? [] : ['{"type":"turn.started"}\n', '{"type":"turn.completed"}\n'];
        for (const chunk of plan.chunks ?? defaultEvents) child.stdout.write(chunk);
        if (plan.stderr) child.stderr.write(plan.stderr);
        close(plan.code ?? 0);
      } catch (error) { child.emit('error', error); close(null); }
    });
    return child;
  };
  return { spawn, calls };
}

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'royal-codex-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const workspace = join(directory, 'workspace');
  await mkdir(workspace);
  const fake = fakeSpawn(options);
  const runner = new CodexRunner({ binary: '/fake/codex', runsDir: join(directory, 'runs'), spawn: fake.spawn,
    timeoutMs: 1000, killGraceMs: 10, ...options.runner });
  return { directory, workspace, runner, calls: fake.calls };
}

test('reports CLI availability and ChatGPT status without exposing diagnostics', async t => {
  const { runner } = await fixture(t);
  assert.deepEqual(await runner.available(), { available: true, version: '0.162.0-alpha.2' });
  assert.deepEqual(await runner.authStatus(), { authenticated: true, mode: 'chatgpt', reason: null });
});

test('passes explicit role profile to Codex and supplies the selected versioned skill', async t => {
  const { runner, workspace, calls } = await fixture(t, { execution: { result: analystResult() } });
  const updates = [];
  await runner.run({ role: 'analyst', task: {}, workspace,
    execution: { requested_model: 'gpt-6-astra', requested_effort: 'xhigh', requested_skills: ['royal-analysis'] },
    onExecution: async patch => updates.push(patch) });
  const call = calls.at(-1);
  assert.equal(call.args[call.args.indexOf('--model') + 1], 'gpt-6-astra');
  assert.ok(call.args.includes('model_reasoning_effort="xhigh"'));
  assert.match(call.input, /royal-analysis/);
  assert.equal(updates[0].skills[0].id, 'royal-analysis');
  assert.match(updates[0].skills[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(updates.at(-1).actual_model, null);
  assert.equal(updates.at(-1).observation_status, 'unavailable');
});

test('observes actual metadata even when Codex fails, and rejects a substituted model', async t => {
  const threadId = '11111111-1111-1111-1111-111111111111';
  for (const fail of [false, true]) {
    const { directory, runner, workspace } = await fixture(t, { execution: { result: analystResult(), code: fail ? 1 : 0,
      chunks: [JSON.stringify({ type: 'thread.started', thread_id: threadId }) + '\n', '{"type":"turn.completed"}\n'] } });
    runner.env.CODEX_HOME = directory;
    const date = new Date().toISOString().slice(0, 10).replaceAll('-', '/');
    const folder = join(directory, 'sessions', date); await mkdir(folder, { recursive: true });
    await writeFile(join(folder, `rollout-test-${threadId}.jsonl`), [
      { type: 'session_meta', payload: { id: threadId } },
      { type: 'turn_context', payload: { cwd: workspace, model: fail ? 'gpt-6.1-sol' : 'gpt-6-astra', collaboration_mode: { settings: { reasoning_effort: 'medium' } } } },
    ].map(value => JSON.stringify(value)).join('\n') + '\n');
    const updates = [];
    await assert.rejects(runner.run({ role: 'analyst', task: {}, workspace, onExecution: async patch => updates.push(patch) }),
      { code: fail ? 'process_error' : 'model_mismatch' });
    assert.equal(updates.at(-1).thread_id, threadId);
    assert.equal(updates.at(-1).actual_model, fail ? 'gpt-6.1-sol' : 'gpt-6-astra');
    assert.equal(updates.at(-1).actual_effort, 'medium');
    assert.equal(updates.at(-1).observation_status, 'observed');
  }
});

test('invalid profiles cannot start a process or inject Codex configuration', async t => {
  const { runner, workspace, calls } = await fixture(t);
  await assert.rejects(runner.run({ role: 'analyst', task: {}, workspace,
    execution: { requested_model: 'gpt-6.1-sol\nunsafe', requested_effort: 'medium', requested_skills: [] } }));
  assert.equal(calls.length, 0);
});

test('child environment drops project secrets, API keys, hooks and proxy credentials', () => {
  const env = sanitizedEnv({ PATH: '/bin', HOME: '/home/runner', CODEX_HOME: '/home/runner/.codex', LANG: 'en_US.UTF-8',
    OPENAI_API_KEY: 'private', CODEX_API_KEY: 'private', CODEX_SALE_API_KEY: 'private', DATABASE_URL: 'private',
    NODE_OPTIONS: '--require /tmp/hook.js', HTTPS_PROXY: 'https://user:password@proxy', TMPDIR: '/tmp\nunsafe', PLAYWRIGHT_BROWSERS_PATH: '/opt/pw-browsers' });
  assert.deepEqual(env, { PATH: '/bin', HOME: '/home/runner', CODEX_HOME: '/home/runner/.codex', LANG: 'en_US.UTF-8', PLAYWRIGHT_BROWSERS_PATH: '/opt/pw-browsers' });
});

test('permission profiles restrict reads and keep authentication, metadata and secrets protected', () => {
  for (const role of ['analyst', 'developer', 'tester']) {
    const args = permissionArgs(role, { env: { HOME: '/home/node', CODEX_HOME: '/private/runner-auth' } });
    const profile = args[3];
    assert.equal(args[1], `default_permissions="royal-${role}"`);
    assert.match(profile, /":root"="deny"/);
    assert.match(profile, /":minimal"="read"/);
    assert.match(profile, /"\.git"="read"/);
    assert.match(profile, /"\.codex"="read"/);
    assert.match(profile, /"\.agents"="read"/);
    for (const path of ['/run/secrets', '/data', '/project', '/private/runner-auth']) assert.ok(profile.includes(`"${path}"="deny"`));
    assert.ok(profile.includes('"/tmp"="write"'));
    assert.ok(profile.includes('"/opt/pw-browsers"="read"'));
    assert.ok(profile.includes('"**/.env"="deny"'));
    assert.ok(profile.includes('"**/.env.*"="deny"'));
    assert.ok(profile.includes('"**/*.env"="deny"'));
    assert.ok(!profile.includes('"/workspaces"="write"'));
    if (role === 'analyst') {
      assert.match(profile, /extends=":read-only"/);
      assert.match(profile, /":workspace_roots"=\{"\."="read"/);
      assert.match(profile, /network=\{enabled=false/);
      assert.equal(args[5], 'features.network_proxy=false');
    } else {
      assert.match(profile, /extends=":workspace"/);
      assert.match(profile, /":workspace_roots"=\{"\."="write"/);
      assert.match(profile, /network=\{enabled=true,allow_upstream_proxy=false,allow_local_binding=true,domains=\{"localhost"="allow","127\.0\.0\.1"="allow"\}\}/);
      assert.equal(args[5], 'features.network_proxy=true');
      assert.ok(!profile.includes('"*"="allow"'));
    }
  }
  assert.ok(permissionArgs('analyst', { env: { HOME: '/home/node' } })[3].includes('"/home/node/.codex"="deny"'));
  assert.throws(() => permissionArgs('invalid'), { code: 'invalid_output' });
  assert.throws(() => permissionArgs('developer', { env: { CODEX_HOME: '/' } }), { code: 'invalid_output' });
  assert.throws(() => permissionArgs('developer', { env: { CODEX_HOME: 'relative-path' } }), { code: 'invalid_output' });
});

test('analyst runs with restricted permissions, no shell and a pinned default model', async t => {
  const { runner, workspace, calls } = await fixture(t, { execution: { result: analystResult() },
    runner: { env: { PATH: '/bin', HOME: '/home/runner', OPENAI_API_KEY: 'private', DATABASE_URL: 'private' } } });
  assert.deepEqual(await runner.run({ role: 'analyst', task: { title: 'Language settings' }, workspace }), analystResult());
  const call = calls.at(-1);
  assert.equal(call.options.shell, false);
  assert.deepEqual(call.options.env, { PATH: '/bin', HOME: '/home/runner' });
  assert.deepEqual(call.args.slice(0, 2), ['-a', 'never']);
  assert.ok(call.args.includes('default_permissions="royal-analyst"'));
  assert.ok(call.args.includes('features.network_proxy=false'));
  assert.ok(call.args.includes('web_search="cached"'));
  assert.ok(!call.args.includes('-s'));
  assert.ok(call.args.includes('forced_login_method="chatgpt"'));
  assert.ok(call.args.includes('model_provider="openai"'));
  assert.ok(call.args.includes('--ignore-user-config'));
  assert.ok(call.args.includes('--output-schema'));
  assert.ok(call.args.includes('--output-last-message'));
  assert.equal(call.args[call.args.indexOf('--model') + 1], 'gpt-6.1-sol');
  assert.ok(!call.args.includes('--skip-git-repo-check'));
  assert.ok(!call.args.some(arg => arg.includes('danger-full-access')));
  assert.match(call.input, /Do not implement the task/);
});

test('developer and QA use workspace profiles, with QA read-only code and controller commits', async t => {
  for (const [role, result] of [['developer', developerResult()], ['tester', testerResult()]]) {
    const { runner, workspace, calls } = await fixture(t, { execution: { result } });
    assert.deepEqual(await runner.run({ role, task: { title: 'Task' }, workspace }), result);
    assert.ok(calls.at(-1).args.includes(`default_permissions="royal-${role}"`));
    assert.ok(calls.at(-1).args.includes('features.network_proxy=true'));
    assert.ok(!calls.at(-1).args.includes('-s'));
    if (role === 'tester') assert.match(calls.at(-1).input, /Do not change application source, tests, configuration, or commits/);
    if (role === 'developer') {
      assert.match(calls.at(-1).input, /The controller creates the candidate commit after your step/);
      assert.match(calls.at(-1).input, /do not stage files, commit, or alter Git configuration/);
    }
  }
});

test('developer prompt reports the existing HEAD while final commit belongs to the controller', () => {
  const prompt = rolePrompt('developer', { title: 'Task' });
  assert.match(prompt, /Report the current HEAD hash in artifact\.commit/);
  assert.ok(!prompt.includes('Commit your changes locally'));
});

test('all roles receive shared project evidence and distinguish tested candidates from releases', () => {
  const task = {
    project_knowledge: {version:'2026.10.10',sha256:'a'.repeat(64),guide:'finance-gateway already exists',fixture:'.factory/project-knowledge.json'},
    task_memory: {answers:[{answer:'Use the existing integration'}],deliveries:[{state:'candidate_awaiting_release'}]},
  };
  for (const role of ['analyst','developer','tester']) {
    const prompt = rolePrompt(role,task);
    assert.match(prompt,/read project_knowledge\.guide/);
    assert.match(prompt,/Never modify managed knowledge fixtures/);
    assert.match(prompt,/Do not ask the owner to rediscover a documented service/);
    assert.match(prompt,/awaiting release unless explicitly marked released/);
    assert.deepEqual(JSON.parse(prompt.split('TASK JSON:\n\n')[1]),task);
  }
});

test('parses split UTF-8 JSONL but emits only safe event metadata', async t => {
  const event = Buffer.from(`${JSON.stringify({ type: 'item.completed', item: { type: 'agent_message',
    text: 'Привет Bearer private-token sk-secretsecret', status: 'completed' } })}\n`);
  const boundary = event.indexOf(Buffer.from('Привет')) + 1;
  const { runner, workspace } = await fixture(t, { execution: { result: analystResult(), chunks: [
    event.subarray(0, boundary), event.subarray(boundary),
    '{"type":"turn.completed","usage":{"input_tokens":23,"access_token":"secret"}}\n',
  ] } });
  const events = [];
  await runner.run({ role: 'analyst', task: {}, workspace, onEvent: event => events.push(event) });
  assert.deepEqual(events, [{ type: 'item.completed', itemType: 'agent_message', status: 'completed' },
    { type: 'turn.completed', usage: { input_tokens: 23 } }]);
  assert.ok(!JSON.stringify(events).includes('private-token'));
});

test('rejects API-key auth and does not start task execution', async t => {
  const { runner, workspace, calls } = await fixture(t, { auth: 'Logged in using an API key: sk-privateprivate' });
  assert.equal((await runner.authStatus()).mode, 'api_key');
  await assert.rejects(runner.run({ role: 'analyst', task: {}, workspace }), { code: 'auth' });
  assert.ok(calls.every(call => call.args[0] === 'login'));
  assert.ok(!JSON.stringify(await runner.authStatus()).includes('sk-privateprivate'));
});

test('model-start observer runs after authentication and before execution, with content-free tool telemetry', async t => {
  const lifecycle = [], updates = [];
  const { runner, workspace, calls } = await fixture(t, { execution: { result: analystResult(), onStart: () => lifecycle.push('process'), chunks: [
    JSON.stringify({ type: 'item.started', item: { id: 'private-id', type: 'command_execution', command: 'password=private' } }) + '\n',
    JSON.stringify({ type: 'item.updated', item: { id: 'private-id', type: 'command_execution', aggregated_output: 'Bearer private' } }) + '\n',
    JSON.stringify({ type: 'item.completed', item: { id: 'private-id', type: 'command_execution', aggregated_output: 'secret' } }) + '\n',
    '{"type":"turn.completed"}\n',
  ] } });
  await runner.run({ role: 'analyst', task: {}, workspace, onModelStart: async () => {
    assert.equal(calls.length, 1); assert.deepEqual(calls[0].args, ['login', 'status']);
    lifecycle.push('model-start');
  }, onActivity: update => updates.push(update) });
  assert.deepEqual(lifecycle, ['model-start', 'process']);
  assert.equal(updates.reduce((total, update) => total + update.tool_calls_delta, 0), 1);
  assert.equal(updates.reduce((total, update) => total + update.tool_completed_delta, 0), 1);
  assert.ok(!/private|password|Bearer|secret/.test(JSON.stringify(updates)));
});

test('rejects unknown or missing sign-in instead of falling back to another provider', async t => {
  for (const config of [{ auth: 'Logged in', authCode: 0 }, { auth: 'Not logged in', authCode: 1 }]) {
    const { runner, workspace, calls } = await fixture(t, config);
    await assert.rejects(runner.run({ role: 'analyst', task: {}, workspace }), { code: 'auth' });
    assert.equal(calls.length, 1);
  }
});

test('classifies turn.failed even when the process exit code is zero', async t => {
  const { runner, workspace } = await fixture(t, { execution: { result: analystResult(), chunks: [
    '{"type":"turn.failed","error":{"message":"HTTP 429 usage limit Retry-After: 45 Bearer private-token"}}\n',
  ] } });
  await assert.rejects(runner.run({ role: 'analyst', task: {}, workspace }), error => {
    assert.equal(error.code, 'rate_limit');
    assert.equal(error.retryAfterMs, 45_000);
    assert.ok(!error.message.includes('private-token'));
    return true;
  });
});

test('classifies process auth failures and HTTP429 headers', async t => {
  for (const [stderr, code, retryAfterMs] of [['HTTP 401 refresh_token expired private', 'auth', null],
    ['HTTP 429\nRetry-After: 12', 'rate_limit', 12_000]]) {
    const { runner, workspace } = await fixture(t, { execution: { code: 1, stderr } });
    await assert.rejects(runner.run({ role: 'analyst', task: {}, workspace }), error => {
      assert.equal(error.code, code); assert.equal(error.retryAfterMs, retryAfterMs); return true;
    });
  }
  assert.equal(classifyCodexError('retry_after: 9 rate_limit').retryAfterMs, 9000);
});

test('invalid JSONL and incomplete turns cannot produce accepted results', async t => {
  for (const chunks of [['not json\n'], ['{"type":"turn.started"}\n']]) {
    const { runner, workspace } = await fixture(t, { execution: { result: analystResult(), chunks } });
    await assert.rejects(runner.run({ role: 'analyst', task: {}, workspace }), { code: 'invalid_output' });
  }
});

test('validates every role field and rejects contradictory QA findings', () => {
  const invalid = [
    ['analyst', { ...analystResult(), extra: true }],
    ['analyst', { ...analystResult(), questions: [4] }],
    ['analyst', { ...analystResult(), spec: { ...analystResult().spec, priority: 'urgent' } }],
    ['developer', { summary: 'Implemented', artifact: { ...developerResult().artifact, checks: [{ name: 'build', passed: 'yes', detail: '' }] } }],
    ['tester', { ...testerResult(), passed: 'true' }],
    ['tester', { ...testerResult(), bugs: [{ title: 'Bug', expected: 'X', actual: 'Y', steps: [], severity: 'P1' }] }],
    ['tester', { ...testerResult(), artifact: { ...testerResult().artifact, checks: [{ name: 'build', passed: false, detail: '' }] } }],
  ];
  for (const [role, result] of invalid) assert.throws(() => validateRoleResult(role, result), { code: 'invalid_output' });
});

test('QA preserves a concrete verification gap without inventing a product defect', async t => {
  const result = { ...testerResult(), passed: false, summary: 'Browser verification blocked', artifact: {
    ...testerResult().artifact, checks: [
      { name: 'build', passed: true, detail: 'Completed' },
      { name: 'Browser transfer scenario', passed: false, detail: 'Chromium exited with SIGTRAP before opening a page; the scenario could not run.' },
    ],
  } };
  const { runner, workspace, calls } = await fixture(t, { execution: { result } });
  assert.deepEqual(await runner.run({ role: 'tester', task: {}, workspace }), result);
  assert.match(calls.at(-1).input, /Never invent a product defect/);
  for (const checks of [[], [{ name: 'browser', passed: true, detail: 'Complete' }],
    [{ name: ' ', passed: false, detail: 'Unavailable' }], [{ name: 'browser', passed: false, detail: '\n' }]]) {
    assert.throws(() => validateRoleResult('tester', { ...result, artifact: { ...result.artifact, checks } }), { code: 'invalid_output' });
  }
  assert.throws(() => validateRoleResult('tester', { ...result, passed: true }), { code: 'invalid_output' });
});

test('QA accepts only the four severity values and rejects explanatory or empty severity before saving', async t => {
  for (const severity of [...BUG_SEVERITIES, '', 'high: ' + 'Detailed defect rationale '.repeat(12), 'P1']) {
    const result = { ...testerResult(), passed: false, summary: 'Defect found', bugs: [
      { title: 'Regression', expected: 'Expected behavior', actual: 'Observed behavior', steps: ['Reproduce'], severity },
    ] };
    const { runner, workspace, calls } = await fixture(t, { execution: { result } });
    if (BUG_SEVERITIES.includes(severity)) {
      const accepted = await runner.run({ role: 'tester', task: {}, workspace });
      assert.equal(accepted.bugs[0].severity, severity);
    } else {
      await assert.rejects(runner.run({ role: 'tester', task: {}, workspace }), { code: 'invalid_output' });
      const args = calls.at(-1).args;
      await assert.rejects(readFile(args[args.indexOf('--output-last-message') + 1]), { code: 'ENOENT' });
    }
  }
});

test('QA rejects invalid defect fields before they reach the controller store', async t => {
  const bug = { title: 'Regression', expected: 'Expected behavior', actual: 'Observed behavior', steps: ['Reproduce'], severity: 'high' };
  const base = { ...testerResult(), passed: false, bugs: [bug] };
  const cases = [
    { ...base, summary: '   ' }, { ...base, bugs: [] },
    ...[{ title: 'a'.repeat(301) }, { title: '   ' }, { expected: '  ' }, { actual: '\n' },
      { steps: [] }, { steps: ['  '] }].map(patch => ({ ...base, bugs: [{ ...bug, ...patch }] })),
  ];
  for (const result of cases) {
    const { runner, workspace, calls } = await fixture(t, { execution: { result } });
    await assert.rejects(runner.run({ role: 'tester', task: {}, workspace }), { code: 'invalid_output' });
    const args = calls.at(-1).args;
    await assert.rejects(readFile(args[args.indexOf('--output-last-message') + 1]), { code: 'ENOENT' });
  }
  for (const role of ['analyst', 'developer']) {
    const result = role === 'analyst' ? analystResult() : developerResult();
    assert.throws(() => validateRoleResult(role, { ...result, summary: '  ' }), { code: 'invalid_output' });
  }
  assert.throws(() => validateRoleResult('analyst', { ...analystResult(), questions: ['  '] }), { code: 'invalid_output' });
});

test('missing and malformed final results fail closed', async t => {
  for (const execution of [{}, { result: '{bad json' }, { result: { summary: 'Missing fields' } }]) {
    const { runner, workspace, calls } = await fixture(t, { execution });
    await assert.rejects(runner.run({ role: 'analyst', task: {}, workspace }), { code: 'invalid_output' });
    const args = calls.at(-1).args;
    const path = args[args.indexOf('--output-last-message') + 1];
    await assert.rejects(readFile(path), { code: 'ENOENT' });
  }
});

test('redacts common credentials and normalizes prohibited punctuation in final output', async t => {
  const result = analystResult();
  result.summary = `Token Bearer private-token, key sk-privateprivate, password=private ${String.fromCharCode(0x2014)} done`;
  const { runner, workspace, calls } = await fixture(t, { execution: { result } });
  const actual = await runner.run({ role: 'analyst', task: {}, workspace });
  assert.ok(!actual.summary.includes('private'));
  assert.ok(!actual.summary.includes(String.fromCharCode(0x2014)));
  const args = calls.at(-1).args;
  assert.deepEqual(JSON.parse(await readFile(args[args.indexOf('--output-last-message') + 1], 'utf8')), actual);
});

test('hard timeout terminates the subprocess and escalates if SIGTERM is ignored', async t => {
  const { runner, workspace, calls } = await fixture(t, { execution: { hang: true, ignoreTerm: true }, runner: { timeoutMs: 20 } });
  await assert.rejects(runner.run({ role: 'developer', task: {}, workspace }), { code: 'timeout' });
  assert.deepEqual(calls.at(-1).kills, ['SIGTERM', 'SIGKILL']);
});

test('a longer step budget overrides the runner default and allows work to finish', async t => {
  const { runner, workspace } = await fixture(t, { execution: { result: analystResult(), delayMs: 40 }, runner: { timeoutMs: 5 } });
  const result = await runner.run({ role: 'analyst', task: {}, workspace, timeoutMs: 200 });
  assert.equal(result.summary, 'Scoped task');
});

test('an overridden step budget still stops a hung process and explains retained changes', async t => {
  const { runner, workspace, calls } = await fixture(t, { execution: { hang: true }, runner: { timeoutMs: 1000 } });
  await assert.rejects(runner.run({ role: 'developer', task: {}, workspace, timeoutMs: 15 }), error => {
    assert.equal(error.code, 'timeout'); assert.match(error.message, /Частичные изменения сохранены/); return true;
  });
  assert.deepEqual(calls.at(-1).kills, ['SIGTERM']);
});

test('invalid or unbounded step budgets cannot start Codex', async t => {
  const { runner, workspace, calls } = await fixture(t);
  for (const timeoutMs of [0, -1, Infinity, NaN, '450000', 91 * 60000]) {
    await assert.rejects(runner.run({ role: 'developer', task: {}, workspace, timeoutMs }), { code: 'invalid_output' });
  }
  assert.equal(calls.length, 0);
});

test('output and event caps terminate excessive output', async t => {
  for (const limits of [{ maxOutputBytes: 100 }, { maxEventBytes: 100 }]) {
    const { runner, workspace } = await fixture(t, { execution: { chunks: [JSON.stringify({ type: 'item.updated', text: 'x'.repeat(200) })] }, runner: limits });
    await assert.rejects(runner.run({ role: 'developer', task: {}, workspace }), { code: 'output_limit' });
  }
});

test('result size cap rejects oversized JSON even when the turn completes', async t => {
  const { runner, workspace } = await fixture(t, { execution: { result: analystResult() }, runner: { maxResultBytes: 10 } });
  await assert.rejects(runner.run({ role: 'analyst', task: {}, workspace }), { code: 'output_limit' });
});

test('cancellation stops a running task and pre-cancelled tasks do not spawn', async t => {
  const controller = new AbortController();
  const { runner, workspace, calls } = await fixture(t, { execution: { hang: true, onStart: () => controller.abort() } });
  await assert.rejects(runner.run({ role: 'developer', task: {}, workspace, signal: controller.signal }), { code: 'cancelled' });
  assert.deepEqual(calls.at(-1).kills, ['SIGTERM']);
  const count = calls.length;
  await assert.rejects(runner.run({ role: 'analyst', task: {}, workspace, signal: controller.signal }), { code: 'cancelled' });
  assert.equal(calls.length, count);
});

test('device login publishes only an official device URL and one-time code', async t => {
  const { runner, calls } = await fixture(t, { login: { chunks: [
    'Warning sk-privateprivate\nhttps://evil.example/device\n',
    'Open https://auth.openai.com/codex/device?access_token=private\n',
    'Then enter this one-time code:\n\x1b[1mABCD-1234\x1b[0m\n',
  ] } });
  const updates = [];
  const result = await runner.requestLogin({ onUpdate: value => updates.push(value) });
  assert.equal(result.status, 'authenticated');
  assert.equal(result.code, null);
  assert.ok(updates.some(update => update.status === 'pending' && update.code === 'ABCD-1234'));
  assert.ok(updates.every(update => update.url === null || update.url === 'https://auth.openai.com/codex/device'));
  assert.ok(!JSON.stringify(updates).includes('private'));
  assert.deepEqual(calls[0].args, ['login', '--device-auth']);
});

test('failed device login clears the code and never exposes raw errors', async t => {
  const { runner } = await fixture(t, { login: { code: 1, chunks: ['https://auth.openai.com/codex/device\nABCD-1234\n'],
    stderr: 'authentication failed Bearer private-token' } });
  const updates = [];
  await assert.rejects(runner.requestLogin({ onUpdate: value => updates.push(value) }), { code: 'auth' });
  assert.equal(updates.at(-1).status, 'failed');
  assert.equal(updates.at(-1).code, null);
  assert.ok(!JSON.stringify(updates).includes('private-token'));
});

test('device code is not published until the streamed line is complete', async t => {
  const { runner } = await fixture(t, { login: { chunks: [
    'https://auth.openai.com/codex/device\nABCD-12', '34\n',
  ] } });
  const updates = [];
  await runner.requestLogin({ onUpdate: value => updates.push(value) });
  assert.deepEqual(updates.filter(update => update.code).map(update => update.code), ['ABCD-1234']);
});

test('unavailable executables are reported without private subprocess diagnostics', async t => {
  const { runner, workspace } = await fixture(t, { execution: { error: 'ENOENT' } });
  await assert.rejects(runner.run({ role: 'developer', task: {}, workspace }), error => {
    assert.equal(error.code, 'unavailable');
    assert.ok(!error.message.includes('Private diagnostic'));
    return true;
  });
});

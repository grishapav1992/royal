import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { browserCheck, browserTestSelection } from '../lib/browser-checks.mjs';

const task = { id: 'c8eb6ec1-eb93-443c-a3ae-f98c5e1e5418', requirements_version: 2 };
const candidate = 'a'.repeat(40);
const tests = ['tests/demo-wallet.spec.ts'];
async function queue(t) {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'royal-browser-queue-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function respond(directory, patch = {}) {
  for (let i = 0; i < 100; i++) {
    const name = (await readdir(directory)).find(name => name.endsWith('.request.json'));
    if (name) {
      const request = JSON.parse(await readFile(join(directory, name), 'utf8'));
      await writeFile(join(directory, `${request.request_id}.response.json`), JSON.stringify({ ...request,
        passed: true, status: 'completed', exit_code: 0, detail: 'tests/demo-wallet.spec.ts: 3 passed, 0 failed', ...patch }));
      return request;
    }
    await delay(10);
  }
  throw new Error('request not published');
}

test('selects actual changed browser tests and wallet coverage without arbitrary paths', () => {
  const available = ['tests/demo-wallet.spec.ts', 'tests/game-core.spec.ts', 'tests/halls.spec.ts'];
  assert.deepEqual(browserTestSelection({artifact:{developer:{changed_files:['server/demoWallet.ts','tests/halls.spec.ts','tests/../secret.spec.ts']}}}, available), ['tests/demo-wallet.spec.ts','tests/halls.spec.ts']);
  assert.deepEqual(browserTestSelection({}, available), ['tests/game-core.spec.ts']);
  assert.deepEqual(browserTestSelection({}, []), []);
});
test('accepts only evidence tied to this exact candidate and requirements', async t => {
  const directory = await queue(t);
  const response = respond(directory);
  const check = await browserCheck({task,candidate,tests,directory,timeoutMs:2000});
  await response;
  assert.equal(check.passed,true);
  assert.equal(check.verification_blocked,false);
  assert.match(check.detail,/3 passed/);
  assert.equal((await readdir(directory)).filter(name=>name.endsWith('.response.json')).length,0);
});
test('wrong candidate and false success from an error response fail closed', async t => {
  for (const patch of [{candidate_commit:'b'.repeat(40)}, {requirements_version:3}, {status:'error',passed:true}, {exit_code:1,passed:true}]) {
    const directory = await queue(t);
    const response = respond(directory,patch);
    await assert.rejects(browserCheck({task,candidate,tests,directory,timeoutMs:2000}),/does not match/);
    await response;
    assert.equal((await readdir(directory)).filter(name=>name.endsWith('.cancel')).length,1);
  }
});
test('test failures and missing infrastructure remain distinguishable', async t => {
  for (const status of ['completed','error','timeout']) {
    const directory=await queue(t);
    const response=respond(directory,{passed:false,status,exit_code:1,detail:'Scenario failed with concrete evidence'});
    const check=await browserCheck({task,candidate,tests,directory,timeoutMs:2000});
    await response;
    assert.equal(check.passed,false);
    assert.equal(check.verification_blocked,status!=='completed');
  }
  const missing=await browserCheck({task,candidate,tests});
  assert.equal(missing.verification_blocked,true);
});
test('aborted and timed out requests signal bounded host cancellation', async t => {
  const directory=await queue(t);
  const check=await browserCheck({task,candidate,tests,directory,timeoutMs:20});
  assert.equal(check.verification_blocked,true);
  assert.equal((await readdir(directory)).filter(name=>name.endsWith('.cancel')).length,1);
  const second=await queue(t);
  const controller=new AbortController();
  const request=browserCheck({task,candidate,tests,directory:second,signal:controller.signal,timeoutMs:2000});
  await delay(30);controller.abort(new Error('lease revoked'));
  await assert.rejects(request,/lease revoked|aborted/);
  assert.equal((await readdir(second)).filter(name=>name.endsWith('.cancel')).length,1);
});
test('unsafe selections and symlinked queue roots never publish requests', async t => {
  const directory=await queue(t);
  for (const selected of [[],['../secret'],['tests/-option.spec.ts'],[tests[0],tests[0]]]) {
    await assert.rejects(browserCheck({task,candidate,tests:selected,directory}),/Invalid browser/);
  }
  const link=join(directory,'link');await symlink(directory,link,'dir');
  await assert.rejects(browserCheck({task,candidate,tests,directory:link}),/canonical/);
  assert.deepEqual(await readdir(directory),['link']);
});

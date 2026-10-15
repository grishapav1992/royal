import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { assessOutcome, runRemoteStage, runId, name } from '../artifacts/websocket-capacity-stage-5/run-remote-stage.mjs';

const bootstrap = resolve('artifacts/websocket-capacity-stage-5/remote-bootstrap.py');
function python(code) {
  const prelude = `import importlib.util,json,tempfile,subprocess\nfrom pathlib import Path\nspec=importlib.util.spec_from_file_location('bootstrap',${JSON.stringify(bootstrap)})\nb=importlib.util.module_from_spec(spec)\nspec.loader.exec_module(b)\ndirectory=tempfile.TemporaryDirectory()\nb.ROOT=Path(directory.name)\n(b.ROOT/'run').mkdir()\nb.time.sleep=lambda _:None\n`;
  const executable = process.env.PYTHON ?? (existsSync('/opt/homebrew/bin/python3.12') ? '/opt/homebrew/bin/python3.12' : 'python3');
  execFileSync(executable, ['-c', prelude + code], { timeout: 10000, stdio: 'pipe' });
}

test('lost create reply still stops the exact owned test and reports incomplete evidence', async t => {
  const artifact = await mkdtemp(join(tmpdir(), 'royal-fake-remote-'));
  t.after(() => rm(artifact, { recursive: true, force: true }));
  await writeFile(join(artifact, 'remote-bootstrap.py'), '# synthetic bootstrap');
  const calls = [];
  let port = 34000;
  const outcome = await runRemoteStage({ artifact, freePort: async () => port++, delay: async () => {},
    copyFrom: async () => { throw new Error('fake-no-artifact'); },
    remote: async (code, args = []) => {
      calls.push(args);
      if (args[0] === 'create-test') throw new Error('fake-lost-ssh-reply-after-start');
      if (args[0] === 'stop-test') return JSON.stringify({ testStopped: name, stopConfirmed: true, testState: 'exited' });
      if (code.includes('fixture.unlink')) return JSON.stringify({ fixtureRemoved: true, testState: 'exited' });
      return JSON.stringify({ image: 'same-image', startedAt: 'same-start', healthStatus: 200, healthUrlMatches: true });
    },
  });
  assert(calls.some(args => args[0] === 'stop-test'));
  assert.equal(outcome.testStopConfirmed, true);
  assert.equal(outcome.remotePrivateFixtureCleanupConfirmed, true);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.checks.requiredArtifactsAvailable, false);
});

test('a passed generator cannot hide guard, cleanup, production or evidence failures', () => {
  const standRunId = '12345678-1234-4234-8234-123456789abc';
  const hash = 'c7688ead51e0506e3371c6ce831a34c40c021adb0506750cf80202b3a12767f1';
  assert.notEqual(standRunId, runId);
  const outcome = { standRunId, generatorExitCode: 0, testStopConfirmed: true, remotePrivateFixtureCleanupConfirmed: true,
    productionImageAndStartUnchanged: true, productionAfter: { healthStatus: 200, healthUrlMatches: true } };
  const reports = {
    server: { ok: true, productionTraffic: false, targetClients: 100, measurementSeconds: 120, bundle: { sha256: hash }, stand: { runId: standRunId }, cleanup: { passed: true }, checks: { delivered: true } },
    generator: { ok: true, productionTraffic: false, runId: standRunId, bundleSha256: hash, targetClients: 100, seconds: 120, cleanup: { passed: true },
      attestation: { control: true, gameApi: true, verifiedBeforeGenerators: true }, serverReport: { ok: true } },
    guard: { runId, container: name, reason: 'container-ended', stopped: false, samples: 1, healthChecks: 1 }, guardSamples: [{}],
    supervisor: { runId, container: name, passed: true, reason: 'container-ended', started: true, stopConfirmed: true, guardExitCode: 0, containerExitCode: 0 },
  };
  assert.equal(assessOutcome(outcome, reports).ok, true);
  for (const mutate of [
    (o, r) => { r.guard.reason = 'container-inspection-failed'; },
    (o, r) => { r.supervisor.guardExitCode = 1; },
    (o, r) => { r.guardSamples = []; },
    (o, r) => { r.generator.runId = runId; },
    (o, r) => { r.server.bundle.sha256 = 'wrong-bundle'; },
    o => { o.missingArtifacts = ['remote-100-server.json']; },
    o => { o.testStopUnconfirmed = true; },
    o => { o.remotePrivateFixtureCleanupUnconfirmed = true; },
    o => { o.localPrivateFixtureCleanupUnconfirmed = true; },
    o => { o.tunnelStopUnconfirmed = true; },
    o => { o.productionImageAndStartUnchanged = false; },
    o => { o.productionAfter.healthStatus = 503; },
  ]) {
    const copy = structuredClone(outcome), evidence = structuredClone(reports);
    mutate(copy, evidence);
    assert.equal(assessOutcome(copy, evidence).ok, false);
  }
});

test('prepare stops its own container immediately after guard exits while it is running', () => python(`
class Guard:
 calls=0
 def poll(self):
  self.calls+=1
  return None if self.calls==1 else 1
guard=Guard()
b.create=lambda *args:None
b.start_guard=lambda *args:guard
b.command=lambda *args,**kwargs:''
b.inspect_owned=lambda *args:{'Status':'running','ExitCode':0}
stops=[]
b.stop_owned=lambda name:stops.append(name)
b.terminate_guard=lambda *args:None
try:
 b.prepare()
 raise AssertionError('expected guard failure')
except RuntimeError as error:
 assert str(error)=='host-guard-ended-before-container'
assert stops==['royal-load-'+b.RUN+'-prepare']
`));

test('prepare rejects guard exit one even when the container exits zero and stopped is false', () => python(`
class Guard:
 def poll(self):return None
 def wait(self,timeout):return 1
b.create=lambda *args:None
b.start_guard=lambda *args:Guard()
b.command=lambda *args,**kwargs:''
b.wait_container=lambda *args:{'Status':'exited','ExitCode':0}
b.stop_owned=lambda *args:None
b.terminate_guard=lambda *args:None
(b.ROOT/'run/prepare-guard.json').write_text(json.dumps({'runId':b.RUN,'container':'royal-load-'+b.RUN+'-prepare','reason':'container-inspection-failed','stopped':False,'samples':3,'healthChecks':1}))
try:
 b.prepare()
 raise AssertionError('expected refused guard failure')
except RuntimeError as error:
 assert str(error)=='isolated-preparation-failed'
`));

test('runtime supervisor stops the exact container after guard death and records a failed stage', () => python(`
class Guard:
 pid=123
 calls=0
 def poll(self):
  self.calls+=1
  return None if self.calls==1 else 1
guard=Guard()
b.start_guard=lambda *args:guard
b.command=lambda *args,**kwargs:''
b.inspect_owned=lambda *args:{'Status':'running','ExitCode':0}
stops=[]
b.stop_owned=lambda name:stops.append(name)
b.terminate_guard=lambda *args:None
name='royal-load-'+b.RUN+'-test'
summary=b.supervise_test(name)
assert stops==[name]
assert summary['passed'] is False and summary['stopConfirmed'] is True
assert summary['reason']=='host-guard-ended-before-container'
assert json.loads((b.ROOT/'run/stage-100-supervisor.json').read_text())==summary
`));

test('stop timeout rechecks ownership and refuses to kill a different run', () => python(`
calls=[]
def command(args,**kwargs):
 calls.append(args)
 if args[1]=='stop':raise subprocess.TimeoutExpired(args,10)
 if args[1]=='inspect':
  label=b.RUN if len(calls)==1 else 'another-run'
  return json.dumps(label)+'\\n'+json.dumps('running')+'\\n0\\nfalse'
 raise AssertionError('kill must not be called')
b.command=command
try:
 b.stop_owned('royal-load-'+b.RUN+'-test')
 raise AssertionError('expected label refusal')
except RuntimeError as error:
 assert str(error)=='test-container-label-mismatch'
assert [call[1] for call in calls]==['inspect','stop','inspect']
assert '.Config.Env' not in calls[0][calls[0].index('--format')+1]
`));

import assert from 'node:assert/strict';
import {mkdtemp, readFile, realpath, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {digest, inventory} from '../../../scripts/module-build-cache.mjs';
import {BASE, FEATURE, NAME, SOURCES, NATIVE_ROUND_SOURCES, NATIVE_RESTART_TEST, NATIVE_RESTART_HELPER, planPublication, writePublication} from './prepare.mjs';

const folder = dirname(fileURLToPath(import.meta.url)), root = resolve(folder, '../../..');
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const readJson = bytes => JSON.parse(bytes.toString());
function edit(input, field, change) { const value = readJson(input[field]); change(value); input[field] = encode(value); }
async function fixture() {
  const scopeBytes = await readFile(join(folder, 'scope.json')), scope = readJson(scopeBytes);
  const helpers = {};
  for (const file of ['deploy.py', 'snapshot.py', 'quiesce.cjs']) helpers[file] = await readFile(join(folder, file));
  for (const [file, source] of Object.entries(scope.references)) helpers[file] = await readFile(join(root, source));
  const projectedSources = Object.fromEntries(SOURCES.map(file => [file, Buffer.from('reviewed source: ' + file + '\n')]));
  const catalog = Buffer.from("export const GAMES = [{ gameId: 'royal-coins', slug: 'royal-coins', apiVersion: 1, rulesVersion: 1, progressVersion: 1 }] as const;\n");
  const compatibilitySources = {'src/modules/GameModuleCatalog.ts': catalog,
    'package.json': encode({name: 'royal', type: 'module', dependencies: {pg: '1.2.3'}}), 'package-lock.json': encode({lockfileVersion: 3})};
  const retained = {...compatibilitySources, ...Object.fromEntries(NATIVE_ROUND_SOURCES.map(name => [name, Buffer.from('retained native lifecycle: ' + name + '\n')])), 'server/demoWallet.ts': Buffer.from('retained math engine\n')};
  const source = Object.fromEntries(Object.entries(retained).map(([file, bytes]) => [file, digest(bytes)]));
  for (const name of ['server/accounts.ts', 'server/index.ts', 'src/main.ts', 'src/i18n/en.ts']) source[name] = digest('old source: ' + name);
  const program = {'dist/index.html': digest('old index'), 'dist/assets/retained.js': digest('retained asset'),
    'dist-server/index.js': digest('old backend'), 'dist-server/payments.js': digest('payments'),
    'dist-server/crypto-reconcile.js': digest('reconciliation'), 'dist-server/card-engine': digest('retained binary'),
    'node_modules/pg/index.js': digest('dependency'), 'module-dist/royal-coins/active.json': digest('bundled pointer'),
    'package-lock.json': source['package-lock.json'], 'package.json': digest('runtime package')};
  const service = {id: 'immutable-nile-id', image: 'immutable-nile-image', startedAt: 'unchanged'};
  const gameService = {id: 'old-game-id', image: 'sha256:' + 'a'.repeat(64), startedAt: 'old-game-start'};
  const before = {format: 1, readOnly: true, secretsIncluded: false, playerDataIncluded: false,
    sourceCommit: BASE, source, sourceLF: {...source}, program, preparedProgram: {...program},
    services: {'/royal-nile-play': service, '/royal-game-1': gameService},
    serviceProfiles: {'royal-nile-play': {...service, profileSha256: digest('nile profile')},
      'royal-game-1': {...gameService, profileSha256: digest('game profile')}},
    configHashes: {'.env': digest('private contents are never included')},
    moduleFiles: {'/opt/royal-game-modules/royal-coins/active.json': digest('external pointer')},
    moduleHostContract: digest('installed contract'), moduleHost: {format: 1, games: {'royal-coins': {apiVersion: 1, rulesVersion: 1, progressVersion: 1}}},
    protectedPrograms: {'royal-nile-play': {'play.js': digest('retained Nile'), 'proof.js': digest('retained proof'),
      'dist-server/card-engine': digest('retained Go engine')}}, container: {...gameService, health: 'healthy'}, preparedImage: 'sha256:' + 'b'.repeat(64)};
  const configFiles = {};
  for (const [file, bytes] of Object.entries({...retained, ...projectedSources})) {
    const sha256 = digest(bytes); configFiles[file] = {commit: SOURCES.includes(file) ? FEATURE : BASE, path: file, baseSha256: sha256, sha256};
  }
  const hostConfig = {format: 1, productionCommit: BASE, entries: ['index.html'], changedSources: [...SOURCES], files: configFiles};
  const backendConfig = {...hostConfig, entries: ['server/index.ts']};
  const hostConfigBytes = encode(hostConfig), backendConfigBytes = encode(backendConfig);
  const inputs = Object.fromEntries(Object.entries(configFiles).map(([file, row]) => [file, row.sha256]));
  const report = (kind, bytes) => ({config: 'deployment/releases/' + NAME + '/' + kind + '-projection.json', sha256: digest(bytes),
    productionCommit: BASE, inputs: {...inputs}, origins: structuredClone(configFiles)});
  const artifacts = {'dist/index.html': Buffer.from('<script src="/assets/new-host.js"></script>'),
    'dist/assets/new-host.js': Buffer.from('new reviewed client'), 'dist/assets/retained.js': Buffer.from('retained asset'),
    'dist-server/index.js': Buffer.from('new reviewed backend')};
  const hostProjection = report('host', hostConfigBytes), backendProjection = {...report('backend', backendConfigBytes),
    entries: ['server/index.ts'], graphSha256: digest('verified graph'), output: {path: 'dist-server/index.js', sha256: digest(artifacts['dist-server/index.js'])}};
  const release = {format: 1, clean: true, scope: 'application', sourceCommit: 'c'.repeat(40), sourceTree: 'd'.repeat(40), baseCommit: BASE,
    build: {passed: true, hostProjection, backendProjection}, hostProjection, backendProjection,
    files: {...Object.fromEntries(Object.entries(artifacts).map(([name, bytes]) => [name, digest(bytes)])),
      'dist-server/payments.js': digest('unpublished main build, retained in production'), 'module-dist/new-game/active.json': digest('new module not published')}};
  const restartEvidenceSources = {[NATIVE_RESTART_TEST]: Buffer.from('synthetic restart test fixture'), [NATIVE_RESTART_HELPER]: Buffer.from('synthetic runtime helper fixture')};
  const restart = {format: 1, productionCommit: BASE, featureCommit: FEATURE,
    backendProjection: Object.fromEntries(['config', 'sha256', 'graphSha256', 'output'].map(key => [key, backendProjection[key]])),
    sourceHashes: Object.fromEntries(Object.entries(inputs).filter(([name]) => !SOURCES.includes(name))),
    test: {path: NATIVE_RESTART_TEST, sha256: digest(restartEvidenceSources[NATIVE_RESTART_TEST]), helperPath: NATIVE_RESTART_HELPER,
      helperSha256: digest(restartEvidenceSources[NATIVE_RESTART_HELPER]), passed: true},
    checks: {sameSchemaRestart: true, savedPayloadAndReservePreserved: true, referenceSettlementAndReplayEqual: true, oldSessionsGiveNoXp: true, freshPaidRoundGivesXpOnce: true}};
  return {baselineBytes: encode(before), scopeBytes, releaseBytes: encode(release),
    receiptBytes: encode({format: 1, sourceCommit: release.sourceCommit, remoteMain: release.sourceCommit, checkedAt: '2026-10-31T09:00:00.000Z'}),
    hostConfigBytes, backendConfigBytes, projectedSources, compatibilitySources, artifacts, helpers, restartEvidenceBytes: encode(restart), restartEvidenceSources};
}

test('plans exactly fourteen projected sources and verified tiny runtime deltas', async () => {
  const input = await fixture(), plan = planPublication(input), m = plan.manifest;
  assert.deepEqual(Object.keys(m.changed).sort(), [...SOURCES].sort());
  assert.deepEqual(Object.keys(m.delta).sort(), ['assets/new-host.js', 'index.html']);
  assert.deepEqual(m.serverDelta, {'index.js': digest(input.artifacts['dist-server/index.js'])});
  assert.deepEqual(m.before, readJson(input.baselineBytes));
  for (const file of SOURCES) assert(plan.files['source/' + file].equals(input.projectedSources[file]));
  assert(!Object.keys(plan.files).some(file => file.includes('payments.js') || file.startsWith('node_modules/') || file.startsWith('module-dist/')));
  assert.equal(m.releaseManifestSha256, digest(input.releaseBytes)); assert.equal(m.receiptSha256, digest(input.receiptBytes));
  assert.equal(m.backendProjectionSha256, digest(plan.files['backend-projection-report.json']));
  assert.equal(m.compatibility.hostContractVersionsUnchanged, true);
  assert.equal(m.compatibility.nativeRoundsRestorable, true);
  assert.deepEqual(m.compatibility.nativeRoundSources, readJson(input.restartEvidenceBytes).sourceHashes);
  assert.equal(m.compatibility.nativeRoundCompatibilitySha256, digest(input.restartEvidenceBytes));
  assert(plan.files['native-round-compatibility.json'].equals(input.restartEvidenceBytes));
  for (const [path, bytes] of Object.entries(input.restartEvidenceSources)) assert(plan.files['verification/' + path].equals(bytes));
});

test('rejects wrong baseline, receipt identity, scope and feature origin', async () => {
  for (const [field, modify, message] of [
    ['baselineBytes', value => { value.sourceCommit = 'e'.repeat(40); }, /equal/],
    ['receiptBytes', value => { value.sourceCommit = 'e'.repeat(40); }, /equal/],
    ['scopeBytes', value => { value.requiredSource.pop(); }, /Required source/],
    ['hostConfigBytes', value => { value.changedSources.push('server/demoWallet.ts'); }, /Projection source scope/],
    ['hostConfigBytes', value => { value.files['server/accounts.ts'].commit = BASE; }, /Feature source origin/],
  ]) { const input = await fixture(); edit(input, field, modify); assert.throws(() => planPublication(input), message); }
});

test('rejects missing, extra or stale projected source bytes', async () => {
  const input = await fixture(); delete input.projectedSources[SOURCES[0]];
  assert.throws(() => planPublication(input), /fourteen/);
  const extra = await fixture(); extra.projectedSources['server/demoWallet.ts'] = Buffer.from('altered engine');
  assert.throws(() => planPublication(extra), /fourteen/);
  const stale = await fixture(); stale.projectedSources[SOURCES[0]] = Buffer.from('unqualified replacement');
  assert.throws(() => planPublication(stale), /Projected source bytes differ/);
});

test('rejects unpublished immutable source facts and incomplete graph provenance', async () => {
  const input = await fixture(); edit(input, 'hostConfigBytes', value => { value.files['server/demoWallet.ts'].sha256 = digest('new unqualified math'); });
  assert.throws(() => planPublication(input), /Unrelated projected source/);
  const incomplete = await fixture(); edit(incomplete, 'releaseBytes', value => {
    delete value.backendProjection.origins['server/demoWallet.ts']; delete value.build.backendProjection.origins['server/demoWallet.ts'];
  }); assert.throws(() => planPublication(incomplete), /origins incomplete/);
  const reports = await fixture(); edit(reports, 'releaseBytes', value => { value.build.backendProjection.graphSha256 = '0'.repeat(64); });
  assert.throws(() => planPublication(reports), /projection reports differ/);
});

test('rejects stale output bytes, foreign output paths and immutable URL collisions', async () => {
  const input = await fixture(); input.artifacts['dist-server/index.js'] = Buffer.from('unexpected backend');
  assert.throws(() => planPublication(input), /Official output bytes differ/);
  const foreign = await fixture(); foreign.artifacts['dist/admin.html'] = Buffer.from('admin change');
  edit(foreign, 'releaseBytes', value => { value.files['dist/admin.html'] = digest(foreign.artifacts['dist/admin.html']); });
  assert.throws(() => planPublication(foreign), /Foreign client resource/);
  const collision = await fixture(); edit(collision, 'baselineBytes', value => {
    value.program['dist/assets/new-host.js'] = value.preparedProgram['dist/assets/new-host.js'] = digest('old content at same URL');
  }); assert.throws(() => planPublication(collision), /Immutable client URL collision/);
  const extraBackend = await fixture(); extraBackend.artifacts['dist-server/payments.js'] = Buffer.from('unreviewed payment bundle');
  assert.throws(() => planPublication(extraBackend), /Unexpected captured publication artifact/);
});

test('rejects changed installed module contracts, dependency lock and helper bytes', async () => {
  const contracts = await fixture(); edit(contracts, 'baselineBytes', value => { value.moduleHost.games['royal-coins'].rulesVersion = 2; });
  assert.throws(() => planPublication(contracts), /Host compatibility versions/);
  const lock = await fixture(); lock.compatibilitySources['package-lock.json'] = encode({lockfileVersion: 3, packages: {changed: true}});
  assert.throws(() => planPublication(lock), /Dependency lock/);
  const helper = await fixture(); helper.helpers['overlay-base.py'] = Buffer.from('unreviewed installer');
  assert.throws(() => planPublication(helper), /Reviewed overlay engine/);
  const references = await fixture(); edit(references, 'scopeBytes', value => { value.references['overlay-base.py'] = 'deployment/other.py'; });
  assert.throws(() => planPublication(references), /helper references/);
});

test('rejects incomplete service profiles and unsafe protected program facts', async () => {
  const profiles = await fixture(); edit(profiles, 'baselineBytes', value => { value.serviceProfiles['royal-nile-play'].id = 'changed-id'; });
  assert.throws(() => planPublication(profiles), /Service profile identity/);
  const unsafe = await fixture(); edit(unsafe, 'baselineBytes', value => { value.protectedPrograms['royal-nile-play']['.env'] = digest('forbidden'); });
  assert.throws(() => planPublication(unsafe), /Unsafe payload path/);
  const secret = await fixture(); edit(secret, 'baselineBytes', value => { value.secretsIncluded = true; });
  assert.throws(() => planPublication(secret), /equal/);
});

test('writes one exact package and never replaces an existing package', async t => {
  const temp = await realpath(await mkdtemp(join(tmpdir(), 'royal-levels-prepare-'))); t.after(() => rm(temp, {recursive: true, force: true}));
  const plan = planPublication(await fixture()), out = join(temp, 'publication'), result = await writePublication(plan, out);
  assert.equal(result.sourceFiles, 14); assert.equal(result.backendFiles, 1);
  assert.deepEqual(await inventory(out), Object.fromEntries(Object.entries(plan.files).map(([file, bytes]) => [file, digest(bytes)])));
  const marker = join(out, 'review-marker.txt'); await writeFile(marker, 'preserve existing package');
  await assert.rejects(writePublication(plan, out), {code: 'EEXIST'});
  assert.equal((await readFile(marker)).toString(), 'preserve existing package');
});

test('rejects unsafe destination parents and payload traversal before writing', async t => {
  const temp = await realpath(await mkdtemp(join(tmpdir(), 'royal-levels-unsafe-'))); t.after(() => rm(temp, {recursive: true, force: true}));
  const plan = planPublication(await fixture()); await symlink(temp, join(temp, 'linked'));
  await assert.rejects(writePublication(plan, join(temp, 'linked', 'publication')), /parent symlink/);
  plan.files['../outside'] = Buffer.from('escape');
  await assert.rejects(writePublication(plan, join(temp, 'publication')), /Unsafe payload path/);
});


test('requires complete native restart provenance, unchanged graph closure and successful bound evidence', async () => {
  for (const [change, message] of [
    [r => { r.productionCommit = 'e'.repeat(40); }, /equal/],
    [r => { r.featureCommit = 'e'.repeat(40); }, /equal/],
    [r => { r.backendProjection.output.sha256 = '0'.repeat(64); }, /Native restart backend/],
    [r => { delete r.sourceHashes['server/demoWallet.ts']; }, /Native restart source inventory/],
    [r => { r.sourceHashes['server/demoWallet.ts'] = '0'.repeat(64); }, /Native restart source inventory/],
    [r => { r.checks.oldSessionsGiveNoXp = false; }, /checks did not pass/],
    [r => { delete r.checks.savedPayloadAndReservePreserved; }, /checks incomplete/],
    [r => { r.test.passed = false; }, /test did not pass/],
    [r => { r.test.sha256 = '0'.repeat(64); }, /test bytes differ/],
    [r => { r.test.helperPath = '../foreign.mjs'; }, /equal/],
  ]) {
    const input = await fixture(); edit(input, 'restartEvidenceBytes', change);
    assert.throws(() => planPublication(input), message);
  }
  const missing = await fixture(); delete missing.restartEvidenceBytes;
  assert.throws(() => planPublication(missing), /Missing native restart evidence/);
  const bytes = await fixture(); bytes.restartEvidenceSources[NATIVE_RESTART_HELPER] = Buffer.from('changed test helper');
  assert.throws(() => planPublication(bytes), /helper bytes differ/);
  const extra = await fixture(); extra.restartEvidenceSources['unrelated-source.ts'] = Buffer.from('foreign evidence');
  assert.throws(() => planPublication(extra), /Unexpected restart verification source/);
});

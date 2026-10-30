import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {lstat, mkdir, readFile, rm, statfs, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {digest, inventory, regularPath} from '../../../scripts/module-build-cache.mjs';
import {readHostProjection} from '../../../scripts/build-host-projection.mjs';
import {assertClean, git, verifyRelease} from '../../../scripts/release.mjs';

export const NAME = 'location-rewards-20261031-v2';
export const BASE = '38ce8d04adbc70cf2a7e80cf017663463dd68b2a';
export const FEATURE = '5120fa89698356a3deb9ee5788f45cd570a18154';
const FOLDER = 'deployment/releases/' + NAME;
export const SOURCES = [
  "server/accounts.ts",
  "server/progression/store.ts",
  "server/progression/freeSpins.ts",
  "server/progression/handlers.ts",
  "server/progression/skinGenerations.ts",
  "server/skinStudio.ts",
  "src/shared/progression.ts",
  "src/shared/skinStudio.ts",
  "src/ui/ProgressionUI.ts",
  "src/ui/SkinStudioUI.ts",
  "src/i18n/progressionEn.ts"
];
export const NATIVE_RESTART_TEST = FOLDER + '/test_native_rounds.ts';
export const NATIVE_RESTART_HELPER = FOLDER + '/projected-runtime.mjs';
export const NATIVE_RESTART_REPORT = FOLDER + '/native-round-compatibility.json';
export const NATIVE_ROUND_SOURCES = [
  'server/database.ts', 'server/database-migrations.ts', 'server/game-database-migrations.ts',
  'server/demoWallet.ts', 'server/demoWalletAmounts.ts', 'server/providerPending.ts',
  'server/demoCasino.ts', 'server/demoMines.ts', 'server/demoFlight.ts', 'server/demoExpansion.ts',
  'server/games/core.ts', 'server/games/casinoSessions.ts', 'server/games/cardEngine.ts', 'server/games/rush/crash.ts',
  'src/shared/gameCore.ts', 'src/shared/demoWallet.ts', 'src/shared/casinoSessions.ts',
  'src/shared/casinoExpansion.ts', 'src/shared/originalGames.ts', 'src/shared/flightGame.ts',
];
const NATIVE_RESTART_CHECKS = ['sameSchemaRestart', 'savedPayloadAndReservePreserved',
  'referenceSettlementAndReplayEqual', 'oldSessionsGiveNoXp', 'freshPaidRoundGivesXpOnce'];
const REFERENCES = {
  'overlay-base.py': 'deployment/releases/cat-purr-hall-only-20261030-v1/deploy.py',
  'financial_gate.py': 'deployment/releases/cat-purr-hall-only-20261030-v1/financial_gate.py',
  'quiesce-base.cjs': 'deployment/releases/cat-purr-hall-only-20261030-v1/quiesce.cjs',
  'runtime-inventory.cjs': 'deployment/releases/cat-purr-hall-only-20261030-v1/runtime-inventory.cjs',
};
const SUPPORT = [...Object.keys(REFERENCES), 'quiesce.cjs'];
const BASE_HELPER = 'f53c960aabf24983d549def3155da240ca253284bb5451063fe8fbbc90cd5fe2';
const RESOLUTION_FIELDS = ['name', 'type', 'main', 'module', 'exports', 'imports', 'browser', 'sideEffects',
  'dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'overrides', 'engines'];
const COMMIT = /^[a-f0-9]{40}$/, HASH = /^[a-f0-9]{64}$/;
const keys = value => Object.keys(value).sort();
const json = bytes => JSON.parse(bytes.toString('utf8'));
const encoded = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
function safe(name) {
  assert(typeof name === 'string' && !name.startsWith('/') && !name.includes('\\')
    && !name.split('/').some(part => !part || part === '.' || part === '..'
      || part.startsWith('.env') || ['.git', 'node_modules', 'secrets', '.ssh', 'data'].includes(part)), 'Unsafe payload path: ' + name);
}
function hashMap(value, label, {paths = false} = {}) {
  assert(value && typeof value === 'object' && !Array.isArray(value) && keys(value).length, 'Missing ' + label);
  for (const [name, hash] of Object.entries(value)) { if (paths) safe(name); assert.match(hash, HASH, 'Invalid ' + label + ' hash'); }
}
function sameKeys(actual, expected, label) { assert.deepEqual(keys(actual), [...expected].sort(), label); }
function catalogContracts(bytes) {
  const games = {}, pattern = /\{\s*gameId:\s*'([^']+)'\s*,\s*slug:\s*'[^']+'\s*,\s*apiVersion:\s*(\d+)\s*,\s*rulesVersion:\s*(\d+)\s*,\s*progressVersion:\s*(\d+)\s*\}/g;
  for (const match of bytes.toString('utf8').matchAll(pattern)) {
    assert(!games[match[1]], 'Duplicate projected module identity');
    games[match[1]] = {apiVersion: +match[2], rulesVersion: +match[3], progressVersion: +match[4]};
  }
  assert(keys(games).length, 'Projected catalog contracts could not be read');
  return games;
}

/** Validate captured, verified bytes before creating any publication directory. */
export function planPublication(input) {
  const {baselineBytes, scopeBytes, releaseBytes, receiptBytes, hostConfigBytes, backendConfigBytes,
    projectedSources, compatibilitySources, artifacts, helpers, restartEvidenceBytes, restartEvidenceSources} = input;
  const before = json(baselineBytes), scope = json(scopeBytes), release = json(releaseBytes), receipt = json(receiptBytes);
  const configs = {host: json(hostConfigBytes), backend: json(backendConfigBytes)};
  assert.equal(scope.release, NAME); assert.equal(scope.base, BASE); assert.equal(before.sourceCommit, BASE);
  assert.equal(before.format, 1); assert.equal(before.readOnly, true);
  assert.equal(before.secretsIncluded, false); assert.equal(before.playerDataIncluded, false);
  for (const field of ['source', 'sourceLF', 'program', 'preparedProgram', 'configHashes', 'moduleFiles']) hashMap(before[field], 'baseline ' + field);
  assert.deepEqual(before.program, before.preparedProgram, 'Running and prepared runtime inventories differ');
  assert.equal(before.container?.health, 'healthy'); assert.match(before.container?.image ?? '', /^sha256:[a-f0-9]{64}$/);
  assert.match(before.preparedImage ?? '', /^sha256:[a-f0-9]{64}$/); assert.match(before.moduleHostContract ?? '', HASH);
  assert(before.services && before.serviceProfiles && keys(before.services).length === keys(before.serviceProfiles).length, 'Incomplete persistent services');
  for (const [name, row] of Object.entries(before.serviceProfiles)) {
    assert.match(row.profileSha256, HASH); assert.deepEqual(before.services['/' + name], {id: row.id, image: row.image, startedAt: row.startedAt}, 'Service profile identity differs');
  }
  for (const [service, names] of Object.entries(scope.requiredProtectedPrograms ?? {})) {
    assert(before.services['/' + service] && service !== 'royal-game-1' && names.length, 'Missing protected service identity');
    const protectedFiles = before.protectedPrograms?.[service]; hashMap(protectedFiles, 'protected programs', {paths: true});
    assert(names.every(name => Object.hasOwn(protectedFiles, name)), 'Missing protected program facts');
    assert(keys(protectedFiles).every(name => /^(?:(?:play|proof)\.(?:js|cjs)|(?:dist-server\/)?card-engine(?:-v1)?)$/.test(name)), 'Unexpected protected program path');
  }
  assert.deepEqual(scope.requiredProtectedPrograms, {'royal-nile-play': ['play.js', 'proof.js']});
  assert.deepEqual([...scope.requiredSource].sort(), [...SOURCES].sort(), 'Required source scope changed');
  assert(SOURCES.every(name => scope.allowedSource.includes(name)), 'Required source outside reviewed allowlist');
  assert.deepEqual(scope.references, REFERENCES, 'Reviewed helper references changed');
  assert.equal(release.format, 1); assert.equal(release.scope, 'application'); assert.equal(release.build?.passed, true);
  assert.equal(release.clean, true); assert.equal(release.baseCommit, BASE); assert.match(release.sourceCommit, COMMIT);
  assert.match(release.sourceTree, COMMIT); assert.equal(receipt.format, 1); assert.equal(receipt.sourceCommit, release.sourceCommit);
  assert.match(receipt.remoteMain, COMMIT); assert(Number.isFinite(Date.parse(receipt.checkedAt)), 'Invalid GitHub verification time');
  hashMap(release.files, 'official output', {paths: true});
  for (const name of keys(release.files)) assert(/^(?:dist|dist-server|module-dist)\//.test(name), 'Foreign official output');
  sameKeys(projectedSources, SOURCES, 'Only the reviewed reviewed sources may be copied');
  const changed = Object.fromEntries(SOURCES.map(name => [name, digest(projectedSources[name])]));
  const graphInputs = new Set();
  for (const [kind, config] of Object.entries(configs)) {
    assert.equal(config.format, 1); assert.equal(config.productionCommit, BASE);
    assert.deepEqual(config.entries, kind === 'host' ? ['index.html'] : ['server/index.ts']);
    assert.deepEqual([...config.changedSources].sort(), [...SOURCES].sort(), 'Projection source scope changed');
    assert(config.files && keys(config.files).length, 'Missing projection configuration');
    for (const [name, origin] of Object.entries(config.files)) {
      safe(name); safe(origin.path); assert.match(origin.commit, COMMIT); assert.match(origin.sha256, HASH); assert.match(origin.baseSha256, HASH);
      if (Object.hasOwn(changed, name)) {
        assert.equal(origin.commit, FEATURE, 'Feature source origin changed: ' + name); assert.equal(origin.path, name);
        assert(!origin.patches?.length, 'Unexpected feature source patch'); assert.equal(origin.baseSha256, origin.sha256);
        assert.equal(origin.sha256, changed[name], 'Projected source bytes differ: ' + name);
      } else assert([before.source[name], before.sourceLF[name]].includes(origin.sha256), 'Unrelated projected source changed: ' + name);
    }
    const report = release[kind + 'Projection']; assert(report, 'Missing official ' + kind + ' projection');
    assert.deepEqual(report, release.build[kind + 'Projection'], 'Official projection reports differ');
    assert.equal(report.config, FOLDER + '/' + kind + '-projection.json'); assert.equal(report.productionCommit, BASE);
    assert.equal(report.sha256, digest(kind === 'host' ? hostConfigBytes : backendConfigBytes), 'Projection configuration hash differs');
    hashMap(report.inputs, kind + ' graph inputs', {paths: true}); sameKeys(report.origins, keys(report.inputs), 'Projection origins incomplete');
    for (const [name, hash] of Object.entries(report.inputs)) {
      assert.equal(config.files[name]?.sha256, hash, 'Unreviewed projection graph input: ' + name);
      assert.deepEqual(report.origins[name], config.files[name], 'Projection graph origin differs: ' + name); graphInputs.add(name);
    }
  }
  assert.deepEqual(configs.host.files, configs.backend.files, 'Host and backend source selections differ');
  assert(SOURCES.every(name => graphInputs.has(name)), 'A required source is not used by either verified graph');
  const backend = release.backendProjection;
  assert.deepEqual(backend.entries, ['server/index.ts']); assert.match(backend.graphSha256, HASH);
  assert.equal(backend.output?.path, 'dist-server/index.js'); assert.equal(backend.output.sha256, release.files['dist-server/index.js']);
  assert(Buffer.isBuffer(restartEvidenceBytes), 'Missing native restart evidence');
  const restart = json(restartEvidenceBytes);
  assert.equal(restart.format, 1); assert.equal(restart.productionCommit, BASE); assert.equal(restart.featureCommit, FEATURE);
  assert.deepEqual(restart.backendProjection, Object.fromEntries(['config', 'sha256', 'graphSha256', 'output'].map(key => [key, backend[key]])), 'Native restart backend differs');
  const nativeRoundSources = Object.fromEntries(Object.entries(backend.inputs).filter(([name]) => !Object.hasOwn(changed, name)));
  assert.deepEqual(restart.sourceHashes, nativeRoundSources, 'Native restart source inventory differs');
  assert(NATIVE_ROUND_SOURCES.every(name => Object.hasOwn(nativeRoundSources, name)), 'Native restart lifecycle source missing');
  for (const [name, hash] of Object.entries(nativeRoundSources)) assert([before.source[name], before.sourceLF[name]].includes(hash), 'Native restart engine differs: ' + name);
  sameKeys(restart.checks, NATIVE_RESTART_CHECKS, 'Native restart checks incomplete');
  assert(Object.values(restart.checks).every(value => value === true), 'Native restart checks did not pass');
  assert.equal(restart.test?.passed, true, 'Native restart test did not pass');
  assert.equal(restart.test.path, NATIVE_RESTART_TEST); assert.equal(restart.test.helperPath, NATIVE_RESTART_HELPER);
  sameKeys(restartEvidenceSources, [NATIVE_RESTART_TEST, NATIVE_RESTART_HELPER], 'Unexpected restart verification source');
  assert.equal(digest(restartEvidenceSources[NATIVE_RESTART_TEST]), restart.test.sha256, 'Native restart test bytes differ');
  assert.equal(digest(restartEvidenceSources[NATIVE_RESTART_HELPER]), restart.test.helperSha256, 'Native restart helper bytes differ');
  const requiredArtifacts = keys(release.files).filter(name => name.startsWith('dist/') || name === 'dist-server/index.js');
  sameKeys(artifacts, requiredArtifacts, 'Unexpected captured publication artifact');
  const delta = {}, files = {};
  for (const name of requiredArtifacts) {
    const bytes = artifacts[name], hash = digest(bytes); assert.equal(hash, release.files[name], 'Official output bytes differ: ' + name);
    if (name === 'dist-server/index.js') { files['server-delta/index.js'] = bytes; continue; }
    const sub = name.slice(5); assert(sub === 'index.html' || /^assets\/[a-zA-Z0-9_-]+\.(?:js|css)$/.test(sub), 'Foreign client resource: ' + name);
    if (before.program[name] === hash) continue;
    assert(sub === 'index.html' || !Object.hasOwn(before.program, name), 'Immutable client URL collision: ' + name);
    delta[sub] = hash; files['dist-delta/' + sub] = bytes;
  }
  assert(delta['index.html'], 'Missing changed client index');
  assert.notEqual(backend.output.sha256, before.program['dist-server/index.js'], 'Backend did not change');
  sameKeys(compatibilitySources, ['package.json', 'package-lock.json', 'src/modules/GameModuleCatalog.ts'], 'Unexpected compatibility input');
  const catalogName = 'src/modules/GameModuleCatalog.ts', catalogHash = digest(compatibilitySources[catalogName]);
  assert.equal(release.hostProjection.inputs[catalogName], catalogHash, 'Catalog is not bound to the verified client');
  assert.deepEqual(catalogContracts(compatibilitySources[catalogName]), before.moduleHost?.games, 'Host compatibility versions changed');
  const packageHash = digest(compatibilitySources['package.json']);
  assert.equal(backend.inputs['package.json'], packageHash, 'Dependency package is not bound to the backend');
  const lockHash = digest(compatibilitySources['package-lock.json']);
  assert([before.source['package-lock.json'], before.sourceLF['package-lock.json']].includes(lockHash)
    && before.program['package-lock.json'] === before.source['package-lock.json'], 'Dependency lock differs from installed runtime');
  sameKeys(helpers, ['deploy.py', 'snapshot.py', ...SUPPORT], 'Unexpected installer helper inventory');
  assert.equal(digest(helpers['overlay-base.py']), BASE_HELPER, 'Reviewed overlay engine changed');
  for (const name of SOURCES) files['source/' + name] = projectedSources[name];
  files['native-round-compatibility.json'] = restartEvidenceBytes;
  for (const [name, bytes] of Object.entries(restartEvidenceSources)) files['verification/' + name] = bytes;
  Object.assign(files, helpers, {'scope.json': scopeBytes, 'release-manifest.json': releaseBytes, 'release-github.json': receiptBytes,
    'backend-projection.json': backendConfigBytes, 'backend-projection-report.json': encoded(backend),
    'host-projection.json': hostConfigBytes, 'host-projection-report.json': encoded(release.hostProjection)});
  const manifest = {release: NAME, sourceCommit: release.sourceCommit, baseCommit: BASE, before, changed, delta,
    serverDelta: {'index.js': backend.output.sha256}, helperSha256: digest(helpers['deploy.py']), snapshotSha256: digest(helpers['snapshot.py']),
    scopeSha256: digest(scopeBytes), helpers: Object.fromEntries(SUPPORT.map(name => [name, digest(helpers[name])])),
    releaseManifestSha256: digest(releaseBytes), receiptSha256: digest(receiptBytes), backendProjectionSha256: digest(files['backend-projection-report.json']),
    compatibility: {nativeRoundsRestorable: true, nativeRoundSources, nativeRoundCompatibilitySha256: digest(restartEvidenceBytes), hostContractVersionsUnchanged: true, bundledAndExternalModulesRetained: true, dependencyLockEquivalent: true,
      installedContractSha256: before.moduleHostContract, projectedCatalogSha256: catalogHash,
      projectedPackageSha256: packageHash, installedLockSha256: lockHash,
      hostProjectionSha256: digest(files['host-projection-report.json']), featureSourceCommit: FEATURE,
      sourceFactsRetained: keys(before.source).length, runtimeFilesRetained: keys(before.program).length - 2,
      externalModuleFilesRetained: keys(before.moduleFiles).length}};
  files['install-manifest.json'] = encoded(manifest);
  return {manifest, files, bytes: Object.values(files).reduce((sum, bytes) => sum + bytes.length, 0)};
}

/** Create only a new task-owned package, without replacing or cleaning another package. */
export async function writePublication(plan, out) {
  for (const [name, bytes] of Object.entries(plan.files)) { safe(name); assert(Buffer.isBuffer(bytes), 'Package bytes must be captured'); }
  let folder = dirname(out);
  while (folder !== dirname(folder)) { assert(!(await lstat(folder)).isSymbolicLink(), 'Publication parent symlink rejected'); folder = dirname(folder); }
  const disk = await statfs(dirname(out));
  assert(disk.bavail * disk.bsize - plan.bytes >= 10 * 1024 ** 3, 'Ten GiB local disk reserve would be crossed');
  await mkdir(out, {mode: 0o700});
  try {
    for (const [name, bytes] of Object.entries(plan.files)) {
      const file = resolve(out, name); await mkdir(dirname(file), {recursive: true}); await writeFile(file, bytes, {flag: 'wx', mode: 0o600});
    }
    assert.deepEqual(await inventory(out), Object.fromEntries(Object.entries(plan.files).map(([name, bytes]) => [name, digest(bytes)])), 'Written package inventory differs');
  } catch (error) {
    await rm(out, {recursive: true}); // Only the directory created by this invocation is removed.
    throw error;
  }
  return {sourceCommit: plan.manifest.sourceCommit, sourceFiles: keys(plan.manifest.changed).length,
    clientFiles: keys(plan.manifest.delta).length, backendFiles: 1, packageBytes: plan.bytes, directory: out};
}

export async function preparePublication(root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')) {
  const work = resolve(root, 'artifacts/work/location-rewards-v2'), out = resolve(work, 'publication');
  const release = await verifyRelease(root);
  const committed = async name => {
    const bytes = await readFile(await regularPath(root, name));
    const saved = execFileSync(process.env.ROYAL_GIT_BINARY || 'git', ['show', 'HEAD:' + name], {cwd: root, maxBuffer: 32 * 1024 ** 2});
    assert(bytes.equals(saved), 'Preparation helper or configuration is not committed: ' + name); return bytes;
  };
  const releaseBytes = await readFile(await regularPath(root, 'module-build/release-manifest.json'));
  assert.deepEqual(json(releaseBytes), release, 'Official release manifest changed during preparation');
  const receiptBytes = await readFile(await regularPath(root, 'module-build/release-github.json')), receipt = json(receiptBytes);
  assert.equal(receipt.remoteMain, git(root, ['rev-parse', 'origin/main']), 'GitHub verification receipt is stale');
  git(root, ['merge-base', '--is-ancestor', release.sourceCommit, receipt.remoteMain]);
  for (const commit of [BASE, FEATURE]) git(root, ['merge-base', '--is-ancestor', commit, release.sourceCommit]);
  const scopeBytes = await committed(FOLDER + '/scope.json'), scope = json(scopeBytes);
  const hostConfigBytes = await committed(FOLDER + '/host-projection.json'), backendConfigBytes = await committed(FOLDER + '/backend-projection.json');
  const host = await readHostProjection(root, FOLDER + '/host-projection.json', {strictOrigins: true});
  const backend = await readHostProjection(root, FOLDER + '/backend-projection.json', {strictOrigins: true});
  const projectedSources = Object.fromEntries(SOURCES.map(name => {
    const bytes = backend.read(name); assert(bytes.equals(host.read(name)), 'Source projection bytes differ'); return [name, bytes];
  }));
  const compatibilitySources = {'package.json': backend.read('package.json'), 'src/modules/GameModuleCatalog.ts': host.read('src/modules/GameModuleCatalog.ts'),
    'package-lock.json': await readFile(await regularPath(root, 'package-lock.json'))};
  const currentPackage = json(await readFile(await regularPath(root, 'package.json'))), projectedPackage = json(compatibilitySources['package.json']);
  for (const field of RESOLUTION_FIELDS) assert.deepEqual(currentPackage[field], projectedPackage[field], 'Dependency resolution field differs: ' + field);
  const artifacts = {};
  for (const name of keys(release.files).filter(name => name.startsWith('dist/') || name === 'dist-server/index.js')) artifacts[name] = await readFile(await regularPath(root, name));
  const helpers = {};
  for (const name of ['deploy.py', 'snapshot.py', 'quiesce.cjs']) helpers[name] = await committed(FOLDER + '/' + name);
  assert.deepEqual(scope.references, REFERENCES, 'Reviewed helper references changed');
  for (const [name, source] of Object.entries(REFERENCES)) helpers[name] = await committed(source);
  const baselineBytes = await readFile(await regularPath(root, 'artifacts/work/location-rewards-v2/baseline.json'));
  const restartEvidenceBytes = await committed(NATIVE_RESTART_REPORT), restart = json(restartEvidenceBytes);
  assert.equal(restart.test?.path, NATIVE_RESTART_TEST); assert.equal(restart.test?.helperPath, NATIVE_RESTART_HELPER);
  const restartEvidenceSources = {[NATIVE_RESTART_TEST]: await committed(NATIVE_RESTART_TEST), [NATIVE_RESTART_HELPER]: await committed(NATIVE_RESTART_HELPER)};
  const plan = planPublication({baselineBytes, scopeBytes, releaseBytes, receiptBytes, hostConfigBytes, backendConfigBytes,
    projectedSources, compatibilitySources, artifacts, helpers, restartEvidenceBytes, restartEvidenceSources});
  assertClean(root); assert.equal(git(root, ['rev-parse', 'HEAD']), release.sourceCommit, 'Source commit changed during preparation');
  assert.equal(git(root, ['rev-parse', 'HEAD^{tree}']), release.sourceTree);
  assert.equal(git(root, ['rev-parse', 'origin/main']), receipt.remoteMain, 'GitHub baseline changed during preparation');
  return writePublication(plan, out);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  assert.equal(process.argv.length, 2, 'This scoped preparer accepts no options');
  console.log(JSON.stringify(await preparePublication()));
}

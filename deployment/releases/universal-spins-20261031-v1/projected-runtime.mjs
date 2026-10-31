import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {createRequire, isBuiltin} from 'node:module';
import {dirname, posix, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {digest, inventory} from '../../../scripts/module-build-cache.mjs';
import {projectHostSource} from '../../../scripts/build-host-projection.mjs';
import {BASE, FEATURE, SOURCES, SOURCE_PATCHES} from './prepare.mjs';

const folder = dirname(fileURLToPath(import.meta.url));
const root = resolve(folder, '../../..');
const configPath = 'deployment/releases/universal-spins-20261031-v1/backend-projection.json';
const parse = bytes => JSON.parse(bytes.toString());
const canonical = bytes => Buffer.from(bytes.toString().replace(/\r\n/g, '\n'));

/** Load the reviewed Git inputs in memory, without importing today's unprojected engines. */
export async function projectedRuntime() {
  const before = parse(await readFile(resolve(root, 'artifacts/work/universal-spins/baseline.json')));
  const configBytes = await readFile(resolve(root, configPath)), config = parse(configBytes);
  const manifest = parse(await readFile(resolve(root, 'module-build/release-manifest.json')));
  const report = manifest.backendProjection;
  assert.equal(before.sourceCommit, BASE); assert.equal(config.productionCommit, BASE);
  assert.equal(config.format, 1); assert.equal(report.productionCommit, BASE); assert.equal(report.config, configPath);
  assert.equal(report.sha256, digest(configBytes)); assert.deepEqual(report, manifest.build.backendProjection);
  assert.deepEqual(config.changedSources.toSorted(), SOURCES.toSorted());
  assert.equal(report.output.path, 'dist-server/index.js'); assert.equal(report.output.sha256, manifest.files[report.output.path]);
  assert.equal(digest(await readFile(resolve(root, report.output.path))), report.output.sha256, 'Verified backend bytes changed');
  const sourceHashes = {};
  for (const [name, hash] of Object.entries(report.inputs)) {
    assert.equal(config.files[name]?.sha256, hash); assert.deepEqual(config.files[name], report.origins[name]);
    if (!SOURCES.includes(name)) {
      assert([before.source[name], before.sourceLF[name]].includes(hash), 'Unchanged backend source differs from B1: ' + name);
      sourceHashes[name] = hash;
    }
  }
  assert.deepEqual(Object.keys(report.inputs).sort(), Object.keys(report.origins).sort());
  const nativeProgramSources = {};
  for (const directory of ['server/card-engine', 'server/card-engine-v1']) {
    const actual = await inventory(resolve(root, directory));
    const expected = Object.fromEntries(Object.entries(before.source).filter(([name]) => name.startsWith(directory + '/')));
    assert.deepEqual(Object.keys(actual).map(name => directory + '/' + name).sort(), Object.keys(expected).sort(), 'Native card source inventory differs');
    for (const [name, hash] of Object.entries(actual)) {
      const path = directory + '/' + name; assert.equal(hash, expected[path], 'Native card source differs from B1: ' + path); nativeProgramSources[path] = hash;
    }
  }
  const captured = new Map(), imported = {};
  function read(name) {
    const row = config.files[name]; assert(row, 'Unreviewed fixture import: ' + name);
    if (!captured.has(name)) {
      if (SOURCES.includes(name)) {
        assert.equal(row.commit, FEATURE); assert.equal(row.path, name); if(row.patches?.length)assert.deepEqual(row.patches,SOURCE_PATCHES[name]);
      } else assert([before.source[name], before.sourceLF[name]].includes(row.sha256), 'Fixture input differs from B1: ' + name);
      const bytes = projectHostSource(row, execFileSync(process.env.ROYAL_GIT_BINARY || 'git', ['show', row.commit + ':' + row.path],
        {cwd: root, maxBuffer: 32 * 1024 ** 2}));
      if (!SOURCES.includes(name)) assert.equal(digest(bytes), before.sourceLF[name] ?? before.source[name]);
      captured.set(name, bytes); imported[name] = digest(bytes);
    }
    return captured.get(name);
  }
  const entry = `
    export {PostgresDatabase} from './server/database.ts';
    export {DemoWalletStore} from './server/demoWallet.ts';
    export {DemoExpansionStore, expansionMax} from './server/demoExpansion.ts';
    export {ProgressionStore} from './server/progression/store.ts';
    export {instrumentProgressionWallet} from './server/progression/sources.ts';
    export {demoBalanceUnits,demoReservedUnits,saveDemoUnits,recordDemoUnits} from './server/demoWalletAmounts.ts';
    export {cardEngine} from './server/games/cardEngine.ts';
    export {startStudioGame} from './server/games/studioGames.ts';
    export {startVariant} from './server/games/casinoVariants.ts';
    export {startDracona} from './server/games/dracona.ts';
    export {startCaribbean} from './server/games/caribbeanTreasures.ts';
    export {caribbeanInitialCost} from './src/shared/caribbeanTreasures.ts';
    export {STUDIO_DEFAULTS} from './src/shared/studioGames.ts';
    export {VARIANT_DEFAULTS} from './src/shared/casinoVariants.ts';
    export {expansionRulesVersion} from './src/shared/casinoExpansion.ts';
  `;
  const plugin = {name: 'exact-production-round-fixture', setup(builder) {
    builder.onResolve({filter: /.*/}, args => {
      if (isBuiltin(args.path)) return {path: args.path, external: true};
      if (args.path === 'pg') {
        assert(parse(read('package.json')).dependencies.pg, 'Unreviewed PostgreSQL dependency');
        return {path: args.path, external: true};
      }
      assert(args.path.startsWith('.'), 'Unexpected external fixture import: ' + args.path);
      const name = posix.normalize(posix.join(args.namespace === 'reviewed' ? posix.dirname(args.importer) : '.', args.path));
      assert(!name.startsWith('../') && !name.startsWith('/'), 'Unsafe fixture import');
      const candidates = [name, ...(/\.[cm]?jsx?$/.test(name) ? [name.replace(/\.[cm]?jsx?$/, '.ts'), name.replace(/\.[cm]?jsx?$/, '.tsx')] : []),
        ...['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json'].map(suffix => name + suffix), name + '/index.ts', name + '/index.js'];
      const selected = candidates.find(candidate => config.files[candidate]);
      assert(selected, 'Fixture input not in reviewed projection: ' + name); return {path: selected, namespace: 'reviewed'};
    });
    builder.onLoad({filter: /.*/, namespace: 'reviewed'}, args => ({contents: read(args.path),
      loader: args.path.endsWith('.json') ? 'json' : args.path.endsWith('.tsx') ? 'tsx' : args.path.endsWith('.ts') ? 'ts' : 'js'}));
  }};
  const result = await build({stdin: {contents: entry, sourcefile: 'projected-progression-entry.ts', resolveDir: root},
    bundle: true, platform: 'node', format: 'cjs', write: false, plugins: [plugin], logLevel: 'silent'});
  assert.equal(result.outputFiles.length, 1);
  const module = {exports: {}};
  new Function('module', 'exports', 'require', result.outputFiles[0].text)(module, module.exports, createRequire(resolve(root, 'package.json')));
  assert(Object.keys(imported).length > 100, 'Fixture did not load the complete native runtime');
  for (const name of ['server/demoWallet.ts', 'server/demoExpansion.ts', 'server/demoMines.ts', 'server/demoFlight.ts', 'server/demoCasino.ts'])
    assert.equal(imported[name], before.sourceLF[name], 'Native engine source is not retained: ' + name);
  return {api: module.exports, imported, sourceHashes, nativeProgramSources, backendProjection: {
    config: report.config, sha256: report.sha256, graphSha256: report.graphSha256, output: report.output,
  }, canonical};
}

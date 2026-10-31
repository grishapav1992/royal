import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, statfs } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildApplication, projectRoot, saveJson, run } from './build-application.mjs';
import { digest, inventory, regularPath } from './module-build-cache.mjs';
import {verifyModuleProjection} from './module-source-projection.mjs';
import { verifyHostProjection, verifyBackendProjection } from './build-host-projection.mjs';

const defaultManifest = 'module-build/release-manifest.json';
export function git(root, args) {
  return execFileSync(process.env.ROYAL_GIT_BINARY || 'git', args, { cwd: root, encoding: 'utf8' }).trim();
}
export function assertClean(root) {
  if (git(root, ['status', '--porcelain', '--untracked-files=normal'])) {
    throw Error('Release requires committed sources in a clean checkout. Preserve other work and use an isolated worktree.');
  }
}
export function releasePlan(root, base) {
  if (!base) throw Error('Specify --base <production-source-commit>; origin/main is not a production release marker.');
  const commit = git(root, ['rev-parse', 'HEAD']);
  const baseCommit = git(root, ['rev-parse', '--verify', base + '^{commit}']);
  git(root, ['merge-base', '--is-ancestor', baseCommit, commit]);
  const changed = git(root, ['diff', '--name-only', '-z', '--no-renames', baseCommit, commit]).split('\0').filter(Boolean);
  return { format: 1, sourceCommit: commit, sourceTree: git(root, ['rev-parse', 'HEAD^{tree}']), baseCommit,
    changed, clean: !git(root, ['status', '--porcelain', '--untracked-files=normal']) };
}

export async function releaseFiles(root, modules = null) {
  const files = {};
  if (!modules) {
    Object.assign(files, Object.fromEntries(Object.entries(await inventory(await regularPath(root, 'dist'))).map(([name, hash]) => ['dist/' + name, hash])));
    for (const name of ['index.js', 'crypto-reconcile.js', 'payments.js', 'payments-meta.json']) {
      const path = 'dist-server/' + name;
      files[path] = digest(await readFile(await regularPath(root, path)));
    }
    files['module-dist/host-contracts.json'] = digest(await readFile(await regularPath(root, 'module-dist/host-contracts.json')));
  }
  const packages = [];
  const report = JSON.parse(await readFile(resolve(root, 'module-build/build-report.json'), 'utf8'));
  for (const game of report.games) {
    const pointerName = `module-dist/${game.gameId}/active.json`;
    const pointer = JSON.parse(await readFile(await regularPath(root, pointerName), 'utf8'));
    const expected = `/game-modules/${game.gameId}/versions/${game.version}/manifest.json`;
    if (pointer.manifest !== expected) throw Error('Module pointer differs from the build report');
    const folder = `module-dist/${game.gameId}/versions/${game.version}`;
    const contents = await inventory(await regularPath(root, folder));
    if (contents['manifest.json'] !== pointer.sha256) throw Error('Module manifest differs from its pointer');
    files[pointerName] = digest(await readFile(resolve(root, pointerName)));
    for (const [name, hash] of Object.entries(contents)) files[folder + '/' + name] = hash;
    packages.push({ gameId: game.gameId, version: game.version, pointer: pointerName });
  }
  if (!packages.length || (modules && packages.length !== modules.length)) throw Error('Incomplete module build report');
  return { files, packages };
}

export async function verifyRelease(root, path = defaultManifest) {
  assertClean(root);
  const manifest = JSON.parse(await readFile(await regularPath(root, path), 'utf8'));
  if (manifest.format !== 1 || !manifest.build?.passed || !['modules', 'application'].includes(manifest.scope)
      || manifest.sourceCommit !== git(root, ['rev-parse', 'HEAD'])
      || manifest.sourceTree !== git(root, ['rev-parse', 'HEAD^{tree}'])) throw Error('Release source or build identity changed');
  if (!manifest.files || !Object.keys(manifest.files).length) throw Error('Empty release');
  if (manifest.hostProjection) {
    if (manifest.scope !== 'application' || manifest.hostProjection.productionCommit !== manifest.baseCommit || JSON.stringify(manifest.hostProjection) !== JSON.stringify(manifest.build.hostProjection)) throw Error('Projection build evidence differs');
    await verifyHostProjection(root, manifest.hostProjection);
  } else if (manifest.build.hostProjection) throw Error('Projection evidence missing');
  if (manifest.backendProjection) {
    if (manifest.scope !== 'application' || manifest.backendProjection.productionCommit !== manifest.baseCommit
      || JSON.stringify(manifest.backendProjection) !== JSON.stringify(manifest.build.backendProjection)
      || manifest.files[manifest.backendProjection.output?.path] !== manifest.backendProjection.output?.sha256) throw Error('Backend projection build evidence differs');
    await verifyBackendProjection(root,manifest.backendProjection);
  } else if (manifest.build.backendProjection) throw Error('Backend projection evidence missing');
  if(manifest.moduleProjection){
    if(manifest.scope!=='modules'||manifest.moduleProjection.productionCommit!==manifest.baseCommit||JSON.stringify(manifest.moduleProjection)!==JSON.stringify(manifest.build.moduleProjection))throw Error('Module projection evidence differs');
    await verifyModuleProjection(root,manifest.moduleProjection,manifest.modules);
  }else if(manifest.scope==='modules'&&manifest.build.moduleProjection)throw Error('Module projection evidence missing');
  for (const [name, hash] of Object.entries(manifest.files)) {
    if (!name.startsWith('dist/') && !name.startsWith('dist-server/') && !name.startsWith('module-dist/')) throw Error('Unexpected release output');
    if (digest(await readFile(await regularPath(root, name))) !== hash) throw Error('Release output changed: ' + name);
  }
  // Also reject extra files in package directories and dist, not just changed bytes.
  const actual = await releaseFiles(root, manifest.scope === 'modules' ? manifest.modules : null);
  if (JSON.stringify(Object.entries(actual.files).sort()) !== JSON.stringify(Object.entries(manifest.files).sort())) throw Error('Release inventory changed');
  return manifest;
}

export async function verifyGithub(root) {
  await rm(resolve(root, 'module-build/release-github.json'), { force: true });
  const manifest = await verifyRelease(root);
  await run(process.env.ROYAL_GIT_BINARY || 'git', ['fetch', '--no-tags', 'origin', 'main'], root);
  git(root, ['merge-base', '--is-ancestor', manifest.sourceCommit, 'origin/main']);
  await verifyRelease(root);
  const receipt = { format: 1, sourceCommit: manifest.sourceCommit,
    remoteMain: git(root, ['rev-parse', 'origin/main']), checkedAt: new Date().toISOString() };
  await saveJson(resolve(root, 'module-build/release-github.json'), receipt);
  return receipt;
}

export async function prepareRelease(root, { base, local = false, modules = null, hostProjection = null, backendProjection = null, moduleProjection = null } = {}) {
  await mkdir(resolve(root, 'module-build'), { recursive: true });
  const lock = resolve(root, 'module-build/release.lock');
  await mkdir(lock); // Never remove another process's lock or build into its outputs.
  const started = performance.now();
  const timings = { format: 1, passed: false, steps: [] };
  const step = async (name, action) => {
    const time = performance.now();
    try { return await action(); }
    finally { timings.steps.push({ name, durationMs: Math.round(performance.now() - time) }); }
  };
  try {
    await saveJson(resolve(lock, 'owner.json'), { pid: process.pid, purpose: 'Release preparation', cleanupCondition: 'Remove after this process exits' });
    await rm(resolve(root, defaultManifest), { force: true });
    await rm(resolve(root, 'module-build/release-github.json'), { force: true });
    assertClean(root);
    if (!local) await step('github', async () => {
      await run(process.env.ROYAL_GIT_BINARY || 'git', ['fetch', '--no-tags', 'origin', 'main'], root);
      git(root, ['merge-base', '--is-ancestor', 'HEAD', 'origin/main']);
    });
    const plan = releasePlan(root, base);
    const disk = await statfs(root);
    if (disk.bavail * disk.bsize < 11 * 1024 ** 3) throw Error('Need at least 11 GiB free before a build (10 GiB reserve plus build headroom).');
    const build = await step('build', () => buildApplication({ root, modules, hostProjection, backendProjection, moduleProjection }));
    if (build.hostProjection && build.hostProjection.productionCommit !== plan.baseCommit) throw Error('Host projection targets another production baseline');
    if (build.backendProjection && build.backendProjection.productionCommit !== plan.baseCommit) throw Error('Backend projection targets another production baseline');
    if(build.moduleProjection&&build.moduleProjection.productionCommit!==plan.baseCommit)throw Error('Module projection targets another production baseline');
    assertClean(root);
    if (git(root, ['rev-parse', 'HEAD']) !== plan.sourceCommit) throw Error('Source commit changed during build');
    const outputs = await step('inventory', () => releaseFiles(root, modules));
    const manifest = { ...plan, scope: modules ? 'modules' : 'application', modules,
      githubVerified: !local, build, ...(moduleProjection?{moduleProjection:build.moduleProjection}:{}), ...(build.hostProjection ? { hostProjection: build.hostProjection } : {}),
      ...(build.backendProjection ? { backendProjection: build.backendProjection } : {}), ...outputs, verificationRequired: ['production baseline', 'compatible host contract',
        'game-specific tests and wallet recovery', 'desktop/mobile host with chat', 'public checks after guarded installation'] };
    await saveJson(resolve(root, defaultManifest), manifest);
    timings.passed = true;
    return manifest;
  } finally {
    timings.durationMs = Math.round(performance.now() - started);
    await saveJson(resolve(root, 'module-build/release-timings.json'), timings);
    await rm(lock, { recursive: true });
  }
}

async function main() {
  const [operation, ...args] = process.argv.slice(2);
  let base, local = false, modules = null, github = false, hostProjection = null, backendProjection = null, moduleProjection = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--base' && args[i + 1]) base = args[++i];
    else if (args[i] === '--local') local = true;
    else if (args[i] === '--github') github = true;
    else if (args[i] === '--host-projection' && args[i + 1]) hostProjection = args[++i];
    else if (args[i] === '--module-projection' && args[i + 1]) moduleProjection = args[++i];
    else if (args[i] === '--backend-projection' && args[i + 1]) backendProjection = args[++i];
    else if (args[i] === '--modules' && args[i + 1]) {
      modules = [...new Set(args[++i].split(','))];
      if (!modules.every(name => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name))) throw Error('Invalid module slug list');
    } else throw Error('Unexpected release option: ' + args[i]);
  }
  if (operation === 'plan') console.log(JSON.stringify(releasePlan(projectRoot, base), null, 2));
  else if (operation === 'prepare') {
    const manifest = await prepareRelease(projectRoot, { base, local, modules, hostProjection, backendProjection, moduleProjection });
    console.log(JSON.stringify({ prepared: true, sourceCommit: manifest.sourceCommit, scope: manifest.scope,
      githubVerified: manifest.githubVerified, manifest: defaultManifest, files: Object.keys(manifest.files).length }));
  } else if (operation === 'verify') {
    const manifest = await verifyRelease(projectRoot);
    if (github) await verifyGithub(projectRoot);
    console.log(JSON.stringify({ verified: true, sourceCommit: manifest.sourceCommit, githubVerified: github || manifest.githubVerified }));
  } else throw Error('Use plan, prepare or verify');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();

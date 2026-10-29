import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import { buildFinancial } from './financial-build.mjs';
const helper = dirname(fileURLToPath(import.meta.url)), root = resolve(helper, '../../..'), work = resolve(root, 'artifacts/work/caribbean-publish-20261029'), out = resolve(work, 'payload');
const json = path => JSON.parse(readFileSync(path, 'utf8')), sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const scope = json(resolve(helper, 'scope.json')), before = json(resolve(work, 'before-full.json'));
const git = (...args) => execFileSync(process.env.ROYAL_GIT_BINARY || 'git', args, { cwd: root, encoding: 'utf8' }).trim();
const release = json(resolve(root, 'module-build/release-manifest.json')), receipt = json(resolve(root, 'module-build/release-github.json'));
assert.equal(release.sourceCommit, git('rev-parse', 'HEAD')); assert.equal(release.baseCommit, scope.base); assert(release.build.passed);
assert.equal(receipt.sourceCommit, release.sourceCommit); assert.equal(git('status', '--porcelain'), '');
assert.deepEqual(before.program, before.preparedProgram); assert.equal(before.containers['royal-game-1'].image, before.preparedImage);
assert.equal(before.containers['royal-game-1'].health, 'healthy'); assert(before.freeBytes > 5 * 1024 ** 3);
assert(!existsSync(out)); mkdirSync(out);
const payload = {}, source = {}, financeSource = {}, dist = {}, modules = {}, backend = {};
function copy(from, to) { const target = resolve(out, to),sub=relative(out,target); assert(sub&&!sub.startsWith('..')&&!isAbsolute(sub)); mkdirSync(dirname(target), { recursive: true }); copyFileSync(from, target); payload[to] = sha(target); return payload[to]; }
const allowed = new Set(scope.allowedSource);
for (const file of release.changed.filter(file => allowed.has(file))) {
  const digest = sha(resolve(root, file));
  if (before.source[file]?.lf !== digest && before.source[file]?.sha256 !== digest) source[file] = copy(resolve(root, file), 'source/' + file);
}
const retainedSource=[];
for (const [file, old] of Object.entries(before.source)) {
  if (file === 'deployment/SERVER.md' || file.endsWith('.orig') || file.endsWith('.bak') || file in source) continue;
  const current=existsSync(resolve(root,file))?sha(resolve(root,file)):null;if([old.sha256,old.lf].includes(current))continue;
  const origins=[];for(const commit of ['3e428397544ec9a18d2bb64e51cfce2f4293a627',scope.base,'9acf3686965fedc0c81efaaa6f740e30d4fef175']){
    try{const blob=execFileSync(process.env.ROYAL_GIT_BINARY||'git',['show',commit+':'+file],{cwd:root,stdio:['ignore','pipe','ignore']});const digest=createHash('sha256').update(blob).digest('hex');if([old.sha256,old.lf].includes(digest))origins.push(commit);}catch{}
  }
  assert(origins.length,'Unknown retained production source: '+file);retainedSource.push({file,liveSha256:old.sha256,buildSha256:current,origins});
}
for (const [file, digest] of Object.entries(release.files)) {
  assert.equal(sha(resolve(root, file)), digest);
  if (file.startsWith('dist/')) {
    const sub = file.slice(5); if (before.program[file] === digest) continue;
    const publicSource = before.source['public/' + sub];
    if (publicSource && [publicSource.sha256, publicSource.lf].includes(digest)) continue;
    if (sub === 'index.html' || /^assets\/[a-zA-Z0-9_-]+\.(js|css)$/.test(sub) || sub.startsWith('assets/caribbean-treasures/') || sub==='assets/royal-catalog/studio-caribbean-treasures.9f55140c4e61.webp') {
      assert(sub === 'index.html' || !(file in before.program), 'Immutable host asset differs'); dist[sub] = copy(resolve(root, file), 'dist/' + sub);
    } else {
      const old = before.source['public/' + sub]; assert(old && [old.sha256, old.lf].includes(digest), 'Unrelated public asset differs: ' + file);
    }
  }
}
assert('index.html' in dist);
backend['index.js'] = copy(resolve(root, 'dist-server/index.js'), 'backend/index.js');
const audit=await build({absWorkingDir:root,entryPoints:['server/index.ts'],bundle:true,platform:'node',packages:'external',format:'esm',outfile:'dist-server/index.js',write:false,metafile:true});
assert.equal(createHash('sha256').update(audit.outputFiles[0].contents).digest('hex'),backend['index.js']);
const backendInputs={};for(const file of Object.keys(audit.metafile.inputs)){
 const bytes=readFileSync(resolve(root,file));backendInputs[file]=createHash('sha256').update(bytes).digest('hex');
 if(!allowed.has(file)){const original=execFileSync(process.env.ROYAL_GIT_BINARY||'git',['show',scope.base+':'+file],{cwd:root});assert.equal(bytes.toString().replace(/\r\n/g,'\n'),original.toString().replace(/\r\n/g,'\n'),'Unreviewed backend input: '+file);}
}
assert.equal(sha(resolve(root,'package-lock.json')),before.program['package-lock.json'],'Dependency lock differs');
const runtimePackage=json(resolve(root,'package.json')),oldPackage=JSON.parse(git('show',scope.base+':package.json'));delete runtimePackage.scripts;delete oldPackage.scripts;assert.deepEqual(runtimePackage,oldPackage,'Runtime dependencies differ');
const host = json(resolve(root, 'module-dist/host-contracts.json'));
const oldHost = json(resolve(work, 'host-before.json'));
for (const [id, contract] of Object.entries(oldHost.games)) assert.deepEqual(host.games[id], contract, 'Unrelated contract differs: ' + id);
assert.deepEqual(Object.keys(host.games).sort(), [...Object.keys(oldHost.games),scope.changedGame].sort());assert.deepEqual(host.games[scope.changedGame],scope.contract);
modules['host-contracts.json'] = copy(resolve(root, 'module-dist/host-contracts.json'), 'module-dist/host-contracts.json');
const pointerPath = resolve(root, 'module-dist', scope.changedGame, 'active.json'), pointer = json(pointerPath);
const manifestPath = resolve(root, 'module-dist', pointer.manifest.replace(/^\/game-modules\//, '')), metadata = json(manifestPath);
assert.equal(sha(manifestPath), pointer.sha256);
for (const field of ['apiVersion', 'rulesVersion', 'progressVersion']) assert.equal(metadata[field], scope.contract[field]);
for (const file of ['manifest.json', ...Object.keys(metadata.files)]) {
  const from = resolve(dirname(manifestPath), file); if (file !== 'manifest.json') assert.equal(sha(from), metadata.files[file]);
  const name = pointer.manifest.replace(/^\/game-modules\//, '').replace(/manifest\.json$/, '') + file;
  modules[name] = copy(from, 'module-dist/' + name); copy(from, 'caribbean-package/' + file);
}
modules[scope.changedGame + '/active.json'] = copy(pointerPath, 'module-dist/' + scope.changedGame + '/active.json');
copy(resolve(root, 'module-dist/host-contracts.json'), 'host.json');
const financial = await buildFinancial({ before });
writeFileSync(resolve(out, 'play.js'), financial.outputFiles[0].contents); payload['play.js'] = sha(resolve(out, 'play.js'));
const financialInputs = financial.financialInputs;
for (const [file, digest] of Object.entries(financialInputs)) {
  assert(!file.startsWith('/') && !file.split('/').includes('..'));
  if (before.financeSource[file]?.lf !== digest && before.financeSource[file]?.sha256 !== digest) {
    assert(allowed.has(file), 'Unrelated financial input differs: ' + file); financeSource[file] = copy(resolve(root, file), 'finance-source/' + file);
  }
}
assert.equal(before.containers['royal-nile-play'].profile.host.ReadonlyRootfs, true);
for (const file of ['deploy.py', 'snapshot.py', 'financial_gate.py', 'quiesce.cjs', 'runtime-inventory.cjs', 'run-release.py', 'scope.json', 'financial-baseline.json']) copy(resolve(helper, file), file);
copy(resolve(root, 'scripts/game-module-release.py'), 'game-module-release.py');
assert.equal(sha(resolve(root, 'scripts/game-module-release.py')), before.source['scripts/game-module-release.py'].sha256);
for (const file of ['release-manifest.json', 'release-github.json']) copy(resolve(root, 'module-build', file), file);
const manifest = { release: scope.release, sourceCommit: release.sourceCommit, baseCommit: scope.base, before, source, financeSource, financialInputs, retainedFinancialOrigins: financial.retainedOrigins, dist, modules, backend,
  financial: payload['play.js'], payload, hostContract: payload['host.json'], helperSha256: payload['deploy.py'],
  retainedSource,backendInputs,
  modulePackage: { gameId: scope.changedGame, version: metadata.version, manifestSha256: pointer.sha256, beforeSha256: before.modules['/opt/royal-game-modules/' + scope.changedGame + '/active.json']??'none' },
  compatibility: { onlyCaribbeanContractAdded: true, acceptedRules: [1], unchangedDependencyManifests: true, retainedOtherModules: true, retainedOtherBackendPrograms: ['dist-server/payments.js','dist-server/crypto-reconcile.js'] } };
writeFileSync(resolve(out, 'install-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
execFileSync('tar', [...(process.platform === 'darwin' ? ['--no-xattrs'] : []), '-czf', resolve(work, 'transport.tgz'), '-C', out, '.'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
console.log(JSON.stringify({ sourceCommit: release.sourceCommit, changedSources: Object.keys(source).length, financeSources: Object.keys(financeSource).length, clientFiles: Object.keys(dist).length, moduleFiles: Object.keys(modules).length, transportBytes: statSync(resolve(work, 'transport.tgz')).size }));

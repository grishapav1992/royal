import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {assertClean,git,releaseFiles,releasePlan,verifyRelease} from '../../../scripts/release.mjs';

const root=process.cwd();
const [mode,review]=process.argv.slice(2);
assert(['projection','bind'].includes(mode)&&review,'Specify projection or bind and the original evidence directory');
const read=name=>readFileSync(resolve(review,name));
const json=name=>JSON.parse(read(name));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const write=(name,value)=>writeFileSync(name,JSON.stringify(value,null,2)+'\n');
const oldRelease=json('release-manifest.json'),oldReceipt=json('release-github.json');
assert.equal(oldReceipt.manifestSha256,hash(read('release-manifest.json')));
assert.equal(oldReceipt.sourceCommit,oldRelease.sourceCommit);
assert.equal(oldRelease.scope,'modules');
assert.equal(oldRelease.build.passed,true);
git(root,['merge-base','--is-ancestor',oldRelease.sourceCommit,'origin/main']);

const excluded={slug:'cosmic-escape',gameId:'studio-cosmic-escape'};
const slugs=oldRelease.modules.filter(slug=>slug!==excluded.slug);
const packages=oldRelease.packages.filter(row=>row.gameId!==excluded.gameId);
assert.equal(slugs.length,6);
assert.equal(packages.length,slugs.length);
const keep=new Set(packages.map(row=>row.gameId));
const old=oldRelease.moduleProjection;
const modules=Object.fromEntries(Object.entries(old.modules).filter(([id])=>keep.has(id)));
const used=new Set(Object.values(modules).flatMap(row=>Object.keys(row.sourceFiles)));
used.add('src/modules/GameModuleCatalog.ts');
for(const slug of slugs)used.add('games/'+slug+'/package.json');
const select=(map,keys)=>Object.fromEntries(Object.entries(map).filter(([key])=>keys.has(key)));
const selectedAssets=new Set(Object.values(modules).flatMap(row=>Object.keys(row.files)
 .filter(name=>name.startsWith('media/')).map(name=>'public/assets/'+name.slice('media/'.length))));
const oldConfig=JSON.parse(readFileSync(old.config));
const selectedConfig={format:1,productionCommit:old.productionCommit,moduleGames:slugs,
 moduleContracts:select(oldConfig.moduleContracts??{},keep),moduleAssets:select(oldConfig.moduleAssets,selectedAssets),
 moduleDependencies:select(oldConfig.moduleDependencies??{},used),files:select(oldConfig.files,used)};
const config='deployment/releases/slot-entry-notes-20261124-v1/selected-projection.json';
if(mode==='projection'){
 write(config,selectedConfig);
}else{
 assertClean(root);
 assert.deepEqual(JSON.parse(readFileSync(config)),selectedConfig);
 const source=releasePlan(root,oldRelease.baseCommit);
 git(root,['merge-base','--is-ancestor',source.sourceCommit,'origin/main']);
 const unchanged=['package.json','package-lock.json','tsconfig.json','src','server','scripts/game-math',
  'scripts/release.mjs','scripts/build-application.mjs','scripts/build-game-module.mjs','scripts/build-host-projection.mjs',
  'scripts/module-source-projection.mjs','scripts/module-build-cache.mjs',
  ...slugs.map(slug=>'games/'+slug)];
 assert.equal(git(root,['diff','--name-only',oldRelease.sourceCommit,source.sourceCommit,'--',...unchanged]),'',
  'Build, qualification, or selected package inputs changed');
 const projection={...old,config,sha256:hash(readFileSync(config)),inputs:select(old.inputs,used),
  origins:select(old.origins,used),assets:select(old.assets,selectedAssets),dependencies:select(old.dependencies??{},used),modules};
 const originalBuild=json('build-report.json');
 write('module-build/build-report.json',{...originalBuild,built:packages.length,games:originalBuild.games.filter(row=>keep.has(row.gameId))});
 const outputs=await releaseFiles(root,slugs);
 assert.deepEqual(outputs.packages,packages);
 const oldFiles=Object.fromEntries(Object.entries(oldRelease.files).filter(([name])=>keep.has(name.split('/')[1])));
 assert.deepEqual(outputs.files,oldFiles,'Selected output bytes changed');
 const inheritedFrom={sourceCommit:oldRelease.sourceCommit,manifestSha256:oldReceipt.manifestSha256,
  receiptSha256:hash(read('release-github.json'))};
 const manifest={...oldRelease,...source,modules:slugs,...outputs,moduleProjection:projection,
  build:{...oldRelease.build,moduleProjection:projection,inheritedFrom},reused:true};
 write('module-build/release-manifest.json',manifest);
 await verifyRelease(root);
 const browser=json('browser-prepared.json');
 assert.equal(browser.sourceCommit,oldRelease.sourceCommit);
 assert.equal(browser.passed,true);
 for(const row of packages)assert.equal(browser.versions[row.gameId],row.version);
 write('../browser-prepared.json',{...browser,sourceCommit:source.sourceCommit,
  games:packages.map(row=>row.gameId),versions:select(browser.versions,keep),
  inheritedFrom:{sourceCommit:browser.sourceCommit,reportSha256:hash(read('browser-prepared.json'))}});
 console.log(JSON.stringify({reusedPackages:packages.length,sourceCommit:source.sourceCommit,inheritedFrom}));
}

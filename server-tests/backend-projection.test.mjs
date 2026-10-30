import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {buildProjectedBackend,verifyBackendProjection} from '../scripts/build-host-projection.mjs';
import {buildApplication} from '../scripts/build-application.mjs';
import {git,releasePlan,releaseFiles,verifyRelease} from '../scripts/release.mjs';
import {digest} from '../scripts/module-build-cache.mjs';

const parent=resolve('artifacts/work/location-levels-mvp/projection-tests');
await mkdir(parent,{recursive:true});
await writeFile(resolve(parent,'owner.json'),JSON.stringify({owner:'backend projection tests',purpose:'Small synthetic Git fixtures',cleanupCondition:'Remove after this test process exits'}));
test.after(()=>rm(parent,{recursive:true,force:true}));

async function fixture(t){
 const root=await mkdtemp(resolve(parent,'fixture-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const put=async(name,value)=>{await mkdir(dirname(resolve(root,name)),{recursive:true});await writeFile(resolve(root,name),value);};
 const commit=message=>{git(root,['add','.']);git(root,['commit','-qm',message]);return git(root,['rev-parse','HEAD']);};
 await put('.gitignore','dist/\ndist-server/\nmodule-dist/\nmodule-build/\nnode_modules/\n');
 await put('package.json','{"name":"projected-backend-test","type":"module"}');
 await put('tsconfig.json','{"compilerOptions":{"target":"ES2022","module":"ESNext"}}');
 const sources={'server/index.ts':'import {value} from "./value"; console.log("BASE_HOST",value);\n',
  'server/value.ts':'export const value = "RETAINED_PRODUCTION";\n',
  'package.json':await readFile(resolve(root,'package.json'),'utf8'),'tsconfig.json':await readFile(resolve(root,'tsconfig.json'),'utf8')};
 for(const [name,value]of Object.entries(sources))await put(name,value);
 git(root,['init','-q']);git(root,['config','user.name','Backend projection test']);git(root,['config','user.email','projection-test@example.invalid']);
 const base=commit('production baseline');
 await put('server/index.ts','import {value} from "./value"; console.log("UNPUBLISHED_HEAD",value);\n');
 await put('server/value.ts','export const value = "UNPUBLISHED_VALUE";\n');
 const config={format:1,productionCommit:base,entries:['server/index.ts'],files:Object.fromEntries(Object.entries(sources).map(([name,value])=>[name,
  {commit:base,path:name,baseSha256:digest(value),sha256:digest(value)}]))};
 config.files['server/index.ts'].patches=[{from:'BASE_HOST',to:'FEATURE_HOST'}];
 config.files['server/index.ts'].sha256=digest(sources['server/index.ts'].replace('BASE_HOST','FEATURE_HOST'));
 const configure=async(change=()=>{})=>{change(config);await put('backend-projection.json',JSON.stringify(config));commit('reviewed projection');};
 await configure();
 return{root,put,base,config,configure,commit,sources};
}

test('backend projection uses exact retained and patched Git sources and writes only index.js',async t=>{
 const f=await fixture(t);await f.put('dist-server/payments.js','retain independent payment bytes');
 const report=await buildProjectedBackend(f.root,'backend-projection.json');
 const output=await readFile(resolve(f.root,'dist-server/index.js'),'utf8');
 assert.match(output,/FEATURE_HOST/);assert.match(output,/RETAINED_PRODUCTION/);assert.doesNotMatch(output,/UNPUBLISHED/);
 assert.equal(await readFile(resolve(f.root,'dist-server/payments.js'),'utf8'),'retain independent payment bytes');
 assert.deepEqual(Object.keys(report.inputs).sort(),['package.json','server/index.ts','server/value.ts','tsconfig.json']);
 assert.equal(report.output.path,'dist-server/index.js');assert.equal(report.output.sha256,digest(output));
 await verifyBackendProjection(f.root,report);
 await f.put('dist-server/index.js','changed output');await assert.rejects(verifyBackendProjection(f.root,report),/output.*changed/);
});

test('unknown backend dependencies, entries and compiler configuration are rejected',async t=>{
 for(const mode of ['unknown-input','unknown-external','wrong-entry','indirect-config']){
  const f=await fixture(t);
  if(mode==='unknown-input'){
   await f.put('server/foreign.ts','export const extra = 7;');
   await f.configure(c=>{const text=f.sources['server/index.ts']+'import "./foreign";\n';c.files['server/index.ts'].patches=[{from:f.sources['server/index.ts'],to:text}];c.files['server/index.ts'].sha256=digest(text);});
  }else if(mode==='unknown-external')await f.configure(c=>{const text=f.sources['server/index.ts']+'import "unreviewed-runtime-package";\n';c.files['server/index.ts'].patches=[{from:f.sources['server/index.ts'],to:text}];c.files['server/index.ts'].sha256=digest(text);});
  else if(mode==='wrong-entry')await f.configure(c=>{c.entries=['server/payments/index.ts'];});
  else await f.configure(c=>{const bytes='{"extends":"./outside.json"}';c.files['tsconfig.json'].patches=[{from:f.sources['tsconfig.json'],to:bytes}];c.files['tsconfig.json'].sha256=digest(bytes);});
  await assert.rejects(buildProjectedBackend(f.root,'backend-projection.json'),mode==='unknown-input'?/Unreviewed projected host input/:mode==='unknown-external'?/Unreviewed backend external import/:mode==='wrong-entry'?/main backend/:/Indirect backend compiler/);
 }
});

test('forged ancestry, hashes, unsafe paths and Git symlink origins cannot enter a backend projection',async t=>{
 for(const mode of ['ancestry','base-hash','output-hash','path','git-symlink']){
  const f=await fixture(t);
  if(mode==='ancestry'){
   const unrelated=git(f.root,['commit-tree',git(f.root,['rev-parse','HEAD^{tree}']),'-m','unrelated source']);
   await f.configure(c=>{c.files['server/value.ts'].commit=unrelated;});
  }else if(mode==='git-symlink'){
   await symlink('value.ts',resolve(f.root,'server/origin-link.ts'));const revision=f.commit('symlink origin');
   await f.configure(c=>{c.files['server/value.ts'].commit=revision;c.files['server/value.ts'].path='server/origin-link.ts';});
  }else await f.configure(c=>{if(mode==='base-hash')c.files['server/value.ts'].baseSha256='0'.repeat(64);if(mode==='output-hash')c.files['server/value.ts'].sha256='0'.repeat(64);if(mode==='path')c.files['server/value.ts'].path='../outside';});
  await assert.rejects(buildProjectedBackend(f.root,'backend-projection.json'));
 }
});

test('working source, configuration and output symlinks are rejected before any output overwrite',async t=>{
 for(const mode of ['source','configuration','output']){
  const f=await fixture(t);await f.put('safe-target.ts','unchanged target');
  const path=mode==='source'?'server/value.ts':mode==='configuration'?'backend-projection.json':'dist-server/index.js';
  if(mode==='output')await mkdir(resolve(f.root,'dist-server'),{recursive:true});else await rm(resolve(f.root,path));
  await symlink(resolve(f.root,'safe-target.ts'),resolve(f.root,path));
  await assert.rejects(buildProjectedBackend(f.root,'backend-projection.json'),/symlink/);
  assert.equal(await readFile(resolve(f.root,'safe-target.ts'),'utf8'),'unchanged target');
 }
});

test('changed package resolution fields and uncommitted projection configuration are rejected',async t=>{
 const f=await fixture(t);await f.put('package.json','{"name":"projected-backend-test","type":"commonjs"}');
 await assert.rejects(buildProjectedBackend(f.root,'backend-projection.json'),/package configuration differs/);
 await f.put('package.json',f.sources['package.json']);await f.put('backend-projection.json',JSON.stringify({...f.config,uncommitted:true}));
 await assert.rejects(buildProjectedBackend(f.root,'backend-projection.json'),/not the committed source/);
});

test('JavaScript-to-TypeScript import substitution cannot hide a source symlink',async t=>{
 const f=await fixture(t);
 await f.put('server/target.ts',f.sources['server/value.ts']);await rm(resolve(f.root,'server/value.ts'));
 await symlink('target.ts',resolve(f.root,'server/value.ts'));
 await f.configure(c=>{
  c.files['server/target.ts']={...c.files['server/value.ts']};
  const text=f.sources['server/index.ts'].replace('./value','./value.js');
  c.files['server/index.ts'].patches=[{from:f.sources['server/index.ts'],to:text}];c.files['server/index.ts'].sha256=digest(text);
 });
 await assert.rejects(buildProjectedBackend(f.root,'backend-projection.json'),/symlink/);
});

test('backend verification rejects a forged configuration fingerprint or origin receipt',async t=>{
 const f=await fixture(t),report=await buildProjectedBackend(f.root,'backend-projection.json');
 await assert.rejects(verifyBackendProjection(f.root,{...report,sha256:'0'.repeat(64)}),/configuration changed/);
 const forged=structuredClone(report);forged.origins['server/value.ts'].commit='0'.repeat(40);
 await assert.rejects(verifyBackendProjection(f.root,forged));
 const missing=structuredClone(report);delete missing.inputs['server/index.ts'];delete missing.origins['server/index.ts'];
 await assert.rejects(verifyBackendProjection(f.root,missing),/Required backend projection input missing/);
});

test('the compiled backend binds the complete input closure and graph fingerprint without rebuilding',async t=>{
 const f=await fixture(t),report=await buildProjectedBackend(f.root,'backend-projection.json');
 const output=await readFile(resolve(f.root,'dist-server/index.js'),'utf8');
 assert(output.startsWith('// royal-backend-projection '));assert(output.split('\n')[0].includes(report.graphSha256));
 const omitted=structuredClone(report);delete omitted.inputs['server/value.ts'];delete omitted.origins['server/value.ts'];
 assert.equal(omitted.output.sha256,report.output.sha256);
 await assert.rejects(verifyBackendProjection(f.root,omitted),/graph evidence changed/);
 await assert.rejects(verifyBackendProjection(f.root,{...report,graphSha256:'0'.repeat(64)}),/graph evidence changed/);
 const changedHeader=output.replace(report.graphSha256,'0'.repeat(64));
 await f.put('dist-server/index.js',changedHeader);
 await assert.rejects(verifyBackendProjection(f.root,{...report,output:{...report.output,sha256:digest(changedHeader)}}),/graph binding changed/);
});

async function applicationFixture(t){
 const f=await fixture(t);
 await f.put('scripts/check-game-rtp.mjs','');
 await f.put('node_modules/typescript/bin/tsc','');
 await f.put('scripts/build-game-module.mjs','');
 await f.put('node_modules/vite/bin/vite.js','import fs from "node:fs"; fs.mkdirSync("dist",{recursive:true}); fs.writeFileSync("dist/index.html","fixture hall");');
 await f.put('scripts/crypto-reconcile.ts','console.log("independent reconciliation");');
 await f.put('server/payments/index.ts','console.log("independent payments");');
 f.commit('application build fixture');return f;
}

test('application build keeps the projected backend and release verification binds its exact evidence and output',async t=>{
 const f=await applicationFixture(t);
 const build=await buildApplication({root:f.root,backendProjection:'backend-projection.json'});
 assert(build.passed);assert(build.backendProjection);assert.doesNotMatch(await readFile(resolve(f.root,'dist-server/index.js'),'utf8'),/UNPUBLISHED/);
 await f.put('module-dist/host-contracts.json','{}');
 const version='1.0.0-aaaaaaaaaaaa',folder=`module-dist/test-a/versions/${version}`;
 await f.put(folder+'/manifest.json','{}');await f.put(folder+'/entry.js','entry');
 await f.put('module-dist/test-a/active.json',JSON.stringify({manifest:`/game-modules/test-a/versions/${version}/manifest.json`,sha256:digest('{}')}));
 await f.put('module-build/build-report.json',JSON.stringify({games:[{gameId:'test-a',version}]}));
 const manifest={...releasePlan(f.root,f.base),scope:'application',modules:null,build,backendProjection:build.backendProjection,...await releaseFiles(f.root)};
 const save=()=>f.put('module-build/release-manifest.json',JSON.stringify(manifest));await save();await verifyRelease(f.root);
 delete manifest.backendProjection;await save();await assert.rejects(verifyRelease(f.root),/evidence missing/);
 manifest.backendProjection=structuredClone(build.backendProjection);manifest.backendProjection.output.sha256='0'.repeat(64);await save();await assert.rejects(verifyRelease(f.root),/evidence differs/);
 manifest.backendProjection=build.backendProjection;await save();await verifyRelease(f.root);
});

test('module-only builds cannot request either source projection',async()=>{
 await assert.rejects(buildApplication({modules:['a'],backendProjection:'backend.json'}),/application release/);
 await assert.rejects(buildApplication({modules:['a'],hostProjection:'host.json'}),/application release/);
});

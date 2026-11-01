import assert from'node:assert/strict';import fs from'node:fs';import path from'node:path';import{fileURLToPath}from'node:url';import{execFileSync}from'node:child_process';
import{verifyRelease,assertClean,git}from'../../../scripts/release.mjs';import{readHostProjection}from'../../../scripts/build-host-projection.mjs';import{verifyNativeBuild}from'./native-build.mjs';import{digest,inventory}from'../../../scripts/module-build-cache.mjs';import{stakeInputs}from'../../../scripts/game-math/rtp-gate.mjs';import{validateStakeProof}from'../../../scripts/game-math/rtp-stakes.mjs';
const root=process.cwd(),folder=path.dirname(fileURLToPath(import.meta.url)),name='shared-stakes-20261101-v2';
const[beforeFile,nativeDirectory,outPath]=process.argv.slice(2),out=path.resolve(outPath);assert(beforeFile&&nativeDirectory&&outPath);
await assertClean(root);const release=await verifyRelease(root),receipt=JSON.parse(fs.readFileSync('module-build/release-github.json')),before=JSON.parse(fs.readFileSync(beforeFile));
assert.equal(release.scope,'application');assert.equal(release.baseCommit,before.sourceCommit);assert.equal(receipt.sourceCommit,release.sourceCommit);assert.equal(receipt.remoteMain,git(root,['rev-parse','origin/main']));assert(!fs.existsSync(out),'Publication payload already exists');
const native=await verifyNativeBuild(root,nativeDirectory),host=await readHostProjection(root,path.relative(root,path.join(folder,'host-projection.json')),{strictOrigins:true}),backend=await readHostProjection(root,path.relative(root,path.join(folder,'backend-projection.json')),{strictOrigins:true});
assert.equal(native.productionCommit,before.sourceCommit);assert.equal(release.hostProjection.sha256,host.sha256);assert.equal(release.backendProjection.sha256,backend.sha256);
const moduleReport=release.build.moduleProjection;assert(moduleReport);const qualified=JSON.parse(fs.readFileSync('scripts/game-math/rtp-policy.json')),scope=JSON.parse(fs.readFileSync(path.join(folder,'scope.json'))),compat=JSON.parse(fs.readFileSync(path.join(folder,'production-round-compatibility.json')));
assert(compat.passed&&compat.preservedWardrobeVersion===3&&compat.legacyCases===23);assert.equal(compat.newRuntimeSha256,native.outputs['runtime.mjs'].sha256);
assert.deepEqual(before.program,before.preparedProgram);assert.equal(before.container.image,before.preparedImage);assert.equal(before.container.health,'healthy');
const graphs=[release.hostProjection.inputs,release.backendProjection.inputs,moduleReport.inputs,native.inputs],inputs={};for(const graph of graphs)for(const[n,h]of Object.entries(graph)){assert(!inputs[n]||inputs[n]===h,'Mixed runtime sources: '+n);inputs[n]=h;}
for(const game of scope.activeGames){const i=await stakeInputs(root,game),p=JSON.parse(fs.readFileSync(i.policy.proof));assert(validateStakeProof(game,i,p));for(const[n,h]of Object.entries(i.sourceHashes))if(inputs[n])assert.equal(inputs[n],h,'Unqualified actual monetary source: '+n);}
for(const n of['src/shared/gameStakes.ts','src/shared/roundPrecision.ts','server/demoExpansion.ts','server/demoWallet.ts','server/finance/nile-game-runtime.ts'])assert(inputs[n],'Missing common monetary source: '+n);
const nextHost=structuredClone(before.moduleHost),packages={};
for(const[game,p]of Object.entries(moduleReport.modules)){
 assert(scope.activeGames.includes(game));const metadata=JSON.parse(fs.readFileSync(p.manifestPath)),contract=Object.fromEntries(['apiVersion','rulesVersion','progressVersion'].map(k=>[k,metadata[k]]));
 if(game==='studio-caribbean-treasures'){assert.equal(contract.rulesVersion,2);assert.equal(nextHost.games[game].rulesVersion,1);nextHost.games[game]=contract;}else assert.deepEqual(contract,nextHost.games[game],'Unrequested game contract change: '+game);
 const policy=qualified.stakePolicies[game];assert.equal(contract.rulesVersion,policy.rulesVersion);
 if(contract.progressVersion!==policy.progressVersion){assert(game==='studio-afterglow'&&policy.compatibleProgressVersions?.includes(3));assert.deepEqual(compat.progress3QualifiedStakes,policy.stakes);}
 packages[game]={version:metadata.version,contract,files:{'manifest.json':digest(fs.readFileSync(p.manifestPath)),...metadata.files},pointerSha256:release.files['module-dist/'+game+'/active.json']};
}
assert.equal(Object.keys(packages).length,18);assert.deepEqual(Object.keys(packages).sort(),scope.activeGames.slice().sort());
fs.mkdirSync(out,{recursive:true});const payload={};function write(n,bytes){assert(!path.isAbsolute(n)&&!n.split('/').some(p=>!p||p==='.'||p==='..'||p.startsWith('.env')));const h=digest(bytes);if(payload[n]){assert.equal(payload[n],h,'Conflicting payload: '+n);return h;}const target=path.join(out,n);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes,{flag:'wx'});return payload[n]=h;}
const changed={};
for(const[n,h]of Object.entries(inputs)){
 if(!/^(src|server|scripts|games)\//.test(n)||n.startsWith('public/'))continue;
 if([before.source[n],before.sourceLF[n]].includes(h))continue;
 const bytes=host.metadata.files[n]?host.read(n):backend.read(n);assert.equal(digest(bytes),h);changed[n]=write('source/'+n,bytes);
}
const evidence=new Set([...scope.changedSources,...Object.values(qualified.games??{}).flatMap(p=>[p.proof,p.qualificationSource]),...Object.values(qualified.stakePolicies).flatMap(p=>[p.proof,p.qualificationSource]),...git(root,['ls-files','scripts/game-math','docs/game-math/qualifications']).split('\n')]);
for(const n of evidence){if(!n||!(/^(docs\/game-math|scripts\/game-math)\//.test(n))||!fs.existsSync(n)||!fs.statSync(n).isFile())continue;const bytes=fs.readFileSync(n);if(before.source[n]===digest(bytes))continue;changed[n]=write('source/'+n,bytes);}
// Qualification files are read from this exact committed release, not an earlier projection checkpoint.
for(const p of Object.values(qualified.stakePolicies)){const n=p.proof,bytes=fs.readFileSync(n);changed[n]=write('source/'+n,bytes);}
const delta={},serverDelta={};for(const[n,h]of Object.entries(release.files))if(n.startsWith('dist/')&&before.program[n]!==h){const bytes=fs.readFileSync(n);assert.equal(digest(bytes),h);delta[n.slice(5)]=write('dist-delta/'+n.slice(5),bytes);}
assert(delta['index.html']);serverDelta['index.js']=write('server-delta/index.js',fs.readFileSync('dist-server/index.js'));assert.equal(serverDelta['index.js'],release.files['dist-server/index.js']);
for(const[game,row]of Object.entries(packages)){
 const prefix='module-dist/'+game+'/versions/'+row.version+'/';for(const[n,h]of Object.entries(row.files)){const bytes=fs.readFileSync(prefix+n);assert.equal(digest(bytes),h);write('packages/'+game+'/'+n,bytes);}
 const bytes=fs.readFileSync('module-dist/'+game+'/active.json');assert.equal(digest(bytes),row.pointerSha256);write('pointers/'+game+'.json',bytes);
}
for(const n of['play.js','proof.js']){const bytes=fs.readFileSync(path.resolve(nativeDirectory,n));assert.equal(digest(bytes),native.outputs[n].sha256);write('native/'+n,bytes);}
write('native-build.json',fs.readFileSync(path.resolve(nativeDirectory,'native-build.json')));write('host.json',Buffer.from(JSON.stringify(nextHost,null,2)+'\n'));
const references={'snapshot-base.py':'deployment/releases/universal-spins-20261031-v1/snapshot.py','runtime-inventory.cjs':'deployment/releases/cat-purr-hall-only-20261030-v1/runtime-inventory.cjs','image_metadata.py':'deployment/releases/remove-reward-games-catalog-20261031-v1/image_metadata.py','financial_gate.py':'deployment/releases/cat-purr-hall-only-20261030-v1/financial_gate.py','quiesce-base.cjs':'deployment/releases/cat-purr-hall-only-20261030-v1/quiesce.cjs','retention-runtime.py':'deployment/maintenance/retention-runtime.py'};
const helpers={};for(const[n,source]of Object.entries(references))helpers[n]=write(n,fs.readFileSync(source));
helpers['publisher.py']=write('publisher.py',host.read('scripts/game-module-release.py'));assert.equal(helpers['publisher.py'],before.source['scripts/game-module-release.py']);
for(const n of['deploy.py','engine_build.py','snapshot.py','quiesce.cjs','dual_gate.py','production-round-compatibility.json','scope.json'])write(n,fs.readFileSync(path.join(folder,n)));
helpers['engine_build.py']=payload['engine_build.py'];
for(const n of['release-manifest.json','release-github.json'])write(n,fs.readFileSync('module-build/'+n));
const manifest={release:name,sourceCommit:release.sourceCommit,baseCommit:before.sourceCommit,before,changed,delta,serverDelta,packages,nativeOutputs:native.outputs,nativeProtectedBefore:before.protectedPrograms['royal-nile-play'],hostContractSha256:payload['host.json'],helperSha256:payload['deploy.py'],snapshotSha256:payload['snapshot.py'],helpers,payload,receiptSha256:payload['release-github.json'],releaseManifestSha256:payload['release-manifest.json'],activeGames:scope.activeGames,addedGames:[],restoredGames:[]};
write('install-manifest.json',Buffer.from(JSON.stringify(manifest,null,2)+'\n'));console.log(JSON.stringify({sourceCommit:release.sourceCommit,sourceFiles:Object.keys(changed).length,packages:Object.keys(packages).length,payloadFiles:Object.keys(payload).length,out}));

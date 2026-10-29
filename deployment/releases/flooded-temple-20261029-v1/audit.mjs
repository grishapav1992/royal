import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {productionBase} from './financial-build.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const json=path=>JSON.parse(readFileSync(resolve(root,path),'utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),sha=path=>hash(readFileSync(resolve(root,path)));
const git=(...args)=>execFileSync(process.env.ROYAL_GIT_BINARY||'git',args,{cwd:root});
assert.equal(process.argv.length,3,'Specify the read-only production snapshot');
const before=json(process.argv[2]),release=json('module-build/release-manifest.json'),receipt=json('module-build/release-github.json');
assert.equal(release.sourceCommit,git('rev-parse','HEAD').toString().trim());assert.equal(receipt.sourceCommit,release.sourceCommit);assert.equal(release.baseCommit,productionBase);assert.equal(before.sourceRevision,productionBase);
assert.equal(release.githubVerified,true);assert.equal(release.build.passed,true);assert.deepEqual(before.program,before.preparedProgram);
assert.equal(before.containers['royal-game-1'].image,before.preparedImage);assert.equal(before.containers['royal-game-1'].health,'healthy');assert(before.freeBytes>5*1024**3);
const host=json('module-dist/host-contracts.json'),oldHost=before.moduleHost;
assert(!('studio-flooded-temple'in oldHost.games));assert.deepEqual(Object.keys(host.games).sort(),[...Object.keys(oldHost.games),'studio-flooded-temple'].sort());
assert.deepEqual(host.games['studio-flooded-temple'],{apiVersion:1,rulesVersion:2,progressVersion:2});for(const[id,contract]of Object.entries(oldHost.games))assert.deepEqual(host.games[id],contract,id);
const pointer=json('module-dist/studio-flooded-temple/active.json'),manifestPath=pointer.manifest.replace('/game-modules/','module-dist/'),game=json(manifestPath);
assert.equal(sha(manifestPath),pointer.sha256);assert.equal(game.version,'0.9.3-4a6b3fba5115');
for(const[file,digest]of Object.entries(game.files))assert.equal(sha(manifestPath.replace('manifest.json',file)),digest,file);
const newPackage=json('package.json'),oldPackage=JSON.parse(git('show',productionBase+':package.json'));delete newPackage.scripts;delete oldPackage.scripts;assert.deepEqual(newPackage,oldPackage,'Runtime dependency manifests differ');
assert.equal(hash(readFileSync(resolve(root,'package-lock.json'),'utf8').replace(/\r\n/g,'\n')),before.program['package-lock.json'],'Dependency lock differs');
const changed=new Set(release.changed);
const backend=await build({absWorkingDir:root,entryPoints:['server/index.ts'],bundle:true,platform:'node',packages:'external',format:'esm',outfile:'dist-server/index.js',write:false,metafile:true});
assert.equal(hash(backend.outputFiles[0].contents),sha('dist-server/index.js'));
const backendInputs={};for(const file of Object.keys(backend.metafile.inputs)){
 const bytes=readFileSync(resolve(root,file)),canonical=bytes.toString('utf8').replace(/\r\n/g,'\n');backendInputs[file]=hash(canonical);
 if(!changed.has(file))assert.equal(canonical,git('show',productionBase+':'+file).toString('utf8').replace(/\r\n/g,'\n'),'Unrelated backend input differs: '+file);
}
const finance=json('module-build/temple-release/financial-inputs.json');assert.equal(sha('module-build/temple-release/nile-play.js'),finance.programSha256);assert.equal(finance.baseCommit,productionBase);
const evidence='artifacts/work/temple-release-preparation/',built=json(evidence+'built-server.json');
assert.equal(built.programSha256,sha('dist-server/index.js'),'Retest the final backend');assert.equal(built.clientIndexSha256,sha('dist/index.html'),'Retest the final client');
const protocol=json(evidence+'compiled-protocol.json'),desktop=json(evidence+'built-host-desktop.json'),phone=json(evidence+'built-host-phone.json');
assert(protocol.replayWithoutDebit&&protocol.legacyRulesPreserved);assert(desktop.exactBalance&&desktop.recoveredSameUUID&&desktop.chatConnected);assert(phone.exactBalance&&phone.recoveredSameUUID&&phone.chatConnected);
assert.deepEqual(desktop.errors,[]);assert.deepEqual(phone.errors,[]);
const baseline=json(evidence+'financial-baseline-comparison.json');assert.equal(baseline.sameAfterCanonicalCompilation,true);assert.equal(baseline.liveSha256,before.financialProgram['play.js']);
const financialLog=readFileSync(resolve(root,evidence+'financial-tests-final.log'),'utf8');assert(/pass 20\b/.test(financialLog)&&/fail 0\b/.test(financialLog),'Financial compatibility run did not pass');
const result={format:1,preparedAt:new Date().toISOString(),sourceCommit:release.sourceCommit,baseCommit:productionBase,productionSnapshotSha256:sha(process.argv[2]),productionChanged:false,
 scope:'Application, shared Temple rules, compatible Nile program, and one new independent module',
 module:{gameId:game.gameId,version:game.version,manifestSha256:pointer.sha256,contract:host.games[game.gameId],files:Object.keys(game.files).length},
 retain:{contracts:Object.keys(oldHost.games).length,modulePointers:Object.keys(before.modules).filter(p=>p.endsWith('/active.json')).length,persistentServices:Object.keys(before.containers).length,runtimeDependencies:true,configuration:true,playerData:true,otherBackendPrograms:['payments.js','crypto-reconcile.js'],externalModules:'Publish only Temple; keep every earlier external pointer'},
 backend:{programSha256:sha('dist-server/index.js'),inputs:backendInputs},
 finance:{programSha256:finance.programSha256,inputs:Object.keys(finance.financialInputs).length,retainedOrigins:finance.retainedOrigins,baselineComparison:baseline,compatibilityTestsPassed:20,hostV4WardrobeTestsReplacedByPublishedV3Regressions:2},
 checks:{compiledAPI:protocol,builtDesktop:desktop,builtPhone:phone,walletFixture:false,cryptographicServerRandomness:true,physicalListening:'Unverified, carried from device acceptance'},
 artifacts:{releaseManifest:{path:'module-build/release-manifest.json',sha256:sha('module-build/release-manifest.json')},githubReceipt:{path:'module-build/release-github.json',sha256:sha('module-build/release-github.json')},financialProgram:{path:'module-build/temple-release/nile-play.js',sha256:finance.programSha256},financialInputs:{path:'module-build/temple-release/financial-inputs.json',sha256:sha('module-build/temple-release/financial-inputs.json')}},
 nextInstallationChecks:['Refresh the source/runtime snapshot under the common locks.','Use a Temple-scoped guarded installer; do not run a previous game installer with this payload.','Preserve the prior images, source and financial backups and existing database volumes.','Activate the compatible backend before the new module contract and pointer.','Retain old accepted rules after any new Temple round; never restore an old database over later operations.','Verify public health, module hashes, anonymous API protection and existing module pointers, then push the deployment record.'],
 disk:{serverFreeBytesAtSnapshot:before.freeBytes,minimumServerReserveBytes:5*1024**3},passed:true};
mkdirSync(resolve(root,'module-build/temple-release'),{recursive:true});writeFileSync(resolve(root,'module-build/temple-release/readiness.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({passed:true,sourceCommit:result.sourceCommit,module:game.version,retainedContracts:result.retain.contracts,financialInputs:result.finance.inputs}));
